# Recorded-direction overlap experiment

The private Fold replay used the saved 38 room views. The straight-down frame stayed excluded. All real-image processing ran on the workstation.

## Browser replay

The previous matcher found 76 verified pairs involving 34 of 38 photos. The new fallback reprojects the source into the neighbor's view using the recorded camera axes, stream aspect and field of view. It checks nearby patches for a distinct intensity-correlation peak and searches back to the source. Accepted pairs need at least 12 geometrically consistent matches, at least half of the candidates, and a spread covering at least 0.8% of the image in the destination plane. The search tries both directions. Newly linked frames may anchor remaining views. The fallback is bounded to eight initially unmatched views and checks the ten nearest eligible anchors per round.

| Original source | Browser outcome | Inlier counts by neighbor |
| --- | --- | --- |
| 14, ceiling | Connected to 4 and 19 | 12 and 16 |
| 16, ceiling | Connected to 7 and 6 | 17 and 15 |
| 20, overhead light | Unverified | None passed |
| 35, chair | Unverified | None passed |

The final browser graph covered 36/38. Its complete-tour guard rejected the result before rendering. Neither verified pair counts nor phone directions establish visible seam quality.

## Independent offline visual comparison

The optional native reference uses OpenCV and SciPy. It applies camera-directed patch and SIFT matching, fits rotations and a shared focal scale to image correspondences, and generates diagnostic renders using all source photos. With no evidence for a view, it retains that view's sensor pose for illustration. Run locally using a private output folder outside the checkout:

    python capture/pose-overlap-reference.py PRIVATE_CAPTURE.zip PRIVATE_OUTPUT_FOLDER

This separate experiment formed 72 image pairs. On 656 reserved points, forward reprojection RMS fell from 28.02 to 11.62 pixels on 480 by 640 analysis images. These reserved correspondences came from the same geometrically filtered pairs. They are not independent scene ground truth. Its accepted pairs differ from those of the browser. For example, the chair had only one native link and its three reserved points still had RMS error of 15.19 pixels. This is insufficient to locate the chair confidently.

The reference compared sensor-only blending, corrected blending, single-source selection and a graph-cut seam diagnostic. All 38 views contributed visible pixels in the graph-cut result. Direct inspection of four perspective crops showed split ceiling fixtures and displaced chair edges. The photos support further study of local parallax and seam placement. No full-room photographic pass, phone timing measurement, or deployment of this experiment.

## Stanford comparison

Stanford describes a structured 37-position capture sequence. Its documented WebGL2 renderer projects photos by direction, compensates for exposure, selects a preferred source for much of the sphere and blends in fallback regions. It also fills polar gaps. Stanford reports moving away from an earlier OpenCV.js approach after iOS memory problems. Choosing one source can reduce translucent duplicates while leaving a jump where two misaligned images meet. Our reference used an independent OpenCV graph-cut experiment. We did not run Stanford's app on this private archive.

- [Stanford VFTCam overview](https://vftcam.stanford.edu/)
- [Stanford technical deep dive](https://vftcam.stanford.edu/building-vftcam.html)
