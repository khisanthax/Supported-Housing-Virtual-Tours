import {open,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomBytes,createCipheriv,createDecipheriv,createPublicKey,createPrivateKey,publicEncrypt,privateDecrypt,constants} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
export class SnapshotError extends Error{}
const hash=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>Buffer.from(value).toString('base64');
const identifier=value=>'"'+String(value).replaceAll('"','""')+'"';
const transient=name=>['sessions','staff_sessions','firebase_staff_sessions','attempts','official_restore','diagnostic_operations','diagnostic_daily'].includes(name);
const cell=value=>value instanceof Uint8Array||Array.isArray(value)?{blob:encode(value)}:value;
const uncell=value=>value&&typeof value==='object'&&typeof value.blob==='string'?Buffer.from(value.blob,'base64'):value;

async function* lines(path){let pending='';for await(const chunk of createReadStream(path,{encoding:'utf8',highWaterMark:65536})){pending+=chunk;if(pending.length>16*1024*1024&&!pending.includes('\n'))throw new SnapshotError('Snapshot record exceeds the size limit.');let i;while((i=pending.indexOf('\n'))>=0){if(i>16*1024*1024)throw new SnapshotError('Snapshot record exceeds the size limit.');yield pending.slice(0,i);pending=pending.slice(i+1);}}if(pending)throw new SnapshotError('Incomplete snapshot record.');}

export async function verifySnapshot(path,{key,privateKey,onImage,expectedSchema}={}){
 if((await stat(path)).size>1024*1024*1024)throw new SnapshotError('Snapshot exceeds the supported pilot size.');
 const db=new DatabaseSync(':memory:'),digest=createHash('sha256');const restoredImages=new Map();let header,position=0,ended=false,rows=0,images=0,configuration,objects=[];
 db.exec('PRAGMA foreign_keys=OFF');
 try{
  for await(const line of lines(path)){
   const item=JSON.parse(line);
   if(!header){header=item;if(header.format!=='lt360-installation-backup-v1')throw new SnapshotError('Unsupported snapshot.');if(!key){if(!privateKey)throw new SnapshotError('A private agency recovery key is required.');key=privateDecrypt({key:createPrivateKey({key:privateKey,format:'jwk'}),oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(header.key,'base64'));}if(key.length!==32)throw new SnapshotError('Invalid snapshot key.');continue;}
   if(ended||item.i!==position)throw new SnapshotError('Snapshot records are missing or reordered.');
   const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(item.iv,'base64'));cipher.setAAD(Buffer.from('lt360:'+position));cipher.setAuthTag(Buffer.from(item.tag,'base64'));
   const plain=Buffer.concat([cipher.update(Buffer.from(item.data,'base64')),cipher.final()]),record=JSON.parse(plain);position++;
   if(record.type==='end'){if(record.sha256!==digest.digest('hex')||record.records!==position-1)throw new SnapshotError('Snapshot integrity check failed.');ended=true;continue;}
   digest.update(plain);
   if(record.type==='schema'){
    objects=record.objects;
    if(expectedSchema && JSON.stringify(objects)!==JSON.stringify(expectedSchema))throw new SnapshotError('Restore requires the same reviewed database schema as the backup.');
    for(const o of objects.filter(o=>o.type==='table'))db.exec(o.sql);
   }
   else if(record.type==='rows'){if(!objects.some(o=>o.type==='table'&&o.name===record.table))throw new SnapshotError('Unknown backup table.');const insert=db.prepare(`INSERT INTO ${identifier(record.table)}(${record.columns.map(identifier).join(',')}) VALUES(${record.columns.map(()=>'?').join(',')})`);for(const row of record.rows){insert.run(...row.map(uncell));rows++;}}
   else if(record.type==='image'){const bytes=Buffer.from(record.data,'base64');if(hash(bytes)!==record.sha256||bytes.length!==record.bytes)throw new SnapshotError('JPEG backup integrity check failed.');if(restoredImages.has(record.name))throw new SnapshotError('Duplicate image in backup.');
    restoredImages.set(record.name,bytes.length);images++;if(onImage)await onImage(record.name,bytes);}
   else if(record.type==='configuration')configuration=record.value;
   else throw new SnapshotError('Unknown snapshot record.');
  }
  if(!ended||!configuration)throw new SnapshotError('The snapshot was interrupted.');
  if(objects.some(o=>o.type==='table'&&o.name==='photos')){
   for(const photo of db.prepare('SELECT id,bytes FROM photos WHERE ready=1').iterate()){
    if(restoredImages.get(photo.id)!==photo.bytes)throw new SnapshotError('A ready photo is missing or incomplete in the restored backup. Retry after image storage is available.');
   }
  }
  for(const o of objects.filter(o=>o.type!=='table'))db.exec(o.sql);
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new SnapshotError('The restored database failed integrity checks.');
  return {database:db,images,rows,configuration};
 }catch(error){db.close();throw error;}
}

export async function createSnapshot({path,publicKey,query,listImages,readImage,configuration,onProgress=async()=>{},maxDatabaseBytes=64*1024*1024}){
 const key=randomBytes(32),file=await open(path,'wx',0o600),digest=createHash('sha256');let position=0,databaseBytes=0;
 const append=async record=>{const bytes=Buffer.from(JSON.stringify(record));if(bytes.length>8*1024*1024)throw new SnapshotError('A backup record exceeds the supported pilot size.');if(record.type!=='end')digest.update(bytes);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('lt360:'+position));const data=Buffer.concat([cipher.update(bytes),cipher.final()]);await file.write(JSON.stringify({i:position++,iv:encode(iv),tag:encode(cipher.getAuthTag()),data:encode(data)})+'\n');};
 try{
  const wrapping=createPublicKey({key:publicKey,format:'jwk'});if(wrapping.asymmetricKeyType!=='rsa'||wrapping.asymmetricKeyDetails.modulusLength<3072)throw new SnapshotError('Invalid public backup key.');
  const wrapped=publicEncrypt({key:wrapping,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key);
  await file.write(JSON.stringify({format:'lt360-installation-backup-v1',key:encode(wrapped)})+'\n');
  const objects=await snapshotSchema(query);
  await append({type:'schema',objects});
  const required=new Map();
  for(const table of objects.filter(o=>o.type==='table'&&!transient(o.name))){
   const info=await query(`PRAGMA table_info(${identifier(table.name)})`),columns=info.map(c=>c.name),withoutRowid=/\bWITHOUT\s+ROWID\b/i.test(table.sql);
   const keys=withoutRowid?info.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name):['rowid','_rowid_','oid'].filter(name=>!columns.some(c=>c.toLowerCase()===name)).slice(0,1);
   if(!keys.length||columns.includes('__lt360_cursor__'))throw new SnapshotError('This table requires an operator-assisted backup.');
   const tuple='('+keys.map(identifier).join(',')+')';let last=null;
   for(;;){const select=withoutRowid?'*':`${identifier(keys[0])} AS __lt360_cursor__,*`,where=last?` WHERE ${keys.length===1?identifier(keys[0]):tuple}>${keys.length===1?'?':'('+keys.map(()=>'?').join(',')+')'}`:'',results=await query(`SELECT ${select} FROM ${identifier(table.name)}${where} ORDER BY ${keys.map(identifier).join(',')} LIMIT 200`,last??[]);if(!results.length)break;if(table.name==='photos')for(const row of results)if(row.ready===1)required.set(row.id,row.bytes);const tail=results.at(-1);last=withoutRowid?keys.map(k=>tail[k]):[tail.__lt360_cursor__];const rows=results.map(row=>columns.map(c=>cell(row[c]))),record={type:'rows',table:table.name,columns,rows};databaseBytes+=Buffer.byteLength(JSON.stringify(record));if(databaseBytes>maxDatabaseBytes)throw new SnapshotError('This database needs an operator-assisted backup before updating; the pilot backup size limit was reached.');await append(record);}
  }
  const inventory=new Set(required.keys());
  for await(const image of listImages()) inventory.add(image.name);
  const names=[...inventory];
  async function readVerified(name){
   for(let attempt=0;;attempt++){
    try{
     const bytes=Buffer.from(await readImage(name));
     if(required.has(name)&&bytes.length!==required.get(name))throw new SnapshotError('A required photo is incomplete.');
     if(bytes.length>4*1024*1024)throw new SnapshotError('An image exceeds the supported backup size.');
     return bytes;
    }catch(error){
     if(error.retryable===false || attempt>=2 || (!required.has(name)&&!error.retryable)){
      if(required.has(name))throw new SnapshotError('A required apartment photo could not be backed up. Wait for image storage to finish and retry the update.');
      throw error;
     }
     await new Promise(resolve=>setTimeout(resolve,Math.max(250*2**attempt,error.retryDelay??0)));
    }
   }
  }
  for(let i=0;i<names.length;i+=3){
   await onProgress('images',i,names.length);
   const batch=names.slice(i,i+3);
   const payloads=await Promise.all(batch.map(readVerified));
   for(const [index,bytes] of payloads.entries())await append({type:'image',name:batch[index],bytes:bytes.length,sha256:hash(bytes),data:encode(bytes)});
  }
  await append({type:'configuration',value:configuration});await append({type:'end',records:position,sha256:digest.digest('hex')});await file.sync();await file.close();
  await onProgress('verify',names.length,names.length);
  const verified=await verifySnapshot(path,{key});verified.database.close();
  const checksum=createHash('sha256');for await(const chunk of createReadStream(path))checksum.update(chunk);
  return {photoInventoryVerified:true,restoreVerified:true,configurationPreserved:true,covers:['d1','kv','configuration'],sha256:checksum.digest('hex'),rows:verified.rows,images:verified.images};
 }finally{key.fill(0);await file.close().catch(()=>{});}
}

export const snapshotSchema = query => query("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name <> 'd1_migrations' ORDER BY type,name");
