# First apartment and Fold 7 handoff

The existing hosted application remains a synthetic pilot. Workers Free was reconfirmed in the authenticated dashboard on 5 November 2026: **Free · $0 · Current plan**. No upgrade or billing action was taken.

## Approved device scope (9 November 2026)

**Editing and administration are desktop-only workflows.** The owner accepted the desktop editor and the merged arrow interaction update (PR #24). Do not require physical Fold/phone testing of upload, panorama arrow editing, layout generation, staff administration, or publishing to close the editor milestone. Existing responsive editing support may remain, but it is not a release gate.

**Mobile remains a viewing device.** Before real-apartment rollout, validate viewing, room-to-room navigation, fullscreen/pan/pinch where applicable, PWA installation, encrypted offline download/unlock, airplane-mode reopen, and reconnect/update on a real phone/tablet. Do not interpret simulated viewport tests as physical-device acceptance. The legacy checklist below includes optional editing exercises from before this scope decision; skip those on mobile and perform authoring on desktop instead.

## Short physical Fold 7 test (viewer acceptance; legacy editor steps optional)

Use Chrome directly, rather than a link preview inside another app. Open the approved pilot at `/staff`. Use synthetic images throughout this test. No Android device was connected to the authorized ADB session during preparation.

1. Sign in. Choose **NEW APARTMENT**, name it “Synthetic Fold check”, and upload two stitched JPEGs. Use **Connect Rooms** immediately; name viewpoints from their photo menus. Changes save automatically; reload, and reopen that draft on the PC to confirm the same rooms and title.
2. In **Review Layout**, drag tiles by their **Move** handles. Confirm movement creates no phantom doorways; try Regenerate Layout and Undo. Existing legacy tours retain their original adjacency rules until explicitly converted. In **Connect Rooms**, drag a destination room handle onto its doorway, switch rooms by tapping its name, and drag the original room handle onto the return. Try moving an arrow, Undo, horizontal room-strip scrolling, and the handle/tap fallback. Confirm Reset Layout returns stitches to Unplaced and Undo restores them. **4. Preview & Publish**; follow both arrows, drag, pinch, and try fullscreen. Check folded portrait, landscape and unfolded layouts, and verify grid dragging never pans the panorama.
3. Open **Available Offline**, set a separate device passphrase, select the test apartment and download. Wait for **Ready Offline**, then use **Install app** or Chrome’s **Install app / Add to Home screen** menu.
4. Enable airplane mode **and turn Wi-Fi off**. Fully close the app. Launch it from its installed icon, unlock downloads, open each sphere and follow both doorway arrows. Confirm the status is Offline and editing is unavailable.
5. Reconnect. On the PC, rename a room and save. On the phone, return to Available Offline; expect **Update available** within one minute, download again, reopen the apartment, and confirm the renamed room. Offline viewing is read-only; reconnect downloads cloud changes rather than uploading offline edits.
6. Export `.shtour` from the Apartment Gallery, import it as **New apartment**, and preview the restored rooms/arrows. Sign out online; confirm reopening the editor asks for sign-in and downloaded tours are cleared. Remove only the disposable test apartments when finished.

For JPEG upload without real photos, staff can save the protected synthetic files `/staff/editor/images/living.jpg` and `/staff/editor/images/kitchen.jpg` while signed in. Keep the test private unless using an explicitly approved synthetic guest invitation. Report the failing step, folded/unfolded state, browser version and visible error; do not send passwords, guest codes or private photographs.

## Staff onboarding and recovery

An existing Administrator opens **Manage staff accounts**. Choose a unique username, select **Staff Editor** for normal tour work, enter a unique password of at least 15 characters, and choose **Create account**. Give the username and password privately. The staff member signs in from their own device and checks access to the intended workspace. Sessions expire after one hour; sign in again when prompted. No email account, organizational identity provider or public registration is required.

Keep at least two specifically designated Administrators if the agency approves, or name an authorized Cloudflare recovery operator. Do not create real staff or disable the owner's current account without those assignments. Administrators can edit all tours, manage sharing and manage accounts. Staff Editors can edit all tours and manage sharing, but cannot manage staff accounts. The application does not partition staff access by apartment or provide a forced first-login password change. Set a fresh private password through the Administrator when onboarding; retain it in the approved password manager.

For a forgotten password, another Administrator selects the account, chooses **Reset password**, enters a new password and applies it. Reset immediately invalidates earlier sessions. A disabled account must also be explicitly enabled. For a departure or lost device, choose **Disable account**; server access ends on the next protected request. A disconnected offline copy remains available until its local expiry and cannot be remotely revoked while disconnected.

The sole Administrator cannot reset or disable their own account in the page. If all Administrators lose access, use the guarded operator recovery procedure in [DEPLOYMENT.md](DEPLOYMENT.md). It requires the existing authorized Cloudflare connection, a password supplied through protected stdin, and a private temporary SQL file. Confirm exactly one recovered Administrator, delete the sensitive file, sign in with the replacement password, and verify earlier sessions fail. This procedure was exercised against a disposable live Administrator; it does not require account-wide administrator permission, a public reset page or Firebase email delivery.

## First real apartment — staff workflow without coding

Before upload, obtain explicit agency approval for **private Cloudflare storage**, the staff who may see it, any selected guest audience, and optional device downloads. Confirm a complete set of stitched 2:1 JPEGs, one per viewpoint, with room/viewpoint names and doorway destinations. Remove identifying paperwork, people or other sensitive details from the originals through the agency's approved process. Capture-frame ZIPs are not accepted as completed spheres.

The owner/operator must approve first real-content intake on the existing private application, review enabled synthetic accounts and invitations, and arrange named Administrators, recovery access and backup storage. Current synthetic labels and shared test access must not be treated as approval for agency content. Keep the public standalone demo and GitHub fixtures synthetic. Do not upload real photographs to GitHub Issues, PRs or the synthetic acceptance tests.

Once those approvals and the physical checklist are complete:

1. Sign in, choose **NEW APARTMENT**, then **ADD STITCH**. Select the completed JPEGs or their ZIP. Review every preview, suggested room name and viewpoint assignment. Skip capture frames or duplicates. Use the same room name with distinct viewpoint labels when needed. Uploaded stitches remain Unplaced until arranged.
2. Choose **Upload and save draft**. Retry an interrupted upload from the review screen. Each JPEG must be at most 4 MiB, approximately 2:1 and at most 8192 × 4096 pixels. ZIP limits and the shared storage ceiling are in [STAFF.md](STAFF.md). Aim for at most 1.5 MiB per image on average to leave room for revisions.
3. Name the apartment and connect stitches in **2. Connect Rooms**, then review the generated relationship diagram in **3. Review Layout**. Grid adjacency creates no doors in panorama mode. In **2. Connect Rooms**, drag a destination room handle onto the actual doorway, then open the destination and position its return. Select a handle and tap the doorway as a fallback. Choose the starting viewpoint; move or remove arrows as needed. Replace a photo on its existing viewpoint to retain navigation. Use **4. Preview & Publish** to review every room and both directions before publishing.
4. Return to the staff catalog and reopen **Edit** on a second device. Check the saved names, starting room, photos and arrows. Keep the apartment unpublished.
5. Choose **Export .shtour**, save it to the approved encrypted backup location, and perform the restore check below. Do not clear the original photos or remove the working draft yet.
6. Only the authorized publisher chooses **Publish latest draft** after the content, navigation and restore checks are accepted. New images may need about a minute to propagate. Create a guest invitation selecting only the approved published apartments; send its URL and code/phrase through the agreed channels. A private draft has no guest access.

No coding, AI, Firebase account setup or deployment is needed for staff to upload and connect rooms. Operator approval to start real-content use is separate from everyday editing.

## Backup and restore before publication

`.shtour` includes the apartment title, room/viewpoint names and ordering, starting room, complete doorway configuration and original JPEG bytes. **The package itself is unencrypted.** Save it only in an agency-approved encrypted location, with an agreed retention schedule and a second protected copy. Device offline storage is not a backup.

From the staff catalog, select the exported file under **Backups and storage → Apartment package**, keep **Import as → New apartment**, and choose **Import apartment**. It creates a separate private draft with a new apartment identity. Open its editor from another signed-in device and compare the starting room, every image, every room name and both directions of every arrow. Rename the disposable restore draft clearly. Only after the check passes should it be removed; retain the package and working apartment. Existing guest permissions do not transfer to a new apartment identity.

To recover an existing apartment while keeping its guest-link selection, first export its current draft, choose **Import as → Replace [apartment]**, and confirm. This replaces only the staff draft. Its current guest publication stays unchanged until **Publish latest draft** is explicitly chosen. Staff offline downloads use the latest draft and can detect this revision before it is published to guests.

The automated hosted rehearsal exported through the real catalog, removed the disposable source draft, restored it through the import form, compared the complete manifest and every JPEG byte, and retrieved the restored tour in independent Edge. It also tested replacement of a published synthetic fixture while its guest publication remained unchanged. Synthetic fixtures, invitations and disposable apartments were withdrawn afterward.

Tour packages omit staff accounts, roles, guest links, sessions and server secrets. The authorized operator separately backs up D1 and retains required secrets securely; see [ACCEPTANCE.md](ACCEPTANCE.md). Do not store D1 exports or secrets beside public source code.
