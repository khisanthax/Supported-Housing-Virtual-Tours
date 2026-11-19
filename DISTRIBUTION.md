# Cloudflare installation and upgrades

The [browser agency setup development preview](AGENCY-SETUP.md) adds an OAuth companion and guarded browser Administrator bootstrap. It is not a public one-click release: publisher hosting/OAuth authorization, a supported authoritative Free-plan check and independent hosted acceptance remain open. The signed update/backup/recovery integration is implemented and locally tested. The existing terminal-guided installer below remains available and unchanged. See [publisher integration and evidence](agency/README.md) before using any deployment link.

Version 0.2.0, schema 4. This is the Cloudflare edition. Local Only and Linux editions are designs, not products. Repository distribution/licensing terms still require the owner's decision; this change does not publish a release or select a license.

## Independent installation

Use Node.js 24 on a trusted computer. Each agency must use its own Cloudflare account, Administrator credentials and protected backup storage. No organizational identity integration is required.

1. Obtain an owner-authorized source copy. Run `npm ci` and `npm test`.
2. Run `npx wrangler login`. Authorize account/user read, Workers scripts, KV, D1 and tail access as needed; no account-wide Administrator, billing, zone or R2 permission is needed. Review the consent page. Confirm **Workers Free** in the dashboard before proceeding. Never attach a payment method for this installation.
3. Run `npm run setup`. Choose your account and a unique installation name, confirm Free, then create the initial Administrator username/password when prompted. Password entry is hidden. Do not place passwords in command arguments, chat or shell history.
4. Setup creates a uniquely named Worker, D1 database, KV namespace and private SQLite-backed Durable Object binding; applies additive schemas; generates a unique server guest-verification secret; bootstraps the first Administrator only when accounts are empty; and deploys the prepared frontend. Nothing points to the developer's pilot or another installation.
5. Open the printed `/staff` URL. Check Help/version, create a synthetic draft, upload a stitched JPEG, export and restore an encrypted backup, then publish/share only a synthetic test. Create another Administrator and ordinary Staff accounts through Manage staff accounts. Verify restrictions before real enrollment.

This is **guided setup**, not one-click deployment. Cloudflare's supported [Deploy to Cloudflare button](https://developers.cloudflare.com/workers/platform/deploy-buttons/) can provision bindings, but this application's schema, hidden-password Administrator bootstrap and deployment-origin verification require additional setup. A public button is deliberately not published before the distribution/licensing decision. [Automatic resource provisioning](https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/) does not replace these acceptance checks.

Installation state and Wrangler configuration are written under `~/.virtual-tours/<installation-name>/`, outside the repository. Restrict that directory to the operator. On Windows, enforce its NTFS access policy; Unix mode flags alone do not guarantee Windows ACLs. `last-command.log` can contain sensitive operational information or verifiers after a failed command: never attach it unreviewed. The bootstrap SQL file is removed in a finally block. The selected account/resource identifiers are private operational configuration; don't commit them. Cloudflare credentials remain managed by Wrangler.

### Retry and failure recovery

Keep the state directory and rerun setup with the **same installation name/account**. It reuses only the recorded randomly suffixed installation resources, reapplies idempotent schemas and preserves an existing secret/Administrator. It never resets a password or deletes a resource. A different name creates a separate installation. Do not delete the state directory to resolve an error.

Expired authorization: run Wrangler login, approve only required scopes, retry. Missing workers.dev subdomain: configure the account's free subdomain in the Cloudflare dashboard and retry. A partially deployed Worker has no configured application origin and refuses agency access until setup completes. Failed schema/bootstrap: review the private log locally, correct authorization/quota, retry. Keep the password in an approved password manager; setup does not recover it. Existing Administrator recovery is documented in DEPLOYMENT.md. No support operator receives default access.

## Versions and safe upgrades

`Major.Minor.Patch`: patch fixes compatible behavior (including clearly identified security fixes); minor adds compatible capabilities and additive migrations; major may require an explicit migration and recovery plan. Security fixes are called out in release notes regardless of number. No automatic update runs.

`package.json` and `cloudflare/release.mjs` carry the application version. `APP_BUILD` should be the tested Git commit, and `CF_VERSION_METADATA` identifies the actual Cloudflare deployment. Authenticated `/api/staff/version` and the staff footer expose version/build/edition; schema checks protect writes. Deployment IDs are operational identifiers, never credentials. A version label alone is not byte-parity verification.

Before upgrading:

1. Read release notes; save the previous tested commit/configuration/Worker deployment ID privately.
2. Export important apartments as encrypted packages. Export D1 privately, retain actual KV JPEG bytes and server secrets/configuration under agency policy. A KV inventory is not an image backup. Rehearse a restore.
3. Run `npm ci`, tests and prepare. Apply each listed **additive, idempotent** SQL migration in order using the installation's own config: `schema.sql`, `uac-schema.sql`, `uploads-schema.sql`, `diagnostics-schema.sql`. Existing pilot operators must export/compare original records before activation. Never point installation setup at a different agency's database.
4. Configure `DIAGNOSTICS_ENABLED=1`, `SCHEMA_REQUIRED=4`, the tested `APP_BUILD`, and `version_metadata.binding=CF_VERSION_METADATA`; preserve all existing secrets/bindings/origin/UAC/auth modes. Deploy only the complete passing build. The API rejects protected writes when the recorded schema version differs. The schema ledger represents the applied baseline; it does not prove backup integrity or replace ordered application of the scripts.
5. Sign in, confirm installed schema/build, retrieve an unchanged draft/JPEG, save a disposable private draft, verify guest isolation and backup restore, and compare hosted assets/Worker source against the tested build. Observe actual public Worker/DO CPU separately.

On failure, roll back code/config to the retained tested deployment while preserving current D1/KV data and additive tables. Do not restore an old whole database over newer edits just to roll back code. Cloudflare class-migration rollback restrictions still apply. Do not remove Durable Object classes, change passwords or rotate secrets as an upgrade shortcut. Future destructive migrations require a separate reviewed recovery plan.

## Free budget and ownership

Workers Free was observed at $0 on 16 November 2026; no plan/payment change was made. Public Workers retain the 10 ms CPU limit and 100,000 daily request allowance. SQLite Durable Objects have their own 30-second default invocation CPU limit, 100,000 daily requests, 13,000 GB-seconds/day and 5 GB storage allowance; D1 Free provides 5 million rows read/day, 100,000 written/day and 5 GB storage, and KV Free provides 1 GB, 100,000 reads/day and 1,000 writes/deletes/lists per day. Allowances are account-wide; additional isolated acceptance resources consume the same account budget. Free quota exhaustion can stop requests. Verify current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) before another installation; this is not a permanent pricing guarantee.

The app retains the 4 MiB/8192×4096 JPEG limit, 400 MB image reservation ceiling and 800-upload/day application budget. Diagnostics add at most 2,000 detailed rows/day, with retention/index/trigger writes also charged to D1. Routine high-volume traffic may require error-only logging. No paid service, third-party monitoring, license enforcement, payment flow or included unlimited support is enabled.

## Distribution decisions still required

The owner must decide source redistribution/license, third-party notice obligations, release channel, security-update policy, support boundaries, trademark/use terms and agency responsibility before public distribution. Proposed free self-service Cloudflare distribution and possible future paid Linux packages/setup/training remain policy options, not commitments. Independent agency installation, named recovery operators, approved backup storage and actual photograph approval remain agency decisions.
