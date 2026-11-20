// Loaded ONLY by the isolated capture build. Production exports remain encrypted.
import {exportBackup as secureExport,readBackup as secureRead} from '/dist/backup-ui-secure.js';
import {packTour,unpackTour,MAX_TOTAL} from '/dist/tour-package.js';
import {zipSync,unzipSync} from '/dist/vendor/backup-crypto.js';
import {backupFilename} from '/dist/backup-name.js';
export async function exportBackup(loadDraft,name){
 const d=document.createElement('dialog');d.className='backup-test-options';
 d.innerHTML='<form><h2>Export test backup</h2><p>Encrypted backup is the default.</p><label><input name="plain" type="checkbox"> Testing only: ZIP without a passphrase</label><p>Unencrypted ZIPs contain readable photographs and tour data. Keep them private.</p><button type="submit">Continue</button><button type="button">Cancel</button></form>';
 document.body.append(d);
 const choice=await new Promise(resolve=>{const finish=x=>{d.close();d.remove();resolve(x)};d.querySelector('form').onsubmit=e=>{e.preventDefault();finish(d.querySelector('input').checked)};d.querySelector('[type=button]').onclick=()=>finish(null);d.oncancel=e=>{e.preventDefault();finish(null)};d.showModal()});
 if(choice===null)return false;if(!choice)return secureExport(loadDraft,name);
 const draft=typeof loadDraft==='function'?await loadDraft():loadDraft,packed=packTour(draft),bytes=zipSync({'apartment.shtour':new Uint8Array(await packed.arrayBuffer())},{level:0});
 const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=backupFilename(name||draft.tour.title).replace('.shtour.zip','-UNENCRYPTED.shtour.zip');a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);return true;
}
export async function readBackup(file,trace){
 if(file.size<MAX_TOTAL+300000){
  const start=new Uint8Array(await file.slice(0,2).arrayBuffer());if(start[0]===80&&start[1]===75){
   let valid=true,encrypted=false;const entries=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:e=>{if(['encryption.json','apartment.bin'].includes(e.name)){encrypted=true;return false}if(e.name!=='apartment.shtour'||e.originalSize>MAX_TOTAL+200000){valid=false;return false}return true}});
   if(encrypted)return secureRead(file,trace);
   if(!valid||Object.keys(entries).length!==1)throw Error('Invalid unencrypted test backup ZIP.');
   return unpackTour(new Blob([entries['apartment.shtour']]));
  }
 }
 return secureRead(file,trace);
}
