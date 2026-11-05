import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PILOT_PLAYWRIGHT).href);
const origin=process.env.PILOT_PROBE_ORIGIN??'http://localhost:4193';
const password=process.env.PILOT_PROBE_STAFF??(origin==='http://localhost:4193'?'Synthetic KV prototype staff only':null);
assert.ok(password);
const browser=await chromium.launch({channel:'msedge',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let page,id,accept=true;
async function draft(){const r=await page.request.get(origin+'/api/staff/drafts/'+id);assert.equal(r.status(),200);return r.json();}
async function save(action){const [r]=await Promise.all([page.waitForResponse(r=>r.url()===origin+'/api/staff/apartments'&&r.request().method()==='POST'),action()]);assert.equal(r.status(),201);await page.waitForFunction(()=>!document.querySelector('#guide-status').textContent.includes('Saving…'));}
try{
 page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});page.on('dialog',d=>accept?d.accept():d.dismiss());
 await page.goto(origin+'/staff');if(process.env.PILOT_PROBE_USERNAME)await page.locator('#username-field input').fill(process.env.PILOT_PROBE_USERNAME);
 await page.locator('input[name=passphrase]').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('link',{name:/NEW APARTMENT/}).click();await page.waitForURL('**/*apartment=*');id=new URL(page.url()).searchParams.get('apartment');
 await page.locator('#guide-title').fill('Synthetic guided actions '+Date.now());await save(()=>page.locator('#guide-title').press('Tab'));
 await page.getByRole('button',{name:'ADD ROOM',exact:true}).tap();let dialog=page.getByRole('dialog',{name:'Add Room',exact:true});await dialog.getByLabel('New room name').fill('Living Room');
 await dialog.getByLabel('Upload room stitch').setInputFiles(fileURLToPath(new URL('../cloudflare/sample-images/living.jpg',import.meta.url)));await save(()=>dialog.getByRole('button',{name:'Add room',exact:true}).tap());
 let d=await draft();const room=d.tour.rooms[0].id,photo=d.photos[room];assert.equal(d.tour.builder.missing.length,0);assert.equal(d.tour.rooms[0].roomName,'Living Room');
 await page.getByRole('button',{name:'2. Arrange Rooms',exact:true}).tap();await save(()=>page.getByRole('button',{name:'Place selected in column 1 row 1',exact:true}).tap());
 await page.locator('.tile-move').focus();await page.keyboard.press('ArrowLeft');await page.locator('#guide-status').getByText(/Choose a cell inside/).waitFor();assert.ok(await page.evaluate(()=>document.activeElement.classList.contains('tile-move')));
 await save(()=>page.keyboard.press('ArrowRight'));assert.ok(await page.evaluate(()=>document.activeElement.classList.contains('tile-move')));
 await save(()=>page.keyboard.press('ArrowDown'));assert.deepEqual((await draft()).tour.grid.positions[room],{x:1,y:1});await page.getByRole('button',{name:'Photos ▾',exact:true}).tap();
 await page.getByRole('button',{name:'ADD ROOM',exact:true}).tap();dialog=page.getByRole('dialog',{name:'Add Room',exact:true});await dialog.getByLabel('New room name').fill('Lounge');await dialog.getByLabel('Attach stitch').selectOption(room);await save(()=>dialog.getByRole('button',{name:'Add room',exact:true}).tap());
 d=await draft();assert.equal(d.tour.rooms.length,1);assert.equal(d.tour.rooms[0].roomName,'Lounge');assert.equal(d.photos[room],photo);
 await page.locator('.stitch-menu').tap();await page.getByRole('dialog',{name:'Stitch actions'}).getByRole('button',{name:'Rename Viewpoint',exact:true}).tap();dialog=page.getByRole('dialog',{name:'Rename Viewpoint',exact:true});await dialog.getByLabel('Viewpoint name').fill('Lounge · entry');await save(()=>dialog.getByRole('button',{name:'Save name',exact:true}).tap());
 await page.locator('.stitch-menu').tap();accept=false;await page.getByRole('dialog',{name:'Stitch actions'}).getByRole('button',{name:'Delete Stitch',exact:true}).tap();assert.equal((await draft()).tour.rooms.length,1);accept=true;
 await save(()=>page.getByRole('dialog',{name:'Stitch actions'}).getByRole('button',{name:'Delete Stitch',exact:true}).tap());assert.equal((await draft()).tour.rooms.length,0);await page.reload();await page.locator('#guide-title').waitFor();assert.equal((await draft()).tour.rooms.length,0);
 await page.goto(origin+'/staff');await page.getByRole('button',{name:'Sign Out',exact:true}).tap();await page.getByRole('heading',{name:'Staff sign-in',exact:true}).waitFor();assert.equal((await page.request.get(origin+'/api/staff/drafts/'+id)).status(),401);
 console.log('PASS folded-touch Add Room with new JPEG and existing stitch, group assignment, rename, cancel/confirm deletion to empty draft, reload and immediate Gallery logout');
}finally{
 if(page&&id){await page.goto(origin+'/staff');if(await page.locator('input[name=passphrase]').count()){if(process.env.PILOT_PROBE_USERNAME)await page.locator('#username-field input').fill(process.env.PILOT_PROBE_USERNAME);await page.locator('input[name=passphrase]').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Apartment Gallery',exact:true}).waitFor();}const d=await draft();assert.equal((await page.request.patch(origin+'/api/staff/apartments/'+id,{headers:{Origin:origin},data:{action:'remove',expectedVersion:d.revision}})).status(),200);await page.request.post(origin+'/api/staff/sign-out',{headers:{Origin:origin}});}
 await browser.close();
}
