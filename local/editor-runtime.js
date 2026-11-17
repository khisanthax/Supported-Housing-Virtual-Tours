import { defineEditorStorage, editorEdition } from "../dist/editor-contract.js";
import { localStore } from "../local/store.js";
import { recordFailure } from "../local/diagnostics.js";
const params = new URLSearchParams(location.hash.slice(1));
let apartment = params.get("apartment");
const readOnly = params.has("view");
if(readOnly)document.body.classList.add("local-view-only");
const access = { local: true };
const can = (_, key) =>
  [
    "apartment.view",
    "backup.export",
    ...(!readOnly
      ? ["apartment.edit", "image.upload", "backup.import", "apartment.create"]
      : []),
  ].includes(key);
const getAccess = async () => access;
function applyAccess() {
  if (!readOnly) return;
  document.body.classList.add("local-view-only");
  for (const n of document.querySelectorAll(
    ".guide-actions,#guide-steps,#guide-prev,#guide-next,#guide-start,#tour-review,#guide-publish",
  ))
    n.hidden = true;
  const title = document.getElementById("guide-title");
  title.disabled = true;
  title.readOnly = true;
}
const identity = () => {
  const p = new URLSearchParams(location.hash.slice(1));
  p.set("apartment", apartment);
  history.replaceState(null, "", "#" + p);
};
const storage = defineEditorStorage({
  async loadDraft() {
    if (!apartment) {
      if (params.has("new") && !readOnly) {
        const created = await localStore.create();
        apartment = created.id;
        identity();
        return localStore.load(apartment);
      }
      throw Error("Open an apartment from the Local Gallery.");
    }
    return localStore.load(apartment);
  },
  async saveDraft(draft, revision, progress = () => {}) {
    if (readOnly) throw Error("This local tour is read-only.");
    progress("Saving photographs and tour on this device…");
    try {
      if (!apartment) {
        const result = await localStore.importDraft(draft, { duplicate: true });
        apartment = result.id;
        identity();
        return result.revision;
      }
      const result = await localStore.save(apartment, draft, revision);
      identity();
      return result.revision;
    } catch (error) {
      recordFailure(error);
      throw error;
    }
  },
  async completeDraft(revision) {
    if (readOnly) throw Error("This local tour is read-only.");
    return localStore.markReady(apartment, revision);
  },
});
const base = editorEdition(true),
  edition = readOnly
    ? {
        ...base,
        words: {
          ...base.words,
          preview: "Drag to look around. Select a room or follow a doorway.",
          ready:
            "Local tour · Read only. Use Edit in the Gallery to make changes.",
        },
      }
    : base;
export default { edition, storage, getAccess, can, applyAccess };
