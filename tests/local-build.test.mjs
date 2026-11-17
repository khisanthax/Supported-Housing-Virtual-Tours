import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {runInNewContext} from 'node:vm';
test("Local package uses the current shared editor with explicit adapters and no cloud modules or photographs", async () => {
  await import("../local/build.mjs");
  const root = new URL("../local/generated/", import.meta.url),
    manifest = JSON.parse(await readFile(new URL("assets.json", root)));
  assert.ok(manifest.files.includes("/dist/guided-editor.js"));
  assert.ok(
    !manifest.files.some((p) =>
      /\.jpe?g$|cloud-tour-store|access-ui|offline-store|tour-editor\.js/.test(
        p,
      ),
    ),
  );
  assert.equal(
    await readFile(new URL("dist/guided-editor.js", root), "utf8"),
    await readFile(
      new URL("../cloudflare/guided-editor.js", import.meta.url),
      "utf8",
    ),
  );
  const runtime = await readFile(
    new URL("dist/editor-runtime.js", root),
    "utf8",
  );
  assert.ok(runtime.includes("localStore"));
  assert.ok(!runtime.includes("fetch("));
  for (const path of ["/index.html", "/editor/index.html"]) {
    const html = await readFile(new URL("." + path, root), "utf8");
    assert.match(html, /connect-src 'none'/);
    assert.ok(!/https?:\/\//.test(html));
  }
  const worker = await readFile(new URL("sw.js", root), "utf8");
  assert.ok(worker.includes("integrity:"));
  assert.match(worker, /event\.request\.method\s*!==\s*["']GET/);
});
test('Local service worker never proxies unknown, external or mutating requests',async()=>{
 await import('../local/build.mjs');const handlers=new Map(),responses=new Map(),worker=await readFile(new URL('../local/generated/sw.js',import.meta.url),'utf8');
 const cache={async match(path){return responses.get(path);},async put(path,response){responses.set(path,response);}};
 const context={URL,Request,Response,Object,Error,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},self:{location:{origin:'https://local-static.example'},addEventListener:(event,handler)=>handlers.set(event,handler),skipWaiting:async()=>{},clients:{claim:async()=>{}}},fetch:()=>{throw Error('Unexpected network access');}};
 runInNewContext(worker,context);const request=async(url,method='GET')=>{let result;handlers.get('fetch')({request:new Request(url,{method}),respondWith:value=>result=value});return result;};
 assert.equal((await request('https://remote.example/photo')).status,403);assert.equal((await request('https://local-static.example/api/staff/photos','POST')).status,403);assert.equal((await request('https://local-static.example/unknown')).status,404);assert.equal((await request('https://local-static.example/')).status,503);responses.set('/index.html',new Response('static shell'));assert.equal(await(await request('https://local-static.example/')).text(),'static shell');
});
