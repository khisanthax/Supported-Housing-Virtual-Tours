import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {staticSiteConfig,stageStaticSite} from '../local/hosting.mjs';
test('Browser-first deployment has no script, storage, routes, logging or paid service configuration',()=>{
 const c=staticSiteConfig({name:'isolated-local-assets',account:'a'.repeat(32),directory:tmpdir()});assert.deepEqual(Object.keys(c).sort(),['account_id','assets','compatibility_date','name','observability','preview_urls','workers_dev']);assert.equal(c.observability.enabled,false);assert.equal(c.assets.not_found_handling,'none');assert.equal(c.assets.html_handling,'none');assert.throws(()=>staticSiteConfig({name:'supported-housing-synthetic-pilot',account:'a'.repeat(32),directory:tmpdir()}));
});
test('Static hosting stage contains only built shell/control files and never sweeps unrelated files',async()=>{
 await import('../local/build.mjs');const stage=await mkdtemp(join(tmpdir(),'local-static-stage-'));await stageStaticSite(stage);assert.ok((await readdir(stage)).includes('_headers'));assert.equal(await readFile(join(stage,'_redirects'),'utf8'),'/ /index.html 200\n/editor/ /editor/index.html 200\n/editor /editor/index.html 200\n');await assert.rejects(stageStaticSite(stage),/fresh, empty/);const manifest=JSON.parse(await readFile(join(stage,'assets.json')));assert.ok(!manifest.files.some(f=>/\.(jpe?g|shtour|zip|db)$/i.test(f)));const headers=await readFile(join(stage,'_headers'),'utf8');assert.match(headers,/connect-src 'none'/);assert.match(headers,/\/sw.js[\s\S]*connect-src 'self'/);assert.match(await readFile(join(stage,'index.html'),'utf8'),/No installation or login required/);
});
