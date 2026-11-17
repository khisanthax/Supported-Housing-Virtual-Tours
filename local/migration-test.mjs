// Existing Cloudflare application runs against isolated in-memory D1/KV adapters.
// No Cloudflare credentials, resources, or network deployment are used.
import { DatabaseSync } from "node:sqlite";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import worker, { StaffLogin } from "../cloudflare/worker.mjs";
import { hashStaffPassword } from "../cloudflare/staff-password.mjs";
import { decryptBackup } from "../dist/encrypted-backup.js";
await import("../cloudflare/prepare.mjs");
const path = process.argv[2];
if (!path)
  throw Error("Provide the synthetic Local Only acceptance export path.");
const password = "Synthetic backup testing only 2026",
  draft = await decryptBackup(new Blob([await readFile(path)]), password),
  db = new DatabaseSync(":memory:"),
  photos = new Map();
for (const file of [
  "schema.sql",
  "uac-schema.sql",
  "uploads-schema.sql",
  "diagnostics-schema.sql",
])
  db.exec(
    await readFile(new URL("../cloudflare/" + file, import.meta.url), "utf8"),
  );
const DB = {
  withSession() {
    return this;
  },
  prepare(sql) {
    return {
      bind: (...args) => ({
        first: async () => db.prepare(sql).get(...args),
        all: async () => ({ results: db.prepare(sql).all(...args) }),
        run: async () => {
          const s = db.prepare(sql);
          return s.columns().length
            ? { results: s.all(...args) }
            : { meta: s.run(...args) };
        },
      }),
    };
  },
  async batch(statements) {
    db.exec("BEGIN");
    try {
      const result = [];
      for (const s of statements) result.push(await s.run());
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  },
};
const env = {
  LOCAL_SYNTHETIC_ONLY: "1",
  GUEST_CODE_KEY: randomBytes(32).toString("hex"),
  STAFF_AUTH_MODE: "password",
  STAFF_ACCOUNTS: "1",
  TOUR_UAC: "1",
  TOUR_API_BACKEND: "durable-object",
  DB,
  PHOTOS: {
    async put(key, value) {
      photos.set(key, new Uint8Array(value));
    },
    async get(key) {
      return photos.get(key)?.slice().buffer ?? null;
    },
  },
  ASSETS: {
    async fetch(request) {
      try {
        const path = new URL(request.url).pathname;
        const data = await readFile(
          new URL("../cloudflare/generated" + path, import.meta.url),
        );
        const type = path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : "text/html";
        return new Response(data, { headers: { "Content-Type": type } });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  },
};
env.STAFF_LOGIN = {
  getByName() {
    const instance = new StaffLogin(null, env);
    return { fetch: (r) => instance.fetch(r) };
  },
};
db.prepare(
  "INSERT INTO staff_accounts(username,password_verifier,role) VALUES(?,?,?)",
).run(
  "synthetic-local-compat",
  hashStaffPassword(randomBytes(24).toString("hex")),
  "administrator",
);
const token = randomBytes(32).toString("base64url");
db.prepare("INSERT INTO staff_sessions VALUES(?,?,?,?)").run(
  createHash("sha256").update(token).digest("hex"),
  "synthetic-local-compat",
  1,
  Date.now() + 600000,
);
let origin,
  uploads = 0;
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks),
      headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);
    const response = await worker.fetch(
      new Request(origin + req.url, {
        method: req.method,
        headers,
        ...(body.length ? { body } : {}),
      }),
      env,
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    if (req.method === "POST" && req.url === "/api/staff/photos") uploads++;
  } catch {
    res.writeHead(500);
    res.end("Synthetic harness failure");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
origin = "http://localhost:" + server.address().port;
const browser = await chromium.launch({ channel: "chromium" }),
  context = await browser.newContext(),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(20000);
await context.addCookies([
  {
    name: "__Host-sht_staff",
    value: token,
    domain: "localhost",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
  },
]);
try {
  await page.goto(origin + "/staff/migration");
  await page.locator("#migration-files").setInputFiles(path);
  await page.locator("[name=backupPassword]").fill(password);
  await page
    .getByRole("button", { name: "Unlock backup", exact: true })
    .click();
  await page.getByText("Preview complete.", { exact: false }).waitFor();
  assert.equal(uploads, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM versions").get().n, 0);
  await page.locator("#migration-list [type=checkbox]").check();
  page.once("dialog", (d) => d.accept());
  await page.locator("#migrate-selected").click();
  await page.getByText("Batch finished.", { exact: false }).waitFor();
  await page.getByText("Imported", { exact: true }).waitFor();
  const row = db.prepare("SELECT * FROM versions").get();
  assert.deepEqual(JSON.parse(row.manifest), draft.tour);
  const references = JSON.parse(row.photos);
  for (const [id, blob] of draft.images)
    assert.deepEqual(
      photos.get(references[id]),
      new Uint8Array(await blob.arrayBuffer()),
    );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM shares").get().n, 0);
  assert.ok(row.available > Date.now());
  assert.deepEqual(errors, []);
  const output =
    process.env.LOCAL_TEST_OUTPUT ??
    (await mkdtemp(join(tmpdir(), "local-migration-")));
  await page.screenshot({
    path: join(output, "migration-center.png"),
    fullPage: true,
  });
  await writeFile(
    join(output, "migration-results.json"),
    JSON.stringify({
      result: "PASS",
      viewpoints: draft.images.size,
      exactTour: true,
      exactPhotographs: true,
      explicitSelection: true,
      privateDraft: true,
      liveCloudflareTouched: false,
    }),
  );
  console.log(
    "PASS Existing Cloudflare Migration Center accepted Local Only encrypted backup: exact tour and JPEG bytes; private new draft; no live Cloudflare changes.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  db.close();
}
