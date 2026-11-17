// Synthetic data only. Run on its own loopback origin; never contacts the pilot.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { zipSync } from "../dist/vendor/backup-crypto.js";
const output =
  process.env.LOCAL_TEST_OUTPUT ??
  (await mkdtemp(join(tmpdir(), "local-tours-evidence-")));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "local-tours-profile-")),
  origin = "http://localhost:4186",
  requests = [],
  errors = [],
  results = [];
let service = spawn(process.execPath, ["local/serve.mjs"], {
    env: { ...process.env, LOCAL_TOURS_PORT: "4186" },
    stdio: ["ignore", "pipe", "pipe"],
  }),
  context,
  page;
const launched = new Promise((resolve, reject) => {
  service.stdout.on("data", (d) => {
    if (d.toString().includes("loopback only")) resolve();
  });
  service.on("error", reject);
  service.on("exit", (code) =>
    reject(Error("Local test server exited " + code)),
  );
});
const launch = async () => {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  context.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method(), body: r.postData() }),
  );
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  page = context.pages()[0];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(20000);
  page.on("dialog", (d) => d.accept());
};
const pass = (text) => {
  results.push(text);
  console.log("PASS " + text);
};
const ready = () =>
  page.locator("#local-offline-status[data-ready=true]").waitFor();
const current = () =>
  page.evaluate(async () => {
    const { localStore } = await import("/local/store.js");
    return localStore.load(
      new URLSearchParams(location.hash.slice(1)).get("apartment"),
    );
  });
const saved = async (revision) => {
  await page.waitForFunction(async (revision) => {
    const { localStore } = await import("/local/store.js");
    const id = new URLSearchParams(location.hash.slice(1)).get("apartment");
    return (await localStore.load(id)).revision > revision;
  }, revision);
  await page.waitForFunction(
    () =>
      !document.getElementById("guide-next").disabled &&
      document.getElementById("guide-status").textContent !== "Savingï¿½",
  );
};
const newApartment = async (title) => {
  await page.goto(origin);
  await page.locator("#new-apartment").click();
  await page.getByLabel("Apartment name").fill(title);
  await page
    .getByRole("button", { name: "Create apartment", exact: true })
    .click();
  await page
    .locator("#guide-status")
    .filter({ hasText: "Local apartment ready" })
    .waitFor();
  return new URLSearchParams(new URL(page.url()).hash.slice(1)).get(
    "apartment",
  );
};
const step = (n) =>
  page.getByRole("button", { name: new RegExp("^" + n + "\\. ") }).click();
const snapshot = async (name) =>
  page.screenshot({ path: join(output, name + ".png"), fullPage: true });
const backupPassword = "Synthetic backup testing only 2026";
async function password(creating, value = backupPassword) {
  const d = page.locator(".backup-password-dialog");
  await d.waitFor();
  await d.locator("[name=backupPassword]").fill(value);
  if (creating) await d.locator("[name=backupConfirmation]").fill(value);
  await d.locator("button[type=submit]").click();
}
async function drag(selector, x = 0.55, y = 0.45) {
  const source = page.locator(selector);
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox(),
    pano = await page.locator("#pano").boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(pano.x + pano.width * x, pano.y + pano.height * y, {
    steps: 14,
  });
  await page.mouse.up();
}
try {
  await launched;
  await launch();
  await page.goto(origin);
  await ready();
  pass("Complete offline shell verified");
  const first = await newApartment("Synthetic Local Alpha");
  await page
    .locator("#guide-files")
    .setInputFiles([
      "cloudflare/sample-images/living.jpg",
      "cloudflare/sample-images/kitchen.jpg",
    ]);
  await passwordIfNone();
  async function passwordIfNone() {
    await page
      .getByRole("button", { name: "Import and save locally", exact: true })
      .click();
    await page.locator(".batch-review").waitFor({ state: "detached" });
  }
  const bedroom = await readFile(
    new URL("../cloudflare/sample-images/bedroom.jpg", import.meta.url),
  );
  await page
    .locator("#guide-files")
    .setInputFiles({
      name: "synthetic-bedroom.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(zipSync({ "Bedroom.jpg": bedroom })),
    });
  await passwordIfNone();
  assert.equal(await page.locator(".upload-photo img").count(), 3);
  assert.ok(
    await page
      .locator(".upload-photo img")
      .evaluateAll((images) =>
        images.every((i) => i.complete && i.naturalWidth > 0),
      ),
  );
  assert.equal(await page.locator("#guide-workspace").isVisible(), false);
  let d = await current();
  assert.equal(Object.keys(d.tour.grid.positions).length, 0);
  assert.equal(d.tour.rooms.flatMap((r) => r.links).length, 0);
  pass("JPEG and ZIP review imports, thumbnails and blank layout");
  await snapshot("upload-desktop");
  await page.locator('#guide-add-room').click();await page.getByLabel('New room name').fill('Shared room');await page.getByLabel('Attach stitch').selectOption(d.tour.rooms[0].id);await page.locator('.guide-dialog').getByRole('button',{name:'Add room',exact:true}).click();await page.locator('.guide-dialog').waitFor({state:'detached'});await page.getByLabel('Room group for kitchen',{exact:true}).selectOption('Shared room');await page.waitForFunction(async()=>{const {localStore}=await import('/local/store.js');const d=await localStore.load(new URLSearchParams(location.hash.slice(1)).get('apartment'));return d.tour.rooms.filter(r=>r.roomName==='Shared room').length===2;});pass('Optional grouping supports multiple viewpoints per room without grid placement');
  const ids = d.tour.rooms.map((r) => r.id);
  await step(2);
  await page.locator("#loading").waitFor({ state: "hidden" });
  for (let i = 0; i < ids.length - 1; i++) {
    await page.locator('.room-tab[data-room="' + ids[i] + '"]').click();
    await page.locator("#loading").waitFor({ state: "hidden" });
    const revision = (await current()).revision;
    await drag('.destination-handle[data-destination="' + ids[i + 1] + '"]');
    await saved(revision);
    await page.waitForFunction(
      () => !document.getElementById("guide-undo").disabled,
    );
    await page.waitForFunction(() =>
      document.getElementById("guide-status").textContent.includes(" saved."),
    );
    d = await current();
    const link = d.tour.rooms
      .find((r) => r.id === ids[i])
      .links.find((l) => l.target === ids[i + 1]);
    assert.ok(
      link,
      "Missing link " +
        JSON.stringify({
          i,
          ids,
          rooms: d.tour.rooms.map((r) => ({
            id: r.id,
            name: r.name,
            links: r.links,
          })),
          status: await page.locator("#guide-status").innerText(),
        }),
    );
    assert.ok(!link.pending && Number.isFinite(link.yaw));
    assert.ok(
      d.tour.rooms
        .find((r) => r.id === ids[i + 1])
        .links.some((l) => l.target === ids[i] && l.pending),
    );
    await page.locator('.room-tab[data-room="' + ids[i + 1] + '"]').click();
    await page.locator("#loading").waitFor({ state: "hidden" });
    const before = (await current()).revision;
    await page
      .locator('.destination-handle[data-destination="' + ids[i] + '"]')
      .click();
    await page
      .locator("#place-on-pano")
      .click({ position: { x: 450, y: 150 } });
    await saved(before);
  }
  pass(
    "Real pointer doorway drops and reciprocal keyboard/tap placement save coordinates",
  );
  await page.locator('.room-tab[data-room="' + ids[0] + '"]').click();
  await page.locator("#loading").waitFor({ state: "hidden" });
  d = await current();
  const arrow = d.tour.rooms[0].links[0],
    old = structuredClone(arrow),
    rev = d.revision;
  await page.locator('.hotspot[data-door-index="0"]').focus();
  await page.keyboard.press("Shift+ArrowRight");
  await saved(rev);
  assert.notEqual((await current()).tour.rooms[0].links[0].yaw, old.yaw);
  await page.locator("#guide-undo").click();
  await saved(rev + 1);
  assert.deepEqual((await current()).tour.rooms[0].links[0], old);
  pass("Arrow movement and Undo preserve navigation");
  await snapshot("connect-desktop");
  await step(3);
  await page.waitForFunction(
    () => document.querySelectorAll(".guide-tile").length === 3,
  );
  d = await current();
  assert.equal(d.tour.grid.mode, "graph");
  assert.equal(Object.keys(d.tour.grid.positions).length, 3);
  await snapshot("layout-desktop");
  const beforeReset = d.revision;
  await page.locator("#guide-reset").click();
  await saved(beforeReset);
  assert.equal(Object.keys((await current()).tour.grid.positions).length, 0);
  await page.locator("#guide-undo").click();
  await saved(beforeReset + 1);
  assert.equal(Object.keys((await current()).tour.grid.positions).length, 3);
  pass("Relationship layout generation, Reset and Undo");
  await step(4);
  await page.locator("#loading").waitFor({ state: "hidden" });
  await page.locator("#guide-publish").click();
  await page
    .locator("#guide-status")
    .filter({ hasText: "Ready to Show on this device." })
    .waitFor();
  assert.equal((await current()).ready, true);
  pass("Mark Ready is local and preserves independent draft history");
  await page.goto(origin);
  await page
    .locator('[data-apartment="' + first + '"]')
    .getByRole("button", { name: "Export Backup" })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await password(true);
  const download = await downloadPromise,
    backupPath = join(output, "synthetic-roundtrip.shtour.zip");
  await download.saveAs(backupPath);
  pass("Complete encrypted .shtour.zip export");
  await page.locator("#import-backup").setInputFiles(backupPath);
  await password(false, "wrong-test-password");
  await page
    .getByText(
      "Incorrect backup password or damaged archive. Nothing has been imported.",
      { exact: true },
    )
    .waitFor();
  await password(false);
  await page
    .getByText("Backup restored as a new local Draft.", { exact: false })
    .waitFor();
  await page.waitForFunction(
    (n) => document.querySelectorAll(".gallery-card").length === n,
    2,
  );
  pass(
    "Wrong password rejected; encrypted restore creates a separate new apartment",
  );
  await page.locator("#import-backup").setInputFiles(backupPath);
  await password(false);
  await page.waitForFunction(() =>
    document.getElementById("message").textContent.includes("Backup restored"),
  ); // explicit second-copy approval via dialog handler
  await page.waitForFunction(
    (n) => document.querySelectorAll(".gallery-card").length === n,
    3,
  );
  pass("Duplicate import requires explicit independent-copy confirmation");
  const other = await newApartment("Synthetic Local Beta");
  assert.notEqual(other, first);
  await page.goto(origin);
  await page.waitForFunction(
    (n) => document.querySelectorAll(".gallery-card").length === n,
    4,
  );
  await snapshot("gallery-desktop");
  pass("Multiple independent apartments in local Gallery");
  await page.goto(origin + "/editor/#apartment=" + first + "&view=1");
  await ready();
  await page.locator("#loading").waitFor({ state: "hidden" });
  await page.getByText("Local tour · Read only. Use Edit in the Gallery to make changes.",{exact:true}).waitFor();
  assert.equal(await page.locator("#guide-steps").isVisible(), false);
  assert.equal(await page.locator(".destination-handle").count(), 0);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 900, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    for (const id of ids) {
      await page.locator('.room-tab[data-room="' + id + '"]').click();
      await page.locator("#loading").waitFor({ state: "hidden" });
      assert.equal(await page.locator("#error").isVisible(), false);
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await snapshot("viewer-" + viewport.width);
  }
  pass(
    "Read-only viewer and every panorama at phone/tablet/unfolded viewports",
  );
  const cdp = await context.browser().newBrowserCDPSession();
  let installed = false;
  try {
    await cdp.send("PWA.install", {
      manifestId: origin + "/",
      installUrlOrBundleUrl: origin + "/",
    });
    installed = true;
    await writeFile(
      join(output, "pwa-install.json"),
      JSON.stringify(
        await cdp.send("PWA.getOsAppState", { manifestId: origin + "/" }),
      ),
    );
    pass("Chromium PWA installation via DevTools");
  } catch (error) {
    results.push("UNVERIFIED OS PWA install: " + error.message.split("\n")[0]);
  }
  await context.close();
  await new Promise((r) => {
    service.once("exit", r);
    service.kill();
  });
  service = null;
  await launch();
  await context.setOffline(true);
  if (installed) {
    const browserCDP = await context.browser().newBrowserCDPSession();
    await browserCDP.send("PWA.launch", { manifestId: origin + "/" });
    pass(
      "Previously installed PWA launched after process restart with server stopped",
    );
  }
  await page.goto(origin);
  await ready();
  await page.waitForFunction(
    () => document.querySelectorAll(".gallery-card").length === 4,
  );
  await page.goto(origin + "/editor/#apartment=" + first);
  await page.locator("#guide-title").fill("Synthetic Alpha offline edit");
  await page.locator("#guide-title").blur();
  await page
    .locator("#guide-status")
    .filter({ hasText: "Saved on this device." })
    .waitFor();
  await page.reload();
  await page
    .locator("#guide-status")
    .filter({ hasText: "Local apartment ready" })
    .waitFor();
  assert.equal(
    await page.locator("#guide-title").inputValue(),
    "Synthetic Alpha offline edit",
  );
  await step(4);
  await page.locator("#loading").waitFor({ state: "hidden" });
  for (const id of ids) {
    await page.locator('.room-tab[data-room="' + id + '"]').click();
    await page.locator("#loading").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#error").isVisible(), false);
  }
  await snapshot("offline-restart");
  pass(
    "Browser process restart with static server stopped: Gallery, all spheres, editing, save and reload offline",
  );
  await step(1);
  await page.locator("#guide-backup").click();
  const offlineDownload = page.waitForEvent("download");
  await password(true);
  await (
    await offlineDownload
  ).saveAs(join(output, "synthetic-offline.shtour.zip"));
  pass("Encrypted backup export offline after process restart");
  // Copy a same-origin legacy database record only after an explicit user action.
  await page.evaluate(async () => {
    const { localStore } = await import("/local/store.js"),
      all = await localStore.list(),
      draft = await localStore.load(all[0].id);
    await new Promise((resolve, reject) => {
      const q = indexedDB.open("supported-housing-tour-editor", 1);
      q.onupgradeneeded = () => q.result.createObjectStore("drafts");
      q.onsuccess = () => {
        const db = q.result,
          tx = db.transaction("drafts", "readwrite");
        tx.objectStore("drafts").put(draft, "current");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = reject;
      };
    });
  });
  await page.goto(origin);
  await page.locator("#import-legacy").waitFor();
  await page.locator("#import-legacy").click();
  await page
    .getByText("Backup restored as a new local Draft.", { exact: false })
    .waitFor();
  assert.ok(
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const q = indexedDB.open("supported-housing-tour-editor");
          q.onsuccess = () => {
            const db = q.result,
              r = db.transaction("drafts").objectStore("drafts").get("current");
            r.onsuccess = () => {
              resolve(!!r.result?.tour);
              db.close();
            };
          };
        }),
    ),
  );
  pass("Explicit legacy draft copy works offline and original record remains");
  const count = await page.evaluate(
    async () =>
      (await (await import("/local/store.js")).localStore.list()).length,
  );
  const broken = Buffer.from(await readFile(backupPath));
  broken[Math.floor(broken.length / 2)] ^= 64;
  await page
    .locator("#import-backup")
    .setInputFiles({
      name: "damaged.shtour.zip",
      mimeType: "application/zip",
      buffer: broken,
    });
  await password(false);
  await page
    .getByText(
      "Incorrect backup password or damaged archive. Nothing has been imported.",
      { exact: true },
    )
    .waitFor();
  await page.locator(".backup-password-dialog [data-cancel]").click();
  assert.equal(
    await page.evaluate(
      async () =>
        (await (await import("/local/store.js")).localStore.list()).length,
    ),
    count,
  );
  pass("Damaged encrypted backup rejected offline without altering apartments");
  const isolated = await newApartment("Synthetic conflict/delete test"),
    editorURL = page.url(),
    otherPage = await context.newPage();
  otherPage.on("pageerror", (e) => errors.push(e.message));
  await otherPage.goto(editorURL);
  await otherPage
    .locator("#guide-status")
    .filter({ hasText: "Local apartment ready" })
    .waitFor();
  await page.locator("#guide-title").fill("Synthetic newest window");
  await page.locator("#guide-title").blur();
  await page
    .locator("#guide-status")
    .filter({ hasText: "Saved on this device." })
    .waitFor();
  await otherPage.locator("#guide-title").fill("Must not overwrite");
  await otherPage.locator("#guide-title").blur();
  await otherPage
    .getByText("This apartment changed in another window.", { exact: false })
    .waitFor();
  assert.equal((await current()).tour.title, "Synthetic newest window");
  await otherPage.close();
  pass("Two real windows reject stale saves without overwriting newer work");
  await page.goto(origin);
  const isolatedCard = page.locator('[data-apartment="' + isolated + '"]');
  await isolatedCard.waitFor();
  await isolatedCard.locator("summary").click();
  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => dialog.dismiss());
  await isolatedCard
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  assert.ok(
    await page.evaluate(
      async (id) =>
        (await (await import("/local/store.js")).localStore.list()).some(
          (a) => a.id === id,
        ),
      isolated,
    ),
  );
  page.on("dialog", (dialog) => dialog.accept());
  await isolatedCard
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page
    .getByText("Selected local apartment deleted.", { exact: false })
    .waitFor();
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await (await import("/local/store.js")).localStore.list()).some(
          (a) => a.id === id,
        ),
      isolated,
    ),
    false,
  );
  pass("Deletion cancellation and confirmed apartment-scoped deletion");
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("https://example.invalid/tour-data");
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  pass("Explicit external application fetch blocked locally before network");
  const external = requests.filter(
    (r) => /^https?:/.test(r.url) && !r.url.startsWith(origin + "/"),
  );
  assert.deepEqual(external, []);
  assert.deepEqual(
    requests.filter((r) => r.method !== "GET"),
    [],
  );
  assert.ok(
    requests.every(
      (r) =>
        !r.body &&
        !r.url.includes("Synthetic") &&
        !r.url.includes(backupPassword),
    ),
  );
  assert.deepEqual(errors, []);
  pass(
    "No external HTTP requests, uploads, API calls or backup passwords in network traffic",
  );
  await writeFile(
    join(output, "network.json"),
    JSON.stringify(requests, null, 2),
  );
} catch (error) {
  await snapshot("failure").catch(() => {});
  throw error;
} finally {
  await context?.close();
  service?.kill();
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        results,
        requestCount: requests.length,
        errors,
        physicalDeviceTested: false,
      },
      null,
      2,
    ),
  );
  console.log("Evidence: " + output);
}
