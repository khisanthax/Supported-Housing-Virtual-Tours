# Supported Housing Virtual Tours

An interactive 360° apartment viewer and staff-managed tour catalog. The public source contains synthetic fixtures for testing.

Use Node.js 24. Run `npm test` for regression tests and `npm start` for the standalone demo at http://localhost:4173. The demo uses six stitched synthetic viewpoints with reciprocal door arrows.

The Cloudflare pilot uses Workers, D1 for manifests and permissions, and KV for private JPEGs. The Node sharing server is a separate prototype. See [deployment](DEPLOYMENT.md), [staff workflow](STAFF.md), [staff offline viewing](OFFLINE.md), [acceptance evidence and remaining gates](ACCEPTANCE.md), and [project log](LOGBOOK.md).
