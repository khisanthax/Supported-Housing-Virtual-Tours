import test from'node:test';import assert from'node:assert/strict';import{readFile,mkdtemp}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{buildPublicDemo}from'../demo/build.mjs';
test('Public synthetic demo is an explicit, read-only snapshot with exact photos and no cloud permissions',async()=>{
 const tour=JSON.parse(await readFile(new URL('../cloudflare/sample.json',import.meta.url))),jpg=await readFile(new URL('../cloudflare/sample-images/living.jpg',import.meta.url)),images=new Map(tour.rooms.map(r=>[r.id,jpg])),directory=join(await mkdtemp(join(tmpdir(),'public-demo-')),'site');
 await assert.rejects(buildPublicDemo({tour,images,directory}),/Explicit approval/);
 const result=await buildPublicDemo({tour:{...tour,builder:{private:'must-not-export'},privateId:'never-export'},images,directory,syntheticApproved:true});assert.equal(result.viewpoints,3);assert.equal(result.tour.builder,undefined);assert.equal(result.tour.privateId,undefined);
 for(const room of tour.rooms)assert.deepEqual(await readFile(join(directory,'images',room.id+'.jpg')),jpg);
 const html=await readFile(join(directory,'index.html'),'utf8'),js=await readFile(join(directory,'app.js'),'utf8');assert.ok(html.includes('data-guest="true"'));assert.ok(!html.includes('id="edit-tour"'));assert.ok(!html.includes('id="editor-panel"'));assert.ok(!js.includes('const checkAccess'));assert.ok(!js.includes("fetch('/api/"));
 assert.match(await readFile(join(directory,'_redirects'),'utf8'),/^\/ \/index\.html 200\n/);
 await assert.rejects(buildPublicDemo({tour,images:new Map(),directory:directory+'2',syntheticApproved:true}),/complete, exact/);
 await assert.rejects(buildPublicDemo({tour,images,directory,syntheticApproved:true}),/fresh, empty/);
});
