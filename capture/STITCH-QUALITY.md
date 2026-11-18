# Stitching quality investigation — 18 November 2026

**Acceptance: FAIL / incomplete.** Controlled alignment improves, but continuity/edge artifacts do not yet pass. No revised stitcher is deployed. The existing HTTPS capture/recovery test remains unchanged. Do not describe this experiment as a fix for the owner's four screenshots.

## Evidence and causes

The four supplied phone screenshots show doubled windows, layered furniture, repeated wall edges and inconsistent geometry. Source inspection confirms that the baseline only projects photographs using sensor poses and an assumed camera FOV, then averages overlaps. It performs no feature matching, camera refinement, optical calibration or optimized seam selection. Averaging misregistered pixels creates transparent duplicate objects. Screenshots alone cannot separate wrong focal length, orientation error, translation/parallax or scene motion, or recover the source matches. Increasing output resolution would reproduce those errors at higher resolution.

The owner's current source photographs remain in the phone's IndexedDB and have not been supplied here. A local-path request is pending. An earlier authorized 37-photo indoor capture ZIP with metadata was found locally and tested without uploading photographs. It is a different scene/capture and its imported coordinate/FOV conventions are not independently calibrated. Do not equate its failures with the current Fold session. All real images, output comparisons and logs stay outside Git.

## Licensed technology evaluated

- [OpenCV licensing](https://opencv.org/license/): modern OpenCV is Apache-2.0. [Pinned upstream license](https://raw.githubusercontent.com/opencv/opencv/4.12.0/LICENSE).
- [Official JS/WASM build documentation](https://docs.opencv.org/4.13.0/d4/da1/tutorial_js_setup.html) describes Emscripten builds; it does not establish that stock JS exports the complete native panorama pipeline.
- [TechStark OpenCV.js](https://github.com/TechStark/opencv-js) distributes the official JS build. This experiment pins `@techstark/opencv-js@4.12.0-release.1`, Apache-2.0, rather than adopting the newer 5.0 release during this experiment. Package installation used no install scripts; npm audit reported zero known vulnerabilities, which is not a security guarantee.
- Runtime inspection: ORB, AKAZE, BFMatcher, findHomography, solve and Rodrigues are available. SIFT, the native Stitcher and the complete graph-cut/multiband panorama interface are not exposed by this stock build. ORB matching proved insufficient on the real comparison; the current experiment uses AKAZE. OpenCV's maintained native stitching/detail pipeline remains the recommended next engine evaluation, through a reproducible custom WASM build and complete third-party notice review before distribution.
- No Stanford code/assets were copied. Existing Marzipano and encrypted-backup dependencies remain unchanged. The npm dependency is development-only and bundled into the isolated capture build, never loaded from a CDN. The generated UMD receiver adaptation is marked, and Apache license text is bundled. The code change does not choose a repository-wide software license.

## Implemented experiment

In a worker: bounded 640-pixel feature extraction, grayscale normalization for detection only, AKAZE descriptors, Hamming ratio matching, RANSAC homography inlier filtering and a sensor-bearing plausibility check. A small original rotation-graph experiment refines camera axes using matched bearings, anchored to one camera. It searches bounded focal scales and a one-coefficient radial model. This is **not** the mature OpenCV bundle adjuster or a certified lens calibration; focal/radial parameters can trade off and overfit. Feature residuals below are training residuals, not held-out geometry certification.

Matched-point intensity ratios estimate bounded scalar exposure gains. Original pixels are not rewritten: gains apply during rendering. Disconnected/weak match graphs reject rather than silently falling back to a claimed aligned result. Isolated unmatched frames may be excluded from the experimental render only when at least 80% remain connected; their original files stay saved and their IDs are reported. Normal UI rendering still rejects any uncovered output pixels. Benchmark-only missing-coverage diagnostics must never be treated as complete accepted tours.

The default remains the original stitcher. A separate explicitly selected experimental engine refines geometry before feathering. A hard source-ownership variant is benchmark-only: it avoids multi-image averaging but creates sharp seams and performed worse on edge artifacts. It is not offered as an automatic seam fix. Cancellation terminates the worker; originals and capture sessions remain available. A local **Export original captures (local ZIP)** action exports JPEG bytes and pose metadata after an explicit unencrypted-file warning; no source export is transmitted or placed in tour cloud storage. Existing encrypted .shtour backups cover accepted panoramas, not these raw frames.

## Identical-input comparisons

Desktop Chromium. Both engines used exactly the same JPEGs and metadata, 1024×512 output and 92% quality. This deliberately holds resolution constant. The controlled fixture is a procedural ray-cast room with a window, doorway, sofa and table, 28 perspective frames with known pose/FOV perturbations. It is not a photographic field test and has no translated viewpoints. The second fixture applies alternating 0.8/1.2 exposure to those source frames. Each baseline/candidate run within a fixture still receives identical photographs.

| Controlled room, normal exposure | Baseline | Refined feather | Hard ownership diagnostic |
|---|---:|---:|---:|
| Known-reference RGB MAE / 255 | 22.52 | 20.66 | 21.36 |
| Spurious horizontal-edge proxy | 19,405 | 23,515 | 33,459 |
| JPEG bytes | 201,064 | 210,398 | 222,349 |
| Worker wall time | 0.229 s | 6.200 s | 6.272 s |
| Matched-bearing training RMS | — | 1.855° before → 0.397° after | same alignment |

The edge proxy counts strong output gradients where the ideal image lacks such a gradient. It is not a count of duplicated objects and is confounded by blur/sharpness. Its increase is a reason to keep the quality gate open, not evidence to hide. Seam discontinuity and duplicate-object counts have not been independently measured. No claim of visually continuous room geometry is justified by the average RGB improvement.

| Exposure-stress room | Baseline | Refined feather |
|---|---:|---:|
| Known-reference RGB MAE / 255 | 30.24 | 24.89 |
| Spurious horizontal-edge proxy | 17,944 | 25,510 |
| JPEG bytes | 199,783 | 216,597 |
| Worker wall time | 0.220 s | 7.018 s |
| Matched-bearing training RMS | — | 1.882° before → 0.474° after |
| Matched-intensity logarithmic RMS | — | 0.334 before → 0.052 after |

Exposure scores use fitted matched samples and are not an independent perceptual exposure test. Saturation/moving subjects cannot be recovered from these scalar gains. Hardware/load affect timing; these are not mobile measurements.

The earlier real 37-photo indoor set produced the baseline at 1024×512, 174,224 bytes, about 0.86 seconds. The feature candidate **rejected its weak/disconnected match graph**, so there is no valid real-scene after-image or alignment-improvement claim. Multiple matching settings were investigated; thresholds were not weakened to fabricate success. Legacy pose/FOV conventions, repetitive/low-texture regions and actual overlap require investigation against the original image geometry. The supplied four screenshots are not a substitute for that data.

## Memory, mobile and privacy

OpenCV reported a 134,217,728-byte (128 MiB) WASM heap capacity during controlled runs. The original renderer's major-array/decode estimate was 39,976,960 bytes at 1024×512. **Neither is measured peak process/GPU memory**, and they must not be presented as such. Decoder buffers, encoded frames, JS arrays, canvases and browser copies add memory. Phone peak RAM, thermal behavior and wall time remain unmeasured. Candidate matching is bounded to nearby frame pairs, 64 frames/64 MiB source data, and sequential frame decoding. Tests terminate over-budget workers; real mobile resource acceptance remains open.

All processing runs in the local browser worker. Generated assets are self-contained, and only the isolated capture HTML permits WASM compilation through CSP `wasm-unsafe-eval`; no unrestricted script eval or external image-processing API is introduced. The existing app's capture/recovery browser and offline/encrypted-backup tests passed after these changes. Production builders, Cloudflare records, permissions, sites and billing were not modified.

## Reproduce and next gate

`node capture/quality-test.mjs` runs controlled normal-exposure baseline/refinement/ownership comparisons. Set `STITCH_EXPOSURE=1` for exposure stress. `STITCH_SOURCE` may point to an explicitly authorized private JSON source adapter; no real fixture is committed. Results and JPEGs go to a private temporary evidence directory. `npm test` includes exact-bearing rotation-refinement tests. `node capture/recovery-browser-test.mjs` and `node capture/browser-test.mjs` verify preserved capture/editor/recovery/offline behavior. CI exercises the controlled comparison; passing CI does not mean the real-scene quality gate passed.

Next: obtain the current Fold raw JPEGs **and** saved poses locally, verify coordinate and FOV conventions, and compare a mature WASM camera-estimation/bundle-adjustment/seam pipeline on those same frames. Use robust per-view calibration and spatially validated/held-out correspondences. Significant translation near furniture cannot generally be corrected by a single rotational panorama model; constrain rotation around the lens and evaluate parallax-aware seams/rejection instead of promising perfect reconstruction. Until image continuity, real-scene comparisons and phone resource tests pass, keep this a draft experiment and do not deploy it as a quality fix.
