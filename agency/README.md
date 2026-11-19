# LevelTwo360 agency distribution — publisher operations

The Phase 1 browser installer and safe-update workflow are implemented on PR #51. Local tests exercise the real application in workerd with D1/KV/SQLite Durable Objects; Cloudflare control-plane writes are simulated. No hosted acceptance, OAuth registration, DNS change, billing change or production deployment has been performed.

**Release remains blocked:** the live self-managed OAuth scope catalog checked on 19 November 2026 does not expose Billing Read. Cloudflare documents Billing Read or Billing Write for the subscriptions endpoint used by the strict Workers Free preflight. The service refuses provisioning and upgrades without positive Free evidence. Account Settings Read, `default_usage_model=standard`, an empty subscription response, and a Free website/zone are not substitutes. No unsupported scope or paid/billing-write permission is requested. A private registration alone cannot resolve this platform limitation.

## Implemented agency workflow

1. The agency opens the approved companion URL, authorizes Cloudflare directly, selects its own account/name and confirms Workers Free. No agency GitHub account, API-key copying, software installation or terminal is required.
2. The companion verifies Free evidence, creates/resumes independent resources and applies the idempotent schemas. Its journal, resource identity checks and create intents prevent blind replacement. An initialized installation is never upgraded by retrying setup.
3. The agency chooses its Administrator password directly on its Worker using an installation-bound, expiring 256-bit setup ticket. D1 stores only its digest; atomic insertion/closure prevents concurrent initial Administrators. Pending installs refuse ordinary application access. Health checks include the recovery tables and database write barrier.
4. The Administrator uses **Software updates** to view installed/compatible versions and verified release notes. A private recovery key is generated/downloaded in the browser; only its public RSA key leaves the device. Approval is durable, limited to two hours, and bound to installation, account revision, installed build and signed manifest. Approval can be revoked.
5. An authorized agency operator reconnects to Cloudflare on the companion, selects the same installation and checks existing updates. Infrastructure authorization is separate from application Administrator approval. There is no permanent publisher access or background automatic updater.
6. The update acquires a D1 maintenance lock. Database triggers prevent already-running business writes from committing after that lock; sign-in, status and approval revocation remain available. A complete encrypted snapshot is written and restored in memory to verify database integrity and actual JPEG hashes before activation.
7. The signed compiled Worker/assets are staged without activation. Only strict additive CREATE TABLE/INDEX migrations are automatic, with conflict detection and contiguous ledger entries. Current secrets, variables, bindings and compatibility settings are preserved; changed or unsupported resources require review. The retained old code must declare compatibility with the new schema.
8. The expected previous version is checked before activation. The new version is checked for exact version/build/schema health. Failures recover only the retained code version and preserve current data, secrets and additive schema. A crashed job observes its actual deployed version before acting. An unrelated external deployment or failed recovery leaves writes paused for operator review; it is never force-overwritten.
9. After completion/recovery the agency reconnects and downloads its encrypted installation backup. Store it separately from the private recovery file and trusted verification reference shown in Administrator history.

## Exact verified OAuth permissions

The checked global catalog subset is [oauth-scopes.verified.json](oauth-scopes.verified.json). Discovery was read-only, used an existing authorized local publisher session without printing/copying its token, and did not inspect apartment/staff content.

| Permission | Exact live scope ID | Purpose / consequence |
| --- | --- | --- |
| Account Settings Read | `account-settings.read` | Account selection and prerequisites; no account-setting writes |
| Workers Scripts Write | `workers-scripts.write` | Worker code/assets, secret metadata/writes, versions/deployments and SQLite DO bindings |
| D1 Write | `d1.write` | Dedicated database creation, queries, additive schema and encrypted backup collection |
| Workers KV Storage Write | `workers-kv-storage.write` | Dedicated namespace creation, inventory and actual image backup |
| Billing Read | **Absent from the checked catalog** | Documented prerequisite of GET `/accounts/{account_id}/subscriptions`; this blocks the current strict Free detector |

These resource scopes can grant broad access within the account selected on Cloudflare's consent screen; a future resource cannot be selected before it exists. Use the dedicated agency account and review Cloudflare's actual consent boundaries. The implementation addresses only journaled installation resources. No Billing Write, payment, DNS, account-membership, R2, analytics, refresh/offline-access, OAuth-client administration or zone route scope is requested by agency setup.

Creating the publisher client is a separate owner operation requiring Cloudflare Administrator/Super Administrator or OAuth Clients Write. It is not a permission granted to agencies' runtime deployments. Official references: [client registration and scope discovery](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/), [subscription API accepted permissions](https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/), [deployment API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/), [rollback restrictions](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## Prepared configuration and operator tools

These commands prepare local files; they never register, publish or deploy a client:

```text
node agency/catalog-cli.mjs --from-wrangler --output PROTECTED_CATALOG_JSON
node agency/prepare-operations.mjs --origin https://APPROVED_STAGING_HOST --build TESTED_FULL_GIT_SHA --catalog PROTECTED_CATALOG_JSON --output NEW_PROTECTED_DIRECTORY
```

Catalog discovery can alternatively use a protected `AGENCY_CATALOG_BEARER_FILE` supplied by the publisher's secret manager. Never paste a bearer token into chat or a command argument. The generated `private-oauth-registration.json` uses Authorization Code, client_secret_basic, exact callback `/oauth/callback`, the four confirmed scopes, and no public visibility or refresh grant. `deployment-preflight.json` records unresolved Free verification and explicitly disallows public promotion, billing and production changes. The environment example contains file paths/placeholders, never a secret value. Missing/guessed scopes, non-HTTPS origins and malformed builds are rejected.

Host the Node.js 24 service behind the approved HTTPS reverse proxy. The default listener is loopback port 4198. [Dockerfile](Dockerfile) requires an owner-reviewed official Node 24 image pinned by digest; no base image is silently selected. Container mode listens internally on port 4198: expose it only with a loopback host mapping such as `127.0.0.1:4198:4198`, behind the approved TLS proxy. [Caddyfile.example](Caddyfile.example) is prepared only; starting it would publish a host and request certificates and is not authorized by this PR. No container or proxy has been deployed. Production asset preparation excludes development secrets.

| Host variable | Value / policy |
| --- | --- |
| `AGENCY_ORIGIN` | Exact approved HTTPS origin, no trailing slash |
| `AGENCY_OAUTH_CLIENT_ID` | Set after approved private registration |
| `AGENCY_OAUTH_CLIENT_SECRET_FILE` | Protected host secret-store file, preferred; never in Git |
| `AGENCY_OAUTH_SCOPES` | Space-separated verified scope IDs above |
| `AGENCY_STATE_DIRECTORY` | Absolute protected persistent directory outside checkout |
| `AGENCY_VERIFIED_BUILD` | Tested full source SHA; establish byte parity in release acceptance |
| `AGENCY_VERIFIED_FREE_PLAN_IDS` | Empty until authoritative plan evidence is supported and validated |
| `AGENCY_RELEASE_DIRECTORY` | Read-only signed `manifest.json`, `release.sig`, `artifact.lt360release` |
| `AGENCY_UPDATE_PUBLIC_KEY_FILE` | Separately approved pinned Ed25519 public key; never supplied by a candidate manifest |

The startup loader verifies the configured signature/artifact before serving the catalog. New installations pin that public key and exact HTTPS catalog origin; only the Administrator update page requests public release metadata. It sends no apartments, staff cookies or installation identifiers to that catalog. A signed release still cannot install without application approval and fresh infrastructure consent.

Use one companion process and protected journal volume. An exclusive service lock prevents multiple executables from sharing it. After a crash, verify no process/job owns the volume before removing the empty service-lock directory; never remove installation journals to retry. The D1 lock serializes update jobs across hosts; the process/journal lock also serializes provisioning. Cloudflare's deployment API does not provide a documented atomic compare-and-swap against an external operator's dashboard action: application jobs are serialized and expected-version checked, but operators must avoid parallel infrastructure changes during the acceptance/update window. Unknown external versions stop recovery rather than being overwritten.

Enforce real NTFS ACLs or host-equivalent controls; POSIX mode bits alone do not enforce Windows isolation. Disable proxy/APM/body/query/cookie logging. OAuth access tokens are memory-only, no refresh token is used, and revocation is attempted on finish/failure/disconnect/expiry. Reconnection uses fresh authorization. Wrangler disk/debug outputs and metrics are disabled, sanitization is forced, alternate API endpoints/legacy credentials/output files are removed, and publisher `AGENCY_*` secrets are not passed to Wrangler. No support token, staff password or application session is substituted for Cloudflare credentials.

## Signed release preparation

After source/test approval, an authorized release operator can prepare, without publishing:

```text
node agency/release-cli.mjs --build TESTED_FULL_GIT_SHA --from SUPPORTED_SOURCE_VERSIONS --from-schemas SUPPORTED_SOURCE_SCHEMAS --private-key-file PROTECTED_ED25519_FILE --notes-file REVIEWED_NOTES_FILE --output NEW_PROTECTED_RELEASE_DIRECTORY
```

The tool requires a clean matching checkout, compiles with pinned Wrangler, packages actual asset bytes/hashes, signs the exact manifest bytes and writes no deployment configuration into the artifact. Optional `--migrations-file` accepts the restricted additive format. Trust-key creation/custody and promotion of a real release are owner decisions, not an automatically generated publisher identity. Synthetic 0.2.1/schema-5 fixtures are tests, not published releases. Existing manual/older installations without recovery protocol 1 need a one-time explicitly authorized infrastructure upgrade; the companion refuses to treat initial setup retry as that upgrade.

## Backup custody and disaster recovery

Snapshots contain logical D1 business records, staff verifiers/roles/scopes/audit history, all KV bytes, bindings/configuration and a separately agency-key-sealed guest secret. Active session/rate-limit data, pending update authority and bounded diagnostic event rows are deliberately excluded; diagnostic settings are retained. A restoration requires fresh sign-in. Normal code recovery does not restore any database and does not clear live sessions or change accounts.

Snapshots use fresh AES-256-GCM keys/record nonces, wrapped to the agency's RSA-OAEP-SHA256 public key. No plaintext backup is written to companion disk. Verification restores the saved ciphertext into an in-memory SQLite database and checks integrity, foreign keys and JPEG hashes. Keyset pagination avoids quadratic OFFSET scans against D1 Free. Pilot bounds: 64 MiB serialized business rows, 4 MiB/image, 64 MiB release package, 1 GiB encrypted snapshot. Larger installations stop safely for operator-assisted backup. Quota/disk/network failures do not authorize a partial backup or upgrade.

The private recovery file is a sensitive credential. Keep it in agency-approved secure storage, separately from ciphertext. Copy the trusted backup SHA-256 reference from signed-in update history and retain it separately: recipient encryption alone does not prove who created an arbitrary replacement file. The authenticated companion verifies that reference before downloading ciphertext. Offline verification/extraction also requires the trusted reference:

```text
node agency/verify-backup.mjs ENCRYPTED_BACKUP PRIVATE_RECOVERY_FILE TRUSTED_SHA256
node agency/recover-backup.mjs ENCRYPTED_BACKUP PRIVATE_RECOVERY_FILE TRUSTED_SHA256 NEW_PROTECTED_RECOVERY_DIRECTORY
```

Extraction writes a new SQLite database, exact image bytes/index and a PRIVATE configuration/secrets file outside the checkout. It never uploads, overwrites an existing directory or modifies production. Plaintext extraction is for an authorized agency infrastructure operator and requires protected local storage. Restoring into Cloudflare or changing production bindings remains a separate owner-approved operation. A lost private key cannot be recovered by the developer.

## Owner actions still required

| Exact action | Why / consequences | Current status |
| --- | --- | --- |
| Select an existing isolated Workers Free account and permit two uniquely named synthetic test installations | Enables actual resource/quota/auth acceptance; consumes that account's free allowances; no real agency content or existing deployment changes | Not authorized/selected |
| Approve an existing HTTPS staging origin/host and private OAuth client registration using the prepared payload | Creates a private publisher application and protected client secret; initially only members of its parent account can consent; no public promotion or billing writes | Not executed |
| Obtain Cloudflare confirmation of a supported self-managed OAuth permission/endpoint for authoritative Workers Free evidence | Billing Read is absent from the current catalog; approvals alone do not fix it. Do not request invented scope IDs, Billing Write, copied agency API keys or permanent developer access | Platform blocker |
| Approve a release signing identity/public-key pin and private backup/journal custody on the chosen host | Establishes which reviewed release artifacts agencies may approve; private signing key stays outside the runtime/repository | No real identity created |
| Later, separately approve publisher domain verification and permanent public OAuth visibility | Required for cross-account distribution. Cloudflare documents that public promotion is irreversible and the verified client domain cannot be changed | Explicitly not authorized/executed |
| Approve hosted acceptance, then actual agency production rollout separately | Local emulator success is not proof of hosted Free CPU, real consent behavior or deployment propagation | Pending |

Suggested Cloudflare support question (not sent): “Which supported self-managed OAuth scope authorizes GET /accounts/{account_id}/subscriptions, or which documented read-only endpoint authoritatively distinguishes Workers Free from Paid? The current /oauth/scopes catalog exposes the four resource scopes listed above but no Billing Read. We must not enable billing or ask agencies to copy API keys.”

Follow [LIVE-ACCEPTANCE.md](LIVE-ACCEPTANCE.md). Phase 1 cannot be declared complete until the plan-verification path and approved hosted acceptance close. Phase 2 is therefore still deferred; this branch creates no temporary support account or support access/backdoor, and Local Only remains device-local.
