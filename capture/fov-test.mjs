// Controlled scene comparisons; never a substitute for a 37-frame real recapture.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const server=spawn(process.execPath,['capture/serve.mjs'],{env:{...process.env,CAPTURE_PORT:'4207'},stdio:['ignore','pipe','pipe']});await new Promise((r,j)=>{server.stdout.on('data',b=>b.toString().includes('loopback only')&&r());server.on('error',j);server.on('exit',j)});
let browser;const output=await mkdtemp(join(tmpdir(),'capture-fov-'));
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage(),requests=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));await page.goto('http://localhost:4207/');
 const results=await page.evaluate(async()=>{
 const {capturePlan}=await import('/capture/guidance.js'),{basis,rad,overlapStats}=await import('/capture/math.js'),{planningOptions}=await import('/capture/calibration.js'),{syntheticFrames}=await import('/capture/synthetic.js'),{indoorColor}=await import('/capture/indoor-fixture.js');
 const reference37=[];for(const[pitch,count]of[[0,13],[45,11],[-45,11],[90,1],[-90,1]])for(let i=0;i<count;i++)reference37.push({id:'reference-'+reference37.length,yaw:rad(360*i/count),pitch:rad(pitch)});
 const plans=[['legacy25',capturePlan(65,.75),65],['reference37',reference37,65],['uncertainDense',capturePlan(65,.75,planningOptions()),65],['measuredDense',capturePlan(60,.75,planningOptions()),60]],results=[];
 for(const[label,targets,assumedFOV]of plans){
 const stats={};for(const actual of[50,55,60,65])stats[actual]=overlapStats(targets.map(t=>({pose:basis(t.yaw,t.pitch),aspect:.75,hfov:actual})));
 const {frames}=await syntheticFrames({width:360,height:480,hfov:60,scene:indoorColor,targets});const metadata=frames.map(f=>({...f,hfov:assumedFOV}));
 const result=await new Promise((resolve,reject)=>{const w=new Worker('/capture/stitch-worker.js',{type:'module'}),timer=setTimeout(()=>{w.terminate();reject(Error('Stitch timed out'))},60000);w.onmessage=({data})=>{if(['result','error'].includes(data.type)){clearTimeout(timer);w.terminate();resolve(data)}};w.onerror=e=>{clearTimeout(timer);w.terminate();reject(Error(e.message))};w.postMessage({plannerVersion:2,frames:metadata,width:1024,quality:.92,engine:'baseline',diagnosticMissingCoverage:true,diagnosticQuality:true})});
 if(result.type!=='result')throw Error(result.message);
 const bitmap=await createImageBitmap(result.blob),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const px=ctx.getImageData(0,0,bitmap.width,bitmap.height).data;let mae=0,edges=0;const truth=new Float32Array(px.length);
 for(let y=0;y<bitmap.height;y++)for(let x=0;x<bitmap.width;x++){const yaw=(x+.5)/bitmap.width*2*Math.PI-Math.PI,pitch=Math.PI/2-(y+.5)/bitmap.height*Math.PI,c=indoorColor([Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)]),at=(y*bitmap.width+x)*4;for(let k=0;k<3;k++){truth[at+k]=c[k];mae+=Math.abs(px[at+k]-c[k])}if(x){let a=0,b=0;for(let k=0;k<3;k++){a+=Math.abs(px[at+k]-px[at-4+k]);b+=Math.abs(truth[at+k]-truth[at-4+k])}if(a>90&&b<30)edges++;}}
 bitmap.close();const bytes=new Uint8Array(await result.blob.arrayBuffer()),jpeg=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));results.push({label,photos:targets.length,actualFOV:60,assumedFOV,stats,report:result.report,MAE:mae/(1024*512*3),edgeProxy:edges,jpeg});
 }return results;});
 assert.equal(results[0].photos,25);assert.equal(results[1].photos,37);assert.ok(results[3].MAE<results[2].MAE,'Measured camera geometry must improve controlled fixture');assert.ok(results[2].stats[55].multiCoveredPercent>results[0].stats[55].multiCoveredPercent);
 for(const r of results){await writeFile(join(output,r.label+'.jpg'),Buffer.from(r.jpeg,'base64'));delete r.jpeg;console.log(JSON.stringify(r))}
 assert.ok(requests.every(r=>r.url.startsWith('http://localhost:4207/')&&['GET','HEAD'].includes(r.method)));await writeFile(join(output,'results.json'),JSON.stringify({results,requests,physicalDevice:false,note:'37-target reference is independent, not Stanford target coordinates; same procedural scene, different capture positions.'},null,2));console.log('PASS controlled FOV/overlap comparison and network isolation. Evidence: '+output);
}finally{await browser?.close();server.kill()}
