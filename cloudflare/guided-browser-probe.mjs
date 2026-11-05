import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {unpackTour} from '../dist/tour-package.js';
const {chromium}=await import(pathToFileURL(process.env.PILOT_PLAYWRIGHT).href);
const origin=process.env.PILOT_PROBE_ORIGIN??'http://localhost:4193';
const password=process.env.PILOT_PROBE_STAFF??'Synthetic KV prototype staff only';
const args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
const browser=await chromium.launch({args}),edge=await chromium.launch({channel:'msedge',args});
let page,id,share,revision;
async function login(browser,mobile=false){const p=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1050},hasTouch:mobile,isMobile:mobile});p.on('dialog',d=>d.accept());await p.goto(origin+'/staff');if(process.env.PILOT_PROBE_USERNAME)await p.locator('#username-field input').fill(process.env.PILOT_PROBE_USERNAME);await p.locator('input[name=passphrase]').fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.getByRole('heading',{name:'Apartment Gallery',exact:true}).waitFor();return p;}
async function draft(p=page){const r=await p.request.get(origin+'/api/staff/drafts/'+id);assert.equal(r.status(),200);const d=await r.json();revision=d.revision;return d;}
async function save(p,action){const [r]=await Promise.all([p.waitForResponse(r=>r.url()===origin+'/api/staff/apartments'&&r.request().method()==='POST'),action()]);assert.equal(r.status(),201,await r.text());const result=await r.json();id=result.id;revision=result.version;await p.waitForFunction(()=>!document.querySelector('#guide-status').textContent.includes('Saving…'));}
async function upload(files){const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'ADD STITCH',exact:true}).click();await(await picker).setFiles(files);const review=page.getByRole('dialog',{name:'Review stitched panoramas'});await review.waitFor();assert.equal(await review.locator('img').count(),files.length);for(const select of await review.locator('select').all())await select.selectOption('add');await save(page,()=>review.getByRole('button',{name:'Upload and save draft'}).click());await review.waitFor({state:'hidden'});}
async function select(p,id){await p.locator('.stitch-card[data-room="'+id+'"] .stitch-select').click();}
async function place(p,id,x,y){await select(p,id);await save(p,()=>p.getByRole('button',{name:`Place selected in column ${x+1} row ${y+1}`,exact:true}).click());}
try{
 page=await login(browser);assert.equal(await page.getByRole('heading',{name:'All guest links'}).count(),0);
 await page.getByRole('link',{name:/NEW APARTMENT/}).click();await page.locator('#guide-title').waitFor();await page.waitForURL('**/*apartment=*');id=new URL(page.url()).searchParams.get('apartment');
 let d=await draft();assert.equal(d.tour.rooms.length,0);assert.equal(await page.locator('.stitch-card').count(),0);assert.equal(await page.locator('.guide-tile').count(),0);assert.equal(await page.getByText('Willow',{exact:true}).count(),0);
 await mkdir('test-results/guided',{recursive:true});await page.screenshot({path:'test-results/guided/blank.png'});
 const title='Synthetic guided acceptance '+Date.now();await page.locator('#guide-title').fill(title);await save(page,()=>page.locator('#guide-title').press('Tab'));
 const gallery=await browser.newPage({storageState:await page.context().storageState(),viewport:{width:1440,height:1050}});await gallery.goto(origin+'/staff');await gallery.locator('#catalog li').filter({hasText:title}).waitFor();await gallery.locator('#catalog img').first().evaluate(img=>img.decode());await gallery.screenshot({path:'test-results/guided/gallery.png'});await gallery.close();
 const sample=JSON.parse(await readFile(new URL('../dist/data/apartment.json',import.meta.url)));
 const photos=sample.rooms.map(r=>fileURLToPath(new URL('../dist/'+r.image,import.meta.url)));
 await upload(photos.slice(0,5));assert.equal(await page.locator('.stitch-card').count(),5);assert.equal(await page.locator('.guide-tile').count(),0);
 await page.screenshot({path:'test-results/guided/upload.png'});
 await page.getByRole('button',{name:'2. Arrange Rooms',exact:true}).click();
 d=await draft();const ids=d.tour.rooms.map(r=>r.id);
 const handle=page.locator('.stitch-card[data-room="'+ids[0]+'"] .stitch-drag');await handle.scrollIntoViewIfNeeded();const h=await handle.boundingBox(),board=await page.locator('#guide-grid').boundingBox();
 await save(page,async()=>{await page.mouse.move(h.x+20,h.y+20);await page.mouse.down();await page.mouse.move(board.x+board.width/8,board.y+board.height/8,{steps:12});await page.mouse.up();});
 for(let i=1;i<5;i++)await place(page,ids[i],i%3,Math.floor(i/3));
 const names=['Living Room','Kitchen','Bedroom','Hallway','Dining Room'];
 for(let i=0;i<5;i++){const field=page.getByRole('textbox',{name:'Name viewpoint '+ids[i],exact:true});await field.fill(names[i]);await save(page,()=>field.press('Tab'));}
 await save(page,()=>page.getByRole('button',{name:'Remove connection Living Room to Kitchen',exact:true}).click());await save(page,()=>page.getByRole('button',{name:'Restore connection Living Room to Kitchen',exact:true}).click());
 await page.getByRole('button',{name:'3. Place Doorways',exact:true}).click();
 for(const [from,to]of [[names[0],names[1]],[names[1],names[0]]]){await page.getByRole('button',{name:`${from} → ${to} · Needs position`,exact:true}).click();await page.locator('#place-on-pano').waitFor({state:'visible'});await save(page,()=>from===names[0]?page.locator('#place-on-pano').click({position:{x:120,y:150}}):page.locator('#place-on-pano').press('Enter'));}
 const tapped=(await draft()).tour.rooms[0].links.find(l=>l.target===ids[1]);assert.ok(tapped.yaw<0,'A tap left of centre must save its actual spherical direction: '+tapped.yaw);
 await page.getByRole('button',{name:'2. Arrange Rooms',exact:true}).click();const before=await draft();
 await page.locator('.stitch-card[data-room="'+ids[0]+'"]').click({button:'right'});const actions=page.getByRole('dialog',{name:'Stitch actions'});const chooser=page.waitForEvent('filechooser');await actions.getByRole('button',{name:'Replace Stitch',exact:true}).click();await(await chooser).setFiles(photos[5]);
 const replacement=page.getByRole('dialog',{name:'Replace Stitch',exact:true});await replacement.locator('img').evaluate(img=>img.decode());await save(page,()=>replacement.getByRole('button',{name:'Save replacement',exact:true}).click());
 const after=await draft();assert.deepEqual(after.tour,before.tour);assert.notEqual(after.photos[ids[0]],before.photos[ids[0]]);
 await page.locator('.stitch-card[data-room="'+ids[0]+'"] .stitch-menu').click();await save(page,()=>page.getByRole('dialog',{name:'Stitch actions'}).getByRole('button',{name:'Remove from Grid',exact:true}).click());
 const unplaced=await draft();assert.ok(unplaced.tour.builder.unplaced.includes(ids[0]));assert.equal(unplaced.photos[ids[0]],after.photos[ids[0]]);assert.deepEqual(unplaced.tour.rooms[0].links,after.tour.rooms[0].links);await place(page,ids[0],0,0);
 await upload([photos[0]]);d=await draft();const sixth=d.tour.rooms.at(-1).id;await place(page,sixth,3,2);
 await page.getByRole('button',{name:'ADD ROOM',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add Room',exact:true});await dialog.getByRole('textbox',{name:'New room name'}).fill('Study');await save(page,()=>dialog.getByRole('button',{name:'Add room',exact:true}).click());
 d=await draft();const seventh=d.tour.rooms.at(-1).id;assert.ok(d.tour.builder.missing.includes(seventh));assert.equal(Object.keys(d.photos).length,6);
 await page.locator('.stitch-card[data-room="'+seventh+'"] .stitch-menu').click();const pick=page.waitForEvent('filechooser');await page.getByRole('dialog',{name:'Stitch actions'}).getByRole('button',{name:'Replace Stitch',exact:true}).click();await(await pick).setFiles(photos[5]);await save(page,()=>page.getByRole('dialog',{name:'Replace Stitch',exact:true}).getByRole('button',{name:'Save replacement'}).click());await place(page,seventh,3,3);
 await select(page,ids[0]);await page.locator('#guide-target').selectOption(sixth);await save(page,()=>page.getByRole('button',{name:'Connect rooms',exact:true}).click());
 await page.getByRole('button',{name:'3. Place Doorways',exact:true}).click();
 await page.screenshot({path:'test-results/guided/doorways.png'});
 while(await page.getByRole('button',{name:/Needs position$/}).count()){await page.getByRole('button',{name:/Needs position$/}).first().click();await page.locator('#place-on-pano').waitFor({state:'visible'});await save(page,()=>page.locator('#place-on-pano').press('Enter'));}
 d=await draft();assert.ok(d.tour.rooms.every(r=>r.links.every(l=>!l.pending)));await page.reload();await page.locator('#guide-title').waitFor();assert.deepEqual((await draft()).tour,d.tour);
 const mobile=await login(edge,true);await mobile.goto(page.url());await mobile.locator('#guide-title').waitFor();assert.deepEqual((await draft(mobile)).tour,d.tour);
 await mobile.getByRole('button',{name:'2. Arrange Rooms',exact:true}).click();assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 const tile=mobile.locator('.guide-tile[data-room="'+seventh+'"] .tile-move');await tile.scrollIntoViewIfNeeded();const tb=await tile.boundingBox(),gb=await mobile.locator('#guide-grid').boundingBox(),session=await mobile.context().newCDPSession(mobile);
 await save(mobile,async()=>{await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tb.x+tb.width/2,y:tb.y+tb.height/2}]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:gb.x+gb.width*2.5/4,y:gb.y+gb.height*3.5/4}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});});
 await save(mobile,()=>mobile.locator('.guide-tile[data-room="'+seventh+'"] .tile-move').press('ArrowLeft'));
 assert.deepEqual((await draft(mobile)).tour.grid.positions[seventh],{x:1,y:3});
 await page.reload();await page.locator('#guide-title').waitFor();d=await draft();
 await mkdir('test-results/guided',{recursive:true});await mobile.screenshot({path:'test-results/guided/folded.png'});await mobile.setViewportSize({width:900,height:900});await mobile.screenshot({path:'test-results/guided/unfolded.png'});
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export Backup',exact:true}).click()]);const bytes=await readFile(await download.path());assert.deepEqual((await unpackTour(new Blob([bytes]))).tour,d.tour);
 await save(page,()=>page.locator('#guide-import').setInputFiles({name:'synthetic-guided.shtour',mimeType:'application/octet-stream',buffer:bytes}));assert.deepEqual((await draft()).tour,d.tour);
 await page.getByRole('button',{name:'4. Preview & Publish',exact:true}).click();await page.locator('#guide-viewer').waitFor();
 const published=page.waitForResponse(r=>r.url()===origin+'/api/staff/apartments/'+id&&r.request().method()==='PATCH');await page.getByRole('button',{name:'Publish apartment',exact:true}).click();assert.equal((await published).status(),200);
 await page.screenshot({path:'test-results/guided/preview.png'});await page.getByRole('button',{name:'2. Arrange Rooms',exact:true}).click();await page.screenshot({path:'test-results/guided/arrange.png'});
 const sr=await page.request.post(origin+'/api/staff/shares',{headers:{Origin:origin},data:{apartments:[id],expires:Date.now()+600000,wordCount:3}});assert.equal(sr.status(),201);share=await sr.json();
 const guest=await browser.newPage();await guest.goto(share.url);await guest.getByLabel('Guest access phrase').fill(share.code);await guest.getByRole('button',{name:'Open shared apartments'}).click();await guest.getByRole('link',{name:new RegExp(title)}).waitFor({timeout:90000});assert.equal(await guest.locator('#catalog a').count(),1);await guest.getByRole('link',{name:new RegExp(title)}).click();await guest.locator('#loading').waitFor({state:'hidden'});assert.equal(await guest.locator('#error').isVisible(),false);assert.equal((await guest.request.get(origin+'/api/staff/drafts/'+id)).status(),401);
 const publishedImage=await guest.request.get(origin+'/api/guest/tours/'+id+'/images/'+ids[0]);assert.equal(publishedImage.status(),200);const guestBytes=await publishedImage.body();
 await page.locator('.stitch-card[data-room="'+ids[0]+'"] .stitch-menu').click();const privatePicker=page.waitForEvent('filechooser');await page.getByRole('dialog',{name:'Stitch actions'}).getByRole('button',{name:'Replace Stitch',exact:true}).click();await(await privatePicker).setFiles(photos[0]);await save(page,()=>page.getByRole('dialog',{name:'Replace Stitch',exact:true}).getByRole('button',{name:'Save replacement',exact:true}).click());
 assert.deepEqual(await(await guest.request.get(origin+'/api/guest/tours/'+id+'/images/'+ids[0])).body(),guestBytes);
 console.log('PASS blank Gallery-to-publish flow, five uploads, filmstrip placement, inline names, connectors, context replacement identity/positions, another stitch, incomplete room attachment, reciprocal arrows, reload/Edge, backups, preview and restricted guest');
 if(process.env.PILOT_TEST_OFFLINE==='1'){const run=spawnSync(process.execPath,['cloudflare/offline-browser-probe.mjs'],{env:{...process.env,PILOT_OFFLINE_SOURCE:id},encoding:'utf8',timeout:180000});console.log(run.stdout);assert.equal(run.status,0,run.stderr);}
}catch(error){console.log('Browser phase failed:',error.message);if(page)console.log('Status:',await page.locator('#guide-status').textContent().catch(()=>''));throw error;}
finally{if(page&&share)await page.request.delete(origin+'/api/staff/shares/'+share.id,{headers:{Origin:origin}});if(page&&id){const d=await draft();await page.request.patch(origin+'/api/staff/apartments/'+id,{headers:{Origin:origin},data:{action:'remove',expectedVersion:d.revision}});}await browser.close();await edge.close();}
