import {createHash,randomBytes,generateKeyPairSync} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile,mkdtemp,readFile,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createSnapshot,verifySnapshot,snapshotSchema} from './snapshot.mjs';

class MaintenanceError extends Error {}

async function protectedOutput(file){
  const checkout=(await realpath(resolve(import.meta.dirname,'..'))).toLowerCase();
  const directory=(await realpath(dirname(resolve(file)))).toLowerCase();
  if(directory===checkout||directory.startsWith(checkout+sep))
    throw new MaintenanceError('Save key and backup output outside this source checkout in approved storage.');
}

const id = /^[a-f0-9]{32}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const name = /^[a-z0-9][a-z0-9-]{0,62}$/;
const digest = /^[a-f0-9]{64}$/;
const quote = value => '"' + value.replaceAll('"','""') + '"';
const skip = new Set(['official_installation','official_restore','official_setup_window','app_migrations','sessions','staff_sessions','firebase_staff_sessions','attempts','diagnostic_operations','diagnostic_daily']);
const parentOrder = ['staff_accounts','firebase_staff_accounts','photos','shares'];
const initialRows = {
  uploads_gallery: [{id:1,apartments:'[]',revision:0,changed_by:'migration',changed_at:0}],
  diagnostic_settings: [{id:1,level:'normal',days:7,max_rows:2000}]
};

export async function openInstallation({account,worker,token,fetcher=fetch}){
  if (!id.test(account??'') || !name.test(worker??'') || !token) throw new MaintenanceError('Provide the account ID, Worker name and an agency-scoped Cloudflare token through a protected environment.');
  const root = 'https://api.cloudflare.com/client/v4/accounts/'+account;
  async function api(path,{method='GET',body,binary=false}={}){
    const headers = {Authorization:'Bearer '+token};
    if (body instanceof Uint8Array) headers['Content-Type']='application/octet-stream';
    else if (body !== undefined) {headers['Content-Type']='application/json';body=JSON.stringify(body);}
    const response=await fetcher(root+path,{method,body,headers,redirect:'error',signal:AbortSignal.timeout(30000)});
    if (!response.ok) {
      const error=new MaintenanceError('Cloudflare returned HTTP '+response.status+' for '+method+' '+(path.includes('/storage/kv/')?'KV storage':path.includes('/d1/')?'D1 database':'Worker settings')+'.');
      error.status=response.status;
      error.retryable=response.status===404||response.status===429||response.status>=500;
      throw error;
    }
    if (binary) return Buffer.from(await response.arrayBuffer());
    const result=await response.json();
    if (!result.success) throw new MaintenanceError('Cloudflare rejected the operation. Check the selected resources and token permissions.');
    return result;
  }
  const script='/workers/scripts/'+worker;
  async function resolveTarget(){
    const [{result:history},{result:domain}]=await Promise.all([
      api(script+'/deployments'),api('/workers/subdomain')
    ]);
    const deployments=history?.deployments;
    if(!Array.isArray(deployments)||!deployments.length||deployments.some(item=>!Number.isFinite(Date.parse(item?.created_on))))
      throw new MaintenanceError('Cloudflare did not identify the active Worker deployment.');
    const [latest,previous]=[...deployments].sort((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on));
    if(!uuid.test(latest.id??'')||(previous&&Date.parse(latest.created_on)===Date.parse(previous.created_on)))
      throw new MaintenanceError('Cloudflare reported an ambiguous active Worker deployment.');
    const versions=latest.versions;
    const active=Array.isArray(versions)&&versions.length===1 ? versions[0] : null;
    if(active?.percentage!==100||!uuid.test(active.version_id??''))
      throw new MaintenanceError('Route all traffic to one reviewed Worker version before maintenance.');
    // Script settings can describe a newer upload than the version serving traffic.
    const {result:version}=await api(script+'/versions/'+active.version_id);
    const bindings=version?.resources?.bindings;
    if(version?.id!==active.version_id||!Array.isArray(bindings)||!name.test(domain?.subdomain??''))
      throw new MaintenanceError('Cloudflare returned inconsistent active Worker version details.');
    function binding(bindingName,type){
      const matches=bindings.filter(item=>item?.name===bindingName);
      return matches.length===1&&matches[0].type===type ? matches[0] : null;
    }
    const database=binding('DB','d1')?.id;
    const namespace=binding('PHOTOS','kv_namespace')?.namespace_id;
    const login=binding('STAFF_LOGIN','durable_object_namespace');
    if(!uuid.test(database??'')||database==='00000000-0000-0000-0000-000000000001'||
       !id.test(namespace??'')||namespace==='00000000000000000000000000000001'||
       binding('OFFICIAL_DEPLOY','plain_text')?.text!=='1'||login?.class_name!=='StaffLogin'||
       (login.script_name&&login.script_name!==worker))
      throw new MaintenanceError('Select an Option A Worker with its own unambiguous D1, KV and StaffLogin bindings.');
    return {origin:'https://'+worker+'.'+domain.subdomain+'.workers.dev',
      deployment:latest.id,version:active.version_id,database,namespace};
  }
  const target=await resolveTarget();
  const {origin,database,namespace}=target;
  const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const targetReceipt=fingerprint([account,worker,target]);
  const storageIdentity=fingerprint([account,worker,origin,database,namespace]);
  async function assertCurrent(){
    if(fingerprint([account,worker,await resolveTarget()])!==targetReceipt)
      throw new MaintenanceError('The active Worker or its bindings changed. Check the intended resources and run inspect again.');
  }
  const kv='/storage/kv/namespaces/'+namespace;
  return {
    origin, worker, target, targetReceipt, storageIdentity, assertCurrent,
    async query(sql,params=[]){
      const {result}=await api('/d1/database/'+database+'/query',{method:'POST',body:{sql,params}});
      if (!Array.isArray(result) || result.length!==1 || result[0]?.success!==true) throw new MaintenanceError('D1 could not complete the requested operation.');
      return result[0].results??[];
    },
    async *listImages(){
      let cursor='';
      const seen=new Set();
      do{
        const page=await api(kv+'/keys?limit=1000'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
        if (!Array.isArray(page.result)) throw new MaintenanceError('Could not read the image inventory.');
        yield* page.result;
        cursor=page.result_info?.cursor||'';
        if (cursor && seen.has(cursor)) throw new MaintenanceError('Cloudflare repeated an image listing page.');
        seen.add(cursor);
      }while(cursor);
    },
    readImage:key=>api(kv+'/values/'+encodeURIComponent(key),{binary:true}),
    writeImage:(key,bytes)=>api(kv+'/values/'+encodeURIComponent(key),{method:'PUT',body:bytes})
  };
}

const getState = async query => (await query('SELECT * FROM official_installation WHERE id=1'))[0];
const getLock = async query => (await query('SELECT source_digest,owner FROM official_restore WHERE id=1'))[0];
const releaseLock = (query,lock) => query('DELETE FROM official_restore WHERE id=1 AND source_digest=? RETURNING id',[lock]);
const validImageName = value => typeof value==='string' && id.test(value);

export async function backUp(site,{path,publicKey}){
  const {query}=site;
  const state=await getState(query);
  if (!state || state.origin!==site.origin) throw new MaintenanceError('The selected Worker does not match an initialized installation.');
  await site.assertCurrent?.();
  const lock='backup:'+randomBytes(16).toString('hex');
  const claimed=await query('INSERT INTO official_restore(id,source_digest) VALUES(1,?) ON CONFLICT DO NOTHING RETURNING id',[lock]);
  if (!claimed.length) throw new MaintenanceError('The agency installation is already in maintenance.');
  try {
    const schema=await snapshotSchema(query);
    for (const table of schema.filter(item=>item.type==='table'&&!['official_installation','official_restore','official_setup_window','app_migrations'].includes(item.name))) {
      if (!['insert','update','delete'].every(operation=>schema.some(item=>item.type==='trigger'&&item.name==='official_backup_'+table.name+'_'+operation)))
        throw new MaintenanceError('A database table is missing its backup write barrier. Update the maintenance tool and migration first.');
    }
    // Ready photos are authoritative. Reserved or deleting KV objects are not
    // required to restore any application-visible photo.
    const receipt=await createSnapshot({path,publicKey,query,listImages:async function*(){},
      readImage:key=>{
        if (!validImageName(key)) throw new MaintenanceError('Unexpected photo identifier.');
        return site.readImage(key);
      },
      configuration:{edition:'lt360-official',installation:state.installation_id,origin:state.origin}});
    await site.assertCurrent?.();
    return receipt;
  } finally {
    await releaseLock(query,lock);
  }
}

async function fileDigest(path){
  const hash=createHash('sha256');
  for await(const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

function canonicalRows(rows) {
  return rows.map(row=>JSON.stringify(Object.entries(row).sort(([a],[b])=>a.localeCompare(b)))).sort();
}

async function requireEmpty(site,tables) {
  for (const table of tables) {
    const actual=canonicalRows(await site.query('SELECT * FROM '+quote(table)+' LIMIT 2'));
    if (JSON.stringify(actual)!==JSON.stringify(canonicalRows(initialRows[table]??[])))
      throw new MaintenanceError('The destination must be an empty installation with the stock schema defaults.');
  }
  for await (const _image of site.listImages()) throw new MaintenanceError('The destination already has images.');
}

async function copyTable(query,database,name,lock) {
  const count=(await query('SELECT count(*) n FROM '+quote(name)))[0].n;
  const expected=database.prepare('SELECT count(*) n FROM '+quote(name)).get().n;
  // Stock defaults can need replacement. No unrestricted DELETE is used.
  for (const row of database.prepare('SELECT * FROM '+quote(name)).iterate()) {
    const columns=Object.keys(row);
    if (columns.some(column=>!/^\w+$/.test(column))||Object.values(row).some(value=>value instanceof Uint8Array))
      throw new MaintenanceError('This schema needs a newer recovery tool.');
    const values=Object.values(row);
    if (initialRows[name]) {
      const set=columns.filter(column=>column!=='id');
      const changed=await query('UPDATE '+quote(name)+' SET '+set.map(column=>quote(column)+'=?').join(',')+
        ' WHERE id=? AND EXISTS (SELECT 1 FROM official_restore WHERE id=1 AND source_digest=?) RETURNING id',
        [...set.map(column=>row[column]),row.id,lock]);
      if (!changed.length) throw new MaintenanceError('The restore no longer owns the destination.');
    } else {
      await query('INSERT INTO '+quote(name)+'('+columns.map(quote).join(',')+') SELECT '+values.map(()=>'?').join(',')+
        ' WHERE EXISTS (SELECT 1 FROM official_restore WHERE id=1 AND source_digest=?) ON CONFLICT DO NOTHING',[...values,lock]);
    }
    const predicate=columns.map(column=>quote(column)+' IS ?').join(' AND ');
    if (!(await query('SELECT 1 FROM '+quote(name)+' WHERE '+predicate+' LIMIT 1',values)).length)
      throw new MaintenanceError('A restored record differs from the verified backup. The destination remains closed.');
  }
  if ((await query('SELECT count(*) n FROM '+quote(name)))[0].n!==expected || count>expected)
    throw new MaintenanceError('The destination contains unexpected records. Keep it closed for review.');
}

async function restoreImage(site,key,bytes){
  if(!validImageName(key))throw new MaintenanceError('Unexpected backup photo identifier.');
  try {
    const existing=await site.readImage(key);
    if (!existing.equals(bytes)) throw new MaintenanceError('A destination photo has different content.');
    return;
  } catch(error) { if(error.status!==404) throw error; }
  await site.writeImage(key,bytes);
  // KV may not expose a just-written value everywhere immediately. Never open
  // a restored site until the exact photo can be read through Cloudflare.
  for (const delay of [0,250,1000,3000]) {
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    try {
      if((await site.readImage(key)).equals(bytes))return;
    } catch(error){if(!error.retryable&&error.status!==404)throw error;}
  }
  throw new MaintenanceError('Photo verification is waiting for KV. Retry the same restore after propagation.');
}

async function restoreVerifiedCopy(site,{path,privateKey,expectedDigest}){
  if (!digest.test(expectedDigest??'') || await fileDigest(path)!==expectedDigest) throw new MaintenanceError('The file does not match the trusted backup SHA-256.');
  const {query}=site;
  await site.assertCurrent?.();
  const previous=await getState(query);
  if(previous?.restored_from===expectedDigest&&previous.origin===site.origin){
    const verified=await verifySnapshot(path,{privateKey,onImage:async(key,bytes)=>{
      if(!validImageName(key)||!(await site.readImage(key)).equals(bytes))
        throw new MaintenanceError('The recovered installation does not match the archive image storage.');
    }});
    verified.database.close();
    await site.assertCurrent?.();
    return;
  }
  if(previous)throw new MaintenanceError('Choose a fresh destination. Restore cannot overwrite an existing installation.');
  const targetSchema=await snapshotSchema(query);
  const snapshot=await verifySnapshot(path,{privateKey,expectedSchema:targetSchema});
  const {database,configuration}=snapshot;
  const lock='restore:'+expectedDigest;
  // Keep a storage fingerprint in the existing owner field between attempts.
  // The original archive marker still lets the existing completion trigger clear the lock.
  const idleOwner=site.storageIdentity??null;
  const attempt=randomBytes(16).toString('hex');
  const owner=idleOwner ? idleOwner+'.'+attempt : attempt;
  try{
    const source=database.prepare('SELECT * FROM official_installation WHERE id=1').get();
    if(configuration.edition!=='lt360-official'||!source||source.installation_id!==configuration.installation||
      !id.test(source.installation_id)||!digest.test(source.guest_key)||
      !database.prepare("SELECT 1 FROM staff_accounts WHERE role='administrator' AND disabled=0 LIMIT 1").get())
      throw new MaintenanceError('This backup is not a complete initialized Option A installation.');
    const tables=targetSchema.filter(item=>item.type==='table'&&!skip.has(item.name)).map(item=>item.name);
    const existing=await getLock(query);
    if(!existing){
      await requireEmpty(site,tables);
      await site.assertCurrent?.();
      const acquired=await query(`INSERT INTO official_restore SELECT 1,?,? WHERE NOT EXISTS (SELECT 1 FROM official_installation)
        AND NOT EXISTS (SELECT 1 FROM staff_accounts) ON CONFLICT DO NOTHING RETURNING id`,[lock,owner]);
      if(!acquired.length)throw new MaintenanceError('The destination changed while starting restore.');
    }else {
      if(existing.source_digest!==lock)throw new MaintenanceError('The destination is reserved for another maintenance operation.');
      if(existing.owner!==idleOwner)
        throw new MaintenanceError('Restore is still owned or its storage cannot be verified. Keep the destination closed and check the original bindings.');
      await site.assertCurrent?.();
      const acquired=await query('UPDATE official_restore SET owner=? WHERE id=1 AND source_digest=? AND owner IS ? RETURNING id',[owner,lock,idleOwner]);
      if(!acquired.length)throw new MaintenanceError('A restore already owns the destination.');
    }
    const images=await verifySnapshot(path,{privateKey,expectedSchema:targetSchema,onImage:(key,bytes)=>restoreImage(site,key,bytes)});
    images.database.close();
    await site.assertCurrent?.();
    for (const table of [...parentOrder.filter(table=>tables.includes(table)),...tables.filter(table=>!parentOrder.includes(table))])
      await copyTable(query,database,table,lock);
    await site.assertCurrent?.();
    const opened=await query(`INSERT INTO official_installation(id,installation_id,origin,guest_key,created,restored_from)
      SELECT 1,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM official_restore WHERE id=1 AND source_digest=? AND owner=?)
      ON CONFLICT DO NOTHING RETURNING id`,[source.installation_id,site.origin,source.guest_key,source.created,expectedDigest,lock,owner]);
    if(!opened.length)throw new MaintenanceError('The destination changed before it could be activated.');
  }finally{
    database.close();
    await query('UPDATE official_restore SET owner=? WHERE id=1 AND source_digest=? AND owner=?',[idleOwner,lock,owner]);
  }
}

export async function restore(site,{path,privateKey,expectedDigest}){
  if ((await stat(path)).size>1024*1024*1024)throw new MaintenanceError('The encrypted snapshot exceeds the 1 GiB recovery limit.');
  // Both verification passes use the same private ciphertext. A replacement of
  // the input path after the digest check cannot change a second-pass transfer.
  const directory=await mkdtemp(join(tmpdir(),'lt360-restore-'));
  try {
    const copy=join(directory,'snapshot');
    await copyFile(path,copy);
    await restoreVerifiedCopy(site,{path:copy,privateKey,expectedDigest});
  } finally { await rm(directory,{recursive:true,force:true}); }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [action,...args]=process.argv.slice(2);
    if(action==='keys' && args.length===2){
      if(resolve(args[0])===resolve(args[1]))throw new MaintenanceError('Choose separate private and public key files.');
      await Promise.all(args.map(protectedOutput));
      const pair=generateKeyPairSync('rsa',{modulusLength:3072});
      await writeFile(args[0],JSON.stringify(pair.privateKey.export({format:'jwk'})),{flag:'wx',mode:0o600});
      await writeFile(args[1],JSON.stringify(pair.publicKey.export({format:'jwk'})),{flag:'wx',mode:0o600});
    }else if((action==='backup'&&args.length===4)||(action==='restore'&&args.length===5)||(action==='inspect'&&args.length===2)||(action==='unlock-backup'&&args.length===3)||(action==='unlock-restore'&&args.length===4)){
      const [account,worker,path,key,expectedDigest]=args;
      const site=await openInstallation({account,worker,token:process.env.LT360_CLOUDFLARE_TOKEN});
      if(action==='inspect'){
        const state=await getState(site.query);
        if(state&&state.origin!==site.origin)throw new MaintenanceError('The D1 database belongs to a different installation.');
        console.log(JSON.stringify({...site.target,targetReceipt:site.targetReceipt,initialized:!!state,maintenance:await getLock(site.query)??null}));
      }else {
        if(process.env.LT360_MAINTENANCE_TARGET!==site.targetReceipt)
          throw new MaintenanceError('Run inspect and confirm the active version and bindings against your agency records. Set LT360_MAINTENANCE_TARGET to the inspected targetReceipt.');
        await site.assertCurrent();
      }
      if(action==='backup'){
        await protectedOutput(path);
        console.log(JSON.stringify(await backUp(site,{path,publicKey:JSON.parse(await readFile(key,'utf8'))})));
      }
      if(action==='restore'){
        await restore(site,{path,privateKey:JSON.parse(await readFile(key,'utf8')),expectedDigest});
        console.log('Restored and verified. Sign in at '+site.origin+'/staff.');
      }
      if(action==='unlock-backup'){
        if(!/^backup:[a-f0-9]{32}$/.test(path??''))throw new MaintenanceError('Only a stopped backup can be unlocked. Confirm the exact marker from inspect.');
        if(!(await releaseLock(site.query,path)).length)throw new MaintenanceError('That backup marker does not own the lock.');
      }
      if(action==='unlock-restore'){
        if(!/^restore:[a-f0-9]{64}$/.test(path??'') || !key?.startsWith(site.storageIdentity+'.') || !id.test(key.slice(65)))throw new MaintenanceError('Confirm the exact stopped restore marker and owner from inspect.');
        if(!(await site.query('UPDATE official_restore SET owner=? WHERE id=1 AND source_digest=? AND owner=? RETURNING id',[site.storageIdentity,path,key])).length)
          throw new MaintenanceError('That restore marker and owner are no longer active.');
      }
    }else throw new MaintenanceError('Use keys PRIVATE PUBLIC, backup ACCOUNT WORKER BACKUP PUBLIC, restore ACCOUNT WORKER BACKUP PRIVATE SHA256, inspect ACCOUNT WORKER, unlock-backup ACCOUNT WORKER MARKER, or unlock-restore ACCOUNT WORKER MARKER OWNER.');
  }catch(error){
    const message=error instanceof MaintenanceError ? error.message : 'Check the input files, account settings and operation status.';
    // Underlying IO, SQL, and provider bodies can contain operational details.
    console.error(error?.status ? message : 'Maintenance did not complete. '+message);
    process.exitCode=1;
  }
}
