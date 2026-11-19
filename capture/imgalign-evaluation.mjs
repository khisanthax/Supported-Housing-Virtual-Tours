// Native upstream worker, served only on loopback. No image route or upload handler.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const [source, output] = process.argv.slice(2).map(p => path.resolve(p));
const repo = path.resolve(import.meta.dirname, '..');
if (output === repo || output.startsWith(repo + path.sep)) throw Error('Use private output outside the repository');
const assets = new Map();
for (const name of ['imgalign.worker.js','opencv_3_4_custom_O3.js']) {
  assets.set('/' + name, await readFile(path.join(source,'public','js',name)));
}
const server = createServer((req,res) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-eval'; worker-src 'self'; connect-src 'none'");
  if (req.method !== 'GET' || (req.url !== '/' && !assets.has(req.url))) {
    res.writeHead(404).end(); return;
  }
  res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'application/javascript');
  res.end(assets.get(req.url) ?? '<title>Private benchmark</title>');
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
  const page = await browser.newPage();
  const origin = 'http://127.0.0.1:' + server.address().port;
  await page.goto(origin);
  const frames = JSON.parse(await readFile(path.join(output,'frames.json'),'utf8'));
  const start = performance.now();
  const inputs = [];
  for (let i=0;i<frames.length;i++) {
    const bytes = await readFile(path.join(output,'frame-'+String(i+1).padStart(2,'0')+'.jpg'));
    inputs.push({bytes:bytes.toString('base64'), fov:frames[i].hfov});
  }
  const indexOnly=process.argv[4] === '--indices';
  const result = await page.evaluate(async ({inputs,indexOnly}) => {
    const worker = new Worker('/imgalign.worker.js');
    function call(msg,payload) {
      return new Promise((resolve,reject) => {
        const timeout = setTimeout(()=>reject(Error('Timeout in '+msg)),180000);
        worker.onerror = e => {clearTimeout(timeout);reject(Error(e.message));};
        worker.onmessage = ({data}) => {
          if(data.msg === msg && data.info === 'done') {clearTimeout(timeout);resolve(data.payload);}
        };
        worker.postMessage({msg,payload});
      });
    }
    try {
      await call('load',{workerFileName:'opencv_3_4_custom_O3.js'});
      const canvas = new OffscreenCanvas(480,640);
      const ctx = canvas.getContext('2d',{willReadFrequently:true});
      const images = [];
      for(const {bytes} of inputs) {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(bytes), c=>c.charCodeAt(0))]));
        ctx.drawImage(bitmap,0,0,480,640);bitmap.close();images.push(ctx.getImageData(0,0,480,640));
      }
      await call('multiStitchInit',{images});
      const p = await call(indexOnly?'multiStitchStart':'multiStitch',{fieldsOfView:inputs.map(x=>x.fov)});
      if(indexOnly) return {orderedIndices:p.additionalData};
      let jpeg;
      if(p.width && p.height) {
        const out=document.createElement('canvas');out.width=p.width;out.height=p.height;
        out.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p.buf,p.bufOffset,p.bufLen),p.width,p.height),0,0);
        jpeg=out.toDataURL('image/jpeg',.94).split(',')[1];
      }
      return {width:p.width,height:p.height,registered:p.additionalData,jpeg};
    } finally {worker.terminate();}
  },{inputs,indexOnly});
  const {jpeg,...metrics}=result;
  if(jpeg) await writeFile(path.join(output,'imgalign.jpg'),Buffer.from(jpeg,'base64'));
  metrics.seconds=(performance.now()-start)/1000;
  await writeFile(path.join(output,indexOnly?'imgalign-indices.json':'imgalign.json'),JSON.stringify(metrics,null,2));
  console.log(metrics);
} finally {await browser?.close();server.close();}
