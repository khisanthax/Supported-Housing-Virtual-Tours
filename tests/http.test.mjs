import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
let child, base;
before(async () => {
  child=spawn(process.execPath,['scripts/serve.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Server did not start')),10000);
    child.once('error',reject);
    child.stdout.on('data',chunk=>{ const found=String(chunk).match(/http:\/\/localhost:\d+/);if(found){clearTimeout(timeout);resolve(found[0]);} });
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Server exited: ${code}`));});
  });
});
after(()=>child?.kill());
test('static entrypoint and viewer assets are served with browser-compatible MIME types',async()=>{
  for(const [path,type] of [['/','text/html'],['/app.js','text/javascript'],['/tour-data.js','text/javascript'],['/styles.css','text/css'],['/data/apartment.json','application/json'],['/images/living.jpg','image/jpeg'],['/vendor/marzipano.js','text/javascript']]){
    const response=await fetch(base+path);assert.equal(response.status,200,path);assert.equal(response.headers.get('content-type'),type,path);assert.ok((await response.arrayBuffer()).byteLength>10);
  }
});
test('missing assets fail clearly and source files outside dist are not exposed',async()=>{
  assert.equal((await fetch(base+'/images/missing.jpg')).status,404);
  assert.equal((await fetch(base+'/package.json')).status,404);
  assert.equal((await fetch(base+'/%2e%2e%2fpackage.json')).status,403);
});
