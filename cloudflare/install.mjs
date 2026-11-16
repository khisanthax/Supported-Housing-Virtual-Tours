import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {input,password,confirm,select} from '@inquirer/prompts';
import {hashStaffPassword,usernamePattern} from './staff-password.mjs';
import {release} from './release.mjs';
export const schemaFiles=['schema.sql','uac-schema.sql','uploads-schema.sql','diagnostics-schema.sql'];
export function installationConfig({name,account,database,namespace,installation,origin='',build}){
 if(!/^[a-z][a-z0-9-]{3,50}$/.test(name)||!/^[a-f0-9]{32}$/.test(account)||!/^[a-f0-9-]{36}$/.test(database)||!/^[a-f0-9]{32}$/.test(namespace))throw Error('Invalid installation resource identifiers.');
 if(!/^[a-f0-9]{32}$/.test(installation??'')||(origin&&!/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/.test(origin)))throw Error('Invalid installation identity or origin.');
 return {name,account_id:account,main:fileURLToPath(new URL('./worker.mjs',import.meta.url)),compatibility_date:'2026-11-03',compatibility_flags:['nodejs_compat'],workers_dev:true,preview_urls:false,assets:{directory:fileURLToPath(new URL('./generated/',import.meta.url)),binding:'ASSETS',run_worker_first:true,html_handling:'none'},d1_databases:[{binding:'DB',database_name:name,database_id:database}],kv_namespaces:[{binding:'PHOTOS',id:namespace}],durable_objects:{bindings:[{name:'STAFF_LOGIN',class_name:'StaffLogin'}]},migrations:[{tag:'staff-login-v1',new_sqlite_classes:['StaffLogin']}],version_metadata:{binding:'CF_VERSION_METADATA'},observability:{logs:{enabled:false}},vars:{INSTALLATION_MODE:'agency',INSTALLATION_ID:installation,APP_ORIGIN:origin,APP_BUILD:build,STAFF_AUTH_MODE:'password',STAFF_ACCOUNTS:'1',STAFF_LOGIN_BACKEND:'worker',TOUR_API_BACKEND:'durable-object',TOUR_UAC:'1',DIAGNOSTICS_ENABLED:'1',SCHEMA_REQUIRED:String(release.schema)}};
}
const repo=fileURLToPath(new URL('../',import.meta.url)),wrangler=join(repo,'node_modules/wrangler/bin/wrangler.js');
async function command(args,{stdin,logDir,quiet=false}={}){
 return new Promise((resolvePromise,reject)=>{const child=spawn(process.execPath,[wrangler,...args],{cwd:repo,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',CI:'true'}});let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);child.stdin.end(stdin??'');child.on('error',reject);child.on('close',async code=>{if(logDir)await writeFile(join(logDir,'last-command.log'),output+'\n'+error,{mode:0o600});if(code)reject(Error('Setup command failed: '+args.slice(0,2).join(' ')+'. See the private installation log; retry resumes without deleting resources.'));else resolvePromise(output);});});
}
function parsed(text){const start=text.search(/[\[{]/);if(start<0)throw Error('Cloudflare returned an unexpected result.');return JSON.parse(text.slice(start));}
async function main(){
 const args=process.argv.slice(2),get=key=>{const n=args.indexOf(key);return n<0?null:args[n+1];},automated=args.includes('--synthetic');
 const name=get('--name')??await input({message:'Installation name (lowercase letters/numbers/hyphens):'});if(!/^[a-z][a-z0-9-]{3,40}$/.test(name))throw Error('Invalid installation name.');
 const dir=join(homedir(),'.virtual-tours',name);await mkdir(dir,{recursive:true,mode:0o700});let state;try{state=JSON.parse(await readFile(join(dir,'installation.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 let who;try{who=parsed(await command(['whoami','--json'],{logDir:dir}));}catch{throw Error('Connect first: run npx wrangler login, approve only its required account/Workers/D1/KV scopes, then retry. Setup has not requested Administrator access or billing changes.');}
 const accounts=who.accounts??[];if(!accounts.length)throw Error('No authorized Cloudflare accounts found.');
 const account=get('--account')??state?.account??await select({message:'Choose your agency Cloudflare account:',choices:accounts.map(a=>({name:a.name,value:a.id}))});if(!accounts.some(a=>a.id===account))throw Error('Selected account is not authorized.');
 if(!args.includes('--free-confirmed')&&!await confirm({message:'Have you confirmed this account is on Workers Free? Setup never upgrades plans or enables payments.',default:false}))throw Error('Stopped before provisioning. Confirm the Free plan in Cloudflare first.');
 process.env.CLOUDFLARE_ACCOUNT_ID=account;
 if(state&&state.account!==account)throw Error('This installation belongs to a different account; choose a new installation name.');
 state??={name,account,installation:randomBytes(16).toString('hex'),resourceName:name+'-'+randomBytes(4).toString('hex')};
 const persist=()=>writeFile(join(dir,'installation.json'),JSON.stringify(state,null,2),{mode:0o600});await persist();
 console.log('Creating or resuming independent resources. Existing pilot resources are not referenced.');
 if(!state.database){const databases=parsed(await command(['d1','list','--json'],{logDir:dir}));let d=databases.find(a=>a.name===state.resourceName);if(!d){await command(['d1','create',state.resourceName],{logDir:dir});d=parsed(await command(['d1','list','--json'],{logDir:dir})).find(a=>a.name===state.resourceName);}if(!d)throw Error('Could not resolve the dedicated database.');state.database=d.uuid;await persist();}
 if(!state.namespace){const namespaces=parsed(await command(['kv','namespace','list'],{logDir:dir}));let n=namespaces.find(a=>(a.title===state.resourceName||a.title.endsWith('-'+state.resourceName)));if(!n){await command(['kv','namespace','create',state.resourceName],{logDir:dir});n=parsed(await command(['kv','namespace','list'],{logDir:dir})).find(a=>a.title===state.resourceName);}if(!n)throw Error('Could not resolve the dedicated private namespace.');state.namespace=n.id;await persist();}
 const build=process.env.VIRTUAL_TOURS_BUILD||release.version;
 const config=installationConfig({...state,name:state.resourceName,origin:state.origin??'',build}),configPath=join(dir,'wrangler.json');const saveConfig=()=>writeFile(configPath,JSON.stringify(config,null,2),{mode:0o600});await saveConfig();
 const {execFileSync}=await import('node:child_process');execFileSync(process.execPath,['cloudflare/prepare.mjs'],{cwd:repo,stdio:'ignore'});
 if(!state.origin){const deployed=await command(['deploy','--config',configPath],{logDir:dir});const origin=/https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(deployed)?.[0];if(!origin)throw Error('Enable your account workers.dev subdomain in Cloudflare, then retry.');state.origin=origin;await persist();config.vars.APP_ORIGIN=origin;await saveConfig();}
 const secrets=parsed(await command(['secret','list','--config',configPath],{logDir:dir}));if(!secrets.some(s=>s.name==='GUEST_CODE_KEY'))await command(['secret','put','GUEST_CODE_KEY','--config',configPath],{stdin:randomBytes(32).toString('hex'),logDir:dir});
 const sql=schemaFiles.map(f=>fileURLToPath(new URL(f,import.meta.url)));for(const f of sql)await command(['d1','execute','DB','--remote','--config',configPath,'--file',f,'--yes'],{logDir:dir});
 const counts=parsed(await command(['d1','execute','DB','--remote','--config',configPath,'--command','SELECT COUNT(*) n FROM staff_accounts','--json'],{logDir:dir}));
 if(!counts[0]?.results?.[0]?.n){const username=get('--admin')??await input({message:'Initial Administrator username:'});if(!usernamePattern.test(username))throw Error('Use a valid lowercase username (3–64 characters).');let pw;if(automated){const chunks=[];for await(const b of process.stdin)chunks.push(b);pw=Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/,'');}else pw=await password({message:'Create Administrator password (15+ characters):',mask:'*'});const verifier=hashStaffPassword(pw);pw='';const quote=v=>"'"+v.replaceAll("'","''")+"'",bootstrap=join(dir,'bootstrap.sql');try{await writeFile(bootstrap,`INSERT INTO staff_accounts(username,password_verifier,role) SELECT ${quote(username)},${quote(verifier)},'administrator' WHERE NOT EXISTS(SELECT 1 FROM staff_accounts);`,{mode:0o600});await command(['d1','execute','DB','--remote','--config',configPath,'--file',bootstrap,'--yes'],{logDir:dir});}finally{await unlink(bootstrap).catch(()=>{});}}else console.log('Administrator already exists; all credentials are preserved.');
 await command(['deploy','--config',configPath],{logDir:dir});
 const r=await fetch(state.origin+'/staff');if(!r.ok||!(await r.text()).includes('Sign in'))throw Error('Installation verification failed. Retry setup; resources and credentials are preserved.');
 console.log('Installation ready: '+state.origin+'/staff');console.log('Private configuration: '+configPath);console.log('Sign in and verify version, permissions, uploads and an encrypted backup before real content.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
