import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {openInstallation,backUp,restore} from './maintenance.mjs';

const root=resolve(import.meta.dirname,'..');
const path=await mkdtemp(join(tmpdir(),'lt360-official-'));
const assets=join(root,'cloudflare','generated');
const cfg=JSON.parse(await readFile(join(root,'wrangler.jsonc'),'utf8'));
const vars=cfg.vars;
const origin='https://synthetic-agency.test-account.workers.dev';
const restoredOrigin='https://synthetic-recovery.test-account.workers.dev';
const setupCode=()=>randomBytes(32).toString('base64url')+'.'+(Date.now()+1500000);
const code=setupCode(),otherCode=setupCode();
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
  try{return new Response(await readFile(asset),{headers:{'Content-Type':asset.endsWith('.js')?'text/javascript':'text/html'}});}
  catch{return new Response(null,{status:404});}
};
const runtime=(releaseCode,bindings)=>{
  return new Miniflare(convertV4MiniflareOptions({workers:[{
    name:'official','modules':true,script:releaseCode,compatibilityDate:cfg.compatibility_date,
    compatibilityFlags:cfg.compatibility_flags,bindings,
    d1Databases:{DB:dbName},kvNamespaces:{PHOTOS:kv},
    durableObjects:{STAFF_LOGIN:{className:'StaffLogin',useSQLite:true}},
    serviceBindings:{ASSETS:assetApi}
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
try {
  // A raw checkout must stop before any remote command if binding substitution
  // did not happen. Verify the official link targets the approved template URL.
  assert.throws(()=>execFileSync(process.execPath,['official/deploy.mjs'],{cwd:root,stdio:'pipe',windowsHide:true}),error=>
    error.status===1 && error.stderr.toString().includes('stopped before contacting Cloudflare'));
  const template='https://github.com/synthetic-owner/synthetic-template';
  const button=execFileSync(process.execPath,['official/deploy-link.mjs',template],{cwd:root,encoding:'utf8',windowsHide:true});
  assert.equal(new URL(button.trim().match(/\]\((https:\/\/deploy\.workers\.cloudflare\.com\/\?.*)\)$/)[1]).searchParams.get('url'),template);
  // These are the same migration files the official production command uses.
  const local=['d1','migrations','apply','DB','--local','--persist-to',join(path,'d1'), '--config','wrangler.jsonc'];
  assert.match(wrangler(...local),/0006_backup_barrier/);
  assert.match(wrangler(...local),/No migrations to apply/i);
  await mkdir(bundle);
  wrangler('deploy','--dry-run','--config','wrangler.jsonc','--outdir',bundle);
  const source=await readFile(join(bundle,'worker.js'),'utf8');
  const first=runtime(source,{...vars,LT360_SETUP_CODE:code});resources.push(first);
  const second=runtime(source,{...vars,LT360_SETUP_CODE:otherCode});resources.push(second);
  const disabled=runtime(source,vars);resources.push(disabled);
  const expired=runtime(source,{...vars,LT360_SETUP_CODE:randomBytes(32).toString('base64url')+'.'+(Date.now()-1000)});resources.push(expired);
  const site=await toSite(first,origin), target=await toSite(second,restoredOrigin);
  await prepare(site.db);await prepare(target.db);
  await prepare(await disabled.getD1Database('DB'));await prepare(await expired.getD1Database('DB'));
  assert.equal((await expect(first,origin,'/',303)).headers.get('Location'),'/setup');
  assert.match(await (await expect(first,origin,'/setup',200)).text(),/Confirm you control this Cloudflare Worker/);
  await expect(first,origin,'/official/setup.js',200);
  await expect(first,origin,'/api/staff/accounts',503);
  await expect(first,origin,'/api/official/enroll',403,{method:'POST',body:{code:otherCode,username:'outsider',password}});
  await expect(disabled,origin,'/api/official/enroll',403,{method:'POST',body:{code,username:'outsider',password}});
  await expect(expired,origin,'/api/official/enroll',403,{method:'POST',body:{code,username:'outsider',password}});
  await expect(first,origin,'/api/official/enroll',400,{method:'POST',source:'https://outside.example',body:{code,username:'outsider',password}});
  const raced=await Promise.all(['owner','other'].map(username=>send(first,origin,'/api/official/enroll',{method:'POST',body:{code,username,password}})));
  assert.deepEqual(raced.map(item=>item.status).sort(),[200,409]);
  const admin=(await site.query('SELECT username FROM staff_accounts'))[0].username;
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
  assert.deepEqual(await target.query('SELECT * FROM access_history'),savedAudit);
  for(const id of Object.values(photos))assert.deepEqual(await target.readImage(id),await site.readImage(id));
  const newCookie=await login(second,restoredOrigin);
  await expect(second,restoredOrigin,'/api/staff/drafts/'+apartment.id,200,{cookie:newCookie});
  await expect(second,restoredOrigin,'/api/staff/drafts/'+apartment.id,401,{cookie});
  await expect(second,restoredOrigin,'/api/official/enroll',409,{method:'POST',body:{code:otherCode,username:'cannot-reset',password}});
  await expect(second,restoredOrigin,'/api/guest/unlock',200,{method:'POST',body:invitation});
  assert.equal((await target.query('SELECT count(*) n FROM staff_accounts'))[0].n,2);
  // Exercise production API routing against synthetic Cloudflare responses.
  const account='1'.repeat(32);
  const adapter=await openInstallation({account,worker:'synthetic-agency',token:'fixture-only',fetcher:async(url,request)=>{
    assert.match(url,new RegExp('^https://api.cloudflare.com/client/v4/accounts/'+account+'/'));
    assert.equal(request.headers.Authorization,'Bearer fixture-only');
    if(url.endsWith('/subdomain'))return Response.json({success:true,result:{subdomain:'test-account'}});
    if(url.endsWith('/settings'))return Response.json({success:true,result:{bindings:[
      {name:'DB',type:'d1',id:dbName},{name:'PHOTOS',type:'kv_namespace',namespace_id:kv},
      {name:'OFFICIAL_DEPLOY',type:'plain_text',text:'1'},{name:'STAFF_LOGIN',type:'durable_object_namespace',class_name:'StaffLogin'}
    ]}});
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
    const runner=runtime(source,{...vars,LT360_SETUP_CODE:code});resources.push(runner);
    await prepare(await runner.getD1Database('DB'));
    const browser=await chromium.launch();
    try{
      const page=await browser.newPage({viewport:{width:390,height:844}});
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
      await page.goto(origin+'/setup');
      await page.getByRole('button',{name:'Generate setup code'}).click();
      assert.match(await page.locator('#generated').inputValue(),/^[A-Za-z0-9_-]{43}\.\d{13}$/);
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
      assert.deepEqual(failures,[]);
      console.log('Option A Chromium acceptance passed at a 390 px viewport.');
    }finally{await browser.close();}
  }
  console.log('Option A local acceptance passed: Wrangler migrations and retry, real Worker/D1/KV/SQLite Durable Objects, owner-only atomic enrollment, sign-in, private draft/photo upload, verified encrypted recovery, restore retry and isolation, revised Worker with retained data.');
} finally {
  await Promise.allSettled(resources.map(resource=>resource.dispose()));
  await rm(path,{recursive:true,force:true});
}
