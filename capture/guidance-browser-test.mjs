// Synthetic orientation events + Chromium's fake camera; no operator camera/device.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const output=await mkdtemp(join(tmpdir(),'capture-guidance-')),origin='http://localhost:4198',requests=[],errors=[];
const service=spawn(process.execPath,['capture/serve.mjs'],{env:{...process.env,CAPTURE_PORT:'4198'},stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{service.stdout.on('data',b=>{if(b.toString().includes('loopback only'))resolve()});service.on('error',reject)});
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({permissions:['camera'],viewport:{width:412,height:915}});
 await context.addInitScript(()=>{DeviceOrientationEvent.requestPermission=async()=> 'granted'});
 context.on('request',r=>requests.push({url:r.url(),method:r.method()}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.goto(origin+'/editor/#new');await page.locator('#guide-capture').click();await page.locator('#capture-start').click();await page.waitForFunction(()=>document.querySelector('#capture-video').videoWidth>0);
 assert.equal(await page.locator('#capture-fov,input[type=number]').count(),0);
 const state=()=>page.evaluate(async()=>{const {listSessions}=await import('/capture/store.js');return (await listSessions(location.origin+location.pathname+location.hash))[0]});
 const expectCount=n=>page.waitForFunction(n=>document.querySelector('#capture-count')?.textContent.startsWith(n+' of'),n);
 const hold=(yaw,pitch,duration=1100,offset=0,jitter=false)=>page.evaluate(async({yaw,pitch,duration,offset,jitter})=>{for(let elapsed=0,i=0;elapsed<=duration;elapsed+=60,i++){dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:-yaw*180/Math.PI+offset+(i===0?.2:0)+(jitter?(i%2?2:-2):0),beta:90+pitch*180/Math.PI,gamma:0}));await new Promise(r=>setTimeout(r,60))}},{yaw,pitch,duration,offset,jitter});
 await hold(0,0,120);await hold(.2,0,300);assert.ok(parseFloat(await page.locator('#capture-aim').evaluate(n=>n.style.left))<50,'target moves opposite camera turn');
 await hold(0,0,600,0,true);assert.equal((await state()).frames.length,0,'moving inside target never captures');
 await hold(0,0,300);assert.equal((await state()).frames.length,0,'short hold never captures');
 await page.locator('#capture-stage').scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'live-guidance-phone.png')});
 await hold(0,0);await expectCount(1);await hold(0,0);assert.equal((await state()).frames.length,1,'no duplicate while holding previous direction');
 const before=(await state()).frames[0].captured;
 await page.locator('#capture-targets button[aria-label^="Retake photo 1:"]').click();await hold(0,0);await page.waitForFunction(async before=>{const{listSessions}=await import('/capture/store.js');return (await listSessions(location.origin+location.pathname+location.hash))[0].frames.some(f=>f.captured>before)},before);assert.equal((await state()).frames.length,1);
 console.log('PASS fixed crosshair, projected circle, stable auto capture, movement pause, progress, duplicate protection and explicit retake');
 await page.evaluate(()=>{Object.defineProperty(screen.orientation,'angle',{configurable:true,get:()=>90});screen.orientation.dispatchEvent(new Event('change'))});
 assert.equal(await page.evaluate(()=>document.querySelector('#capture-video').srcObject),null);
 await page.evaluate(()=>{Object.defineProperty(screen.orientation,'angle',{configurable:true,get:()=>0})});await page.locator('#capture-start').click();await page.waitForFunction(()=>document.querySelector('#capture-video').videoWidth>0);await hold(0,0,300);assert.ok((await page.locator('#capture-guide').textContent()).includes('Align with the starting photo'));
 await page.locator('#capture-realign').click();await hold(0,0,120,80);assert.ok((await page.locator('#capture-guide').textContent()).includes('Align with the starting photo'),'discontinuous sensor jump pauses');await hold(0,0,300,80);await page.locator('#capture-realign').click();
 console.log('PASS screen rotation safely pauses and resumed/drifting sensors require visual-reference realignment');
 const targets=(await state()).targets;let previous={yaw:0,pitch:0};
 for(let i=1;i<targets.length;i++){
  const next=targets[i];let delta=(next.yaw-previous.yaw+Math.PI*3)%(Math.PI*2)-Math.PI;
  const steps=Math.ceil(Math.max(Math.abs(delta),Math.abs(next.pitch-previous.pitch))/(Math.PI/36));
  await page.evaluate(async({previous,next,steps,delta})=>{for(let j=1;j<=steps;j++){const yaw=previous.yaw+delta*j/steps,pitch=previous.pitch+(next.pitch-previous.pitch)*j/steps;dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:-yaw*180/Math.PI+80,beta:90+pitch*180/Math.PI,gamma:0}));await new Promise(r=>setTimeout(r,35))}},{previous,next,steps,delta});
  await hold(next.yaw,next.pitch,1100,80);await expectCount(i+1);previous=next;
 }
 const complete=await state();assert.equal(new Set(complete.frames.map(f=>f.id)).size,targets.length);
 const coverage=await page.evaluate(async()=>{const{coverage}=await import('/capture/math.js'),{listSessions}=await import('/capture/store.js');return coverage((await listSessions(location.origin+location.pathname+location.hash))[0].frames,144,72,true)});assert.equal(coverage.missing,0);
 await hold(previous.yaw,previous.pitch,600,80);assert.equal((await state()).frames.length,targets.length);assert.equal(await page.evaluate(()=>document.querySelector('#capture-video').srcObject),null);
 await page.locator('#capture-settings').evaluate(d=>d.open=true);await page.locator('#capture-resolution').selectOption('1024');await page.locator('#capture-engine').selectOption('baseline');await page.locator('#capture-stitch').click();await page.waitForFunction(()=>{const text=document.querySelector('#capture-message')?.textContent??'';return text.startsWith('Preview:')||text.includes('No usable panorama')},{},{timeout:120000});assert.equal(await page.locator('#capture-use').isDisabled(),true,'Fake camera input must never be accepted as a validated tour');
 await page.screenshot({path:join(output,'complete-coverage-phone.png')});assert.equal(await page.locator('#capture-approved').isDisabled(),true);console.log('PASS complete '+targets.length+'-photo automatic horizontal/vertical sweep, ceiling and lower ring, no duplicate IDs, zero missing coverage and safe diagnostic/rejection outcome (fake camera is not a photographic scene)');
 await page.locator('#capture-close').click();await context.close();
 for(const mode of ['denied','missing']){
  const fallback=await browser.newContext({permissions:['camera']});await fallback.addInitScript(mode=>{if(mode==='missing')Object.defineProperty(window,'DeviceOrientationEvent',{value:undefined,configurable:true});else DeviceOrientationEvent.requestPermission=async()=> 'denied'},mode);
  const p=await fallback.newPage();await p.goto(origin+'/editor/#new');await p.locator('#guide-capture').click();await p.locator('#capture-start').click();await p.waitForFunction(()=>document.querySelector('#capture-video').videoWidth>0);assert.match(await p.locator('#capture-guide').textContent(),mode==='denied'?/denied/:/unavailable/);
  await p.locator('#capture-manual').check();await p.locator('#capture-photo').focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelector('#capture-count')?.textContent.startsWith('1 of'));assert.ok((await p.locator('#capture-guide').textContent()).includes('Manual guide'));await fallback.close();
 }
 console.log('PASS denied/missing motion permission uses accessible visual manual fallback without numeric angles');
 assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>!r.url.startsWith(origin)&&!r.url.startsWith('blob:')&&!r.url.startsWith('data:')).length,0);assert.equal(requests.filter(r=>!['GET','HEAD'].includes(r.method)).length,0);
 await writeFile(join(output,'results.json'),JSON.stringify({result:'PASS',targets:targets.length,coverage,requests,errors,physicalDeviceTested:false},null,2));console.log('PASS no external or upload requests; evidence: '+output);
}finally{await browser?.close();service.kill()}
