import {readFile} from 'node:fs/promises';import {verifySnapshot} from './snapshot.mjs';
import {createReadStream} from 'node:fs';import {createHash} from 'node:crypto';
try{
const [snapshot,keyFile,expectedDigest]=process.argv.slice(2);if(!snapshot||!keyFile||!/^[a-f0-9]{64}$/.test(expectedDigest??''))throw Error('Provide the encrypted backup, separate private agency recovery file and trusted SHA-256 reference from Administrator update history.');
const hash=createHash('sha256');for await(const chunk of createReadStream(snapshot))hash.update(chunk);if(hash.digest('hex')!==expectedDigest)throw Error('The file does not match the trusted backup reference.');
const recovery=JSON.parse(await readFile(keyFile,'utf8'));if(recovery.format!=='lt360-recovery-key-v1')throw Error('Unsupported agency recovery file.');
const checked=await verifySnapshot(snapshot,{privateKey:recovery.privateKey});
console.log(JSON.stringify({verified:true,restoredRows:checked.rows,verifiedImages:checked.images,configurationIncluded:!!checked.configuration.secretEnvelope}));checked.database.close();
}catch{console.error('Backup verification failed. Check the backup, private recovery file and trusted reference locally. No credentials or underlying errors are printed.');process.exitCode=1;}
