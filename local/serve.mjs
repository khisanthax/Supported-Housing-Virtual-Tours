import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const packaged = new URL("./assets.json", import.meta.url);
let root;
try {
  await readFile(packaged);
  root = new URL("./", import.meta.url);
} catch {
  await import("./build.mjs");
  root = new URL("./generated/", import.meta.url);
}
const manifest = JSON.parse(await readFile(new URL("assets.json", root))),
  allowed = new Set([...manifest.files, "/assets.json"]);
const mime = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  webmanifest: "application/manifest+json",
  png: "image/png",
};
export const server = createServer(async (req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      return res.end();
    }
    let path = new URL(req.url, "http://localhost").pathname;
    if (path === "/") path = "/index.html";
    if (path === "/editor/" || path === "/editor") path = "/editor/index.html";
    if (!allowed.has(path)) {
      res.writeHead(404);
      return res.end();
    }
    const bytes = await readFile(new URL("." + path, root));
    res.writeHead(200, {
      "Content-Type": mime[path.split(".").pop()] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Service-Worker-Allowed": "/",
    });
    res.end(req.method === "HEAD" ? undefined : bytes);
  } catch {
    res.writeHead(500);
    res.end("Static application unavailable.");
  }
});
server.listen(Number(process.env.LOCAL_TOURS_PORT ?? 4185), "127.0.0.1", () =>
  console.log(
    "Local Only: http://localhost:" +
      server.address().port +
      " (loopback only; no data upload endpoints)",
  ),
);
