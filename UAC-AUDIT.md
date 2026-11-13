# Admin/Staff UAC — current access direction

Owner decision (12 November 2026): the application remains login-only. The root redirects to the secure staff login/gallery. Public Client Gallery and anonymous apartment browsing are disabled; no public content routes or visibility controls are activated. Client remains the third defined read-only context, used for the existing private invitation boundary, without new named accounts or a separate workflow. Earlier public-gallery requirements are superseded. Gmail API, SMS, recipient restrictions and approval workflows are outside this milestone.

## Authentication and migration

Reuse opaque HTTP-only staff sessions, D1 account revision checks and the existing private scrypt actor. Persisted `editor` is a compatibility alias displayed as Staff; credentials, accounts and compatible sessions are not rewritten. Additive `uac-schema.sql` contains policy/override/scope records, atomic policy audit triggers, activity history, image ownership, last-login metadata and last-active-Administrator guards. The reserved public-approval table remains empty and unused. Existing publication and invitation tables are not rewritten.

Defaults preserve existing operational Editor access: ordinary apartment viewing/creation/editing/upload/publication/invitation/backup/storage actions are allowed unless the Administrator changes them; protected account, role, permission, scope, audit and recovery actions remain Administrator-only. New public visibility management is denied to Staff and unavailable in the UI. Administrators cannot delegate protected actions, Client cannot receive editing/admin grants, and unknown permissions/routes fail closed. Individual allow/deny overrides precede ordinary role defaults; absent entries inherit. Scope is a separate condition that no override bypasses. All scope is the compatibility default. Selected scope is explicit. A permitted new apartment is added to its creator's selected assignment, auditable and removable by an Administrator.

## Enforcement and UI

`staff-request-policy.mjs` maps protected APIs to action identifiers. The Worker loads current D1 policy per request, filters catalogs and invitations, validates resource scopes, restricts image references to owned/authorized photos, and rejects unknown operations. Replacement needs image permission; explicit backup-import requests require import permission. Backup manifest access requires export permission. Staff who may view but not edit use the existing viewer in read-only preview, with no new presentation mode. Editor entry, management pages and APIs are guarded server-side. Buttons are also filtered for usability.

The Administrator panel has Users, Role Permissions, Individual Permissions, Apartment Access and Access History. The existing Staff Accounts screen handles account creation, reset, enabling and disabling. Role changes increment account revision. Policy updates use optimistic revisions and atomic audit records. SQLite triggers prevent concurrent changes from disabling, demoting or deleting the final active Administrator.

`activity-audit.mjs` records known action names, actor, resource IDs, status and time. It excludes passwords, invitation phrases, tokens, verifiers, raw request/response payloads and query strings. It records sign-in/out, account and permission changes, upload/save/publication actions, backup exports and guest-link activity. Latest 200 policy/history and activity records appear in the interface; older rows remain retained in D1. No email is sent directly.

## Scope and security limits

Someone authorized to view a photo can retain its visible contents; denying the backup button does not provide DRM. The explicit export and import workflows enforce their permissions, but an author allowed to upload/create may manually recreate a tour. These are capability boundaries, not a promise to prevent screenshots or re-entry. Offline vault/UI/download behavior is unchanged; current online authorization applies to its APIs. A disconnected copy cannot receive revocation until reconnect and retains its existing local expiry rules.

## Recovery and release gates

Fresh D1 export and KV inventory live outside Git under the operator's LOCALAPPDATA/SupportedHousingTour/uac-deployment. The inventory is not a JPEG-byte backup; retain .shtour packages and do not delete immutable KV keys. Fresh backup restore and idempotent migration preserved all 12 original tables by row-content digest. Operator Administrator recovery remains in DEPLOYMENT.md. Roll back code/config by disabling TOUR_UAC or restoring the previous approved Worker; keep additive tables and current apartment data. Never overwrite newer user edits with an older full database merely to roll back routing.

Activation uses TOUR_UAC=1 after applying the additive schema. The private API actor name changes to tour-api-uac-v1 to avoid mixed route contracts; bindings/classes are unchanged. Complete local regressions/browser checks before live migration, then verify existing administrator recovery access, synthetic Staff/private guest acceptance, rollback, edge CPU, preservation and deployed-source parity. No production credential, scope or invitation change is part of the migration.


## Issue #38: private Uploads Gallery

The new uploads.manage action is always granted to Administrator and denied to ordinary Staff defaults; only an Administrator-granted individual Allow designates a Staff Supervisor. Role-wide grants are rejected. No fourth role or recipient workflow. Scope still applies independently. The queue lives in one additive uploads_gallery row with a JSON membership set and optimistic revision, not duplicate apartment records. Guarded session/CAS updates preserve unrelated memberships; differential triggers add existing activity_history rows for each add/remove.

GET /api/staff/uploads filters active authorized queued apartments. Quick JPEG POSTs reuse /api/staff/photos with a validated apartment context; both queue membership and image.upload/scope are checked before storage. Existing POST /api/staff/apartments with purpose=uploads needs upload permission and scope, not editor permission. It reconstructs the only allowed additive transformation: new unplaced viewpoints; old photos/rooms/links and all other metadata must match. Existing CAS, immutable KV IDs, ready-photo checks and draft-only availability remain. Queue membership is checked again in the atomic version insert. Direct calls cannot use this mode to replace, delete, rename or publish. Existing editor APIs retain their original policy requirements.

Queue changes and successful/failed server upload attempts reuse sanitized activity_history. uploads.saved.N contains a server-computed new-viewpoint count, resource is the apartment ID, status/time/actor use existing fields. Browser validation/network failures that never reach the server are only shown locally. No bytes, filenames, credentials or invitation secrets are logged. No offline, encryption, guest or existing-account migration is introduced.
