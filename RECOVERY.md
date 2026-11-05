# Photorealistic house recovery — 5 November 2026

The live staff Gallery now contains **Photorealistic House — Demo**, a private draft with eight supplied generated panoramas: Living Room, Kitchen, Dining Room, Hallway, Bedroom, Bathroom, Home Office and Mudroom. It has not been published or added to guest permissions.

## What was found

The original GPT Site's saved version 4 and the older local apartment-tour source contain a different six-viewpoint photorealistic apartment, Two-Bedroom Apartment. Its image bytes also remain in removed synthetic acceptance fixtures in Cloudflare. These were disposable grid/offline/editor tests, not a permanent eight-viewpoint catalog entry. The original Site and all those records remain untouched.

The audit inspected all 67 known apartment identities, including 33 visibility-only tombstones, all 137 retained versions across 34 identities, all 54 visibility records, all 285 remaining KV JPEGs, the four saved Site versions and latest source, local source archives, and three available portable backups. The eight supplied JPEGs had no exact match in KV. Normalized image comparisons and visual inspection distinguished them from the older six-room set. The available backups contain a three-room Maple apartment. One older file with a ZIP extension is not a valid ZIP; valid earlier archives and Site source were still inspected.

No matching saved eight-viewpoint apartment was found. It could not appear in the Gallery without a D1 catalog record. The authoritative recovered eight-image set was therefore recreated as a new private apartment rather than overwriting a different apartment or reusing an unrelated test identity.

## Recovery and verification

All eight JPEGs are 1774 × 887 pixels and below the existing 4 MiB upload cap. They were reviewed and imported through the authenticated online editor's ZIP workflow. Their source bytes remain unchanged in private KV. All eight named tiles are placed in a spaced editing grid and are available in the filmstrip.

There is no matching navigation backup for this eight-image set. Spaced tiles intentionally create no assumed connections. No doorway coordinates were borrowed from the older six-room tour or invented. Staff must confirm the intended room connections and position doorway arrows before choosing to publish a walkthrough.

Live Chromium and independent Edge verified every sphere, exact image bytes, cloud reload, the private Gallery card and its photorealistic thumbnail, filmstrip/grid data, complete export, and restoration as a separate private draft. Replacement was tested on that disposable restore only: viewpoint identity and the complete manifest stayed unchanged, and the recovered apartment retained every original JPEG. The disposable restore was withdrawn afterward. Anonymous image requests and sharing the unpublished apartment were rejected.

Preservation checks confirmed all 137 earlier version rows, 285 photo records, 54 visibility rows, 59 guest permissions and 45 share records unchanged. The 18 distinct JPEGs referenced by the earlier visible Gallery records remained byte-identical. All 36 automated regression tests passed. The existing viewer/backend needed no fix or redeployment; the recovery is live D1/KV data using the existing approved deployment.

## Backup and repeatability

The verified package is Photorealistic-House-Demo.shtour in the operator's Downloads folder, with a second copy in the private recovery directory under LOCALAPPDATA/SupportedHousingTour/house-recovery. Its size is 2,590,636 bytes. The package contains all eight images, names, layout and draft metadata. It is unencrypted; keep it in protected storage. It omits staff accounts and guest links.

Private source ZIP/JPEGs, snapshots, cloud identifiers, browser screenshots and packages stay outside this public repository. Existing staff backup import can restore the package as a new private apartment without coding. Restore to a new apartment when rehearsing, compare every image, and remove only the disposable rehearsal copy.

The operator-only cloudflare/recovery-browser-probe.mjs reads explicit authorized environment inputs and keeps a private operation-state file to resume without creating duplicate recovery apartments. It refuses first-time creation if the exact named apartment already exists. Its replacement test affects only its own new restore fixture; it never removes the recovered apartment. Use the normal staff editor for routine changes. Issue #15 records the recovery, while physical Fold acceptance and the existing CPU headroom follow-up remain separate release gates.
