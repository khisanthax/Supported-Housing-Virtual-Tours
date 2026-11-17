const ASSETS = __ASSETS__,
  CACHE = "virtual-tours-local-shell-__VERSION__";
const verify = async (cache) => {
  for (const path of Object.keys(ASSETS))
    if (!(await cache.match(path))) return false;
  return true;
};
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const [path, hash] of Object.entries(ASSETS)) {
        const response = await fetch(
          new Request(path, { cache: "reload", integrity: "sha256-" + hash }),
        );
        if (!response.ok) throw Error("Incomplete offline shell");
        await cache.put(path, response);
      }
      if (!(await verify(cache))) throw Error("Incomplete offline shell");
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("virtual-tours-local-shell-") && name !== CACHE)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data === "verify-shell")
    event.waitUntil(
      caches
        .open(CACHE)
        .then(verify)
        .then((ok) => event.ports[0]?.postMessage(ok)),
    );
});
self.addEventListener("fetch", (event) => {
  const u = new URL(event.request.url);
  if (u.protocol === "blob:" || u.protocol === "data:") return;
  event.respondWith(
    (async () => {
      if (u.origin !== self.location.origin || event.request.method !== "GET")
        return new Response("Local Only blocks network data requests.", {
          status: 403,
        });
      let path = u.pathname;
      if (path === "/") path = "/index.html";
      if (path === "/editor/" || path === "/editor")
        path = "/editor/index.html";
      if (!Object.hasOwn(ASSETS, path))
        return new Response("Not part of the offline application.", {
          status: 404,
        });
      return (
        (await (await caches.open(CACHE)).match(path)) ??
        new Response(
          "Application cache incomplete. Reconnect to this website.",
          { status: 503 },
        )
      );
    })(),
  );
});
