import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
export const output = new URL("./generated/", import.meta.url);
const root = new URL("../", import.meta.url),
  files = new Map();
const put = async (path, data) => {
  data = Buffer.from(data);
  files.set("/" + path, data);
  const to = new URL(path, output);
  await mkdir(new URL("./", to), { recursive: true });
  await writeFile(to, data);
};
const copy = async (from, to = from) =>
  put(to, await readFile(new URL(from, root)));
await mkdir(output, { recursive: true });
for (const name of [
  "app.js",
  "styles.css",
  "editor.css",
  "tour-data.js",
  "tour-package.js",
  "builder-data.js",
  "graph-tour.js",
  "room-grid.js",
  "room-grid-ui.js",
  "layout-state.js",
  "doorway-data.js",
  "backup-ui.js",
  "encrypted-backup.js",
  "backup-name.js",
  "editor-contract.js",
  "vendor/marzipano.js",
  "vendor/backup-crypto.js",
  "vendor/backup-fflate-LICENSE.txt",
  "vendor/backup-noble-LICENSE.txt",
  "vendor/MARZIPANO-LICENSE",
  "vendor/BACKUP-LIBRARIES.md",
])
  await copy("dist/" + name);
for (const name of [
  "guided-editor.js",
  "guided-editor.css",
  "doorway-drag.js",
  "arrow-objects.js",
  "upload-workspace.js",
  "batch-review.js",
  "panorama-zip.js",
])
  await copy("cloudflare/" + name, "dist/" + name);
for (const name of [
  "gallery.js",
  "gallery.css",
  "store.js",
  "privacy.js",
  "diagnostics.js",
  "diagnostics-page.js",
  "pwa.js",
])
  await copy("local/" + name);
await copy("local/editor-runtime.js", "dist/editor-runtime.js");
await copy("local/operation-trace.js", "dist/operation-trace.js");
const csp =
  "default-src 'self'; connect-src 'none'; img-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const meta =
  '<meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="' +
  csp +
  '">';
await put(
  "index.html",
  (await readFile(new URL("./gallery.html", import.meta.url), "utf8")).replace(
    "<head>",
    "<head>" + meta,
  ),
);
let html = await readFile(
  new URL("../dist/index.html", import.meta.url),
  "utf8",
);
html = html
  .replace(
    "<head>",
    "<head>" +
      meta +
      '<link rel="manifest" href="/app.webmanifest"><link rel="stylesheet" href="/dist/guided-editor.css"><link rel="stylesheet" href="/local/gallery.css"><script type="module" src="/local/privacy.js"></script><script type="module" src="/local/pwa.js"></script>',
  )
  .replace(
    "Explore a six-room sample apartment in an interactive 360 degree walkthrough.",
    "Create and present private apartment tours on this device.",
  )
  .replace(
    "Two-Bedroom Apartment � 360� walkthrough",
    "Virtual Tours � Local Only",
  )
  .replace(
    "<body>",
    '<body data-guided="true" data-edition="local"><aside class="local-banner"><a href="/">Apartment Gallery</a> · LOCAL ONLY · <span id="local-offline-status" role="status">Preparing offline application…</span> · <span id="local-network-status"></span><button id="local-install" hidden>Install app (optional)</button></aside>',
  )
  .replace(
    /(href|src)="(styles.css|editor.css|app.js|vendor\/marzipano.js)"/g,
    '$1="/dist/$2"',
  );
await put("editor/index.html", html);
for (const page of ["help", "diagnostics"])
  await put(
    page + ".html",
    (
      await readFile(new URL("./" + page + ".html", import.meta.url), "utf8")
    ).replace("<head>", "<head>" + meta),
  );
for (const size of [192, 512])
  await copy("sharing/icon-" + size + ".png", "icon-" + size + ".png");
await put(
  "app.webmanifest",
  JSON.stringify({
    id: "/",
    name: "Virtual Tours · Local Only",
    short_name: "Local Tours",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f3",
    theme_color: "#254e3e",
    icons: [192, 512].map((size) => ({
      src: "/icon-" + size + ".png",
      sizes: size + "x" + size,
      type: "image/png",
      purpose: "any",
    })),
  }),
);
await put('_headers',`/*
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: DENY
  Cross-Origin-Resource-Policy: same-origin
${['/','/index.html','/editor/','/editor/index.html','/help.html','/diagnostics.html'].map(path=>path+'\n  Content-Security-Policy: '+csp+"; frame-ancestors 'none'").join('\n')}
/sw.js
  Cache-Control: no-cache
  Service-Worker-Allowed: /
  Content-Security-Policy: default-src 'none'; connect-src 'self'; script-src 'self'
`);
await put('_redirects','/ /index.html 200\n/editor/ /editor/index.html 200\n/editor /editor/index.html 200\n');
files.delete('/_redirects');
files.delete('/_headers'); // Hosting control file: never cached or navigated as an app asset.
// Only code/static shell files enter this allowlist. No samples, projects or photographs.
const assets = Object.fromEntries(
  [...files]
    .sort()
    .map(([path, data]) => [
      path,
      createHash("sha256").update(data).digest("base64"),
    ]),
);
const template = await readFile(
  new URL("./sw-template.js", import.meta.url),
  "utf8",
);
const version = createHash("sha256")
  .update(JSON.stringify(assets) + template)
  .digest("hex")
  .slice(0, 24);
await put(
  "sw.js",
  template
    .replace("__ASSETS__", JSON.stringify(assets))
    .replace("__VERSION__", version),
);
await writeFile(
  new URL("assets.json", output),
  JSON.stringify({ version, files: [...files.keys()] }),
);
console.log(
  "Local Only built: " + files.size + " static assets; shell " + version,
);
