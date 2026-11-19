import {createHash,verify,createPublicKey} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const version=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const verifiedReleases=new WeakSet();
const newer=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;};
export class UpdateError extends Error{}

// Verification uses the exact signed bytes, not a reserialized JSON document.
// The trust key must be agency-approved infrastructure configuration. Neither
// this function nor a release manifest can replace that key.
export function verifiedUpdate({bytes,signature,publicKey,installed}){
 if(!Buffer.isBuffer(bytes)||bytes.length>65536||!Buffer.isBuffer(signature)||signature.length!==64)throw new UpdateError('Invalid signed release.');
 let key;try{key=createPublicKey(publicKey);}catch{throw new UpdateError('A trusted release signing key has not been configured.');}
 if(key.asymmetricKeyType!=='ed25519'||!verify(null,bytes,key,signature))throw new UpdateError('Release signature verification failed.');
 let candidate;try{candidate=JSON.parse(bytes.toString('utf8'));}catch{throw new UpdateError('Invalid release description.');}
 if(!version.test(candidate.version??'')||!version.test(installed.version??'')||!newer(candidate.version,installed.version)||candidate.version.split('.')[0]!==installed.version.split('.')[0])throw new UpdateError('This release requires a separate migration review or is not newer.');
 if(candidate.edition!=='cloudflare'||candidate.migration!=='additive'||!Array.isArray(candidate.from)||!candidate.from.includes(installed.version)||!Number.isSafeInteger(candidate.schema)||candidate.schema<installed.schema||!Array.isArray(candidate.fromSchemas)||!candidate.fromSchemas.includes(installed.schema))throw new UpdateError('The release is incompatible with this installation.');
 if(!/^[a-f0-9]{64}$/.test(candidate.artifactSha256??'')||!/^[a-f0-9]{40}$/.test(candidate.build??'')||typeof candidate.notes!=='string'||candidate.notes.length<1||candidate.notes.length>16000)throw new UpdateError('The release is missing verified artifact or change information.');
 const release=Object.freeze({...candidate,from:Object.freeze([...candidate.from]),fromSchemas:Object.freeze([...candidate.fromSchemas]),manifestSha256:hash(bytes)});
 verifiedReleases.add(release);return release;
}

// Infrastructure adapters are deliberately explicit. There is no background
// updater and no publisher token. A host must supply fresh authorization,
// agency-owned backup storage, a tested artifact and code-only rollback.
export async function applyApprovedUpdate({release,installed,approval,artifact,authorize,backup,deploy,health,rollbackCode,progress=async()=>{}}){
 if(!verifiedReleases.has(release))throw new UpdateError('The release must pass signature verification in this process before applying.');
 if(!approval||approval.installation!==installed.installation||approval.fromBuild!==installed.build||approval.manifestSha256!==release.manifestSha256||approval.version!==release.version||approval.revoked||!Number.isSafeInteger(approval.expires)||approval.expires<=Date.now())throw new UpdateError('A current Administrator approval for this exact installation and release is required.');
 if(!Buffer.isBuffer(artifact)||hash(artifact)!==release.artifactSha256)throw new UpdateError('The update artifact failed verification.');
 const authority=await authorize(approval);
 if(!authority?.administratorActive||!authority.infrastructureAuthorized||authority.installation!==installed.installation)throw new UpdateError('Active Administrator approval and fresh Cloudflare infrastructure authorization are both required.');
 await progress('backing-up');
 const snapshot=await backup();
 if(!snapshot?.restoreVerified||!snapshot.configurationPreserved||!['d1','kv','configuration'].every(x=>snapshot.covers?.includes(x))||!/^[a-f0-9]{64}$/.test(snapshot.sha256??''))throw new UpdateError('A complete, verified database, JPEG and configuration backup is required. Nothing was deployed.');
 // Revalidate after a potentially long backup, immediately before mutation.
 const current=await authorize(approval);
 if(!current?.administratorActive||!current.infrastructureAuthorized||current.installation!==installed.installation||approval.revoked||approval.expires<=Date.now()||current.build!==installed.build)throw new UpdateError('Authorization or the installed build changed during backup. Nothing was deployed.');
 await progress('applying');
 try{
  const result=await deploy({artifact,release,snapshot,expectedBuild:installed.build,preserveSecrets:true,additiveOnly:true});
  await progress('verifying');
  const status=await health(result);
  if(!status?.ready||status.build!==release.build||status.schema!==release.schema)throw new UpdateError('The new version did not pass installation health checks.');
  await progress('complete');return {version:release.version,build:release.build,backupSha256:snapshot.sha256,deployment:result.deployment};
 }catch{
  await progress('recovering');
  try{await rollbackCode({previousDeployment:installed.deployment,preserveCurrentData:true,preserveSecrets:true});await progress('recovered');}catch{await progress('operator-recovery-required');throw new UpdateError('Update failed and automatic code recovery could not be confirmed. An authorized infrastructure operator must use the retained deployment and backup. Do not overwrite current data.');}
  throw new UpdateError('Update failed. Previous code was restored while retaining current data and secrets. Verify installation health before retrying.');
 }
}
