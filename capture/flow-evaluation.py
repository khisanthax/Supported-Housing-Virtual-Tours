"""Private experiment: register Hugin layers to its watershed composite before source selection."""
import argparse
import json
import runpy
import time
from pathlib import Path

import cv2 as cv
import numpy as np
import psutil
from PIL import Image


def evaluate(folder, method):
    start = time.perf_counter()
    project = folder / "hugin-guided"
    reference = cv.imread(str(project / "watershed.tif"), cv.IMREAD_COLOR)
    height, width = reference.shape[:2]
    result = np.zeros_like(reference)
    owner = np.zeros((height, width), np.uint8)
    scores = np.full(owner.shape, -1, np.float32)
    dis = cv.DISOpticalFlow_create(cv.DISOPTICAL_FLOW_PRESET_MEDIUM)
    for tile in sorted(project.glob("tile*.tif")):
        n = int(tile.stem[4:]) + 1
        with Image.open(tile) as im:
            x, y = [round(float(im.tag_v2.get(k, 0)) * float(im.tag_v2.get(r, 1)))
                    for k, r in [(286, 282), (287, 283)]]
            rgba = np.array(im.convert("RGBA"))
        h, w = rgba.shape[:2]
        area = np.s_[y:y+h, x:x+w]
        support = (rgba[:, :, 3] == 255).astype(np.uint8)
        distance = cv.distanceTransform(cv.copyMakeBorder(support, 1, 1, 1, 1, cv.BORDER_CONSTANT),
                                        cv.DIST_L2, 5)[1:-1, 1:-1]
        photo = cv.cvtColor(rgba, cv.COLOR_RGBA2BGR)
        if method != "control":
            gray = cv.cvtColor(reference[area], cv.COLOR_BGR2GRAY)
            moving = np.where(support, cv.cvtColor(photo, cv.COLOR_BGR2GRAY), gray)
            size = (max(16, w//3), max(16, h//3))
            a, b = [cv.resize(k, size, interpolation=cv.INTER_AREA) for k in (gray, moving)]
            if method == "dis":
                flow = dis.calc(a, b, None)
            else:
                from skimage.registration import optical_flow_tvl1
                v, u = optical_flow_tvl1(a, b, num_warp=5, num_iter=10)
                flow = np.dstack((u, v))
            delta = cv.resize(flow, (w,h)) * np.array([w/size[0], h/size[1]], np.float32)
            delta *= np.minimum(1, distance / 24)[:, :, None]
            yy, xx = np.indices((h,w), dtype=np.float32)
            u, v = xx + delta[:,:,0], yy + delta[:,:,1]
            jac = np.gradient(u, axis=1)*np.gradient(v, axis=0)-np.gradient(u, axis=0)*np.gradient(v, axis=1)
            ok = ((jac > .25) & (jac < 4) & (np.linalg.norm(delta, axis=2) <= 55)
                  & (cv.remap(support.astype(np.float32), u, v, cv.INTER_LINEAR) == 1))
            photo = cv.remap(photo, np.where(ok,u,xx), np.where(ok,v,yy), cv.INTER_LINEAR)
        # Identical ownership in all three trials. Prefer interior pixels of fixture/chair sources.
        quality = distance * (1.5 if n in (16,35) else 1.)
        take = support.astype(bool) & (quality > scores[area])
        scores[area][take] = quality[take]
        result[area][take] = photo[take]
        owner[area][take] = n
    valid = owner > 0
    weight = np.sin(np.pi*(np.arange(height)+.5)/height)
    report = dict(seconds=time.perf_counter()-start, coverage=np.average(valid.mean(1), weights=weight),
                  aboveCapCoverage=np.average(valid[:910].mean(1), weights=weight[:910]),
                  ownedPixelsAboveCap=np.bincount(owner[:910].ravel(), minlength=39)[1:].tolist())
    out = folder / ("flow-" + method)
    out.mkdir(exist_ok=True)
    cv.imwrite(str(out/"sphere.png"), result)
    cv.imwrite(str(out/"ownership.png"), owner)
    result[910:] = 42
    cv.imwrite(str(out/"review.jpg"), result)
    coords = np.loadtxt(project/"mapped.txt", dtype=np.float32).reshape(4,384,288,2)
    metric = runpy.run_path(str(Path(__file__).with_name("seam-refinement.py")))["source_edge_recall"]
    rows = []
    report["edges"] = {}
    for c, n in zip(coords,[14,16,20,35]):
        src = cv.resize(cv.imread(str(folder/f"frame-{n:02d}.jpg")), (288,384))
        images = [cv.remap(img, c, None, cv.INTER_LINEAR, borderMode=cv.BORDER_WRAP) for img in (reference,result)]
        report["edges"][n] = metric(src,images[1],(c[:,:,1]>=0)&(c[:,:,1]<910))
        rows.append(np.hstack([src,*images]))
    cv.imwrite(str(out/"original-hugin-trial.jpg"), np.vstack(rows))
    report["peakProcessMiB"] = psutil.Process().memory_info().peak_wset / 2**20
    (out/"metrics.json").write_text(json.dumps(report,indent=2))
    print(method,report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private", type=Path)
    parser.add_argument("method", choices=["dis","tvl1","control"])
    args = parser.parse_args()
    if args.private.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError("Keep private images outside the repository")
    cv.setNumThreads(2)
    evaluate(args.private.resolve(), args.method)
