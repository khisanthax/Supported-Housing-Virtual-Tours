# Staff editor and guest sharing

Open /staff on your approved pilot URL. Direct links to the editor also open staff sign-in if the session has ended. This deployment is a synthetic pilot.

See [the pilot handoff](PILOT.md) for the six-step Fold 7 checklist, account onboarding and recovery, first approved apartment import, and backup restoration before publication. `.shtour` packages are unencrypted; save them in the approved encrypted backup location.

## Initial administrator

In password mode, sign in at **/staff** with your username and password. An Administrator uses **Manage staff accounts** to create users, set or reset their passwords, and disable access. Staff Editors can edit tours and manage guest sharing without access to account administration. Use a separate password for each staff member and share initial or reset passwords privately. A reset or disable ends that account's active sessions. See the [deployment guide](DEPLOYMENT.md) for initial bootstrap.

Open **Manage staff accounts** again after signing back in if your session expires. Arrange for a second Administrator or an operator recovery procedure before enrolling real staff so an Administrator can recover access if they lose their password.

For a pilot configured with Firebase, use **Username** and **Password** on the staff sign-in page. An administrator creates Firebase users and links them to a role in the staff workspace. Use **Manage staff accounts** to send a reset email or disable app access. See the [deployment guide](DEPLOYMENT.md) for bootstrap and acceptance checks.

The following shared-passphrase procedure is for a legacy rollback configuration only. The current pilot uses individual username/password accounts above.

The pilot uses one administrator passphrase. Cloudflare account authorization lets the account operator set or rotate its SHA-256 verifier through Wrangler. The passphrase itself is generated with 256 bits of randomness and is never stored in Cloudflare, source code, or application logs.

On the Windows account used for enrollment, open PowerShell in the repository and run:

```powershell
pwsh -NoProfile -File .\cloudflare\enroll-staff.ps1
```

The script copies the passphrase to the clipboard from a DPAPI-encrypted file under `%LOCALAPPDATA%\SupportedHousingTour`. Paste it into the staff sign-in page or a password manager to use it on another device. Clear the clipboard when finished. This is a credential retrieval command and does not start a local server. To enroll again or replace a lost passphrase, an authorized Cloudflare operator can add `-Rotate`. Existing staff sessions expire within eight hours or can be ended with **Sign out**. There is no public registration or per-person staff account in this pilot.

## Build and publish a tour

1. The **Apartment Gallery** is the staff home. Choose **NEW APARTMENT** for a genuinely blank private draft and name it. Cards offer **View**, **Edit**, **Share** and expandable management controls. **Guest Links** is a separate page.
2. In **1. Upload Photos**, choose **ADD STITCH** for one or multiple stitched JPEGs or a ZIP. Review previews and suggested names; add a viewpoint, skip it or replace an existing one. **Upload and save draft** shows progress and **Retry save** after failure. All photos remain in the left filmstrip, including Unplaced ones.
3. **ADD ROOM** names a room and attaches an existing stitch or uploads a new one. Without a stitch it stays incomplete. Reuse a room name to group viewpoints; give each viewpoint a distinct label.
4. In **2. Arrange Rooms**, drag photos onto empty cells or select a photo and tap a cell. Name viewpoints directly on their tiles. Select a tile to highlight its photo. Fit, zoom, keyboard arrows and Column/Row controls provide alternatives.
5. In **3. Place Doorways**, choose each direction marked **Needs position**, pan to its real doorway and tap it. Repeat for the return. Positioned directions can be moved; destinations and two-way arrows can be changed or deleted. Choose the starting viewpoint.
6. In **4. Preview & Publish**, explore every room and both directions. Incomplete rooms, unplaced photos and missing arrow positions block publication. Changes automatically save to a private cloud draft. Reopen **Edit** from another device to check persistence; after a conflict, reload the latest draft before editing.
7. Choose **Publish apartment** explicitly, or **Publish latest draft** in the Gallery. Allow about a minute for new KV images. Guests keep the previous publication until then. **Unpublish** withdraws guest access immediately. **Remove** hides an apartment from staff and guests; export a backup first.

JPEG limits are 4 MiB per image and 8192 × 4096 pixels at approximately 2:1. A ZIP can contain up to 64 entries, must be at most 32 MiB compressed, and can declare at most 48 MiB extracted. A review batch accepts up to 24 images and a tour accepts up to 12 viewpoints. Unsafe paths, nested archives, unsupported ZIP formats, excessive expansion and corrupt data are rejected. Byte-for-byte duplicates are flagged. A 2:1 JPEG can still be a cropped or unstitched image, so check its preview and its 360° view.

## Visual room grid

The hosted catalog is a Gallery: each card shows the apartment's starting image, title and private/published/archived state, with its existing edit, backup, publication and lifecycle controls. Thumbnails require a current staff session and load as cards approach the viewport. They use the existing JPEGs; no separate image-processing service or storage product is used.

The grid is the primary workspace in **Arrange Rooms**. Desktop and unfolded layouts keep the vertical filmstrip on its left. Folded phones use a horizontal photo drawer; **Photos** opens or collapses it. Drag only **Drag / Select** or **Move** handles; touch elsewhere to scroll. Panorama panning is in the next step. The grid adapts to occupied cells up to 8 × 8, with Fit and zoom. Keyboard arrows on a Move handle, tap-to-place and Column/Row controls are alternatives to dragging.

Tiles sharing an edge create a suggested two-way connection. A shared wall does not prove there is a doorway: tap its connector to remove or restore it. Removed edges stay disabled after movement. Use **Connect selected to → Connect rooms** for nonadjacent rooms. Moving or unplacing a tile retains its existing navigation; remove unwanted connections explicitly. Existing arrow angles stay attached to retained connections. Restoring a removed connection requires placing its new arrows again.

Right-click a filmstrip photo or tap **⋯** for **Replace Stitch**, **Rename Viewpoint**, **Remove from Grid** or **Delete Stitch**. Replacement validates and previews the JPEG, preserving viewpoint identity, layout, connections and arrow angles. Review arrows if the camera orientation changed. Removing from Grid returns the photo to Unplaced and retains its links. Delete requires confirmation and removes that viewpoint and inbound arrows from the private draft. Guests keep their published version.

The grid chooses **which** rooms connect. Each direction below it shows **Needs position** or **Positioned**. Choose a direction to open that panorama, then tap its actual doorway. Repeat in the destination panorama for the return. New connections have no guessed coordinates, and publication is rejected until every arrow is positioned. Visitor preview hides pending arrows and warns about them.

Layout, manual links, disabled edges and arrow positions save with the versioned cloud draft and travel in `.shtour` backups. Earlier tours and packages without a grid still work. These edits do not change a live guest publication until **Publish latest draft** is chosen. Offline downloads use the latest complete staff draft and retain their existing access restrictions.

The Gallery groups historical Willow/Maple/Cedar synthetic copies under the latest saved record in each family. **Show all saved synthetic demo records** reveals every older record. This display setting never changes stored tours or guest permissions.

## Send an invitation

Create a guest link, select the published apartments and set an expiration. Choose a three-, five-, or seven-word phrase. Copy the link and phrase separately if you can send them through different channels. **Copy Invitation** includes both in one message when that is more convenient. Guests can enter the words with spaces or hyphens in any capitalization. Older codes remain valid until expiry or regeneration. **Regenerate phrase** keeps the original link and immediately ends existing sessions. Keep the original link when you create it, since the server stores only its digest.

The English BIP-39 list contains 2,048 words with distinct first four characters. Each independently selected word contributes 11 bits. Three, five, and seven words provide 33, 55, and 77 bits respectively, compared with the old 128-bit code. The separate random share URL remains required. The server keeps a keyed verifier and limits unlock attempts in D1 by both client IP and share. A person holding the link can temporarily exhaust its per-minute allowance. A shared invitation can be forwarded. [Wordlist source](https://github.com/bitcoin/bips/tree/master/bip-0039)

## Storage, backup, and limits

D1 stores versioned manifests, room names, arrow positions, JPEG references, visibility, guest permissions, and session state. The existing private KV namespace stores JPEG bytes under immutable keys. A failed upload or a conflicting draft save cannot replace a published version. The Worker enforces a 400 MB pilot reservation ceiling and an 800-upload daily budget before writing to KV. Other workloads can consume the account's quota, which Cloudflare enforces separately. [KV limits](https://developers.cloudflare.com/kv/platform/limits/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

Export **.shtour** from the editor or catalog to back up the latest draft and its images. Import creates or replaces a private draft. Blank apartments, unplaced stitches and explicitly missing images are supported by current backups. Older completed packages still import; older application versions may not read these incomplete packages. Share links, login credentials, and publication state are outside the portable package. **Clean up unused storage** prunes a bounded batch of superseded versions and deletes unreferenced JPEGs older than 24 hours. The current draft, current publication, and warming publications are retained. Run cleanup again to process another batch.

See LOGBOOK.md for verification history and outstanding checks.

## Archived and offline tours

Use **Archive** to withdraw a tour from guests and offline downloads while keeping the latest draft and its backup available to staff. **Restore as draft** keeps the apartment unpublished until staff explicitly publish again. Existing viewpoint order and starting-room selection remain part of the cloud draft and backup.

Open **Available Offline** while signed in to download selected tours to this device. Set a separate local vault passphrase and save only tours needed on the device. Reopen the installed app while disconnected and unlock the vault to view saved tours. Downloads expire after the configured offline window (24 hours by default). Online checks can detect archives, changes and expired staff sessions. A disconnected device cannot receive a remote revocation. Sign out while online to clear the local vault. The browser or operating system can reclaim local storage, so keep a separate backup.

## Capacity and troubleshooting

The pilot reserves up to 400 MB of JPEG data, including current drafts, published revisions and uploads awaiting cleanup. For 175 panoramas, aim for 1.5 MiB per image on average to leave room for editing and retained versions. The individual 4 MiB upload limit can be used for a few larger images. If an image upload is interrupted, retry from the review screen. If the storage ceiling is reached, export any needed backups, then use **Clean up unused storage** before retrying. Cleanup retains active versions and gives unreferenced uploads a grace period.

For **Photo is still preparing**, allow the new KV revision to propagate and try again. If an editor reports that a draft changed, reopen the latest draft before continuing. If a guest sees an access error, confirm the share is active and the intended apartments are published. If the browser reports that offline storage is incomplete, reconnect, sign in, and download the tour again.
