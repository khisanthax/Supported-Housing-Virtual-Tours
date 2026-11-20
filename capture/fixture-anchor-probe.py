"""Experimental source-supported registration of a bright rectangular fixture.
Needs a local capture ZIP, saved reference cameras.npz and a private output folder.
Source numbers on the CLI identify the same physical fixture by visual inspection.
"""

import argparse
import json
import os
import zipfile
from pathlib import Path

os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", "4000000")
import cv2 as cv
import numpy as np
from scipy.spatial import Delaunay
from scipy.spatial.transform import Rotation


def endcaps(image):
    h, w = image.shape[:2]
    bright = np.uint8(image.min(axis=2) > 235) * 255
    contours = cv.findContours(bright, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)[0]
    result = []
    for contour in contours:
        if cv.contourArea(contour) < w * h * 0.0016:
            continue
        hull = cv.convexHull(contour)
        poly = (
            cv.approxPolyDP(hull, 0.01 * cv.arcLength(hull, True), True)
            .reshape(-1, 2)
            .astype(float)
        )
        for i, a in enumerate(poly):
            b = poly[(i + 1) % len(poly)]
            v = b - a
            lv = np.linalg.norm(v)
            for j in range(i + 1, len(poly)):
                c, d = poly[j], poly[(j + 1) % len(poly)]
                v2 = c - d
                l2 = np.linalg.norm(v2)
                if min(lv, l2) < 0.065 * w or v @ v2 < 0.91 * lv * l2:
                    continue
                for p, q, op, oq in [(a, d, b, c), (b, c, a, d)]:
                    pair = np.array([p, q])
                    span = np.linalg.norm(q - p)
                    if (pair < 4).any() or (pair > [w - 5, h - 5]).any():
                        continue
                    if (
                        8 < span < 1.2 * min(lv, l2)
                        and abs(v @ (q - p)) < 0.58 * lv * span
                    ):
                        result.append((pair, np.array([op, oq])))
    return result


def unit_rays(points, k):
    rays = np.column_stack((points, np.ones(len(points)))) @ np.linalg.inv(k).T
    return rays / np.linalg.norm(rays, axis=1, keepdims=True)


def project(points, matrix):
    homogeneous = np.column_stack((points, np.ones(len(points)))) @ matrix.T
    return homogeneous[:, :2] / homogeneous[:, 2, None]


def anchor_candidate(im, ref, k, kref, prior):
    options = []
    for cap, opposite in endcaps(im):
        rays = unit_rays(cap, k)
        for other, far in endcaps(ref):
            for ordered, ordered_far in [(other, far), (other[::-1], far[::-1])]:
                anchor = unit_rays(ordered, kref)
                widths = np.rad2deg(
                    np.arccos(
                        np.clip([rays[0] @ rays[1], anchor[0] @ anchor[1]], -1, 1)
                    )
                )
                if abs(widths[0] - widths[1]) > 1.5:
                    continue
                rotation = Rotation.align_vectors(anchor, rays)[0].as_matrix()
                change = np.rad2deg(
                    Rotation.from_matrix(rotation @ prior.T).magnitude()
                )
                if change < 25:
                    options.append(
                        (change, rotation, cap, opposite, ordered, ordered_far)
                    )
    return sorted(options, key=lambda r: r[0])


def mesh(image, transform, cap, opposite, rail_model=None):
    h, w = image.shape[:2]
    # The original image boundary and the surroundings stay anchored. Only real
    # coordinates within both images are usable. Reject triangles that reverse.
    if rail_model is None:
        points = np.concatenate(
            [cap + (opposite - cap) * t for t in [-0.15, 0, 0.25, 0.55, 0.85]]
        )
        dest = project(points, transform)
        valid = np.all(
            (points > 4)
            & (points < [w - 5, h - 5])
            & (dest > 4)
            & (dest < [w - 5, h - 5]),
            axis=1,
        )
        points, dest = points[valid], dest[valid]
    else:
        fixture_to_anchor, anchor_to_dest, near, far = rail_model
        points = []
        dest = []
        for s in [0, 1]:
            line = (far - near)[s]
            line = line / np.linalg.norm(line)
            t = np.linspace(-0.20, 0.98, 161)
            src = cap[s] + t[:, None] * (opposite - cap)[s]
            approximate = project(src, fixture_to_anchor)
            # Perpendicular correction only. The distance along an untextured
            # illuminated rail cannot establish a point-to-point correspondence.
            constrained = near[s] + ((approximate - near[s]) @ line)[:, None] * line
            target = project(constrained, anchor_to_dest)
            good = np.where(
                np.all(
                    (src > 5)
                    & (src < [w - 6, h - 6])
                    & (target > 5)
                    & (target < [w - 6, h - 6]),
                    axis=1,
                )
            )[0]
            if len(good) < 2:
                raise ValueError("Fixture outside shared support")
            chosen = good[[0, -1]]
            points.extend(src[chosen])
            dest.extend(target[chosen])
        points = np.array(points)
        dest = np.array(dest)
    if len(points) < 4:
        raise ValueError("Too few visible control points")
    motion = np.max(np.linalg.norm(points - dest, axis=1))
    corridor = cv.convexHull(np.vstack([points, dest]).astype(np.float32))
    anchors = []
    for y in np.linspace(0, h - 1, 9):
        for x in np.linspace(0, w - 1, 9):
            border = x == 0 or y == 0 or x == w - 1 or y == h - 1
            if border or cv.pointPolygonTest(
                corridor, (float(x), float(y)), True
            ) < -max(70, 1.5 * motion):
                anchors.append([x, y])
    a = np.vstack([points, anchors])
    b = np.vstack([dest, anchors])
    tri = Delaunay(b)
    image_points = a[tri.simplices]
    output_points = b[tri.simplices]
    det = lambda p: np.linalg.det(p[:, 1:] - p[:, :1])
    ratios = det(image_points) / det(output_points)
    if ratios.min() <= 0:
        raise ValueError("Mesh would fold")
    yy, xx = np.indices((h, w))
    pixels = np.stack((xx, yy), axis=-1)
    idx = tri.find_simplex(pixels)
    if np.any(idx < 0):
        raise ValueError("Mesh left input domain")
    T = tri.transform[idx]
    weighted = np.einsum("...ij,...j->...i", T[:, :, :2], pixels - T[:, :, 2])
    weights = np.dstack([weighted, 1 - weighted.sum(axis=2)])
    uv = np.einsum("...i,...ij->...j", weights, image_points[idx]).astype("float32")
    if uv.min() < -0.001 or (uv - [w - 1, h - 1]).max() > 0.001:
        raise ValueError("Out of view sample")
    return cv.remap(image, uv[:, :, 0], uv[:, :, 1], cv.INTER_LINEAR), {
        "minAreaRatio": float(ratios.min()),
        "maxAreaRatio": float(ratios.max()),
        "maxMove": float(motion),
    }


def profile_edges(image, support, xy, offsets):
    """Return both sides of the nearest bright run if each transition is observed."""
    x, y = xy.astype(np.float32).T[:, None, :]
    samples = cv.remap(image, x, y, cv.INTER_LINEAR)[0].min(axis=1)
    present = cv.remap(support, x, y, cv.INTER_LINEAR)[0] == 255
    bright = samples > 235
    transitions = np.diff(np.pad(bright, 1).astype(int))
    candidates = []
    for first, stop in zip(
        np.flatnonzero(transitions == 1), np.flatnonzero(transitions == -1)
    ):
        if (
            first > 0
            and stop < len(samples)
            and stop - first >= 10
            and present[first - 1 : stop + 1].all()
        ):
            candidates.append(offsets[[first, stop - 1]])
    return min(candidates, key=lambda endpoints: abs(endpoints.mean()), default=None)


def compare_sections(anchor, before, after, to_anchor, line):
    origin, direction = np.asarray(line, float).reshape(2, 2)
    if not np.isfinite(line).all() or np.linalg.norm(direction) < 1e-6:
        raise ValueError("Provide a finite start point and a nonzero profile direction")
    direction = direction / np.linalg.norm(direction)
    normal = np.array([-direction[1], direction[0]])
    offsets = np.arange(-135, 136)
    size = anchor.shape[1::-1]
    reference_support = np.full(anchor.shape[:2], 255, dtype=np.uint8)
    source_support = cv.warpPerspective(
        np.full(before.shape[:2], 255, dtype=np.uint8), to_anchor, size
    )
    projected = [cv.warpPerspective(im, to_anchor, size) for im in [before, after]]
    result = []
    for distance in (50, 100, 150, 200):
        xy = origin + distance * direction + offsets[:, None] * normal
        reference = profile_edges(anchor, reference_support, xy, offsets)
        errors = []
        for image in projected:
            edges = profile_edges(image, source_support, xy, offsets)
            errors.append(
                float(np.abs(edges - reference).mean())
                if edges is not None and reference is not None
                else None
            )
        result.append({"distance": distance, "before": errors[0], "after": errors[1]})
    gray = cv.cvtColor(anchor, cv.COLOR_BGR2GRAY)
    panels = []
    for image in projected:
        source = cv.cvtColor(image, cv.COLOR_BGR2GRAY)
        panels.append(cv.merge((source, gray, source)))
    return result, cv.hconcat(panels)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("zip", type=Path)
    p.add_argument("cameras", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("--anchor", type=int, required=True)
    p.add_argument("--views", type=int, nargs="+", required=True)
    p.add_argument(
        "--section-line",
        type=float,
        nargs=4,
        metavar=("X", "Y", "DX", "DY"),
        help="Optional strip axis in the anchor image for independent transverse edge measurements",
    )
    p.add_argument(
        "--rails",
        action="store_true",
        help="Constrain the two luminous side lines as well as the end cap",
    )
    args = p.parse_args()
    if args.out.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError("Use private output outside repository")
    if args.out.exists() and any(args.out.iterdir()):
        raise ValueError(
            "Choose an empty diagnostic folder to preserve previous outputs"
        )
    args.out.mkdir(exist_ok=True, parents=True)
    cv.setNumThreads(2)
    with np.load(args.cameras, allow_pickle=False) as solution:
        rot = solution["rot"]
        ks = solution["ks"].copy()
        ks[:, 0, 0] *= solution["scale"]
        ks[:, 1, 1] *= solution["scale"]
    with zipfile.ZipFile(args.zip) as z:
        if sum(o.file_size for o in z.infolist()) > 75 * 1024**2:
            raise ValueError("Source limit exceeded")
        m = json.loads(z.read("capture.json"))
        floor = {t["id"] for t in m["targets"] if abs(t["pitch"] + np.pi / 2) < 1e-6}
        kept = [(n, f) for n, f in enumerate(m["frames"], 1) if f["id"] not in floor]
        nums = [n for n, _ in kept]
        if (
            not 2 <= len(nums) <= 96
            or rot.shape != (len(nums), 3, 3)
            or ks.shape != rot.shape
        ):
            raise ValueError(
                "The frame count or camera solution dimensions are incompatible"
            )
        if not {args.anchor, *args.views}.issubset(nums):
            raise ValueError(
                "The selected views must be present among the retained sources"
            )
        imgs = []
        for _, frame in kept:
            member = z.getinfo(frame["file"])
            if member.file_size > 4 * 1024**2:
                raise ValueError("JPEG exceeds the capture size limit")
            image = cv.imdecode(
                np.frombuffer(z.read(member), np.uint8), cv.IMREAD_COLOR
            )
            if image is None:
                raise ValueError("Could not decode a source photograph")
            imgs.append(cv.resize(image, (480, 640), interpolation=cv.INTER_AREA))
        recorded = np.array(
            [[f["pose"][axis] for axis in ("r", "u", "f")] for _, f in kept]
        ).transpose(0, 2, 1)
    anchor = nums.index(args.anchor)
    reports = {}
    sections = {}
    for i, (n, _) in enumerate(kept):
        im = imgs[i]
        if n in args.views and i != anchor:
            candidates = anchor_candidate(
                im, imgs[anchor], ks[i], ks[anchor], recorded[anchor].T @ recorded[i]
            )
            if len(candidates) == 1:
                delta, q, cap, opposite, near, far = candidates[0]
                reference = ks[anchor] @ q @ np.linalg.inv(ks[i])
                into_plane = ks[i] @ rot[i].T @ rot[anchor] @ q @ np.linalg.inv(ks[i])
                try:
                    anchor_to_dest = (
                        ks[i] @ rot[i].T @ rot[anchor] @ np.linalg.inv(ks[anchor])
                    )
                    rails = (
                        (reference, anchor_to_dest, near, far) if args.rails else None
                    )
                    im, quality = mesh(im, into_plane, cap, opposite, rails)
                    reports[n] = dict(
                        rotationCorrection=float(delta),
                        sourceToAnchor=reference.tolist(),
                        **quality,
                    )
                except ValueError as e:
                    reports[n] = {"skipped": str(e)}
            else:
                reports[n] = {"skipped": "No unique photometric shape proposal"}
            if args.section_line:
                to_anchor = ks[anchor] @ rot[anchor].T @ rot[i] @ np.linalg.inv(ks[i])
                sections[n], overlay = compare_sections(
                    imgs[anchor], imgs[i], im, to_anchor, args.section_line
                )
                if not cv.imwrite(str(args.out / f"comparison-{n:02d}.jpg"), overlay):
                    raise OSError("Could not write the private overlay")
        if not cv.imwrite(str(args.out / f"frame-{n:02d}.png"), im):
            raise OSError("Could not save diagnostic")
    (args.out / "fixture.json").write_text(
        json.dumps(reports, indent=2), encoding="utf8"
    )
    if args.section_line:
        (args.out / "cross-sections.json").write_text(
            json.dumps(sections, indent=2), encoding="utf8"
        )
    print(json.dumps(reports))


if __name__ == "__main__":
    main()
