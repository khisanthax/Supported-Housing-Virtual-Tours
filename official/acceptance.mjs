import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {execFile,execFileSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {openInstallation,backUp,restore} from './maintenance.mjs';
import {createHelpHub} from '../help-hub/server.mjs';
import {supportInstallationId} from '../cloudflare/support.mjs';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {promisify} from 'node:util';

const root=resolve(import.meta.dirname,'..');
const path=await mkdtemp(join(tmpdir(),'lt360-official-'));
const assets=join(root,'cloudflare','generated');
const cfg=JSON.parse(await readFile(join(root,'wrangler.jsonc'),'utf8'));
const vars=cfg.vars;
const origin='https://synthetic-agency.test-account.workers.dev';
const restoredOrigin='https://synthetic-recovery.test-account.workers.dev';
const setupCode=()=>randomBytes(32).toString('base64url')+'.'+(Date.now()+1500000);
const code=randomBytes(32).toString('base64url'),otherCode=setupCode();
const password='Synthetic setup test password only';
const bundle=join(path,'bundle');
const migrationPath=join(root,'official','migrations');
const migrations=(await readdir(migrationPath)).sort();
const dbName=cfg.d1_databases[0].database_id;
const kv=cfg.kv_namespaces[0].id;
const wrangler=(...args)=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{
  cwd:root,env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:join(path,'wrangler.log')},
  encoding:'utf8',windowsHide:true
});
const assetApi=async request=>{
  const asset=resolve(assets,'.'+new URL(request.url).pathname);
  if (!asset.startsWith(assets+sep))return new Response(null,{status:404});
  try{return new Response(await readFile(asset),{headers:{'Content-Type':asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':'text/html'}});}
  catch{return new Response(null,{status:404});}
};
const runtime=(releaseCode,bindings,outboundService)=>{
  return new Miniflare(convertV4MiniflareOptions({workers:[{
    name:'official','modules':true,script:releaseCode,compatibilityDate:cfg.compatibility_date,
    compatibilityFlags:cfg.compatibility_flags,bindings,
    d1Databases:{DB:dbName},kvNamespaces:{PHOTOS:kv},
    durableObjects:{STAFF_LOGIN:{className:'StaffLogin',useSQLite:true}},
    serviceBindings:{ASSETS:assetApi},outboundService
  }]}));
};
const prepare=async db=>{
  for (const name of migrations) {
    const sql=(await readFile(join(migrationPath,name),'utf8')).replace(/^\s*--.*$/gm,'').replace(/\r?\n/g,' ');
    await db.exec(sql);
  }
};
const send=async(mf,host,url,{method='GET',body,contentType='application/json',cookie='',source=host}={})=>
  mf.dispatchFetch(host+url,{method,redirect:'manual',headers:{Origin:source,'Content-Type':contentType,Cookie:cookie},
    ...(body===undefined?{}:{body:contentType==='application/json'?JSON.stringify(body):body})});
const expect=async(mf,host,url,status,options)=>{
  const reply=await send(mf,host,url,options);
  assert.equal(reply.status,status,url+' '+(reply.status===status?'':await reply.clone().text()));
  return reply;
};
const toSite=async (mf,siteOrigin)=>{
  const db=await mf.getD1Database('DB');
  const photos=await mf.getKVNamespace('PHOTOS');
  return {
    origin:siteOrigin,db,photos,
    query:async(sql,params=[])=>(await db.prepare(sql).bind(...params).all()).results,
    async *listImages(){yield* (await photos.list()).keys;},
    readImage:async(key)=>{
      const value=await photos.get(key,'arrayBuffer');
      if(value===null)throw Object.assign(Error('Missing image'),{status:404});
      return Buffer.from(value);
    },
    writeImage:(key,bytes)=>photos.put(key,bytes)
  };
};
const resources=[];
let hub;
try {
  // A raw checkout must stop before any remote command if binding substitution
  // did not happen. Verify the official link targets the approved template URL.
  assert.throws(()=>execFileSync(process.execPath,['official/deploy.mjs'],{cwd:root,stdio:'pipe',windowsHide:true}),error=>
    error.status===1 && error.stderr.toString().includes('stopped before contacting Cloudflare'));
  const template='https://github.com/synthetic-owner/synthetic-template';
  const {verifiedButton}=await import('./deploy-link.mjs');
  const tree='a'.repeat(40);
  const publicHead=async url=>{
    assert.equal(url,'https://api.github.com/repos/synthetic-owner/synthetic-template/commits/HEAD');
    return Response.json({commit:{tree:{sha:tree}}});
  };
  const button=await verifiedButton(template,tree,publicHead);
  await assert.rejects(verifiedButton(template+'/tree/codex%2Fofficial-deploy',tree,publicHead),/repository root/);
  await assert.rejects(verifiedButton(template,'b'.repeat(40),publicHead),/differ/);
  await assert.rejects(verifiedButton(template,tree,async()=>new Response(null,{status:404})),/404/);
  assert.equal(new URL(button.trim().match(/\]\((https:\/\/deploy\.workers\.cloudflare\.com\/\?.*)\)$/)[1]).searchParams.get('url'),template);
  // These are the same migration files the official production command uses.
  const local=['d1','migrations','apply','DB','--local','--persist-to',join(path,'d1'), '--config','wrangler.jsonc'];
  assert.match(wrangler(...local),/0006_backup_barrier/);
  assert.match(wrangler(...local),/No migrations to apply/i);
  await mkdir(bundle);
  wrangler('deploy','--dry-run','--config','wrangler.jsonc','--outdir',bundle);
  const source=await readFile(join(bundle,'worker.js'),'utf8');
  const hubOrigin='https://help.synthetic.invalid';
  const hubTokens=[0,1].map(()=>randomBytes(32).toString('base64url'));
  let hubUrl;
  let hubOutboundError;
  const hubOutbound=async request=>{
    assert.equal(new URL(request.url).origin,hubOrigin);
    try {
      const result=await fetch(hubUrl+'/agency/tickets',{method:request.method,headers:{
        Authorization:request.headers.get('authorization'),'Content-Type':'application/json'
      },body:request.method==='POST'?await request.text():undefined});
      if(!result.ok)hubOutboundError='Hub returned '+result.status+' '+await result.clone().text();
      return result;
    } catch(error) {
      hubOutboundError=error.message;
      return new Response(null,{status:503});
    }
  };
  const supportVars=index=>({...vars,SUPPORT_ENABLED:'1',SUPPORT_HUB_ORIGIN:hubOrigin,SUPPORT_HUB_TOKEN:hubTokens[index]});
  const first=runtime(source,{...supportVars(0),LT360_INSTALL_KEY:code},hubOutbound);resources.push(first);
  const second=runtime(source,{...vars,LT360_SETUP_CODE:otherCode,SUPPORT_ENABLED:'1'});resources.push(second);
  const disabled=runtime(source,vars);resources.push(disabled);
  const expired=runtime(source,{...vars,LT360_INSTALL_KEY:code});resources.push(expired);
  const site=await toSite(first,origin), target=await toSite(second,restoredOrigin);
  await prepare(site.db);await prepare(target.db);
  await prepare(await disabled.getD1Database('DB'));await prepare(await expired.getD1Database('DB'));
  assert.equal((await expect(first,origin,'/',303)).headers.get('Location'),'/setup');
  assert.match(await (await expect(first,origin,'/setup',200)).text(),/temporary key you saved in Cloudflare/);
  await expect(first,origin,'/official/setup.js',200);
  await expect(first,origin,'/api/staff/accounts',503);
  await expect(first,origin,'/api/official/enroll',403,{method:'POST',body:{code:otherCode,username:'outsider',password}});
  await expect(disabled,origin,'/api/official/enroll',403,{method:'POST',body:{code,username:'outsider',password}});
  await expect(first,origin,'/api/official/enroll',400,{method:'POST',source:'https://outside.example',body:{code,username:'outsider',password}});
  assert.equal((await site.query('SELECT count(*) n FROM staff_accounts'))[0].n,0);
  assert.equal((await site.query('SELECT count(*) n FROM official_installation'))[0].n,0);
  const expiredDb=await expired.getD1Database('DB');
  const initialExpiry=(await expiredDb.prepare('SELECT expires FROM official_setup_window').first()).expires;
  assert.ok(initialExpiry>Date.now()+59*60000 && initialExpiry<=Date.now()+60*60000);
  await expiredDb.exec('UPDATE official_setup_window SET expires=0');
  await prepare(expiredDb);
  await expect(expired,origin,'/api/official/enroll',403,{method:'POST',body:{code,username:'outsider',password}});
  const raced=await Promise.all(['owner','other'].map(username=>send(first,origin,'/api/official/enroll',{method:'POST',body:{code,username,password}})));
  assert.deepEqual(raced.map(item=>item.status).sort(),[200,409]);
  const admin=(await site.query('SELECT username FROM staff_accounts'))[0].username;
  assert.ok(!JSON.stringify(await site.query('SELECT * FROM staff_accounts')).includes(password));
  assert.ok(!JSON.stringify(await site.query('SELECT * FROM official_installation')).includes(code));
  assert.equal((await site.query('SELECT count(*) n FROM staff_accounts'))[0].n,1);
  await expect(first,restoredOrigin,'/staff',403);
  await expect(second,restoredOrigin,'/api/official/enroll',403,{method:'POST',body:{code,username:'outsider',password}});
  const login=async(mf,host)=>{
    const reply=await expect(mf,host,'/api/staff/sign-in',200,{method:'POST',body:{username:admin,password}});
    return reply.headers.get('Set-Cookie').split(';')[0];
  };
  const cookie=await login(first,origin);
  const tour=JSON.parse(await readFile(join(root,'cloudflare','sample.json'),'utf8'));
  const photos={};
  for (const room of tour.rooms) {
    const image=await readFile(join(root,'cloudflare','sample-images',room.id+'.jpg'));
    const reply=await expect(first,origin,'/api/staff/photos',201,{method:'POST',cookie,contentType:'image/jpeg',body:image});
    photos[room.id]=(await reply.json()).id;
  }
  const apartment=await (await expect(first,origin,'/api/staff/apartments',201,{method:'POST',cookie,body:{tour,photos}})).json();
  await expect(first,origin,'/api/staff/accounts',201,{method:'POST',cookie,body:{username:'synthetic-editor',role:'editor',password:'Synthetic editor test password'}});
  const editor=await expect(first,origin,'/api/staff/sign-in',200,{method:'POST',body:{username:'synthetic-editor',password:'Synthetic editor test password'}});
  await expect(first,origin,'/api/staff/accounts',403,{cookie:editor.headers.get('Set-Cookie').split(';')[0]});
  await expect(first,origin,'/api/support/admin',403,{cookie:editor.headers.get('Set-Cookie').split(';')[0]});
  const supportBOrigin='https://synthetic-agency-b.test-account.workers.dev';
  const supportB=runtime(source,{...supportVars(1),LT360_INSTALL_KEY:code},hubOutbound);resources.push(supportB);
  const supportBDb=await supportB.getD1Database('DB');
  await prepare(supportBDb);
  await expect(supportB,supportBOrigin,'/api/official/enroll',200,{method:'POST',body:{code,username:admin,password}});
  const supportBCookie=await login(supportB,supportBOrigin);
  const sharedRecoveryId=(await site.db.prepare('SELECT installation_id FROM official_installation').first()).installation_id;
  await supportBDb.prepare('UPDATE official_installation SET installation_id=?').bind(sharedRecoveryId).run();
  const agencyIds=[origin,supportBOrigin].map(agencyOrigin=>supportInstallationId(sharedRecoveryId,agencyOrigin));
  assert.notEqual(agencyIds[0],agencyIds[1]);
  const hubDb=join(path,'help-hub.sqlite');
  const ownerToken=randomBytes(32).toString('base64url');
  const approvalToken=randomBytes(32).toString('base64url');
  const portProbe=createServer().listen(0,'127.0.0.1');
  await once(portProbe,'listening');
  const hubPort=portProbe.address().port;
  await new Promise(resolve=>portProbe.close(resolve));
  hubUrl='http://127.0.0.1:'+hubPort;
  hub=createHelpHub({database:hubDb,ownerToken,key:randomBytes(32).toString('base64url'),
    ownerApproval:{origin:hubUrl,token:approvalToken},
    agencies:[origin,supportBOrigin].map((origin,index)=>({id:agencyIds[index],origin,label:index?'Agency B':'Agency A',token:hubTokens[index]})),
    fetchAgency:(url,init)=>(new URL(url).origin===origin?first:supportB).dispatchFetch(url,init)
  });
  hub.listen(hubPort,'127.0.0.1');
  await once(hub,'listening');
  const rpc=async(method,params={},token=ownerToken)=>{
    const reply=await fetch(hubUrl+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    if(!reply.ok)return {status:reply.status};
    return (await reply.json()).result;
  };
  const call=async(name,arguments_,blocked=false)=>{
    const reply=await rpc('tools/call',{name,arguments:arguments_});
    assert.equal(Boolean(reply.isError),blocked,name+' '+(reply.isError?reply.content[0].text:''));
    return reply.isError?reply.content[0].text:JSON.parse(reply.content[0].text);
  };
  const supportPost=(mf,host,route,session,body,status=200)=>expect(mf,host,'/api/support/'+route,status,{method:'POST',cookie:session,body});
  const createSupport=async(mf,host,session,permissions=['diagnostics'],apartments=[],issue)=>(
    await supportPost(mf,host,'admin',session,{hours:2,permissions,apartments,issue},201)).json();
  const a=await createSupport(first,origin,cookie,['diagnostics','apartments','reset-diagnostics'],[apartment.id],'Synthetic diagnostic repair');
  const b=await createSupport(supportB,supportBOrigin,supportBCookie,['diagnostics'],[],'Synthetic diagnostics review');
  assert.equal(a.ticket,'LT-001',hubOutboundError??'Agency did not receive a Hub ticket.');
  assert.equal(b.ticket,'LT-002');
  assert.match(a.key,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(a.grant.expires,null);
  assert.deepEqual(await rpc('tools/list',{},hubTokens[0]),{status:401});
  assert.equal((await rpc('initialize',{protocolVersion:'2025-11-25'})).serverInfo.name,'leveltwo360-help-hub');
  assert.ok((await rpc('tools/list')).tools.some(tool=>tool.name==='activate_support'));
  assert.deepEqual((await call('list_requests',{})).map(entry=>entry.agency),['Agency A','Agency B']);
  assert.equal((await call('get_request',{ticket:a.ticket})).status,'pending');
  const approvalUrl=hubUrl+'/owner/approve/'+a.ticket;
  assert.ok((await call('activate_support',{ticket:a.ticket},true)).includes(approvalUrl));
  assert.equal((await site.query('SELECT activated FROM support_grants WHERE id=?',[a.grant.id]))[0].activated,null);
  const approvalPage=await fetch(approvalUrl);
  assert.match(await approvalPage.text(),/Approve LT-001/);
  assert.match(approvalPage.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const approve=(credential,source=hubUrl)=>fetch(approvalUrl,{method:'POST',headers:{Origin:source},
    body:new URLSearchParams({credential})});
  assert.equal((await approve(ownerToken)).status,403);
  assert.equal((await approve(approvalToken,'https://untrusted.example')).status,403);
  assert.equal((await approve(approvalToken)).status,200);
  assert.equal((await site.query('SELECT activated FROM support_grants WHERE id=?',[a.grant.id]))[0].activated,null);
  assert.match(await call('activate_support',{ticket:b.ticket},true),/owner approval/);
  const activations=await Promise.all([0,1].map(()=>rpc('tools/call',{name:'activate_support',arguments:{ticket:a.ticket}})));
  assert.equal(activations.filter(reply=>!reply.isError).length,1);
  const active=await call('get_support_session',{ticket:a.ticket});
  assert.equal(active.expires-active.activated,7200000);
  await supportPost(first,origin,'activate','',{key:a.key},403);
  await supportPost(supportB,supportBOrigin,'activate','',{key:a.key},403);
  assert.equal((await call('inspect_apartment',{ticket:a.ticket,apartment:apartment.id})).id,apartment.id);
  await call('inspect_apartment',{ticket:a.ticket,apartment:'ab'.repeat(16)},true);
  await call('view_settings',{ticket:a.ticket},true);
  await site.query("UPDATE diagnostic_settings SET level='off' WHERE id=1");
  assert.equal((await call('view_diagnostics',{ticket:a.ticket})).level,'off');
  assert.deepEqual(await call('reset_diagnostics',{ticket:a.ticket}),{ok:true});
  assert.equal((await call('view_diagnostics',{ticket:a.ticket})).level,'normal');
  const pending=await call('request_more_time',{ticket:a.ticket});
  const more=await (await supportPost(first,origin,'admin/'+a.grant.id+'/extension',cookie,{approve:true,hours:24,requested:pending.requested})).json();
  assert.equal(more.expires-active.expires,86400000);
  assert.deepEqual(more.permissions,active.permissions);
  assert.deepEqual(more.apartments,active.apartments);
  await call('send_note',{ticket:a.ticket,note:'Synthetic repair completed.'});
  assert.deepEqual((await (await expect(supportB,supportBOrigin,'/api/support/admin/tickets',200,{cookie:supportBCookie})).json()).tickets.map(item=>item.ticket),[b.ticket]);
  assert.ok((await (await expect(first,origin,'/api/support/admin/tickets',200,{cookie})).json()).tickets[0].history.some(entry=>entry.note==='Synthetic repair completed.'));
  await supportPost(first,origin,'admin/'+a.grant.id+'/revoke',cookie,{});
  await call('view_diagnostics',{ticket:a.ticket},true);
  assert.equal((await call('get_request',{ticket:a.ticket})).status,'closed');
  execFileSync(process.execPath,['help-hub/server.mjs','approve',b.ticket],{cwd:root,env:{...process.env,LT360_HUB_DB:hubDb}});
  await call('activate_support',{ticket:b.ticket});
  await call('reset_diagnostics',{ticket:b.ticket},true);
  const waiting=await call('request_more_time',{ticket:b.ticket});
  const denied=await (await supportPost(supportB,supportBOrigin,'admin/'+b.grant.id+'/extension',supportBCookie,{approve:false,requested:waiting.requested})).json();
  assert.equal(denied.expires,waiting.expires);
  const renewed=await call('request_more_time',{ticket:b.ticket});
  await supportBDb.prepare('UPDATE support_grants SET expires=0 WHERE id=?').bind(b.grant.id).run();
  await supportPost(supportB,supportBOrigin,'admin/'+b.grant.id+'/extension',supportBCookie,{approve:true,hours:2,requested:renewed.requested},409);
  await call('get_support_session',{ticket:b.ticket},true);
  const localGrant=await createSupport(first,origin,cookie);
  const fallback=await Promise.all([0,1].map(()=>send(first,origin,'/api/support/activate',{method:'POST',body:{key:localGrant.key}})));
  assert.deepEqual(fallback.map(reply=>reply.status).sort(),[200,403]);
  const fallbackCookie=fallback.find(reply=>reply.ok).headers.get('set-cookie').split(';')[0];
  await expect(first,origin,'/api/staff/dashboard',401,{cookie:fallbackCookie});
  await expect(supportB,supportBOrigin,'/api/support/session',401,{cookie:fallbackCookie});
  await supportPost(first,origin,'end',fallbackCookie,{});
  await expect(first,origin,'/api/support/session',401,{cookie:fallbackCookie});
  const unused=await createSupport(first,origin,cookie);
  await site.query('UPDATE support_grants SET redeem_by=0 WHERE id=?',[unused.grant.id]);
  await supportPost(first,origin,'activate','',{key:unused.key},403);
  assert.ok(!(await readFile(hubDb)).includes(a.key));
  const records=JSON.stringify([await site.query('SELECT * FROM support_grants'),await site.query('SELECT * FROM support_audit')]);
  assert.ok(!records.includes(a.key)&&!records.includes(localGrant.key)&&!records.includes(fallbackCookie.split('=')[1]));
  for(const name of ['diagnostics_reset','extension_approved','revoked','ended'])assert.ok(records.includes(name));
  if(process.argv.includes('--codex')){
    const cliGrant=await createSupport(first,origin,cookie,['diagnostics','reset-diagnostics'],[],'Synthetic CLI rehearsal');
    const runCodex=async(prompt,expected)=>{
      const child=promisify(execFile)('codex',['exec','--ephemeral','--ignore-user-config','--sandbox','read-only','--json',
        '-c','shell_environment_policy.inherit="none"',
        '-c','mcp_servers.leveltwo360.url="'+hubUrl+'/mcp"',
        '-c','mcp_servers.leveltwo360.bearer_token_env_var="LT360_HUB_TEST_TOKEN"',
        '-c','mcp_servers.leveltwo360.default_tools_approval_mode="approve"',
        '-c','mcp_servers.leveltwo360.required=true',prompt],
      {cwd:root,env:{...process.env,LT360_HUB_TEST_TOKEN:ownerToken},timeout:120000,windowsHide:true});
      child.child.stdin.end();
      const {stdout}=await child;
      const actual=stdout.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line))
        .filter(event=>event.type==='item.completed'&&event.item.type==='mcp_tool_call'&&event.item.server==='leveltwo360')
        .map(event=>event.item);
      assert.deepEqual(actual.map(item=>item.tool),expected);
      for(const item of actual)assert.ok(item.status==='completed'&&!item.result?.isError,
        item.tool+' failed: '+JSON.stringify(item.error??item.result));
    };
    await runCodex('Check LevelTwo360 help requests. Call only the list_requests MCP tool and report the tickets.', ['list_requests']);
    assert.equal((await call('get_request',{ticket:cliGrant.ticket})).status,'pending');
    execFileSync(process.execPath,['help-hub/server.mjs','approve',cliGrant.ticket],{cwd:root,env:{...process.env,LT360_HUB_DB:hubDb}});
    await runCodex('Activate '+cliGrant.ticket+' using leveltwo360 activate_support. Then call view_diagnostics, reset_diagnostics, and end_support on that same ticket in that order, and report results. Use only those four tools.',
      ['activate_support','view_diagnostics','reset_diagnostics','end_support']);
    assert.equal((await call('get_request',{ticket:cliGrant.ticket})).status,'closed');
    console.log('Authenticated Codex CLI discovery, activation, diagnosis, repair and closure passed through the running Help Hub.');
  }
  await new Promise(resolve=>hub.close(resolve));
  hub=null;
  const offline=await createSupport(first,origin,cookie,['diagnostics'],[],'Synthetic Hub outage');
  assert.match(offline.hubError,/did not confirm/);
  await supportPost(first,origin,'activate','',{key:offline.key});
  console.log('Phase B acceptance passed: authenticated Help Hub HTTP/MCP, two isolated Workers, approval and concurrent redemption, scoped diagnosis and repair, extensions, notes, revocation, expiry, and offline fallback.');
  await expect(first,origin,'/api/staff/apartments/'+apartment.id,200,{method:'PATCH',cookie,body:{action:'publish',expectedVersion:apartment.version}});
  // The fixture KV is immediately coherent. Skip only the production wait.
  await site.query('UPDATE versions SET available=0 WHERE apartment=?',[apartment.id]);
  const share=await (await expect(first,origin,'/api/staff/shares',201,{method:'POST',cookie,body:{
    apartments:[apartment.id],expires:Date.now()+300000,wordCount:3
  }})).json();
  const invitation={token:new URL(share.url).hash.slice(1),code:share.code};
  await expect(first,origin,'/api/guest/unlock',200,{method:'POST',body:invitation});
  await site.query("INSERT INTO uac_policy(key,value,changed_by,changed_at) VALUES('sharing.enabled',1,?,?)",[admin,Date.now()]);
  const savedAudit=await site.query('SELECT * FROM access_history');
  await prepare(site.db); // Same release reapplied to existing records.
  assert.equal((await expect(first,origin,'/setup',303)).headers.get('Location'),'/staff');
  await expect(first,origin,'/api/official/enroll',409,{method:'POST',body:{code,username:'cannot-reset',password}});
  // Reload an additive revision into the same D1 and KV bindings.
  await site.query('CREATE INDEX IF NOT EXISTS synthetic_updated_index ON photos(ready)');
  const pair=generateKeyPairSync('rsa',{modulusLength:3072});
  const backup=join(path,'installation.lt360backup');
  const options={path:backup,publicKey:pair.publicKey.export({format:'jwk'})};
  const getImage=site.readImage;
  const missing=Object.values(photos)[0];
  await assert.rejects(backUp({...site,readImage:key=>key===missing?Promise.reject(Object.assign(Error('unavailable'),{retryable:false})):getImage(key)},{...options,path:join(path,'incomplete.lt360backup')}),/required apartment photo/);
  let checkedPause=false;
  const receipt=await backUp({...site,readImage:async key=>{
    if(!checkedPause){
      checkedPause=true;
      await expect(first,origin,'/api/staff/apartments',503,{method:'POST',cookie,body:{tour,photos}});
      await assert.rejects(site.query("UPDATE staff_accounts SET revision=revision+1"),/LT360_BACKUP/);
    }
    return getImage(key);
  }},options);
  assert.ok(receipt.restoreVerified && checkedPause);
  assert.equal(receipt.images,Object.keys(photos).length);
  const recovery={path:backup,privateKey:pair.privateKey.export({format:'jwk'}),expectedDigest:receipt.sha256};
  // Restore on the matching schema. A failed write leaves the new URL closed;
  // the same backup can resume without deleting successfully transferred data.
  await assert.rejects(restore(target,recovery),/same reviewed database schema/);
  await target.query('CREATE INDEX IF NOT EXISTS synthetic_updated_index ON photos(ready)');
  await assert.rejects(restore(target,{...recovery,expectedDigest:'f'.repeat(64)}),/SHA-256/);
  const wrongKey=generateKeyPairSync('rsa',{modulusLength:3072}).privateKey.export({format:'jwk'});
  await assert.rejects(restore(target,{...recovery,privateKey:wrongKey}));
  assert.equal((await target.query('SELECT count(*) n FROM official_restore'))[0].n,0);
  await assert.rejects(restore(site,recovery),/fresh destination/);
  let failed=false;
  await assert.rejects(restore({...target,writeImage:async(key,bytes)=>{
    if(failed)throw Error('Synthetic interrupted transfer');
    failed=true;await target.writeImage(key,bytes);throw Error('Synthetic interrupted transfer');
  }},recovery),/interrupted transfer/);
  await expect(second,restoredOrigin,'/setup',503);
  await restore(target,recovery);await restore(target,recovery);
  assert.equal((await target.query('SELECT count(*) n FROM support_grants'))[0].n,0);
  assert.ok((await target.query('SELECT count(*) n FROM support_audit'))[0].n>0);
  assert.deepEqual(await target.query('SELECT * FROM access_history'),savedAudit);
  for(const id of Object.values(photos))assert.deepEqual(await target.readImage(id),await site.readImage(id));
  const newCookie=await login(second,restoredOrigin);
  const restoredSupport=await (await expect(second,restoredOrigin,'/api/support/admin',200,{cookie:newCookie})).json();
  assert.notEqual(restoredSupport.installation,(await (await expect(first,origin,'/api/support/admin',200,{cookie})).json()).installation);
  assert.equal(restoredSupport.grants.length,0);
  assert.ok(restoredSupport.events.some(event=>event.event==='activated'&&event.restored));
  await expect(second,restoredOrigin,'/api/staff/drafts/'+apartment.id,200,{cookie:newCookie});
  await expect(second,restoredOrigin,'/api/staff/drafts/'+apartment.id,401,{cookie});
  await expect(second,restoredOrigin,'/api/official/enroll',409,{method:'POST',body:{code:otherCode,username:'cannot-reset',password}});
  await expect(second,restoredOrigin,'/api/guest/unlock',200,{method:'POST',body:invitation});
  assert.equal((await target.query('SELECT count(*) n FROM staff_accounts'))[0].n,2);
  // Exercise production API routing against synthetic Cloudflare responses.
  const account='1'.repeat(32);
  const activeWorker='00000000-0000-0000-0000-000000000012';
  const adapter=await openInstallation({account,worker:'synthetic-agency',token:'fixture-only',fetcher:async(url,request)=>{
    assert.match(url,new RegExp('^https://api.cloudflare.com/client/v4/accounts/'+account+'/'));
    assert.equal(request.headers.Authorization,'Bearer fixture-only');
    if(url.endsWith('/subdomain'))return Response.json({success:true,result:{subdomain:'test-account'}});
    if(url.endsWith('/deployments'))return Response.json({success:true,result:{deployments:[
      {created_on:'2026-11-01T00:00:00Z',versions:[{version_id:'00000000-0000-0000-0000-000000000011',percentage:100}]},
      {created_on:'2026-11-02T00:00:00Z',versions:[{version_id:activeWorker,percentage:100}]}
    ]}});
    if(url.endsWith('/versions/'+activeWorker))return Response.json({success:true,result:{resources:{bindings:[
      {name:'DB',type:'d1',id:dbName},{name:'PHOTOS',type:'kv_namespace',namespace_id:kv},
      {name:'OFFICIAL_DEPLOY',type:'plain_text',text:'1'},{name:'STAFF_LOGIN',type:'durable_object_namespace',class_name:'StaffLogin'}
    ]}}});
    const input=JSON.parse(request.body);
    assert.ok(url.endsWith('/d1/database/'+dbName+'/query'));
    return Response.json({success:true,result:[{success:true,results:await site.query(input.sql,input.params)}]});
  }});
  assert.equal(adapter.origin,origin);
  assert.match((await adapter.query('SELECT origin FROM official_installation'))[0].origin,/synthetic-agency/);
  // A genuinely different Worker deployment reuses the same storage. Miniflare
  // reloads Worker modules over its current namespace bindings.
  const upgraded=source.replace('version: "0.2.0"','version: "0.2.1"');
  assert.notEqual(upgraded,source);
  const swap=script=>first.setOptions(convertV4MiniflareOptions({workers:[{
    name:'official',modules:true,script,compatibilityDate:cfg.compatibility_date,
    compatibilityFlags:cfg.compatibility_flags,bindings:vars,d1Databases:{DB:dbName},
    kvNamespaces:{PHOTOS:kv},durableObjects:{STAFF_LOGIN:{className:'StaffLogin',useSQLite:true}},
    serviceBindings:{ASSETS:assetApi}
  }]}));
  await swap(upgraded);
  const upgradeCookie=await login(first,origin);
  const version=await (await expect(first,origin,'/api/staff/version',200,{cookie:upgradeCookie})).json();
  assert.equal(version.version,'0.2.1');
  await expect(first,origin,'/api/staff/drafts/'+apartment.id,200,{cookie:upgradeCookie});
  await swap(source);
  const rolledBackCookie=await login(first,origin);
  assert.equal((await (await expect(first,origin,'/api/staff/version',200,{cookie:rolledBackCookie})).json()).version,'0.2.0');
  await expect(first,origin,'/api/staff/drafts/'+apartment.id,200,{cookie:rolledBackCookie});
  if(process.argv.includes('--browser')){
    const {chromium}=await import('playwright');
    const runner=runtime(source,{...vars,LT360_INSTALL_KEY:code,SUPPORT_ENABLED:'1'});resources.push(runner);
    await prepare(await runner.getD1Database('DB'));
    const browser=await chromium.launch();
    try{
      const page=await browser.newPage({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});
      const failures=[];
      page.on('pageerror',error=>failures.push(error.message));
      await page.route('**/*',async route=>{
        const request=route.request();
        if(new URL(request.url()).origin!==origin)return route.abort();
        const response=await runner.dispatchFetch(request.url(),{
          method:request.method(),headers:await request.allHeaders(),redirect:'manual',
          ...(request.postDataBuffer()?{body:request.postDataBuffer()}:{})
        });
        return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
      });
      const landing=await runner.dispatchFetch(origin+'/',{redirect:'manual'});
      assert.equal(landing.status,303);
      assert.equal(landing.headers.get('Location'),'/setup');
      await page.goto(new URL(landing.headers.get('Location'),origin).href);
      assert.equal(await page.locator('#configure').getAttribute('open'),null);

      await page.locator('input[name=code]').fill(code);
      await page.getByLabel('Username').fill('browser-owner');
      await page.getByLabel('Password',{exact:true}).fill(password);
      await page.getByLabel('Repeat password').fill(password);
      await page.getByRole('button',{name:'Create Administrator'}).click();
      await page.getByRole('heading',{name:'LevelTwo360 is ready'}).waitFor();
      assert.equal(await page.locator('input[name=password]').inputValue(),'');
      assert.equal(await page.locator('#generated').inputValue(),'');
      assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
      await page.getByRole('link',{name:'Sign in to LevelTwo360'}).click();
      await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
      await page.evaluate(async password=>{
        const result=await fetch('/api/staff/sign-in',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'browser-owner',password})});
        if(!result.ok)throw Error('Synthetic browser sign-in failed.');
      },password);
      await page.goto(origin+'/staff/support');
      await page.getByRole('heading',{name:'Request Technical Support'}).waitFor();
      assert.equal(await page.getByLabel('Duration',{exact:true}).inputValue(),'2');
      await page.getByRole('button',{name:'Generate support key'}).click();
      await page.locator('#issued').waitFor();
      const supportKey=await page.locator('#key').textContent();
      await page.getByRole('button',{name:'Copy Key'}).click();
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),supportKey);
      await page.evaluate(()=>navigator.clipboard.writeText(''));
      const pdfEvent=page.waitForEvent('download');
      await page.getByRole('button',{name:'Download PDF'}).click();
      const pdf=await readFile(await (await pdfEvent).path(),'ascii');
      assert.ok(pdf.startsWith('%PDF-1.4')&&pdf.includes(supportKey)&&pdf.includes('/support')&&pdf.includes('approved secure channel'));
      await page.getByRole('button',{name:'Hide key'}).click();
      assert.equal(await page.locator('#key').textContent(),'');
      await page.goto(origin+'/support');
      await page.locator('input[name=key]').fill(supportKey);
      await page.getByRole('button',{name:'Activate Support'}).click();
      await page.locator('#session').waitFor();
      assert.match(await page.locator('#remaining').textContent(),/Time remaining/);
      await page.getByRole('button',{name:'Request More Time'}).click();
      await page.getByRole('button',{name:'End Support'}).click();
      await page.locator('#activation').waitFor();
      assert.deepEqual(failures,[]);
      await page.unrouteAll({behavior:'wait'});
      console.log('Option A and Phase B Chromium acceptance passed at a 390 px viewport, including clipboard, PDF and support countdown.');
    }finally{await browser.close();}
  }
  console.log('Option A local acceptance passed: Wrangler migrations and retry, real Worker/D1/KV/SQLite Durable Objects, owner-only atomic enrollment, sign-in, private draft/photo upload, verified encrypted recovery, restore retry and isolation, revised Worker with retained data.');
} finally {
  if(hub)await new Promise(resolve=>hub.close(resolve));
  await Promise.allSettled(resources.map(resource=>resource.dispose()));
  await rm(path,{recursive:true,force:true});
}
