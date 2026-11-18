import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {installationConfig,schemaFiles} from '../cloudflare/install.mjs';
import {setupDigest} from '../cloudflare/agency-setup.mjs';
import {release} from '../cloudflare/release.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export const identifier=/^[a-f0-9]{32}$/;
export const installationName=/^[a-z][a-z0-9-]{3,37}$/;
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export class SetupError extends Error {constructor(message){super(message);this.name='SetupError';}}

export function freePlan(subscriptions,verifiedFreePlanIds){
 // An empty list, a $0 trial, a zone Free plan, or a denied billing read is NOT
 // evidence of Workers Free. Exact Workers plan IDs must be confirmed at live
 // acceptance against the publisher's read-only API response.
 const workers=subscriptions.filter(s=>s.rate_plan?.scope==='workers'&&!['Cancelled','Expired','Failed'].includes(s.state));
 return workers.length===1&&workers[0].price===0&&workers[0].state==='Provisioned'&&verifiedFreePlanIds.includes(workers[0].rate_plan.id);
}

export function cloudflareApi(token,fetcher=fetch){
 return async(path,{method='GET',body}={})=>{
  const r=await fetcher('https://api.cloudflare.com/client/v4'+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  // Raw Cloudflare errors may contain operational identifiers. Never log or
  // return them to the browser, and never retry a mutation blindly.
  if(r.status===401||r.status===403)throw new SetupError('Cloudflare authorization is missing or has expired. Reconnect, select the same installation, and retry.');
  const data=await r.json();
  if(!r.ok||!data.success)throw new SetupError('Cloudflare could not complete this step. Check permissions, free allowances and resource availability, then retry the same installation.');
  return data.result;
 };
}

export function wranglerRunner({token,account}){
 return (args,stdin='')=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account,WRANGLER_SEND_METRICS:'false',CI:'true'}});
  const timeout=setTimeout(()=>child.kill(),120000);timeout.unref();
  let output='',overflow=false;
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>8*1024*1024){overflow=true;child.kill();}});
  child.stderr.on('data',()=>{}); // never retain verifier/secret-bearing CLI errors
  child.stdin.on('error',()=>{});child.stdin.end(stdin);
  child.on('error',()=>{clearTimeout(timeout);reject(new SetupError('The deployment service could not start its provisioning tool. No account has been reset.'));});
  child.on('close',code=>{clearTimeout(timeout);code||overflow?reject(new SetupError('The deployment step failed. Reconnect if needed and retry this installation; resources and accounts are preserved.')):resolve(output);});
 });
}

export async function saveJournal(path,value){
 const temporary=path+'.'+randomBytes(8).toString('hex')+'.tmp';
 await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,path);
}

// The companion serializes jobs by account/installation. It is intentionally a
// single-process service until a distributed, transactional job store is added.
export async function provision({account,name,directory,api,run,verifiedFreePlanIds,progress=()=>{},build,fetcher=fetch}){
 if(!identifier.test(account)||!installationName.test(name)||!build)throw new SetupError('Select a valid account, installation name and verified build.');
 progress('Checking your Workers Free plan');
 if(!freePlan(await api(`/accounts/${account}/subscriptions`),verifiedFreePlanIds))throw new SetupError('Workers Free could not be verified for this account. Nothing has been provisioned. Check the Workers plan in Cloudflare; a Free website plan is different. No upgrade or payment method will be requested.');
 const subdomain=await api(`/accounts/${account}/workers/subdomain`);
 if(!/^[a-z0-9-]+$/.test(subdomain?.subdomain??''))throw new SetupError('First choose your free workers.dev website address in the Cloudflare dashboard, then return here and retry.');
 await mkdir(directory,{recursive:true,mode:0o700});const path=join(directory,'installation.json');
 let state;try{state=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new SetupError('The saved installation record needs operator review. No resources were changed.');}
 if(state&&(state.account!==account||state.name!==name))throw new SetupError('This saved installation belongs to a different account or name.');
 if(!state){state={account,name,installation:randomBytes(16).toString('hex'),resourceName:name+'-'+randomBytes(6).toString('hex')};await saveJournal(path,state);}
 const persist=()=>saveJournal(path,state);
 const origin=`https://${state.resourceName}.${subdomain.subdomain}.workers.dev`;
 if(state.origin&&state.origin!==origin)throw new SetupError('The Cloudflare website address changed. An authorized infrastructure operator must review the saved installation.');
 // Inspect all existing Worker bindings before any write to an existing Worker.
 const scripts=await api(`/accounts/${account}/workers/scripts`);
 if(scripts.some(s=>s.id===state.resourceName)){
  const settings=await api(`/accounts/${account}/workers/scripts/${state.resourceName}/settings`);
  const binding=settings.bindings?.find(b=>b.name==='INSTALLATION_ID');
  if(binding?.text!==state.installation)throw new SetupError('That Worker already exists and is not this installation. It will not be overwritten.');
  const health=await fetcher(origin+'/api/installation-health',{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(health.ok&&(await health.json()).ready)return {ready:true,website:origin};
  if(!state.database)throw new SetupError('The existing Worker has no matching saved database. No resources were changed.');
  const existing=await api(`/accounts/${account}/d1/database/${state.database}/query`,{method:'POST',body:{sql:'SELECT COUNT(*) n FROM staff_accounts'}});
  if(existing[0]?.results?.[0]?.n)throw new SetupError('An Administrator already exists but website health could not be verified. Ask an authorized infrastructure operator to inspect it. No migration or deployment was attempted.');
 }
 progress('Preparing independent agency storage');
 if(!state.database){
  const databases=await api(`/accounts/${account}/d1/database?per_page=100`);
  let found=databases.find(d=>d.name===state.resourceName);
  if(found&&!state.databaseIntent)throw new SetupError('A conflicting database exists. It will not be reused.');
  if(!found){state.databaseIntent=true;await persist();found=await api(`/accounts/${account}/d1/database`,{method:'POST',body:{name:state.resourceName}});}
  state.database=found.uuid;await persist();
 }
 if(!state.namespace){
  const namespaces=await api(`/accounts/${account}/storage/kv/namespaces?per_page=1000`);
  let found=namespaces.find(n=>n.title===state.resourceName);
  if(found&&!state.namespaceIntent)throw new SetupError('A conflicting image store exists. It will not be reused.');
  if(!found){state.namespaceIntent=true;await persist();found=await api(`/accounts/${account}/storage/kv/namespaces`,{method:'POST',body:{title:state.resourceName}});}
  state.namespace=found.id;await persist();
 }
 const config=installationConfig({...state,name:state.resourceName,origin,build});
 config.vars.AGENCY_BROWSER_SETUP='1';
 const configPath=join(directory,'wrangler.json');await saveJournal(configPath,config);
 progress('Initializing the database safely');
 for(const schema of [...schemaFiles,'agency-setup-schema.sql'])await run(['d1','execute','DB','--remote','--config',configPath,'--file',join(root,'cloudflare',schema),'--yes']);
 const query=async sql=>{
  const results=await api(`/accounts/${account}/d1/database/${state.database}/query`,{method:'POST',body:{sql}});
  if(!results.every(r=>r.success!==false))throw new SetupError('Database initialization failed. Retry this installation.');
  return results[0]?.results??[];
 };
 if((await query('SELECT COUNT(*) n FROM staff_accounts'))[0]?.n)throw new SetupError('An Administrator already exists. Sign in at '+origin+'/staff. Deployment retries never reset accounts or upgrade an installation.');
 const ticket=randomBytes(32).toString('base64url'),expires=Date.now()+10*60*1000;
 await query(`INSERT INTO agency_setup(id,installation,token_digest,expires) SELECT 1,${quote(state.installation)},${quote(setupDigest(ticket))},${expires} WHERE NOT EXISTS(SELECT 1 FROM staff_accounts)
 ON CONFLICT(id) DO UPDATE SET token_digest=excluded.token_digest,expires=excluded.expires WHERE agency_setup.completed IS NULL AND agency_setup.installation=excluded.installation AND NOT EXISTS(SELECT 1 FROM staff_accounts)`);
 progress('Deploying your private installation');
 // Never replace an existing guest secret. A pending installation has no usable
 // guest invitations, so a lost first-secret response is recovered by inspection.
 if(!scripts.some(s=>s.id===state.resourceName)){
  await run(['deploy','--config',configPath]);
 }
 const secrets=JSON.parse(await run(['secret','list','--config',configPath]));
 if(!secrets.some(s=>s.name==='GUEST_CODE_KEY'))await run(['secret','put','GUEST_CODE_KEY','--config',configPath],randomBytes(32).toString('hex'));
 await run(['deploy','--config',configPath]);
 state.origin=origin;await persist();
 const health=await fetcher(origin+'/api/installation-health',{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!health.ok)throw new SetupError('Your website is still becoming available. Retry this same installation in a moment.');
 const checked=await health.json();if(checked.schema!==release.schema||!checked.prepared)throw new SetupError('The database or required storage bindings are not ready. Retry preparation before creating an Administrator.');
 return {ready:checked.ready,website:origin,...(!checked.ready?{ticket,expires}:{})};
}
