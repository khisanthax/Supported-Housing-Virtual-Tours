# Local stitcher comparison, 19 November 2026

**Decision.** Keep Hugin as the external desktop reference. Its best overall result on this room combined PR #50's direction-guided image matches, Hugin camera optimization at the recorded field of view, and Verdandi hard watershed seams. It recovered more continuous ceiling detail than the other complete renders. The lamp still has a broken edge, and the chair is visibly displaced against the background. No tested engine passed photographic acceptance. Keep the browser capture interface and its existing rejection criteria.

## Input and measurements

All four engines received derivatives of the same 38 original JPEGs in the same order. The private staging copies matched the archive byte-for-byte by SHA-256. The planned straight-down exposure was excluded throughout. Original JPEGs were 960 × 1280. Hugin and stock OpenCV read those JPEGs, OpenPano used an 800-pixel SIFT working size, and the ImgAlign worker and PR #50 local image analysis used 480 × 640. The Hugin and fixed-camera comparison canvases were 2048 × 1024. The existing bottom cap was applied only after measuring rendered support.

Hugin consumed the recorded directions and FOV. The OpenCV guided trial used them to select plausible pairs and initialize cameras. The stock OpenCV Stitcher and OpenPano camera-estimation interface inferred poses from pixels. ImgAlign's multi-image worker accepts per-image FOV but exposes no pose input. The same metadata was used independently to audit the angular footprint of comparable components. Substituting phone poses for missing image matches would make these stock benchmarks misleading.

| Pipeline | Participation and coverage | Desktop elapsed and peak memory |
| --- | --- | --- |
| OpenCV 5.0.0 stock panorama, CPU | Reported success with 18/38 registered. Its fitted optical footprints covered 82.3% of the sphere, or 73.5% when evaluated using the recorded directions. The output visibly has holes. | 27.4 s, 521 MiB |
| Native OpenCV SIFT and phone-guided pairing | Largest verified group 36/38. #14 and #20 remained isolated at confidence above 1. The full-set bundle adjustment was withheld. | 12.6 s, 188 MiB |
| OpenCV graph cut and five-band blending on PR #50's saved camera fit | All 38 supplied pixels to the blend masks above the cap. The alpha mask covered the sphere. Chair and light edges remained displaced. | 19.4 s, 471 MiB, excluding the earlier camera solve |
| ImgAlign, desktop Chromium/WASM | 30/38 stitched, with visible missing ceiling and floor. A separate incremental-start call identified 29 indices with 92.3% predicted spherical support. That percentage applies only to the second run. | 99.5 s, 1,203 MiB sampled across Node and Chromium processes |
| OpenPano, camera estimation | Pairwise matching and incremental bundle adjustment formed a 33/38 tree. Missing original numbers 14, 16, 20, 35 and 37. It stopped before rendering. Those 33 phone footprints predicted 100% area, illustrating why predicted coverage alone is insufficient. | 21.5 s repeat, 574 MiB. First run under concurrent workloads took 60.9 s |
| Hugin 2023.0.0, stock controls | CPFind found 1,057 control points across 36/38 photos. #14 and #19 had no control points. Nona remapped all 38. Enblend aborted on an empty seam mask. Verdandi produced full alpha coverage including sensor-positioned views. | CPFind 282.6 s, 770 MiB. Optimization 2.6 s, remap 10.2 s, watershed 5.8 s. Failed Enblend attempt 159.4 s |
| Hugin with PR #50 image matches | Six additional image pairs connected all 38. Enblend and Verdandi each produced full alpha coverage. At least 31 and 33 sources respectively could be identified from distinct textured output patches above the cap. | Reused CPFind. Optimize 4.1 s, remap 9.3 s, Enblend 175.4 s or watershed 12.7 s. Largest native stage remained CPFind at 770 MiB. Browser recovery time excluded |
| Hugin with outlier removal, shared focal and radial fit, watershed | All 38 connected, full alpha coverage, at least 34 sources identifiable. FOV fit changed from 65° to 63.16°. Removing 82 control points and fitting the lens lowered control-point RMS from 8.10 to 5.25, but worsened chair continuity. | Reused earlier matches. Clean 35.6 s, optimize 6.9 s, remap 14.2 s, watershed 6.3 s |

Windows figures are process peak working set. The ImgAlign process-tree sampler runs every 100 ms and may count shared pages more than once. WSL figures are maximum resident memory for each timed executable. Some jobs overlapped. These are workstation measurements, not physical phone timings. A preliminary OpenCL run failed with a GPU resource error. The reported native OpenCV results used CPU.

The Hugin camera conversion was tested at three pixel locations per photograph, including near the zenith. The first conversion had the roll sign reversed. After correction, all 114 rays agreed with Hugin's own coordinate transform within 0.000002°. The reported Hugin outputs use the corrected convention. Angular coverage is area-weighted. Full opacity can include a wrong source or a badly displaced surface.

## What the photographs show

| Source edge recovered within 3 px and 22.5° | Hugin guided + Enblend | Hugin guided + watershed | Cleaned lens fit + watershed |
| --- | ---: | ---: | ---: |
| #14 ceiling vent | 41.3% | 59.8% | 37.3% |
| #16 strip light | 35.5% | 52.9% | 45.3% |
| #20 overhead light | 23.7% | 25.7% | 35.2% |
| #35 chair | 46.6% | 50.3% | 37.8% |

Each Hugin crop uses that project's own source-to-sphere transform. The figures measure agreement with a specific original photograph on the visible part of its projected crop. Changing the lens fit changes the evaluated footprint. These are diagnostic proxies, not scene ground truth. Hugin's hard seam keeps more of the vent and cable continuous. Enblend leaves a dark colored artifact adjacent to the overhead light. OpenCV multiband softens the seam while the kink remains visible. On the chair, a sharp single-source outline can still put the arm or background at the wrong position. Only 31 qualifying carpet edge pixels remained in the small common comparison region after masking the floor across renders, too few to rank engines by carpet quality.

Visible source participation is a lower bound. A 9 × 9 textured patch must match one warped source within 8 RGB RMS units and beat every other source by over 5. Heavily blended or indistinguishable patches may go unattributed. Remapping every image and registering every camera do not prove that every photo survives the blend.

The earlier two-view test gives stronger evidence about parallax. A rotation fitted to 70 carpet features left a 3.47 px median carpet error and a 33.10 px median cushion error. Local alignment reduced cushion error but moved the break to the arm or carpet. The images support depth-dependent displacement. They do not uniquely determine lens translation, exposure timing or lens-model error. [Earlier pairwise measurements](LOCAL-ALIGNMENT.md)

## Browser and licensing decision

- **Hugin.** Use the separately installed GPL toolchain for private desktop comparisons. CPFind supplies image correspondences, the optimizer fits cameras, Nona remaps images, and the external blenders choose boundaries. Keep Hugin and Enblend code and binaries out of the Apache-licensed web application. [Hugin toolchain](https://hugin.sourceforge.io/docs/manual/Panorama_scripting_in_a_nutshell.html), [Hugin sources](https://hugin.sourceforge.io/)
- **OpenCV.** The practical browser candidate is a small, current WASM build restricted to the required matching, optimization and seam operations. Run work in a dedicated worker, bound image pyramid sizes and reject disconnected results. Port only after a capture passes the desktop reference. OpenCV 4.5 and later is Apache-2.0. Audit bundled modules and third-party notices for the exact build. [Stitching API](https://docs.opencv.org/4.x/d1/d46/group__stitching.html), [OpenCV license](https://opencv.org/license/)
- **ImgAlign.** Its customized OpenCV worker proves that multiframe stitching can run locally in a browser. The partial result and measured desktop memory make it a poor drop-in for this mobile application. Its README specifies MIT with per-file exceptions. The included OpenCV 3.4 fork has its own notices and component restrictions. [ImgAlign README and licensing](https://github.com/latsic/imgalign/tree/99f18a15a06855dc5ba764679a1d75bfd0d2e782)
- **OpenPano.** Camera estimation assumes a stationary viewpoint and estimates cameras using invariant features and bundle adjustment. Its translation mode assumes similar scene depths, unsuitable for the chair and far wall. No phone WASM build was benchmarked. Its project license is MIT. Optional bundled CImg has separate CeCILL terms; audit or omit it if ever distributing a build. [OpenPano source and dependencies](https://github.com/ppwwyyxx/OpenPano/tree/f9b246945e891b67e200def47e399bf591422c9e)

## Next physical comparison

Capture the same room from the same spot twice. Use the existing normal handheld workflow once. For the second sweep, keep the active rear lens over one fixed point through the ceiling and low rows. Choose a near chair edge lined up with a distant doorframe and turn slowly. If they slide apart, adjust the pivot before capturing. Keep the same lens and zoom and avoid moving furniture between exposures. Compare both sets in the fixed-field Hugin watershed pipeline, with the same crop and participation tests. If the controlled pivot resolves both the chair and distant edges, prioritize teaching that capture motion. If both sets still fail, compare calibrated intrinsics and rolling-shutter timing before investing in a browser port.

## Replaying privately

Use a fresh private directory outside Git. The source manifest, camera files, remapped TIFFs, masks and comparisons all contain private information. The CLI tools below are development-only and are excluded from the web build.

1. Run `python capture/engine-evaluation.py prepare PRIVATE --archive SOURCES.zip`. Run the `opencv` and `guided` operations on that directory. For `multiband`, supply the original archive, `--cameras` from the matching PR #50 solution and `--previous` pointing to its bounded-seam JPEG.
2. In Ubuntu with Hugin, Enblend and GNU time installed, run `bash capture/engine-cli-evaluation.sh hugin PRIVATE`. If Enblend rejects the result, keep the failure log and run the `watershed` operation on the existing tiles. Use the upstream OpenPano checkout as an absolute third argument to the `openpano` operation.
3. Run `node capture/hugin-overlap-replay.mjs PRIVATE` with the repo's Playwright Chromium. Use the `augmented` shell operation to optimize and render those additional image correspondences, followed by `watershed` in the augmented directory. For the lens variant, use a separate project with all lens coefficients b linked to image zero and add v0 and b0 to the optimization variables before running `lens`.
4. Run `python capture/measure-imgalign.py IMGALIGN_CHECKOUT PRIVATE`. The loopback server serves only the worker and library assets. Use `node capture/imgalign-evaluation.mjs IMGALIGN_CHECKOUT PRIVATE --indices` for an independent registration-order probe.
5. Generate crop coordinates with `python capture/hugin-evaluation.py PRIVATE --coordinates`. Run the shell `coordinates PRIVATE PROJECT_SUBDIR` operation, then `python capture/hugin-evaluation.py PRIVATE --project PROJECT_SUBDIR --watershed` for a watershed render. Omit the last flag for Enblend. The private four-column JPEG compares original, PR #50, OpenCV and the selected Hugin output.
