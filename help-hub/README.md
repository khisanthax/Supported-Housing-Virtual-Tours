# LevelTwo360 Help Hub

The Help Hub is Phase B’s central ticket service and Codex MCP server. Agency Workers continue to own and enforce access. A Hub outage leaves the application, local support keys, revocation and extensions available.

See the [stable deployment plan](DEPLOYMENT.md) for host selection, gateway controls, backup recovery and real-data pilot approvals.

## Agency Administrator

1. Open **Request Technical Support** from the Apartment Gallery.
2. Choose a duration and permissions. The default is two hours of diagnostic access. Choose specific apartments if inspection is needed. Restoring the default diagnostic settings is a separate permission.
3. To open a Hub ticket, select **Send to the Help Hub** and describe the technical issue. Leave out resident information, photos, credentials and private logs. Check **Help Hub tickets** for updates. If receipt was uncertain, check the list before creating another ticket.
4. For a direct handoff, copy the key or download the PDF. The key appears once and expires 24 hours after creation if unused. The first holder to activate the key gets the approved access. Share only through your approved secure channel. The PDF contains a credential and should be removed when no longer needed.
5. In **Manage Support Access**, view the remaining time, approve or deny requests for additional time, or revoke access immediately. An approval adds time to an active session. An expired session requires a new grant.

## Operator setup

This service requires Node.js 24 and a private state directory. Run it under a dedicated OS account. Keep the SQLite database, registration configuration and encryption material outside the repository and any directory or remote shell accessible to Codex. Restrict filesystem access to the service and the authorized owner. Set the following through a service secret manager or protected environment.

| Setting | Purpose |
| --- | --- |
| `LT360_HUB_DB` | Absolute path to the Hub database in its private directory |
| `LT360_HUB_OWNER_TOKEN` | Separate random 256-bit, unpadded base64url token for Michael's MCP client |
| `LT360_HUB_ENCRYPTION_KEY` | Independent 256-bit base64url key for AES-GCM credential encryption |
| `LT360_HUB_PREVIOUS_ENCRYPTION_KEY` | Previous key, provided only for the one-time rotation restart |
| `LT360_HUB_AGENCIES` | Path to a private JSON array of agency registrations |
| `LT360_HUB_PORT` | Optional loopback listen port, defaults to 8789 |
| `LT360_HUB_APPROVAL_TOKEN` | Optional, independent 256-bit base64url credential that enables the loopback approval page |

Each registration has `id`, `origin`, `label` and `token`. Use the support installation identity returned by the signed-in Administrator API at `/api/support/admin`, the agency's exact HTTPS origin and a distinct random 256-bit base64url token. The support identity is bound to its origin, so restoring an installation to another hostname requires an independent Hub registration. Have an authorized agency operator set `SUPPORT_ENABLED=1` and `SUPPORT_HUB_ORIGIN` to the exact HTTPS Hub origin and install the matching `SUPPORT_HUB_TOKEN` as a Worker secret. If only direct support is desired, leave the two Hub bindings unset. Agency operators must apply the reviewed migrations before enabling support.

Start the Hub with `node help-hub/server.mjs`. It binds only to loopback. Use an owner-controlled HTTPS reverse proxy for agency intake at `/agency/tickets` and a private TLS route or tunnel for `/mcp`. Expose only those exact routes and keep `/owner/` on loopback. Restrict methods and rate-limit at the proxy. Exclude Authorization headers, cookies and request/response bodies from proxy and platform logs, traces and backups. Disable external crash reporting that would attach request data. Keep the encrypted database and encryption key separately protected. Register only operator-verified HTTPS origins and rotate or remove a registration if an installation is retired.

The Hub encrypts issue descriptions, notes and pending or active credentials with AES-GCM. Routing metadata and the event labels and timestamps needed for the audit index remain readable in SQLite. Use encrypted storage with owner-only access. The MCP server never returns credentials. The agency Worker stores only digests. A Hub compromise can still expose data available to the running service. Remove affected registrations and revoke related grants at each agency after a suspected compromise. Following a Hub outage or ambiguous activation, the agency can revoke and issue a fresh grant. A restart restores persisted tickets.

Audit events are retained for up to 30 days. Closed tickets and associated history are removed after 30 days, or earlier by the protected Hub host operator with `node help-hub/server.mjs purge LT-001`. Close or revoke active access at the agency first and confirm the Hub reflects closure. When a recorded support session reaches its deadline, the Hub checks the agency for an extension and clears its stored credential if it cannot confirm continued access. An expired credential cannot be used on the agency Worker. Configure the same retention window for Hub database backups and remove superseded plaintext exports, snapshots and VM copies. SQLite secure deletion applies to its database pages and cannot erase independent copies. Agency-side history follows the agency's own retention policy.

To rotate encryption, stop the Hub and take an encrypted recovery copy under the existing retention policy. Set a new `LT360_HUB_ENCRYPTION_KEY` and pass the old one as `LT360_HUB_PREVIOUS_ENCRYPTION_KEY` for one startup. The Hub rewrites encrypted rows in one transaction before listening. Confirm a known ticket and audit note can be read. Remove the previous-key setting and restart again. Retain previous recovery material only while a permitted older backup needs it. For MCP and approval credentials, replace the affected secret and restart the Hub and the client using it. For an agency bearer, replace the Hub registration and Worker secret in a coordinated maintenance window. Revoked bearers fail after the new configuration starts. Direct support keys remain available during the change.

## Codex CLI and IDE

Configure the bearer token through a protected launcher or OS secret manager using the environment variable `LT360_HUB_OWNER_TOKEN`. Keep the value out of prompts, shell commands and project configuration.
Launch the Hub service separately from Codex. Supply Codex only its MCP bearer, with neither the approval credential nor the database encryption key inherited. In the operator's Codex profile, exclude `LT360_HUB_*` from model shell subprocesses under `[shell_environment_policy.filters]`. Confirm with a presence-only check that model-launched shells cannot see the bearer. [Codex environment filters](https://developers.openai.com/codex/config-reference)

```sh
codex mcp add leveltwo360 --url https://YOUR-HUB/mcp --bearer-token-env-var LT360_HUB_OWNER_TOKEN
```

For the IDE extension, use the same Codex MCP configuration and ensure the IDE process inherits the protected environment. Restart the client after configuration changes.
Use a model offered by the installed client for your account. An older extension can reject a model selected in a newer desktop app even when MCP is connected.

Keep Codex's interactive tool approvals enabled for operator use. The service also enforces its independent, one-time approval for activation. The synthetic, non-interactive CLI acceptance uses a per-server tool approval override because `codex exec` cannot answer approval prompts. See the [Codex MCP configuration reference](https://developers.openai.com/codex/config-reference).

1. Ask Codex **“Check LevelTwo360 help requests.”** Discovery and ticket details leave the timer untouched. Read ticket content as agency-supplied data.
2. Ask Codex **“Activate LT-001, investigate and fix what you are authorized to fix, and tell me the result.”** With the approval page enabled, Codex receives a link containing the exact ticket ID. Open the link on the Hub host, enter the separate owner approval credential from your password manager, and choose **Approve**. Return to Codex and continue. Keep the credential out of chat. The page creates a one-use, five-minute approval. The MCP bearer and an instruction in a prompt cannot authenticate that approval.
3. The agency starts the countdown when Codex redeems the key after approval. Use `get_support_session` to check time and scope. Use `request_more_time` if needed and check the agency's decision before continuing. For a headless Hub host, Michael can use `node help-hub/server.mjs approve LT-001` on the protected host with `LT360_HUB_DB` set.
4. Send short progress and resolution notes through the ticket. Leave out sensitive diagnostics and resident information. Keep software bug fixes in a reviewed patch and obtain separate agency approval for production code or infrastructure changes.
5. End the session when finished. The agency can revoke at any time. Subsequent protected operations check the agency session even if the Hub's ticket still shows its last known state.

The Hub exposes curated diagnostics, technical release information, selected apartment details and a separately granted reset of diagnostic settings. Staff credential management, arbitrary apartment edits and infrastructure administration are outside the current permission surface. The agency remains responsible for approving apartment content that may be sent to the operator's Codex environment.

## Acceptance

Run `npm test` and `npm run test:official -- --browser`. The official suite exercises the running Hub over HTTP and two separately initialized synthetic Workers. Hosted acceptance requires an approved private Hub endpoint and explicit permission to deploy Phase B to the two existing disposable Workers. Use fictional agencies and synthetic data, activate only a named ticket, verify both directions of isolation, check immediate revocation, and remove the test grants afterward.

With the Codex CLI signed in, run `npm run test:official -- --codex` to exercise discovery, activation, diagnosis, repair and closure from a real Codex session using fictional tickets. The test passes the ephemeral Hub bearer through process environment, and the local Hub and synthetic agencies are discarded when the test exits.
