import {readFile,mkdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {verifiedUpdate,UpdateError} from './update.mjs';
import {unpackArtifact,additiveStatements,sha256} from './artifact.mjs';
import {createSnapshot,SnapshotError} from './snapshot.mjs';
import {saveJournal,freePlan,SetupError} from './cloudflare.mjs';

const terminal=new Set(['complete','recovered']);
const array=value=>Array.isArray(value)?value:value?.deployments??value?.items??[];
const token=/^[a-f0-9]{32}$/;
export const phaseMessage={preparing:'Pausing editing for a consistent backup', 'backing-up':'Creating and verifying an encrypted installation backup','backup-ready':'Backup verified',uploading:'Uploading the verified release without activating it',staged:'Release staged',migrating:'Applying compatible additive schemas',deploying:'Activating the approved release',verifying:'Verifying your website',complete:'Update verified; editing is available',recovering:'Restoring the retained code version',recovered:'Previous code restored; current data retained','operator-recovery-required':'Recovery needs an authorized infrastructure operator; editing remains paused'};

export function installationQueries(api,state){
 return async(sql,params=[])=>{const result=await api(`/accounts/${state.account}/d1/database/${state.database}/query`,{method:'POST',body:{sql,params}});if(!Array.isArray(result)||result.some(r=>r.success===false))throw new SetupError('The installation database could not complete this operation.');return result[0]?.results??[];};
}

export async function readUpdateRequests({directory,api}){
 const state=JSON.parse(await readFile(join(directory,'installation.json'),'utf8'));
 const query=installationQueries(api,state);
 return {state,requests:await query('SELECT id,version,created,expires,revoked,phase,message,backup_digest, EXISTS(SELECT 1 FROM maintenance_lock WHERE request=maintenance_requests.id) AS owns_lock FROM maintenance_requests WHERE installation=? ORDER BY owns_lock DESC,created DESC LIMIT 25',[state.installation])};
}

export async function runInstallationUpdate({account,name,directory,requestId,api,run,releaseBundle,verifiedFreePlanIds,fetcher=fetch,progress=()=>{},checkpoint=async()=>{}}){
 if(!token.test(requestId))throw new SetupError('Choose an approved update request.');
 const state=JSON.parse(await readFile(join(directory,'installation.json'),'utf8'));
 if(state.account!==account||state.name!==name)throw new SetupError('The saved installation does not match the selected account.');
 if(!freePlan(await api(`/accounts/${account}/subscriptions`),verifiedFreePlanIds))throw new SetupError('Workers Free could not be verified. No update was started.');
 const base=`/accounts/${account}/workers/scripts/${state.resourceName}`,query=installationQueries(api,state);
 const get=async()=> (await query('SELECT * FROM maintenance_requests WHERE id=? AND installation=?',[requestId,state.installation]))[0];
 let request=await get();if(!request)throw new SetupError('That approval belongs to another installation or is unavailable.');
 const settings=await api(base+'/settings');
 const value=key=>settings.bindings?.find(b=>b.name===key)?.text;
 const d1=settings.bindings?.find(b=>b.name==='DB'),kv=settings.bindings?.find(b=>b.name==='PHOTOS');
 if(value('INSTALLATION_ID')!==state.installation||d1?.id!==state.database||kv?.namespace_id!==state.namespace)throw new SetupError('Installation resource bindings changed. No update will run until an authorized operator reviews them.');
 const object=settings.bindings.find(b=>b.name==='STAFF_LOGIN');
 if(object?.type!=='durable_object_namespace'||object.class_name!=='StaffLogin'||(object.script_name&&object.script_name!==state.resourceName))throw new SetupError('The private Durable Object binding changed. It will not be replaced by an update.');
 const resourceNames={d1:'DB',kv_namespace:'PHOTOS',durable_object_namespace:'STAFF_LOGIN',assets:'ASSETS',version_metadata:'CF_VERSION_METADATA'};
 for(const binding of settings.bindings)if(!['plain_text','json','secret_text','secret_key'].includes(binding.type)&&resourceNames[binding.type]!==binding.name)throw new SetupError('An additional or unsupported resource binding needs separate infrastructure review.');
 const health=async()=>{const r=await fetcher(state.origin+'/api/installation-health',{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new SetupError('Installation health is temporarily unavailable.');return r.json();};
 const activeVersion=async()=>{const records=array(await api(base+'/deployments')),versions=records[0]?.versions;if(versions?.length!==1||versions[0].percentage!==100)throw new SetupError('Finish the existing split deployment before updating.');return versions[0].version_id;};
 const initial=await health();if(initial.maintenanceProtocol!==1)throw new SetupError('This older installation needs an explicitly authorized infrastructure upgrade before browser updates are available.');
 const installed={installation:state.installation,version:initial.version,schema:initial.schema,build:request.from_build};
 // A resumed job verifies the same signed bytes against its original version,
 // not against the candidate that may already have reached the edge.
 const jobDirectory=join(directory,'updates',requestId);await mkdir(jobDirectory,{recursive:true,mode:0o700});
 const journalPath=join(jobDirectory,'job.json');let journal;
 try{journal=JSON.parse(await readFile(journalPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new SetupError('The private update journal needs operator review.');}
 if(journal){if(journal.installation!==state.installation||journal.requestId!==requestId||journal.fromBuild!==request.from_build||journal.manifest!==request.manifest_digest)throw new SetupError('The saved update journal does not match this installation and approval.');installed.version=journal.fromVersion;installed.schema=journal.fromSchema;}
 if(!terminal.has(request.phase) && !releaseBundle)throw new SetupError('A verified release is required to resume this update.');
 const candidate=terminal.has(request.phase)?null:verifiedUpdate({...releaseBundle,installed});
 if(candidate && (request.manifest_digest!==candidate.manifestSha256||request.version!==candidate.version||sha256(releaseBundle.artifact)!==candidate.artifactSha256))throw new SetupError('The approved release or its artifact changed. A new Administrator review is required.');
 const authorize=async()=>{const row=await get();const admin=(await query("SELECT revision FROM staff_accounts WHERE username=? AND role='administrator' AND disabled=0",[row?.administrator]))[0];if(!row||row.revoked||row.expires<=Date.now()||admin?.revision!==row.revision||row.from_build!==request.from_build)throw new SetupError('Update approval expired, was revoked, or its Administrator changed.');return row;};
 const setPhase=async phase=>{
  const rows=await query('UPDATE maintenance_requests SET phase=?,message=? WHERE id=? AND EXISTS(SELECT 1 FROM maintenance_lock WHERE id=1 AND request=?) RETURNING id',[phase,phaseMessage[phase],requestId,requestId]);
  if(!rows.length)throw new SetupError('This request no longer owns the maintenance lock. Check its current status.');
  request.phase=phase;await query('INSERT INTO maintenance_history(request,actor,event,created) VALUES(?,?,?,?)',[requestId,'infrastructure',phaseMessage[phase],Date.now()]);progress(phaseMessage[phase]);await saveJournal(journalPath,journal);await checkpoint(phase);};
 // A single guarded UPDATE fires both the history insert and lock release in
 // the same SQLite transaction. Install on demand for older agency schemas.
 const finish = async (phase, repair = false) => {
  const expected = phase === 'complete' ? journal?.targetVersion : journal?.previousVersion;
  if (!expected || await activeVersion() !== expected)
   throw new SetupError('Editing remains paused. Check the active deployment and resume this request.');
  const live = await health();
  const valid = phase === 'complete'
   ? live.version === request.version && (candidate ? live.build === candidate.build && live.schema === candidate.schema : live.schema >= journal.fromSchema && (!journal.targetBuild || live.build === journal.targetBuild))
   : live.build === request.from_build && live.version === journal.fromVersion && live.schema >= journal.fromSchema;
  if (!live.ready || !valid) throw new SetupError('Editing remains paused until the expected website version is healthy.');
  await query(`CREATE TRIGGER IF NOT EXISTS lt360_finish_update_v1 AFTER UPDATE OF phase ON maintenance_requests
   WHEN NEW.phase IN ('complete','recovered') AND EXISTS(SELECT 1 FROM maintenance_lock WHERE id=1 AND request=NEW.id)
   BEGIN
    INSERT INTO maintenance_history(request,actor,event,created)
     SELECT NEW.id,'infrastructure',NEW.message,CAST(strftime('%s','now') AS INTEGER)*1000
     WHERE OLD.phase<>NEW.phase OR NOT EXISTS(SELECT 1 FROM maintenance_history WHERE request=NEW.id AND event=NEW.message);
    DELETE FROM maintenance_lock WHERE id=1 AND request=NEW.id;
   END`);
  await checkpoint('before-'+phase);
  const requireApproval = phase==='complete' && !repair;
  let rows;
  try{rows = await query(`UPDATE maintenance_requests SET phase=?,message=? WHERE id=? AND installation=?
   AND EXISTS(SELECT 1 FROM maintenance_lock WHERE id=1 AND request=?)
   AND (?=0 OR (revoked IS NULL AND expires>? AND EXISTS(SELECT 1 FROM staff_accounts
    WHERE username=administrator AND staff_accounts.revision=maintenance_requests.revision AND role='administrator' AND disabled=0))) RETURNING id`,
   [phase,phaseMessage[phase],requestId,state.installation,requestId,Number(requireApproval),Date.now()]);
  }catch(error){
   // The provider may commit the transaction before its HTTP response is lost.
   const committed=await query('SELECT id FROM maintenance_requests WHERE id=? AND installation=? AND phase=? AND NOT EXISTS(SELECT 1 FROM maintenance_lock WHERE id=1 AND request=?)',[requestId,state.installation,phase,requestId]);
   if(!committed.length)throw error;
   rows=committed;
  }
  if (!rows.length) throw new SetupError('The lock or approval changed. Review the request before continuing.');
  progress(phaseMessage[phase]);
  await checkpoint(phase);
 };
 const deployVersion=version=>api(base+'/deployments',{method:'POST',body:{strategy:'percentage',versions:[{version_id:version,percentage:100}],annotations:{'workers/message':'LevelTwo360 '+requestId},code_update_strategy:{mode:'immediate'}}});
 const recover=async()=>{await setPhase('recovering');const current=await activeVersion();if(current!==journal.previousVersion&&current!==journal.targetVersion)throw new SetupError('Another deployment appeared during recovery. Editing remains paused; an infrastructure operator must review it.');if(current!==journal.previousVersion)await deployVersion(journal.previousVersion);const restored=await health();if(!restored.ready||restored.build!==request.from_build)throw new SetupError('Previous code health could not be verified.');await finish('recovered');};
 if (terminal.has(request.phase)) {
  const owner = (await query('SELECT request FROM maintenance_lock WHERE id=1'))[0];
  if (owner && owner.request !== requestId) throw new SetupError('Another update owns the editing lock. Resume that request.');
  if (owner) await finish(request.phase, true);
  return {phase:request.phase,website:state.origin,requestId,backupAvailable:!!request.backup_digest};
 }
 if(!journal){await authorize();if(initial.build!==request.from_build||!initial.ready)throw new SetupError('The installed build or its health changed. Review a new update approval.');if(candidate.schema>Number(value('SCHEMA_COMPATIBLE_MAX')??initial.schema))throw new SetupError('This schema exceeds the installed code recovery range. A separately reviewed compatibility upgrade is required.');journal={installation:state.installation,requestId,fromVersion:initial.version,fromSchema:initial.schema,fromBuild:request.from_build,previousVersion:await activeVersion(),manifest:candidate.manifestSha256};await saveJournal(journalPath,journal);}
 const locked=await query('INSERT INTO maintenance_lock(id,request,created) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET request=excluded.request WHERE maintenance_lock.request=excluded.request RETURNING request',[requestId,Date.now()]);
 if(!locked.length)throw new SetupError('Another update owns this installation. Resume that job first.');
 if(['deploying','verifying','recovering','operator-recovery-required'].includes(request.phase)){
  const active=await activeVersion();
  if(active===journal.targetVersion && journal.snapshot?.photoInventoryVerified){try{await authorize();const live=await health();if(live.ready&&live.build===candidate.build&&live.version===candidate.version&&live.schema===candidate.schema){await finish('complete');return {phase:'complete',website:state.origin,requestId,backupAvailable:true};}}catch(error){if(error?.simulatedCrash)throw error;} }
  // A lost activation response is observed, never blindly repeated. Recover
  // retained code before asking for a new approval or retrying activation.
  try{await recover();return {phase:'recovered',website:state.origin,requestId,backupAvailable:!!request.backup_digest};}catch(recoveryError){if(recoveryError?.simulatedCrash)throw recoveryError;await setPhase('operator-recovery-required');throw new SetupError('Recovery could not be confirmed. Editing remains paused. Reconnect to the same job or ask an authorized infrastructure operator to inspect retained versions.');}
 }
 try{
  await authorize();await setPhase('preparing');
  if(!journal.snapshot?.photoInventoryVerified){
   await setPhase('backing-up');const file='snapshot-'+randomBytes(8).toString('hex')+'.lt360backup';
   let lastReport=0;
   const onProgress=async(stage,done,total)=>{
    if(stage!=='verify' && Date.now()-lastReport<3000)return;
    lastReport=Date.now();
    await authorize();
    const message=stage==='verify'?'Restoring the backup to verify records and '+total+' images':'Backing up images: '+done+' of '+total;
    progress(message);
    await query('UPDATE maintenance_requests SET message=? WHERE id=?',[message,requestId]);
   };
   const snapshot=await createSnapshot({onProgress,path:join(jobDirectory,file),publicKey:JSON.parse(request.public_key),query,configuration:{state,settings,secretEnvelope:JSON.parse(request.secret_backup)},listImages:async function*(){let cursor='';const seen=new Set();do{const path=`/accounts/${account}/storage/kv/namespaces/${state.namespace}/keys?limit=1000`+(cursor?'&cursor='+encodeURIComponent(cursor):'');const page=await api.page(path);if(!Array.isArray(page.result))throw new SetupError('The KV inventory response is unsupported.');for(const entry of page.result){if(seen.has(entry.name))throw new SetupError('The image inventory changed during backup.');seen.add(entry.name);yield entry;}cursor=page.result_info?.cursor??'';}while(cursor);},readImage:key=>api.binary(`/accounts/${account}/storage/kv/namespaces/${state.namespace}/values/${encodeURIComponent(key)}`)});
   journal.snapshot={...snapshot,file};await saveJournal(journalPath,journal);await query('UPDATE maintenance_requests SET backup_digest=?,backup_file=?,previous_version=? WHERE id=?',[snapshot.sha256,file,journal.previousVersion,requestId]);
  }else{if(!/^snapshot-[a-f0-9]{16}\.lt360backup$/.test(journal.snapshot.file))throw new SetupError('Invalid backup journal.');const check=createHash('sha256');for await(const chunk of createReadStream(join(jobDirectory,journal.snapshot.file)))check.update(chunk);if(check.digest('hex')!==journal.snapshot.sha256||(request.backup_digest&&request.backup_digest!==journal.snapshot.sha256))throw new SetupError('The encrypted backup changed. No update will be activated.');}
  await query('UPDATE maintenance_requests SET backup_digest=?,backup_file=?,previous_version=? WHERE id=?',[journal.snapshot.sha256,journal.snapshot.file,journal.previousVersion,requestId]);
  await setPhase('backup-ready');await authorize();
  if(await activeVersion()!==journal.previousVersion)throw new SetupError('Another operator changed the deployed version. No activation will run.');
  if(!journal.targetVersion){
   await setPhase('uploading');const directory=join(jobDirectory,'artifact-'+randomBytes(8).toString('hex')),unpacked=await unpackArtifact(releaseBundle.artifact,directory);
   const config=JSON.parse(await readFile(join(resolve(jobDirectory,'../..'),'wrangler.json'),'utf8'));
   config.main=unpacked.worker;config.assets.directory=unpacked.assets;config.keep_vars=true;config.no_bundle=true;
   if(settings.compatibility_date)config.compatibility_date=settings.compatibility_date;if(settings.compatibility_flags)config.compatibility_flags=settings.compatibility_flags;
   const vars=Object.fromEntries(settings.bindings.filter(b=>['plain_text','json'].includes(b.type)).map(b=>[b.name,b.type==='json'?(typeof b.json==='string'?JSON.parse(b.json):b.json):b.text]));
   config.vars={...vars,APP_BUILD:candidate.build,SCHEMA_REQUIRED:String(candidate.schema),SCHEMA_COMPATIBLE_MAX:String(Math.max(Number(vars.SCHEMA_COMPATIBLE_MAX??candidate.schema),candidate.schema+1))};
   const configPath=join(directory,'wrangler.json');await saveJournal(configPath,config);
   await run(['versions','upload','--config',configPath,'--message','LT360-update-'+requestId]);
   const versions=array(await api(base+'/versions'));
   const found=versions.find(v=>(v.annotations??v.metadata?.annotations)?.['workers/message']==='LT360-update-'+requestId);
   if(!found?.id)throw new SetupError('The staged version could not be identified. No activation was requested.');
   journal.targetVersion=found.id;journal.targetBuild=candidate.build;journal.migrations=unpacked.migrations;await saveJournal(journalPath,journal);await query('UPDATE maintenance_requests SET target_version=? WHERE id=?',[found.id,requestId]);
  }
  await setPhase('staged');await authorize();
  const needed=(journal.migrations??[]).filter(m=>m.version>journal.fromSchema);
  if(needed.length!==candidate.schema-journal.fromSchema||needed.some((m,i)=>m.version!==journal.fromSchema+i+1))throw new SetupError('The release lacks a complete contiguous additive migration path.');
  const canonical=sql=>sql.replace(/\bIF\s+NOT\s+EXISTS\b/gi,'').replace(/\s+/g,' ').replace(/\s*([(),])\s*/g,'$1').trim().toLowerCase();
  await setPhase('migrating');for(const migration of needed){await authorize();for(const sql of additiveStatements(migration.sql)){const match=sql.match(/^CREATE\s+(TABLE|(?:UNIQUE\s+)?INDEX)\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)/i),existing=(await query('SELECT sql FROM sqlite_schema WHERE name=? COLLATE NOCASE',[match[2]]))[0];if(existing&&canonical(existing.sql)!==canonical(sql))throw new SetupError('A migration object already exists with a different definition. Existing data will not be overwritten.');await query(sql);}await query('INSERT OR IGNORE INTO app_migrations(version,applied) VALUES(?,?)',[migration.version,Date.now()]);}
  await authorize();if(await activeVersion()!==journal.previousVersion)throw new SetupError('Another deployment changed the expected version.');
  await setPhase('deploying');await deployVersion(journal.targetVersion);await setPhase('verifying');
  const live=await health();if(!live.ready||live.version!==candidate.version||live.build!==candidate.build||live.schema!==candidate.schema)throw new SetupError('The updated version did not pass health checks.');
  await authorize();await finish('complete');return {phase:'complete',website:state.origin,requestId,backupAvailable:true};
 }catch(error){
  if(error?.simulatedCrash)throw error;
  // A failed HTTP response does not imply that the terminal transaction failed.
  const saved=await get();
  if(saved?.phase==='complete' && !(await query('SELECT request FROM maintenance_lock WHERE id=1')).length) return {phase:'complete',website:state.origin,requestId,backupAvailable:!!saved.backup_digest};
  try{await recover();}catch(recoveryError){if(recoveryError?.simulatedCrash)throw recoveryError;await setPhase('operator-recovery-required');throw new SetupError('Update stopped and code recovery could not be verified. Editing remains paused. Resume this exact update with fresh Cloudflare authorization.');}
  const reason=error instanceof SetupError||error instanceof SnapshotError?error.message:'A technical step could not be verified.';
  const message='Update stopped: '+reason+' Previous code is verified and current data and secrets are retained.';
  await query('UPDATE maintenance_requests SET message=? WHERE id=?',[message,requestId]);
  await query('INSERT INTO maintenance_history(request,actor,event,created) VALUES(?,?,?,?)',[requestId,'infrastructure',message,Date.now()]);
  throw new SetupError(message);
 }
}
