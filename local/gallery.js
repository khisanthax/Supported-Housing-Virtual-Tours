import { localStore, storageError } from "./store.js";
import { exportBackup, readBackup } from "../dist/backup-ui.js";
import { recordFailure } from "./diagnostics.js";
const $ = (id) => document.getElementById(id),
  el = (tag, text) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    return n;
  },
  button = (text, action) => {
    const b = el("button", text);
    b.onclick = () =>
      Promise.resolve()
        .then(action)
        .catch((error) => say(error.message));
    return b;
  };
let urls = [],
  busy = false,
  legacy;
const say = (text) => ($("message").textContent = text);
const link = (text, id, view = false) => {
  const a = el("a", text);
  a.className = "button secondary";
  a.href =
    "/editor/#" +
    new URLSearchParams({ apartment: id, ...(view ? { view: "1" } : {}) });
  return a;
};
function dialog(title, build) {
  const d = el("dialog");
  d.className = "local-dialog";
  d.append(el("h2", title));
  const close = () => {
    d.close();
    d.remove();
  };
  build(d, close);
  d.append(button("Cancel", close));
  document.body.append(d);
  d.showModal();
  return d;
}
async function info() {
  const used = await localStore.usage();
  let estimate;
  try {
    estimate = await navigator.storage?.estimate?.();
  } catch {}
  $("storage-used").textContent =
    (used.bytes / 1048576).toFixed(1) +
    " MiB of original photographs (including saved history)" +
    (estimate
      ? " · Browser reports " +
        ((estimate.usage ?? 0) / 1048576).toFixed(1) +
        " / " +
        ((estimate.quota ?? 0) / 1048576).toFixed(0) +
        " MiB for this origin"
      : "");
}
let refreshQueue = Promise.resolve();
function refresh() {
  return (refreshQueue = refreshQueue.catch(() => {}).then(renderGallery));
}
async function renderGallery() {
  const apartments = await localStore.list();
  $("device-save-status").textContent="Saved on this device · "+apartments.length+" apartment(s). Keep encrypted backups.";
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  $("catalog").replaceChildren();
  for (const a of apartments) {
    const card = el("li");
    card.className = "gallery-card";
    card.dataset.apartment = a.id;
    const preview = el("div");
    preview.className = "gallery-photo";
    const d = await localStore.load(a.id).catch(() => null),
      photo =
        d?.images.get(d.tour.startRoom) ?? d?.images.values().next().value;
    if (photo) {
      const img = el("img");
      const url = URL.createObjectURL(photo);
      urls.push(url);
      img.src = url;
      img.alt = "Local panorama thumbnail";
      preview.append(img);
    } else preview.append(el("span", "No stitched photograph yet"));
    const title = el("h2", a.title),
      status = el(
        "p",
        a.readyRevision === a.revision ? "Ready to Show" : "Draft",
      );
    status.className = "local-status";
    const actions = el("div");
    actions.className = "actions";
    actions.append(link("Edit", a.id));
    if (a.photoCount)
      actions.append(
        link(
          a.readyRevision === a.revision ? "View tour" : "Preview draft",
          a.id,
          true,
        ),
      );
    actions.append(
      button("Export Backup", () =>
        exportBackup(() => localStore.load(a.id), a.title),
      ),
    );
    card.append(
      preview,
      title,
      status,
      el(
        "p",
        a.photoCount +
          " photographs · " +
          a.viewpointCount +
          " viewpoints · revision " +
          a.revision,
      ),
      actions,
    );
    const more = el("details");
    more.append(el("summary", "Manage apartment"));
    more.append(
      button("Rename", () =>
        dialog("Rename apartment", (box, close) => {
          const name = el("input");
          name.value = a.title;
          name.maxLength = 120;
          name.setAttribute("aria-label", "Apartment name");
          box.append(
            name,
            button("Save name", async () => {
              await localStore.rename(a.id, name.value, a.revision);
              close();
              await refresh();
            }),
          );
        }),
      ),
      button("Saved revisions", async () => {
        const revisions = await localStore.revisions(a.id);
        dialog("Recover a saved revision", (box, close) => {
          const select = el("select");
          select.setAttribute("aria-label", "Saved revision");
          for (const r of revisions)
            select.add(
              new Option(
                "Revision " +
                  r.revision +
                  " · " +
                  new Date(r.at).toLocaleString(),
                r.revision,
              ),
            );
          box.append(
            el(
              "p",
              "Restore creates a new draft revision. No earlier save or original JPEG is erased.",
            ),
            select,
            button("Restore revision", async () => {
              if (
                !confirm(
                  "Restore this revision into ONLY this local apartment? Export a current backup first.",
                )
              )
                return;
              await localStore.restore(a.id, Number(select.value), a.revision);
              close();
              await refresh();
            }),
          );
        });
      }),
      button("Delete", async () => {
        if (
          !confirm(
            "Permanently delete “" +
              a.title +
              "” and ALL its local saved revisions/photos? Keep an encrypted backup first. Other apartments are unchanged.",
          )
        )
          return;
        await localStore.remove(a.id, a.revision);
        say(
          "Selected local apartment deleted. Other apartments are unchanged.",
        );
        await refresh();
      }),
    );
    card.append(more);
    $("catalog").append(card);
  }
  if (!apartments.length)
    say("No local apartments yet. Choose NEW APARTMENT or Import Backup.");
  if(apartments.length&&$("message").textContent==="Opening local apartments…")say("Choose Edit to continue, or open a saved tour to present. Projects stay on this device.");
  await info();
}
$("new-apartment").onclick = () =>
  dialog("Create local apartment", (d, close) => {
    const name = el("input");
    name.maxLength = 120;
    name.placeholder = "Apartment name";
    name.setAttribute("aria-label", "Apartment name");
    d.append(
      name,
      button("Create apartment", async () => {
        if (busy) return;
        const value = name.value.trim();
        if (!value) throw Error("Enter an apartment name.");
        busy = true;
        try {
          const a = await localStore.create(value);
          close();
          location.href = "/editor/#apartment=" + a.id;
        } finally {
          busy = false;
        }
      }),
    );
  });
async function imported(draft) {
  let result = await localStore.importDraft(draft);
  if (result.duplicate) {
    if (
      !confirm(
        "This project file was already imported. Create another independent copy anyway? Cancel keeps the existing apartment and creates nothing.",
      )
    ) {
      say("Duplicate import skipped. Existing local apartment kept.");
      return;
    }
    result = await localStore.importDraft(draft, { duplicate: true });
  }
  await refresh();
  say(
    "Backup restored as a new local Draft. Review it before marking Ready to Show. No source file or other apartment was changed.",
  );
}
$("import-backup").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || busy) return;
  busy = true;
  try {
    say("Unlocking and validating locally…");
    const draft = await readBackup(file);
    if (
      !confirm(
        "Restore this backup as a NEW local apartment on this device? No existing apartment will be replaced.",
      )
    )
      return;
    await imported(draft);
  } catch (error) {
    recordFailure(error, "backup-import");
    say(error.message);
  } finally {
    busy = false;
  }
};
$("persist-storage").onclick = async () => {
  try {
    const granted = await navigator.storage?.persist?.();
    $("storage-persistence").textContent = granted
      ? "Persistent storage granted. Clearing data or device loss can still remove projects."
      : "Browser did not grant persistence. Keep encrypted backups.";
  } catch {
    $("storage-persistence").textContent =
      "Persistence request unavailable. Keep encrypted backups.";
  }
};
async function legacyDraft() {
  return new Promise((resolve) => {
    const q = indexedDB.open("supported-housing-tour-editor");
    q.onupgradeneeded = () => q.transaction.abort();
    q.onerror = () => resolve(null);
    q.onblocked = () => resolve(null);
    q.onsuccess = () => {
      const db = q.result;
      if (!db.objectStoreNames.contains("drafts")) {
        db.close();
        resolve(null);
        return;
      }
      const tx = db.transaction("drafts"),
        r = tx.objectStore("drafts").get("current");
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    };
  });
}
$("import-legacy").onclick = async () => {
  if (
    !legacy ||
    busy ||
    !confirm(
      "Copy the older draft into a NEW local apartment? Its original database record will remain untouched.",
    )
  )
    return;
  busy = true;
  try {
    await imported(legacy);
  } catch (error) {
    say(error.message);
  } finally {
    busy = false;
  }
};
try {
  await refresh();
  legacy = await legacyDraft();
  $("legacy-project").hidden = !legacy;
} catch (error) {
  say(storageError(error).message);
}
addEventListener("pageshow", () => refresh().catch((e) => say(e.message)));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh().catch((e) => say(e.message));
});
