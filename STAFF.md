# Staff editor and guest sharing

Open /staff on your approved pilot URL. Direct links to the editor also open staff sign-in if the session has ended. This deployment is a synthetic pilot.

See [the pilot handoff](PILOT.md) for the six-step Fold 7 checklist, account onboarding and recovery, first approved apartment import, and backup restoration before publication. New `.shtour.zip` exports are password-encrypted; protect older plaintext `.shtour` files in approved storage.

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

## Panorama-first workflow

**Upload Stitches is a dedicated photo workspace.** Drop completed stitched JPEGs or a ZIP into the large upload area, or choose Add Stitch. Review files before saving. The optional room list is on the left and uploaded-photo cards on the right (stacked on phones). Cards offer a real thumbnail, 360° preview, Rename, Replace Stitch and confirmed Delete. Room-group dropdowns assign viewpoints by name only; multiple viewpoints can share a group. Add Room can attach an existing stitch, and Rename Room updates the group name. No map, Fit/Zoom, connectors or navigation warnings appear on this page, and no room assignment or spatial placement is required to continue.

Controls follow the stage: photo management/backups in Upload; panorama destination handles and doorway Undo in Connect; map, Fit/Zoom, Reset/checkpoint/regeneration and layout Undo in Review Layout; visitor preview, collapsible review and explicit Publish in Preview & Publish. To undo an exclusion made during preview, return to Connect or Review Layout and choose Undo.

1. **Upload Stitches**: use ADD STITCH for completed stitched JPEGs/ZIP, review names and images, and save. All images remain available without map placement.
2. **Connect Rooms**: click a room name to open it. Drag a destination handle onto the actual doorway; the outgoing direction saves as Positioned immediately. Open the destination and drag the original room onto the return doorway. Select a handle and tap as the touch/keyboard fallback.
3. **Review Layout**: the saved doorway graph generates a stable relationship diagram from the starting viewpoint. Unconnected viewpoints occupy a labeled section. Move tiles to clarify the diagram; neighboring tiles never create doors in panorama mode. Regenerate Layout has confirmation and Undo. This is not a measured floor plan. Complex cyclic graphs may still benefit from manual adjustments.
4. **Preview & Publish**: preview is always available. Tour Review starts collapsed and identifies each blocker or warning by viewpoint and direction. A disconnected but valid viewpoint is a warning and remains in the room selector. Use Exclude unused stitch to omit it intentionally without deleting its JPEG. Active links into excluded rooms must be removed or retargeted before publishing.

Completed directions are green and say Positioned. A return says Needs position until independently placed. The old generic warning combined unplaced grid tiles and pending arrows; it did not distinguish an already saved outgoing direction from its return or older pending manual links. These are now separate named review items. A successful drop never makes a second pending copy of that direction. Intentional additional doorways still use the explicit extra-door checkbox.

Exclusion and inclusion support Undo and travel with the full .shtour package. Guest manifests and offline downloads contain only active viewpoints; protected APIs deny excluded JPEG requests. Staff retain all originals in the full draft and backup. Missing required images, invalid coordinates, pending active arrows and broken destinations are publication blockers. No active viewpoint is silently omitted merely because it is disconnected or absent from the map.

Existing nonempty tours keep their legacy map and connection rules on open. Choose **Use panorama connections** explicitly to preserve their saved positions/links while stopping adjacency from creating doors. The earlier mode is checkpointed and supports Undo. Regenerate or exclude on a legacy tour asks before changing its workflow. No saved apartment is automatically rearranged.

## Existing controls and legacy grid workflow

1. The **Apartment Gallery** is the staff home. Choose **NEW APARTMENT** for a genuinely blank private draft and name it. Cards offer **View**, **Edit**, **Share** and expandable management controls. **Guest Links** is a separate page.
2. In **1. Upload Stitches**, choose **ADD STITCH** for one or multiple stitched JPEGs or a ZIP. Review previews and suggested names; add a viewpoint, skip it or replace an existing one. **Upload and save draft** shows progress and **Retry save** after failure. All photos remain in the left filmstrip, including Unplaced ones.
3. **ADD ROOM** names a room and attaches an existing stitch or uploads a new one. Without a stitch it stays incomplete. Reuse a room name to group viewpoints; give each viewpoint a distinct label.
4. In **3. Review Layout**, drag photos onto empty cells or select a photo and tap a cell. Name viewpoints directly on their tiles. Select a tile to highlight its photo. Fit, zoom, keyboard arrows and Column/Row controls provide alternatives.
5. In **2. Connect Rooms**, pan to a doorway and drag its destination room handle from the strip onto it. A click on a room name still switches rooms. The outgoing arrow saves immediately and its reciprocal stays **Needs position** until placed in the destination panorama. Drag an existing arrow to reposition it. On touch or keyboard, select a handle then tap the doorway, or press Enter to place at the current view centre. Escape or Cancel placement exits this mode. Choose the starting viewpoint.
6. In **4. Preview & Publish**, explore every room and both directions. For legacy grids, incomplete rooms, unplaced photos and missing arrow positions block publication. Panorama tours use the named review blockers above. Changes automatically save to a private cloud draft. Reopen **Edit** from another device to check persistence; after a conflict, reload the latest draft before editing.
7. Choose **Publish apartment** explicitly, or **Publish latest draft** in the Gallery. Allow about a minute for new KV images. Guests keep the previous publication until then. **Unpublish** withdraws guest access immediately. **Remove** hides an apartment from staff and guests; export a backup first.

JPEG limits are 4 MiB per image and 8192 × 4096 pixels at approximately 2:1. A ZIP can contain up to 64 entries, must be at most 32 MiB compressed, and can declare at most 48 MiB extracted. A review batch accepts up to 24 images and a tour accepts up to 12 viewpoints. Unsafe paths, nested archives, unsupported ZIP formats, excessive expansion and corrupt data are rejected. Byte-for-byte duplicates are flagged. A 2:1 JPEG can still be a cropped or unstitched image, so check its preview and its 360° view.

## Visual room grid

The hosted catalog is a Gallery: each card shows the apartment's starting image, title and private/published/archived state, with its existing edit, backup, publication and lifecycle controls. Thumbnails require a current staff session and load as cards approach the viewport. They use the existing JPEGs; no separate image-processing service or storage product is used.

For a saved legacy-grid tour, the grid remains the layout workspace in **Review Layout**. New panorama tours use Connect Rooms first. Desktop and unfolded layouts keep the vertical filmstrip on its left. Folded phones use a horizontal photo drawer; **Photos** opens or collapses it. Drag only **Drag / Select** or **Move** handles; touch elsewhere to scroll. Panorama panning is in the next step. The grid adapts to occupied cells up to 8 × 8, with Fit and zoom. Keyboard arrows on a Move handle, tap-to-place and Column/Row controls are alternatives to dragging.

In legacy mode only, tiles sharing an edge create a suggested two-way connection. In panorama mode, adjacency never creates connections. A shared wall does not prove there is a doorway: tap its connector to remove or restore it. Removed edges stay disabled after movement. Use **Connect selected to → Connect rooms** for nonadjacent rooms. Moving or unplacing a tile retains its existing navigation; remove unwanted connections explicitly. Existing arrow angles stay attached to retained connections. Restoring a removed connection requires placing its new arrows again.

Right-click a filmstrip photo or tap **⋯** for **Replace Stitch**, **Rename Viewpoint**, **Remove from Grid** or **Delete Stitch**. Replacement validates and previews the JPEG, preserving viewpoint identity, layout, connections and arrow angles. Review arrows if the camera orientation changed. Removing from Grid returns the photo to Unplaced and retains its links. Delete requires confirmation and removes that viewpoint and inbound arrows from the private draft. Guests keep their published version.

A legacy grid suggests **which** rooms connect; in panorama mode saved doorway connections define the diagram. dropping a destination handle can also create a manual connection directly. Each direction below it shows **Needs position** or **Positioned**. Choose a pending direction to open that panorama, then tap its actual doorway. A positioned direction opens an information label instead. Repeat in the destination panorama for the return. New connections have no guessed coordinates, and publication is rejected until every arrow is positioned. Visitor preview hides pending arrows and warns about them.

Layout, manual links, disabled edges and arrow positions save with the versioned cloud draft and travel in `.shtour` backups. Earlier tours and packages without a grid still work. These edits do not change a live guest publication until **Publish latest draft** is chosen. Offline downloads use the latest complete staff draft and retain their existing access restrictions.

The Gallery groups historical Willow/Maple/Cedar synthetic copies under the latest saved record in each family. **Show all saved synthetic demo records** reveals every older record. This display setting never changes stored tours or guest permissions.

## Reset Layout and Undo

New apartments have an empty grid. New JPEG/ZIP stitches appear only in the filmstrip as **Unplaced** until Review Layout generates the relationship diagram or staff arrange them. Opening an existing apartment never resets its saved layout. Importing a complete .shtour backup restores its saved layout.

**Reset Layout** is visible beside Undo and requires confirmation. It affects only the current private apartment: every viewpoint becomes Unplaced, grid coordinates and inferred connections are cleared, and uploaded JPEGs, names and IDs remain. Explicit manual doorways stay attached to their viewpoints. Older connections already recorded as manual are retained conservatively. Guests keep the previous publication.

**Undo** reverses up to 20 recent placements, moves, connector changes and doorway edits in the current editor session, saving each reversal as a new cloud revision. Reset supports immediate Undo. After a refresh, recent-action Undo is empty; **Restore Reset Checkpoint** restores the first pre-reset layout and navigation stored separately in the D1-backed draft. Later moves, saves and resets never overwrite this checkpoint. JPEG replacements and names remain current. If viewpoints were added or deleted, use the complete backup when the checkpoint no longer matches their IDs.

Export a complete .shtour before substantial changes. Packages retain the checkpoint as well as the current layout and original JPEGs. The checkpoint contains layout/navigation only, not another image copy. It is staff-only metadata and is excluded from guest manifests. Both reset and restore retain stale-save protection.

## Direct room-to-doorway placement

Drag the visible **⠿** handle on a room chip onto the actual doorway in the current panorama. Mouse users can also drag the room button. The panorama highlights during the drag and a temporary arrow follows the pointer; dragging a handle suppresses panorama panning. Touch the room-name portion to scroll the strip horizontally or tap it to open that viewpoint. The room strip stays beneath the panorama while editing.

A default drop positions the existing pending doorway to that viewpoint, or repositions its existing arrow. When no connection exists it creates a two-way manual connection; the reverse has no guessed coordinates. Open the destination and drag the original room handle to its return doorway. To intentionally add a second door to the same viewpoint, enable **New doorway to the same viewpoint** before dropping. Each paired door can be edited or removed independently. A viewpoint cannot link to itself; separate viewpoints with the same name remain distinct.

Undo reverses accidental drops. Saving preserves keyboard focus, and the status area announces outcomes. These controls appear only in authenticated staff Place Doorways mode. Guest, preview and offline room buttons remain navigation-only.

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


## Direct doorway objects

In **Connect Rooms**, click an already positioned arrow to inspect its source and destination; click elsewhere to dismiss the label. Drag the arrow onto the corrected doorway to move it. The panorama remains visible, and the return direction keeps its existing position. Escape or an out-of-bounds drop cancels without saving. **Undo** restores a completed move.

Double-click an arrow (double-tap on touch), or focus it and press Delete/Backspace, to open **Delete doorway connection?** Cancel keeps everything. Confirm removes that exact paired doorway and return; other doors to the same room and all JPEGs remain. Undo restores the pair. If older data has no reliable pair identity, the dialog explains that deletion is blocked rather than guessing a return. Keep a backup and have that legacy relationship reviewed.

Keyboard users can press Enter/Space to inspect a focused arrow and Shift+Arrow keys to adjust it by 0.03 radians. New/pending doorways still use destination handles and the select-handle/tap-panorama fallback. Guest and Preview arrows still navigate on click. These edits save only the private draft until explicit publication.

## Guest Links gallery

Open **Guest Links** for thumbnail cards showing publication separately from invitation status. Drafts cannot be shared. **Group / Mass Share** reveals checkboxes and an expiration menu; select published apartments and choose **Copy Link for Selected**. Confirm creation of one protected invitation for exactly that selection. The default is three UTC calendar months, clamped to the target month's final day when necessary; one, seven and thirty days and six calendar months are also available. The server calculates these presets.

Use **Copy Invitation (recommended)** in the result to include URL, phrase, expiration and apartment names. Link-only and QR sharing require sending the phrase separately. **Email (opens mail app)** opens an external mail application with a prepared invitation; the application does not send email directly. Copy Link remains a primary option; use Copy Invitation to include the required phrase. SMS sharing has been removed. A future dedicated-account Gmail API integration is not configured; this change adds no OAuth flow or credentials. QR generation is local; Save PNG works where image clipboard access is unavailable. Never store invitation images or phrases publicly.

Individual cards offer new invitation creation after confirmation when usable credentials are unavailable. Newly created credentials remain only in the current page's memory. Refreshing the page loses them; the server cannot recover plaintext phrases or original links. Existing invitations remain manageable below the gallery: edit selection, regenerate phrase or confirm revocation. Regeneration ends earlier sessions and requires the original link. New invitations do not replace unrelated ones. Cards refresh periodically and when the page regains focus.

### Toolbar availability

The Guest Links toolbar is now part of the authenticated HTML response, above the gallery. It remains visible before JavaScript initializes; sharing interactions still require JavaScript. Group / Mass Share toggles the submenu, selection checkboxes and highlighted button. Zero-selection creation is disabled. If controls are missing, confirm the page is /staff/guest-links rather than /staff (Apartment Gallery), then reload. No missing-control root cause was reproduced in a fresh live session; see LOGBOOK.md for baseline and verification evidence.


## Administrator permissions and Staff access

The site remains login-only. Client is a reserved read-only role; there is no public apartment gallery or public registration. Existing private invitations still work for recipients selected by staff/supervisors. Copy Link and Copy Invitation remain available; Email opens a prepared message in an external mail app. There are no recipient allowlists, domain checks, approval steps, Gmail integration or SMS.

Administrators open **User Access Control** from the Gallery. **Users** shows status, last recorded login, effective permissions and role assignment. **Staff Accounts** retains account creation, reset and enable/disable. A role change ends that account's sessions; the final active Administrator cannot be demoted or disabled. The stored `editor` label is retained only for compatibility and displayed as Staff.

**Role Permissions** sets ordinary role defaults; protected Administrator controls and Client authoring restrictions cannot be delegated. **Individual Permissions** chooses Inherit, Allow or Deny for ordinary actions and explains the current result. Protected Administrator actions cannot be delegated. **Apartment Access** chooses All or Selected apartments; filtering preserves selection until explicit Save. An individual Allow does not bypass an apartment restriction. A newly created apartment is automatically included in a permitted creator's selected assignment. **Access History** shows recent policy changes and activity without secrets. Save changes explicitly; concurrent stale saves require reloading.

Staff see assigned apartments and permitted controls. Viewing without editing opens the existing tour preview read-only. Direct API requests are also checked, including private images, invitations, publication and backup workflows. Permission changes apply to subsequent online requests; reload to refresh visible controls after an Administrator changes access. Offline downloading/vault behavior is unchanged, and disconnected copies retain the previously documented expiry/revocation limitations.


New backup exports are password-encrypted `.shtour.zip` files. Enter and confirm a separate backup password, store it separately, and restore through the app; older unencrypted `.shtour` imports remain supported. See [encrypted backup instructions and recovery limits](BACKUPS.md).


## Uploads Gallery — collecting photos from phones and tablets

An Administrator opens **Apartment Gallery → Manage Uploads**, checks apartment cards (including blank drafts), then chooses **Add Selected to Uploads** or **Remove Selected from Uploads**. List membership is separate from publication and guest invitations. Removal only removes the card from Uploads; it never deletes images, drafts or tours. Re-enter Manage Uploads to change the list. Historical demo records are individually selectable in this mode.

To designate a Supervisor, use **User Access Control → Individual Permissions**, choose the Staff user, set **Manage Uploads Gallery (Supervisor) → Allow**, and save. Supervisor is still a Staff account with its existing apartment scope. This permission cannot be enabled for the entire Staff role. Administrators always retain queue management. Regular Staff see no Manage Uploads button and cannot change the list through APIs.

Staff open **Uploads Gallery**, choose **Upload Photos**, and select completed stitched JPEGs or ZIPs. The same existing validation, thumbnail review, suggested names, duplicates, progress and Retry save apply. Add a viewpoint or Skip; replacement/deletion and room connections remain in the full editor. New images become Unplaced viewpoints in the selected apartment's private cloud draft. They are not published. Multiple viewpoints can share a room name. Existing photos, names, grid, arrows and guest publication stay intact. Upload permission and apartment scope are required even when queued; editor permission is not required for this additive workflow.

After a stale revision error, cancel review, choose **Reload latest draft**, then select/review the files again. Ambiguous interrupted saves should also be checked by reloading; duplicate detection helps prevent accidental repeated additions. Failed photo writes may leave bounded unreferenced reservations for the existing safe cleanup process, but no failed save adds phantom viewpoints. New KV images may briefly need time to synchronize before another device loads them. Phone/tablet upload collection does not add mobile tour-authoring controls.

The Gallery shows current draft photo counts and the most recent successful quick-upload summary. Access History records queue changes per apartment, binary upload attempts/failures and successful saved viewpoint counts. Local validation failures are shown on the device; invalid file bytes/names are not sent just to log them. Existing JPEG/ZIP/viewpoint and quota limits above still apply.
