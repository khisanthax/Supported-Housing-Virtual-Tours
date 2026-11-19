import assert from 'node:assert/strict';import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {installationConfig} from '../cloudflare/install.mjs';import {setupDigest} from '../cloudflare/agency-setup.mjs';import {signedManifest,sha256} from './artifact.mjs';import {runInstallationUpdate} from './update-service.mjs';import {verifySnapshot} from './snapshot.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'lt360-native-update-')),bundle=join(directory,'build');await mkdir(bundle);
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--compatibility-flag','nodejs_compat','--config','cloudflare/wrangler.jsonc','--outdir',bundle],{cwd:root,stdio:'ignore',windowsHide:true});
const source=await readFile(join(bundle,'worker.js'),'utf8');assert.ok(source.includes('version: "0.2.0"'));assert.ok(source.includes('schema: 4'));
// Two synthetic releases of the real bundled Worker, sharing ephemeral D1/KV.
const candidate=source.replace('version: "0.2.0"','version: "0.2.1"').replace('schema: 4','schema: 5');
const artifact=Buffer.from(JSON.stringify({format:'lt360-release-v1',worker:candidate,assets:[],migrations:[{version:5,sql:'CREATE TABLE IF NOT EXISTS synthetic_update_feature(id TEXT PRIMARY KEY);'}]}));
const signer=generateKeyPairSync('ed25519'),recovery=generateKeyPairSync('rsa',{modulusLength:3072}),publicKey={...recovery.publicKey.export({format:'jwk'}),alg:'RSA-OAEP-256'},fromBuild='1'.repeat(40),toBuild='2'.repeat(40),account='a'.repeat(32),installation='b'.repeat(32),guestKey=randomBytes(32).toString('hex');
const state={name:'synthetic-native',account,installation,resourceName:'synthetic-native-unique',database:'11111111-1111-1111-1111-111111111111',namespace:'e'.repeat(32),origin:'https://synthetic-native.example.workers.dev'};
const signed=signedManifest({artifact,privateKey:signer.privateKey,edition:'cloudflare',version:'0.2.1',build:toBuild,schema:5,from:['0.2.0'],fromSchemas:[4],migration:'additive',notes:'Synthetic native runtime migration and recovery rehearsal'}),releaseBundle={...signed,artifact,publicKey:signer.publicKey.export({type:'spki',format:'pem'})};
const vars={INSTALLATION_MODE:'agency',INSTALLATION_ID:installation,APP_ORIGIN:state.origin,AGENCY_BROWSER_SETUP:'1',STAFF_AUTH_MODE:'password',STAFF_ACCOUNTS:'1',TOUR_UAC:'1',TOUR_API_BACKEND:'durable-object',DIAGNOSTICS_ENABLED:'1',SCHEMA_REQUIRED:'4',SCHEMA_COMPATIBLE_MAX:'5',APP_BUILD:fromBuild,UPDATE_MANIFEST:signed.bytes.toString('base64'),UPDATE_SIGNATURE:signed.signature.toString('base64'),UPDATE_PUBLIC_KEY:releaseBundle.publicKey};
const common={modules:true,compatibilityDate:'2026-11-03',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:state.database},kvNamespaces:{PHOTOS:state.namespace},durableObjects:{STAFF_LOGIN:{className:'StaffLogin',useSQLite:true}},serviceBindings:{ASSETS:async()=>new Response('Synthetic assets')}};
async function verifyInterruption(point){
const outcome=point.endsWith('complete')?'complete':'recovered';
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"router",modules:true,compatibilityDate:"2026-11-03",script:"export default {fetch(request,env){const next=request.headers.get(\"X-Synthetic-Target\")===\"candidate\";const clean=new Request(request);clean.headers.delete(\"X-Synthetic-Target\");return (next?env.NEXT:env.PREV).fetch(clean);}}",serviceBindings:{PREV:"previous",NEXT:"candidate"}},{...common,name:'previous',script:source,bindings:{...vars,GUEST_CODE_KEY:guestKey}},{...common,name:'candidate',script:candidate,bindings:{...vars,GUEST_CODE_KEY:guestKey,APP_BUILD:toBuild,SCHEMA_REQUIRED:'5',SCHEMA_COMPATIBLE_MAX:'6'}}]}));
try{
 const db=await mf.getD1Database('DB','previous'),kv=await mf.getKVNamespace('PHOTOS','previous');
 for(const name of ['schema.sql','uac-schema.sql','uploads-schema.sql','diagnostics-schema.sql','agency-setup-schema.sql','maintenance-schema.sql'])await db.exec((await readFile(new URL('../cloudflare/'+name,import.meta.url),'utf8')).replace(/^\s*--.*$/gm,'').replace(/\r?\n/g,' '));
 let active='previous',activations=0;const versions=[];
 const fetcher=async(url,options={})=>{const headers=new Headers(options.headers);headers.set("X-Synthetic-Target",active);return mf.dispatchFetch(url,{...options,headers});};
 const request=async(path,{method='GET',body,cookie='',type='application/json'}={})=>fetcher(state.origin+path,{method,headers:{Origin:state.origin,Cookie:cookie,'Content-Type':type},...(body!==undefined?{body:type==='application/json'?JSON.stringify(body):body}:{})});
 const check=async(path,status,options)=>{const r=await request(path,options);if(r.status!==status)console.error(path,await r.clone().text());assert.equal(r.status,status,path);return r;};
 const ticket=randomBytes(32).toString('base64url');await db.prepare('INSERT INTO agency_setup VALUES(1,?,?,?,NULL)').bind(installation,setupDigest(ticket),Date.now()+600000).run();
 await check('/api/agency-setup',200,{method:'POST',body:{ticket,username:'synthetic-admin',password:'Synthetic native update password'}});
 const cookie=(await check('/api/staff/sign-in',200,{method:'POST',body:{username:'synthetic-admin',password:'Synthetic native update password'}})).headers.get('Set-Cookie').split(';')[0];
 await check('/api/staff/accounts',201,{method:'POST',cookie,body:{username:'synthetic-staff',role:'editor',password:'Synthetic retained staff password'}});
 const image=await readFile(new URL('../cloudflare/sample-images/living.jpg',import.meta.url)),photo=(await(await check('/api/staff/photos',201,{method:'POST',cookie,type:'image/jpeg',body:image})).json()).id;
 const credentialsBefore=await db.prepare('SELECT username,password_verifier,role,revision FROM staff_accounts ORDER BY username').all();
 const update=await(await check('/api/staff/maintenance',200,{cookie})).json();assert.equal(update.available.version,'0.2.1');
 const approval=await(await check('/api/staff/maintenance',201,{method:'POST',cookie,body:{manifestSha256:update.available.manifestSha256,publicKey,recoverySaved:true,confirm:true}})).json();
 await writeFile(join(directory,'installation.json'),JSON.stringify(state));const config=installationConfig({...state,name:state.resourceName,origin:state.origin,build:fromBuild});config.vars={...vars};await writeFile(join(directory,'wrangler.json'),JSON.stringify(config));
 const api=async(path,options={})=>{
  if(path.endsWith('/subscriptions'))return [{price:0,state:'Provisioned',rate_plan:{scope:'workers',id:'synthetic-free'}}];
  if(path.endsWith('/query'))return [{success:true,results:(await db.prepare(options.body.sql).bind(...(options.body.params??[])).all()).results}];
  if(path.endsWith('/settings'))return {bindings:[...Object.entries(vars).map(([name,text])=>({name,type:'plain_text',text})),{name:'DB',type:'d1',id:state.database},{name:'PHOTOS',type:'kv_namespace',namespace_id:state.namespace},{name:'GUEST_CODE_KEY',type:'secret_text'},{type:'durable_object_namespace',name:'STAFF_LOGIN',class_name:'StaffLogin'}]};
  if(path.endsWith('/deployments')){if(options.method==='POST'){activations++;active=options.body.versions[0].version_id;return {id:'synthetic-deployment'};}return {deployments:[{versions:[{percentage:100,version_id:active}]}]};}
  if(path.endsWith('/versions'))return {items:versions};throw Error('Unexpected control-plane operation');
 };
 api.page=async()=>{const result=await kv.list();return {result:result.keys,result_info:{cursor:result.list_complete?'':result.cursor}};};api.binary=async path=>kv.get(decodeURIComponent(path.split('/').pop()),'arrayBuffer');
 const run=async args=>{const cfg=JSON.parse(await readFile(args[args.indexOf('--config')+1],'utf8'));assert.equal(await readFile(cfg.main,'utf8'),candidate);assert.equal(cfg.vars.APP_BUILD,toBuild);assert.equal(cfg.vars.INSTALLATION_ID,installation);versions.push({id:'candidate',annotations:{'workers/message':'LT360-update-'+approval.id}});};
 const options={account,name:state.name,directory,requestId:approval.id,api,run,releaseBundle,verifiedFreePlanIds:['synthetic-free'],fetcher};
 const interrupt=async phase=>{
  if(phase==='backup-ready')await check('/api/staff/accounts',503,{method:'POST',cookie,body:{username:'must-not-write',role:'editor',password:'Synthetic denied password'}});
  if(phase==='verifying' && outcome==='recovered')throw Error('Synthetic candidate verification failure');
  if(phase===point)throw {simulatedCrash:true};
 };
 await assert.rejects(runInstallationUpdate({...options,checkpoint:interrupt}),error=>error.simulatedCrash===true);
 for(let resume=0;resume<2;resume++)assert.equal((await runInstallationUpdate(options)).phase,outcome);
 const success=outcome==='complete';
 assert.equal(activations,success?1:2);assert.equal(active,success?'candidate':'previous');
 assert.equal((await db.prepare('SELECT count(*) n FROM maintenance_lock').first()).n,0);
 assert.deepEqual((await db.prepare('SELECT username,password_verifier,role,revision FROM staff_accounts ORDER BY username').all()).results,credentialsBefore.results);assert.deepEqual(Buffer.from(await kv.get(photo,'arrayBuffer')),image);
 const health=await(await check('/api/installation-health',200)).json();assert.equal(health.version,success?'0.2.1':'0.2.0');assert.equal(health.schema,5);assert.equal(health.build,success?toBuild:fromBuild);assert.equal(health.ready,true);
 const receipt=await db.prepare('SELECT backup_file FROM maintenance_requests WHERE id=?').bind(approval.id).first(),restored=await verifySnapshot(join(directory,'updates',approval.id,receipt.backup_file),{privateKey:recovery.privateKey.export({format:'jwk'}),onImage:async(name,bytes)=>{assert.equal(name,photo);assert.deepEqual(bytes,image);}});assert.equal(restored.database.prepare('SELECT COUNT(*) n FROM staff_accounts').get().n,2);restored.database.close();
 const staff=(await check('/api/staff/sign-in',200,{method:'POST',body:{username:'synthetic-staff',password:'Synthetic retained staff password'}})).headers.get('Set-Cookie').split(';')[0];
 const tour=JSON.parse(await readFile(new URL('../cloudflare/sample.json',import.meta.url),'utf8'));
 const photos={};for(const room of tour.rooms){
  const bytes=await readFile(new URL('../cloudflare/sample-images/'+room.id+'.jpg',import.meta.url));
  photos[room.id]=(await(await check('/api/staff/photos',201,{method:'POST',cookie:staff,type:'image/jpeg',body:bytes})).json()).id;
 }
 const created=await(await check('/api/staff/apartments',201,{method:'POST',cookie:staff,body:{tour,photos}})).json();
 const title='Synthetic edit after '+point;
 await check('/api/staff/apartments',201,{method:'POST',cookie:staff,body:{tour:{...tour,title},photos,replacement:created.id,expectedVersion:created.version}});
 const draft=await(await check('/api/staff/drafts/'+created.id,200,{cookie:staff})).json();
 assert.equal(draft.tour.title,title);assert.equal(draft.revision,created.version+1);
 console.log('Native update acceptance passed at '+point+' with two resumes and a signed-in staff draft edit.');
}finally{await mf.dispose();}
}
try{
 for(const point of ['before-complete','complete','before-recovered','recovered'])await verifyInterruption(point);
}finally{await rm(directory,{recursive:true,force:true});}
