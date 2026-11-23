import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {link,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {backup,DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

const format=Buffer.from('LT360HUB1');
const headerLength=format.length+8+12;
const tagLength=16;
const maxBytes=64*1024*1024;
const retention=30*86400000;
const idPattern=/^LT-(\d{3,12})$/;

function backupKey(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))throw Error('Provide an independent 256-bit Hub backup key.');
  const key=Buffer.from(value,'base64url');
  if(key.length!==32||key.toString('base64url')!==value)throw Error('Provide an independent 256-bit Hub backup key.');
  return key;
}

function checkDatabase(db){
  if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('Hub SQLite integrity check failed.');
  const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('tickets','history')").all();
  if(tables.length!==2||!db.prepare('PRAGMA table_info(tickets)').all().some(field=>field.name==='issue_sealed')||
    !db.prepare('PRAGMA table_info(history)').all().some(field=>field.name==='note_sealed'))
    throw Error('The archive must contain an upgraded Help Hub database.');
}

async function boundedRead(path,limit){
  const file=await stat(path);
  if(!file.isFile()||file.size<=0||file.size>limit)throw Error('The Hub file exceeds the supported archive limit or is invalid.');
  const bytes=await readFile(path);
  if(bytes.length!==file.size)throw Error('The Hub file changed while it was read.');
  return bytes;
}

export async function backUpHub(database,archive,keyValue){
  const key=backupKey(keyValue);
  const working=await mkdtemp(join(dirname(resolve(database)),'.lt360-hub-archive-'));
  const copy=join(working,'database.sqlite');
  try{
    const source=new DatabaseSync(database,{readOnly:true});
    try{
      checkDatabase(source);
      await backup(source,copy);
    }finally{source.close();}
    const bytes=await boundedRead(copy,maxBytes);
    const header=Buffer.concat([format,Buffer.alloc(8),randomBytes(12)]);
    header.writeBigUInt64BE(BigInt(Date.now()),format.length);
    const cipher=createCipheriv('aes-256-gcm',key,header.subarray(-12));
    cipher.setAAD(header);
    try{
      const envelope=Buffer.concat([header,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);
      await writeFile(archive,envelope,{flag:'wx',mode:0o600});
    }finally{bytes.fill(0);}
  }finally{
    key.fill(0);
    await rm(working,{recursive:true,force:true});
  }
}

function purgeSequences(purged){
  if(!Array.isArray(purged)||purged.length>10000)throw Error('Provide the deletion list for this Hub, even when it is empty.');
  return [...new Set(purged.map(ticket=>{
    const match=typeof ticket==='string'&&idPattern.exec(ticket);
    const seq=match&&Number(match[1]);
    if(!seq||'LT-'+String(seq).padStart(3,'0')!==ticket)throw Error('Invalid ticket in the deletion list.');
    return seq;
  }))];
}

export async function restoreHub(archive,destination,keyValue,purged){
  const removed=purgeSequences(purged);
  const key=backupKey(keyValue);
  const working=await mkdtemp(join(dirname(resolve(destination)),'.lt360-hub-recovery-'));
  const copy=join(working,'database.sqlite');
  try{
    const envelope=await boundedRead(archive,maxBytes+headerLength+tagLength);
    if(envelope.length<=headerLength+tagLength||!envelope.subarray(0,format.length).equals(format))throw Error('Unrecognized Hub backup.');
    const header=envelope.subarray(0,headerLength);
    const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(-12));
    decipher.setAAD(header);
    decipher.setAuthTag(envelope.subarray(-tagLength));
    let plain;
    try{plain=Buffer.concat([decipher.update(envelope.subarray(headerLength,-tagLength)),decipher.final()]);}
    catch{throw Error('Hub backup authentication failed.');}
    try{
      const now=Date.now(),created=Number(header.readBigUInt64BE(format.length));
      if(!Number.isSafeInteger(created)||created>now+60000||created<=now-retention)throw Error('The Hub backup is outside the recovery retention window.');
      await writeFile(copy,plain,{flag:'wx',mode:0o600});
      const db=new DatabaseSync(copy);
      try{
        checkDatabase(db);
        db.exec('PRAGMA secure_delete=ON; BEGIN IMMEDIATE;');
        db.prepare(`UPDATE tickets SET status='closed',transition=? WHERE status IN ('pending','activating','active')`).run(now);
        db.exec('UPDATE tickets SET sealed=NULL, approved=NULL, session_expires=NULL;');
        const deleteHistory=db.prepare('DELETE FROM history WHERE ticket=?');
        const deleteTicket=db.prepare('DELETE FROM tickets WHERE seq=?');
        for(const seq of removed){deleteHistory.run(seq);deleteTicket.run(seq);}
        db.prepare('DELETE FROM tickets WHERE coalesce(transition,created)<=?').run(now-retention);
        db.prepare('DELETE FROM history WHERE at<=? OR NOT EXISTS(SELECT 1 FROM tickets WHERE seq=history.ticket)').run(now-retention);
        db.exec('COMMIT');
        checkDatabase(db);
      }finally{db.close();}
      // Stage beside the destination. Publishing a hard link is exclusive and
      // cannot expose a partially copied database after an interrupted restore.
      await link(copy,destination);
    }finally{plain.fill(0);}
  }finally{
    key.fill(0);
    await rm(working,{recursive:true,force:true});
  }
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const [action,source,destination,manifest]=process.argv.slice(2);
    const key=process.env.LT360_HUB_BACKUP_KEY;
    if(action==='backup'&&source&&destination&&!manifest)await backUpHub(source,destination,key);
    else if(action==='restore'&&source&&destination&&manifest)
      await restoreHub(source,destination,key,JSON.parse(await boundedRead(manifest,1048576)));
    else throw Error('Expected backup DATABASE ARCHIVE or restore ARCHIVE NEW_DATABASE DELETION_LIST_JSON.');
    console.log(action==='backup'?'Encrypted Hub archive prepared.':'Isolated Hub recovery copy prepared with all old grants closed.');
  }catch{
    console.error('Hub maintenance failed. Check paths, retention, the deletion list and the protected backup key.');
    process.exitCode=1;
  }
}
