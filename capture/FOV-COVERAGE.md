# Camera FOV and overlap investigation

Verified 2026-11-19. Experimental capture branch only. No phone-model-specific settings or production activation.

## Actual code and photographs

`ui.js` assigns every camera a 65-degree horizontal FOV. `math.js` derives vertical FOV as `2 atan(tan(horizontal/2)/aspect)`. This is a pinhole formula, but its input was never measured. With 3:4 images it assumes about 80.7 degrees vertically. The old planner advances by 65% of these angular fields (35% nominal overlap), producing 25 targets. Landscape 4:3 produces 37. These are our patterns, not Stanford target coordinates.

The supplied ZIP contains all 25 original 960x1280 JPEGs and poses, with no EXIF tags. Neither those files nor browser stream dimensions establish optical FOV. A phone's marketing specification would not establish the effective view after browser lens selection, crop, zoom and stabilization. No Galaxy-specific profile was introduced.

Local native OpenCV 5.0.0 SIFT reference found 24 homography-supported pairs; 19 remained after rejecting median sensor-bearing disagreement above 10 degrees. A robust median-error FOV search suggests 61.5 degrees, reducing median pair error from 3.91 to 2.34 degrees. Individual pair optima span 52.5 to 70.5 degrees; leave-one-pair-out optima span 61.5 to 63.0. These are fitted residuals, not ground truth. Pose error, false matches, distortion and parallax are confounded. **This does not certify 61.5 degrees as the actual FOV.** No automatic substitution was made.

A private copy of the source metadata using 61.5 degrees still gives the browser AKAZE matcher only 10 verified pairs involving 14/25 photographs. It still rejects a complete stitch. Original JPEGs, sessions and ZIP were not changed, uploaded or committed.

Equal-area sampling of the actual saved poses:

| Assumed actual horizontal FOV | Any-image coverage | Area with at least two images |
|---|---:|---:|
| 50 degrees | 100% | 60.96% |
| 55 degrees | 100% | 75.30% |
| 60 degrees | 100% | 88.73% |
| 65 degrees | 100% | 95.54% |

These are geometric sensitivity calculations, not measurements of true optical coverage or matching texture. They explain why reporting 100% coverage did not establish adequate stitching overlap.

## Device-independent changes

New sessions use planner version 2: 40% nominal angular overlap, plus tangent-plane FOV reduced to 85% while unmeasured or 95% following the visual estimate. These margins are engineering assumptions, not measured confidence intervals. At the 65-degree prior this produces 39 targets at 3:4, 53 at 4:3 and 67 at 16:9. At measured 60 degrees and 3:4 it produces 37. Counts follow geometry, not a hardcoded 37.

Existing partial/completed sessions retain targets, poses, FOV, original JPEGs and recovery. Start another capture for the new pattern. Legacy sessions keep a 64-frame bound; new version-2 sessions allow 96, under the unchanged 64 MiB source cap and 4 MiB/frame limit. Framing exceeding the plan bound is rejected rather than silently reducing overlap. Larger-plan phone memory and timing remain unverified.

Optional **Camera setup**, before the first photograph:

1. Start another capture and choose Camera setup. Automatic photography pauses.
2. Keep the camera in one spot at eye level. Centre a small distant stationary detail and press Detail centred.
3. Rotate around the lens until that SAME detail reaches the left marker; confirm.
4. Rotate back until it reaches the right marker; confirm.
5. Live sensor axes and marker positions estimate horizontal FOV. Stale readings, wrong side, excessive height error, unsupported range and disagreement reject the estimate.

No degree entry, model lookup, server call or image upload is used. The result is explicitly a visual/sensor **estimate**, not full intrinsic/distortion calibration. Accuracy depends on careful aiming, distance, minimal translation and sensors. Up to 10% disagreement in tangent scale is allowed; the subsequent planning margin is not a guaranteed optical accuracy bound. With missing sensors the existing manual fallback remains uncalibrated. Setup cannot change sessions containing photographs.

Estimates and plans persist locally and in source ZIP metadata. Reciprocal FOV geometry handles portrait/landscape changes. A best-effort hash of camera label/facing, aspect, zoom and resize mode detects evident stream changes. Browser device IDs are not used because they may change after reopening. Camera labels can be absent/ambiguous; hidden crop, lens and stabilization changes cannot all be detected. Repeat setup in a new session if framing changes. Rotation, camera loss or backgrounding cancels unfinished setup without deleting captures.

## Controlled 25 versus 37 comparison

Same procedural indoor scene, true FOV 60 degrees, portrait 360x480 source images, exact rotation poses, no translation, constant exposure, 1024x512 output at 92%. Different target patterns necessarily give different source views. The independent 37-target reference has 13 level, 11 upper, 11 lower and two pole targets. It is not Stanford's target geometry or a real-room recapture.

| Plan | Photos | Render FOV | Two-image coverage at true FOV | RGB MAE /255 | False-edge proxy | Desktop worker time | JPEG bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| Legacy | 25 | 65 | 88.50% | 21.81 | 16,027 | 0.243 s | 194,061 |
| Independent reference | 37 | 65 | 100% | 21.04 | 9,833 | 0.362 s | 181,798 |
| New unmeasured plan | 39 | 65 | 100% | 20.95 | 11,410 | 0.398 s | 183,869 |
| New plan, correct simulated FOV | 37 | 60 | 100% | 7.07 | 6,046 | 0.414 s | 213,058 |

The edge proxy is not a measured number of duplicated objects. Desktop timings are not phone CPU measurements. About 40 MB is an existing major-allocation estimate, not peak browser/GPU memory. This fixture lacks parallax and sensor errors and is easier than handheld photography.

Insufficient overlap is a plausible contributor to weak matching. More images alone do not fix incorrect projection, drift, translation or feather-blend ghosting. Actual sources still fail feature alignment after the fitted-FOV diagnostic. A genuine denser recapture of the same room and independent optical calibration are needed to establish real-room improvement. Full stitching/hardware acceptance remains open.

## Reproduce and physical gate

- `npm test`: simulated camera geometry, overlap, reciprocal orientation, preserved captures and bounded/revision-protected storage.
- `node capture/calibration-browser-test.mjs`: fake camera/sensors, stale/wrong input, paused auto capture, estimate persistence and preserved legacy sessions.
- `node capture/fov-test.mjs`: procedural comparison and no-upload network checks; outputs go to private temporary storage.
- Optional `python capture/fov-source-reference.py SOURCE.zip PRIVATE_REPORT.json` reproduces the diagnostic fit using separately installed native OpenCV/numpy. It does not upload images or install dependencies.
- Existing guidance/recovery/browser tests cover full capture, retakes, rotation, interruptions, restart/offline, original source bytes and backups.

Physical gate: repeat setup on multiple phones/browsers, capture a static furnished room rotating around the lens, export original sources and inspect alignment/seams. Test portrait/landscape, interruption/resume and folded/unfolded layouts. Preserve old sessions. Simulated sensors do not verify optical FOV, sensor axes, parallax, rolling shutter, stabilization, thermal behavior or memory. No physical phone was available.

## Primary references

Verified 2026-11-19: [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/) defines ordinary track settings without a portable standard FOV/intrinsics field. The older draft depth extension is not evidence ordinary camera tracks implement FOV. [OpenCV camera calibration](https://docs.opencv.org/4.x/d4/d94/tutorial_camera_calibration.html) describes multi-view focal/principal-point/distortion calibration; our visual/sensor estimate does not implement that complete procedure. No Stanford code or protected assets were copied.
