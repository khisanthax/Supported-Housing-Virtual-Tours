"""Private, offline pair alignment experiment. Requires native OpenCV, NumPy and SciPy.
All coordinates and errors use 480 by 640 analysis images. Pair panels and derived
observations are diagnostic artifacts. Never include these output files in Git.
"""

import argparse
import json
import os
import zipfile
from pathlib import Path

os.environ["OPENCV_IO_MAX_IMAGE_PIXELS"] = "4000000"
import cv2 as cv
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation

W, H = 480, 640


def gray(im):
    return cv.cvtColor(im, cv.COLOR_BGR2GRAY)


def warp(p, mat):
    v = np.column_stack((p, np.ones(len(p)))) @ mat.T
    return v[:, :2] / v[:, 2, None]


def estimate_matches(a, b, valid):
    # Equalized local contrast improves descriptors in dim ceiling texture.
    clahe = cv.createCLAHE(clipLimit=2, tileGridSize=(8, 8))
    det = cv.SIFT_create(nfeatures=6000, contrastThreshold=0.006)
    p, da = det.detectAndCompute(clahe.apply(gray(a)), valid)
    q, db = det.detectAndCompute(clahe.apply(gray(b)), None)
    if da is None or db is None:
        return np.empty((0, 2)), np.empty((0, 2))
    p = np.float32([k.pt for k in p])
    q = np.float32([k.pt for k in q])

    # Exact gated mutual nearest neighbors within 140 analysis pixels. This only proposes observations.
    def nearest_matches(query, candidates, query_desc, candidate_desc):
        tree = cKDTree(candidates)
        found = {}
        # Bound the temporary neighborhood list even in highly textured photographs.
        for first in range(0, len(query), 128):
            neighborhoods = tree.query_ball_point(query[first : first + 128], 140)
            for i, neighbors in enumerate(neighborhoods, start=first):
                if len(neighbors) < 2:
                    continue
                distances = ((candidate_desc[neighbors] - query_desc[i]) ** 2).sum(1)
                best, second = np.argsort(distances)[:2]
                if distances[best] < 0.77**2 * distances[second]:
                    found[i] = (neighbors[best], distances[best])
        return found

    ab = nearest_matches(p, q, da, db)
    ba = nearest_matches(q, p, db, da)
    pp = []
    qq = []
    seen = set()
    for i, (j, _) in sorted(ab.items(), key=lambda v: v[1][1]):
        if ba.get(j, (-1,))[0] != i:
            continue
        cell = tuple((p[i] / 8).astype(int))
        if cell in seen:
            continue
        seen.add(cell)
        pp.append(p[i])
        qq.append(q[j])
    return np.array(pp).reshape(-1, 2), np.array(qq).reshape(-1, 2)


def rotation_fit(src, dst, k):
    def model(v, p):
        return warp(p, k @ Rotation.from_rotvec(v).as_matrix() @ np.linalg.inv(k))

    fit = least_squares(
        lambda v: (model(v, src) - dst).ravel(),
        np.zeros(3),
        loss="soft_l1",
        f_scale=2,
        bounds=(-0.45, 0.45),
    )
    return lambda p: model(fit.x, p)


def local_fit(src, dst, rot, point):
    # Smooth residual field with bounded magnitude. Outside anchor support return rotation only.
    resid = dst - rot(src)
    dist = np.linalg.norm(point[:, None] - src[None, :], axis=2)
    order = np.argsort(dist, axis=1)[:, :6]
    dd = np.take_along_axis(dist, order, axis=1)
    weight = np.exp(-0.5 * (dd / 50) ** 2) / np.maximum(dd, 6)
    offset = (weight[:, :, None] * resid[order]).sum(1) / np.maximum(
        weight.sum(1)[:, None], 1.0e-12
    )
    support = np.clip((120 - dd[:, 0]) / 60, 0, 1)
    return rot(point) + np.clip(offset, -80, 80) * support[:, None]


def score(e):
    if len(e) == 0:
        return {}
    n = np.linalg.norm(e, axis=1)
    return {
        "n": len(n),
        "median": float(np.median(n)),
        "p90": float(np.percentile(n, 90)),
        "rms": float(np.sqrt(np.mean(n * n))),
    }


def bounded_archive(path, max_bytes, max_entries):
    if path.stat().st_size > max_bytes:
        raise ValueError(f"Archive exceeds {max_bytes} bytes")
    archive = zipfile.ZipFile(path)
    entries = archive.infolist()
    if (
        len(entries) > max_entries
        or sum(entry.file_size for entry in entries) > max_bytes
        or len(set(archive.namelist())) != len(entries)
    ):
        archive.close()
        raise ValueError("Archive has duplicate members or exceeds the analysis limits")
    return archive


def get_data(zpath, solution):
    with bounded_archive(zpath, 75 * 1024**2, 128) as archive:
        if archive.getinfo("capture.json").file_size > 1024**2:
            raise ValueError("Capture manifest is too large")
        manifest = json.loads(archive.read("capture.json"))
        floor = {
            t["id"] for t in manifest["targets"] if abs(t["pitch"] + np.pi / 2) < 1.0e-6
        }
        frames = [f for f in manifest["frames"] if f["id"] not in floor]
        if (
            not 2 <= len(frames) <= 96
            or len({f["file"] for f in frames}) != len(frames)
            or len({f["id"] for f in frames}) != len(frames)
        ):
            raise ValueError("Unsupported frame count or duplicated frame")
        images = []
        for frame in frames:
            info = archive.getinfo(frame["file"])
            if info.file_size > 4 * 1024**2:
                raise ValueError("Source exceeds the 4 MiB per-frame limit")
            raw = archive.read(info)
            if not raw.startswith(b"\xff\xd8\xff"):
                raise ValueError("Source is not a JPEG")
            photo = cv.imdecode(np.frombuffer(raw, np.uint8), cv.IMREAD_COLOR)
            if photo is None:
                raise ValueError("Source JPEG could not be decoded")
            images.append(cv.resize(photo, (W, H), interpolation=cv.INTER_AREA))
    with (
        bounded_archive(solution, 1024**2, 16),
        np.load(solution, allow_pickle=False) as data,
    ):
        rotations, ks, scale = data["rot"], data["ks"], data["scale"]
    if (
        ks.shape != (len(images), 3, 3)
        or rotations.shape != ks.shape
        or scale.shape != ()
        or not np.isfinite(rotations).all()
        or not np.isfinite(ks).all()
        or not np.isfinite(scale)
        or scale <= 0
    ):
        raise ValueError(
            "Camera solution does not match the source frame count or has invalid matrices"
        )
    ks[:, 0, 0] *= scale
    ks[:, 1, 1] *= scale
    return images, ks, rotations


def analyze(i, j, ims, ks, rs, out):
    mat = ks[i] @ rs[i].T @ rs[j] @ np.linalg.inv(ks[j])
    src = cv.warpPerspective(ims[j], mat, (W, H))
    valid = cv.warpPerspective(np.full((H, W), 255, "uint8"), mat, (W, H))
    valid = cv.erode(
        valid, np.ones((21, 21), "uint8"), borderType=cv.BORDER_CONSTANT, borderValue=0
    )
    p, q = estimate_matches(src, ims[i], valid)
    report = {"target": i + 1, "neighbor": j + 1, "mutual": len(p)}
    if len(p) < 12:
        return report
    # A translation bound between neighboring correspondences allows local parallax.
    # This check is per correspondence, never the metric used to judge acceptance.
    displacement = q - p
    keep = np.zeros(len(p), dtype=bool)
    for first in range(0, len(p), 128):
        batch = slice(first, first + 128)
        dist = np.linalg.norm(p[batch, None] - p[None, :], axis=2)
        delta = np.linalg.norm(
            displacement[batch, None] - displacement[None, :], axis=2
        )
        agree = delta < np.minimum(20, 4 + dist * 0.18)
        keep[batch] = ((dist < 100) & agree).sum(1) >= 4
    p, q = p[keep], q[keep]
    report["coherent"] = len(p)
    if len(p) < 12:
        return report
    # Leave each spatial block out. Score only observed points; no claims over featureless areas.
    blocks = (p // 64).astype(int)
    cells = np.unique(blocks, axis=0)
    old = []
    rot = []
    local = []
    for cell in cells:
        test = (blocks == cell).all(1)
        train = ~test
        train &= np.linalg.norm(p[:, None] - p[test][None, :], axis=2).min(1) > 25
        if train.sum() < 8:
            continue
        f = rotation_fit(p[train], q[train], ks[i])
        old.extend(p[test] - q[test])
        rot.extend(f(p[test]) - q[test])
        local.extend(local_fit(p[train], q[train], f, p[test]) - q[test])
    report.update(
        blocks=len(cells),
        pose=score(old),
        rotation=score(rot),
        local=score(local),
        span=np.ptp(p, axis=0).tolist(),
    )
    f = rotation_fit(
        q, p, ks[i]
    )  # render opposite mapping: target pixels to projected neighbor
    yy, xx = np.indices((H, W))
    xy = np.stack((xx, yy), axis=2).reshape(-1, 2)
    block_size = min(6144, max(1, 500_000 // len(q)))
    loc = (
        np.vstack(
            [
                local_fit(q, p, f, xy[i : i + block_size])
                for i in range(0, len(xy), block_size)
            ]
        )
        .reshape(H, W, 2)
        .astype("float32")
    )
    fixed = cv.remap(src, loc, None, cv.INTER_LINEAR)
    mask = cv.remap(valid, loc, None, cv.INTER_NEAREST)
    imgs = [
        ims[i],
        np.where(
            valid[:, :, None] > 0, cv.addWeighted(ims[i], 0.5, src, 0.5, 0), ims[i]
        ),
        np.where(
            mask[:, :, None] > 0, cv.addWeighted(ims[i], 0.5, fixed, 0.5, 0), ims[i]
        ),
    ]
    board = np.hstack(
        [cv.resize(im, (360, 480), interpolation=cv.INTER_AREA) for im in imgs]
    )
    for k, title in enumerate(
        [
            f"Target #{i + 1}",
            f"Existing pose + #{j + 1}",
            "Local residual fit (diagnostic)",
        ]
    ):
        cv.putText(
            board, title, (6 + k * 360, 24), cv.FONT_HERSHEY_SIMPLEX, 0.62, (0, 0, 0), 3
        )
        cv.putText(
            board,
            title,
            (6 + k * 360, 24),
            cv.FONT_HERSHEY_SIMPLEX,
            0.62,
            (255, 255, 255),
            1,
        )
    cv.imwrite(str(out / f"local-{i + 1}-{j + 1}.jpg"), board)
    np.savez_compressed(
        out / f"pair-{i + 1}-{j + 1}.npz",
        source_projected=p,
        target=q,
        neighbor_to_target=mat,
    )
    return report


def region_fit(ref, src, region, rotation, exclusions):
    """Fit image intensities in a target-only region, using source coordinates only for validation later."""
    from scipy.ndimage import map_coordinates

    roi = region["box"]
    if len(roi) != 4 or not (0 <= roi[0] < roi[2] <= W and 0 <= roi[1] < roi[3] <= H):
        raise ValueError("Region must fit within the analysis image")
    cx, cy = region["centre"]
    grid = np.array([[cx, cy], [cx + 100, cy], [cx, cy + 100]], dtype=float)
    starts = rotation(grid)
    param = np.r_[
        starts[0] - grid[0], ((starts[1:] - starts[:1]).T / 100 - np.eye(2)).flatten()
    ]

    def transform(xy, v):
        return xy + v[:2] + (xy - [cx, cy]) @ v[2:6].reshape(2, 2).T

    domain = np.zeros((H, W), np.uint8)
    cv.fillPoly(domain, [np.int32(region["polygon"])], 1)
    indices = (
        np.indices((roi[3] - roi[1], roi[2] - roi[0])).reshape(2, -1).T[:, ::-1]
        + roi[:2]
    )
    indices = indices[domain[indices[:, 1], indices[:, 0]].astype(bool)]
    indices = indices[
        np.linalg.norm(indices[:, None] - exclusions[None, :], axis=2).min(1) > 24
    ]
    if len(indices) < 30:
        raise ValueError("Too little region remains after holding out landmarks")
    levels = []
    for sigma in (8, 4, 2, 1):
        reference = cv.GaussianBlur(gray(ref).astype(np.float32), (0, 0), sigma)
        neighbor = cv.GaussianBlur(gray(src).astype(np.float32), (0, 0), sigma)
        gradient = np.hypot(
            cv.Sobel(reference, cv.CV_32F, 1, 0), cv.Sobel(reference, cv.CV_32F, 0, 1)
        )
        strength = gradient[indices[:, 1], indices[:, 0]]
        points = indices[strength > np.percentile(strength, 58)][::3]
        if len(points) < 8:
            raise ValueError("Target region lacks sufficient texture")
        reference_detail = reference - cv.GaussianBlur(reference, (0, 0), 12)
        neighbor_detail = neighbor - cv.GaussianBlur(neighbor, (0, 0), 12)
        pixels = reference[points[:, 1], points[:, 0]]
        detail = reference_detail[points[:, 1], points[:, 0]]
        levels.append((points, neighbor, neighbor_detail, pixels, detail))

    def fit_level(start, level):
        points, neighbor, neighbor_detail, pixels, detail = level

        def residual(x):
            coords = transform(points, x).T[::-1]
            values = map_coordinates(
                neighbor, coords, order=1, prefilter=False, mode="constant", cval=-100.0
            )
            high = map_coordinates(
                neighbor_detail,
                coords,
                order=1,
                prefilter=False,
                mode="constant",
                cval=-80.0,
            )
            return np.r_[
                (high - detail) * 1.5, (values * x[6] + x[7] - pixels) * 0.5
            ].astype(float)

        def jac(x):
            steps = np.array([0.12, 0.12, 0.001, 0.001, 0.001, 0.001, 0.001, 0.1])
            offsets = np.diag(steps)
            return np.column_stack(
                [
                    (residual(x + d) - residual(x - d)) / (2 * step)
                    for d, step in zip(offsets, steps)
                ]
            )

        bounds = (
            [-165, -165, -0.8, -0.8, -0.8, -0.8, 0.5, -70],
            [165, 165, 0.8, 0.8, 0.8, 0.8, 1.7, 70],
        )
        result = least_squares(
            residual,
            np.r_[start, 1.0, 0.0],
            jac=jac,
            loss="soft_l1",
            f_scale=4.0,
            max_nfev=70,
            bounds=bounds,
        )
        return result.x[:6], result.cost / len(points)

    candidates = []
    for dx in (-35, 0, 35):
        for dy in (-35, 0, 35):
            start = param.copy()
            start[:2] += [dx, dy]
            for level in levels:
                start, cost = fit_level(start, level)
            candidates.append((cost, start))
    # Model selection uses pixel error only. Source junctions are read by the caller for validation.
    cost, v = min(candidates, key=lambda item: item[0])
    A = np.eye(2) + v[2:].reshape(2, 2)
    t = v[:2] + np.array([cx, cy]) - A @ np.array([cx, cy])
    return np.column_stack((A, t)), cost


def validate_landmarks(annotation, ims, ks, rs, out):
    """Independent visible junctions, in the two registered 480x640 image planes."""
    i, j = annotation["target"] - 1, annotation["neighbor"] - 1
    points = np.asarray(annotation["projected"], dtype=float)
    observed = np.asarray(annotation["observed"], dtype=float)
    if points.shape != (4, 2) or observed.shape != (4, 2):
        raise ValueError("Four corresponding junctions required")
    with np.load(out / f"pair-{i + 1}-{j + 1}.npz") as data:
        src, dst, matrix = (
            data["source_projected"],
            data["target"],
            data["neighbor_to_target"],
        )
    contour = np.asarray(annotation["backgroundPolygon"], dtype=np.float32)
    background = np.array(
        [cv.pointPolygonTest(contour, tuple(map(float, p)), False) > 0 for p in dst]
    )
    if background.sum() < 8:
        raise ValueError("Insufficient background support for rotation fit")
    base = rotation_fit(src, dst, ks[i])
    bg = rotation_fit(src[background], dst[background], ks[i])
    chair_rotation = rotation_fit(points, observed, ks[i])
    local = local_fit(src, dst, base, points)
    errors = []
    loo = []
    for held in range(4):
        train = np.arange(4) != held
        model = np.linalg.solve(
            np.column_stack((points[train], np.ones(3))), observed[train]
        )
        errors.append(np.r_[points[held], 1] @ model - observed[held])
        loo.append(model.T)
    report = {
        "existing": score(points - observed),
        "rotation": score(base(points) - observed),
        "local": score(local - observed),
        "surfaceAffineLOO": score(errors),
        "carpetRotationOnCarpet": score(bg(src[background]) - dst[background]),
        "carpetRotationOnCushion": score(bg(points) - observed),
        "cushionRotationOnCarpet": score(
            chair_rotation(src[background]) - dst[background]
        ),
        "landmarkPrecision": "Approximate manual seam junctions at 480 by 640",
    }
    (out / "landmark-check.json").write_text(json.dumps(report, indent=2))
    projected = cv.warpPerspective(ims[j], matrix, (W, H))
    # Hold the front-centre (#2) mark out of the displayed surface fit.
    correction = loo[1]
    valid = cv.warpPerspective(np.full((H, W), 255, "uint8"), matrix, (W, H))

    def overlay(neighbor, mask):
        return np.where(
            mask[:, :, None] > 0, cv.addWeighted(ims[i], 0.5, neighbor, 0.5, 0), ims[i]
        )

    fixed = cv.warpAffine(projected, correction, (W, H))
    mask = cv.warpAffine(valid, correction, (W, H))
    panels = [ims[i], overlay(projected, valid), overlay(fixed, mask)]
    board = np.hstack([cv.resize(a, (360, 480)) for a in panels])
    for k, label in enumerate(
        ["Original target", "Previous camera pose", "Cushion affine (3 marks)"]
    ):
        cv.putText(
            board, label, (5 + k * 360, 24), cv.FONT_HERSHEY_SIMPLEX, 0.63, (0, 0, 0), 3
        )
        cv.putText(
            board,
            label,
            (5 + k * 360, 24),
            cv.FONT_HERSHEY_SIMPLEX,
            0.63,
            (255, 255, 255),
            1,
        )
    cv.imwrite(str(out / "chair-surface-holdout.jpg"), board)
    if "region" in annotation:
        inverse, cost = region_fit(
            ims[i],
            projected,
            annotation["region"],
            rotation_fit(dst, src, ks[i]),
            observed,
        )
        corrected = cv.invertAffineTransform(inverse)
        report["regionAffine"] = score(
            cv.transform(points[:, None, :], corrected)[:, 0] - observed
        )
        report["regionCost"] = cost
        report["mappedPointErrors"] = np.linalg.norm(
            cv.transform(points[:, None, :], corrected)[:, 0] - observed, axis=1
        ).tolist()
        fitted = cv.warpAffine(projected, corrected, (W, H))
        support = cv.warpAffine(valid, corrected, (W, H))
        end = overlay(fitted, support)
        board = np.hstack(
            [cv.resize(im, (360, 480)) for im in [ims[i], panels[1], end]]
        )
        for k, name in enumerate(
            ["Target", "Saved pose overlay", "Target-region pixel fit"]
        ):
            cv.putText(
                board,
                name,
                (5 + k * 360, 24),
                cv.FONT_HERSHEY_SIMPLEX,
                0.63,
                (0, 0, 0),
                3,
            )
            cv.putText(
                board,
                name,
                (5 + k * 360, 24),
                cv.FONT_HERSHEY_SIMPLEX,
                0.63,
                (255, 255, 255),
                1,
            )
        cv.imwrite(str(out / "chair-surface-image-fit.jpg"), board)
        (out / "landmark-check.json").write_text(json.dumps(report, indent=2))
    print(report, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("zip", type=Path)
    parser.add_argument("solution", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--targets", nargs="+", type=int, required=True)
    parser.add_argument(
        "--landmarks",
        type=Path,
        help="Optional private four-junction diagnostic in projected image coordinates",
    )
    args = parser.parse_args()
    out = args.output.resolve()
    repo = Path(__file__).resolve().parents[1]
    if (
        repo.is_relative_to(out)
        or out.is_relative_to(repo)
        or any((p / ".git").exists() for p in (out, *out.parents))
    ):
        raise ValueError("Choose a dedicated private output directory outside Git")
    # Reject redirected output files before writing any private diagnostic images.
    if out.exists() and any(
        p.resolve().parent != out or p.is_symlink() for p in out.iterdir()
    ):
        raise ValueError("Output directory contains redirected files")
    out.mkdir(parents=True, exist_ok=True)
    cv.setNumThreads(2)
    ims, ks, rs = get_data(args.zip, args.solution)
    if any(not 1 <= index <= len(ims) for index in args.targets):
        raise ValueError(
            "Target numbers are 1-based and must be present in the capture"
        )
    report = []
    for index in args.targets:
        i = index - 1
        for j in np.argsort(-(rs[:, :, 2] @ rs[i, :, 2]))[1:9]:
            r = analyze(i, int(j), ims, ks, rs, out)
            report.append(r)
            print(r, flush=True)
    (out / "local-validation.json").write_text(json.dumps(report, indent=2))
    if args.landmarks:
        if args.landmarks.stat().st_size > 128 * 1024:
            raise ValueError("Landmark annotation is too large")
        annotation = json.loads(args.landmarks.read_text())
        if not any(
            r["target"] == annotation["target"]
            and r["neighbor"] == annotation["neighbor"]
            and "rotation" in r
            for r in report
        ):
            raise ValueError("Landmark pair lacks a current fitted overlap")
        validate_landmarks(annotation, ims, ks, rs, out)


if __name__ == "__main__":
    main()
