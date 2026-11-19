// Local synthetic acceptance. OAuth and Cloudflare provisioning are simulated;
// the browser talks to the real Worker routes, native scrypt and SQLite adapter.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,generateKeyPairSync,sign,createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import worker,{StaffLogin} from '../cloudflare/worker.mjs';
import {setupDigest} from '../cloudflare/agency-setup.mjs';
import {createCompanion} from './server.mjs';

const database=new DatabaseSync(':memory:');
for(const name of ['schema.sql','uac-schema.sql','uploads-schema.sql','diagnostics-schema.sql','agency-setup-schema.sql','maintenance-schema.sql'])database.exec(await readFile(new URL('../cloudflare/'+name,import.meta.url),'utf8'));
const db={withSession(){return db;},prepare(sql){return {bind:(...args)=>({first:()=>database.prepare(sql).get(...args),all:()=>({results:database.prepare(sql).all(...args)}),run(){const s=database.prepare(sql);return s.columns().length?{results:s.all(...args)}:{meta:s.run(...args)};}})};},async batch(statements){database.exec('BEGIN');try{const result=statements.map(s=>s.run());database.exec('COMMIT');return result;}catch(e){database.exec('ROLLBACK');throw e;}}};
const agencyOrigin='https://synthetic-agency.workers.dev',ticket=randomBytes(32).toString('base64url');
database.prepare('INSERT INTO agency_setup VALUES(1,?,?,?,NULL)').run('a'.repeat(32),setupDigest(ticket),Date.now()+600000);
const assets=resolve(fileURLToPath(new URL('../cloudflare/generated',import.meta.url)));
const env={PHOTOS:{get:async()=>null},DB:db,INSTALLATION_MODE:'agency',INSTALLATION_ID:'a'.repeat(32),APP_ORIGIN:agencyOrigin,AGENCY_COMPANION_ORIGIN:'https://setup.example.invalid',AGENCY_BROWSER_SETUP:'1',GUEST_CODE_KEY:randomBytes(32).toString('hex'),STAFF_AUTH_MODE:'password',STAFF_ACCOUNTS:'1',TOUR_API_BACKEND:'durable-object',TOUR_UAC:'1',DIAGNOSTICS_ENABLED:'1',SCHEMA_REQUIRED:'4',ASSETS:{async fetch(request){const path=resolve(assets,'.'+new URL(request.url).pathname);if(!path.startsWith(assets+sep))return new Response(null,{status:404});try{const bytes=await readFile(path),ext=path.split('.').pop();return new Response(bytes,{headers:{'Content-Type':({html:'text/html',js:'text/javascript',css:'text/css',jpg:'image/jpeg'})[ext]??'application/octet-stream'}});}catch{return new Response(null,{status:404});}}}};
const actors=new Map();env.STAFF_LOGIN={getByName(name){if(!actors.has(name))actors.set(name,new StaffLogin(null,env));return actors.get(name);}};
const signer=generateKeyPairSync('ed25519'),manifest=Buffer.from(JSON.stringify({edition:'cloudflare',version:'0.2.1',build:'2'.repeat(40),schema:4,from:['0.2.0'],fromSchemas:[4],migration:'additive',artifactSha256:'3'.repeat(64),notes:'Synthetic verified update: agency approval, encrypted installation backup and safe code recovery.'}));
Object.assign(env,{APP_BUILD:'1'.repeat(40),UPDATE_MANIFEST:manifest.toString('base64'),UPDATE_SIGNATURE:sign(null,manifest,signer.privateKey).toString('base64'),UPDATE_PUBLIC_KEY:signer.publicKey.export({type:'spki',format:'pem'})});
const app=createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const c of req)chunks.push(c);
  const headers=new Headers(req.headers);if(headers.has('origin'))headers.set('origin',agencyOrigin);
  const response=await worker.fetch(new Request(agencyOrigin+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}),env);
  // Secure cookies remain Secure. The local HTTPS transport below uses browser
  // routing, so the fixture never weakens production cookie configuration.
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Synthetic fixture failed');}
});
await new Promise(r=>app.listen(0,'127.0.0.1',r));
const transport='http://127.0.0.1:'+app.address().port;
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin='http://127.0.0.1:'+port;
const companion=createCompanion({origin,clientId:'synthetic',clientSecret:'synthetic',scopes:'synthetic',stateDirectory:'unused-synthetic',build:'synthetic',verifiedFreePlanIds:['synthetic'],fetcher:async url=>url.endsWith('/token')?Response.json({access_token:'synthetic',expires_in:600}):new Response(null,{status:200}),apiFactory:()=>async()=>[{id:'a'.repeat(32),name:'Synthetic Housing Agency'}],runnerFactory:()=>()=>{},deploy:async({progress})=>{progress('Preparing synthetic resources');return {ready:false,website:agencyOrigin,ticket,expires:Date.now()+600000};}});
await new Promise(r=>companion.listen(port,'127.0.0.1',r));
const output=new URL('../test-results/agency-browser/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1360,height:1000}}),page=await context.newPage();
page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let companionPassword=false;
const requestBodies=[];page.on('request',r=>{if(r.postData())requestBodies.push(r.postData());if(r.url().startsWith(origin)&&(r.postData()??'').includes('Synthetic browser Administrator password'))companionPassword=true;});
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(url.origin===origin&&url.pathname==='/oauth/start'){
  const r=await fetch(origin+'/oauth/start',{redirect:'manual',headers:request.headers()});
  assert.equal(r.status,303);const auth=new URL(r.headers.get('Location'));assert.equal(auth.origin,'https://dash.cloudflare.com');
  const callback=origin+'/oauth/callback?state='+encodeURIComponent(auth.searchParams.get('state'))+'&code=synthetic';
  return route.fulfill({status:200,headers:{'Content-Type':'text/html','Set-Cookie':r.headers.get('Set-Cookie')},body:'<!doctype html><title>Synthetic Cloudflare authorization</title><a href="'+callback+'">Continue synthetic authorization</a>'});
 }
 if(url.origin===agencyOrigin){
  const r=await fetch(transport+url.pathname+url.search,{method:request.method(),redirect:'manual',headers:request.headers(),body:['GET','HEAD'].includes(request.method())?undefined:request.postDataBuffer()});
  return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});
 }
 if(url.origin!==origin)return route.abort();
 return route.continue();
});
try{
 await page.goto(origin);await page.screenshot({path:fileURLToPath(new URL('01-deploy.png',output)),fullPage:true});
 await page.getByRole('link',{name:'Connect to Cloudflare',exact:true}).click();
 await page.getByRole('link',{name:'Continue synthetic authorization',exact:true}).click();
 await page.locator('#choose').waitFor({state:'visible'});await page.locator('#name').fill('synthetic-housing');await page.locator('#free').check();await page.getByRole('button',{name:'Deploy LevelTwo360',exact:true}).click();
 await page.locator('#next').waitFor({state:'visible'});await page.screenshot({path:fileURLToPath(new URL('02-resources-prepared.png',output)),fullPage:true});
 await page.getByRole('link',{name:'Continue agency setup',exact:true}).click();await page.locator('#setup').waitFor({state:'visible'});
 assert.equal(new URL(page.url()).hash,'');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:fileURLToPath(new URL('03-administrator-mobile.png',output)),fullPage:true});
 // A refresh discards the one-time credential. Check the public recovery action.
 await page.reload();await page.getByRole('link',{name:'Return to deployment wizard'}).waitFor();
 assert.equal(await page.locator('#resume-link').getAttribute('href'),'https://setup.example.invalid');
 await page.goto(origin);await page.getByRole('link',{name:'Continue agency setup'}).click();
 await page.locator('#username').fill('synthetic-admin');await page.locator('#password').fill('Synthetic browser Administrator password');await page.locator('#confirmation').fill('Synthetic browser Administrator password');await page.getByRole('button',{name:'Create Administrator',exact:true}).click();
 await page.locator('#success').waitFor({state:'visible'});assert.equal(await page.locator('#password').inputValue(),'');
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download setup summary',exact:true}).click();const download=await downloaded;const path=await download.path();const summary=await readFile(path,'utf8');assert.match(summary,/synthetic-admin/);assert.ok(!summary.includes(ticket));assert.doesNotMatch(summary,/Synthetic browser Administrator password/);
 await page.setViewportSize({width:1360,height:1000});await page.screenshot({path:fileURLToPath(new URL('04-ready.png',output)),fullPage:true});
 await page.getByRole('link',{name:'Open LevelTwo360',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 await page.locator('#username-field input').fill('synthetic-admin');await page.locator('input[name=passphrase]').fill('Synthetic browser Administrator password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Apartment Gallery',exact:true}).waitFor();
 await page.goto(agencyOrigin+'/staff/updates');await page.locator('#candidate').waitFor({state:'visible'});await page.screenshot({path:fileURLToPath(new URL('05-update-review.png',output)),fullPage:true});
 const keyDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Generate and download recovery file'}).click();const key=JSON.parse(await readFile(await(await keyDownload).path(),'utf8'));assert.equal(key.format,'lt360-recovery-key-v1');assert.ok(key.privateKey.d);
 const fileInput=page.locator('#saved');
 const selectKey=value=>fileInput.setInputFiles({name:'synthetic-key.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
 await selectKey(key);
 await page.getByText(/Recovery file verified/).waitFor();
 const anotherDownload=page.waitForEvent('download');await page.locator('#key').click();
 const newer=JSON.parse(await readFile(await(await anotherDownload).path(),'utf8'));
 assert.ok(await page.locator('#approve').isDisabled());
 for(const invalid of [key,{...newer,privateKey:key.privateKey},{}]){
  await selectKey(invalid);await page.getByText(/could not unlock/).waitFor();
  assert.ok(await page.locator('#approve').isDisabled());
 }
 await selectKey(newer);await page.getByText(/Recovery file verified/).waitFor();
 await fileInput.dispatchEvent('cancel');assert.ok(await page.locator('#approve').isDisabled());
 await selectKey(newer);await page.getByText(/Recovery file verified/).waitFor();await page.locator('#confirmed').check();await page.getByRole('button',{name:'Approve this update',exact:true}).click();await page.locator('#handoff').waitFor({state:'visible'});await page.screenshot({path:fileURLToPath(new URL('06-update-approved.png',output)),fullPage:true});
 assert.ok(database.prepare('SELECT secret_backup FROM maintenance_requests').get().secret_backup);assert.ok(requestBodies.every(body=>!body.includes(key.privateKey.d)&&!body.includes(newer.privateKey.d)),'Private recovery key must never leave the browser');
 await page.getByRole('button',{name:'Revoke update approval',exact:true}).click();await page.getByText('Update approval revoked.',{exact:true}).waitFor();assert.ok(database.prepare('SELECT revoked FROM maintenance_requests').get().revoked);
 assert.equal(database.prepare('SELECT COUNT(*) n FROM staff_accounts').get().n,1);assert.ok(database.prepare('SELECT completed FROM agency_setup').get().completed);
 // Drive each render state through the shipped wizard at desktop and phone widths.
 const statuses=await context.newPage();
 const accounts=[{name:'Synthetic test agency',id:'a'.repeat(32)}];
 let response,drop=false;
 await statuses.route(origin+'/api/state',route=>drop?route.abort():route.fulfill({json:response}));
 const state=(extra={})=>({accounts,connected:false,running:false,freeVerificationAvailable:true,...extra});
 const bytes=Buffer.alloc(16*1024*1024,77),digest=createHash('sha256').update(bytes).digest('hex');
 await statuses.route(origin+'/api/updates/list',route=>route.fulfill({json:{requests:[{id:'1'.repeat(32),phase:'complete',created:Date.now(),version:'0.2.1',backup_digest:digest}]}}));
 await statuses.route(origin+'/api/updates/backup',route=>{
  assert.equal(route.request().method(),'POST');assert.equal(new URL(route.request().url()).search,'');
  return route.fulfill({headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="LevelTwo360-encrypted-installation.lt360backup"'},body:bytes});
 });
 for(const width of [1360,390]){
  await statuses.setViewportSize({width,height:844});
  response=state({freeVerificationAvailable:false});await statuses.goto(origin);
  await statuses.getByText(/New installations are paused/).waitFor();
  response=state({connected:true,freeVerificationAvailable:false});await statuses.reload();
  await statuses.locator('#choose').waitFor();assert.ok(await statuses.locator('#start-install').isDisabled());
  await statuses.locator('#name').fill('synthetic-housing');await statuses.locator('#inspect-updates').click();
  const saved=statuses.waitForEvent('download');await statuses.getByRole('button',{name:'Download encrypted installation backup'}).click();
  const download=await saved;assert.match(download.suggestedFilename(),/\.lt360backup$/);assert.equal(createHash('sha256').update(await readFile(await download.path())).digest('hex'),digest);
  response=state();await statuses.goto(origin+'/?authorization=failed');
  await statuses.getByRole('heading',{name:'Authorization did not finish'}).waitFor();
  assert.equal(await statuses.locator('#authorize').getAttribute('href'),'/oauth/start');
  for(const [result,heading,action] of [
   [{ready:true},'Your installation is ready','Sign in'],
   [{phase:'complete'},'Update complete','Open LevelTwo360'],
   [{phase:'recovered'},'Previous code recovered','Open LevelTwo360']]){
   response=state({result:{website:agencyOrigin,revoked:true,...result}});await statuses.reload();
   await statuses.getByRole('heading',{name:heading}).waitFor();
   assert.equal(await statuses.getByRole('link',{name:action,exact:true}).getAttribute('href'),agencyOrigin+'/staff');
  }
  response=state({error:'Setup stopped safely.'});await statuses.reload();
  await statuses.getByRole('heading',{name:'Reconnect to continue'}).waitFor();
  drop=true;await statuses.reload();await statuses.getByText(/temporarily unavailable/).waitFor();drop=false;
 }
 await statuses.goto(agencyOrigin+'/setup');
 await statuses.getByRole('heading',{name:'Your installation is ready'}).waitFor();
 assert.equal(await statuses.locator('#resume-link').getAttribute('href'),'/staff');
 await statuses.close();
 assert.equal(companionPassword,false);assert.deepEqual(errors,[]);
 console.log('Agency browser acceptance passed: OAuth/account selection, deployment progress, mobile bootstrap, direct password delivery, atomic closure, secret-free summary, sign-in, verified release review, local-only private recovery key download, durable Administrator approval and revocation. Cloudflare/OAuth providers are synthetic.');
}catch(error){console.error('Browser fixture failed at path:',new URL(page.url()).pathname,'status:',await page.locator('#message').textContent({timeout:1000}).catch(()=>''));await page.screenshot({path:fileURLToPath(new URL('failure.png',output)),fullPage:true});throw error;}finally{await browser.close();await new Promise(r=>companion.close(r));await new Promise(r=>app.close(r));database.close();}
