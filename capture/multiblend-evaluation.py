"""Benchmark the standalone Multiblend executable with the fixed private Hugin layers."""
import argparse
import json
import subprocess
import time
from pathlib import Path

import numpy as np
import psutil
from PIL import Image


def benchmark(folder, executable):
    project = folder / "hugin-guided"
    out = folder / "multiblend"
    out.mkdir(exist_ok=True)
    inputs = []
    for tile in sorted(project.glob("tile*.tif")):
        with Image.open(tile) as layer:
            x, y = [round(float(layer.tag_v2.get(k,0))*float(layer.tag_v2.get(r,1)))
                    for k,r in [(286,282),(287,283)]]
            filename = out / (tile.stem + ".png")
            # No lossy conversion. Explicitly pass TIFF offsets to the PNG reader.
            layer.convert("RGBA").save(filename, compress_level=1)
            inputs.extend([str(filename),f"{x},{y}"])
    command = [str(executable),"--wrap=horizontal","--save-seams",str(out/"owners.png"),
               "-o",str(out/"sphere.tif"),*inputs]
    start = time.perf_counter()
    with (out/"run.log").open("w") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        metrics = psutil.Process(process.pid)
        peak = 0
        while process.poll() is None:
            try:
                peak = max(peak,metrics.memory_info().peak_wset)
            except psutil.NoSuchProcess:
                break
            time.sleep(.005)
        if process.wait():
            raise RuntimeError("Multiblend failed; inspect the private run log")
    elapsed = time.perf_counter()-start
    with Image.open(out/"owners.png") as labels:
        owners = np.unique(np.array(labels)[:910]).tolist()
    with Image.open(out/"sphere.tif") as im:
        assert im.size == (2048,1024)
        im.convert("RGB").save(out/"sphere.png")
    stats = dict(seconds=elapsed,peakMiB=peak/2**20,seamLabelsAboveCap=owners)
    (out/"metrics.json").write_text(json.dumps(stats,indent=2))
    print(stats)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private",type=Path)
    parser.add_argument("executable",type=Path)
    args = parser.parse_args()
    if args.private.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError("Keep private data outside Git")
    benchmark(args.private.resolve(),args.executable.resolve())
