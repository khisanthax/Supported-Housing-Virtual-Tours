import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';import {join,resolve,sep} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {packageArtifact,signedManifest,additiveStatements} from './artifact.mjs';import {provisioningEnvironment} from './cloudflare.mjs';import {release} from '../cloudflare/release.mjs';
const args=process.argv.slice(2),get=key=>args[args.indexOf(key)+1],root=resolve(fileURLToPath(new URL('../',import.meta.url))),build=get('--build'),output=resolve(get('--output')??'');
if(!/^[a-f0-9]{40}$/.test(build??'')||!args.includes('--private-key-file')||!args.includes('--output')||output.toLowerCase()===root.toLowerCase()||output.toLowerCase().startsWith(root.toLowerCase()+sep))throw Error('Supply a tested source SHA, protected signing-key file and new output directory outside the checkout.');
if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==build)throw Error('The source checkout does not match the approved build.');execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:root});
const from=get('--from')?.split(','),fromSchemas=get('--from-schemas')?.split(',').map(Number),notes=await readFile(get('--notes-file'),'utf8'),migrations=args.includes('--migrations-file')?JSON.parse(await readFile(get('--migrations-file'),'utf8')):[];
if(!from?.length||!fromSchemas?.length||fromSchemas.some(s=>!Number.isSafeInteger(s)))throw Error('Specify supported source versions and schemas.');for(const m of migrations)additiveStatements(m.sql);
const temporary=await mkdtemp(join(tmpdir(),'lt360-release-'));
try{
 execFileSync(process.execPath,['cloudflare/prepare.mjs'],{cwd:root,stdio:'ignore'});
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--compatibility-flag','nodejs_compat','--config','cloudflare/wrangler.jsonc','--outdir',temporary],{cwd:root,stdio:'ignore',windowsHide:true,env:provisioningEnvironment({token:'unused-local-dry-run',account:'0'.repeat(32)})});
 const artifact=await packageArtifact({worker:join(temporary,'worker.js'),assets:join(root,'cloudflare','generated'),migrations}),privateKey=await readFile(get('--private-key-file'));
 const signed=signedManifest({artifact,privateKey,...release,build,from,fromSchemas,migration:'additive',notes});privateKey.fill(0);
 await mkdir(output,{recursive:false,mode:0o700});for(const [name,bytes]of [['manifest.json',signed.bytes],['release.sig',signed.signature.toString('base64')],['artifact.lt360release',artifact]])await writeFile(join(output,name),bytes,{flag:'wx',mode:0o600});
 console.log('Prepared signed release artifact. No release was published or deployed. Approve the pinned public key and verify this artifact in isolated acceptance before configuring the companion.');
}finally{await rm(temporary,{recursive:true,force:true});}
