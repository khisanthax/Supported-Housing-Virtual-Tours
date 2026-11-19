import {readFile,mkdir,writeFile} from 'node:fs/promises';import {resolve,join,sep} from 'node:path';import {fileURLToPath} from 'node:url';
import {registrationConfiguration} from './operations.mjs';
const args=process.argv.slice(2),get=key=>args[args.indexOf(key)+1],origin=get('--origin'),build=get('--build'),output=resolve(get('--output')??''),root=resolve(fileURLToPath(new URL('../',import.meta.url)));
if(!args.includes('--output')||output.toLowerCase()===root.toLowerCase()||output.toLowerCase().startsWith(root.toLowerCase()+sep))throw Error('Choose an absolute protected output directory outside the source checkout.');
const catalog=JSON.parse(await readFile(args.includes('--catalog')?get('--catalog'):new URL('./oauth-scopes.verified.json',import.meta.url),'utf8'));
const configuration=registrationConfiguration({origin,catalog,build});await mkdir(output,{recursive:true,mode:0o700});
for(const [name,value]of [['private-oauth-registration.json',configuration.registration],['deployment-preflight.json',configuration.preflight]])await writeFile(join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
await writeFile(join(output,'companion.env.example'),Object.entries(configuration.environment).map(([key,value])=>key+'='+value).join('\n')+'\n',{flag:'wx',mode:0o600});
console.log('Prepared private OAuth request and deployment configuration. No Cloudflare registration, publication, DNS, billing or deployment operation was executed. Workers Free verification remains blocked as described in deployment-preflight.json.');
