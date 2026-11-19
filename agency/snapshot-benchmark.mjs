// Synthetic snapshot phase only. Run once per size in a fresh Node process.
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSnapshot} from './snapshot.mjs';
const count=Number(process.argv[2]||32), delay=Number(process.argv[3]||30);
const dir=await mkdtemp(join(tmpdir(),'lt360-bench-')),path=join(dir,'sample.enc');
const image=Buffer.alloc(1024*1024,42),key=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey;
let reads=0,queries=0,verifyStart;
const start=performance.now();
try {
 await createSnapshot({path,publicKey:key.export({format:'jwk'}),configuration:{synthetic:true},
  query:async()=>{queries++;return []},listImages:async function*(){for(let i=0;i<count;i++)yield {name:String(i)}},
  readImage:async()=>{reads++;await new Promise(r=>setTimeout(r,delay));return image},
  onProgress:async stage=>{if(stage==='verify')verifyStart??=performance.now()}});
 console.log(JSON.stringify({images:count,inputMiB:count,delayMs:delay,elapsedMs:Math.round(performance.now()-start),
 verificationAndHashMs:verifyStart?Math.round(performance.now()-verifyStart):null,outputMiB:(await stat(path)).size/2**20,
 reads,queries,peakRSSMiB:process.resourceUsage().maxRSS/1024}));
}finally{await rm(dir,{recursive:true,force:true})}
