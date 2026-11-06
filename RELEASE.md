# Synthetic release readiness — 6 November 2026

The small-team synthetic pilot passes the measured release checks. This is not approval for agency rollout. Existing Gallery, four-step editor, blank grids, Undo, arrows, guest sharing and encrypted offline viewing remain in place. No real apartment was imported.

## Free CPU architecture and evidence

Set `TOUR_API_BACKEND=durable-object` in the private pilot configuration. Staff/guest APIs and guest tour entry run through `tour-api-v1` in the existing SQLite-backed class. The public Worker validates origin, overwrites the trusted client address and forwards the request. The private handler performs the same authorization, D1 queries, image validation, cryptography and atomic throttling. Scrypt stays in its dedicated hash instance with unchanged parameters. Static assets stay on the original routes. No new binding, schema migration or storage product is needed.

This moves expensive request processing into an appropriate budget rather than weakening it. Cloudflare documents a 30-second default object CPU budget, 100,000 object requests/day and 13,000 GB-seconds/day on Free. Each forwarded API adds an object invocation; JPEG streams also consume duration while active. Shared D1/KV/Worker quotas still apply, and quota exhaustion can stop service. [Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/) · [Free quotas](https://developers.cloudflare.com/durable-objects/platform/pricing/).

The live trace captured 826 events: 825 normal and one canceled browser request; no runtime or CPU/memory-limit termination. All 532 public events used at most **5 ms**. Public API samples:

| Path | Samples | Maximum CPU |
| --- | ---: | ---: |
| Staff login | 34 | 3 ms |
| Draft read | 90 | 4 ms |
| Draft save | 41 | 3 ms |
| JPEG upload | 24 | 2 ms |
| Invitation creation | 4 | 0 ms |
| Guest unlock | 16 | 1 ms |
| Staff JPEG | 44 | 1 ms |
| Account creation / changes | 5 / 8 | 1 / 1 ms |

Private API samples stayed at or below 7 ms; 47 separate native hash/verify samples reached 264 ms. Two successful API runs covered 119 and 124 HTTP outcomes, with response latency p95/max 447/756 and 433/577 ms. Tests included sequential editing and two concurrent reads/sign-ins. A shared-source throttle correctly rejected excess attempts; the probe now waits for the next window. No address rotation or limiter weakening was used.

This passes the bounded low-volume CPU acceptance gate. Tail did not capture every request, isolate coldness is unproven, and small samples cannot guarantee future worst cases. Do not describe HTTP success as guaranteed Free compliance. Keep monitoring during the first approved pilot; retain the previous deployment and flag rollback. Ordinary staff HTML/static authorization still runs in the public Worker and was included in the 532-event total.

Account-wide UTC-day snapshot during acceptance: 1,334 Worker requests, zero reported errors, D1 62,788 rows read / 1,245 written, KV 46 writes / 191 reads, object duration 10.327663872 GB-seconds, zero object CPU/memory-limit errors. An earlier object snapshot reported 719 requests and V8 memory p99 7,356,308 bytes. These are different time-bound snapshots, not final daily totals or native scrypt peak memory. No plan or payment setting changed; the last visual Free/$0 confirmation was 5 November.

## Acceptance and boundaries

44 automated tests pass, including dispatch identity, CSRF, flag rollback, password/role/revocation/expiry, backups, ZIP safety and navigation. Live Chromium/Edge probes passed guided creation through publication, upload retry, replacement, stale-write denial, room-grid/reset/Undo/checkpoint, direct doorway drag and reciprocal positions, restricted guests and complete backup import. Folded portrait, 844 × 390 landscape and unfolded emulation passed without page overflow. Emulated two-finger zoom changed the rendered sphere; fullscreen enter/exit passed and Chrome parsed the PWA manifest without errors. No phone was attached to ADB. Physical pinch/fullscreen, installed PWA and airplane-mode checks remain in PILOT.md.

Encrypted offline tests passed disconnected process restart, all spheres/doorways, incorrect passphrase, interrupted/low-storage preservation, online revision replacement, archive withdrawal, expiration and removal. Physical installation was not claimed. Existing secure session expiration and online logout remain enforced; offline revocation remains impossible while a device is disconnected.

Live enrollment covered another synthetic Administrator and Editor, role restrictions, reset, rejected old passwords, disabling and immediate session denial. Guarded emergency recovery was exercised on a disposable disabled Administrator and re-disabled afterward. No real staff identities or recovery operators were selected.

## Backup and disaster recovery

Staff export `.shtour` after every accepted editing session and before replacement/reset/publication. Suggested retention, subject to agency approval: last 7 accepted versions plus a monthly snapshot for 3 months, with a second encrypted copy in a separate approved location. Packages themselves are unencrypted. Rehearse import as **New apartment**, compare every sphere, room, layout, starting viewpoint, arrow and recovery checkpoint, and keep the working apartment until verified. Replacement changes only the draft until explicit publication.

Packages omit accounts, roles, credentials, guest permissions/invitations, sessions and server secrets. An authorized operator must separately retain D1, referenced KV JPEGs, deployment configuration and secrets in protected storage. Never put any of these in Git or issue attachments. Wrangler export output can include a temporary signed download URL: redirect the entire command output into private storage.

During this release, a private D1 export restored all 204 baseline versions into isolated SQLite with integrity `ok`. All 131 distinct JPEGs referenced by that snapshot (37,890,988 bytes) were retrieved privately from KV, indexed with SHA-256, and matched to its references. This covers retained tour versions, not unreferenced orphan uploads. Browser backup restoration passed complete manifest and JPEG equality in another browser. Rehearse operator restoration in an isolated local environment first: restore the SQL, load JPEGs under their original KV keys, compare hashes and references, configure the original secrets, and verify authorization with synthetic identities. A new namespace must be bound explicitly; a D1 restore alone does not restore images or secrets. Do not overwrite the hosted database to rehearse.

The older legacy browser probe unexpectedly invoked global cleanup and pruned 50 retained historical rows. Restored those rows from the pre-test export without replacing current drafts/publications. Final comparisons passed all 204 baseline versions and every original photo/age/visibility/permission/share row; all referenced JPEGs remained available. The probe now skips global maintenance on hosted origins. No original photo metadata or JPEG was deleted. Local maintenance testing remains available.

## Owner actions before real content

Run the short Fold checklist in PILOT.md. Designate named Administrators and a recovery operator; approve encrypted backup storage/retention and offline expiration. Supply a complete approved stitched JPEG set with room/viewpoint names and verifiable doorway destinations. Explicitly approve private cloud storage and any offline/guest audience. Existing garage test images, capture frames and generated house panoramas are not an authorized real apartment set. Keep the first real apartment draft unpublished until its cross-device and restore acceptance and agency publication approval.
