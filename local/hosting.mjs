// Maintainer-only deployment preparation. No account information enters app assets.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export function staticSiteConfig({name,account,directory}){
 if(!/^[a-z][a-z0-9-]{3,50}$/.test(name)||!/^[a-f0-9]{32}$/.test(account))throw Error('Invalid dedicated website configuration.');
 if(name.includes('synthetic-pilot')||name.includes('firebase'))throw Error('Refusing to target an existing online application.');
 return {name,account_id:account,compatibility_date:'2026-11-03',workers_dev:true,preview_urls:false,observability:{enabled:false},assets:{directory:resolve(directory),html_handling:'none',not_found_handling:'none'}};
}
export async function stageStaticSite(directory){
 const source=new URL('./generated/',import.meta.url),manifest=JSON.parse(await readFile(new URL('assets.json',source)));
 await mkdir(directory,{recursive:true});
 // Fresh stage required: never sweep unrelated files into an upload.
 const {readdir}=await import('node:fs/promises');if((await readdir(directory)).length)throw Error('Use a fresh, empty private staging directory.');
 for(const path of [...manifest.files,'/assets.json','/_headers','/_redirects']){
  if(!/^\/[a-zA-Z0-9_./-]+$/.test(path)||path.includes('..')||/\.(jpg|jpeg|shtour|zip|db|sqlite)$/i.test(path))throw Error('Not an application asset.');
  const target=join(directory,path.slice(1));await mkdir(dirname(target),{recursive:true});await writeFile(target,await readFile(new URL('.'+path,source)));
 }
 return manifest;
}
