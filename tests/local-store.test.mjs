import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { createLocalStore, newId } from "../local/store.js";
import { addIncompleteRoom } from "../dist/builder-data.js";
import { placeDoorway } from "../dist/doorway-data.js";
import { generateLayout } from "../dist/graph-tour.js";
import { encryptBackup, decryptBackup } from "../dist/encrypted-backup.js";
const blob = new Blob(
  [
    await readFile(
      new URL("../cloudflare/sample-images/living.jpg", import.meta.url),
    ),
  ],
  { type: "image/jpeg" },
);
const store = (options) =>
  createLocalStore({ indexedDB: new IDBFactory(), ...options });
async function populated(s, title = "Synthetic apartment") {
  const a = await s.create(title),
    d = await s.load(a.id);
  for (const name of ["Living", "Kitchen", "Bedroom"]) {
    const id = addIncompleteRoom(d.tour, name);
    d.images.set(id, blob);
    d.tour.builder.missing = d.tour.builder.missing.filter((x) => x !== id);
  }
  return { ...(await s.save(a.id, d, a.revision)), draft: d };
}
test("Local Only apartments preserve original bytes, identity, atomic revisions and restart", async () => {
  const db = new IDBFactory(),
    s = store({ indexedDB: db }),
    a = await populated(s),
    b = await populated(s, "Second");
  assert.notEqual(a.id, b.id);
  assert.equal((await s.list()).length, 2);
  const d = await s.load(a.id);
  assert.deepEqual(
    await d.images.values().next().value.arrayBuffer(),
    await blob.arrayBuffer(),
  );
  await s.close();
  const reopened = store({ indexedDB: db });
  assert.equal((await reopened.load(a.id)).revision, 2);
  const results = await Promise.allSettled([
    reopened.rename(a.id, "One", 2),
    reopened.rename(a.id, "Two", 2),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.find((r) => r.status === "rejected").reason.code,
    "LOCAL_CONFLICT",
  );
  assert.equal((await reopened.load(b.id)).tour.title, "Second");
});
test("Local Only graph, reciprocal positions, readiness and saved revision recovery", async () => {
  const s = store(),
    a = await populated(s),
    d = await s.load(a.id),
    [x, y] = d.tour.rooms;
  placeDoorway(d.tour, x.id, y.id, { yaw: 0.4, pitch: 0.1 });
  await assert.rejects(s.save(a.id, d, 2, { ready: true }), {
    code: "LOCAL_INCOMPLETE",
  });
  placeDoorway(d.tour, y.id, x.id, { yaw: -0.2, pitch: 0.05 });
  generateLayout(d.tour);
  await s.save(a.id, d, 2);
  await s.markReady(a.id, 3);
  assert.equal((await s.load(a.id)).ready, true);
  await s.rename(a.id, "Changed", 4);
  assert.equal((await s.load(a.id)).ready, false);
  await s.restore(a.id, 2, 5);
  assert.equal((await s.load(a.id)).tour.rooms[0].links.length, 0);
  assert.equal((await s.revisions(a.id)).length, 6);
});
test("Local Only encrypted packages restore new identities, deduplicate and retain every JPEG and metadata", async () => {
  const s = store(),
    a = await populated(s),
    d = await s.load(a.id),
    password = "synthetic-test-password-only",
    encrypted = await encryptBackup(d, password);
  await assert.rejects(decryptBackup(encrypted, "wrong-password"));
  const restored = await decryptBackup(encrypted, password);
  assert.deepEqual(restored.tour, d.tour);
  const imported = await s.importDraft(restored);
  assert.notEqual(imported.id, a.id);
  assert.deepEqual((await s.load(imported.id)).tour, d.tour);
  assert.equal((await s.importDraft(restored)).duplicate, imported.id);
  assert.ok((await s.importDraft(restored, { duplicate: true })).id);
  const broken = new Uint8Array(await encrypted.arrayBuffer());
  broken[Math.floor(broken.length / 2)] ^= 64;
  await assert.rejects(decryptBackup(new Blob([broken]), password));
});
test("Local Only quota and aborted transactions retain previously committed draft", async () => {
  let full = false;
  const idb = new IDBFactory(),
    s = store({
      indexedDB: idb,
      storage: { estimate: async () => ({ quota: full ? 1 : 1e9, usage: 0 }) },
    }),
    a = await populated(s);
  full = true;
  await assert.rejects(s.rename(a.id, "Uncommitted", 2), {
    code: "LOCAL_STORAGE_QUOTA",
  });
  assert.equal((await s.load(a.id)).tour.title, "Synthetic apartment");
  full = false;
  const open = idb.open("virtual-tours-local-only-v1", 1),
    db = await new Promise((r) => (open.onsuccess = () => r(open.result)));
  const tx = db.transaction(["apartments"], "readwrite");
  tx.objectStore("apartments").put({
    id: a.id,
    title: "Interrupted",
    revision: 999,
  });
  tx.abort();
  await new Promise((r) => (tx.onabort = r));
  assert.equal((await s.load(a.id)).revision, 2);
  db.close();
});
test("Local Only deletion is revision guarded, apartment scoped; diagnostic retention bounded", async () => {
  const s = store(),
    a = await populated(s),
    b = await populated(s);
  await assert.rejects(s.remove(a.id, 1), { code: "LOCAL_CONFLICT" });
  await s.remove(a.id, 2);
  assert.equal((await s.list()).length, 1);
  assert.equal((await s.load(b.id)).images.size, 3);
  for (let n = 0; n < 207; n++)
    await s.appendDiagnostic({ code: "TEST", count: n });
  const logs = await s.diagnostics();
  assert.equal(logs.length, 200);
  assert.equal(logs[0].count, 7);
});
test("Local Only failed final write rolls back photos, snapshot and metadata together", async () => {
  const s = store(),
    a = await populated(s),
    before = await s.usage(),
    original = IDBObjectStore.prototype.put,
    d = await s.load(a.id);
  d.tour.title = "Must not commit";
  try {
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "apartments")
        throw new DOMException("Synthetic interrupted write", "AbortError");
      return original.apply(this, args);
    };
    await assert.rejects(s.save(a.id, d, 2), { code: "LOCAL_SAVE_ABORTED" });
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  assert.equal((await s.load(a.id)).tour.title, "Synthetic apartment");
  assert.equal((await s.revisions(a.id)).length, 2);
  assert.deepEqual(await s.usage(), before);
});
