# Isolated live acceptance — prepared, not authorized or executed

Use synthetic data only. This plan changes no existing agency/production installation. Do not create an external Cloudflare account, add a payment method, upgrade a plan, publish an OAuth client or deploy until the specific owner gates below are approved. No approval is inferred from elapsed time or a successful local emulator test.

## Entry gates and exact scope

Record privately: owner-approved existing test account, approved HTTPS staging origin/host, tested source/build and release hashes, four verified resource scopes, private OAuth client ID and callback, signing public-key fingerprint, private journal/backup location and two installation names. Keep account/resource identifiers and deployment receipts outside Git. Client secret/private signing key/private recovery key remain in their approved stores, never chat, prompts, screenshots, command arguments, source or support reports.

**Stop before provisioning unless Workers Free is authoritatively verified.** Current blocker: the public OAuth catalog lacks Billing Read although the subscriptions API requires it. Obtain a supported Cloudflare path and test its exact permissions/response. Neither a checkbox, a zero-dollar trial, `default_usage_model=standard`, empty/403 response nor a Free zone is proof. Do not broaden into Billing Write or replace consent with copied agency API keys. Catalog discovery can run read-only before any registration.

Approve only two new uniquely suffixed synthetic installations in the selected test account, their D1/KV/SQLite-DO resources, the private staging companion and application test operations described below. No change to existing Worker routes, custom domains, staff, permissions, secrets or databases is included. No production deployment or public OAuth visibility is included. A private OAuth client cannot prove cross-account public-consent behavior; that is a later explicitly approved test using an already-existing second account, never an account created here.

## Local prerequisite evidence

Run on the exact candidate checkout:

```text
npm ci
npm test
npm run test:agency:browser
npm run test:agency:emulator
npm run test:agency:update:emulator
npm run test:local:browser
```

The unit suite exercises schema/secret/deployment/network interruption, lost create response, duplicate setup, foreign Worker identity, initialized-install preservation, role/build/manifest approval, write barriers, signed artifacts, actual encrypted snapshot restoration, crashes around activation, revocation, conflicting schemas and external deployment refusal. The browser test uses real application routes with simulated OAuth/infrastructure. The runtime tests use actual workerd/D1/KV/SQLite DOs, native scrypt/crypto, two isolated installations and two synthetic version/schema combinations. They do not establish a live Workers Free plan, public Worker CPU or real dashboard consent.

## Private registration and deployment rehearsal

1. Owner approves the prepared private OAuth payload, exact callback and four verified scopes. Register privately on the approved test account. Store the returned client secret directly in the host's secret store. Do not select public visibility or perform publisher DNS verification.
2. Start only the approved HTTPS staging companion using the tested artifact, protected persistent journal volume and separately approved public signing key. Check no body/cookie/query logging, no bundled .dev.vars, no publisher secret passed to Wrangler, and no token/secret in structured command outputs. Bind the underlying HTTP port only behind the approved TLS proxy. Capture sanitized configuration proof, not credential screenshots.
3. Verify real Cloudflare account creation/sign-in guidance without creating another account here: an existing owner signs in on Cloudflare. Check denial/cancel, state mismatch/replay, cookie rotation, actual consent/account selection, session expiration and token revocation. Observe the exact consent resource scope. No Cloudflare password passes through LevelTwo360.
4. Validate the supported authoritative Free read against this account. Confirm no billing/plan/payment write request appears. Record sanitized plan type and current quota evidence privately. If scopes or API responses differ from the confirmed contract, stop, correct the adapter and rerun local tests; never bypass the Free guard.
5. Install A through the browser; double-click once deliberately and refresh during progress. Inspect the saved private journal and resource inventory: exactly one Worker/database/namespace per installation, one SQLite DO class binding, independent generated secrets, no reference to another installation or developer pilot. The partially initialized site must deny normal routes.
6. Interrupt only the approved staging companion/network after a journaled resource step; restart/reconnect and select the same name/account. Verify no resource deletion/replacement or duplicate initialization. Rehearse additive schema failure/retry. A resource-name/identity conflict must stop safely.
7. Create A's first Administrator through its own HTTPS page, including mismatch/weak-password denial, expired/refreshed setup authorization and interrupted submission. Test two simultaneous valid submissions. Verify one account, digest consumed, public registration closed, existing Administrator preserved on retry, password absent from companion requests/logs and summary. Save the credential-free summary.
8. Install B independently. Compare resource identities and secret fingerprints privately, never secret values. Verify A cookies/tickets/invitations cannot authorize B, B staff cannot read A apartment IDs/JPEGs, and catalogs/backups contain only their own installation data.

## Application acceptance on new synthetic installations

9. In A, create Staff and a second Administrator. Verify Staff direct API denial for account/permission/update management; exercise individual grants, apartment scope, disable/reset and immediate session revision invalidation. Test final-Administrator protection. Never modify an existing production account for this exercise.
10. Create/edit synthetic apartments, upload approved synthetic stitched JPEGs, compare exact private bytes, and reject invalid/oversized images. Test all guided editor steps, refresh/recovery, private drafts and selected scope. No unauthenticated direct storage/thumbnail/image URL may work.
11. Publish a synthetic tour and wait for its documented image propagation interval. Create a guest invitation, unlock it in an independent browser, deny unrelated apartments/images and revoke it. Compare the unpublished draft and preserved publication before/after edits. Test expiry and duplicate/replayed requests where applicable.
12. Export encrypted apartment backups in the existing format; reject wrong password/tampering without uploads; restore exact metadata/JPEGs into a new synthetic apartment. Confirm publication and unrelated apartments are unchanged. This is separate from the installation snapshot below.

## Approved software update and recovery

13. Configure only a reviewed, correctly signed synthetic compatible release on staging. On A, verify installed/available version, trusted notes, exact artifact signature/hash and pinned key. Reject an unsigned/tampered/incompatible release. Generate/download the agency private recovery key locally; inspect request payloads to ensure only its public key leaves the browser. Approve the exact release and observe the durable two-hour role/build/install binding. Staff must be denied.
14. Reconnect with fresh Cloudflare consent, choose A's approved request and start it. Verify maintenance blocks writes at the database boundary, including an edit already running when the lock is acquired. Check the encrypted snapshot contains actual D1 business records, JPEG bytes, settings/bindings and recoverable sealed guest secret. No plaintext snapshot/private recovery key may be persisted by the companion. A failed/oversized/quota-limited backup must stop without activation.
15. Record expected previous/staged Worker versions privately. Confirm staging alone has not activated code; inspect uploaded source/asset parity against the signed precompiled artifact, preserved secret bindings, unchanged DO class and compatibility flags, and no unsupported resource changes. Apply only contiguous reviewed additive migrations. Reject an existing object with a conflicting definition. Capture state before/after accounts, permissions, guest publication and exact JPEG hashes.
16. Activate the reviewed version with no parallel infrastructure operator changing this Worker. Verify exact build/version/schema and normal behavior after maintenance unlock. Record sanitized public Worker/DO CPU and error observations under sequential/concurrent/cold-like requests against the documented Free budgets; local runtime timing is not a substitute.
17. Download the encrypted installation snapshot after fresh consent. Copy the trusted SHA-256 reference from signed-in update history and store separately with the agency backup record. Verify/decrypt only on approved protected local storage using the separate private recovery key. Check the restored SQLite integrity, staff verifiers/roles/scopes/audit data, settings, original guest secret and actual image hashes. Prepare recovery only into a NEW local directory; do not import over any live database. Session/attempt/pending-authority/diagnostic-event exclusions are intentional; settings remain included.
18. Repeat with isolated failure checkpoints: denied/expired Cloudflare authorization; revoked approval before and after backup; changed approving account revision before lock; interrupted backup; altered encrypted file; failed additive migration; crash before activation; lost activation response; crash after activation; failed new-version health; revoked approval before reporting completion. Verify durable resume checks actual version rather than blindly redeploying, and code recovery never restores an older whole database or rotates secrets.
19. On A only, introduce an unrelated synthetic external deployment under this approved test scope. Resume the older update and verify it refuses force overwrite and leaves maintenance for explicit operator review. Restore the agreed test baseline only through the separately authorized test operator; never exercise this against production. Rehearse failed recovery/retained-version-unavailable guidance without deleting the real retained rollback version unnecessarily.
20. Confirm B is unaffected throughout A's update/recovery. Repeat one compatible update on B using its own approval, resources and recovery key. Re-running setup on an initialized installation must still preserve its Administrator and must not serve as an upgrade command.

## Closeout and later approvals

Store sanitized evidence and screenshots privately; public repository evidence must remain synthetic and exclude actual account/database/namespace/deployment identifiers. Record real quotas/billing state without changing them. Revoke only the staging application's temporary grants, sign out synthetic sessions and revoke synthetic guest invitations. Test resources remain intact until the owner separately approves cleanup; this plan authorizes no deletion of existing resources. Report all unverified items honestly.

Only after the supported Free-verification path and this acceptance pass may Phase 1 be declared complete. Public publisher domain verification/irreversible public OAuth promotion, public release policy/license and actual agency production rollout each require separate explicit approval. Phase 2 starts on a separate branch only after the Phase 1 prerequisite is satisfied, and stays synthetic until separately authorized for agency use.
