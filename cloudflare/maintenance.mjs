import {randomBytes} from 'node:crypto';
import {release} from './release.mjs';
import {verifiedUpdate} from '../agency/update.mjs';

export async function maintenanceReady(db){
 const row=await db.prepare("SELECT SUM(type='table' AND name IN ('maintenance_requests','maintenance_lock','maintenance_history')) tables_ready,SUM(type='trigger' AND name GLOB 'maintenance_*') guards_ready FROM sqlite_schema").bind().first();
 return row?.tables_ready===3&&row.guards_ready>=42;
}

export async function sealConfiguration(publicKey,configuration){
 if(publicKey?.kty!=='RSA'||publicKey.alg!=='RSA-OAEP-256'||publicKey.d||publicKey.e!=='AQAB'||typeof publicKey.n!=='string'||publicKey.n.length<512||publicKey.n.length>684)throw Error('Use a generated 3072–4096 bit public backup key.');
 const wrapping=await crypto.subtle.importKey('jwk',publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(configuration)));
 const wrapped=await crypto.subtle.encrypt({name:'RSA-OAEP'},wrapping,await crypto.subtle.exportKey('raw',key));
 const encode=value=>Buffer.from(value).toString('base64');
 return {format:'lt360-sealed-config-v1',iv:encode(iv),key:encode(wrapped),data:encode(bytes)};
}

export async function availableUpdate(env,installed){
 let manifest=env.UPDATE_MANIFEST,signature=env.UPDATE_SIGNATURE;
 if(env.UPDATE_CATALOG_URL){
  const url=new URL(env.UPDATE_CATALOG_URL);if(url.protocol!=='https:'||url.origin!==env.AGENCY_COMPANION_ORIGIN||url.pathname!=='/releases/latest'||url.username||url.password||url.search||url.hash)throw Error('Untrusted release catalog.');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Release catalog unavailable.');
  const reader=response.body.getReader();let bytes=0;const chunks=[];for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>100000){await reader.cancel();throw Error('Release catalog is too large.');}chunks.push(part.value);}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));manifest=value.manifest;signature=value.signature;
 }
 if(!manifest||!signature||!env.UPDATE_PUBLIC_KEY)return null;
 const bytes=Buffer.from(manifest,'base64');if(JSON.parse(bytes).version===installed.version)return null;
 return verifiedUpdate({bytes,signature:Buffer.from(signature,'base64'),publicKey:env.UPDATE_PUBLIC_KEY,installed});
}

export async function maintenanceApi({request,env,db,account,sessionHash,body={}}){
 const result=(value,status=200)=>({value,status});
 if(env.AGENCY_BROWSER_SETUP!=='1')return result({error:'Updates are not configured for this installation.'},404);
 if(account.role!=='administrator')return result({error:'An active Administrator account is required.'},403);
 const q=(sql,...args)=>db.prepare(sql).bind(...args);
 const installed={...release,build:env.APP_BUILD??release.version,installation:env.INSTALLATION_ID};
 if(request.method==='DELETE'){
  if(!/^[a-f0-9]{32}$/.test(body.id??''))return result({error:'Select an update request.'},400);
  const row=await q('UPDATE maintenance_requests SET revoked=? WHERE id=? AND installation=? AND revoked IS NULL RETURNING id',Date.now(),body.id,env.INSTALLATION_ID).first();
  if(row)await q('INSERT INTO maintenance_history(request,actor,event,created) VALUES(?,?,?,?)',row.id,account.username,'Update approval revoked',Date.now()).run();
  return result({ok:true});
 }
 const url=new URL(request.url),path=url.pathname;
 const lock=await q('SELECT request FROM maintenance_lock WHERE id=1').first();
 const metadata={installed,companion:env.AGENCY_COMPANION_ORIGIN??null};
 const fields='id,version,created,expires,revoked,phase,message,backup_digest,json_extract(public_key,\'$.n\') AS modulus';
 if(request.method==='GET' && url.searchParams.get('view')==='history'){
  return result({requests:(await q('SELECT '+fields+' FROM maintenance_requests WHERE installation=? ORDER BY created DESC LIMIT 50',env.INSTALLATION_ID).all()).results,history:(await q('SELECT event,created FROM maintenance_history ORDER BY id DESC LIMIT 100').all()).results});
 }
 if(request.method==='GET' && url.searchParams.get('view')==='status'){
  const row=lock?await q('SELECT '+fields+' FROM maintenance_requests WHERE installation=? AND id=?',env.INSTALLATION_ID,lock.request).first():
   await q('SELECT '+fields+' FROM maintenance_requests WHERE installation=? ORDER BY created DESC LIMIT 1',env.INSTALLATION_ID).first();
  return result({...metadata,locked:!!lock,request:row??null});
 }
 let candidate=null,notice='No verified compatible update is available.';
 try{candidate=await availableUpdate(env,installed);if(candidate)notice='Review this release before approving it.';}catch{notice='The update description could not be verified. Try again later.';}
 if(request.method==='GET')return result({installed,available:candidate?{version:candidate.version,build:candidate.build,schema:candidate.schema,notes:candidate.notes,manifestSha256:candidate.manifestSha256}:null,notice,companion:env.AGENCY_COMPANION_ORIGIN??null});
 if(request.method!=='POST'||path!=='/api/staff/maintenance')return result({error:'Not found.'},404);
 if(lock)return result({error:'An update or recovery is already in progress. Review its progress before starting another.'},409);
 if(!candidate||body.manifestSha256!==candidate.manifestSha256||body.confirm!==true||body.recoverySaved!==true)return result({error:'Review the verified release and save your private backup recovery file before approving.'},400);
 if(!/^[a-f0-9]{40}$/.test(installed.build))return result({error:'This installation has no verified source build. An infrastructure operator must establish its version first.'},409);
 let sealed;try{sealed=await sealConfiguration(body.publicKey,{installation:env.INSTALLATION_ID,origin:env.APP_ORIGIN,GUEST_CODE_KEY:env.GUEST_CODE_KEY});}catch{return result({error:'Generate a valid backup recovery key on this page.'},400);}
 const now=Date.now(),id=randomBytes(16).toString('hex');
 const inserted=await q(`INSERT INTO maintenance_requests(id,installation,administrator,revision,from_build,manifest_digest,version,public_key,secret_backup,created,expires)
 SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM staff_sessions s JOIN staff_accounts a USING(username) WHERE s.token=? AND s.expires>? AND s.revision=a.revision AND a.username=? AND a.role='administrator' AND a.disabled=0) AND NOT EXISTS(SELECT 1 FROM maintenance_lock) RETURNING id`,id,env.INSTALLATION_ID,account.username,account.revision,installed.build,candidate.manifestSha256,candidate.version,JSON.stringify(body.publicKey),JSON.stringify(sealed),now,now+2*3600000,sessionHash,now,account.username).first();
 if(!inserted)return result({error:'Your authorization changed. Sign in again and review the update.'},409);
 await q('INSERT INTO maintenance_history(request,actor,event,created) VALUES(?,?,?,?)',id,account.username,'Update approved; separate Cloudflare authorization is required',now).run();
 return result({ok:true,id},201);
}
