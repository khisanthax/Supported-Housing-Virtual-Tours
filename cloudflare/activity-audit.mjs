import {createHash} from 'node:crypto';
export async function activityEnvelope(request){
 const path=new URL(request.url).pathname,m=request.method;
 const patterns=[[/^\/api\/staff\/uploads$/,'uploads.manage'],[/^\/api\/staff\/sign-in$/,'staff.sign-in'],[/^\/api\/staff\/sign-out$/,'staff.sign-out'],[/^\/api\/staff\/accounts$/,'staff.accounts'],[/^\/api\/staff\/uac$/,'permissions.manage'],[/^\/api\/staff\/photos$/,'photo.upload'],[/^\/api\/staff\/apartments(?:\/[a-f0-9]{32})?$/,'apartment.save'],[/^\/api\/staff\/shares(?:\/[a-f0-9]{32}(?:\/phrase)?)?$/,'invitation.manage'],[/^\/api\/guest\/unlock$/,'guest.unlock']];
 if(m==='GET'&&!/^\/api\/staff\/tours\/[a-f0-9]{32}\/manifest$/.test(path))return null;
 if(m==='GET')return {action:'backup.export',resource:path.match(/[a-f0-9]{32}/)[0],sessionHash:(()=>{const raw=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-sht_staff='))?.slice('__Host-sht_staff='.length);return raw?createHash('sha256').update(raw).digest('hex'):null;})(),username:null};const found=patterns.find(([r])=>r.test(path));if(!found)return null;
 let body={};if(request.headers.get('Content-Type')?.startsWith('application/json')){const reader=request.clone().body?.getReader();if(reader){const chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>131072){reader.cancel().catch(()=>{});break;}chunks.push(value);}if(size<=131072)try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{}}}
 const action=['publish','unpublish','archive','remove','restore','reset','enable','disable'].includes(body.action)?body.action:null;
 const raw=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-sht_staff='))?.slice('__Host-sht_staff='.length);
 const sessionHash=raw?createHash('sha256').update(raw).digest('hex'):null;
 const username=/^[a-z0-9][a-z0-9._-]{2,63}$/.test(body.username??'')?body.username:null;
 const uploadBody=found[1]==='apartment.save'&&body.purpose==='uploads';
 const uploadPhoto=found[1]==='photo.upload'&&new URL(request.url).searchParams.get('purpose')==='uploads';
 const uploadApartment=uploadBody?body.replacement:uploadPhoto?new URL(request.url).searchParams.get('apartment'):null;
 if(uploadBody||uploadPhoto)return {action:uploadBody?'uploads.save':'uploads.photo',resource:/^[a-f0-9]{32}$/.test(uploadApartment??'')?uploadApartment:null,sessionHash,username:null};
 return {action:found[1]+(action?'.'+action:''),resource:path.match(/[a-f0-9]{32}/)?.[0]??(found[1]==='staff.accounts'?username:null),sessionHash,username};
}
export async function recordActivity(db,envelope,status){
 if(!envelope)return;
 const session=envelope.sessionHash?await db.prepare('SELECT username FROM staff_sessions WHERE token=?').bind(envelope.sessionHash).first():null;
 const actor=envelope.actor??session?.username??(envelope.action==='staff.sign-in'&&envelope.username?'sign-in:'+envelope.username:'anonymous');
 await db.prepare('INSERT INTO activity_history(actor,action,resource,status,created) VALUES(?,?,?,?,?)').bind(actor,envelope.action,envelope.resource,status,Date.now()).run();
 if(envelope.action==='staff.sign-in'&&status===200&&envelope.username)await db.prepare('INSERT INTO staff_login_history VALUES(?,?) ON CONFLICT(username) DO UPDATE SET last_login=excluded.last_login').bind(envelope.username,Date.now()).run();
}
