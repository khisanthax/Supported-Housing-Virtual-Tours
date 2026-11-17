import { diagnosticReport } from "./diagnostics.js";
import { zipSync } from "../dist/vendor/backup-crypto.js";
document.getElementById("export-diagnostics").onclick = async () => {
  try {
    const data = new TextEncoder().encode(
        JSON.stringify(await diagnosticReport(), null, 2),
      ),
      blob = new Blob([zipSync({ "diagnostic.json": data })], {
        type: "application/zip",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download =
      "local-tours-diagnostic-" +
      new Date().toISOString().slice(0, 10) +
      ".zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    document.getElementById("diagnostic-message").textContent =
      "Sanitized diagnostic export created locally.";
  } catch {
    document.getElementById("diagnostic-message").textContent =
      "Local diagnostics unavailable. No project was changed.";
  }
};
