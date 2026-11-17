import { getAccess, can, applyAccess } from "/sharing/access-ui.js";
import { loadDraft, saveDraft, completeDraft } from "./tour-store.js";
import { defineEditorStorage, editorEdition } from "./editor-contract.js";
export default {
  edition: editorEdition(false),
  storage: defineEditorStorage({ loadDraft, saveDraft, completeDraft }),
  getAccess,
  can,
  applyAccess,
};
