import { validateDraft, inspectJpeg } from "../dist/tour-package.js";
import { blankApartment } from "../dist/builder-data.js";
import {
  enablePanorama,
  publicationView,
  reviewTour,
} from "../dist/graph-tour.js";
import { validateApartment } from "../dist/tour-data.js";
export const DATABASE = "virtual-tours-local-only-v1";
export const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
const validId = (id) => {
  if (!/^[a-f0-9]{32}$/.test(id ?? ""))
    throw Error("Choose an apartment from the local Gallery.");
  return id;
};
function fault(code, message) {
  return Object.assign(Error(message), { code });
}
export function storageError(error) {
  if (typeof error?.code === "string" && error.code.startsWith("LOCAL_"))
    return error;
  if (error?.name === "QuotaExceededError")
    return fault(
      "LOCAL_STORAGE_QUOTA",
      "Device storage is full. Your previous save was kept. Export backups before freeing space; do not clear this app’s browser data.",
    );
  return fault(
    "LOCAL_SAVE_ABORTED",
    "The device could not finish saving. Your previous committed version was kept. Reopen the Gallery and check it before retrying.",
  );
}
const hex = (bytes) =>
  Array.from(new Uint8Array(bytes), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
const hash = async (bytes) => hex(await crypto.subtle.digest("SHA-256", bytes));
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .filter((k) => value[k] !== undefined)
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
export async function prepareDraft(draft) {
  validateDraft(draft);
  const json = JSON.stringify(draft.tour);
  if (new TextEncoder().encode(json).length > 128 * 1024)
    throw fault(
      "LOCAL_INVALID_DATA",
      "Tour metadata exceeds the compatible package limit.",
    );
  const images = [];
  for (const [room, blob] of draft.images) {
    const { width, height } = await inspectJpeg(blob);
    const end = new Uint8Array(await blob.slice(-2).arrayBuffer());
    if (
      blob.size > 4 * 1024 * 1024 ||
      width > 8192 ||
      height > 4096 ||
      end[0] !== 255 ||
      end[1] !== 217
    )
      throw fault(
        "LOCAL_INVALID_IMAGE",
        "Use a complete stitched JPEG up to 4 MiB and 8192 × 4096.",
      );
    if (globalThis.createImageBitmap) {
      let bitmap;
      try {
        bitmap = await createImageBitmap(blob);
      } catch {
        throw fault(
          "LOCAL_INVALID_IMAGE",
          "This JPEG could not be decoded completely. Original projects were kept.",
        );
      } finally {
        bitmap?.close();
      }
    }
    images.push({
      room,
      hash: await hash(await blob.arrayBuffer()),
      bytes: blob.size,
      blob,
    });
  }
  const fingerprint = await hash(
    new TextEncoder().encode(
      JSON.stringify([
        canonical(draft.tour),
        images
          .map((p) => [p.room, p.hash])
          .sort((a, b) => a[0].localeCompare(b[0])),
      ]),
    ),
  );
  return { tour: structuredClone(draft.tour), images, fingerprint };
}
export function validateReady(draft) {
  validateDraft(draft);
  const issues = reviewTour(draft.tour).filter((i) => i.severity === "blocker");
  if (issues.length)
    throw fault("LOCAL_INCOMPLETE", issues.map((i) => i.message).join(" "));
  validateApartment(publicationView(draft.tour));
  return true;
}
export function createLocalStore({
  indexedDB = globalThis.indexedDB,
  storage = globalThis.navigator?.storage,
  name = DATABASE,
} = {}) {
  let opening;
  function open() {
    if (!indexedDB)
      return Promise.reject(
        fault(
          "LOCAL_STORAGE_UNAVAILABLE",
          "IndexedDB is unavailable. Use a normal supported browser profile, not private browsing.",
        ),
      );
    return (opening ??= new Promise((resolve, reject) => {
      let done = false;
      const q = indexedDB.open(name, 1);
      q.onupgradeneeded = () => {
        const db = q.result;
        db.createObjectStore("apartments", { keyPath: "id" }).createIndex(
          "sourceHash",
          "sourceHash",
        );
        db.createObjectStore("snapshots", {
          keyPath: ["apartment", "revision"],
        }).createIndex("apartment", "apartment");
        db.createObjectStore("photos", {
          keyPath: ["apartment", "hash"],
        }).createIndex("apartment", "apartment");
        db.createObjectStore("diagnostics", {
          keyPath: "id",
          autoIncrement: true,
        });
      };
      q.onerror = () => {
        if (!done) {
          done = true;
          reject(
            fault(
              "LOCAL_STORAGE_UNAVAILABLE",
              "Local storage could not open. Do not clear browser data; close other app windows and retry.",
            ),
          );
        }
      };
      q.onblocked = () => {
        if (!done) {
          done = true;
          reject(
            fault(
              "LOCAL_STORAGE_BLOCKED",
              "Close other Virtual Tours windows so local storage can open safely.",
            ),
          );
        }
      };
      q.onsuccess = () => {
        const db = q.result;
        if (done) {
          db.close();
          return;
        }
        done = true;
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        db.onclose = () => (opening = null);
        resolve(db);
      };
    }).catch((e) => {
      opening = null;
      throw e;
    }));
  }
  async function transaction(tables, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx, result, error;
      try {
        tx = db.transaction(
          tables,
          mode,
          mode === "readwrite" ? { durability: "strict" } : {},
        );
      } catch (e) {
        reject(storageError(e));
        return;
      }
      const fail = (e) => {
        error = e;
        try {
          tx.abort();
        } catch {}
      };
      const guard =
        (f) =>
        (...args) => {
          try {
            f(...args);
          } catch (e) {
            fail(e);
          }
        };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(storageError(error ?? tx.error));
      tx.onerror = () => {};
      try {
        work(tx, (value) => (result = value), fail, guard);
      } catch (e) {
        fail(e);
      }
    });
  }
  const list = () =>
    transaction(["apartments"], "readonly", (tx, done) => {
      tx.objectStore("apartments").getAll().onsuccess = (e) =>
        done(e.target.result.sort((a, b) => b.updated - a.updated));
    });
  async function load(id, revision) {
    validId(id);
    return transaction(
      ["apartments", "snapshots", "photos"],
      "readonly",
      (tx, done, fail, guard) => {
        const q = tx.objectStore("apartments").get(id);
        q.onsuccess = guard(() => {
          const meta = q.result;
          if (!meta)
            return fail(
              fault(
                "LOCAL_NOT_FOUND",
                "This local apartment is unavailable. Return to the Gallery.",
              ),
            );
          const s = tx
            .objectStore("snapshots")
            .get([id, revision ?? meta.revision]);
          s.onsuccess = guard(() => {
            if (!s.result)
              return fail(
                fault(
                  "LOCAL_MISSING_DATA",
                  "A saved revision is missing. Keep the device data and restore an encrypted backup.",
                ),
              );
            const snap = s.result,
              images = new Map(),
              draft = {
                tour: snap.tour,
                images,
                revision: snap.revision,
                currentRevision: meta.revision,
                ready: meta.readyRevision === meta.revision,
              };
            done(draft);
            for (const [room, photo] of Object.entries(snap.photos)) {
              const p = tx.objectStore("photos").get([id, photo]);
              p.onsuccess = guard(() => {
                if (!p.result)
                  return fail(
                    fault(
                      "LOCAL_MISSING_DATA",
                      "A local photograph is missing. Keep the project and restore a backup.",
                    ),
                  );
                images.set(room, p.result.blob);
              });
            }
          });
        });
      },
    );
  }
  async function commit(
    id,
    prepared,
    expected,
    { ready = false, sourceHash, duplicate = false } = {},
  ) {
    validId(id);
    if (!Number.isSafeInteger(expected) || expected < 0)
      throw fault(
        "LOCAL_CONFLICT",
        "Invalid saved revision. Reopen this apartment.",
      );
    const oldKeys = await transaction(["photos"], "readonly", (tx, done) => {
      tx.objectStore("photos").index("apartment").getAllKeys(id).onsuccess = (
        e,
      ) => done(e.target.result.map((k) => k[1]));
    });
    const additional =
      prepared.images
        .filter((p) => !oldKeys.includes(p.hash))
        .reduce((n, p) => n + p.bytes, 0) +
      new TextEncoder().encode(JSON.stringify(prepared.tour)).length;
    const estimate = await storage?.estimate?.().catch(() => null);
    if (
      estimate &&
      Number.isFinite(estimate.quota) &&
      Number.isFinite(estimate.usage) &&
      additional > estimate.quota - estimate.usage
    )
      throw storageError(new DOMException("", "QuotaExceededError"));
    return transaction(
      ["apartments", "snapshots", "photos"],
      "readwrite",
      (tx, done, fail, guard) => {
        const apartments = tx.objectStore("apartments"),
          q = apartments.get(id);
        q.onsuccess = guard(() => {
          const previous = q.result;
          if ((previous?.revision ?? 0) !== expected)
            return fail(
              fault(
                "LOCAL_CONFLICT",
                "This apartment changed in another window. Reopen it before saving or deleting; your newer work was kept.",
              ),
            );
          const write = () => {
            const revision = expected + 1,
              photos = Object.fromEntries(
                prepared.images.map((p) => [p.room, p.hash]),
              );
            for (const p of prepared.images)
              if (!oldKeys.includes(p.hash))
                tx.objectStore("photos").put({
                  apartment: id,
                  hash: p.hash,
                  bytes: p.bytes,
                  blob: p.blob,
                });
            const snapshot = {
              apartment: id,
              revision,
              tour: prepared.tour,
              photos,
              at: Date.now(),
            };
            tx.objectStore("snapshots").add(snapshot);
            apartments.put({
              id,
              title: prepared.tour.title,
              revision,
              readyRevision: ready ? revision : null,
              created: previous?.created ?? snapshot.at,
              updated: snapshot.at,
              photoCount: prepared.images.length,
              viewpointCount: prepared.tour.rooms.length,
              sourceHash: sourceHash ?? previous?.sourceHash ?? null,
            });
            done({ id, revision });
          };
          if (sourceHash && !duplicate) {
            const found = apartments.index("sourceHash").get(sourceHash);
            found.onsuccess = guard(() => {
              if (found.result) {
                done({ duplicate: found.result.id });
                return;
              }
              write();
            });
          } else write();
        });
      },
    );
  }
  async function save(id, draft, expected, options) {
    const prepared = await prepareDraft(draft);
    if (options?.ready) validateReady(draft);
    return commit(id, prepared, expected, options);
  }
  async function create(title = "Untitled apartment") {
    const draft = {
      tour: enablePanorama(blankApartment(title.trim())),
      images: new Map(),
    };
    return save(newId(), draft, 0);
  }
  async function importDraft(draft, { duplicate = false } = {}) {
    const prepared = await prepareDraft(draft);
    return commit(newId(), prepared, 0, {
      sourceHash: prepared.fingerprint,
      duplicate,
    });
  }
  async function rename(id, title, expected) {
    const d = await load(id);
    d.tour.title = title.trim();
    if (!d.tour.title)
      throw fault("LOCAL_INVALID_DATA", "Enter an apartment name.");
    return save(id, d, expected);
  }
  async function markReady(id, expected) {
    const d = await load(id);
    validateReady(d);
    return save(id, d, expected, { ready: true });
  }
  async function revisions(id) {
    validId(id);
    return transaction(["snapshots"], "readonly", (tx, done) => {
      tx.objectStore("snapshots").index("apartment").getAll(id).onsuccess = (
        e,
      ) =>
        done(
          e.target.result
            .map(({ revision, at }) => ({ revision, at }))
            .sort((a, b) => b.revision - a.revision),
        );
    });
  }
  async function restore(id, revision, expected) {
    return save(id, await load(id, revision), expected);
  }
  async function remove(id, expected) {
    validId(id);
    return transaction(
      ["apartments", "snapshots", "photos"],
      "readwrite",
      (tx, done, fail, guard) => {
        const q = tx.objectStore("apartments").get(id);
        q.onsuccess = guard(() => {
          if (!q.result || q.result.revision !== expected)
            return fail(
              fault(
                "LOCAL_CONFLICT",
                "This apartment changed in another window. Reload before deleting.",
              ),
            );
          for (const table of ["snapshots", "photos"]) {
            const cursor = tx
              .objectStore(table)
              .index("apartment")
              .openKeyCursor(id);
            cursor.onsuccess = guard(() => {
              const c = cursor.result;
              if (c) {
                tx.objectStore(table).delete(c.primaryKey);
                c.continue();
              }
            });
          }
          tx.objectStore("apartments").delete(id);
          done(true);
        });
      },
    );
  }
  const usage = () =>
    transaction(["photos"], "readonly", (tx, done) => {
      let bytes = 0,
        images = 0;
      const c = tx.objectStore("photos").openCursor();
      c.onsuccess = (e) => {
        const row = e.target.result;
        if (row) {
          bytes += row.value.bytes;
          images++;
          row.continue();
        } else done({ bytes, images });
      };
    });
  async function appendDiagnostic(record) {
    return transaction(["diagnostics"], "readwrite", (tx, done) => {
      const table = tx.objectStore("diagnostics"),
        q = table.add(record);
      q.onsuccess = () => {
        const c = table.openKeyCursor();
        c.onsuccess = (e) => {
          const row = e.target.result;
          if (row && row.key <= q.result - 200) {
            table.delete(row.primaryKey);
            row.continue();
          }
        };
      };
      done(true);
    });
  }
  const diagnostics = () =>
    transaction(["diagnostics"], "readonly", (tx, done) => {
      tx.objectStore("diagnostics").getAll().onsuccess = (e) =>
        done(e.target.result);
    });
  const close = async () => {
    if (opening) (await opening).close();
    opening = null;
  };
  return {
    list,
    load,
    save,
    create,
    importDraft,
    rename,
    markReady,
    revisions,
    restore,
    remove,
    usage,
    appendDiagnostic,
    diagnostics,
    close,
  };
}
export const localStore = createLocalStore();
