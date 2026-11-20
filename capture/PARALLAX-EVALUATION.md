# Local parallax and seam experiments · 20 November 2026

## Result

A manually protected seam recovers a coherent chair, including the seat and back, and removes the extra bright tip from the strip light in view 16. It leaves a gap where the cord meets the light. A second cut that protects the cord from view 20 connects it, but splits the fixture farther along its length. The ceiling panels and background furniture still have discontinuities. Neither complete panorama passes room-wide visual review.

## Controlled comparison

All 38 staged JPEGs matched the original private ZIP by SHA-256. Each trial used the same Hugin camera solution, metadata, remapped layers and 2048 × 1024 canvas as the [previous comparison](ENGINE-EVALUATION.md). Changing the seam or local deformation alone isolates the effect after camera alignment. No photo was synthesized. The straight-down exposure was absent. The original footprint test covered every sphere pixel with at least one real sample. Oblique views supply the nadir. This verifies coverage in the fitted geometry. It cannot establish the correct physical location of a surface.

| Additional desktop processing after Hugin | Time | Peak working set | Visual result |
| --- | ---: | ---: | --- |
| Multiblend 2.0rc5 horizontal wrap | 1.37 s | 89 MiB | Finished the sphere. Ghosted ceiling, broken chair and duplicated floor detail. 32 distinct labels above the cap in its seam map. Blending can also use neighbors. |
| Same source-selection control without flow | 1.74 s | 149 MiB | Stronger individual chair edges, conspicuous cuts between exposures. |
| OpenCV dense inverse search (DIS) | 7.64 s | 226 MiB | Warps follow some contours but leave the chair split. |
| scikit-image TV-L1 | 77.38 s | 240 MiB | Fixture and chair boundaries tear where incompatible sources meet. |
| Object-protected min-cut | 1.00 s | 167 MiB | Best chair geometry; discontinuous illumination and disconnected cord. |
| Same cut with screened gradient-domain leveling | 1.49 s | 385 MiB | Preferred full render for review. Reduces brightness steps while retaining chair geometry. |
| Leveled cut also protecting view 20 | 1.59 s | 385 MiB | Reattaches the cord, splits the light in view 16. |

One run per configuration. DIS/TV-L1/control elapsed covers compositing; their peak includes analysis and export. Object-cut figures include image output and comparison generation. Multiblend numbers cover the executable only, sampled at 5 ms. Its TIFF reader emitted row warnings on polar tiles, so the reported run uses lossless RGBA PNG inputs with original TIFF offsets. Hugin preprocessing was reused, including the 282.6 s matching stage and 770 MiB peak from the earlier experiment. No phone performance measurements.

| Fraction of source edges recovered within 3 pixels | Vent 14 | Light 16 | Light 20 | Chair 35 |
| --- | ---: | ---: | ---: | ---: |
| Hugin watershed | 59.8% | 52.9% | 25.7% | 50.3% |
| Protected and leveled | 62.6% | 63.2% | 27.7% | 87.6% |
| Also protect wire in 20 | 59.5% | 37.8% | 72.7% | 87.6% |

These scores favor a source deliberately chosen to own its object. The decisive comparison is whether the cable, furniture and surrounding room geometry survive together. The same 38 layers went into all three flow/control trials. Their identical selection masks used 37 above the cap, with zero owned pixels from 20. The preferred object-cut panorama retains 82.5% of the baseline pixel selections. Applying the earlier distinct-texture test to its final RGB image identifies contributions from at least 33/38 above the cap. Frames 15, 19, 20, 31 and 38 could not be individually attributed by that test. The full uncapped PNG, original/Hugin/trial crop sheets, capped preview, ownership masks and metrics stay in the local private evaluation folder.

## Algorithms, licenses and browser prospects

- [Multiblend](https://horman.net/multiblend/) provides fast simultaneous seam placement and multilevel blending. The evaluated distribution contains GPLv3 terms. Keep it as an external desktop comparator.
- [Scikit-image TV-L1](https://scikit-image.org/docs/stable/api/skimage.registration.html#skimage.registration.optical_flow_tvl1) and [OpenCV DIS](https://docs.opencv.org/4.x/de/d4f/classcv_1_1DISOpticalFlow.html) were installed or run locally. Both refine bounded image-space displacements against the fixed Hugin reference. A wrong edge in that reference can attract the flow. scikit-image uses a [BSD license](https://scikit-image.org/docs/stable/license.html). Modern OpenCV uses [Apache 2.0](https://opencv.org/license/). A small native/WASM build is plausible for DIS, but its photographic result does not justify a port.
- The object-aware experiment uses independent seed polygons, periodic longitude, [SciPy integer max-flow](https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.csgraph.maximum_flow.html) and optional screened gradient-domain color correction. SciPy's [BSD terms](https://github.com/scipy/scipy/blob/main/LICENSE.txt) permit reuse subject to its notices and bundled dependency terms. A low-resolution cut on an existing alignment is the most promising browser component. Replace the desktop solver with an audited permissive native/WASM solver and measure device memory first. The current manual seeds are specific to the four diagnostic views.
- [Segmentation-guided multi-homography warping](https://github.com/tlliao/multi-homo-warp) and [UDIS++](https://github.com/nie-lang/UDIS2) address local alignment upstream of the seam. The former publishes a MATLAB workflow with segmentation inputs; the latter publishes a learned pairwise warping and composition pipeline. Neither was benchmarked on this sphere. A production port would require checking code and model redistribution rights and enforcing 360-degree loop consistency.

## Replay and next step

With a private replay folder from the Hugin evaluation and its mapped crop coordinates, run the following Windows desktop commands, substituting absolute private paths. The flow experiments need scikit-image for TV-L1. Other dependencies are OpenCV, NumPy, SciPy, Pillow and psutil.

    python capture/multiblend-evaluation.py PRIVATE MULTIBLEND_EXE
    python capture/flow-evaluation.py PRIVATE control
    python capture/flow-evaluation.py PRIVATE dis
    python capture/flow-evaluation.py PRIVATE tvl1
    python capture/object-cut-evaluation.py PRIVATE --level
    python capture/object-cut-evaluation.py PRIVATE --level --wire

For this set, an object-preserving seam is a useful local repair. The different apparent positions of the foreground chair and distant carpet reported in the earlier study explain why one camera rotation cannot register both depths. The two wire experiments directly show the limitation of changing ownership at fixed camera poses. They do not prove a depth-aware offline reconstruction could never work. Before integrating anything into mobile capture, use a controlled fixed-lens-pivot comparison in the same room. For further salvage of this exact set, align the overlapping exposures locally around both fixture endpoints and their background, preserve whole objects when placing seams, and review the entire sphere.
