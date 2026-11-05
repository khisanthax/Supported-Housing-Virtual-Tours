const CACHE = 'housing-offline-v4';
const SHELL = [
  '/offline/', '/offline/app.webmanifest', '/offline/icon-192.png', '/offline/icon-512.png',
  '/offline/styles.css', '/offline/offline.css', '/offline/app.js',
  '/offline/offline.js', '/offline/offline-store.js', '/offline/tour-data.js', '/offline/room-grid.js', '/offline/builder-data.js',
  '/offline/vendor/marzipano.js'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('housing-offline-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data !== 'verify-shell') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const files = await Promise.all(SHELL.map(path => cache.match(path)));
    event.ports[0]?.postMessage(files.every(response => response?.ok));
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(url.pathname) || fetch(event.request);
  })());
});
