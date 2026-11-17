# Architecture audit and future portability

Audit baseline: main `9a603e4` plus the 0.2.0 Cloudflare additions. The tables below describe inspected source, not a replacement application.

| Current component | Responsibility / reusable boundary |
| --- | --- |
| `cloudflare/worker.mjs` | Origin/routing/authentication/UAC, validated uploads, D1/KV persistence, sessions, versioned publication, scoped guests. Runtime-specific request context and bindings require adaptation elsewhere. |
| Private `StaffLogin` SQLite-backed Durable Object | Reviewed scrypt profile (`N=32768,r=8,p=3`, 32 MiB workspace) password hashing/verification plus existing private API dispatch. Public Workers route through a private binding; no public password-work endpoint or unsigned-token trust. D1 remains authoritative. |
| D1 and additive schemas | Immutable tour versions/photo references, lifecycle/publication, accounts/roles/overrides/scope, session revisions, invitation permissions/rate buckets, Uploads membership, policy/activity audit. New diagnostic/receipt tables do not replace business audit. |
| Private KV | Immutable original JPEG bytes with ready/reservation metadata in D1. Every image route authorizes before read; no public bucket URL. Eventual consistency still requires propagation/retry. |
| Wrangler / `prepare.mjs` | Generates protected frontend assets, binds installation-owned resources and deploys code. Guided setup creates independent resources and credentials. |
| `access-policy.mjs`, `staff-request-policy.mjs`, `activity-audit.mjs` | Central permissions and resource-scope checks; Admin-only protected actions; Staff Supervisor is an individual override, not a fourth role; Client remains reserved. Sanitized durable business activity remains separate from diagnostic detail. |
| Gallery / Uploads / guided editor | Existing authenticated catalog, selected upload destinations, validated JPEG/ZIP review, current Upload → Connect → Review Layout → Preview/Publish authoring. Draft CAS prevents silent overwrite; no upload/import implicitly publishes or creates invitations. |
| Guest Links | Separate unguessable URL and generated phrase, HMAC verifier, D1-scoped multi-apartment authorization, expiry/revocation. No guest accounts/public browsing. |
| `dist/app.js`, Marzipano, graph/grid/builder/package modules | Shared viewer, spherical coordinates, room graph, layout, validation, review and portable package logic. These are the strongest existing reuse candidates. |
| `sharing/offline-store.js`, offline UI and service worker | Existing staff-only encrypted IndexedDB playback vault, explicit downloads, completeness/update checks, local expiry and app-asset cache. Read-only offline playback is not a local editing workspace or shared database. |
| `dist/encrypted-backup.js`, `tour-package.js`, `backup-ui.js` | Browser-local AES-256-GCM/PBKDF2 encrypted ZIP envelope, complete portable tour validation, legacy import. No accounts/shares in a package; backup passwords never reach the server. |
| Diagnostics / Migration / Help (0.2.0) | Bounded sanitized spans linked to existing activity IDs, Admin report UI; explicit selected local-file imports to new private drafts; version and self-service guidance. No synchronization or ticketing backend. |

## The two stores are not interchangeable yet

`dist/tour-store.js` stores **one** `drafts/current` document plus JPEG Blobs in IndexedDB `supported-housing-tour-editor`, with a transaction/revision conflict check between tabs. It has no multi-apartment catalog, team identity, server policy or guest sharing. Browser eviction/data clearing can remove it. The older `dist/tour-editor.js` is a single-tour local editor; it is not the current guided Cloudflare application.

`cloudflare/cloud-tour-store.js` loads the apartment selected in the URL, fetches authorized photos, uploads changed immutable images, saves a new D1-backed private revision and checks stale saves. It depends on authenticated API routes, resource scope and cloud constraints. `prepare.mjs` adapts module paths for the current four-step `guided-editor.js`; simply replacing imports does not provide a complete Local Edition.

The offline vault is a **third** store with encrypted, expiring, staff-authorized playback snapshots. Do not reuse it as a writable local editor store or automatically migrate its contents. This milestone leaves its behavior unchanged.

## Local Only — design only

Use one shared guided editor with explicit adapters for `list/create/load/save/delete`, image read/write, revision checks, capability discovery and portable export/import. Move deployment-specific navigation/account/share controls behind declared capabilities. Keep core graph/validation/panorama/Undo logic shared; test adapter contracts with the same fixtures. A future IndexedDB adapter needs a multi-apartment schema and atomic per-apartment/image references, quota/error handling and explicit browser-persistence warnings. Preserve the old single draft with an opt-in migration and encrypted backup first. No such adapter, local gallery or new service worker is built here.

A Local Only build must ship its own editor/viewer/fonts/crypto assets, omit cloud endpoints and remote sharing, and pass a network audit plus restart/eviction/failure tests. HTTPS/localhost, browser storage estimates, optional persistence permission and approved device backups remain necessary; a PWA does not guarantee permanent data or zero network traffic merely because assets were cached. Device protection and backup-password policy are independent decisions. Existing encrypted portable packages provide the stable handoff boundary.

### Capture/stitching investigation

The external Stanford tool is not bundled. Its published [privacy policy](https://vftcam.stanford.edu/privacy-policy.html) says stitching/photo storage is local and no photos are uploaded; native sharing and optional GPS metadata require user choices. Its [technical architecture](https://vftcam.stanford.edu/building-vftcam.html) describes WebGL2, IndexedDB/OPFS and PWA caching. These are vendor statements reviewed on 16 November 2026, **not** a packet-capture audit of the owner's installed version. Site loading/updates still require network; camera, sensor and location permissions and OS/cloud photo backup behavior must be checked on the actual device. Verify the exact installed origin/version, capture offline, inspect network/storage, export and inspect JPEG GPS/metadata before agency approval. Do not infer behavior from unrelated similarly named Android applications.

## Optional cloud add-on — design only

Keep local and cloud workspaces separately identified, with explicit capability changes and account connection. An optional future update could enumerate local apartments in Migration Center, show previews, require selection/confirmation and copy selected complete packages into new private cloud drafts. Retain originals and record destination receipts; never auto-upload every local record. A reconnect is not permission for migration. One-way copy has no bidirectional conflict/sync semantics. Local-only use must continue independently of future paid editions. No add-on, IndexedDB enumeration, sync engine, licensing or payment code is implemented.

## Linux / generic hosting — investigation only

| Cloudflare binding | Simplest prospective equivalent | Adaptation / proof required |
| --- | --- | --- |
| Worker Fetch + static assets | Node.js 24 HTTP server with private static-route policy | Adapt ingress/headers/origin, streaming/error lifecycle and safe static allowlist; reproduce endpoint/UAC regression tests. |
| D1 prepared/bind/first/all/run/batch, sessions | SQLite transactions/WAL on one Linux host | Implement result metadata, atomic batches/CAS, SQL compatibility, migrations and backup/restore; D1 sessions are not a portable API. No PostgreSQL need established. |
| KV get/put/delete/list | Private filesystem with immutable object IDs | Atomic write/fsync/rename, permissions, capacity/reservation checks and crash recovery; guard traversal and authorize every read. S3 only if a measured requirement emerges. |
| Durable Object dispatch/password execution | Bounded password worker threads + coordinated SQLite rate/session records | Preserve scrypt costs, process memory/concurrency bounds and immediate D1-equivalent revocation. Replacing an actor with an unbounded HTTP handler is unsafe. No Redis requirement established. |
| Wrangler / bindings / secrets | Later Docker Compose or documented service manager + private environment/secret files | Installation IDs, TLS/proxy headers, volume ownership, upgrades, rollback and per-agency isolation need separate acceptance. No container files are built here. |

Preserve shared domain validation, viewer/editor, portable encrypted package and diagnostic report schemas. Introduce narrow DB/image/session/runtime adapters only when implementing the next edition; do not abstract the whole Worker speculatively. Start with one process/SQLite/private files and bounded password workers on one host. Multiple independent installations require separate state directories/secrets and explicit resource ownership; horizontal multi-host operation is a different design, not a promised switch.

Planning estimate for one experienced developer, excluding agency security review: shared editor/storage contract and Local Only prototype 2–3 weeks plus 1–2 weeks device/recovery hardening; later single-host Linux runtime/storage/auth adapters and packaging 3–5 weeks plus 1–2 weeks acceptance/upgrade tests; optional explicit local-to-cloud handoff 1–2 weeks after those contracts exist. These are rough engineering ranges, not quotes or delivery promises. Mobile eviction, migration fidelity, SQL/transaction semantics, secure deployment and recovery dominate uncertainty. No alternative edition is implemented or deployed.

## Implemented Local Only boundary (17 November 2026)

The owner approved Local Only implementation after the earlier design deferral. `dist/editor-contract.js` defines load/save/complete and explicit edition capabilities. The canonical current `cloudflare/guided-editor.js` is copied unchanged into both builds; `cloudflare/editor-runtime.js` binds existing D1/KV APIs/UAC, while `local/editor-runtime.js` binds atomic multi-apartment IndexedDB and local Ready state. `dist/app.js` remains the common Marzipano viewer; local identity/room selection uses URL fragments and Blob URLs. There is no second legacy editor implementation.

`local/build.mjs` allowlists shell assets and vendors every dependency. `local/sw-template.js` integrity-caches the whole shell and serves runtime requests cache-only; page CSP/network guards deny content transport. `local/store.js` keeps original-photo Blobs, immutable snapshots and CAS metadata in its own database, never the online vault. Gallery, local diagnostic transport, PWA and loopback-only static server are separate from cloud navigation/auth/sharing. Local schema requires no online migration. See LOCAL-ONLY.md for guarantees, origin boundaries and limitations. No Cloudflare deployment/data changes accompany this feature.
