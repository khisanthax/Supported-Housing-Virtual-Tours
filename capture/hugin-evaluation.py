"""Measure Hugin's actual TIFF footprint and map selected views with pano_trafo."""

import argparse
import json
import re
import runpy
from pathlib import Path

import cv2 as cv
import numpy as np
from PIL import Image
from scipy.sparse.csgraph import connected_components

parser = argparse.ArgumentParser()
parser.add_argument("private", type=Path)
parser.add_argument("--coordinates", action="store_true")
parser.add_argument("--augmented", action="store_true")
parser.add_argument("--project", type=Path)
parser.add_argument("--watershed", action="store_true")
args = parser.parse_args()
folder = args.private.resolve()
if folder.is_relative_to(Path(__file__).resolve().parents[1]):
    raise ValueError("Use the private replay folder")
numbers = [14, 16, 20, 35]
w, h = 288, 384
if args.coordinates:
    with (folder / "probe-coordinates.txt").open("w") as f:
        for n in numbers:
            with Image.open(folder / f"frame-{n:02d}.jpg") as im:
                iw, ih = im.size
            y, x = np.indices((h, w))
            coordinates = np.stack(
                [
                    np.full(x.shape, n - 1),
                    (x + 0.5) * iw / w - 0.5,
                    (y + 0.5) * ih / h - 0.5,
                ],
                axis=-1,
            )
            np.savetxt(f, coordinates.reshape(-1, 3), fmt=("%d", "%.4f", "%.4f"))
    raise SystemExit()
work = (
    folder / args.project
    if args.project
    else (folder / "augmented" if args.augmented else folder)
)
if not work.resolve().is_relative_to(folder) or work.resolve().is_relative_to(
    Path(__file__).resolve().parents[1]
):
    raise ValueError("Project outputs must stay in the private replay folder")
lines = (work / "optimized.pto").read_text().splitlines()
adj = np.zeros((38, 38), bool)
for line in lines:
    match = re.match(r"c n(\d+) N(\d+) ", line)
    if match:
        adj[tuple(map(int, match.groups()))] = True
_, labels = connected_components(adj, directed=False)
stem = "watershed" if args.watershed else "hugin"
with Image.open(work / (stem + ".tif")) as im:
    if "A" not in im.getbands() or im.size != (2048, 1024):
        raise ValueError(
            f"Expected alpha and full sphere canvas, got {im.mode} {im.size}"
        )
    rgba = np.asarray(im.convert("RGBA"))
valid = rgba[:, :, 3] > 0
row_area = np.sin(np.pi * (np.arange(1024) + 0.5) / 1024)
report = {
    "components": np.bincount(labels).tolist(),
    "outsideLargest": (
        1 + np.flatnonzero(labels != np.bincount(labels).argmax())
    ).tolist(),
    "sphereCoverage": np.average(valid.mean(1), weights=row_area),
    "aboveCapCoverage": np.average(valid[:910].mean(1), weights=row_area[:910]),
    "remappedLayers": len(list(work.glob("tile*.tif"))),
}
pan = cv.cvtColor(rgba, cv.COLOR_RGBA2BGR)
height, width = valid.shape
# A blended source is directly identifiable where it alone matches a textured
# local patch. This is a conservative lower bound; visually identical sources
# and heavily blended patches remain unattributed.
best = np.full(valid.shape, np.inf, np.float32)
second = best.copy()
owner = np.full(valid.shape, -1, np.int16)
gray = cv.cvtColor(pan, cv.COLOR_BGR2GRAY).astype(np.float32)
texture = cv.boxFilter(gray**2, -1, (9, 9)) - cv.boxFilter(gray, -1, (9, 9)) ** 2
for tile in sorted(work.glob("tile*.tif")):
    index = int(tile.stem[4:])
    with Image.open(tile) as layer:
        x = round(float(layer.tag_v2.get(286, 0)) * float(layer.tag_v2.get(282, 1)))
        y = round(float(layer.tag_v2.get(287, 0)) * float(layer.tag_v2.get(283, 1)))
        sample = np.array(layer.convert("RGBA"))
    th, tw = sample.shape[:2]
    section = np.s_[y : y + th, x : x + tw]
    observed = cv.erode(sample[:, :, 3], np.ones((9, 9), np.uint8)) == 255
    difference = sample[:, :, :3].astype(np.float32) - rgba[section][:, :, :3]
    rms = np.sqrt(cv.boxFilter(np.mean(difference**2, axis=2), -1, (9, 9)))
    rms[~observed] = np.inf
    closer = rms < best[section]
    second[section] = np.minimum(second[section], np.maximum(rms, best[section]))
    best[section][closer] = rms[closer]
    owner[section][closer] = index
confident = (best < 8) & (second > best + 5) & (texture > 150) & valid
confident[910:] = False
report["distinctTexturedPixels"] = np.bincount(owner[confident], minlength=38).tolist()
pan[~valid] = (80, 0, 100)
pan[910:] = 42
cv.imwrite(str(work / (stem + "-review.jpg")), pan)
coords = np.loadtxt(work / "mapped.txt", dtype=np.float32).reshape(
    len(numbers), h, w, 2
)
prior = cv.imread(str(folder / "view-comparison.jpg"))
rows = []
metrics = runpy.run_path(str(Path(__file__).with_name("seam-refinement.py")))
report["sourceEdges"] = {}
for j, n in enumerate(numbers):
    u, v = coords[j, :, :, 0].copy(), coords[j, :, :, 1].copy()
    rendered = cv.remap(pan, u, v, cv.INTER_LINEAR, borderMode=cv.BORDER_WRAP)
    original = cv.resize(cv.imread(str(folder / f"frame-{n:02d}.jpg")), (w, h))
    overlaps = (
        (v >= 0)
        & (v < 910)
        & (
            cv.remap(
                valid.astype(np.uint8),
                u,
                v,
                cv.INTER_NEAREST,
                borderMode=cv.BORDER_WRAP,
            )
            > 0
        )
    )
    report["sourceEdges"][n] = metrics["source_edge_recall"](
        original, rendered, overlaps
    )
    rows.append(
        np.hstack(
            [
                original,
                prior[40 + j * h : 40 + (j + 1) * h, w : 2 * w],
                prior[40 + j * h : 40 + (j + 1) * h, 2 * w :],
                rendered,
            ]
        )
    )
header = np.full((40, w * 4, 3), 32, np.uint8)
for j, label in enumerate(
    [
        "Original",
        "PR 50 seam",
        "OpenCV multiband",
        "Hugin + " + ("watershed" if args.watershed else "Enblend"),
    ]
):
    cv.putText(
        header,
        label,
        (j * w + 7, 26),
        cv.FONT_HERSHEY_SIMPLEX,
        0.65,
        (255, 255, 255),
        1,
    )
cv.imwrite(str(work / (stem + "-comparison.jpg")), np.vstack([header, *rows]))
(work / (stem + ".json")).write_text(json.dumps(report, indent=2))
print(report)
