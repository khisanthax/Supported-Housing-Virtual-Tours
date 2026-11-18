# Agency companion — Phase 1 development preview

This service hosts the browser deployment wizard. The agency runs no terminal or GitHub workflow. Its short-lived Cloudflare OAuth authorization is used by the companion to run the existing pinned Wrangler infrastructure tooling. Administrator passwords are entered later, directly on the agency Worker. No existing installation was deployed or modified while developing this branch.

## Deployment mechanism decision

Cloudflare’s official [Deploy to Cloudflare button](https://developers.cloudflare.com/workers/platform/deploy-buttons/) supports a link of this form:

`https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fkhisanthax%2FSupported-Housing-Virtual-Tours`

That documented mechanism clones a repository into the agency’s GitHub/GitLab account and builds it. It can provision D1, KV and Durable Objects, but does not by itself prove which person should become this application’s first Administrator. **The link above is reference syntax, not an enabled LevelTwo360 deployment button**: the current root repository has no browser deployment configuration for it. Do not send it as a working installation link.

The companion implements the no-agency-GitHub alternative using official [self-managed OAuth clients](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/) and [OAuth endpoints](https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/). The eventual agency link is simply the approved HTTPS companion origin, with no credential or installation ticket in the email URL. The origin is not yet provisioned or approved.

[Temporary claim deployments](https://developers.cloudflare.com/workers/platform/claim-deployments/) were researched but not used: the mission requires the agency to create/control its account before authorizing resource deployment, forbids creating new external accounts here, and requires durable ownership and resource validation. No temporary Cloudflare account was created.

## Owner actions required before external use

1. Approve an existing isolated Cloudflare test account/environment for live tests. No account has been chosen by this implementation. Do not supply credentials in chat.
2. Choose and authorize a publisher HTTPS origin and hosting environment for this Node.js 24 companion. Workers Free remains the agency target; the Node companion itself needs a separate approved host. This branch does not claim that hosting service is already free, configured or deployed.
3. Register the publisher’s Cloudflare OAuth client with exact redirect URI `https://APPROVED-PUBLISHER-ORIGIN/oauth/callback`, Authorization Code, `client_secret_basic`, and PKCE S256. Configure no continuing refresh grant or offline access. Select scope IDs from Cloudflare’s live `/oauth/scopes` catalog rather than guessing names or borrowing Wrangler’s client ID. Required operations are listed below. Keep the client secret in the host secret manager.
4. Initially test with a private client in the approved test account. Cross-account agency distribution needs a public client: logo, client URL, required scope configuration, DNS domain verification and a visibility promotion. Cloudflare documents that public promotion is **permanent** and the verified client domain cannot be changed. These DNS/client/access-permission changes require explicit owner authorization. None was made.
5. Verify the actual read-only Workers Free response with the selected OAuth scopes. The generic subscription API does not document a stable Workers Free identifier. The adapter currently requires exactly one active `rate_plan.scope === 'workers'`, `state === 'Provisioned'`, zero-price record with an explicitly verified allowlisted plan ID. Its field mapping may need adjustment after observing an authorized response. Defaults intentionally block provisioning. An empty response, forbidden read, zero-price trial, or zone Free subscription must never be treated as Free. If the API cannot provide authoritative evidence, implement a supported alternative and record its limits; do not silently remove this gate.
6. Complete the update integrations and independent acceptance matrix below. Decide redistribution/licensing and release policy before public invitations, consistent with DISTRIBUTION.md.

## Host configuration

Run `npm ci`, `npm test`, `npm run test:agency:browser`, `npm run test:agency:emulator`, and `node cloudflare/prepare.mjs` on a clean, reviewed checkout. Verify the source commit and artifact in CI before hosting. Set the following through the host’s protected configuration; no automatic `.env` loader or credentials file is included:

| Variable | Purpose |
| --- | --- |
| `AGENCY_ORIGIN` | Exact HTTPS public origin, without trailing slash; loopback HTTP is accepted only for local tests |
| `AGENCY_OAUTH_CLIENT_ID` | Publisher’s registered client ID |
| `AGENCY_OAUTH_CLIENT_SECRET` | Host secret-manager value; never a repository or agency-entered value |
| `AGENCY_OAUTH_SCOPES` | Space-separated scope IDs verified against the live catalog and registered client |
| `AGENCY_STATE_DIRECTORY` | Absolute protected directory outside the checkout; agency resource journals/configuration only |
| `AGENCY_VERIFIED_BUILD` | Full 40-character SHA of the tested checkout; operator must establish byte parity |
| `AGENCY_VERIFIED_FREE_PLAN_IDS` | Comma-separated exact Workers Free plan IDs confirmed by authorized live testing; empty disables provisioning |
| `PORT` | Loopback listener, default 4198 |

Start `npm run start:agency` behind the approved HTTPS reverse proxy. It binds loopback, not a public unencrypted interface. Use one process/one protected journal volume; do not load-balance this prototype. The executable creates an exclusive `companion-service.lock` directory. After a crash, an operator must verify no process/job owns the volume before removing that empty lock directory. Never remove installation journals as a retry shortcut. After a restart, browsers must reconnect to Cloudflare; their installation resumes from its journal.

Enforce Windows NTFS ACLs or equivalent host access controls on the state directory; POSIX mode 0600/0700 alone does not enforce Windows policy. Exclude credentials, callback query strings, cookies, request bodies, setup fragments and result payloads from reverse-proxy/APM/access logs. This server emits no per-request logs, CLI error output or analytics. Configure bounded proxy body sizes, timeouts and network-level abuse protection. The prototype uses process-local authorization-start rate limits (eight/minute/source; 1,000-session cap), a single active deployment per account/name, and bounded provisioning commands. Do not deploy multiple instances without transactional jobs/locks.

### Required read/write operations

The consent should cover account selection/read, read-only authoritative Workers plan evidence, workers.dev subdomain read, Worker scripts/settings read/write, private D1 database create/read/query, private KV namespace create/read, Worker secret create/list, SQLite Durable Object class/binding deployment, and asset upload. Obtain exact permission-to-scope mappings from the live catalog and API documentation during isolated acceptance. No billing/subscription writes, payment method, R2, DNS edits, zone-wide administration or public OAuth-client management is performed by agency setup. Publisher DNS/client registration is a separate owner operation.

### Authorization lifecycle

OAuth state and S256 verifier are bound to a random HttpOnly cookie, with callback state consumption and cookie rotation. A completed callback retains only the access token in process memory for at most ten minutes of idle session use; provider expiration can be earlier. No refresh token is retained, used or persisted. Reconnect starts a new consent flow. On completion, failure, disconnect or expiry, revocation is attempted and the local token is discarded. If revocation cannot be confirmed, the UI tells the agency to revoke the application in Cloudflare. A running job completes its bounded steps before graceful shutdown releases its journal lease. The companion is a trusted deployment service during this explicit authorization; this is not a claim that an OAuth publisher cannot misuse an active grant.

The setup ticket is a separate random 256-bit bearer credential, valid for ten minutes, bound to the installation identity. Only SHA-256 is persisted in the agency D1 table. The ticket is returned only to the authorized browser in a no-store response and sent to `/setup` as a fragment, then removed before application requests. It is never in an email link, query parameter or HTTP access log. It is held only in browser/server process memory, never localStorage. Refreshing the Administrator form requires reconnecting; refreshing the companion can recover the pending result until session expiry. A reconnect rotates only an unconsumed ticket. Public APIs cannot issue tickets or initialize a database.

`agency_setup_close` clears the digest and sets completion in the same D1 transaction that inserts any first staff account. Account insertion rechecks empty accounts, installation, exact digest, expiry and unconsumed state in one statement. A failed hash does not consume the ticket. Concurrent insertions cannot both create initial Administrators. Bootstrap requests bypass diagnostic/activity body inspection. The new route is disabled unless `AGENCY_BROWSER_SETUP=1` and `INSTALLATION_MODE=agency`. Existing manual Cloud deployments and Local Only do not enable it.

Pending installs serve only setup assets and a minimal health response; ordinary staff and guest routes fail closed. An existing Worker must have the saved installation binding before it can be reused. An initialized installation is not redeployed; unhealthy existing installations with an Administrator stop for operator review before schema changes. Resource create intent is journaled before API calls to recover a lost response without issuing blind duplicate creates. Existing secrets and Administrators are preserved. There is no delete/reset API.

## Verified evidence and open gates

Run `npm test` for Node/SQLite/real Worker route regressions. Run `npm run test:agency:browser` for Chromium with simulated OAuth/infrastructure and the actual Worker/bootstrap handlers behind a local transport adapter. The browser harness blocks non-fixture network traffic; it does not authenticate a real Cloudflare user. An early redirect-mocking attempt reached Cloudflare's authorization error page; the fixture was corrected to intercept the local authorization start and block all non-fixture destinations. No account creation, consent, deployment or credential exchange occurred there.

| Phase 1 acceptance item | Current evidence |
| --- | --- |
| 1. Independent new Cloudflare installation | Journal/provisioning adapter tests and isolated config tests; live account acceptance pending |
| 2. First Administrator | Real Worker/D1-adapter concurrent insertion, password sign-in, browser form, strong-password/origin/expiry failures |
| 3–4. Staff creation and restrictions | Existing full real Worker/SQLite regressions pass; new hosted agency acceptance pending |
| 5–7. Apartments, private JPEGs, publication/guests | Existing regression suite passes; no new remote test performed |
| 8. Encrypted backups/restoration | Existing cryptographic/Local Only/Worker regression suite passes; new hosted installation restore pending |
| 9–11. Init, interruption and duplicate prevention | Lost-create-response retry, atomic journals, explicit Free preflight, duplicate-job and bootstrap race tests; real Cloudflare failure rehearsal pending |
| 12–13. Agency isolation and independent secrets | Separate resource-config tests, installation-bound bootstrap denials, random IDs/guest secrets; cross-account remote rehearsal pending |
| 14. Free without billing | Current official limits researched; fail-closed preflight tests. Actual OAuth plan evidence and live Free install unverified |
| 15. Update and recovery | Signed-release, exact approval/artifact, dual authorization, backup gates, revocation-during-backup, health failure and code recovery coordinator tests; UI, durable jobs and actual infrastructure adapters still incomplete |

The browser probe also verifies no Administrator password reaches the companion, ticket-fragment removal, narrow layout, setup summary download without credentials, bootstrap closure and sign-in handoff. Screenshots are synthetic and checked visually. No physical-device acceptance is claimed. CI includes the browser probe but remote CI status must be recorded separately from local results.

`npm run test:agency:emulator` additionally bundles the real Worker with Wrangler and executes it in the pinned Miniflare/workerd runtime with ephemeral D1, KV and SQLite Durable Objects. It passed concurrent first-Administrator closure, native scrypt through the private password object, Administrator and Staff sign-in, Staff denial of account management, apartment creation, private JPEG upload/retrieval with exact byte equality, encrypted package restoration, and prepared/ready health checks. No external Cloudflare account, remote deployment, billing state or public Free CPU behavior is established by this local-runtime test. The existing Local Only browser acceptance also passed offline restart/editing/backup and zero-external-request gates after these changes.

## Update integration still required

`update.mjs` has no live deployment entry point. Its callbacks are explicit trusted host interfaces; test doubles are not backup, authorization, deployment or rollback proof. Before enabling it:

- Add an authenticated Administrator update page showing installed/available compatible versions, verified release notes, exact approval and readable progress/history. Store approval/revocation durably with account revision, manifest/build/install binding and expiration.
- Approve a publisher signing key and immutable release channel. Never accept a trust key delivered by the candidate manifest. Verify artifact bytes and source/CI provenance before deployment; synthetic `0.2.1` in tests is not a published release.
- Implement and rehearse complete D1, actual KV JPEG and agency-controlled secret/configuration backups in agency-approved storage. A KV list or a confirmation checkbox is not backup evidence. Do not put verifiers/backups in public journals or ordinary support reports.
- Wire fresh agency Cloudflare OAuth authorization and revalidation of the live approving Administrator. Build changes and permission/approval revocation during backup must stop deployment.
- Use durable jobs and deployment compare-and-swap against the approved installed build. Do not allow concurrent updates or treat initial setup retries as updates. Record crash-recovery checkpoints.
- Implement additive migration and code-only rollback adapters preserving D1/KV, secrets, accounts, scopes and class bindings. Verify health, original synthetic record/byte preservation and recovery on an approved isolated environment. Never roll an old database over newer edits as a code rollback shortcut.

Phase 2 remains deferred until all Phase 1 gates close. This branch creates no temporary support account, support token system, remote Local Only capability or developer backdoor.
