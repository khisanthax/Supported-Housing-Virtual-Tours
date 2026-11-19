"""Offline diagnostic for fixed camera solutions; raw data and results stay private."""

import argparse
import json
import os
import zipfile
from pathlib import Path

os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", "4000000")
import cv2 as cv
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import breadth_first_order, maximum_flow


def load_sources(archive, solution):
    with zipfile.ZipFile(archive) as z:
        if sum(e.file_size for e in z.infolist()) > 75 * 1024**2:
            raise ValueError("Archive too large")
        meta = json.loads(z.read("capture.json"))
        floor = {t["id"] for t in meta["targets"] if abs(t["pitch"] + np.pi / 2) < 1e-6}
        frames = [f for f in meta["frames"] if f["id"] not in floor]
        images = []
        for f in frames:
            if z.getinfo(f["file"]).file_size > 4 * 1024**2:
                raise ValueError("Image too large")
            original = cv.imdecode(
                np.frombuffer(z.read(f["file"]), np.uint8), cv.IMREAD_COLOR
            )
            if original is None:
                raise ValueError("Invalid source image")
            images.append(cv.resize(original, (480, 640), interpolation=cv.INTER_AREA))
    with np.load(solution) as data:
        rotations, intrinsics, scale = data["rot"], data["ks"], float(data["scale"])
    if len(images) != len(rotations) or len(images) != len(intrinsics):
        raise ValueError("Source count differs from camera solution")
    return frames, images, rotations, intrinsics, scale


def layers(images, rotations, intrinsics, scale, width):
    height = width // 2
    yaw, pitch = np.meshgrid(
        ((np.arange(width) + 0.5) / width - 0.5) * 2 * np.pi,
        (0.5 - (np.arange(height) + 0.5) / height) * np.pi,
    )
    rays = np.stack(
        (np.sin(yaw) * np.cos(pitch), np.sin(pitch), np.cos(yaw) * np.cos(pitch)),
        axis=2,
    ).astype("float32")
    for image, rotation, k in zip(images, rotations, intrinsics):
        vec = rays @ rotation.astype("float32")
        z = np.maximum(0.001, vec[:, :, 2])
        u = vec[:, :, 0] / z * k[0, 0] * scale + k[0, 2]
        v = vec[:, :, 1] / z * k[1, 1] * scale + k[1, 2]
        score = np.maximum(
            0, 1 - np.maximum(abs(u / k[0, 2] - 1), abs(v / k[1, 2] - 1))
        ) * (vec[:, :, 2] > 0)
        yield (
            cv.remap(image, u.astype("float32"), v.astype("float32"), cv.INTER_LINEAR),
            score,
        )


def original_graphcut(views, best):
    """Reproduce 51d04b8 mask construction and the mask-based owner tie-break."""
    origins, images, masks = [], [], []
    for im, weight in views:
        mask = np.uint8((weight > 0.001) & (weight >= best * 0.65)) * 255
        x, y, w, h = cv.boundingRect(mask)
        if not w:
            raise ValueError("Baseline excludes a frame")
        origins.append((x, y))
        images.append(im[y : y + h, x : x + w].astype("float32"))
        masks.append(cv.UMat(mask[y : y + h, x : x + w]))
    cut = cv.detail_GraphCutSeamFinder("COST_COLOR_GRAD").find(images, origins, masks)
    full_masks = []
    for mask, (x, y) in zip(cut, origins):
        patch = mask.get()
        full = np.zeros(best.shape, "uint8")
        full[y : y + patch.shape[0], x : x + patch.shape[1]] = patch
        full_masks.append(full)
    return full_masks


def score_owners(views, masks):
    owners = np.full(views[0][1].shape, -1, "int16")
    high = np.full(owners.shape, -1.0, "float32")
    for i, ((im, weight), mask) in enumerate(zip(views, masks)):
        score = (
            weight
            + cv.resize(
                mask, (owners.shape[1], owners.shape[0]), interpolation=cv.INTER_NEAREST
            )
            / 255
        )
        keep = (weight > 0) & (score > high)
        high[keep] = score[keep]
        owners[keep] = i
    return owners


def protected_owners(regions, frames, camera, width, rows):
    """Project hand-marked regions from observed camera pixels into the seam lattice."""
    images, rotations, intrinsics, scale = camera
    owners = np.full((rows, width), -1, "int16")
    area = []
    names = [frame["file"] for frame in frames]
    for region in regions:
        index = names.index(region["source"])
        points = np.asarray(region["polygon"], dtype="float64")
        h, w = images[index].shape[:2]
        if (
            points.ndim != 2
            or points.shape[1] != 2
            or len(points) < 3
            or not np.isfinite(points).all()
            or np.any(points < 1)
            or np.any(points > [w - 2, h - 2])
        ):
            raise ValueError(
                "Protected polygon must be inside the diagnostic source image"
            )
        mask = np.zeros((h, w), "uint8")
        cv.fillPoly(mask, [np.rint(points).astype("int32")], 255)
        projected, confidence = next(
            layers([mask], [rotations[index]], [intrinsics[index]], scale, width)
        )
        visible = (projected == 255) & (confidence > 0)
        use = visible[:rows]
        if not use.any() or np.any(use & (owners >= 0) & (owners != index)):
            raise ValueError(
                "Protected region is unobserved or overlaps another source constraint"
            )
        owners[use] = index
        area.append(
            {
                "source": names[index],
                "observed_cells": int(use.sum()),
                "excluded_floor_cells": int(visible[rows:].sum()),
            }
        )
    return owners, area


def refine(views, initial, corridor_pixels=0, rounds=3, protected=None):
    """Alpha expansions on a cylinder; opposing sides of each overlap share one cut.
    A label always identifies an observed pixel. Label distances use the appearance
    of both source images at both endpoints of each candidate seam segment.
    """
    h, w = initial.shape
    indices = np.arange(h * w).reshape(h, w)
    p = np.r_[indices.ravel(), indices[:-1].ravel()]
    q = np.r_[np.roll(indices, -1, axis=1).ravel(), indices[1:].ravel()]
    labels = initial.ravel().copy()
    if np.any(labels < 0):
        raise ValueError("Unobserved tour area above the floor cap")
    weights = np.stack([v[1].ravel() for v in views])
    best = weights.max(axis=0)
    # Retain a useful central portion of every previously contributing view.
    # Without a core constraint a minimum cut can remove an entire photograph.
    fixed = np.zeros(len(labels), bool)
    for i in range(len(views)):
        area = labels == i
        if not area.any():
            raise ValueError("Baseline photograph has no source region")
        fixed |= area & (weights[i] >= np.percentile(weights[i, area], 85))
    if protected is not None:
        ids = np.flatnonzero(protected.ravel() >= 0)
        labels[ids] = protected.ravel()[ids]
        fixed[ids] = True
        initial = labels.reshape(h, w)
    if corridor_pixels:
        boundaries = (initial != np.roll(initial, 1, axis=1)) | (
            initial != np.roll(initial, -1, axis=1)
        )
        boundaries[:-1] |= initial[:-1] != initial[1:]
        boundaries[1:] |= initial[1:] != initial[:-1]
        pad = corridor_pixels + 1
        distance = cv.distanceTransform(
            np.pad((~boundaries).astype("uint8"), ((0, 0), (pad, pad)), mode="wrap"),
            cv.DIST_L2,
            cv.DIST_MASK_PRECISE,
        )[:, pad:-pad]
        fixed |= distance.ravel() > corridor_pixels
    features = []
    for im, weight in views:
        gray = cv.cvtColor(im, cv.COLOR_BGR2GRAY)
        gx = cv.Sobel(gray, cv.CV_32F, 1, 0, ksize=3) / 8
        gy = cv.Sobel(gray, cv.CV_32F, 0, 1, ksize=3) / 8
        # Gradients and a broad local mean discourage cutting through displaced
        # structures even when two source pixels briefly share the same colour.
        features.append(
            np.dstack((im, cv.GaussianBlur(gray, (0, 0), 3), gx, gy))
            .astype("float32")
            .reshape(-1, 6)
        )
    features = np.stack(features)

    def difference(a, b, locations):
        return np.abs(features[a, locations] - features[b, locations]).mean(axis=1)

    def cut_cost(a, b, u, v):
        return (a != b) * (3 + difference(a, b, u) + difference(a, b, v))

    for iteration in range(rounds):
        changes = 0
        order = range(len(views)) if iteration % 2 == 0 else reversed(range(len(views)))
        for label in order:
            enabled = (
                ~fixed
                & (weights[label] > 0.06)
                & (weights[label] >= 0.18 * best)
                & (labels != label)
            )
            active = np.flatnonzero(enabled)
            if not len(active):
                continue
            local = np.full(h * w, -1, "int32")
            local[active] = np.arange(len(active))
            relevant = enabled[p] | enabled[q]
            u, v = p[relevant], q[relevant]
            old_u, old_v = labels[u], labels[v]
            edge00 = cut_cost(old_u, old_v, u, v)
            edge01 = cut_cost(old_u, label, u, v)
            edge10 = cut_cost(label, old_v, u, v)
            # Very weak centering cost retains well-supported image interiors.
            # Ray coverage stays compulsory even if colour costs favour a hole.
            linear = 0.65 * (weights[labels[active], active] - weights[label, active])
            inside = enabled[u] & enabled[v]
            both_u, both_v = local[u[inside]], local[v[inside]]
            half = np.maximum(
                0, (edge01[inside] + edge10[inside] - edge00[inside]) * 0.5
            )
            np.add.at(linear, both_u, edge10[inside] - edge00[inside] - half)
            np.add.at(linear, both_v, edge01[inside] - edge00[inside] - half)
            one = enabled[u] & ~enabled[v]
            np.add.at(linear, local[u[one]], edge10[one] - edge00[one])
            one = ~enabled[u] & enabled[v]
            np.add.at(linear, local[v[one]], edge01[one] - edge00[one])
            source, sink = len(active), len(active) + 1
            ids = np.arange(len(active))
            row = np.r_[both_u, both_v, np.full(len(ids), source), ids]
            col = np.r_[both_v, both_u, ids, np.full(len(ids), sink)]
            cap = np.r_[half, half, np.maximum(linear, 0), np.maximum(-linear, 0)]
            network = coo_matrix(
                (np.rint(cap * 32).astype("int64"), (row, col)),
                shape=(sink + 1, sink + 1),
            ).tocsr()
            flow = maximum_flow(network, source, sink)
            residual = network - flow.flow
            residual.eliminate_zeros()
            reachable = breadth_first_order(residual, source, return_predecessors=False)
            switch = np.ones(len(active), bool)
            switch[reachable[reachable < source]] = False
            labels[active[switch]] = label
            changes += int(switch.sum())
        if not changes:
            break
    return labels.reshape(h, w)


def characteristics(image, owners, wrap=True):
    # Render-space continuity proxy; a real object edge can also have a large step.
    steps = []
    if wrap:
        horizontal = (owners, np.roll(owners, -1, 1), image, np.roll(image, -1, 1))
    else:
        horizontal = (owners[:, :-1], owners[:, 1:], image[:, :-1], image[:, 1:])
    for a, b, ia, ib in [horizontal, (owners[:-1], owners[1:], image[:-1], image[1:])]:
        seam = (a != b) & (a >= 0) & (b >= 0)
        if seam.any():
            steps.append(
                np.sqrt(np.mean((ia[seam].astype("float32") - ib[seam]) ** 2, axis=1))
            )
    values = np.concatenate(steps) if steps else np.array([])
    result = {
        "seam_edges": len(values),
        "seam_rms_step_p90": float(np.percentile(values, 90)) if len(values) else None,
        "seam_steps_over_40": int((values > 40).sum()),
        "used_frames": len(np.unique(owners[owners >= 0])),
    }
    if wrap:
        boundary = np.sqrt(
            np.mean((image[:, 0].astype("float32") - image[:, -1]) ** 2, axis=1)
        )
        result["wrap_p90"] = float(np.percentile(boundary, 90))
    return result


def source_edge_recall(source, render, valid):
    # Share of Canny source edges with a rendered edge within 3 pixels and 22.5
    # degrees. This measures agreement from one chosen source viewpoint; the
    # diagnostic panorama has no independent geometric ground truth.
    def edges(im):
        gray = cv.GaussianBlur(cv.cvtColor(im, cv.COLOR_BGR2GRAY), (3, 3), 0.8)
        mask = cv.Canny(gray, 45, 100, L2gradient=True) > 0
        gx = cv.Sobel(gray, cv.CV_32F, 1, 0)
        gy = cv.Sobel(gray, cv.CV_32F, 0, 1)
        direction = np.mod(np.arctan2(gy, gx), np.pi)
        return mask, direction

    original, angle = edges(source)
    detected, target = edges(render)
    selected = original & valid
    distances = []

    def angular_distance(orientation, centre):
        return abs((orientation - centre + np.pi / 2) % np.pi - np.pi / 2)

    for k in range(16):
        centre = (k + 0.5) * np.pi / 16
        sources = selected & (angular_distance(angle, centre) <= np.pi / 32)
        compatible = detected & (angular_distance(target, centre) <= np.pi / 8)
        if sources.any():
            distance = cv.distanceTransform(
                np.uint8(~compatible), cv.DIST_L2, cv.DIST_MASK_PRECISE
            )
            distances.extend(distance[sources])
    return {
        "compared": len(distances),
        "fraction_within_3px": float(np.mean(np.array(distances) <= 3))
        if distances
        else None,
    }


def inspection(frames, cameras, patched, result, owners, numbers, output):
    imgs, rotations, intrinsics, scale = cameras
    cw, ch = 288, 384
    rows = []
    details = {}
    for number in numbers:
        if not 1 <= number <= len(frames):
            raise ValueError("View number out of range")
        idx = number - 1
        k = intrinsics[idx]
        y, x = np.indices((ch, cw), dtype="float32")
        rays = np.stack(
            (
                (x / (cw - 1) * 479 - k[0, 2]) / (k[0, 0] * scale),
                (y / (ch - 1) * 639 - k[1, 2]) / (k[1, 1] * scale),
                np.ones_like(x),
            ),
            axis=-1,
        )
        world = rays @ rotations[idx].T
        pitch = np.arcsin(world[:, :, 1] / np.linalg.norm(world, axis=-1))
        h, w = result[0].shape[:2]
        u = (
            (np.arctan2(world[:, :, 0], world[:, :, 2]) / (2 * np.pi) + 0.5) * w - 0.5
        ).astype("float32")
        v = ((0.5 - pitch / np.pi) * h - 0.5).astype("float32").clip(0, h - 1)
        columns = [cv.resize(imgs[idx], (cw, ch))]
        stats = {}
        for name, img, owner in zip(("baseline", "refined"), result, owners):
            crop = cv.remap(img, u, v, cv.INTER_LINEAR, borderMode=cv.BORDER_WRAP)
            labels = np.pad(
                owner, ((0, h - owner.shape[0]), (0, 0)), constant_values=-1
            )
            local = cv.remap(labels, u, v, cv.INTER_NEAREST, borderMode=cv.BORDER_WRAP)
            stats[name] = characteristics(crop, local, False)
            stats[name]["source_edges"] = source_edge_recall(
                columns[0], crop, local >= 0
            )
            source_view = (
                columns[0] if name == "baseline" else cv.resize(patched[idx], (cw, ch))
            )
            stats[name]["registered_source_edges"] = source_edge_recall(
                source_view, crop, local >= 0
            )
            columns.append(crop)
        details[frames[idx]["file"]] = stats
        row = np.hstack(columns)
        cv.putText(
            row,
            frames[idx]["file"],
            (6, 24),
            cv.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 0, 0),
            4,
        )
        cv.putText(
            row,
            frames[idx]["file"],
            (6, 24),
            cv.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            1,
        )
        rows.append(row)
    if rows:
        title = np.full((40, cw * 3, 3), 32, "uint8")
        for j, caption in enumerate(
            ["Source photograph", "Previous seam", "Revised seam"]
        ):
            cv.putText(
                title,
                caption,
                (cw * j + 6, 27),
                cv.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                1,
            )
        cv.imwrite(str(output / "view-comparison.jpg"), np.vstack([title, *rows]))
    return details


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("solution", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--inspect", type=int, nargs="*", default=[])
    parser.add_argument(
        "--patches",
        type=Path,
        help="Private folder containing observed-image local warps indexed by source filename",
    )
    parser.add_argument(
        "--corridor-pixels",
        type=int,
        default=0,
        choices=range(33),
        metavar="0..32",
        help="Maximum seam travel on the 1024-wide sphere. Zero allows the entire eligible overlap.",
    )
    parser.add_argument(
        "--protected-regions",
        type=Path,
        help="Private JSON array of observed source polygons "
        "(source filename and x/y polygon vertices in the 480 by 640 diagnostic plane)",
    )
    args = parser.parse_args()
    if args.out.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError("Output must be outside the repository")
    args.out.mkdir(exist_ok=True, parents=True)
    frames, *camera = load_sources(args.archive, args.solution)
    views = list(layers(*camera, 1024))
    shape = views[0][1].shape
    best = np.maximum.reduce([v[1] for v in views])
    cut = original_graphcut(views, best)
    initial = score_owners(views, cut)
    rows = int(np.ceil(shape[0] * 160 / 180 - 0.5))
    patched = list(camera[0])
    applied = []
    if args.patches:
        found = False
        for i, f in enumerate(frames):
            for ext in [".png", ".jpg"]:
                name = Path(f["file"]).stem + ext
                path = args.patches / name
                if path.is_file():
                    found = True
                    image = cv.imread(str(path))
                    if image is None or image.shape != patched[i].shape:
                        raise ValueError(
                            "Patch geometry differs from the original camera plane"
                        )
                    if not np.array_equal(patched[i], image):
                        applied.append(f["file"])
                    patched[i] = image
                    break
        if not found:
            raise ValueError("No local warps supplied")
        views = list(layers(patched, *camera[1:], 1024))
    guards = None
    protected_area = []
    if args.protected_regions:
        regions = json.loads(args.protected_regions.read_text())
        guards, protected_area = protected_owners(
            regions, frames, camera, shape[1], rows
        )
    improved = refine(
        [(im[:rows], weights[:rows]) for im, weights in views],
        initial[:rows],
        args.corridor_pixels,
        protected=guards,
    )
    seg = np.pad(improved, ((0, shape[0] - rows), (0, 0)), mode="edge")
    del views
    result = []
    owners = []
    for inputs, policy in [
        (camera[0], cut),
        (patched, [(seg == i).astype("uint8") * 255 for i in range(len(frames))]),
    ]:
        h, w = 1024, 2048
        label = np.full((h, w), -1, "int16")
        best = np.full((h, w), -1.0, "float32")
        rgb = np.zeros((h, w, 3), "uint8")
        for i, ((im, weight), mask) in enumerate(
            zip(layers(inputs, *camera[1:], w), policy)
        ):
            score = (
                weight + cv.resize(mask, (w, h), interpolation=cv.INTER_NEAREST) / 255
            )
            keep = (weight > 0) & (score > best)
            label[keep] = i
            rgb[keep] = im[keep]
            best[keep] = score[keep]
        start = int(np.ceil(h * 160 / 180 - 0.5))
        if np.any(label[:start] < 0):
            raise ValueError("Projected coverage is incomplete")
        rgb[start:] = 42
        result.append(rgb)
        owners.append(label[:start])
    metrics = {}
    for name, img, own in zip(("baseline", "refined"), result, owners):
        metrics[name] = characteristics(img[: own.shape[0]], own)
        owned = {
            f["file"]: int(np.count_nonzero(own == i)) for i, f in enumerate(frames)
        }
        metrics[name]["visible_pixels"] = owned
        if not all(owned.values()):
            raise ValueError("An input frame disappeared")
    for name, img in zip(("baseline", "refined"), result):
        if not cv.imwrite(str(args.out / (name + ".jpg")), img):
            raise OSError("Could not save diagnostic image")
    metrics["views"] = inspection(
        frames, camera, patched, result, owners, args.inspect, args.out
    )
    metrics["patched_sources"] = applied
    metrics["corridor_pixels"] = args.corridor_pixels
    if guards is not None:
        _final_h, final_w = result[1].shape[:2]
        visible_h = owners[1].shape[0]
        final_guards, _ = protected_owners(regions, frames, camera, final_w, visible_h)
        protected_pixels = final_guards >= 0
        metrics["protected_regions"] = protected_area
        # A nearest-resized working mask can differ by one final pixel at its boundary.
        mismatches = protected_pixels & (owners[1] != final_guards)
        metrics["protected_pixels_final"] = int(protected_pixels.sum())
        metrics["protected_boundary_mismatches"] = int(mismatches.sum())
        deep = cv.erode(protected_pixels.astype("uint8"), np.ones((5, 5), "uint8"))
        if np.any(mismatches & (deep > 0)) or not np.all(result[1][visible_h:] == 42):
            raise ValueError(
                "Final sources or omitted floor policy differ from the guarded input"
            )
    (args.out / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print(
        {
            k: {a: b for a, b in v.items() if a != "visible_pixels"}
            for k, v in metrics.items()
            if k in ["baseline", "refined"]
        }
    )


if __name__ == "__main__":
    main()
