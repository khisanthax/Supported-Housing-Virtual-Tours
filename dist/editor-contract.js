// Both editions supply a session-bound adapter; the editor never chooses a backend.
// loadDraft() -> {tour, images:Map<viewpoint,Blob>, revision} | null
// saveDraft(draft, expectedRevision, progress?, options?) -> committed revision
// completeDraft(expectedRevision) -> {revision}; adapters enforce their own rules.
export function defineEditorStorage(adapter) {
  for (const key of ["loadDraft", "saveDraft", "completeDraft"]) {
    if (typeof adapter[key] !== "function")
      throw Error("Missing editor storage operation: " + key);
  }
  return Object.freeze(adapter);
}
export function editorEdition(localOnly = false) {
  return Object.freeze({
    localOnly,
    gallery: localOnly ? "/" : "/staff",
    navigation: localOnly
      ? [
          ["⌂ Apartment Gallery", "/"],
          ["Help & backups", "/help.html"],
          ["Local diagnostics", "/diagnostics.html"],
        ]
      : [
          ["⌂ Apartment Gallery", "/staff"],
          ["↑ Uploads Gallery", "/staff/uploads"],
          ["↗ Guest Links", "/staff/guest-links"],
          ["↓ Available Offline", "/offline/"],
        ],
    capabilities: Object.freeze({
      publishing: !localOnly,
      sharing: !localOnly,
      accounts: !localOnly,
      adjacency: !localOnly,
      ready: localOnly,
    }),
    words: Object.freeze({
      opening: localOnly
        ? "Opening local apartment…"
        : "Opening private draft…",
      saved: localOnly
        ? "Saved on this device."
        : "Saved to private cloud draft.",
      kept: localOnly
        ? " Your previous local save was kept."
        : " Your previous cloud draft was kept.",
      finishStep: localOnly ? "Preview & Finish" : "Preview & Publish",
      finish: localOnly ? "Mark Ready to Show" : "Publish apartment",
      finishConfirm: localOnly
        ? "Mark this saved version Ready to Show on this device? Nothing will be published or uploaded."
        : "Publish this apartment for its authorized guest links?",
      finished: localOnly
        ? "Ready to Show on this device. Later edits return it to Draft."
        : "Published. New JPEGs may need about a minute before guests can open them.",
      preview: localOnly
        ? "Local preview. Review every room and doorway before marking Ready to Show."
        : "Visitor preview. Publish only after reviewing every room and connection.",
      deleteViewpoint: localOnly
        ? "Delete this viewpoint and its stitch from this local draft? Export a backup first. Other apartments are unchanged."
        : "Delete this viewpoint and its stitch from the private draft? Published guests stay unchanged.",
      deleteStitch: localOnly
        ? "Permanently delete this stitch and viewpoint from this local draft? Keep an encrypted backup first. Other apartments are unchanged."
        : "Permanently delete this stitch and its viewpoint from the private draft? Existing publications are unchanged.",
      replace: localOnly
        ? "Room identity, layout, connections and arrow angles are retained. Review arrows if camera orientation changed. This affects only this device."
        : "Room identity, grid position, connections and existing arrow angles will be retained. Review arrows if camera orientation changed. Guests keep the published photo until you explicitly publish.",
      importConfirm: localOnly
        ? "Replace ONLY this local apartment with the backup? Export its current version first. Other apartments remain unchanged."
        : "Replace this private draft with the backup? Published guests remain unchanged.",
      resetConfirm: localOnly
        ? "Reset only this local layout? Stitches become Unplaced. Grid-generated links clear; manual doors, JPEGs and names remain. Undo and the first reset checkpoint preserve navigation. Other apartments stay unchanged."
        : "Reset only this private apartment layout? All stitches become Unplaced. Grid-generated connections are cleared; manual doorways, JPEGs and names remain. Undo and the first saved reset checkpoint preserve navigation. Published guests stay unchanged.",
      ready: localOnly
        ? "Local apartment ready. Changes save automatically on this device."
        : "Private draft ready. Changes save automatically.",
    }),
  });
}
