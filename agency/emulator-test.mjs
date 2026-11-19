// No remote account or Cloudflare API is contacted. Use Wrangler's bundled
// Miniflare/workerd runtime with ephemeral D1, KV and SQLite Durable Objects.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {setupDigest} from '../cloudflare/agency-setup.mjs';
import {encryptBackup,decryptBackup} from '../dist/encrypted-backup.js';

const root=fileURLToPath(new URL('../',import.meta.url)),out=new URL('../test-results/agency-emulator/',import.meta.url);
await mkdir(out,{recursive:true});
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--compatibility-flag','nodejs_compat','--config','cloudflare/wrangler.jsonc','--outdir',fileURLToPath(out)],{cwd:root,stdio:'ignore',windowsHide:true});
const origin='https://synthetic-emulator.workers.dev',ticket=randomBytes(32).toString('base64url'),password='Synthetic emulator Administrator password';
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'agency',modules:true,scriptPath:fileURLToPath(new URL('worker.js',out)),compatibilityDate:'2026-11-03',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'synthetic-agency'},kvNamespaces:['PHOTOS'],durableObjects:{STAFF_LOGIN:{className:'StaffLogin',useSQLite:true}},serviceBindings:{ASSETS:async()=>new Response('Synthetic assets')},bindings:{INSTALLATION_MODE:'agency',INSTALLATION_ID:'a'.repeat(32),APP_ORIGIN:origin,AGENCY_BROWSER_SETUP:'1',GUEST_CODE_KEY:randomBytes(32).toString('hex'),STAFF_AUTH_MODE:'password',STAFF_ACCOUNTS:'1',TOUR_UAC:'1',TOUR_API_BACKEND:'durable-object',DIAGNOSTICS_ENABLED:'1',SCHEMA_REQUIRED:'4'}}]}));
try{
 const db=await mf.getD1Database('DB');
 for(const name of ['schema.sql','uac-schema.sql','uploads-schema.sql','diagnostics-schema.sql','agency-setup-schema.sql','maintenance-schema.sql']){
  const sql=(await readFile(new URL('../cloudflare/'+name,import.meta.url),'utf8')).replace(/^\s*--.*$/gm,'').replace(/\r?\n/g,' ');
  await db.exec(sql);
 }
 await db.prepare('INSERT INTO agency_setup VALUES(1,?,?,?,NULL)').bind('a'.repeat(32),setupDigest(ticket),Date.now()+600000).run();
 const call=(path,{method='GET',body,cookie='',type='application/json'}={})=>mf.dispatchFetch(origin+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':type},...(body!==undefined?{body:type==='application/json'?JSON.stringify(body):body}:{})});
 const check=async(path,status,options)=>{const r=await call(path,options);assert.equal(r.status,status,path);return r;};
 const body={ticket,username:'synthetic-admin',password};
 const race=await Promise.all([call('/api/agency-setup',{method:'POST',body}),call('/api/agency-setup',{method:'POST',body:{...body,username:'duplicate-admin'}})]);
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const username=(await db.prepare('SELECT username FROM staff_accounts').first()).username;
 assert.equal((await db.prepare('SELECT token_digest FROM agency_setup').first()).token_digest,'');
 const admin=(await check('/api/staff/sign-in',200,{method:'POST',body:{username,password}})).headers.get('Set-Cookie').split(';')[0];
 await check('/api/staff/accounts',201,{method:'POST',cookie:admin,body:{username:'synthetic-staff',password:'Synthetic emulator Staff password',role:'editor'}});
 const staff=(await check('/api/staff/sign-in',200,{method:'POST',body:{username:'synthetic-staff',password:'Synthetic emulator Staff password'}})).headers.get('Set-Cookie').split(';')[0];
 await check('/api/staff/accounts',403,{cookie:staff});
 const tour=JSON.parse(await readFile(new URL('../cloudflare/sample.json',import.meta.url),'utf8')),photos={},images=new Map();
 for(const room of tour.rooms){const bytes=await readFile(new URL('../cloudflare/sample-images/'+room.id+'.jpg',import.meta.url));images.set(room.id,new Blob([bytes],{type:'image/jpeg'}));photos[room.id]=(await(await check('/api/staff/photos',201,{method:'POST',cookie:admin,type:'image/jpeg',body:bytes})).json()).id;}
 const apartment=await(await check('/api/staff/apartments',201,{method:'POST',cookie:admin,body:{tour,photos}})).json();
 for(const room of tour.rooms){await check(`/api/staff/tours/${apartment.id}/images/${room.id}`,401);const r=await check(`/api/staff/tours/${apartment.id}/images/${room.id}`,200,{cookie:admin});assert.deepEqual(Buffer.from(await r.arrayBuffer()),Buffer.from(await images.get(room.id).arrayBuffer()));}
 const encrypted=await encryptBackup({tour,images},'Synthetic emulator backup password'),restored=await decryptBackup(encrypted,'Synthetic emulator backup password');
 assert.equal(restored.images.size,images.size);for(const [id,image]of images)assert.deepEqual(Buffer.from(await restored.images.get(id).arrayBuffer()),Buffer.from(await image.arrayBuffer()));
 const health=await(await check('/api/installation-health',200)).json();assert.equal(health.ready,true);assert.equal(health.prepared,true);
 console.log('Cloudflare local-runtime acceptance passed: atomic bootstrap, native private-DO scrypt, Administrator/Staff sign-in, staff-management denial, synthetic apartment/JPEG private KV round-trip, encrypted backup/restore and installation health. No remote deployment, billing or public Free CPU claim.');
}finally{await mf.dispose();}
