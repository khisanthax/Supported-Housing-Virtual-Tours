# Multi-apartment guest sharing

The guest-sharing service is a separate, zero-dependency Node.js server. The existing static editor and owner-private GPT Site continue to work. The static Site does not run this server, and its ChatGPT sign-in gate cannot offer the account-free guest flow as currently configured. No hosting audience or real image publication was changed.

## Run the synthetic demo

Use Node.js 24 or newer with built-in SQLite. From this project directory in PowerShell:

```powershell
$env:TOUR_STAFF_PASSPHRASE = Read-Host 'Choose a local staff passphrase (16+ characters)' -MaskInput
$env:TOUR_DATABASE = Join-Path $env:TEMP ('apartment-tour-demo-' + [guid]::NewGuid() + '.sqlite')
npm run start:sharing -- --synthetic
```

Open [http://localhost:4180/staff](http://localhost:4180/staff). The three sample apartment records use synthetic panoramas. Links generated on localhost work only on that computer. After stopping the server, clear the environment variable with `Remove-Item Env:TOUR_STAFF_PASSPHRASE`. Keep the staff passphrase separate from any guest passphrase.

## Staff and guest workflow

1. Sign in at **/staff**. Open the existing **Tour editor** to make or edit a tour. Export a complete `.shtour` and import it in the staff dashboard. A new entry stays private until selected for a link. Replacing an existing entry updates it for guests with current access and marks older offline copies as updateable. Tours with unpositioned return arrows are rejected.
2. Choose **Create Guest Link** and check the apartments this guest should see. Enter a passphrase of at least 12 characters and set the expiration using your device's local time zone.
3. Copy the URL when it appears. The dashboard retains the link's record, apartment selection and status, but does not retain a recoverable copy of its secret URL. Send the passphrase separately. If the URL is lost, revoke the old link and create a new one.
4. The guest opens the URL, enters its passphrase, and can move between the authorized catalog and each tour without signing in again. There is no guest account. A session lasts at most eight hours and never outlives its link.
5. **Edit apartment selection** invalidates all sessions for that link. Guests can reopen the original URL with the same passphrase for the new selection. **Revoke link** ends access immediately and prevents future unlocks. The list shows active, expired and revoked records.

The link and passphrase grant access to whoever holds both. They do not verify a person's identity or prevent a guest from saving an image already received. Revocation blocks future server requests; it cannot erase previously downloaded data.

## Data and hosting

- **Private server data:** `private-data/guest-sharing.sqlite` by default, or `TOUR_DATABASE`. It holds catalog records, manifests, original JPEG bytes, share permissions, salted passphrase hashes, and hashed guest session identifiers. Staff sessions are in process memory and end on server restart. The editor's separate IndexedDB draft does not become server data until staff import a package.
- **Backup:** Stop the server and copy its SQLite database to an approved private location. Also keep original `.shtour` backups. A restored database represents the old access state: before bringing a restored copy online, clear guest sessions and review or revoke restored shares so a backup cannot inadvertently re-enable old access. Keep database files out of static hosting, source control and public folders.
- **Reachable links:** The default binds only to loopback. To serve guests elsewhere, run on an approved existing host, configure `TOUR_ORIGIN` to its exact externally reachable HTTPS origin, `TOUR_PORT` and `TOUR_BIND` as needed, and set `TOUR_TLS_CERT` and `TOUR_TLS_KEY` to trusted PEM files. The service refuses to start outside loopback without TLS. A certificate, firewall, public reachability and operations have not been provisioned. There is no paid dependency, but an available approved host is required for external use.
- **Access checks:** The server matches a hashed guest cookie to an active, unexpired share revision and checks its apartment allowlist on every catalog, tour page, manifest, thumbnail and panorama request. Staff routes use a separate session. Sensitive responses use `no-store`; HTTPS cookies are Secure, HttpOnly and SameSite. Random URLs and session secrets use 256 bits from Node crypto. Passphrases use per-share salts and scrypt following [OWASP's password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Unlock attempts are rate limited per client address and concurrent hashing is bounded.
- **Current limits:** A catalog card uses the authorized start-room JPEG as its image; it is not a separately resized thumbnail. The service is intended for a single Node process and a single staff credential. Do not put it behind an unconfigured proxy or assume it is ready for anonymous Internet traffic at scale.

## Verification

See [staff offline tours](OFFLINE.md) for installation, storage, and device testing.

Run `npm test`. The sharing integration test seeds three synthetic apartments. It verifies two-apartment access with one session, rejected requests for an unselected apartment and staff routes, no-store assets, wrong passphrase handling, cross-origin write rejection, package import, permission changes, revocation, expiry, rate limiting and persisted permission records. Public HTTPS deployment and physical Android guest sharing have not been tested.

Desktop browser testing covered staff sign-in, two checked apartments, link generation, one guest unlock, doorway navigation, and switching apartments without another prompt. Changing the selection removed the existing guest session; reopening the same URL with its passphrase showed the revised selection. Revocation removed the catalog on the next request. The staff editor still opened with its sample tour. The guest catalog fit a 390-pixel viewport without horizontal scrolling. See `qa/guest-catalog-mobile.png` for the synthetic catalog.
