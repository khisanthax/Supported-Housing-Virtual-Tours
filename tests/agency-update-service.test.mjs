import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {generateKeyPairSync,sign} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {runInstallationUpdate} from '../agency/update-service.mjs';import {sha256} from '../agency/artifact.mjs';import {verifySnapshot} from '../agency/snapshot.mjs';import {installationConfig} from '../cloudflare/install.mjs';import {sealConfiguration} from '../cloudflare/maintenance.mjs';
const account='a'.repeat(32),installation='b'.repeat(32),requestId='c'.repeat(32),fromBuild='1'.repeat(40),toBuild='2'.repeat(40);
const rsa=generateKeyPairSync('rsa',{modulusLength:3072}),jwk={...rsa.publicKey.export({format:'jwk'}),alg:'RSA-OAEP-256'},signer=generateKeyPairSync('ed25519');

async function fixture(t,{schema=4}={}){
 const directory=await mkdtemp(join(tmpdir(),'lt360-update-'));t.after(()=>rm(directory,{recursive:true,force:true}));const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 for(const file of ['schema.sql','uac-schema.sql','uploads-schema.sql','diagnostics-schema.sql','agency-setup-schema.sql','maintenance-schema.sql'])db.exec(await readFile(new URL('../cloudflare/'+file,import.meta.url),'utf8'));
 db.prepare("INSERT INTO staff_accounts(username,password_verifier,role) VALUES('synthetic-admin','Synthetic retained credential','administrator')").run();db.prepare("INSERT INTO staff_accounts(username,password_verifier,role) VALUES('synthetic-staff','Synthetic retained staff credential','editor')").run();db.prepare('INSERT INTO photos(id,bytes,ready) VALUES(?,?,1)').run('d'.repeat(32),4);
 const state={name:'synthetic-agency',account,installation,resourceName:'synthetic-agency-unique',database:'11111111-1111-1111-1111-111111111111',namespace:'e'.repeat(32),origin:'https://synthetic-agency.example.workers.dev'};await writeFile(join(directory,'installation.json'),JSON.stringify(state));
 const config=installationConfig({...state,name:state.resourceName,origin:state.origin,build:fromBuild});config.vars.AGENCY_BROWSER_SETUP='1';config.vars.SCHEMA_COMPATIBLE_MAX='5';await writeFile(join(directory,'wrangler.json'),JSON.stringify(config));
 const artifact=Buffer.from(JSON.stringify({format:'lt360-release-v1',worker:'export default {fetch(){return new Response("Synthetic candidate")}}',assets:[{path:'index.html',bytes:9,sha256:sha256('Synthetic'),data:Buffer.from('Synthetic').toString('base64')}],migrations:schema===5?[{version:5,sql:'CREATE TABLE IF NOT EXISTS new_feature(id TEXT PRIMARY KEY);'}]:[]}));
 const manifest={edition:'cloudflare',version:'0.2.1',build:toBuild,schema,from:['0.2.0'],fromSchemas:[4],migration:'additive',artifactSha256:sha256(artifact),notes:'Synthetic verified release'};const bytes=Buffer.from(JSON.stringify(manifest)),signature=sign(null,bytes,signer.privateKey),releaseBundle={bytes,signature,artifact,publicKey:signer.publicKey.export({format:'pem',type:'spki'})};
 const secret=await sealConfiguration(jwk,{GUEST_CODE_KEY:'Synthetic original guest secret'});
 db.prepare('INSERT INTO maintenance_requests(id,installation,administrator,revision,from_build,manifest_digest,version,public_key,secret_backup,created,expires) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(requestId,installation,'synthetic-admin',1,fromBuild,sha256(bytes),manifest.version,JSON.stringify(jwk),JSON.stringify(secret),Date.now(),Date.now()+7200000);
 let active='synthetic-previous-version',uploads=0,failHealth=false,loseResponse=false;const deployments=[],versions=[];
 const sql=(query,params=[])=>{const statement=db.prepare(query);if(statement.columns().length)return statement.all(...params);statement.run(...params);return [];};
 const api=async(path,options={})=>{
  if(path.endsWith('/subscriptions'))return [{price:0,state:'Provisioned',rate_plan:{scope:'workers',id:'synthetic-free'}}];
  if(path.endsWith('/query'))return [{success:true,results:sql(options.body.sql,options.body.params)}];
  if(path.endsWith('/settings'))return {bindings:[...Object.entries(config.vars).map(([name,text])=>({type:'plain_text',name,text})),{type:'d1',name:'DB',id:state.database},{type:'kv_namespace',name:'PHOTOS',namespace_id:state.namespace},{type:'secret_text',name:'GUEST_CODE_KEY'},{type:'durable_object_namespace',name:'STAFF_LOGIN',class_name:'StaffLogin'}]};
  if(path.endsWith('/deployments')){if(options.method==='POST'){active=options.body.versions[0].version_id;deployments.push(active);if(loseResponse&&active!=='synthetic-previous-version'){loseResponse=false;throw Error('Synthetic lost activation response');}return {id:'deployment'};}return {deployments:[{versions:[{version_id:active,percentage:100}]}]};}
  if(path.endsWith('/versions'))return {items:versions};
  throw Error('Unexpected endpoint '+path);
 };
 api.page=async()=>({result:[{name:'d'.repeat(32)}],result_info:{}});api.binary=async()=>Buffer.from([255,216,255,217]);
 const run=async args=>{assert.deepEqual(args.slice(0,2),['versions','upload']);const path=args[args.indexOf('--config')+1],next=JSON.parse(await readFile(path,'utf8'));assert.equal(next.vars.APP_BUILD,toBuild);assert.equal(next.vars.INSTALLATION_ID,installation);assert.equal(next.keep_vars,true);assert.equal(next.kv_namespaces[0].id,state.namespace);assert.equal(next.vars.SCHEMA_COMPATIBLE_MAX,String(schema+1));uploads++;versions.push({id:'synthetic-next-version',annotations:{'workers/message':'LT360-update-'+requestId}});};
 const fetcher=async()=>Response.json({maintenanceProtocol:1,ready:!(failHealth&&active!=='synthetic-previous-version'),version:active==='synthetic-next-version'?'0.2.1':'0.2.0',build:active==='synthetic-next-version'?toBuild:fromBuild,schema:db.prepare('SELECT MAX(version) n FROM app_migrations').get().n});
 const options={account,name:state.name,directory,requestId,api,run,releaseBundle,verifiedFreePlanIds:['synthetic-free'],fetcher};
 return {db,directory,options,deployments,get uploads(){return uploads;},set failHealth(value){failHealth=value;},set loseResponse(value){loseResponse=value;},set active(value){active=value;}};
}

test('approved update backs up real database/JPEG/configuration, preserves credentials and bindings, verifies health and records history',async t=>{
 const f=await fixture(t),result=await runInstallationUpdate(f.options);assert.equal(result.phase,'complete');assert.equal(f.uploads,1);assert.deepEqual(f.deployments,['synthetic-next-version']);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM maintenance_lock').get().n,0);
 const request=f.db.prepare('SELECT * FROM maintenance_requests').get();assert.equal(request.phase,'complete');assert.match(request.backup_digest,/^[a-f0-9]{64}$/);
 const restored=await verifySnapshot(join(f.directory,'updates',requestId,request.backup_file),{privateKey:rsa.privateKey.export({format:'jwk'})});t.after(()=>restored.database.close());assert.equal(restored.images,1);assert.equal(restored.database.prepare("SELECT password_verifier FROM staff_accounts WHERE username='synthetic-staff'").get().password_verifier,'Synthetic retained staff credential');
 assert.equal(restored.configuration.settings.bindings.find(b=>b.type==='secret_text').text,undefined);assert.ok(restored.configuration.secretEnvelope.data);
 assert.equal((await runInstallationUpdate(f.options)).phase,'complete');assert.equal(f.uploads,1);assert.equal(f.deployments.length,1);
});

test('crashed backup-ready job resumes from durable receipts without recreating resources or passwords',async t=>{
 const f=await fixture(t);let crash=true;f.options.checkpoint=async phase=>{if(phase==='backup-ready'&&crash){crash=false;throw {simulatedCrash:true};}};await assert.rejects(runInstallationUpdate(f.options));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM maintenance_lock').get().n,1);const prior=f.db.prepare('SELECT backup_digest FROM maintenance_requests').get().backup_digest;
 assert.equal((await runInstallationUpdate(f.options)).phase,'complete');assert.equal(f.db.prepare('SELECT backup_digest FROM maintenance_requests').get().backup_digest,prior);assert.equal(f.uploads,1);
});

test('lost activation response and failed candidate health recover code while preserving current data, including additive schema',async t=>{
 for(const cause of ['health','response']){const f=await fixture(t,{schema:5});if(cause==='health')f.failHealth=true;else f.loseResponse=true;await assert.rejects(runInstallationUpdate(f.options),/Previous code|Previous code|previous code/i);assert.equal(f.db.prepare('SELECT phase FROM maintenance_requests').get().phase,'recovered');assert.equal(f.db.prepare('SELECT MAX(version) n FROM app_migrations').get().n,5);assert.equal(f.db.prepare("SELECT password_verifier FROM staff_accounts WHERE username='synthetic-admin'").get().password_verifier,'Synthetic retained credential');assert.deepEqual(f.deployments,['synthetic-next-version','synthetic-previous-version']);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM maintenance_lock').get().n,0);}
});

test('crash after activation is observed and completed without deploying twice',async t=>{
 const f=await fixture(t);let crash=true;f.options.checkpoint=async phase=>{if(phase==='verifying'&&crash){crash=false;throw {simulatedCrash:true};}};await assert.rejects(runInstallationUpdate(f.options));assert.equal(f.deployments.length,1);assert.equal((await runInstallationUpdate(f.options)).phase,'complete');assert.equal(f.deployments.length,1);
});

test('revocation, Administrator revision changes, cross-account selection and damaged backup stop deployment',async t=>{
 for(const mode of ['revoked','tamper']){const f=await fixture(t);f.options.checkpoint=async phase=>{if(phase!=='backup-ready')return;if(mode==='revoked')f.db.prepare('UPDATE maintenance_requests SET revoked=?').run(Date.now());if(mode==='tamper'){const row=f.db.prepare('SELECT backup_file FROM maintenance_requests').get();await writeFile(join(f.directory,'updates',requestId,row.backup_file),'Synthetic damage');throw {simulatedCrash:true};}};await assert.rejects(runInstallationUpdate(f.options));if(mode==='tamper'){f.options.checkpoint=async()=>{};await assert.rejects(runInstallationUpdate(f.options));}assert.equal(f.deployments.length,0);}
 const revised=await fixture(t);revised.db.exec('UPDATE staff_accounts SET revision=revision+1');await assert.rejects(runInstallationUpdate(revised.options),/Administrator changed/);assert.equal(revised.deployments.length,0);
 const f=await fixture(t);await assert.rejects(runInstallationUpdate({...f.options,account:'f'.repeat(32)}),/does not match/);assert.equal(f.deployments.length,0);
});

test('unexpected external deployment fails closed without force rollback or clearing maintenance',async t=>{
 const f=await fixture(t);f.options.checkpoint=async phase=>{if(phase==='backup-ready')f.active='unrelated-external-version';};await assert.rejects(runInstallationUpdate(f.options),/recovery could not be verified/);assert.equal(f.db.prepare('SELECT phase FROM maintenance_requests').get().phase,'operator-recovery-required');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM maintenance_lock').get().n,1);assert.equal(f.deployments.length,0);
});

test('database write barrier blocks already-running business mutations while allowing update metadata and compatible schema ledger changes',async t=>{
 const f=await fixture(t);f.db.prepare('INSERT INTO maintenance_lock VALUES(1,?,?)').run(requestId,Date.now());
 assert.throws(()=>f.db.exec("UPDATE staff_accounts SET password_verifier='must-not-commit'"),/LT360_MAINTENANCE/);assert.throws(()=>f.db.exec('DELETE FROM photos'),/LT360_MAINTENANCE/);assert.throws(()=>f.db.exec('UPDATE uploads_gallery SET revision=revision+1'),/LT360_MAINTENANCE/);
 assert.equal(f.db.prepare("SELECT password_verifier FROM staff_accounts WHERE username='synthetic-admin'").get().password_verifier,'Synthetic retained credential');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM photos').get().n,1);
 f.db.exec('INSERT INTO app_migrations VALUES(5,0)');f.db.prepare('UPDATE maintenance_requests SET revoked=?').run(Date.now());assert.ok(f.db.prepare('SELECT revoked FROM maintenance_requests').get().revoked);
 f.db.exec('DELETE FROM maintenance_lock');f.db.exec("UPDATE staff_accounts SET password_verifier='Synthetic allowed after maintenance'");
});

test('conflicting additive schema and changed Durable Object binding are not overwritten',async t=>{
 const f=await fixture(t,{schema:5});f.db.exec("CREATE TABLE new_feature(unexpected TEXT);INSERT INTO new_feature VALUES('Synthetic retained record')");await assert.rejects(runInstallationUpdate(f.options),/previous code/i);assert.equal(f.deployments.length,0);assert.equal(f.db.prepare('SELECT unexpected FROM new_feature').get().unexpected,'Synthetic retained record');assert.equal(f.db.prepare('SELECT MAX(version) n FROM app_migrations').get().n,4);
 const g=await fixture(t),original=g.options.api;g.options.api=Object.assign(async(path,options)=>{const value=await original(path,options);if(path.endsWith('/settings'))value.bindings.find(b=>b.name==='STAFF_LOGIN').class_name='ForeignClass';return value;},{page:original.page,binary:original.binary});await assert.rejects(runInstallationUpdate(g.options),/Durable Object binding changed/);assert.equal(g.deployments.length,0);
});

test('revocation after activation triggers retained-code recovery before reporting completion',async t=>{
 const f=await fixture(t);f.options.checkpoint=async phase=>{if(phase==='verifying')f.db.prepare('UPDATE maintenance_requests SET revoked=?').run(Date.now());};await assert.rejects(runInstallationUpdate(f.options),/previous code/i);assert.deepEqual(f.deployments,['synthetic-next-version','synthetic-previous-version']);assert.equal(f.db.prepare('SELECT phase FROM maintenance_requests').get().phase,'recovered');
});
