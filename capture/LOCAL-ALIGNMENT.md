# Ceiling fixture and chair alignment

This experiment continues the recorded-direction replay at `51d04b8`. It uses the same 38 original room views, saved camera solution and photographed area. The capture archive also retains the deliberately omitted straight-down photograph. Every full-room comparison uses the same 2048 × 1024 output size and the existing neutral bottom cap.

## What the photographs establish

**Overhead light, #20.** Sparse matching finds texture near the fixture that can belong to another surface. After identifying the same strip light in the original views, the probe detects its two illuminated sides and finite end and tests corresponding rays against the recorded directions. It permits a local correction only when exactly one end pairing is supported. The surrounding mesh stays anchored and rejects flipped triangles. View #16 supplies the reference. The mesh rejects #14 and accepts #15 and #20. The apparent local correction in #20 is 14.4°. That value describes what a local rotation model needs to align the image, not how far the phone physically rolled.

The following measurements are mean absolute displacements of the two visible strip edges at transverse sections of the 480 × 640 reference image. Each measurement requires a complete bright segment with photographed pixels on both sides. A missing transition receives no score.

| Distance along strip from its end | #20 before | #20 after | #15 before | #15 after |
| --- | ---: | ---: | ---: | ---: |
| 50 px | 68.0 px | 5.5 px | 49.0 px | 5.5 px |
| 100 px | 67.5 px | 12.5 px | 47.5 px | 9.0 px |
| 150 px | 67.0 px | 18.0 px | 46.0 px | 15.0 px |
| 200 px | 66.0 px | 23.5 px | 44.0 px | 19.5 px |

The illuminated end aligns much better. The remaining divergence is visible along the strip. An additional trial constrained the long side lines. Its #20 error at 200 px rose to 59.5 px, so the full-room comparison uses the end-fitting correction only. Neither fit proves a whole-camera pose for #20.

**Chair, #35 against #36.** Four corresponding upholstery junctions were marked in the two views. Each error below is measured at these same visible features on a 480 × 640 plane.

| Transformation | Cushion landmark RMS |
| --- | ---: |
| Saved camera solution | 79.61 px |
| Rotation from matched features in the overlap | 35.47 px |
| Local correction from neighboring matched features | 28.17 px |
| Image-intensity fit inside a manually outlined cushion region | 5.05 px |

The last fit omits a 24 px neighborhood around each evaluation mark in the target. The corresponding source landmark positions are used only for scoring. The largest remaining landmark error is 8.21 px. This is evidence for one marked surface in two photographs. It does not establish how to segment furniture automatically or validate the arm and floor.

A rotation fitted to 70 carpet matches has median residuals of 3.47 px on the carpet and 33.10 px on the cushion. A rotation fitted to the four cushion marks leaves a 40.42 px median on those carpet features. This difference is consistent with handheld parallax. A single rotation cannot explain both surfaces well with these intrinsics. These images do not identify the exact translation, lens model, shutter timing or possible scene motion.

## What survives a whole-room render

The full-room candidate applies the two observed fixture warps and lets the seam move up to seven pixels from the previous boundary on a 1024-pixel-wide working sphere. It uses the original unwarped chair photographs. The optimizer compares color and gradient disagreement including across the longitude wrap. It keeps a core of each contributing view. Both renders include all 38 source views and every pixel above the cap has source support.

| Measure | Prior graph-cut render | Bounded seam and fixture correction |
| --- | ---: | ---: |
| 90th percentile RGB jump across source boundaries, 0–255 | 94.80 | 52.34 |
| Neighboring pixel pairs across boundaries with jump above 40 | 6,620 of 19,666 | 2,955 of 18,888 |
| 90th percentile jump across longitude wrap | 89.14 | 9.35 |
| Oriented source-edge recovery in #14 | 49.2% | 52.2% |
| Oriented source-edge recovery in #16 | 37.8% | 48.7% |
| Oriented source-edge recovery in #20 | 31.7% | 26.4% |
| Oriented source-edge recovery in #35 | 48.8% | 48.4% |

The jump metric measures local color change across a seam. The edge check compares a registered source crop with the decoded panorama crop, allowing 3 px of displacement and 22.5° of edge-direction difference. Some source edges may be occluded in other views. Direct inspection still shows a kink in the strip, a displaced chair arm and a cut across the seat. Unrestricted seam movement also broke the vent outline in #14. A lower overall seam score is insufficient for acceptance.

**Keeping a whole object in one photograph.** A final trial manually protected the observed lamp body in #16 and chair seat/control in #35. This gives both objects a continuous outline from those directions, but the break moves into the neighboring ceiling and furniture. Sharp boundary jumps rise from 2,955 to 3,848. Before JPEG encoding, edge recovery for #35 rises from 48.0% to 76.2%, while registered #20 falls from 26.1% to 16.6%. The cap and all 38 contributors are preserved. The protected-region trial is also unsuitable for the browser stitcher.

## Capture guidance

The prototype already displays an orientation reference and a live roll indicator, including at the poles. Automatic capture requires fresh sensor input, aim within 4°, roll within 8°, full rotation within 9° and an 800 ms hold. Replaying the 38 saved orientations reproduces the stored camera axes. Maximum absolute roll was 3.56°. The overhead light measured −0.81° and the chair −1.95°. Their full orientation errors were 0.82° and 1.95°, respectively. Neither shows a large sideways rotation at the recorded exposure. Roll checks cannot measure a sideways shift of the lens, and the archive cannot independently establish sensor-to-exposure synchronization. There is no basis here for tightening the capture threshold.

## Reproducing the comparison privately

Use native Python, NumPy, SciPy and OpenCV with SIFT and the stitching detail module. The tools run on the workstation. Keep the original archive, annotations, camera solution, generated PNGs, comparisons and all output folders outside the checkout. Supply the camera solution from the same ordered set of views.

```text
python capture/pose-overlap-reference.py SOURCES.zip REFERENCE
python capture/local-alignment-probe.py SOURCES.zip REFERENCE/cameras.npz PAIRS --targets 20 35 --landmarks PRIVATE_CHAIR_MARKS.json
python capture/fixture-anchor-probe.py SOURCES.zip REFERENCE/cameras.npz FIXTURE --anchor 16 --views 14 15 20 --section-line 57 117 390 305
python capture/seam-refinement.py SOURCES.zip REFERENCE/cameras.npz SEAMS --patches FIXTURE --corridor-pixels 7 --inspect 14 16 20 35
python capture/test-fixture-anchor.py
```

The first step is unnecessary when the earlier camera solution is available. The optional private chair annotation describes four approximate corresponding junctions, a background polygon and the cushion fitting region. Omitting it runs the feature-based pair comparison alone. The section line is the manually located fixture axis in view #16. The PNG patches and pair overlays are diagnostic derivatives. The original JPEGs remain available for another reconstruction.

To replay the final single-source trial, repeat the seam command with a different output folder and `--protected-regions PRIVATE_REGIONS.json`. Each entry in the JSON array identifies a source photograph and a polygon in its 480 × 640 diagnostic image. These manual regions are evaluation inputs, not an automatic object detector.

These native workbench tools are outside the browser capture build. The browser matcher at the starting commit verified 36 of 38 frames and withheld a complete panorama. The local comparisons do not qualify a new browser stitch or a Fold release.
