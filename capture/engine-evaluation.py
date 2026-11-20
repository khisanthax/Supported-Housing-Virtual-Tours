"""Local evaluation only. Use a fresh private directory outside the checkout."""

import argparse
import hashlib
import json
import re
import runpy
import time
import zipfile
from pathlib import Path

import cv2 as cv
import numpy as np
import psutil
from scipy.spatial.transform import Rotation


def prepare(archive, out):
    out.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(archive) as zip_source:
        if sum(m.file_size for m in zip_source.infolist()) > 75 * 1024**2:
            raise ValueError("Archive exceeds capture limit")
        manifest = json.loads(zip_source.read("capture.json"))
        omitted = {
            t["id"] for t in manifest["targets"] if abs(t["pitch"] + np.pi / 2) < 1e-6
        }
        frames = [f for f in manifest["frames"] if f["id"] not in omitted]
        if len(frames) != 38:
            raise ValueError("Expected the 38-view benchmark")
        lines = [
            'p f2 w2048 h1024 v360 E0 n"TIFF_m c:LZW"',
            "m g1 i0 f0 m2 p0.00784314",
        ]
        for i, frame in enumerate(frames):
            if zip_source.getinfo(frame["file"]).file_size > 4 * 1024**2:
                raise ValueError("Unexpected source size")
            data = zip_source.read(frame["file"])
            frame["sha256"] = hashlib.sha256(data).hexdigest()
            name = f"frame-{i + 1:02d}.jpg"
            (out / name).write_bytes(data)
            image = cv.imdecode(np.frombuffer(data, np.uint8), cv.IMREAD_COLOR)
            h, w = image.shape[:2]
            basis = np.array([frame["pose"][k] for k in ("r", "u", "f")]).T
            yaw, tilt, roll = Rotation.from_matrix(basis).as_euler("YXZ", degrees=True)
            # Hugin pitch is positive above the horizon.
            fov = "=0" if i and frame["hfov"] == frames[0]["hfov"] else frame["hfov"]
            lines.append(f'i w{w} h{h} f0 v{fov} y{yaw} p{-tilt} r{-roll} n"{name}"')
        lines.extend(f"v y{i} p{i} r{i}" for i in range(1, len(frames)))
        (out / "initial.pto").write_text("\n".join(lines) + "\nv\n", encoding="utf8")
        (out / "frames.json").write_text(json.dumps(frames), encoding="utf8")
        (out / "pose-audit.txt").write_text(
            "".join(
                f"{i} {x} {y}\n"
                for i in range(len(frames))
                for x, y in [(479.5, 639.5), (800, 639.5), (479.5, 300)]
            )
        )


def multiband(out, archive, cameras, previous):
    start = time.perf_counter()
    ref = runpy.run_path(str(Path(__file__).with_name("seam-refinement.py")))
    frames, *camera = ref["load_sources"](archive, cameras)
    views = list(ref["layers"](*camera, 1024))
    masks = ref["original_graphcut"](views, np.maximum.reduce([v[1] for v in views]))
    del views
    height, width = 1024, 2048
    blender = cv.detail_MultiBandBlender(0, 5)
    blender.prepare((0, 0, width, height))
    coverage = np.zeros((height, width), bool)
    counts = []
    owner = np.full((height, width), -1, np.int16)
    for i, ((im, weight), mask) in enumerate(
        zip(ref["layers"](*camera, width), masks, strict=True)
    ):
        valid = weight > 0
        coverage |= valid
        chosen = valid & (
            cv.resize(
                cv.dilate(mask, np.ones((3, 3), np.uint8)),
                (width, height),
                interpolation=cv.INTER_NEAREST,
            )
            > 0
        )
        counts.append(int(chosen[:910].sum()))
        owner[chosen] = i
        blender.feed(im.astype(np.int16), chosen.astype(np.uint8) * 255, (0, 0))
    result, mask = blender.blend(None, None)
    result = np.uint8(np.clip(result, 0, 255))
    observed = mask > 0
    area = np.cos(((np.arange(height) + 0.5) / height - 0.5) * np.pi)

    def fraction(m):
        return float(np.average(m.mean(axis=1), weights=area[: len(m)]))

    report = {
        "geometricSphere": fraction(coverage),
        "renderedSphere": fraction(observed),
        "renderedAboveCap": fraction(observed[:910]),
        "inputMaskPixelsAboveCap": counts,
    }
    result[910:] = 42
    cv.imwrite(str(out / "opencv-multiband.jpg"), result)
    old = cv.imread(str(previous))
    if old is None or old.shape != result.shape:
        raise ValueError("Supply the matching 2048x1024 PR 50 panorama")
    crops = ref["inspection"](
        frames,
        camera,
        camera[0],
        [old, result],
        [np.zeros_like(owner[:910]), owner[:910]],
        [14, 16, 20, 35],
        out,
    )
    report["perspective"] = {
        name: {variant: score["source_edges"] for variant, score in values.items()}
        for name, values in crops.items()
    }
    report["seconds"] = time.perf_counter() - start
    report["peakWorkingSetMiB"] = psutil.Process().memory_info().peak_wset / 2**20
    (out / "multiband.json").write_text(json.dumps(report, indent=2))
    print(report["renderedAboveCap"], report["seconds"], report["peakWorkingSetMiB"])


def guided_bundle(out):
    """Test native SIFT + ray bundle adjustment with recorded pair and pose priors."""
    from scipy.sparse.csgraph import connected_components

    start = time.perf_counter()
    frames = json.loads((out / "frames.json").read_text())
    flip = np.diag([1.0, -1.0, 1.0])
    axes = np.array(
        [[f["pose"][k] for k in ("r", "u", "f")] for f in frames]
    ).transpose(0, 2, 1)
    allowed = np.uint8(axes[:, :, 2] @ axes[:, :, 2].T > np.cos(np.deg2rad(85)))
    np.fill_diagonal(allowed, 0)
    sift = cv.SIFT_create(nfeatures=5000, contrastThreshold=0.012)
    features = []
    cameras = []
    for i, frame in enumerate(frames):
        image = cv.resize(
            cv.imread(str(out / f"frame-{i + 1:02d}.jpg")),
            (480, 640),
            interpolation=cv.INTER_AREA,
        )
        features.append(cv.detail.computeImageFeatures2(sift, image))
        features[-1].img_idx = i
        cam = cv.detail_CameraParams()
        cam.R = np.float32(flip @ axes[i] @ flip)
        cam.ppx, cam.ppy = 239.5, 319.5
        cam.aspect = 1.0
        cam.focal = 239.5 / np.tan(np.deg2rad(frame["hfov"] / 2))
        cameras.append(cam)
    matcher = cv.detail_BestOf2NearestMatcher(False, 0.3)
    matches = matcher.apply2(features, allowed)
    confidences = np.array([m.confidence for m in matches]).reshape(len(frames), -1)
    _, labels = connected_components(confidences > 1.0, directed=False)
    sizes = np.bincount(labels)
    report = {
        "components": sizes.tolist(),
        "outsideLargest": (1 + np.flatnonzero(labels != sizes.argmax())).tolist(),
    }
    if len(sizes) == 1:
        adjust = cv.detail_BundleAdjusterRay()
        adjust.setConfThresh(1.0)
        ok, fitted = adjust.apply(features, matches, cameras)
        report["bundleOK"] = ok
        if ok:
            rotations = np.array([flip @ c.R @ flip for c in fitted])
            align = Rotation.align_vectors(axes[:, :, 2], rotations[:, :, 2])[
                0
            ].as_matrix()
            ks = np.array([flip @ c.K() for c in fitted])
            ks[:, 1, 2] *= -1
            np.savez(out / "native-bundle.npz", rot=align @ rotations, ks=ks, scale=1.0)
    report["seconds"] = time.perf_counter() - start
    report["peakWorkingSetMiB"] = psutil.Process().memory_info().peak_wset / 2**20
    (out / "native-bundle.json").write_text(json.dumps(report, indent=2))
    print(report)


def audit(out):
    frames = json.loads((out / "frames.json").read_text())
    axes = np.array([[f["pose"][k] for k in ("r", "u", "f")] for f in frames])
    measurements = np.loadtxt(out / "pose-audit.txt").reshape(38, 3, 3)[:, :, 1:]
    tangents = np.tan(np.deg2rad([f["hfov"] / 2 for f in frames]))[:, None]
    xx = (measurements[:, :, 0] - 479.5) / 480 * tangents
    yy = (639.5 - measurements[:, :, 1]) / 480 * tangents
    projected = np.stack((xx, yy, np.ones_like(xx)), axis=2) @ axes
    projected /= np.linalg.norm(projected, axis=2, keepdims=True)
    mapped = np.loadtxt(out / "pose-audit-corrected.txt").reshape(38, 3, 2)
    yaw = (mapped[:, :, 0] + 0.5) / 2048 * 2 * np.pi - np.pi
    pitch = np.pi / 2 - (mapped[:, :, 1] + 0.5) / 1024 * np.pi

    def rays(yaw, pitch):
        return np.stack(
            (np.cos(pitch) * np.sin(yaw), np.sin(pitch), np.cos(pitch) * np.cos(yaw)),
            axis=-1,
        )

    error = np.rad2deg(np.arccos(np.clip((projected * rays(yaw, pitch)).sum(2), -1, 1)))
    grid_y, grid_x = np.indices((360, 720))
    directions = rays(
        (grid_x + 0.5) * np.pi / 360, np.arcsin(1 - 2 * (grid_y + 0.5) / 360)
    )
    support = []
    for i, frame in enumerate(frames):
        x, y, z = np.moveaxis(directions @ axes[i].T, -1, 0)
        support.append(
            (z > 0)
            & (abs(x) < z * tangents[i, 0])
            & (abs(y) < z * tangents[i, 0] / frame["aspect"])
        )
    tree = re.search(
        r"tree of size \d+!=38, image ([\d ]+) are not connected",
        (out / "openpano.log").read_text(errors="replace"),
    )
    if not tree:
        raise ValueError(
            "OpenPano output needs a reported component for the footprint comparison"
        )
    absent = set(map(int, tree[1].split()))
    sets = {
        "opencvRegistered": [
            i - 1
            for i in json.loads((out / "opencv-stock.json").read_text())["registered"]
        ],
        "openpanoTree": [i for i in range(38) if i not in absent],
        "imgalignSecondRun": json.loads((out / "imgalign-indices.json").read_text())[
            "orderedIndices"
        ],
        "all": list(range(38)),
    }
    report = {
        "maxRayErrorDegrees": error.max(),
        "recordedSphereFraction": {
            key: np.any(np.array(support)[ids], axis=0).mean()
            for key, ids in sets.items()
        },
    }
    (out / "angular-audit.json").write_text(json.dumps(report, indent=2))
    print(report)


def stock(out):
    start = time.perf_counter()
    frames = json.loads((out / "frames.json").read_text())
    images = [
        cv.imread(str(out / f"frame-{i + 1:02d}.jpg")) for i in range(len(frames))
    ]
    stitcher = cv.Stitcher.create(cv.Stitcher_PANORAMA)
    status = stitcher.estimateTransform(images)
    ids = [int(i) for i in stitcher.component()]
    report = {"estimateStatus": status, "registered": [i + 1 for i in ids]}
    if status == cv.Stitcher_OK:
        status, pano = stitcher.composePanorama()
        report["composeStatus"] = status
        if status == cv.Stitcher_OK:
            cv.imwrite(str(out / "opencv-stock.jpg"), pano)
            report["shape"] = list(pano.shape)
        # Equal-area directions in the optimized camera model. Counts optical
        # support, independent of output crop, not final blended ownership.
        y, x = np.indices((360, 720))
        alt = np.arcsin(1 - 2 * (y + 0.5) / 360)
        lon = (x + 0.5) * np.pi / 360
        sphere = np.stack(
            (np.cos(alt) * np.sin(lon), np.sin(alt), np.cos(alt) * np.cos(lon)), axis=-1
        )
        seen = np.zeros(alt.shape, bool)
        for idx, cam in zip(ids, stitcher.cameras(), strict=True):
            local = sphere @ cam.R
            h, w = images[idx].shape[:2]
            uv = local @ cam.K().T
            z = np.maximum(uv[:, :, 2], 1e-10)
            seen |= (
                (local[:, :, 2] > 0)
                & (uv[:, :, 0] >= 0)
                & (uv[:, :, 1] >= 0)
                & (uv[:, :, 0] < w * stitcher.workScale() * z)
                & (uv[:, :, 1] < h * stitcher.workScale() * z)
            )
        report["sampledSphereFraction"] = seen.mean()
    report["seconds"] = time.perf_counter() - start
    report["peakWorkingSetMiB"] = psutil.Process().memory_info().peak_wset / 2**20
    (out / "opencv-stock.json").write_text(json.dumps(report, indent=2))
    print(report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "operation", choices=["prepare", "opencv", "guided", "multiband", "audit"]
    )
    parser.add_argument("out", type=Path)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--cameras", type=Path)
    parser.add_argument("--previous", type=Path)
    args = parser.parse_args()
    if args.out.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError("Photo outputs must stay outside the repository")
    cv.setNumThreads(4)
    cv.ocl.setUseOpenCL(False)
    if args.operation == "prepare":
        prepare(args.archive, args.out)
    elif args.operation == "guided":
        guided_bundle(args.out)
    elif args.operation == "audit":
        audit(args.out)
    elif args.operation == "multiband":
        multiband(args.out, args.archive, args.cameras, args.previous)
    else:
        stock(args.out)
