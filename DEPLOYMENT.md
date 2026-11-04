# Development and deployment

For local Worker testing, run these commands from the repository root in separate terminals as needed.

```powershell
node cloudflare/prepare.mjs
npx --yes wrangler@4.157.0 d1 execute DB --local --config cloudflare/wrangler.jsonc --file cloudflare/schema.sql
npx --yes wrangler@4.157.0 dev --local --config cloudflare/wrangler.jsonc --ip 127.0.0.1 --port 4193
node cloudflare/probe.mjs
```

The asset preparation script creates local development secrets in the ignored cloudflare/.dev.vars. Keep separate credentials for local and hosted environments. Use an ignored cloudflare/wrangler.pilot.json with the approved Worker name, D1 database and KV namespace. Set the exact HTTPS pilot origin, turn off preview URLs, and keep the pilot isolated from production housing data. Configure secrets through Wrangler. Never put them in Git or shell arguments. Inspect and back up the existing database before applying schema updates. Deploy only synthetic test data to the approved pilot.

Before deploying, confirm the Workers plan is Free, and check account-wide Workers, D1 and KV usage. Keep R2 and other paid products disabled. Verify signed-out routes, guest scope and revocation, JPEG retrieval, and CPU observations after deploy. Cloudflare quotas apply across account workloads.
