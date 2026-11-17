// Defense in depth; the static server also applies connect-src 'none'.
// ES-module and service-worker shell loading use browser loaders, not window.fetch.
const blocked = () => {
  throw Error(
    "Local Only does not send network requests. Use encrypted files for manual migration.",
  );
};
globalThis.fetch = blocked;
if (globalThis.XMLHttpRequest)
  globalThis.XMLHttpRequest.prototype.send = blocked;
try {
  Object.defineProperty(navigator, "sendBeacon", {
    value: blocked,
    configurable: false,
  });
} catch {}
for (const name of ["WebSocket", "EventSource"])
  try {
    Object.defineProperty(globalThis, name, {
      value: class {
        constructor() {
          blocked();
        }
      },
      configurable: false,
    });
  } catch {}
let failures = 0;
addEventListener("error", () => {
  if (failures++ < 3)
    import("./diagnostics.js")
      .then(({ beginOperation }) => {
        const d = beginOperation();
        d.mark("javascript", { status: 500 });
        d.send();
      })
      .catch(() => {});
});
