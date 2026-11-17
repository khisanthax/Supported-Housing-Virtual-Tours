import "./build.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { zipSync } from "../dist/vendor/backup-crypto.js";
const target = process.argv[2];
if (!target)
  throw Error(
    "Specify a private output directory: npm run package:local -- C:/private/local-tours",
  );
const root = new URL("./generated/", import.meta.url),
  manifest = JSON.parse(await readFile(new URL("assets.json", root))),
  files = {};
for (const path of [...manifest.files, "/assets.json"])
  files["Virtual-Tours-Local" + path] = new Uint8Array(
    await readFile(new URL("." + path, root)),
  );
files["Virtual-Tours-Local/serve.mjs"] = new Uint8Array(
  await readFile(new URL("./serve.mjs", import.meta.url)),
);
files["Virtual-Tours-Local/start-local.cmd"] = new TextEncoder().encode(
  '@echo off\r\ncd /d "%~dp0"\r\nnode serve.mjs\r\npause\r\n',
);
files["Virtual-Tours-Local/start-local.sh"] = new TextEncoder().encode(
  '#!/bin/sh\ncd "$(dirname "$0")"\nnode serve.mjs\n',
);
files["Virtual-Tours-Local/LOCAL-ONLY.md"] = new Uint8Array(
  await readFile(new URL("../LOCAL-ONLY.md", import.meta.url)),
);
files["Virtual-Tours-Local/BACKUPS.md"] = new Uint8Array(
  await readFile(new URL("../BACKUPS.md", import.meta.url)),
);
await mkdir(resolve(target), { recursive: true });
const path = join(resolve(target), "Virtual-Tours-Local-Only-private.zip");
await writeFile(path, zipSync(files));
console.log(
  "Private installation package: " +
    path +
    "; shell " +
    manifest.version +
    "; no projects, samples or credentials included.",
);
