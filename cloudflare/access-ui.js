let cached;
export const getAccess=()=>cached??=(async()=>{const r=await fetch('/api/staff/me');if(!r.ok)throw Error('Staff session ended. Sign in again.');return r.json();})();
export function can(access,key){return access.permissions===null||!!access.permissions[key];}
export function applyAccess(access){
 if(access.permissions===null)for(const n of document.querySelectorAll('a[href="/staff/uploads"],#manage-uploads'))n.hidden=true;
 const rules=[['a[href="/staff/guest-links"],a[href^="/staff/guest-links?"]','invitation.view'],['a[href="/staff/accounts"],#staff-accounts','accounts.manage'],['a[href*="new=1"]','apartment.create'],['#cleanup','storage.cleanup'],['#import,#guide-import','backup.import'],['#guide-backup','backup.export'],['#guide-publish','apartment.publish'],['#guide-add-stitch,#guide-replace,.upload-drop,.guide-dialog input[type=file]','image.upload'],['.share-card-actions','invitation.create'],['#mass-toggle,#select-eligible','invitation.multi.create']];
 for(const [selector,key]of rules)if(!(key==='invitation.view'?(can(access,'invitation.view')||can(access,'invitation.create')):can(access,key)))for(const node of document.querySelectorAll(selector)){node.hidden=true;if(node.id==='guide-import')node.closest('label').hidden=true;}
 if(!can(access,'apartment.edit'))for(const node of document.querySelectorAll('.guide-actions,#guide-steps,#guide-prev,#guide-next,#guide-start,#tour-review'))node.hidden=true;

 if(!can(access,'apartment.edit')){const title=document.getElementById('guide-title');if(title){title.readOnly=true;title.disabled=true;}}
 const labels={'Edit':'apartment.edit','Edit draft':'apartment.edit','Export .shtour':'backup.export','Export Backup':'backup.export','Publish latest draft':'apartment.publish','Publish apartment':'apartment.publish','Unpublish':'apartment.unpublish','Archive':'apartment.archive','Remove':'apartment.archive','Restore as draft':'backup.import','Create Guest Link':'invitation.create','Edit apartment selection':'invitation.create','Revoke link':'invitation.revoke','Regenerate phrase':'invitation.regenerate','Share':'invitation.create','Replace Stitch':'image.upload'};
 for(const node of document.querySelectorAll('button,a')){const key=labels[node.textContent.trim()];if(key&&!can(access,key))node.hidden=true;}
 if(!can(access,'invitation.create'))for(const n of document.querySelectorAll('.workspace-tools button:not(#share-more),#mass-panel'))n.hidden=true;
 if(access.role==='administrator'&&access.permissions!==null&&!document.querySelector('#uac-entry')){const nav=document.querySelector('main>nav,.guide-nav');if(nav){const a=document.createElement('a');a.id='uac-entry';a.className='button secondary';a.href='/staff/uac';a.textContent='User Access Control';nav.append(a);}}
}
getAccess().then(a=>{let pending=false;const apply=()=>{pending=false;applyAccess(a);};apply();new MutationObserver(()=>{if(!pending){pending=true;queueMicrotask(apply);}}).observe(document.body,{childList:true,subtree:true});}).catch(()=>{});
