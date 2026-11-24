# Supported Housing Virtual Tours

An interactive 360° apartment viewer and staff-managed tour catalog. The public source contains synthetic fixtures for testing.

Use Node.js 24. Run `npm test` for regression tests and `npm start` for the standalone demo at http://localhost:4173. The demo uses six stitched synthetic viewpoints with reciprocal door arrows.

The Cloudflare pilot uses Workers, D1 for manifests and permissions, and KV for private JPEGs. The Node sharing server is a separate prototype. See [deployment](DEPLOYMENT.md), [staff workflow](STAFF.md), [staff offline viewing](OFFLINE.md), [acceptance evidence and remaining gates](ACCEPTANCE.md), and [project log](LOGBOOK.md).

The [pilot handoff](PILOT.md) covers the physical Fold 7 test, staff onboarding and recovery, and importing the first approved apartment without coding.

The hosted editor starts in the Apartment Gallery and guides staff through Upload Stitches, Connect Rooms, Review Layout and Preview & Publish. New tours connect doorways directly in the panorama; their relationship diagram is generated afterward without inferring doors from adjacency. Existing legacy layouts are preserved until staff explicitly convert them. See [the staff guide](STAFF.md). The older [synthetic application screenshots](docs/EDITOR-SCREENSHOTS.md) document the previous grid-first workflow.

See [independent Cloudflare setup and upgrades](DISTRIBUTION.md), [architecture and deferred portability designs](ARCHITECTURE.md), [diagnostics and self-service support](DIAGNOSTICS.md), and [changelog](CHANGELOG.md). The separately published Option A template uses its approved agency license. Review the license in the published template before inviting an agency.

See the [first-agency pilot packet](official/AGENCY-PILOT.md) for the verified Workers Free Deploy flow and agency-owned recovery. The related [technical reference](official/README.md) records the provider and maintenance details.

## Local Only edition

For a separate device-only Gallery and the same modern editor, run `npm run start:local` and open http://localhost:4185. No Cloudflare login, data upload or synchronization is used. See [installation, storage and encrypted backups](LOCAL-ONLY.md) and [verified local acceptance](LOCAL-ACCEPTANCE.md). This edition does not replace the existing Cloudflare app.
