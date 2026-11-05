# Staff offline tours

The Cloudflare Worker serves the installable staff app at `/offline/`. Sign in at `/staff` and choose **Available Offline**. The separate Node sharing prototype also supports this workflow over HTTPS or localhost.

1. Use **Install app** when offered, or use the browser’s install menu. Set a separate device passphrase of at least 16 characters and keep it safe. The app cannot recover it.
2. Select one or more apartments and choose **Download selected**. Wait for **Ready Offline** beside each apartment. It appears after the app verifies its shell, downloads and decodes every JPEG, checks the tour version, and commits the encrypted tour in one storage transaction.
3. Open a saved apartment and follow its doorway arrows. Saved tours are read-only. Use **Lock downloads** after presenting or **Remove download** to free space. Closing the app drops the in-memory key, so reopening requires the device passphrase again.
4. When the app reconnects, it checks the authenticated catalog on startup, when brought to the foreground, and every minute while open. **Update available** means staff can download the replacement. Offline staff downloads use the latest cloud draft, including unpublished edits. Guests continue to use the separately published version. Save cloud edits in the editor, then download again. Existing guest links retain the apartment identity.

Interrupted or cancelled batches keep apartments that already finished. An apartment that fails verification or runs out of space keeps its previous complete copy. The progress bar counts validated photo bytes and the storage figure counts encrypted apartment payloads. Browser quota estimates are approximate. **Request persistent storage** asks the browser to reduce eviction risk, but clearing site data, uninstalling, or storage pressure can remove downloads. Keep the agency's original tour backups separately.

## Access and local storage

- Only an authenticated staff session can obtain the catalog, manifest, or room photos for a download. Guests cannot use these endpoints. The service worker caches an explicit list of public app files, with no manifests, photos, sessions, or staff API responses.
- The browser encrypts room JPEGs and tour manifests with AES-GCM. It derives the key from the separate device passphrase with salted PBKDF2-SHA-256. The passphrase and key are not persisted. Opaque apartment IDs, version markers, size, and expiry are visible to the browser storage owner. Encryption protects a locked browser copy, but cannot protect an unlocked screen, a compromised browser, or copies someone already made.
- The server issues a per-download expiry. Set the Worker variable `TOUR_OFFLINE_HOURS` to an integer from 1 through 168 (also supported as a Node server environment variable). The default is 24 hours. Invalid Worker values reject new downloads. Re-download while signed in to renew. Changing the setting does not shorten existing disconnected copies. The browser enforces expiry using its device clock, which is not tamper-proof on an unmanaged device.
- The server cannot revoke a copy while the device is disconnected. Use a short offline window and managed devices for sensitive material. The app locks on a reachable staff authorization failure and hides catalog entries that the server no longer returns. Signing out from the staff dashboard clears the offline library in that browser. Copying a device passphrase to another person also gives them access to the downloads on that browser.

## Cloudflare deployment contract

The deployed Worker uses Service Worker, Cache Storage, Web Crypto, and IndexedDB. The `/api/staff/offline` catalog, manifest and image routes require a current staff session. D1 holds revisions and private KV holds JPEGs. Stale image revisions are rejected. Archive or removal withdraws the tour on the next online check and locks an active tour. The shell cache contains only the explicit application allowlist, never private API responses. Bump `sharing/sw.js`'s cache version whenever changing a cached file. No R2 or additional service is required.

## Synthetic acceptance test

1. On Chrome desktop or the Galaxy Z Fold 7, open the synthetic app at a trusted HTTPS address (localhost is suitable on desktop). Install it and download a complete three-room sample.
2. Turn off Wi-Fi and mobile data on the phone, or disconnect the desktop from the server. Close the app, launch it from its icon, and unlock with the device passphrase.
3. Follow Living room → Kitchen → Bedroom → Kitchen → Living room. Pan and zoom in each room. Check the read-only indicator.
4. Reconnect. From the staff dashboard replace the test apartment with a revised synthetic package. On return to the offline screen, check for **Update available**, then re-download.
5. Try a wrong passphrase, an expired copy, cancellation during a multi-apartment download, and removing a copy. Check that guest credentials cannot download tours.

The hosted browser probe verifies encrypted download, a complete browser-process restart with browser networking disabled, every sphere and doorway, reconnect update detection, replacement download, archive withdrawal, restore as unpublished, and download removal. It uses an isolated disposable mobile-viewport profile and a cloned synthetic draft. This does not establish airplane-mode behavior or installed-app launch on a physical Fold. Those checks remain open.

Run `node cloudflare/offline-browser-probe.mjs` with `PILOT_PLAYWRIGHT` pointing to an installed Playwright module. For the approved synthetic hosted pilot, supply `PILOT_PROBE_ORIGIN`, `PILOT_PROBE_USERNAME`, and `PILOT_PROBE_STAFF` through a protected process environment. Never put a password in command arguments or saved scripts. The probe removes its own cloud draft and temporary browser profile.
