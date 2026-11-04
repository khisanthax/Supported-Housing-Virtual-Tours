# Staff editor and guest sharing

Open /staff on your approved pilot URL. Direct links to the editor also open staff sign-in if the session has ended. This deployment is a synthetic pilot.

## Initial administrator

In password mode, sign in at **/staff** with your username and password. An Administrator uses **Manage staff accounts** to create users, set or reset their passwords, and disable access. Staff Editors can edit tours and manage guest sharing without access to account administration. Use a separate password for each staff member and share initial or reset passwords privately. A reset or disable ends that account's active sessions. See the [deployment guide](DEPLOYMENT.md) for initial bootstrap.

For a pilot configured with Firebase, use **Username** and **Password** on the staff sign-in page. An administrator creates Firebase users and links them to a role in the staff workspace. Use **Manage staff accounts** to send a reset email or disable app access. See the [deployment guide](DEPLOYMENT.md) for bootstrap and acceptance checks.

For the shared pilot configuration:

The pilot uses one administrator passphrase. Cloudflare account authorization lets the account operator set or rotate its SHA-256 verifier through Wrangler. The passphrase itself is generated with 256 bits of randomness and is never stored in Cloudflare, source code, or application logs.

On the Windows account used for enrollment, open PowerShell in the repository and run:

```powershell
pwsh -NoProfile -File .\cloudflare\enroll-staff.ps1
```

The script copies the passphrase to the clipboard from a DPAPI-encrypted file under `%LOCALAPPDATA%\SupportedHousingTour`. Paste it into the staff sign-in page or a password manager to use it on another device. Clear the clipboard when finished. This is a credential retrieval command and does not start a local server. To enroll again or replace a lost passphrase, an authorized Cloudflare operator can add `-Rotate`. Existing staff sessions expire within eight hours or can be ended with **Sign out**. There is no public registration or per-person staff account in this pilot.

## Build and publish a tour

1. Choose **Start an apartment**, then **Edit Tour**. The editor starts with a synthetic sample. Choose **Replace draft from JPEGs or ZIP** for a fresh tour, or **Add JPEGs or ZIP** to add to an existing draft.
2. Select stitched JPEGs or a ZIP. Review each preview and suggested name. Assign it as a new viewpoint, skip it, or replace an existing viewpoint. To add two viewpoints to one room, give them the same room name or use labels such as “Living room · entry” and “Living room · window”.
3. Choose **Upload and save draft**. The review dialog shows progress and offers **Retry save** if something fails. Replacement keeps the existing viewpoint ID and its doorway connections.
4. Place and position both doorway arrows, choose the start room, and select **Preview as visitor**. Draft edits save as you work. Reopen the apartment from **Edit draft** on another signed-in device. If a device reports a conflict, reopen the latest draft before editing again.
5. Use **Publish latest draft** in the staff catalog. Allow about a minute for new KV images. Existing visitors can continue to see the previous publication during this window. **Unpublish** removes guest access immediately. **Remove** hides the apartment from staff and guests. Export a backup before removing an apartment you may need again.

JPEG limits are 4 MiB per image and 8192 × 4096 pixels at approximately 2:1. A ZIP can contain up to 64 entries, must be at most 32 MiB compressed, and can declare at most 48 MiB extracted. A review batch accepts up to 24 images and a tour accepts up to 12 viewpoints. Unsafe paths, nested archives, unsupported ZIP formats, excessive expansion and corrupt data are rejected. Byte-for-byte duplicates are flagged. A 2:1 JPEG can still be a cropped or unstitched image, so check its preview and its 360° view.

## Send an invitation

Create a guest link, select the published apartments and set an expiration. Choose a three-, five-, or seven-word phrase. Copy the link and phrase separately if you can send them through different channels. **Copy Invitation** includes both in one message when that is more convenient. Guests can enter the words with spaces or hyphens in any capitalization. Older codes remain valid until expiry or regeneration. **Regenerate phrase** keeps the original link and immediately ends existing sessions. Keep the original link when you create it, since the server stores only its digest.

The English BIP-39 list contains 2,048 words with distinct first four characters. Each independently selected word contributes 11 bits. Three, five, and seven words provide 33, 55, and 77 bits respectively, compared with the old 128-bit code. The separate random share URL remains required. The server keeps a keyed verifier and limits unlock attempts in D1 by both client IP and share. A person holding the link can temporarily exhaust its per-minute allowance. A shared invitation can be forwarded. [Wordlist source](https://github.com/bitcoin/bips/tree/master/bip-0039)

## Storage, backup, and limits

D1 stores versioned manifests, room names, arrow positions, JPEG references, visibility, guest permissions, and session state. The existing private KV namespace stores JPEG bytes under immutable keys. A failed upload or a conflicting draft save cannot replace a published version. The Worker enforces a 400 MB pilot reservation ceiling and an 800-upload daily budget before writing to KV. Other workloads can consume the account's quota, which Cloudflare enforces separately. [KV limits](https://developers.cloudflare.com/kv/platform/limits/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

Export **.shtour** from the editor or catalog to back up the latest draft and its images. Import creates or replaces a private draft. Share links, login credentials, and publication state are outside the portable package. **Clean up unused storage** prunes a bounded batch of superseded versions and deletes unreferenced JPEGs older than 24 hours. The current draft, current publication, and warming publications are retained. Run cleanup again to process another batch.

See LOGBOOK.md for verification history and outstanding checks.

## Archived and offline tours

Use **Archive** to withdraw a tour from guests and offline downloads while keeping the latest draft and its backup available to staff. **Restore as draft** keeps the apartment unpublished until staff explicitly publish again. Use the room order buttons to change the sequence without moving arrows or changing the start room.

Open **Available Offline** while signed in to download selected tours to this device. Set a separate local vault passphrase and save only tours needed on the device. Reopen the installed app while disconnected and unlock the vault to view saved tours. A downloaded copy expires 24 hours after download. Online checks can detect archives, changes and expired staff sessions. A disconnected device cannot receive a remote revocation. Sign out while online to clear the local vault. The browser or operating system can reclaim local storage, so keep a separate backup.

## Capacity and troubleshooting

The pilot reserves up to 400 MB of JPEG data, including current drafts, published revisions and uploads awaiting cleanup. For 175 panoramas, aim for 1.5 MiB per image on average to leave room for editing and retained versions. The individual 4 MiB upload limit can be used for a few larger images. If an image upload is interrupted, retry from the review screen. If the storage ceiling is reached, export any needed backups, then use **Clean up unused storage** before retrying. Cleanup retains active versions and gives unreferenced uploads a grace period.

For **Photo is still preparing**, allow the new KV revision to propagate and try again. If an editor reports that a draft changed, reopen the latest draft before continuing. If a guest sees an access error, confirm the share is active and the intended apartments are published. If the browser reports that offline storage is incomplete, reconnect, sign in, and download the tour again.
