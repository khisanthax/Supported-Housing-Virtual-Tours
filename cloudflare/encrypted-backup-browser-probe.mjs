import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { packTour } from '../dist/tour-package.js';
import { zipSync, unzipSync } from '../dist/vendor/backup-crypto.js';
import { backupTestPassword, fillBackupDialog, readTestBackup } from './backup-probe-tools.mjs';
const origin=process.env.PILOT_PROBE_ORIGIN, {chromium}=await import(pathToFileURL(process.env.PILOT_PLAYWRIGHT).href);
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true}), created=[];
const errors=[];let writes=0,downloads=0;
page.on('pageerror',e=>errors.push(e.message));page.on('download',()=>downloads++);
page.on('request',r=>{if(r.url().startsWith(origin)&&!r.url().includes('/sign-in'))assert.ok(![r.url(),r.postData()??''].some(s=>s.includes(backupTestPassword)),'Backup password must not leave browser');if(r.method()==='POST'&&/\/api\/staff\/(photos|apartments)$/.test(r.url()))writes++;});
async function api(path,method='GET',data,status=200){const r=await page.request.fetch(origin+'/api/staff/'+path,{method,headers:{Origin:origin},data});assert.equal(r.status(),status);return r.json();}
async function gallery(){await page.goto(origin+'/staff');await page.getByRole('heading',{name:'Apartment Gallery',exact:true}).waitFor();await page.locator('#replace-apartment option').first().waitFor({state:'attached'});}
async function exportClick(id){const row=page.locator('#catalog li').filter({has:page.locator('[href="/staff/editor/?apartment='+id+'"]')});await row.locator('details').evaluate(d=>d.open=true);await row.getByRole('button',{name:'Export .shtour',exact:true}).click();await page.locator('.backup-password-dialog').waitFor();}
async function beginImport(bytes){await gallery();await page.locator('details').filter({has:page.locator('#import')}).evaluate(d=>d.open=true);await page.locator('#replace-apartment').selectOption('');await page.locator('#import input[type=file]').setInputFiles({name:'synthetic.shtour.zip',mimeType:'application/zip',buffer:bytes});await page.locator('#import button').click();}
try{
 await page.goto(origin+'/staff');await page.locator('#username-field input').fill(process.env.PILOT_PROBE_USERNAME);await page.locator('input[name=passphrase]').fill(process.env.PILOT_PROBE_STAFF);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('#catalog').waitFor();
 const source=(await api('dashboard')).apartments.find(a=>/^Synthetic /.test(a.title)&&!a.archived);assert.ok(source);const original=await api('drafts/'+source.id),images=new Map();
 for(const room of original.tour.rooms){const r=await page.request.get(origin+'/api/staff/tours/'+source.id+'/images/'+room.id);assert.equal(r.status(),200);images.set(room.id,new Blob([await r.body()],{type:'image/jpeg'}));}
 let archive;
 for(let n=0;n<2;n++){
  const tour={...original.tour,title:'Synthetic encrypted acceptance '+Date.now()+' '+n};const a=await api('apartments','POST',{tour,photos:original.photos},201);created.push(a.id);await gallery();await exportClick(a.id);
  if(n===0){await page.locator('[name=backupPassword]').fill(backupTestPassword);await page.locator('[name=backupConfirmation]').fill('Mismatch only');await page.getByRole('button',{name:'Encrypt and Download',exact:true}).click();await page.getByText('Backup passwords do not match.',{exact:true}).waitFor();assert.equal(downloads,0);}
  const pending=page.waitForEvent('download');await fillBackupDialog(page,true);const download=await pending;assert.ok(download.suggestedFilename().endsWith('.shtour.zip'));const bytes=await readFile(await download.path()),round=await readTestBackup(new Blob([bytes]));assert.deepEqual(round.tour,tour);for(const[id,blob]of images)assert.deepEqual(await round.images.get(id).arrayBuffer(),await blob.arrayBuffer());archive=bytes;
 }
 const beforeWrites=writes;
 await beginImport(archive);await fillBackupDialog(page,false,'Wrong synthetic password');await page.getByText('Incorrect backup password or damaged archive. Nothing has been imported.',{exact:true}).waitFor();assert.equal(writes,beforeWrites);await page.getByRole('button',{name:'Cancel',exact:true}).click();
 const entries=unzipSync(archive);entries['apartment.bin'][0]^=1;await beginImport(Buffer.from(zipSync(entries,{level:0})));await fillBackupDialog(page);await page.getByText('Incorrect backup password or damaged archive. Nothing has been imported.',{exact:true}).waitFor();assert.equal(writes,beforeWrites);await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await beginImport(archive.subarray(0,archive.length-40));await fillBackupDialog(page);await page.getByText(/encrypted ZIP is damaged/).waitFor();assert.equal(writes,beforeWrites);await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await gallery();const beforeDownloads=downloads;await exportClick(created[0]);await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(downloads,beforeDownloads);
 // Interrupt collection after password entry: no partially encrypted file may download.
 const pattern='**/api/staff/tours/'+created[0]+'/images/**';let held;const intercepted=new Promise(resolve=>held=resolve);await page.route(pattern,async route=>{held();await new Promise(resolve=>setTimeout(resolve,600));await route.abort();});await exportClick(created[0]);await fillBackupDialog(page,true);await intercepted;await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForTimeout(800);assert.equal(downloads,beforeDownloads);await page.unroute(pattern);
 // Explicit overwrite rejection, using the legacy format too, must not upload anything.
 await gallery();await page.locator('details').filter({has:page.locator('#import')}).evaluate(d=>d.open=true);await page.locator('#replace-apartment').selectOption(created[0]);await page.locator('#import input[type=file]').setInputFiles({name:'legacy.shtour',mimeType:'application/octet-stream',buffer:Buffer.from(await packTour({tour:original.tour,images}).arrayBuffer())});page.once('dialog',d=>d.dismiss());await page.locator('#import button').click();assert.equal(writes,beforeWrites);assert.equal(await page.locator('.backup-password-dialog').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS two encrypted apartment exports; exact metadata/JPEG bytes, password confirmation, wrong/corrupt/truncated import with zero uploads, password network exclusion, cancel/interrupted export, legacy overwrite rejection and folded touch layout.');
}finally{for(const id of created){const d=await api('drafts/'+id).catch(()=>null);if(d)await api('apartments/'+id,'PATCH',{action:'remove',expectedVersion:d.revision}).catch(()=>{});}await page.request.post(origin+'/api/staff/sign-out',{headers:{Origin:origin}}).catch(()=>{});await browser.close();}
