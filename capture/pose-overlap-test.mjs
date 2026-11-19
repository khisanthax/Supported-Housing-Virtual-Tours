import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port='4213';
const origin='http://localhost:'+port;
const server=spawn(process.execPath,['capture/serve.mjs'],{env:{...process.env,CAPTURE_PORT:port}});
let browser;
try{
  await new Promise((resolve,reject)=>{
    server.stdout.on('data',b=>b.toString().includes('loopback only')&&resolve());
    server.once('error',reject);server.once('exit',()=>reject(Error('Server exited')));
  });
  browser=await chromium.launch();
  const page=await browser.newPage({serviceWorkers:'block'});
  await page.goto(origin);
    const base=origin+'/capture/';
    const workerSource=`
      import {recoverPoseOverlaps} from '${base}pose-overlap.js';
      import {syntheticFrames} from '${base}synthetic.js';
      import {indoorColor} from '${base}indoor-fixture.js';
      import '${base}vendor/opencv.js';
      self.onmessage=async()=>{
        try{
          if(!self.cv?.Mat)await new Promise(r=>self.cv.onRuntimeInitialized=r);
          const targets=[0,.18,-.18].map((yaw,i)=>({id:'v'+i,yaw,pitch:0}));
          const run=async(scene)=>{
            const {frames}=await syntheticFrames({width:360,height:480,hfov:65,targets,scene});
            const edges=[{i:1,j:2,matches:[]}];
            return await recoverPoseOverlaps(self.cv,frames,edges,()=>{});
          };
          postMessage({textured:await run(indoorColor),blank:await run(()=>[80,80,80])});
        }catch(e){postMessage({error:e.message})}
      };
    `;
  await page.route('**/capture/pose-probe.js',route=>route.fulfill({contentType:'text/javascript',body:workerSource}));
  const result=await page.evaluate(async()=>{
    const worker=new Worker('/capture/pose-probe.js',{type:'module'});
    let timeout;
    try{return await new Promise((resolve,reject)=>{
      timeout=setTimeout(()=>reject(Error('Overlap probe timed out')),45000);
      worker.onerror=e=>reject(Error(e.message));worker.onmessage=e=>resolve(e.data);worker.postMessage({});
    })}finally{clearTimeout(timeout);worker.terminate()}
  });
  assert.ok(!result.error,result.error);
  assert.ok(result.textured.length>0,'A real image correspondence must recover the missing viewpoint');
  assert.deepEqual(result.blank,[],'Sensor overlap alone cannot verify textureless input');
  console.log('PASS pose-guided recovery on known overlapping views and rejection on uniform input.');
}finally{await browser?.close();server.kill()}
