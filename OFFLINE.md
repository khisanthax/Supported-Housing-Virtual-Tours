# Staff offline tours

The staff sharing server serves the installable app at `/offline/`. Use HTTPS in production or localhost for development. Start the synthetic demo using [the sharing setup](SHARING.md), sign in at `/staff`, and choose **Available Offline**.

1. Use **Install app** when offered, or use the browser’s install menu. Set a separate device passphrase of at least 16 characters and keep it safe. The app cannot recover it.
2. Select one or more apartments and choose **Download selected**. Wait for **Ready Offline** beside each apartment. It appears after the app verifies its shell, downloads and decodes every JPEG, checks the tour version, and commits the encrypted tour in one storage transaction.
3. Open a saved apartment and follow its doorway arrows. Saved tours are read-only. Use **Lock downloads** after presenting or **Remove download** to free space. Closing the app drops the in-memory key, so reopening requires the device passphrase again.
4. When the app reconnects, it checks the authenticated catalog on startup, when brought to the foreground, and periodically while open. **Update available** means staff can download the replacement. A previously saved version remains available until its expiration. To publish a revision from the editor, export a complete `.shtour`, then choose **Replace** for the existing entry when importing it in the staff dashboard. Existing guest links continue to point to that catalog entry.

Interrupted or cancelled batches keep apartments that already finished. An apartment that fails verification or runs out of space keeps its previous complete copy. The progress bar counts validated photo bytes and the storage figure counts encrypted apartment payloads. Browser quota estimates are approximate. **Request persistent storage** asks the browser to reduce eviction risk, but clearing site data, uninstalling, or storage pressure can remove downloads. Keep the agency's original tour backups separately.

## Access and local storage

- Only an authenticated staff session can obtain the catalog, manifest, or room photos for a download. Guests cannot use these endpoints. The service worker caches an explicit list of public app files, with no manifests, photos, sessions, or staff API responses.
- The browser encrypts room JPEGs and tour manifests with AES-GCM. It derives the key from the separate device passphrase with salted PBKDF2-SHA-256. The passphrase and key are not persisted. Opaque apartment IDs, version markers, size, and expiry are visible to the browser storage owner. Encryption protects a locked browser copy, but cannot protect an unlocked screen, a compromised browser, or copies someone already made.
- The server issues a per-download expiry. Set `TOUR_OFFLINE_HOURS` to an integer from 1 through 168 before starting the server. The default is 24 hours. Re-download while signed in to renew. The browser enforces the expiry using its device clock. This is not tamper-proof on an unmanaged device.
- The server cannot revoke a copy while the device is disconnected. Use a short offline window and managed devices for sensitive material. The app locks on a reachable staff authorization failure and hides catalog entries that the server no longer returns. Signing out from the staff dashboard clears the offline library in that browser. Copying a device passphrase to another person also gives them access to the downloads on that browser.

## Cloudflare deployment contract

The browser uses standard Service Worker, Cache Storage, Web Crypto, and IndexedDB APIs. For a future Worker deployment, serve the same shell routes at `/offline/` over HTTPS, and map `/api/staff/offline` and its manifest and image routes to authenticated handlers backed by D1 and private R2. Keep the cache allowlist limited to application files. Return a new revision on every replacement, including photo-only changes, and reject image requests for stale revisions. Apply the same staff identity checks as the editor. Bump the shell cache version whenever shipping a change to a cached file. This implementation runs on the existing Node sharing server and has no Cloudflare resource dependencies.

## Synthetic acceptance test

1. On Chrome desktop or the Galaxy Z Fold 7, open the synthetic app at a trusted HTTPS address (localhost is suitable on desktop). Install it and download a complete three-room sample.
2. Turn off Wi-Fi and mobile data on the phone, or disconnect the desktop from the server. Close the app, launch it from its icon, and unlock with the device passphrase.
3. Follow Living room → Kitchen → Bedroom → Kitchen → Living room. Pan and zoom in each room. Check the read-only indicator.
4. Reconnect. From the staff dashboard replace the test apartment with a revised synthetic package. On return to the offline screen, check for **Update available**, then re-download.
5. Try a wrong passphrase, an expired copy, cancellation during a multi-apartment download, and removing a copy. Check that guest credentials cannot download tours.

Local verification covered a complete three-room download, closing the browser tab, reopening with the local server stopped, navigating all four doorway links, and detecting and downloading a replacement in Chrome. Chrome offered the install prompt. Standalone launch and physical Fold testing remain open.
