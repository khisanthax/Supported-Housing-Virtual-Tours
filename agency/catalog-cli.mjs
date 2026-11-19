// Read-only global OAuth catalog discovery. Never registers a client or reads
// agency apartments. Tokens remain in memory and are never printed or copied.
import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {homedir} from 'node:os';import {requiredScopes} from './operations.mjs';
try{
 const args=process.argv.slice(2),index=args.indexOf('--output');if(index<0||!args[index+1])throw Error();let token;
 if(process.env.AGENCY_CATALOG_BEARER_FILE)token=(await readFile(process.env.AGENCY_CATALOG_BEARER_FILE,'utf8')).trim();
 else if(args.includes('--from-wrangler'))for(const path of [join(homedir(),'.wrangler/config/default.toml'),join(homedir(),'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),join(homedir(),'AppData/Local/.wrangler/config/default.toml')]){try{token=/^oauth_token\s*=\s*"([^"\r\n]+)"/m.exec(await readFile(path,'utf8'))?.[1];if(token)break;}catch{}}
 if(!token)throw Error();const response=await fetch('https://api.cloudflare.com/client/v4/oauth/scopes',{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error();const value=await response.json();if(!value.success||!Array.isArray(value.result))throw Error();
 const names=[...requiredScopes.map(s=>s.name),'Billing Read'],scopes=value.result.filter(s=>names.includes(s.name));await writeFile(args[index+1],JSON.stringify({checked:new Date().toISOString().slice(0,10),source:'https://api.cloudflare.com/client/v4/oauth/scopes',scopes,unavailable:names.filter(name=>!scopes.some(s=>s.name===name))},null,2)+'\n');
 console.log(JSON.stringify({readOnly:true,confirmedScopeIds:scopes.map(s=>s.id),unavailable:names.filter(name=>!scopes.some(s=>s.name===name)),registered:false}));
}catch{console.error('Read-only catalog discovery could not complete. Use an authorized local publisher session or protected bearer file and an output path. No credentials or underlying errors are printed.');process.exitCode=1;}
