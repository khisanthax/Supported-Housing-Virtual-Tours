import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createCompanion} from '../agency/server.mjs';
import {provision,freePlan,SetupError,provisioningEnvironment} from '../agency/cloudflare.mjs';
const account='a'.repeat(32),other='b'.repeat(32);
const free=[{price:0,state:'Provisioned',rate_plan:{id:'synthetic-workers-free',scope:'workers'}}];

test('provisioning suppresses Wrangler disk/debug outputs and cannot inherit developer fallback credentials or an alternate API destination',()=>{
 const env=provisioningEnvironment({token:'synthetic-agency-token',account},{AGENCY_OAUTH_CLIENT_SECRET:'synthetic-publisher-secret',CLOUDFLARE_API_KEY:'synthetic-unwanted',CF_API_TOKEN:'synthetic-unwanted',WRANGLER_WRITE_LOGS:'true',WRANGLER_LOG_SANITIZE:'false',WRANGLER_LOG:'debug',WRANGLER_OUTPUT_FILE_PATH:'unwanted-file',CLOUDFLARE_API_BASE_URL:'https://unwanted.example'});
 assert.equal(env.AGENCY_OAUTH_CLIENT_SECRET,undefined);
 assert.equal(env.CLOUDFLARE_API_TOKEN,'synthetic-agency-token');assert.equal(env.CLOUDFLARE_ACCOUNT_ID,account);assert.equal(env.CLOUDFLARE_API_BASE_URL,'https://api.cloudflare.com/client/v4');assert.equal(env.WRANGLER_WRITE_LOGS,'false');assert.equal(env.WRANGLER_LOG_SANITIZE,'true');assert.equal(env.WRANGLER_LOG,'error');assert.equal(env.CLOUDFLARE_API_KEY,undefined);assert.equal(env.CF_API_TOKEN,undefined);assert.equal(env.WRANGLER_OUTPUT_FILE_PATH,undefined);
});

test('free-plan preflight rejects empty, ambiguous, paid, trial and zone-Free evidence',()=>{
 assert.equal(freePlan(free,['synthetic-workers-free']),true);
 for(const input of [[],[...free,...free],[{...free[0],price:5}],[{...free[0],state:'Trial'}],[{...free[0],rate_plan:{id:'free',scope:'zone'}}]])assert.equal(freePlan(input,['synthetic-workers-free']),false);
 assert.equal(freePlan(free,[]),false);
});

async function companion(t,{deploy=async()=>({ready:true,website:'https://synthetic.example.workers.dev'}),expires=600,clock=()=>Date.now(),...serviceOptions}={}){
 let origin='',exchange=0,revocations=0;
 const fetcher=async(url,options)=>{
  if(url.endsWith('/token')){exchange++;const body=new URLSearchParams(options.body);assert.ok(body.get('code_verifier'));assert.equal(body.get('redirect_uri'),origin+'/oauth/callback');return Response.json({access_token:'synthetic-oauth-secret',expires_in:expires,refresh_token:'must-not-retain'});}
  if(url.endsWith('/revoke')){revocations++;return new Response(null,{status:200});}
  throw Error('Unexpected network');
 };
 // Reserve an ephemeral port, then construct exact-origin OAuth configuration.
 const {createServer}=await import('node:http');const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));origin='http://127.0.0.1:'+port;
 const server=createCompanion({origin,clientId:'synthetic-client',clientSecret:'synthetic-client-secret',scopes:'synthetic-scope',stateDirectory:join(tmpdir(),'unused-companion-test'),build:'synthetic-build',verifiedFreePlanIds:['synthetic-workers-free'],fetcher,deploy,apiFactory:token=>async path=>{assert.equal(token,'synthetic-oauth-secret');assert.equal(path,'/accounts?per_page=50');return [{id:account,name:'Synthetic agency'}];},runnerFactory:()=>()=>{},now:clock,...serviceOptions});
 await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const request=(path,{cookie='',body,method=body?'POST':'GET',requestOrigin=origin}={})=>fetch(origin+path,{method,redirect:'manual',headers:{Cookie:cookie,Origin:requestOrigin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const begin=async()=>{const r=await request('/oauth/start');assert.equal(r.status,303);const auth=new URL(r.headers.get('Location'));assert.equal(auth.origin,'https://dash.cloudflare.com');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.ok(!auth.search.includes('client_secret'));return {cookie:r.headers.get('Set-Cookie').split(';')[0],state:auth.searchParams.get('state')};};
 const connect=async()=>{const b=await begin();const r=await request('/oauth/callback?state='+b.state+'&code=synthetic-code',{cookie:b.cookie});assert.equal(r.status,303);return r.headers.get('Set-Cookie').split(';')[0];};
 return {origin,request,begin,connect,get exchange(){return exchange;},get revocations(){return revocations;}};
}

test('OAuth binds state to browser, rejects replay, rotates cookies and never returns tokens',async t=>{
 const f=await companion(t),b=await f.begin();
 assert.equal((await f.request('/oauth/callback?state='+b.state+'&code=synthetic')).status,403);
 assert.equal((await f.request('/oauth/callback?state=wrong&code=synthetic',{cookie:b.cookie})).status,403);
 assert.equal(f.exchange,0);
 const r=await f.request('/oauth/callback?state='+b.state+'&code=synthetic',{cookie:b.cookie}),cookie=r.headers.get('Set-Cookie').split(';')[0];assert.notEqual(cookie,b.cookie);
 assert.equal((await f.request('/oauth/callback?state='+b.state+'&code=synthetic',{cookie:b.cookie})).status,403);
 const status=await(await f.request('/api/state',{cookie})).text();assert.match(status,/Synthetic agency/);assert.doesNotMatch(status,/synthetic-oauth-secret|must-not-retain|client-secret/);
 assert.equal((await f.request('/api/state',{cookie:b.cookie})).status,200);assert.equal((await(await f.request('/api/state',{cookie:b.cookie})).json()).connected,false);
});

test('deployment requires authorized account, explicit Free confirmation and same-origin JSON; double clicks share one job',async t=>{
 let unblock,started=0;const pending=new Promise(r=>unblock=r);
 const f=await companion(t,{deploy:async opts=>{started++;assert.equal(opts.account,account);await pending;return {ready:false,website:'https://synthetic.example.workers.dev',ticket:'T'.repeat(43)};}}),cookie=await f.connect();
 const body={account,name:'synthetic-agency',freeConfirmed:true};
 assert.equal((await f.request('/api/deploy',{cookie,body,requestOrigin:'https://evil.example'})).status,403);
 assert.equal((await f.request('/api/deploy',{cookie,body:{...body,account:other}})).status,400);
 assert.equal((await f.request('/api/deploy',{cookie,body:{...body,freeConfirmed:false}})).status,400);
 assert.equal((await f.request('/api/deploy',{cookie,body})).status,202);
 assert.equal((await f.request('/api/deploy',{cookie,body})).status,409);
 assert.equal((await f.request('/api/disconnect',{cookie,body:{}})).status,409);
 assert.equal(started,1);unblock();
 for(let i=0;i<30;i++){if(!(await(await f.request('/api/state',{cookie})).json()).running)break;await new Promise(r=>setTimeout(r,5));}
 const state=await(await f.request('/api/state',{cookie})).json();assert.equal(state.connected,false);assert.equal(state.result.revoked,true);assert.equal(f.revocations,1);
 assert.equal((await f.request('/api/deploy',{cookie,body})).status,401);
});

test('expired OAuth sessions cannot provision and provisioning errors are sanitized',async t=>{
 let time=Date.now();const f=await companion(t,{clock:()=>time,deploy:async()=>{throw Error('private password SQL token');}}),cookie=await f.connect();
 time+=600001;assert.equal((await f.request('/api/deploy',{cookie,body:{account,name:'synthetic-agency',freeConfirmed:true}})).status,401);
 const g=await companion(t,{deploy:async()=>{throw Error('private password SQL token');}}),second=await g.connect();
 await g.request('/api/deploy',{cookie:second,body:{account,name:'synthetic-agency',freeConfirmed:true}});
 const state=await(await g.request('/api/state',{cookie:second})).text();assert.doesNotMatch(state,/private password SQL token/);assert.match(state,/stopped safely/);
});

test('provisioning retries interrupted storage creation, keeps independent bindings and does not persist raw setup tickets',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lt360-provision-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const database=new DatabaseSync(':memory:');t.after(()=>database.close());
 const databases=[],namespaces=[],scripts=[],secrets=[];let lost=true,deploys=0;
 const api=async(path,options={})=>{
  if(path.endsWith('/subscriptions'))return free;
  if(path.endsWith('/workers/subdomain'))return {subdomain:'synthetic-owner'};
  if(path.endsWith('/workers/scripts'))return scripts;
  if(path.includes('/settings')){const config=JSON.parse(await readFile(join(directory,'wrangler.json'),'utf8'));return {bindings:[{name:'INSTALLATION_ID',text:config.vars.INSTALLATION_ID}]};}
  if(path.includes('/d1/database')&&!path.endsWith('/query')){
   if(options.method==='POST'){const d={name:options.body.name,uuid:'11111111-1111-1111-1111-111111111111'};databases.push(d);if(lost){lost=false;throw new SetupError('Synthetic lost create response');}return d;}return databases;
  }
  if(path.includes('/storage/kv/namespaces')){if(options.method==='POST'){const n={title:options.body.title,id:'c'.repeat(32)};namespaces.push(n);return n;}return namespaces;}
  if(path.endsWith('/query')){const sql=options.body.sql;const s=database.prepare(sql);return [{success:true,results:s.columns().length?s.all():(s.run(),[])}];}
  throw Error('Unexpected API: '+path);
 };
 const run=async(args,stdin)=>{
  if(args[0]==='d1'){database.exec(await readFile(args[args.indexOf('--file')+1],'utf8'));return '';}
  if(args[0]==='deploy'){deploys++;const config=JSON.parse(await readFile(join(directory,'wrangler.json'),'utf8'));if(!scripts.length)scripts.push({id:config.name});return '';}
  if(args[1]==='list')return JSON.stringify(secrets);
  if(args[1]==='put'){assert.match(stdin,/^[a-f0-9]{64}$/);secrets.push({name:'GUEST_CODE_KEY'});return '';}
  throw Error('Unexpected command');
 };
 const fetcher=async()=>Response.json({prepared:true,ready:!!database.prepare('SELECT completed FROM agency_setup').get()?.completed,schema:4});
 const options={account,name:'synthetic-agency',directory,api,run,build:'verified-synthetic',verifiedFreePlanIds:['synthetic-workers-free'],fetcher};
 await assert.rejects(provision(options),/lost create/);
 const result=await provision(options);assert.equal(databases.length,1);assert.equal(namespaces.length,1);assert.match(result.ticket,/^[A-Za-z0-9_-]{43}$/);
 const journal=await readFile(join(directory,'installation.json'),'utf8');assert.ok(!journal.includes(result.ticket));
 const config=JSON.parse(await readFile(join(directory,'wrangler.json'),'utf8'));assert.equal(config.account_id,account);assert.equal(config.kv_namespaces[0].id,'c'.repeat(32));assert.equal(config.vars.AGENCY_BROWSER_SETUP,'1');assert.equal(config.observability.logs.enabled,false);
 const again=await provision(options);assert.notEqual(again.ticket,result.ticket);assert.equal(databases.length,1);assert.equal(namespaces.length,1);assert.equal(secrets.length,1);
 for(const stage of ['schema','secret inventory','deployment','network'])await t.test('resume after interrupted '+stage,async()=>{
  let failed=false,healthCalls=0;
  const interrupted={...options,run:async(args,stdin)=>{if(!failed&&((stage==='schema'&&args[0]==='d1')||(stage==='secret inventory'&&args[0]==='secret'&&args[1]==='list')||(stage==='deployment'&&args[0]==='deploy'))){failed=true;throw new SetupError('Synthetic interrupted '+stage);}return run(args,stdin);},fetcher:async()=>{healthCalls++;if(stage==='network'&&healthCalls===2){failed=true;throw new SetupError('Synthetic interrupted network');}return fetcher();}};
  await assert.rejects(provision(interrupted),/interrupted/);assert.equal(failed,true);const healed=await provision(options);assert.match(healed.ticket,/^[A-Za-z0-9_-]{43}$/);assert.equal(databases.length,1);assert.equal(namespaces.length,1);assert.equal(secrets.length,1);assert.equal(database.prepare('SELECT COUNT(*) n FROM staff_accounts').get().n,0);
 });
 await t.test('a foreign Worker identity is never adopted',async()=>{await assert.rejects(provision({...options,api:async(path,opt)=>path.includes('/settings')?{bindings:[{name:'INSTALLATION_ID',text:'f'.repeat(32)}]}:api(path,opt)}),/will not be overwritten/);assert.equal(databases.length,1);assert.equal(namespaces.length,1);});
 database.prepare("INSERT INTO staff_accounts(username,password_verifier,role) VALUES('existing','retained-verifier','administrator')").run();
 const before=deploys;assert.equal((await provision(options)).ready,true);assert.equal(deploys,before);assert.equal(database.prepare('SELECT password_verifier FROM staff_accounts').get().password_verifier,'retained-verifier');
 await t.test('unhealthy initialized install is not migrated, reset or redeployed',async()=>{const previous=await readFile(join(directory,'wrangler.json'));await assert.rejects(provision({...options,fetcher:async()=>Response.json({prepared:false,ready:false,schema:4}),run:()=>assert.fail('Existing installation must not be mutated')}),/No migration or deployment/);assert.deepEqual(await readFile(join(directory,'wrangler.json')),previous);assert.equal(database.prepare('SELECT password_verifier FROM staff_accounts').get().password_verifier,'retained-verifier');});
});

test('failed Free preflight performs no provisioning mutations',async()=>{
 const calls=[];await assert.rejects(provision({account,name:'synthetic-agency',directory:'unused',build:'synthetic',verifiedFreePlanIds:[],api:async path=>{calls.push(path);return free;},run:()=>assert.fail('No command may run')}),/could not be verified/);assert.deepEqual(calls,[`/accounts/${account}/subscriptions`]);
});

test('connected update entry point checks account scope, serializes jobs, revokes authorization and protects backup downloads',async t=>{
 const {mkdir,writeFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
 const dir=await mkdtemp(join(tmpdir(),'lt360-companion-update-'));t.after(()=>rm(dir,{recursive:true,force:true}));const id='d'.repeat(32),install='f'.repeat(32),name='synthetic-agency',directory=join(dir,account,name),file='snapshot-'+'1'.repeat(16)+'.lt360backup',content=Buffer.alloc(16*1024*1024,0xa5);await mkdir(join(directory,'updates',id),{recursive:true});await writeFile(join(directory,'installation.json'),JSON.stringify({account,name,installation:install,database:'synthetic-db'}));await writeFile(join(directory,'updates',id,file),content);
 let releaseJob;const gate=new Promise(r=>releaseJob=r);let calls=0;
 const f=await companion(t,{stateDirectory:dir,releaseBundle:{bytes:Buffer.from('{}'),signature:Buffer.alloc(64)},apiFactory:()=>async(path,opt)=>{if(path==='/accounts?per_page=50')return [{id:account,name:'Synthetic agency'}];assert.match(path,/synthetic-db\/query$/);assert.equal(opt.body.params.at(-1),install);return [{success:true,results:opt.body.sql.includes('backup_file')?[{backup_file:file,backup_digest:createHash('sha256').update(content).digest('hex')}]:[{id,version:'0.2.1',phase:'approved'}]}];},updater:async options=>{calls++;assert.equal(options.directory,directory);assert.equal(options.requestId,id);await gate;return {phase:'complete',website:'https://synthetic.example.workers.dev',requestId:id,backupAvailable:true};}});
 const cookie=await f.connect(),body={account,name,requestId:id};
 assert.equal((await f.request('/api/updates/start',{cookie,body:{...body,account:other}})).status,403);
 assert.equal((await f.request('/api/updates/list',{cookie,body})).status,200);
 const form=(fields,source=f.origin)=>fetch(f.origin+'/api/updates/backup',{method:'POST',headers:{Cookie:cookie,Origin:source},body:new URLSearchParams(fields)});
 assert.equal((await form({...body,account:other})).status,403);
 assert.equal((await form(body,'https://other.invalid')).status,403);
 const interrupted=await form(body);await interrupted.body.cancel();
 const retry=await form(body);assert.equal(retry.headers.get('Cache-Control'),'no-store');
 assert.ok(retry.headers.get('Content-Disposition').includes('LevelTwo360-encrypted-installation.lt360backup'));
 const checksum=createHash('sha256');for await(const chunk of retry.body)checksum.update(chunk);
 assert.equal(checksum.digest('hex'),createHash('sha256').update(content).digest('hex'));
 await writeFile(join(directory,'updates',id,file),'damaged');assert.equal((await form(body)).status,409);
 assert.equal((await f.request('/api/updates/backup?token=anything')).status,404);
 assert.equal((await f.request('/api/updates/start',{cookie,body})).status,202);assert.equal((await f.request('/api/updates/start',{cookie,body})).status,409);assert.equal(calls,1);releaseJob();
 for(let i=0;i<20;i++){if(!(await(await f.request('/api/state',{cookie})).json()).running)break;await new Promise(r=>setTimeout(r,5));}
 assert.equal((await(await f.request('/api/state',{cookie})).json()).result.revoked,true);assert.equal((await f.request('/api/updates/backup',{cookie,body})).status,401);
});
