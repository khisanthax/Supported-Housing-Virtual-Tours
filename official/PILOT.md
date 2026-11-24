# Limited LevelTwo360 agency pilot

## Owner approval to start

Approve one eligible agency, its pilot contact and the synthetic-only rehearsal. Ask the agency to name its GitHub and Cloudflare installation owner, Administrator and recovery operator. Confirm the operator can run the reviewed maintenance helper and has a protected backup destination and separate key storage. The agency owns its repository, resources, credentials and recovery materials. The Help Hub is deferred until multiple agencies are using LevelTwo360. The pilot needs neither Hub registration nor Codex.

## Before inviting an agency

- Confirm the agency is eligible under the source-available license. The agency appoints a Cloudflare and GitHub installation owner, a LevelTwo360 Administrator and a recovery contact. [Approved license](https://github.com/khisanthax/leveltwo360-cloudflare-template/blob/774273166e49846c6a2e06dd1b00a35a824a93a4/LICENSE)
- Share the reviewed Deploy link and the [installation and maintenance guide](README.md). Use the verified Workers Free environment for the limited pilot. The project does not ask for plan proof as part of setup.
- Before loading real content, run an agency-owned rehearsal with a synthetic apartment. Confirm the Administrator can sign in, a scoped staff member sees only assigned content, and a guest can open and then lose access to a published test tour.
- Have the agency's infrastructure operator use the [reviewed active-version helper](README.md#backups-and-recovery) to make a verified encrypted backup and rehearse recovery into an unclaimed installation with separate storage. Test a reviewed update and code rollback on the synthetic installation. After each change, verify the installed version, Administrator sign-in, scoped Staff access, and the draft and its images. Record the installed source revision, website address and backup receipt. Store the recovery private key separately in agency-controlled storage.
- Start with a small number of tours and watch usage in the Cloudflare dashboard. Before importing real photos, follow the agency's review and consent process. Pause the pilot if backup, role enforcement or guest revocation fails.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| GitHub asks which repositories Cloudflare can access | Use the agency's account or organization and select only approved repositories. If GitHub requires an existing selection before the new destination exists, use a private empty repository controlled by the agency. Confirm that the new deployment repository is private before continuing. |
| The build failed | Open the failed build and read the first error. If the project and storage were created, use the existing Worker and its build retry. Keep the same D1 and KV bindings. |
| The build succeeded | Open the printed `workers.dev` address or use **Visit**. On a new install, the website opens Administrator setup. |
| The setup key is rejected | Check the saved key and confirm you opened the new installation. The key expires one hour after migration. For an expired or lost key, use **I lost my key or setup expired** and follow the Worker-owner recovery steps. Once the Administrator is created, use Staff sign-in. |
| Guests cannot yet see a newly published tour | Allow about a minute for the images to become available. Verify the tour using a separate browser session before sending the invitation. |
| Staff see a maintenance message | Check with the backup or restore operator. A backup pauses access briefly. For an interrupted restore, follow the [recovery steps](README.md#backups-and-recovery) using the same archive and digest. |
| The old version does not appear immediately after rollback | Check which Worker version is receiving traffic in Cloudflare. After propagation, check staff diagnostics and open a known draft. If the database also needs recovery, use the verified pre-upgrade backup. |

## Acceptance status

| Status | Evidence |
| --- | --- |
| Completed | Workers Free was confirmed in the rehearsal account under **Workers plans → Free → Current plan**. Build `0370fe08` verified the public-root Deploy flow, private destination, all seven migrations, the website handoff and first-Administrator setup. |
| Completed | Hosted backup, restore and retry on separate bindings preserved staff, one draft version and three JPEGs. Hosted Git-triggered update and Worker rollback retained the draft and sign-in. |
| Completed | A fresh check of the reviewed helper matched the active storage on both disposable Workers. It made independent encrypted backups, recovered each archive locally and matched all six synthetic JPEGs byte-for-byte. Both maintenance locks cleared. Local tests rejected split traffic before any storage access. |
| Completed | Hosted scope changes took effect for an existing staff session. Guest publication, viewer and JPEG delivery passed. A guest invitation was denied on the other installation, and revocation blocked both unlock and the prior guest session. |
| Deferred | The owner will run Workers Paid acceptance separately. The limited Workers Free pilot can proceed. |
| Required for entry | Owner approves the agency and synthetic rehearsal. The agency confirms its recovery operator and uses the reviewed active-version maintenance helper. |
| Pilot gate | Record the agency's completed setup, permissions, guest revocation, encrypted recovery, update and rollback before the agency and pilot owner approve any real-content use. |

Hosted checks used disposable resources. A broader capacity test and browser-based infrastructure recovery would be useful follow-up work. For the limited pilot, use the agency infrastructure operator and the tested command-line recovery procedure.
