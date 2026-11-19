import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,privateDecrypt,createDecipheriv} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {createSnapshot,verifySnapshot} from '../agency/snapshot.mjs';
import {sealConfiguration} from '../cloudflare/maintenance.mjs';
import {unpackArtifact,additiveStatements,packageArtifact,sha256} from '../agency/artifact.mjs';
import {execFileSync,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const rsa=generateKeyPairSync('rsa',{modulusLength:3072}),publicKey={...rsa.publicKey.export({format:'jwk'}),alg:'RSA-OAEP-256',key_ops:['encrypt'],ext:true},privateKey=rsa.privateKey.export({format:'jwk'});

test('full installation snapshot restores actual database rows, image bytes and sealed secrets, with no plaintext credential file',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'lt360-snapshot-'));t.after(()=>rm(dir,{recursive:true,force:true}));const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,verifier TEXT,photo BLOB);CREATE TABLE sessions(token TEXT);CREATE TABLE maintenance_lock(id INTEGER);INSERT INTO accounts VALUES('synthetic','Synthetic credential verifier',X'010203');INSERT INTO sessions VALUES('Synthetic transient session');");
 const secret=await sealConfiguration(publicKey,{GUEST_CODE_KEY:'Synthetic secret never on disk'}),path=join(dir,'backup.enc'),bytes=Buffer.from('Synthetic JPEG bytes');
 const snapshot=await createSnapshot({path,publicKey,query:async(sql,args=[])=>db.prepare(sql).all(...args),listImages:async function*(){yield {name:'synthetic-image'};},readImage:async()=>bytes,configuration:{state:{installation:'a'.repeat(32)},secretEnvelope:secret,bindings:{DB:'synthetic'}}});
 assert.equal(snapshot.restoreVerified,true);const ciphertext=await readFile(path);assert.ok(!ciphertext.includes(Buffer.from('Synthetic credential verifier')));assert.ok(!ciphertext.includes(bytes));assert.ok(!ciphertext.includes(Buffer.from('Synthetic secret never on disk')));
 const restored=await verifySnapshot(path,{privateKey,onImage:async(name,image)=>{assert.equal(name,'synthetic-image');assert.deepEqual(image,bytes);}});t.after(()=>restored.database.close());
 assert.equal(restored.database.prepare('SELECT verifier FROM accounts').get().verifier,'Synthetic credential verifier');assert.deepEqual(Buffer.from(restored.database.prepare('SELECT photo FROM accounts').get().photo),Buffer.from([1,2,3]));assert.equal(restored.database.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
 const sealed=restored.configuration.secretEnvelope,key=privateDecrypt({key:rsa.privateKey,oaepHash:'sha256'},Buffer.from(sealed.key,'base64')),cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(sealed.iv,'base64')),data=Buffer.from(sealed.data,'base64');cipher.setAuthTag(data.subarray(-16));const configuration=JSON.parse(Buffer.concat([cipher.update(data.subarray(0,-16)),cipher.final()]));assert.equal(configuration.GUEST_CODE_KEY,'Synthetic secret never on disk');
 const keyFile=join(dir,'PRIVATE-recovery.json'),target=join(dir,'new-recovery');await writeFile(keyFile,JSON.stringify({format:'lt360-recovery-key-v1',installation:'a'.repeat(32),privateKey}));
 const root=fileURLToPath(new URL('../',import.meta.url));const result=JSON.parse(execFileSync(process.execPath,['agency/recover-backup.mjs',path,keyFile,snapshot.sha256,target],{cwd:root,encoding:'utf8'}));assert.equal(result.productionModified,false);const recovered=new DatabaseSync(join(target,'installation.sqlite'));assert.equal(recovered.prepare('SELECT verifier FROM accounts').get().verifier,'Synthetic credential verifier');recovered.close();assert.equal(JSON.parse(await readFile(join(target,'configuration-PRIVATE.json'),'utf8')).recoveredSecrets.GUEST_CODE_KEY,'Synthetic secret never on disk');
 const denied=spawnSync(process.execPath,['agency/recover-backup.mjs',path,keyFile,snapshot.sha256,target],{cwd:root,encoding:'utf8'});assert.equal(denied.status,1);assert.ok(!denied.stderr.includes('Synthetic secret never on disk'));assert.equal(JSON.parse(await readFile(join(target,'configuration-PRIVATE.json'),'utf8')).recoveredSecrets.GUEST_CODE_KEY,'Synthetic secret never on disk');
 await assert.rejects(verifySnapshot(path,{privateKey:generateKeyPairSync('rsa',{modulusLength:3072}).privateKey.export({format:'jwk'})}));
 await writeFile(join(dir,'truncated.enc'),ciphertext.subarray(0,ciphertext.length-20));await assert.rejects(verifySnapshot(join(dir,'truncated.enc'),{privateKey}));
 const records=ciphertext.toString().trimEnd().split('\n');records.splice(2,1);await writeFile(join(dir,'missing.enc'),records.join('\n')+'\n');await assert.rejects(verifySnapshot(join(dir,'missing.enc'),{privateKey}),/missing or reordered/);
});

test('snapshot rejects storage/network failure and database budget overflow without declaring a restore-verified backup',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'lt360-snapshot-fail-'));t.after(()=>rm(dir,{recursive:true,force:true}));const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec("CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES('oversized synthetic row');");
 const options={publicKey,query:async(sql,args=[])=>db.prepare(sql).all(...args),listImages:async function*(){yield {name:'image'};},readImage:async()=>{throw Error('synthetic interruption');},configuration:{synthetic:true}};
 await assert.rejects(createSnapshot({...options,path:join(dir,'overflow.enc'),maxDatabaseBytes:1}),/operator-assisted/);
 await assert.rejects(createSnapshot({...options,path:join(dir,'interrupted.enc')}),/interruption/);
 await assert.rejects(verifySnapshot(join(dir,'interrupted.enc'),{privateKey}),/interrupted/);
});

test('backup keyset pagination retains negative rowids and composite WITHOUT ROWID keys without repeated OFFSET scans',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lt360-keyset-'));t.after(()=>rm(directory,{recursive:true,force:true}));const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE ordinary(id TEXT PRIMARY KEY,value TEXT);CREATE TABLE paired(group_id TEXT,n INTEGER,value TEXT,PRIMARY KEY(group_id,n)) WITHOUT ROWID;CREATE TABLE diagnostic_settings(id INTEGER PRIMARY KEY,level TEXT)');db.exec("INSERT INTO ordinary(rowid,id,value) VALUES(-10,'negative','retained');INSERT INTO diagnostic_settings VALUES(1,'normal')");
 const ordinary=db.prepare('INSERT INTO ordinary(id,value) VALUES(?,?)'),paired=db.prepare('INSERT INTO paired VALUES(?,?,?)');for(let i=0;i<450;i++){ordinary.run('id-'+i,'value-'+i);paired.run(i%2?'a':'b',i,'pair-'+i);}
 let pageReads=0;const result=await createSnapshot({path:join(directory,'snapshot.enc'),publicKey,configuration:{synthetic:true},query:async(sql,args=[])=>{assert.ok(!sql.includes('OFFSET'));if(sql.includes('FROM "ordinary"')||sql.includes('FROM "paired"'))pageReads++;return db.prepare(sql).all(...args);},listImages:async function*(){},readImage:async()=>assert.fail('No images')});assert.ok(pageReads<=8);
 const restored=await verifySnapshot(join(directory,'snapshot.enc'),{privateKey});t.after(()=>restored.database.close());assert.equal(restored.database.prepare('SELECT COUNT(*) n FROM ordinary').get().n,451);assert.equal(restored.database.prepare('SELECT COUNT(*) n FROM paired').get().n,450);assert.equal(restored.database.prepare("SELECT value FROM ordinary WHERE id='negative'").get().value,'retained');assert.equal(restored.database.prepare('SELECT level FROM diagnostic_settings').get().level,'normal');assert.equal(result.restoreVerified,true);
});

test('additive updater rejects destructive, executable and ambiguous SQL',()=>{
 assert.equal(additiveStatements('CREATE TABLE IF NOT EXISTS next_table(id TEXT PRIMARY KEY); CREATE INDEX IF NOT EXISTS next_index ON next_table(id);').length,2);
 for(const sql of ['DROP TABLE staff_accounts','CREATE TRIGGER IF NOT EXISTS bad AFTER INSERT ON staff_accounts BEGIN DELETE FROM photos; END','CREATE TABLE IF NOT EXISTS bad AS SELECT * FROM staff_accounts','ALTER TABLE staff_accounts DROP COLUMN role','CREATE TABLE IF NOT EXISTS x(id TEXT); DELETE FROM photos;','CREATE TABLE IF NOT EXISTS x(id TEXT DEFAULT \'secret\')','/* hidden */ CREATE TABLE IF NOT EXISTS x(id TEXT)'])assert.throws(()=>additiveStatements(sql));
});

test('signed artifact container validates all paths and hashes before extracting and supports deterministic packaging',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'lt360-artifact-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(join(dir,'worker.mjs'),'export default {fetch(){return new Response("synthetic")}}');await import('node:fs/promises').then(fs=>fs.mkdir(join(dir,'assets')));await writeFile(join(dir,'assets','index.html'),'Synthetic asset');
 const bytes=await packageArtifact({worker:join(dir,'worker.mjs'),assets:join(dir,'assets')});assert.deepEqual(bytes,await packageArtifact({worker:join(dir,'worker.mjs'),assets:join(dir,'assets')}));
 const unpacked=await unpackArtifact(bytes,join(dir,'good'));assert.equal(await readFile(join(unpacked.assets,'index.html'),'utf8'),'Synthetic asset');
 const value=JSON.parse(bytes);for(const path of ['../escape','/absolute','a/../../escape','a\\escape','CON','NUL.txt','a/trailing.']){value.assets[0].path=path;await assert.rejects(unpackArtifact(Buffer.from(JSON.stringify(value)),join(dir,'bad')),/Unsafe/);}
 value.assets[0].path='index.html';value.assets[0].sha256=sha256('wrong');await assert.rejects(unpackArtifact(Buffer.from(JSON.stringify(value)),join(dir,'bad-hash')),/integrity/);
});
