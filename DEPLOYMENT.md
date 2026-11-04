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

## Individual staff accounts

Create a dedicated Firebase Spark project with Analytics disabled and enable Email/Password as its only sign-in provider. Use Firebase Authentication settings to disable end-user signup and deletion. Before enabling staff accounts, verify that a direct signup request with a synthetic identity returns `ADMIN_ONLY_OPERATION` or the equivalent admin restriction. Verify that the project is still on Spark without a billing account. [Firebase pricing](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) · [Firebase user self-service settings](https://firebase.google.com/docs/auth/users#user_self-service)

Create the first synthetic user in Firebase Authentication. Apply the additive D1 schema, then run `node cloudflare/bootstrap-admin.mjs USERNAME FIREBASE_UID FIREBASE_EMAIL` on a trusted terminal. Apply its output to D1 using a private temporary SQL file. The SQL is guarded so it only bootstraps an empty Firebase staff account table. Set `FIREBASE_PROJECT_ID` in the ignored pilot configuration and set `FIREBASE_AUTH_API_KEY` through Wrangler secrets. Use a key restricted to Identity Toolkit. Keep the username mapping and key server-side.

Enable `STAFF_ACCOUNTS=1` for the synthetic acceptance deployment. Firebase checks passwords. The Worker verifies the signed Firebase token and its project, expiry, provider and UID, then checks the D1 session digest, account role, enabled flag and revision on protected requests. Sessions expire with the Firebase token, typically after one hour. Firebase refresh tokens are discarded. Login is rate limited by source address and normalized username. Writes require the app origin and session cookies are HTTP-only, SameSite Strict and Secure on HTTPS.

After bootstrap, create additional users in Firebase Authentication and link their UID and email under **Manage staff accounts** as an Administrator or Staff Editor. That page can send Firebase reset emails and disable or re-enable app access. A reset requested there or a disable invalidates existing app sessions. Direct changes in Firebase do not revoke an already issued app session immediately. Disable the app account in D1 when immediate revocation is required.

Before leaving named accounts enabled, test valid and invalid credentials, signup denial, reset delivery, logout, session expiry, disabled accounts and cross-browser roles with synthetic accounts. Verify guest unlock and staff route isolation. Capture live Workers CPU for sign-in and protected API calls with Wrangler tail and compare it with the 10 ms Free budget. Local tests and mocked Firebase responses cannot establish live CPU or Firebase project configuration.
