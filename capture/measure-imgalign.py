"""Sample the local Node/Chromium process tree while running the ImgAlign bench."""

import argparse
import json
import subprocess
import time
from pathlib import Path

import psutil

parser = argparse.ArgumentParser()
parser.add_argument("upstream", type=Path)
parser.add_argument("private", type=Path)
args = parser.parse_args()
if args.private.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
    raise ValueError("Keep private output outside the checkout")
start = time.perf_counter()
with (args.private / "imgalign.log").open("w") as log:
    proc = subprocess.Popen(
        [
            "node",
            str(Path(__file__).with_name("imgalign-evaluation.mjs")),
            str(args.upstream),
            str(args.private),
        ],
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    root = psutil.Process(proc.pid)
    peak = 0
    while proc.poll() is None:
        try:
            peak = max(
                peak,
                sum(
                    p.memory_info().rss for p in [root, *root.children(recursive=True)]
                ),
            )
        except psutil.NoSuchProcess:
            pass
        time.sleep(0.1)
report = {
    "peakSampledAggregateRssMiB": peak / 2**20,
    "elapsed": time.perf_counter() - start,
    "exit": proc.returncode,
}
(args.private / "imgalign-process.json").write_text(json.dumps(report, indent=2))
print(report)
raise SystemExit(proc.returncode)
