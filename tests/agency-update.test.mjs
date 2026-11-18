import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {verifiedUpdate,applyApprovedUpdate} from '../agency/update.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const pem=publicKey.export({type:'spki',format:'pem'}),artifact=Buffer.from('Synthetic tested release artifact');
const installed={installation:'a'.repeat(32),version:'0.2.0',schema:4,build:'1'.repeat(40),deployment:'synthetic-previous'};
const manifest={edition:'cloudflare',version:'0.2.1',schema:4,from:['0.2.0'],fromSchemas:[4],migration:'additive',build:'2'.repeat(40),artifactSha256:hash(artifact),notes:'Synthetic compatible release; no destructive migrations.'};
const releaseFor=value=>{const bytes=Buffer.from(JSON.stringify(value));return verifiedUpdate({bytes,signature:sign(null,bytes,privateKey),publicKey:pem,installed});};

test('update verification rejects tampered, unsigned, incompatible, older and destructive releases',()=>{
 assert.equal(releaseFor(manifest).version,'0.2.1');
 const bytes=Buffer.from(JSON.stringify(manifest)),signature=sign(null,bytes,privateKey);bytes[0]^=1;assert.throws(()=>verifiedUpdate({bytes,signature,publicKey:pem,installed}),/signature/);
 for(const change of [{version:'1.0.0'},{version:'0.2.0'},{from:[]},{fromSchemas:[3]},{schema:3},{migration:'destructive'},{edition:'local'},{artifactSha256:'bad'}])assert.throws(()=>releaseFor({...manifest,...change}));
});

function fixture(){const release=releaseFor(manifest),events=[];const approval={installation:installed.installation,fromBuild:installed.build,manifestSha256:release.manifestSha256,version:release.version,expires:Date.now()+600000};return {events,options:{release,installed,approval,artifact,authorize:async()=>({administratorActive:true,infrastructureAuthorized:true,installation:installed.installation,build:installed.build}),backup:async()=>({restoreVerified:true,configurationPreserved:true,covers:['d1','kv','configuration'],sha256:'3'.repeat(64)}),deploy:async args=>{events.push(args);return {deployment:'synthetic-next'};},health:async()=>({ready:true,build:release.build,schema:release.schema}),rollbackCode:async args=>events.push(args),progress:async stage=>events.push(stage)}};}

test('compatible updates require approval for the exact build and installation, fresh dual authorization and verified backups',async()=>{
 const unverified=fixture();unverified.options.release={...unverified.options.release};await assert.rejects(applyApprovedUpdate(unverified.options),/signature verification/);
 for(const change of [{installation:'other'},{fromBuild:'other'},{version:'0.2.2'},{manifestSha256:'other'},{expires:0},{revoked:true}]){const {options,events}=fixture();options.approval={...options.approval,...change};await assert.rejects(applyApprovedUpdate(options),/approval/);assert.equal(events.length,0);}
 for(const authority of [{administratorActive:false},{infrastructureAuthorized:false},{installation:'other'}]){const {options,events}=fixture();const original=await options.authorize();options.authorize=async()=>({...original,...authority});await assert.rejects(applyApprovedUpdate(options),/authorization/);assert.equal(events.length,0);}
 const f=fixture();f.options.backup=async()=>({covers:['d1'],restoreVerified:true});await assert.rejects(applyApprovedUpdate(f.options),/complete, verified/);assert.deepEqual(f.events,['backing-up']);
});

test('approval revocation during backup prevents deployment; success preserves configuration and secrets',async()=>{
 const f=fixture();let checks=0;const original=f.options.authorize;f.options.authorize=async()=>({...await original(),administratorActive:++checks===1});await assert.rejects(applyApprovedUpdate(f.options),/changed during backup/);assert.deepEqual(f.events,['backing-up']);
 const g=fixture();const result=await applyApprovedUpdate(g.options);assert.equal(result.version,'0.2.1');assert.equal(g.events[2].preserveSecrets,true);assert.equal(g.events[2].additiveOnly,true);assert.equal(g.events.at(-1),'complete');
});

test('failed verification rolls back code without restoring old data, and failed recovery remains explicit',async()=>{
 const f=fixture();f.options.health=async()=>({ready:false});await assert.rejects(applyApprovedUpdate(f.options),/Previous code was restored/);const recovery=f.events.find(x=>x?.previousDeployment);assert.equal(recovery.preserveCurrentData,true);assert.equal(recovery.preserveSecrets,true);assert.equal(f.events.at(-1),'recovered');
 const g=fixture();g.options.deploy=async()=>{throw Error('sensitive vendor error');};g.options.rollbackCode=async()=>{throw Error('sensitive recovery error');};await assert.rejects(applyApprovedUpdate(g.options),/automatic code recovery could not be confirmed/);assert.equal(g.events.at(-1),'operator-recovery-required');
});
