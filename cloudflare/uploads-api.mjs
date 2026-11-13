import { authorize, effectivePermission } from './access-policy.mjs';
export async function uploadsApi({db,principal,username,sessionHash,method,input,list,fail}){
 const row=await db.prepare('SELECT * FROM uploads_gallery WHERE id=1').bind().first();
 if(!row)fail(503,'Uploads Gallery is not configured.');
 const queued=JSON.parse(row.apartments),manage=effectivePermission(principal,'uploads.manage').allowed;
 if(method==='GET'){
  const apartments=(await list()).filter(a=>!a.archived&&queued.includes(a.id)&&authorize(principal,'apartment.view',{id:a.id}).allowed&&(manage||authorize(principal,'image.upload',{id:a.id}).allowed));
  const summaries=(await db.prepare("SELECT actor,resource,action,created FROM activity_history WHERE action LIKE 'uploads.saved.%' AND status=201 ORDER BY id DESC LIMIT 1000").bind().all()).results;
  for(const a of apartments){const last=summaries.find(r=>r.resource===a.id);if(last)a.lastUpload={actor:last.actor,count:Number(last.action.split('.').at(-1)),created:last.created};}
  return {apartments,queued:queued.filter(id=>authorize(principal,'apartment.view',{id}).allowed),revision:row.revision,manage};
 }
 if(!manage)fail(403,'Only Administrators and designated Supervisors can manage Uploads.');
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail(400,'Reload the current Uploads selection before saving.');
 if(!['add','remove'].includes(input.action)||!Array.isArray(input.apartments)||!input.apartments.length||input.apartments.length>100||new Set(input.apartments).size!==input.apartments.length)fail(400,'Select apartments and Add or Remove.');
 const available=await list();
 for(const id of input.apartments)if(!authorize(principal,'uploads.manage',{id}).allowed||!available.some(a=>a.id===id&&(input.action==='remove'||!a.archived)))fail(403,'Apartment is not available in your assigned scope.');
 const next=input.action==='add'?[...new Set([...queued,...input.apartments])]:queued.filter(id=>!input.apartments.includes(id));
 if(next.length>1000)fail(400,'Uploads queue is full.');
 const result=await db.prepare(`UPDATE uploads_gallery SET apartments=?,revision=revision+1,changed_by=?,changed_at=?
 WHERE id=1 AND revision=? AND EXISTS(SELECT 1 FROM staff_sessions s JOIN staff_accounts a USING(username)
 WHERE s.token=? AND a.username=? AND a.disabled=0 AND a.revision=s.revision AND s.expires>?)`).bind(JSON.stringify(next),username,Date.now(),input.expectedRevision,sessionHash,username,Date.now()).run();
 if(!result.meta.changes)fail(409,'Uploads selection or session changed. Reload before retrying.');
 return {ok:true,revision:row.revision+1};
}
