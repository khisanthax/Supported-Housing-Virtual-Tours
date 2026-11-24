# Install LevelTwo360 on your agency’s Cloudflare account

## Before you start

Choose an installation owner authorized to manage the agency’s GitHub organization and Cloudflare account. Give a second authorized agency employee recovery access to both. Everyday staff sign in to LevelTwo360 separately. The agency can install, manage staff and tours, invite guests, back up, recover and update without a Help Hub or Codex. For pilot assistance, use the support contact agreed with the pilot coordinator. Keep passwords, API tokens and recovery keys in agency-controlled storage.

Cloudflare manages your subscription. The limited pilot uses Workers Free, which passed hosted acceptance. The owner deferred Workers Paid hosted testing for a separate run. Setup requires Workers Builds, Worker assets, D1, KV and SQLite Durable Objects. Free usage limits can interrupt service. Paid usage and builds can incur charges. Your agency monitors usage and costs. [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

## Deploy from the official button

Use the official link for the reviewed public template. Cloudflare copies the default branch into your agency repository. [Deploy LevelTwo360](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fkhisanthax%2Fleveltwo360-cloudflare-template)

Enter your permanent Administrator password only on the LevelTwo360 site after deployment.

1. Open the supplied **Deploy to Cloudflare** link. Sign in to the agency’s Cloudflare account or create it using the agency’s onboarding process. Select the intended account.
2. Connect GitHub using your named login. Grant the Workers & Pages app access to the deployment repository in the agency’s GitHub organization. An organization owner or app manager may need to authorize it. Verify the repository owner and visibility before continuing. Use a private agency copy when offered.
3. Choose a unique project name and new storage for your agency. In **LT360_INSTALL_KEY**, enter a unique password-manager-generated setup key of 24–128 printable ASCII characters without spaces. Save it for the next step. Use a different password when creating your Administrator. Keep the supplied build and deploy commands.
4. Click **Deploy** once. Workers Builds runs `npm run build` for the shared assets and `npm run deploy` to apply tracked D1 migrations by binding and deploy the Worker. SQLite Durable Object migrations use Wrangler. Watch the build before retrying a failure. Keep the same repository, Worker and resource IDs on retry. Clicking the original button for a new repository is a new installation.
5. Wait for **Success: Build completed**. Open the **workers.dev** address in the build output, or select **Visit ↗** on the Worker overview. Opening the website takes you directly to Administrator setup.
6. Enter the temporary key and choose your Administrator username and password. The key expires 60 minutes after the database setup migration and becomes unusable as soon as an Administrator is created. A retry keeps the original deadline. Cloudflare retains the encrypted secret binding until you remove it. If the key is lost or time runs out, expand **I lost my key or setup expired** for the owner recovery procedure. Keep that separately generated recovery code private.
7. Save or print the website URL, GitHub repository URL and names of your Worker, D1 database and KV namespace. Keep passwords and recovery keys in the agency’s approved storage. Sign in, create Staff accounts, assign apartment access and test a private draft before sharing a tour.

A failed build may leave resources provisioned. Review **Builds** and the selected bindings, fix the reported issue and retry on the existing Worker. In the Workers Free rehearsal, the button's generated build token applied all seven D1 migrations. If your build reports a migration authorization error, have your Cloudflare owner check **Settings → Builds → API token** for Worker deployment and D1 Edit permissions on the agency account. If the app reports an address mismatch after a rename, use the agency recovery procedure and keep the old site available until the new installation is verified.

## Backups and recovery

The [pilot checklist](PILOT.md) includes common installation issues, who handles recovery and what to verify before sharing tours.

Use the existing [encrypted apartment export](../BACKUPS.md) for routine content backups. A complete infrastructure backup contains application data, password verifiers, guest-link configuration and ready image bytes. That operation is for an agency infrastructure operator with Node.js 24. Never share the encrypted backup and private key together. Use an access-controlled location outside the checkout with approved Windows ACLs or equivalent host controls.

Provide a short-lived agency Cloudflare API token through the process environment as `LT360_CLOUDFLARE_TOKEN`. Scope it to the intended Cloudflare account, with access to read Worker deployments, versions and the account’s Workers subdomain, and to edit D1 and Workers KV. GitHub and staff credentials are separate.

For this pilot, use a separate local copy of the [reviewed Option A maintenance revision](https://github.com/khisanthax/Supported-Housing-Virtual-Tours/tree/859d04bb91eb76103dad29ede1dffd503bcd8dab). The helper bundled in the pinned Deploy template can select the last uploaded bindings after a rollback. The reviewed helper reads the version serving 100% of traffic and stops on split traffic. Confirm the active Worker and its D1 and KV bindings. Pause automated deployments and coordinate with anyone who can deploy or change bindings until maintenance finishes. Run `inspect` to check access before backup or recovery. Revoke the token when the job is done.

Install the locked dependencies with `npm ci` in the reviewed maintenance checkout, separate from the agency deployment branch. Uppercase values are placeholders. The key files and backup file must use new paths.

```text
npm run agency:maintenance -- keys PRIVATE_KEY_FILE PUBLIC_KEY_FILE
npm run agency:maintenance -- backup ACCOUNT_ID WORKER_NAME BACKUP_FILE PUBLIC_KEY_FILE
npm run agency:maintenance -- inspect ACCOUNT_ID WORKER_NAME
npm run agency:maintenance -- restore TARGET_ACCOUNT_ID TARGET_WORKER_NAME BACKUP_FILE PRIVATE_KEY_FILE TRUSTED_SHA256
```

- **Backup** pauses staff and guest access. The database blocks writes already in flight. Backups cover every ready image listed in D1, even when a KV listing omits it. The tool authenticates and decrypts the encrypted file locally for a restore check before reporting the SHA-256. Store that reference separately with the backup date, app revision and Worker configuration receipt. Store a separate copy of the agency repository and its dependency lockfile. Reserved uploads, sessions and transient diagnostic counters are recreated or require sign-in again.
- **Restore** first deploys the matching reviewed revision to a new Worker with independent D1 and KV resources. Leave its Administrator unclaimed. If the deployment form requires a temporary setup key, use a fresh random value and skip enrollment. Run restore against that Worker. The tool checks the trusted digest, database schema and required image bytes, restores staff accounts and guest-verification state, and pins the new URL only after copying and verifying records. Then sign in again and verify the recovered apartments and policies. Give guests the new site address and reissue invitations when needed. Restore refuses to overwrite an initialized installation.
- **Interrupted operations** are recoverable. Inspect the destination and retry the same restore with the same file and digest after the tool exits. If the process was killed, confirm it is stopped before clearing its exact owner marker with `unlock-restore ACCOUNT_ID WORKER_NAME MARKER OWNER`. This keeps the unfinished site closed. If a backup was killed, inspect and use `unlock-backup ACCOUNT_ID WORKER_NAME MARKER` only after confirming it stopped. Never unlock a job still running. Treat any file without a verified backup receipt as incomplete.
- This is a logical backup. Keep install configuration and the source revision separately. A restore targets the same reviewed schema before subsequent migrations. Back up before upgrades and periodically verify that a second agency operator can restore without the original installer.

## Updates and redeployment

The agency owns when its production branch changes. The official Git integration can build and deploy a production-branch push. Restrict writes/merges or disable automatic builds if the agency cannot enforce an approved promotion. Disable preview builds or give them isolated resources before testing with branches. This template disables public version preview URLs.

1. Review the proposed revision, dependency changes and additive migrations. Verify provenance through the approved release channel and rotate credentials if a known incident requires it.
2. Make a verified infrastructure backup. Preserve the tested previous Worker deployment and its source revision. Use a separate synthetic installation for testing the upgrade.
3. Approve and promote the exact reviewed commit in the agency repository. Keep the Worker, D1 and KV bindings. Workers Builds applies only pending migrations. Re-running against the same bindings preserves accounts, drafts, images and configuration.
4. Confirm the installed version in staff diagnostics, sign in, and verify access and playback with a synthetic or approved sample. If code needs recovery, select the retained compatible version in the Worker’s **Deployments** tab. Cloudflare can leave an active Durable Object on its prior code for up to five minutes by default. Wait for staff diagnostics to show the intended version before declaring an update or rollback complete. D1 changes survive a code rollback. For data loss, restore the pre-change backup into fresh resources and switch over only after verification. [Cloudflare Durable Object code updates](https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/)

## Acceptance evidence and limits

Run `npm test` and `npm run test:official` from the maintainer checkout for local validation. See the [pilot checklist and evidence](PILOT.md) for the hosted Workers Free results and the deferred Workers Paid run.

[Cloudflare’s official button](https://developers.cloudflare.com/workers/platform/deploy-buttons/) · [GitHub authorization](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/) · [Build token configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token) · [Build limits and pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)
