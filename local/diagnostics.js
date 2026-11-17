import { localStore, newId } from "./store.js";
const stages = new Set([
  "open",
  "save",
  "validation",
  "storage",
  "database",
  "response",
  "room-create",
  "viewpoint-change",
  "doorway-place",
  "doorway-move",
  "doorway-delete",
  "layout-change",
  "backup-export",
  "backup-import",
  "duplicate",
  "upload-start",
  "upload-request",
  "upload-complete",
  "retry",
  "javascript",
  "timeout",
  "migration-preview",
  "migration-import",
]);
export function beginOperation(category = "system", apartment = null) {
  const operation = "VT-" + newId(),
    started = performance.now(),
    events = [];
  let retry = false;
  return {
    operation,
    headers: () => ({}),
    retry() {
      retry = true;
      this.mark("retry");
    },
    mark(stage, values = {}) {
      if (!stages.has(stage) || events.length >= 24) return;
      const event = { stage, at: Math.round(performance.now() - started) };
      for (const key of [
        "duration",
        "bytes",
        "width",
        "height",
        "count",
        "status",
      ])
        if (
          Number.isFinite(values[key]) &&
          values[key] >= 0 &&
          values[key] <= 2 ** 31
        )
          event[key] = values[key];
      events.push(event);
    },
    async send() {
      if (!events.length) return;
      const record = {
        operation,
        span: operation,
        parent: null,
        actor: "local",
        apartment: /^[a-f0-9]{32}$/.test(apartment ?? "") ? apartment : null,
        category: [
          "system",
          "apartment",
          "editor",
          "upload",
          "backup",
          "migration",
        ].includes(category)
          ? category
          : "system",
        severity: events.some((e) => (e.status ?? 200) >= 400)
          ? "warning"
          : "info",
        code: events.some((e) => (e.status ?? 200) >= 400)
          ? "LOCAL_OPERATION_FAILED"
          : "OK",
        created: Date.now(),
        duration: Math.round(performance.now() - started),
        version: "0.1.0",
        build: "local",
        deployment: "local-only",
        source: "local",
        saved: "unknown",
        retry: retry ? 1 : 0,
        events: events.splice(0),
      };
      try {
        await localStore.appendDiagnostic(record);
      } catch {
        /* Diagnostic failure never changes a committed project. */
      }
    },
  };
}
export async function recordFailure(error, stage = "save") {
  const d = beginOperation("system");
  d.mark(stage, { status: 500 });
  await d.send();
}
export async function diagnosticReport() {
  return {
    format: "virtual-tours-diagnostic",
    formatVersion: 1,
    configuration: {
      version: "0.1.0",
      edition: "local-only",
      networkAPIs: false,
      encryptedProjects: false,
      maxRecords: 200,
    },
    generated: new Date().toISOString(),
    operation: null,
    records: await localStore.diagnostics(),
  };
}
