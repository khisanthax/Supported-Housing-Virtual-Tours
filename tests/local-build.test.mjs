import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {staticSiteConfig,stageStaticSite} from '../local/hosting.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp } from "node:fs/promises";
import {runInNewContext} from 'node:vm';
test("Local package uses the current shared editor with explicit adapters and no cloud modules or photographs", async () => {
  for(const name of await readdir(new URL('../local/',import.meta.url)))if(/\.(js|mjs|html|css)$/.test(name))new TextDecoder('utf-8',{fatal:true}).decode(await readFile(new URL('../local/'+name,import.meta.url)));
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
test('Interrupted shell installation does not activate or delete a working old cache',async()=>{
 const worker=await readFile(new URL('../local/generated/sw.js',import.meta.url),'utf8'),handlers=new Map(),deleted=[];let skipped=false,completed;
 runInNewContext(worker,{URL,Request:class{constructor(path,options){this.path=path;this.options=options;}},Response,Object,Error,self:{addEventListener:(event,handler)=>handlers.set(event,handler),skipWaiting:()=>skipped=true,clients:{claim:()=>{}}},caches:{open:async()=>({put:async()=>{},match:async()=>null}),keys:async()=>['virtual-tours-local-shell-working'],delete:async name=>deleted.push(name)},fetch:async()=>{throw Error('Synthetic interrupted installation');}});
 handlers.get('install')({waitUntil:promise=>completed=promise});await assert.rejects(completed,/Synthetic interrupted installation/);assert.equal(skipped,false);assert.deepEqual(deleted,[]);
});
test('PWA first-install timeout reports not-ready without touching projects',async()=>{
 const code=await readFile(new URL('../local/pwa.js',import.meta.url),'utf8'),status={dataset:{}},AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('document','navigator','isSecureContext','addEventListener','setTimeout','clearTimeout','MessageChannel',code);
 await run({getElementById:id=>id==='local-offline-status'?status:null},{onLine:false,serviceWorker:{register:async()=>{},ready:new Promise(()=>{})}},true,()=>{},callback=>{queueMicrotask(callback);return 1;},()=>{},class{});
 assert.equal(status.dataset.ready,'false');assert.match(status.textContent,/caching did not finish/);
});

test('Browser-first deployment has no script, storage, routes, logging or paid service configuration',()=>{
 const c=staticSiteConfig({name:'isolated-local-assets',account:'a'.repeat(32),directory:tmpdir()});assert.deepEqual(Object.keys(c).sort(),['account_id','assets','compatibility_date','name','observability','preview_urls','workers_dev']);assert.equal(c.observability.enabled,false);assert.equal(c.assets.not_found_handling,'none');assert.equal(c.assets.html_handling,'none');assert.throws(()=>staticSiteConfig({name:'supported-housing-synthetic-pilot',account:'a'.repeat(32),directory:tmpdir()}));
});
test('Static hosting stage contains only built shell/control files and never sweeps unrelated files',async()=>{
 await import('../local/build.mjs');const stage=await mkdtemp(join(tmpdir(),'local-static-stage-'));await stageStaticSite(stage);assert.ok((await readdir(stage)).includes('_headers'));assert.equal(await readFile(join(stage,'_redirects'),'utf8'),'/ /index.html 200\n/editor/ /editor/index.html 200\n/editor /editor/index.html 200\n');await assert.rejects(stageStaticSite(stage),/fresh, empty/);const manifest=JSON.parse(await readFile(join(stage,'assets.json')));assert.ok(!manifest.files.some(f=>/\.(jpe?g|shtour|zip|db)$/i.test(f)));const headers=await readFile(join(stage,'_headers'),'utf8');assert.match(headers,/connect-src 'none'/);assert.match(headers,/\/sw.js[\s\S]*connect-src 'self'/);assert.match(await readFile(join(stage,'index.html'),'utf8'),/No installation or login required/);
});
