import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {unstable_readConfig} from 'wrangler';

const configPath='wrangler.jsonc';
const config=unstable_readConfig({config:configPath});
const db=config.d1_databases.find(item=>item.binding==='DB');
const kv=config.kv_namespaces.find(item=>item.binding==='PHOTOS');
const actor=config.durable_objects.bindings.find(item=>item.name==='STAFF_LOGIN');
const d1Placeholder='00000000-0000-0000-0000-000000000001';

if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(db?.database_id??'') ||
    db.database_id===d1Placeholder || (db.preview_database_id && db.preview_database_id===db.database_id) ||
    !/^[a-f0-9]{32}$/.test(kv?.id??'') || kv.id==='00000000000000000000000000000001' ||
    (kv.preview_id && kv.preview_id===kv.id) || actor?.class_name!=='StaffLogin' || actor.script_name ||
    config.vars.OFFICIAL_DEPLOY!=='1' || config.workers_dev!==true || config.preview_urls!==false ||
    config.assets?.binding!=='ASSETS' || !config.compatibility_flags.includes('nodejs_compat')){
  console.error('Deploy stopped before contacting Cloudflare. Select this agency’s D1 and KV resources and use the template’s Worker and preview settings.');
  process.exit(1);
}

const wrangler=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
for (const args of [['d1','migrations','apply','DB','--remote'],['deploy']]){
  const result=spawnSync(process.execPath,[wrangler,...args,'--config',configPath],{stdio:'inherit',windowsHide:true});
  if(result.status!==0){
    console.error('Agency deploy stopped. Review the Cloudflare build step and retry using the same Worker and resources.');
    process.exit(result.status??1);
  }
}
