# Phase B hosted rehearsal

The owner confirmed both named Workers are disposable and contain synthetic data. Their D1, KV and Durable Object bindings were positively matched before mutation. This authorization covers these two fixtures only.

| Fictional agency | Worker | D1 | KV | Login Durable Object | Option A rollback version |
| --- | --- | --- | --- | --- | --- |
| A | `lt360-option-a-root-rehearsal-1121` | `lt360-option-a-root-rehearsal-1121-db` · `be43c32a` | `lt360-option-a-root-rehearsal-1121-photos` · `1e98051f` | `StaffLogin` · `fc677f07` | `312fe075-015a-4eb0-a8e9-0ce6c7656304` |
| B | `lt360-option-a-rehearsal-1120` | `lt360-option-a-rehearsal-1120-db` · `22f35479` | `lt360-option-a-rehearsal-1120-photos` · `9ef2f65d` | `StaffLogin` · `e46a9697` | `91140ba1-eb77-4bbb-839b-ed34b87a0747` |

## Acceptance procedure

1. Match Worker names, installed origins, account and exact binding IDs. Record the active version for each Worker. Stop if a name or binding differs from the approved inventory.
2. Verify the Free rehearsal account. Apply the reviewed additive migration and deploy only to these Worker names. Confirm binding identity and apartment preservation after each deployment.
3. Start the Help Hub in a private state directory. Use a temporary authenticated HTTPS gateway exposing only `/agency/tickets` and `/mcp`. Keep `/owner/` on loopback. Use independently generated synthetic credentials. Confirm unauthenticated access is rejected.
4. Sign in as a synthetic Administrator per installation. Verify 2-, 24-, 48- and 72-hour session lengths from the activation time, single use, denial on the other origin, and read-only access. Approve and deny extensions. Verify expired keys and sessions, and revocation on the next request.
5. Submit and inspect an opted-in ticket from each Worker. Ask the real signed-in Codex CLI to list requests. Verify that pending keys remain unused. Try activating a named ticket, open its owner link, approve only that ticket, and confirm the other ticket remains blocked. Complete a scoped read, a permitted diagnostic repair and a session close. Send a progress note and verify that only the originating agency sees it.
6. Suspend Hub intake and verify that local support still works. Restore intake and submit a new ticket. Create and validate encrypted backups from the same two Workers. Roll back to the recorded versions and confirm the original gallery data remains available.
7. Revoke pending and active test grants and disable the synthetic Administrators. Stop the temporary gateway and Hub. Maintain a record of outstanding synthetic artifacts for the later, separately authorized teardown.

## Cleanup inventory

- The two Workers, their D1 databases, KV namespaces and StaffLogin Durable Objects are the existing disposable installations. Keep them until the owner approves removal.
- Phase B adds migration 0008, support audit rows, synthetic credentials and rehearsal Worker versions inside those installations. The synthetic credentials are disabled after testing.
- The temporary Cloudflare Quick Tunnel and localhost gateway are session-bound. They create no new account Worker, DNS record or paid service. The tunnel stops at the end of the rehearsal.
- The private rehearsal directory contains the local test scripts, sanitized deployment evidence, the encrypted test archives and disposable Hub SQLite files. Keep it outside Git. The Hub credentials are generated in process memory. Ephemeral Worker secret input files are removed after deployment.

## Recorded results

The initial hosted Phase B versions were `b05f3c07-08eb-4917-9ae6-3fbb437fa26e` for A and `49a770ce-0c44-4fd9-8105-d21d2c60d7ee` for B. The Hub was reached through a temporary authenticated Quick Tunnel and the signed-in Codex CLI operated the same Hub on loopback. A second transient tunnel verified authenticated external MCP initialization, tool discovery and ticket listing. It denied the agency bearer and kept the owner approval route off the edge. Both tunnels were stopped. Both Workers returned to the Option A versions listed above and Cloudflare reported 100% of traffic on each baseline. A final D1 query found no open support grants or enabled fixture Administrators. Encrypted backups were created and validated on both Workers.

Codex client approval prompts can ask the operator to confirm a tool call. The Hub's public MCP request carries no independently verifiable proof that Michael personally accepted a prompt. The implemented owner approval link adds separate authenticated confirmation without a terminal command. OpenAI documents native user verification in particular host-owned local configurations. Availability for this standalone external Hub was not verified, so the Hub keeps independent approval. [Codex app server documentation](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

## Desktop and IDE acceptance

Tested the installed Codex Desktop App Server and the App Server bundled with the VS Code Codex extension. Each connected to a real synthetic Help Hub using the documented Streamable HTTP bearer configuration, discovered its tool catalog, listed and read a fictional ticket, and received an owner-approval denial on activation. Both signed-in clients completed a natural-language ticket-discovery turn. The older VS Code client initially rejected the newer desktop model. Selecting a model offered by the IDE client resolved the failure without changing MCP permissions or the user's settings. The native Settings panels were outside this protocol-level check. [Codex MCP configuration](https://developers.openai.com/codex/mcp)

## Fresh hosted restore

The source encrypted archive held a pending grant, an active support session, one synthetic apartment and three JPEGs. Restore refused to overwrite the initialized destination. The existing disposable destination Worker was temporarily attached to a newly migrated Free D1 database and empty KV namespace. Enrollment remained closed. The test interrupted restore after a real KV write, checked the destination stayed unavailable, rejected the wrong archive digest, then resumed and retried the same valid archive.

The restored Administrator could sign in with a fresh session and see the apartment. The source staff session, pending support key and active support session were rejected at the destination. The active session still worked at the source. All three JPEGs matched byte for byte, apartment version records matched, and the destination labeled the restored audit history. Both Workers returned to 100% traffic on their recorded Option A versions and original storage bindings, with no enabled rehearsal Administrator or usable support grant.

The two detached storage pairs use the names `lt360-phase-b-restore-1795436161642-db` and `lt360-phase-b-restore-1795436161642-photos`, and `lt360-phase-b-restore-1795436486245-db` and `lt360-phase-b-restore-1795436486245-photos`. Keep them in the rehearsal cleanup inventory alongside the two existing Workers. Their exact identifiers and private rehearsal artifacts are kept outside the source checkout.
