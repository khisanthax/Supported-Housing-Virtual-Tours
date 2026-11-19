import {createHash,sign} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join,relative,sep} from 'node:path';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const safe=path=>typeof path==='string'&&path.length<240&&!path.includes('\\')&&!path.startsWith('/')&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!p.endsWith('.')&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)&&/^[a-zA-Z0-9_.-]+$/.test(p));

export function additiveStatements(sql){
 if(typeof sql!=='string'||sql.length>100000||/--|\/\*|['"`\[]/.test(sql))throw Error('Migration requires separate review: comments or quoted expressions are not supported by the additive updater.');
 const statements=sql.split(';').map(s=>s.trim()).filter(Boolean);
 for(const statement of statements){if(!/^CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\s+IF\s+NOT\s+EXISTS\s+[a-z_][a-z0-9_]*/i.test(statement)||/\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|TRIGGER|REPLACE|PRAGMA|ATTACH|DETACH)\b/i.test(statement))throw Error('Only reviewed additive CREATE TABLE/INDEX IF NOT EXISTS statements are allowed.');}
 return statements;
}

export async function unpackArtifact(bytes,directory){
 if(!Buffer.isBuffer(bytes)||bytes.length>64*1024*1024)throw Error('Artifact exceeds the supported size.');
 const value=JSON.parse(bytes);if(value.format!=='lt360-release-v1'||typeof value.worker!=='string'||Buffer.byteLength(value.worker)>16*1024*1024||!Array.isArray(value.assets)||!Array.isArray(value.migrations))throw Error('Invalid update artifact.');
 const paths=new Set();for(const asset of value.assets){if(!safe(asset.path)||paths.has(asset.path.toLowerCase())||!Number.isSafeInteger(asset.bytes)||asset.bytes<0||asset.bytes>25*1024*1024)throw Error('Unsafe or duplicate release asset.');paths.add(asset.path.toLowerCase());const data=Buffer.from(asset.data,'base64');if(data.length!==asset.bytes||sha256(data)!==asset.sha256)throw Error('Release asset integrity failed.');}
 let previous=0;for(const migration of value.migrations){if(!Number.isSafeInteger(migration.version)||migration.version<=previous)throw Error('Migrations must have distinct ascending schema versions.');previous=migration.version;additiveStatements(migration.sql);}
 // Validate every entry before creating files. Only a private, new job directory
 // supplied by the update service is accepted; the signed artifact names no paths
 // outside its assets directory and contains no deployment configuration.
 await mkdir(directory,{recursive:false,mode:0o700});
 await writeFile(join(directory,'worker.mjs'),value.worker,{flag:'wx',mode:0o600});
 await mkdir(join(directory,'assets'),{mode:0o700});
 for(const asset of value.assets){const target=resolve(directory,'assets',...asset.path.split('/'));await mkdir(resolve(target,'..'),{recursive:true,mode:0o700});await writeFile(target,Buffer.from(asset.data,'base64'),{flag:'wx',mode:0o600});}
 return {worker:join(directory,'worker.mjs'),assets:join(directory,'assets'),migrations:value.migrations};
}

export async function packageArtifact({worker,assets,migrations=[]}){
 const files=[];async function visit(directory){for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Release assets must not contain symbolic links.');const path=join(directory,entry.name);if(entry.isDirectory())await visit(path);else{const bytes=await readFile(path);files.push({path:relative(assets,path).split(sep).join('/'),bytes:bytes.length,sha256:sha256(bytes),data:bytes.toString('base64')});}}}await visit(assets);
 const bytes=Buffer.from(JSON.stringify({format:'lt360-release-v1',worker:await readFile(worker,'utf8'),assets:files.sort((a,b)=>a.path.localeCompare(b.path)),migrations}));
 if(bytes.length>64*1024*1024)throw Error('Release artifact exceeds the supported size.');return bytes;
}

export function signedManifest({artifact,privateKey,...metadata}){const bytes=Buffer.from(JSON.stringify({...metadata,artifactSha256:sha256(artifact)}));return {bytes,signature:sign(null,bytes,privateKey)};}
