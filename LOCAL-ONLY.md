# Virtual Tours · Local Only

Local Only uses the **same current four-step guided editor and Marzipano viewer** as the online edition. It is a separate, single-device app: no login, accounts, guest links, collaboration, server database, automatic migration or synchronization. Nothing publishes to Cloudflare. Desktop editing is recommended; phone and tablet viewing is supported. No paid service is required. No public release or distribution license is selected by this implementation.

## Windows installation

Use a normal Chrome or Edge profile and Node.js 24. From a checkout:

```powershell
npm ci
npm run start:local
```

Open **http://localhost:4185**, wait for **Application ready offline**, and choose **Install app** or the browser's installation menu. The server binds only to this device's loopback interface. After caching, close the server and disconnect; the installed application works from its cached shell. Keep the same browser/profile and address. `localhost`, `127.0.0.1`, different ports, different profiles and different devices have different storage.

To create an installation ZIP without any project data:

```powershell
npm run package:local -- C:/private/LocalTours
```

Extract `Virtual-Tours-Local-Only-private.zip`, open its `Virtual-Tours-Local` folder, run `start-local.cmd`, then open the address above. The extracted server uses only Node built-ins; no npm installation or database service is needed. Keep the folder to reinstall/update the cached shell. Do not open `index.html` directly with `file://`.

## Android and iPad

PWA installation requires a secure context: trusted HTTPS or **localhost on the device itself**. A desktop's localhost address does not work on a phone. Serving `http://192.168...` does not provide a supported installable PWA; do not disable browser security or install untrusted certificates.

An agency can provide the generated static installation files over an approved trusted HTTPS origin dedicated to Local Only. Only initial/updated application assets are served; apartment content never leaves the browser. This task does **not** create that host or change the existing Cloudflare pilot. Use a separate origin from the online edition. Hosting an asset-only installer is optional and is not tour-data hosting. On Android, Chrome → menu → **Install app / Add to Home screen**. On iPad, Safari → Share → **Add to Home Screen**, then open that installed app, wait for caching, and import/create projects there. Safari's installed app and browser tab may have different storage; use encrypted exports for explicit transfer.

Alternatively, an Android on-device static server capable of serving this package at localhost can supply the initial shell. The desktop package's `serve.mjs` requires Node.js 24. Mobile server/OS setup and physical Android/iPad installation have **not** been verified. No mobile helper or third-party hosting subscription is required by the application. For viewing on another device, explicitly transfer an encrypted backup and restore it on that device; there is no shared catalog.

## Build, save and present

1. Gallery → **NEW APARTMENT**. Each apartment gets an independent random identity.
2. **Upload Stitches**: completed 2:1 JPEGs or ZIPs, at most 4 MiB and 8192 × 4096 per JPEG. Existing ZIP bounds/path/bomb checks, duplicate review and 12-viewpoint package limit remain. Name viewpoints; room grouping is optional. Files remain unplaced. Capture frames must first be stitched in Stanford's tool.
3. **Connect Rooms**: drag a destination handle onto its real doorway, or select the handle and tap/keyboard-place. Position the reciprocal arrow in the other viewpoint. Move/inspect/delete arrows and Undo as in the online editor. No reverse position is invented.
4. **Review Layout**: diagram generated from saved relationships; rearrangement never infers a doorway from adjacency. Reset requires confirmation; Undo/checkpoint preserves recovery. Older grid-mode imports retain their data; explicitly choose **Use panorama connections** before changing an older layout.
5. **Preview & Finish**: check every panorama, room selector and doorway; resolve incomplete arrows, then **Mark Ready to Show**. No public URL or server publication exists. Any later edit returns that apartment to Draft.

Changes save automatically after each completed action. Wait for **Saved on this device**. Gallery → **View tour** opens read-only viewing, with fullscreen, panning, zoom and doorway navigation. **Edit** opens the same guided editor. Rename and delete are under **Manage apartment**; deletion requires confirmation and affects only that apartment.

## Storage and recovery

Local projects use IndexedDB **`virtual-tours-local-only-v1`**, separate from both the legacy one-draft database and the online edition's encrypted offline-viewing vault. Stores contain apartment metadata, immutable revision snapshots, original JPEG Blobs keyed by apartment/content digest, and at most 200 sanitized diagnostic records. An atomic transaction commits photos, snapshot and apartment revision together. Revision comparison rejects stale edits/deletes from another window. Failed/quota/interrupted saves retain the previous committed version. Reopen after a conflict rather than overwriting newer work.

Original JPEG bytes are preserved. Every committed revision is retained; replacement photos used by history also remain. Gallery shows photograph storage including history and the browser's origin-level estimate. Estimates are approximate; actual quota failures are handled too. There is no automatic project deletion or history pruning. Export backups before freeing space. **Saved revisions** restores a previous save as a new Draft revision, retaining newer history. Browser transaction guarantees do not protect against disk/device failure.

**IndexedDB is not encrypted at rest by this app.** Use device encryption, screen lock and a trusted OS/browser profile. Clearing browser data, uninstalling, eviction, private browsing restrictions or device loss can remove projects. **Request persistent storage** asks the browser to reduce eviction risk; a grant is not a permanent-storage guarantee. Store encrypted backups separately.

If an older single-tour draft is present on this same origin/profile, the Gallery offers **Copy older draft into Local Gallery**. The original `supported-housing-tour-editor` record is never modified. Different origins/profiles cannot be inspected automatically: export from the old editor and import here. Never clear old data until the restored copy and a backup have been verified.

## Encrypted backups and explicit migration

Gallery → **Export Backup**: choose a filename label and password (at least 12 characters), confirm, then download the named/dated `.shtour.zip`. Encryption/decryption runs locally using the existing reviewed libraries: AES-256-GCM, fresh salt/nonce, PBKDF2-HMAC-SHA256 with 600,000 iterations. This is the existing app-restorable encrypted ZIP format, not a generic WinZip password archive. See [BACKUPS.md](BACKUPS.md).

Photos, room/viewpoint names, layout, original connections, arrow coordinates, start viewpoint and recovery metadata round-trip. Export contains the chosen current apartment snapshot, **not its entire local revision history**, Ready status, browser identity, diagnostic records, staff accounts or guest permissions. Passwords are neither sent nor logged. Lost passwords cannot be recovered. Keep passwords separately from backups.

Gallery → **Import Backup** validates/decrypts the whole package before an atomic new-apartment save. Legacy unencrypted `.shtour` packages work. Wrong passwords/damaged authenticated archives share a safe error. Identical imports are detected and require explicit approval for another copy. Gallery import always creates a new Draft and never overwrites. Editor Import Backup explicitly confirms replacement of only its current draft; earlier local revisions remain recoverable.

Recommended retention: export after each editing session and before destructive operations; keep current and previous encrypted copies in separate approved storage, with periodic restore tests. The app does not choose agency storage or retention policy.

Migration to Cloudflare is manual: export → transfer the file yourself → sign into the online Migration Center → preview → select the apartment → explicitly confirm upload. The local original stays untouched. Compatibility is tested against the existing Cloudflare frontend/Worker code using isolated in-memory D1/KV test adapters; **no live pilot data was imported or changed**.

## Privacy, diagnostics and updates

All panorama reads use local Blob URLs. Apartment IDs live in URL fragments, which are not sent to the static server. Page CSP blocks network connections; application fetch/XHR/beacon/socket APIs are disabled. The service worker caches only an explicit, integrity-checked application asset list and serves runtime requests from that cache. No photo/manifest endpoint, telemetry, remote font or CDN is used. Browser-managed fixed shell update checks can occur when online; they carry no apartment contents. This is an application-level isolation guarantee, not a claim about unrelated browser/OS telemetry or malicious extensions.

**Local diagnostics** exports a ZIP in the existing diagnostic report format. The last 200 allowlisted operation records contain numeric timings/statuses and generic codes, never raw errors, room names, photo data, passwords or backup payloads. No remote diagnostic collector exists. Transfer a report only when you choose.

For updates, retain backups, run the updated static package at the **same origin/profile**, reopen until its shell reports ready, then restart. A failed shell installation leaves the old working cache active. Updates never clear projects. Don't serve Local Only inside the online application's origin/scope.

## Verification and physical checks

Run `npm test`, `npm run test:local:browser`, then `node local/migration-test.mjs <synthetic-roundtrip.shtour.zip>` using the browser test's private evidence output. Browser automation installs and launches the Chromium PWA, restarts a persistent browser profile with its server stopped/network disabled, verifies editing/saving/backup operation, inspects requests and tests phone/tablet/desktop viewports. See [LOCAL-ACCEPTANCE.md](LOCAL-ACCEPTANCE.md) for actual results and screenshots. Responsive emulation is not physical-device acceptance.

Physical checklist: install from a supported secure address; import a synthetic backup; view every room and doorway; pan/pinch/fullscreen folded, landscape and unfolded; enable airplane mode, close/reopen the installed app; edit/save on desktop (optional mobile editing), export and restore a backup; reconnect and verify the same projects. Repeat on iPad before relying on that platform. No approved real agency photographs are included.
