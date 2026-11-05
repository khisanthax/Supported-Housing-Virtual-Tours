# Synthetic pilot acceptance — 5 November 2026

This is a release evidence record, not approval to upload agency content.

## Workspace reconciliation

GitHub main at `c3e3ca7` already contained PRs #5 and #6. The canonical repository had no uncommitted files or commits absent from main. Older feature branches were already merged. The parent folder is a separate, uncommitted artifact container; `../apartment-tour` retains historical uncommitted Site prototypes. Comparing its source paths found the same viewer, sharing and offline features in the canonical repository, plus older authentication and build variants. Legacy reports remain untouched. No private archives or photographs were copied into Git.

## Verified

| Area | Actual evidence |
| --- | --- |
| Regression | 26 Node tests pass, including password policy, roles, revocation, ZIP safety, private sharing, backups and offline encryption. |
| Hosted editor | Desktop Chromium and independent Edge at a mobile viewport: image previews, retry after injected upload failure, reciprocal arrows, reload, cross-browser draft persistence, photo replacement retaining links, stale-save rejection and logout. |
| ZIP import | Local Worker, six synthetic stitched JPEGs: filename suggestions, six previews, retry, room import and cross-browser replacement. |
| Guest isolation | Hosted two-apartment normalized phrase, exact catalog scope, excluded apartment denial, protected JPEGs, editor denial, unpublish and immediate share revocation. |
| Hosted offline | Isolated 390-pixel touch profile: encrypted download, browser-process restart with networking disabled, every sphere and doorway, reconnect update detection, verified replacement, archive lock, restore unpublished and local removal. Repeated successfully after deployment. |
| Capacity | Live D1/KV: 25 drafts with seven viewpoints each, 175 distinct synthetic JPEGs, 39,202,975 image bytes. Disposable drafts removed; immutable images retain the 24-hour orphan cleanup grace. This exercises persistence, not sustained simultaneous editing by 25 people. |
| Staff recovery | Synthetic Administrator and Editor: write authorization, account-administration denial, password reset, rejected old password, disabling and session revocation. Operator recovery updated a disposable Administrator in live D1, accepted the new password and rejected its old session. Test accounts left disabled. |
| Hosted code | Deployed module SHA-256 equals the local dry-run bundle. All 43 generated static files returned identical bytes through their authenticated or public application routes. |

The pilot still uses individual passwords and private scrypt Durable Objects. Firebase remains dormant rollback configuration. No cryptographic costs were reduced.

## Live CPU and quota observations

After deployment, two sequential and four concurrent correct sign-ins and one incorrect password returned the expected outcomes. Tail captured all seven public login events and their seven coordination and seven scrypt events. Successful public login maximum was 2 ms; coordination maximum 8 ms; scrypt maximum 317 ms (concurrent maximum 204 ms). Six dashboard checks, six logouts and six rejected post-logout checks all passed. Tail captured only three public dashboard events (maximum 0 ms), two logout events (3 ms) and two rejected dashboard events (1 ms); those incomplete samples do not establish their worst case. There were no runtime errors in 285 captured events at that point. Isolate coldness and native memory peaks were not established. Earlier 32-concurrent-login acceptance remains recorded in LOGBOOK.md.

Account-wide UTC-day analytics through 14:33 UTC reported 696 Worker requests, 60 Durable Object requests, zero reported errors, 61,392 D1 rows read, 1,373 written, 189 KV writes, 35 reads and seven deletes. Durable Object periodic metrics reported zero CPU- or memory-limit errors. Analytics initially rate-limited requests; a bounded query succeeded after cooldown. These are time-bound observations, not reserved capacity.

The existing Workers Free plan was last visually confirmed on 4 November. The current subscriptions API returns 403; the read-only dashboard attempt stopped at computer-use authorization timeout. No plan, payment instrument, resource binding or paid service was changed. Reconfirm the dashboard plan before agency release.

Current documented allowances include 100,000 Worker requests/day with 10 ms public CPU, 100,000 SQLite Durable Object requests/day, KV 100,000 reads and 1,000 writes/day with 1 GB storage, and D1 5 million rows read and 100,000 written/day with 5 GB storage. Limits apply across the account. Free quota exhaustion can interrupt service; it is not a guarantee of permanent hosting terms. The app additionally reserves at most 400 MB and 800 JPEG uploads/day. At 175 images, the 4 MiB per-image maximum cannot be used for every image within that reservation. Target an average at or below 1.5 MiB and retain room for revisions.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Remaining release gates

1. On a physical Galaxy Z Fold 7, sign in, create a synthetic draft, upload stitched JPEGs/ZIP, position and move both doorway arrows, reopen the saved draft on the PC, and verify portrait, landscape and unfolded layouts. Earlier viewer-only Fold testing does not establish these staff workflows.
2. Install the PWA on that phone, download a synthetic apartment, enable airplane mode with Wi-Fi off, fully close and launch from its installed icon, unlock and traverse every doorway. Reconnect and check revision detection, archive withdrawal and logout clearing downloads. Browser network emulation does not establish OS installation or device behavior.
3. Reconfirm Workers Free in the authorized account dashboard. The API credential can deploy but cannot read subscriptions. No account-wide administrative access is needed.
4. Name the real staff administrators and approved recovery operator, and agree on private initial-password delivery, offline expiration, and encrypted `.shtour` backup location/retention. The operator recovery command is documented in DEPLOYMENT.md and tested with a synthetic Administrator.
5. Supply one complete apartment's approved stitched panoramas, room/viewpoint names and doorway destinations, plus explicit agency authorization for private cloud storage and the intended guest audience. The available real workspace photos and capture-frame ZIP do not establish complete apartment coverage or agency publication approval. Leave them out of Git, automated testing and the synthetic deployment.

Issues #1–#3 stay open for their physical-device, onboarding and plan-confirmation gates. Email reset delivery is not part of active password mode; an Administrator resets passwords directly. The older Firebase email-delivery acceptance remains unverified for rollback mode.

## Reproduction and backup

Run `npm test` and `node cloudflare/prepare.mjs`. The editor, offline and capacity probes in `cloudflare/` accept the synthetic pilot origin and credentials through a protected environment. `PILOT_PLAYWRIGHT` points to an installed Playwright module. `PILOT_TEST_PUBLISH=1` enables the editor's synthetic publishing/sharing checks; `PILOT_LOCAL_ZIP` is restricted to the local Worker. Probes remove their disposable drafts. Never put credentials in command arguments, Git or reports.

D1 is the shared source for account metadata, roles, sessions, permissions and versioned tour manifests. KV privately stores immutable JPEG bytes. Browser downloads are encrypted, expiring convenience copies; they are not backups. Export each accepted tour as `.shtour` and test importing it as an unpublished draft. That package preserves rooms, arrows and image bytes, not accounts or guest links. An authorized operator must separately back up D1 and securely retain required server secrets; treat D1 exports as sensitive because they include verifiers and session metadata. KV loss requires restoring tour images from the packages. See STAFF.md and OFFLINE.md for storage and revocation limitations.
