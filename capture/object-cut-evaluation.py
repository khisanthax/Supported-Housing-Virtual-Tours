"""Local evaluation of object-protected graph cuts on the 38-photo Hugin reference."""
import argparse
import json
import runpy
import time
from pathlib import Path

import cv2 as cv
import numpy as np
import psutil
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import breadth_first_order, maximum_flow


def cut(base, source, valid, seed):
    # Periodic longitude avoids treating the left edge of the panorama as a seam.
    h, w = valid.shape
    size = (w//4,h//4)
    small = lambda a: cv.resize(a, size, interpolation=cv.INTER_AREA)
    a, b = small(base).astype(float), small(source).astype(float)
    cost = 1 + np.mean(np.abs(a-b),axis=2)
    mask = small(valid.astype(np.float32)) > .999
    inner = (small(seed.astype(np.float32)) > .1) & mask
    idx = np.arange(mask.size).reshape(mask.shape)
    start, end = idx.size, idx.size+1
    rows, cols, caps = [], [], []
    def arcs(i,j,k):
        rows.append(i.ravel())
        cols.append(j.ravel())
        caps.append(k.ravel())
    for i,j,k in [(idx,np.roll(idx,-1,axis=1),cost+np.roll(cost,-1,axis=1)),
                  (idx[:-1],idx[1:],cost[:-1]+cost[1:])]:
        cap = np.round(k*4).astype(int)
        arcs(i,j,cap)
        arcs(j,i,cap)
    for i,j in [(np.full(inner.sum(),start),idx[inner]),(idx[~mask],np.full((~mask).sum(),end))]:
        arcs(i,j,np.full(i.size,1000000))
    # Gently penalize growth away from the marked object when seams have similar cost.
    arcs(idx,np.full(idx.shape,end),np.ones(idx.shape,int))
    graph = coo_matrix((np.concatenate(caps),(np.concatenate(rows),np.concatenate(cols))),
                       shape=(end+1,end+1)).tocsr()
    flow = maximum_flow(graph,start,end)
    residual = graph-flow.flow
    residual.eliminate_zeros()
    reached = breadth_first_order(residual,start,return_predecessors=False)
    chosen = np.zeros(end+1,np.uint8)
    chosen[reached] = 255
    return (cv.resize(chosen[:idx.size].reshape(idx.shape),(w,h),interpolation=cv.INTER_NEAREST)>0) & valid


def level_patch_colors(composite, reference, owner):
    """Screened gradient-domain correction with periodic longitude and reflected poles."""
    from scipy.fft import rfft2, irfft2
    rgb = composite.astype(np.float32)
    ref = reference.astype(np.float32)
    divergence = np.zeros_like(rgb)
    for axis in (0, 1):
        boundary = owner != np.roll(owner,-1,axis=axis)
        if axis == 0:
            boundary[-1] = False
        difference = ref-rgb
        gradient = (np.roll(difference,-1,axis=axis)-difference)*boundary[:,:,None]
        divergence += np.roll(gradient,1,axis=axis)-gradient
    h,w = owner.shape
    denominator = .001 + 4*np.sin(np.pi*np.fft.fftfreq(2*h))[:,None]**2 + 4*np.sin(np.pi*np.fft.rfftfreq(w))[None,:]**2
    for channel in range(3):
        rhs = divergence[:,:,channel]
        correction = irfft2(rfft2(np.vstack((rhs,rhs[::-1])))/denominator)[:h]
        rgb[:,:,channel] += correction
    return np.clip(rgb,0,255).astype(np.uint8)


def evaluate(folder, level, wire):
    start = time.perf_counter()
    project = folder/"hugin-guided"
    reference = cv.imread(str(project/"watershed.tif"),cv.IMREAD_COLOR)
    result = reference.copy()
    h,w = result.shape[:2]
    coords = np.loadtxt(project/"mapped.txt",dtype=np.float32).reshape(4,384,288,2)
    owner = np.zeros((h,w),np.uint8)
    # Seed polygons traced on reduced original views. #16 and #20 observe the same light.
    polygons = {14:[(57,201),(157,144),(252,182),(252,216),(111,299),(49,268)],
                16:[(0,9),(35,5),(287,227),(287,309),(0,76)],
                35:[(84,0),(229,0),(229,92),(210,161),(282,190),(287,310),(249,355),
                    (175,354),(126,299),(101,238),(84,160),(72,90)]}
    if wire:
        polygons[20] = [(44,0),(143,0),(248,255),(278,383),(246,383),(195,267)]
    for c,n in zip(coords,[14,16,20,35]):
        if n not in polygons:
            continue
        local = np.zeros(c.shape[:2],np.uint8)
        cv.fillPoly(local,[np.array(polygons[n],np.int32)],1)
        xy = np.rint(c[local>0]).astype(int)
        seed = np.zeros((h,w),np.uint8)
        seed[xy[:,1].clip(0,h-1),xy[:,0]%w] = 1
        seed = cv.dilate(seed,np.ones((9,9),np.uint8))
        with Image.open(project/f"tile{n-1:04d}.tif") as im:
            x,y = [round(float(im.tag_v2.get(k,0))*float(im.tag_v2.get(r,1)))
                   for k,r in [(286,282),(287,283)]]
            rgba = np.array(im.convert("RGBA"))
        th,tw = rgba.shape[:2]
        src = np.zeros_like(reference)
        src[y:y+th,x:x+tw] = cv.cvtColor(rgba,cv.COLOR_RGBA2BGR)
        valid = np.zeros((h,w),np.uint8)
        valid[y:y+th,x:x+tw] = rgba[:,:,3]==255
        pick = cut(result,src,valid.astype(bool),seed)
        result[pick] = src[pick]
        owner[pick] = n
    if level:
        result = level_patch_colors(result,reference,owner)
    out = folder/("object-cut-leveled" if level else "object-cut")
    if wire:
        out = out.with_name(out.name+"-wire")
    out.mkdir(exist_ok=True)
    cv.imwrite(str(out/"sphere.png"),result)
    cv.imwrite(str(out/"patch-ownership.png"),owner)
    review = result.copy()
    review[910:] = 42
    cv.imwrite(str(out/"review.jpg"),review)
    metric = runpy.run_path(str(Path(__file__).with_name("seam-refinement.py")))["source_edge_recall"]
    rows, edges = [], {}
    for c,n in zip(coords,[14,16,20,35]):
        src = cv.resize(cv.imread(str(folder/f"frame-{n:02d}.jpg")),(288,384))
        crops = [cv.remap(p,c,None,cv.INTER_LINEAR,borderMode=cv.BORDER_WRAP) for p in (reference,result)]
        edges[n] = metric(src,crops[1],(c[:,:,1]>=0)&(c[:,:,1]<910))
        rows.append(np.hstack((src,*crops)))
    header = np.zeros((35,864,3),np.uint8)
    for i,name in enumerate(["Source photograph","Best Hugin","Object-protected cut"]):
        cv.putText(header,name,(288*i+5,24),cv.FONT_HERSHEY_SIMPLEX,.6,(255,255,255),1)
    sheet = np.vstack((header,*rows))
    cv.imwrite(str(out/"original-hugin-trial.jpg"),sheet)
    cv.imwrite(str(out/"overview.jpg"),cv.resize(sheet,None,fx=.7,fy=.7))
    stats = dict(seconds=time.perf_counter()-start,peakMiB=psutil.Process().memory_info().peak_wset/2**20,
                 pixels={int(n):int((owner==n).sum()) for n in np.unique(owner)},edges=edges)
    (out/"metrics.json").write_text(json.dumps(stats,indent=2))
    print(stats)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private",type=Path)
    parser.add_argument("--level",action="store_true")
    parser.add_argument("--wire",action="store_true")
    args = parser.parse_args()
    if args.private.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError("Keep private data outside Git")
    evaluate(args.private.resolve(),args.level,args.wire)
