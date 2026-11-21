# LevelTwo360 deployment roadmap

Decision of 20 November 2026. **Option A, Cloudflare’s official Deploy button, is the priority for evaluation. Option B, the custom OAuth installer in draft PR #51, is deferred and available for future development.** The existing Wrangler installation procedure remains the documented route. Public Option A distribution awaits the acceptance work below.

## What an agency would do

This is a proposed onboarding guide based on provider documentation. Exact screen order, defaults and permission prompts still need observation in an approved first-time account.

1. The agency appoints an installation owner with authority over hosting and source control. Send this person one invitation and explain that everyday staff will only need their LevelTwo360 login.
2. Open the official Deploy link for a reviewed public template. Create or sign in to an agency-controlled Cloudflare account, verify the email when prompted, and select the intended account. Read the cost disclosure before deploying. Workers Free and Workers Paid are both supported targets. The agency chooses and manages its subscription in Cloudflare.
3. On the GitHub path, create and verify a named GitHub user, then create or choose the agency’s GitHub organization as repository owner. Give a second authorized employee recovery access to both provider accounts. Store recovery codes under agency control. Cloudflare also documents a GitLab path; one primary guide will be simpler for the pilot.
4. Connect GitHub. Authorize Cloudflare to identify the GitHub user and install the Workers & Pages GitHub App on the agency organization. An organization owner or app manager may need to approve installation. Limit repository access to the deployment copy where supported. Rehearse the permission sequence for a repository that does not yet exist before writing exact click instructions.
5. Review the destination repository owner, name and visibility, Cloudflare account, Worker name, resource names, and build/deploy settings. Prefer a private agency copy where supported. Verify visibility before storing configuration. Supply a workers.dev subdomain if prompted. Use short agency-neutral names and template defaults. No resident details belong in names, source or logs.
6. Choose Deploy once. Cloudflare copies the public template to the selected Git account and builds in the selected hosting account. The intended bindings are DB for D1, PHOTOS for KV and STAFF_LOGIN for a SQLite Durable Object. The template must also prepare static assets, apply the application schemas safely and establish per-installation secrets. Provisioned bindings alone do not establish application readiness.
7. Open the resulting agency URL. A future owner-verification step must establish who may create the first Administrator. One design to test is a unique, short-lived setup code supplied through an agency-only Cloudflare secret field, followed by digest-only, atomically consumed bootstrap state and removal of the staging secret. Prove that this value never enters source or build logs and that a repeat build cannot reopen setup. The agency chooses its application password directly on its site. Confirm sign-in, then print a secret-free summary with the site URL, repository, recovery instructions and staff onboarding link.

The official flow requires a Git provider. This is self-service and browser-based, with two provider accounts and a separate application login. The custom OAuth scope question on PR #51 does not prevent this evaluation. Option A requires no subscription lookup, billing permission, screenshot, plan declaration or proof. Evaluate actual access to Workers Builds, Worker assets, D1, KV and SQLite Durable Objects. If a required resource cannot be created, identify the resource, explain the provider error and let the agency retry after resolving it. The installer must never upgrade the account or add a payment method.

## Keeping the installation independent

- Treat the agency’s repository, hosting account, complete backups and recovery keys as separate assets. An agency-appointed second owner should be able to recover each after the installing employee leaves. Test access with the developer absent.
- Keep the existing encrypted apartment export for everyday use. A full disaster-recovery package additionally needs staff accounts and permissions, guest policies, audit records, D1 schema/data, every required KV image, deployable source and dependencies, binding configuration, and separately protected secret material. Inventory any durable application state in the object before declaring coverage. Establish what is recreated, including sessions that require fresh sign-in.
- Provide an agency-run full-backup/export and restore path that works when the developer service is unavailable. Encrypt before transfer, verify completeness and integrity, keep at least one copy outside Cloudflare and the decryption key separately. Rehearse restoration into a fresh isolated installation and verify staff restrictions, guest access and actual image bytes. D1 Time Travel is a database recovery aid and does not restore KV or the source repository.
- An upstream template release should be an offer. The agency reviews the signed release and migration notes, saves and verifies a backup, tests with isolated bindings, then explicitly approves promotion of the exact reviewed version to its agency production branch. Cloudflare Builds normally deploys production-branch pushes, so decide how to enforce approval under the agency’s chosen Git plan. Test both an application Administrator and the authorized repository/hosting operator where these are different people. Reject a direct push or unreviewed migration that could bypass the agreed approval. Preserve agency edits, secrets and resource IDs. Retain a compatible previous Worker version for code rollback and a separate restore procedure for data loss.

## Release gates

1. Review a minimal public Cloud template and its license, assets, notices, workflows and history before publishing. Keep private Linux packaging, customer integrations, credentials, sample backups and deployment identifiers outside the template. Public licensing remains an owner decision.
2. On the inspected main revision be04506 the Wrangler file is nested, workers.dev is disabled, storage IDs are local placeholders, assets come from a generated directory, and the root package has no deploy script. The root environment example also contains pilot/Firebase settings. Validate the deployed root, safe binding substitutions, Free-compatible SQLite object migration, schema order, fresh secrets and a reachable agency URL. Eliminate manual SQL, shell commands and irrelevant secret prompts from agency onboarding.
3. Test partial builds, duplicate clicks, conflicting names, expired sessions, re-opening a completed install, bootstrap races and failure during migration. Keep an unfinished site closed. Demonstrate what to click to resume without replacing data or resetting the Administrator.
4. Run the same button installation and acceptance steps with synthetic data on two existing, approved isolated accounts, one Workers Free and one Workers Paid. Include an inaccessible resource, an interrupted build and an account with no billing-read grant. Successful installation must not depend on knowing its subscription. Verify actual Git ownership and visibility, least-privilege installation, applicable usage limits, preview isolation, build token permissions, agency-owned backups, restore without the publisher, and an approved update and rollback. Repeat with a second independent installation. Record real screens, staff completion time, confusing prompts, and a printable rescue guide. Obtain separate approval before public distribution.

## Billing disclosure for the agency invitation

Your agency owns this Cloudflare installation. Cloudflare manages your subscription. On Free, usage limits can interrupt service. On Paid, usage and builds can incur charges under your existing plan. Your agency is responsible for monitoring usage and costs in its Cloudflare dashboard. LevelTwo360 never upgrades your subscription automatically.

## Evaluation evidence

Cloudflare documents automatic provisioning of KV, D1 and Durable Objects through the Deploy button. SQLite-backed Durable Objects are the common storage model for both plans. Workers Builds has Free and Paid allowances. On the local roadmap baseline, Wrangler dry-run bundled 97 assets and reported ASSETS, DB, PHOTOS and STAFF_LOGIN; all six distribution tests passed. This exercised the common build only. Hosted consent, real provisioning, plan-specific runtime limits and billed usage require the two approved rehearsals.

- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)

## Primary references

- [Official Deploy button and template requirements](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Workers GitHub App authorization and installation](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) and [Free build limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)
- [SQLite Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
