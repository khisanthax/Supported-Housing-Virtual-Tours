# Install LevelTwo360 on your agency’s Cloudflare account

## Before you start

Choose an installation owner authorized to manage the agency’s GitHub organization and Cloudflare account. Give a second authorized agency employee recovery access to both. Everyday staff sign in to LevelTwo360 separately.

Cloudflare manages your subscription. LevelTwo360 supports Workers Free and Workers Paid and requires access to Workers Builds, Worker assets, D1, KV, and SQLite Durable Objects. Setup never checks your subscription, upgrades it, or adds a payment method. On Free, usage limits can interrupt service. On Paid, usage and builds may incur charges. Your agency monitors usage and costs.

## Deploy from the official button

The release owner generates the button using `node official/deploy-link.mjs https://github.com/OWNER/APPROVED-TEMPLATE`. The approved template repository’s default branch must contain this candidate. Hosted consent, build-token provisioning, secret handling and deployment are pending isolated acceptance. This repository’s default branch is not the candidate.

1. Open the supplied **Deploy to Cloudflare** link. Sign in to the agency’s Cloudflare account or create it using the agency’s onboarding process. Select the intended account.
2. Connect GitHub using your named login. Grant the Workers & Pages app access to the deployment repository in the agency’s GitHub organization. An organization owner or app manager may need to authorize it. Verify the repository owner and visibility before continuing. Use a private agency copy when offered.
3. Confirm a unique Worker name and select new D1 and KV resources for this installation. Keep the supplied build and deploy commands. If Cloudflare asks for a `workers.dev` subdomain, choose the agency’s subdomain. The template needs no build-time secret. Never paste secrets into a Git file or a build log.
4. Click **Deploy** once. Workers Builds runs `npm run build` for the shared assets and `npm run deploy` to apply tracked D1 migrations by binding and deploy the Worker. SQLite Durable Object migrations use Wrangler. Watch the build before retrying a failure. Keep the same repository, Worker and resource IDs on retry. Clicking the original button for a new repository is a new installation.
5. Open your deployed `workers.dev` URL. Select **Generate setup code**. While signed in to Cloudflare, open the same Worker’s **Settings → Variables and Secrets** and save the generated value as a runtime **Secret** named `LT360_SETUP_CODE`. Deploy that setting. This authorizes the person who can change secrets on this specific Worker. The code is a sensitive bearer credential until it expires, after at most 30 minutes. If it expires, generate and save a fresh value.
6. On your own LevelTwo360 website, paste the code and create your Administrator username and password. Setup generates independent guest-verification material, records the deployed origin and commits the first Administrator with the installation record. Sign in at **Staff** and remove the expired or consumed setup code from the Worker. A new secret or repeat build cannot reopen enrollment.
7. Save or print the website URL, GitHub repository URL and names of your Worker, D1 database and KV namespace. Keep passwords and recovery keys in the agency’s approved storage. Sign in, create Staff accounts, assign apartment access and test a private draft before sharing a tour.

A failed build may leave resources provisioned. Review **Builds** and the selected bindings, fix the reported service or permission issue and retry on the existing Worker. Cloudflare's documented standard new Builds token does not list D1 Edit. If the migration reports an authorization error, use **Settings → Builds → API token** to select an agency-owned user token with the required Worker deployment and D1 Edit permissions for that account. Configure it through Cloudflare and retry the existing build. Hosted acceptance must establish what the button actually grants. An unconfigured site closes staff and guest access. If the app reports an address mismatch after a rename, use the agency recovery procedure. Keep that original Worker and domain available until the new installation is verified.

## Backups and recovery

Use the existing [encrypted apartment export](../BACKUPS.md) for routine content backups. A complete infrastructure backup contains application data, password verifiers, guest-link configuration and ready image bytes. That operation is for an agency infrastructure operator with Node.js 24. Never share the encrypted backup and private key together. Use an access-controlled location outside the checkout with approved Windows ACLs or equivalent host controls.

Provide a short-lived agency Cloudflare API token through the process environment as `LT360_CLOUDFLARE_TOKEN`. Scope it to the intended Cloudflare account, with access to read Worker settings and the account’s Workers subdomain and to edit D1 and Workers KV. Confirm the exact permission labels during hosted acceptance. GitHub and staff credentials are separate.

Run these commands from the agency’s own source copy. Uppercase values are placeholders. The key files and backup file must use new paths.

```text
npm run agency:maintenance -- keys PRIVATE_KEY_FILE PUBLIC_KEY_FILE
npm run agency:maintenance -- backup ACCOUNT_ID WORKER_NAME BACKUP_FILE PUBLIC_KEY_FILE
npm run agency:maintenance -- inspect ACCOUNT_ID WORKER_NAME
npm run agency:maintenance -- restore TARGET_ACCOUNT_ID TARGET_WORKER_NAME BACKUP_FILE PRIVATE_KEY_FILE TRUSTED_SHA256
```

- **Backup** pauses staff and guest access. The database blocks writes already in flight. Backups cover every ready image listed in D1, even when a KV listing omits it. The tool authenticates and decrypts the encrypted file locally for a restore check before reporting the SHA-256. Store that reference separately with the backup date, app revision and Worker configuration receipt. Store a separate copy of the agency repository and its dependency lockfile. Reserved uploads, sessions and transient diagnostic counters are recreated or require sign-in again.
- **Restore** first deploys the matching reviewed revision to a new Worker with independent D1 and KV resources. Leave its Administrator unclaimed and its setup code unset. Run restore against that Worker. The tool checks the trusted digest, database schema and required image bytes, restores staff accounts and guest-verification state, and pins the new URL only after copying and verifying records. Then sign in again and verify the recovered apartments and policies. Give guests the new site address and reissue invitations when needed. Restore refuses to overwrite an initialized installation.
- **Interrupted operations** are recoverable. Inspect the destination and retry the same restore with the same file and digest after the tool exits. If the process was killed, confirm it is stopped before clearing its exact owner marker with `unlock-restore ACCOUNT_ID WORKER_NAME MARKER OWNER`. This keeps the unfinished site closed. If a backup was killed, inspect and use `unlock-backup ACCOUNT_ID WORKER_NAME MARKER` only after confirming it stopped. Never unlock a job still running. Treat any file without a verified backup receipt as incomplete.
- This is a logical backup. Keep install configuration and the source revision separately. A restore targets the same reviewed schema before subsequent migrations. Back up before upgrades and periodically verify that a second agency operator can restore without the original installer.

## Updates and redeployment

The agency owns when its production branch changes. The official Git integration can build and deploy a production-branch push. Restrict writes/merges or disable automatic builds if the agency cannot enforce an approved promotion. Disable preview builds or give them isolated resources before testing with branches. This template disables public version preview URLs.

1. Review the proposed revision, dependency changes and additive migrations. Verify provenance through the approved release channel and rotate credentials if a known incident requires it.
2. Make a verified infrastructure backup. Preserve the tested previous Worker deployment and its source revision. Use a separate synthetic installation for testing the upgrade.
3. Approve and promote the exact reviewed commit in the agency repository. Keep the Worker, D1 and KV bindings. Workers Builds applies only pending migrations. Re-running against the same bindings preserves accounts, drafts, images and configuration.
4. Confirm the installed version in staff diagnostics, sign in, and verify access and playback with an approved synthetic or private sample. If code needs recovery, select the retained compatible Worker version in Cloudflare. D1 changes survive a code rollback. For data loss, restore the pre-change backup into fresh resources and switch over only after verification.

## Acceptance evidence and limits

Run `npm test` and `npm run test:official` from a clean checkout. The latter applies the shipped migrations with Wrangler in local mode, compiles the candidate and exercises the actual Worker and SQLite Durable Object with isolated D1/KV. This is local validation. Follow the [hosted acceptance checklist](LIVE-ACCEPTANCE.md) for both account plans.

[Cloudflare’s official button](https://developers.cloudflare.com/workers/platform/deploy-buttons/) · [GitHub authorization](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/) · [Build token configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token) · [Build limits and pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)
