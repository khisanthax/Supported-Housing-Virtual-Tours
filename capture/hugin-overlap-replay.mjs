// Recover missing Hugin image links with the existing local browser matcher.
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
const dir=path.resolve(process.argv[2]);
const repo=path.resolve(import.meta.dirname,'..');
if(dir===repo||dir.startsWith(repo+path.sep)) throw Error('Use private output outside the checkout');
process.env.CAPTURE_PORT='0';
const {server}=await import('./serve.mjs');
if(!server.listening) await once(server,'listening');
let browser;
try{
  const origin='http://127.0.0.1:'+server.address().port;
  const frames=JSON.parse(await readFile(path.join(dir,'frames.json'),'utf8'));
  const pto=await readFile(path.join(dir,'matched.pto'),'utf8');
  const pairs=new Map();
  for(const [,i,j] of pto.matchAll(/^c n(\d+) N(\d+) /gm)) pairs.set(i+'-'+j,{i:+i,j:+j});
  for(let i=0;i<frames.length;i++)frames[i].bytes=(await readFile(path.join(dir,'frame-'+String(i+1).padStart(2,'0')+'.jpg'))).toString('base64');
  browser=await chromium.launch({args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
  const page=await browser.newPage({serviceWorkers:'block'});
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await page.goto(origin);
  await page.route('**/capture/hugin-probe.js',route=>route.fulfill({contentType:'text/javascript',body:`
    self.onmessage=async({data:{frames,edges}})=>{try{
    const {recoverPoseOverlaps}=await import('/capture/pose-overlap.js');
    await import('/capture/vendor/opencv.js');
    if(!self.cv?.Mat)await new Promise(r=>self.cv.onRuntimeInitialized=r);
    for(const f of frames)f.blob=new Blob([Uint8Array.from(atob(f.bytes),ch=>ch.charCodeAt(0))],{type:'image/jpeg'});
    const start=edges.length;
    await recoverPoseOverlaps(self.cv,frames,edges,()=>{});
    postMessage({controls:edges.slice(start)});
    } catch(error){postMessage({error:String(error)})}}
  `}));
  const controls=await page.evaluate(data=>new Promise((resolve,reject)=>{
    const worker=new Worker('/capture/hugin-probe.js',{type:'module'});
    const timer=setTimeout(()=>{worker.terminate();reject(Error('Replay timeout'))},120000);
    worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message))};
    worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();data.error?reject(Error(data.error)):resolve(data.controls)};
    worker.postMessage(data);
  }),{frames,edges:[...pairs.values()]});
  const lines=[];
  for(const {i,j,matches} of controls){
    // Matcher normalizes 480x640 pixel centres. Restore original pixel centres after 2x downsampling.
    for(const {a,b} of matches){
      const point=([x,y])=>[(1+x)*479+.5,(1-y)*639+.5];
      const [x,y]=point(a),[X,Y]=point(b);
      lines.push(`c n${i} N${j} x${x} y${y} X${X} Y${Y} t0`);
    }
  }
  await writeFile(path.join(dir,'augmented.pto'),pto+'\n'+lines.join('\n')+'\n');
  console.log(controls.map(({i,j,matches})=>[i+1,j+1,matches.length]));
}finally{await browser?.close();server.close();}
