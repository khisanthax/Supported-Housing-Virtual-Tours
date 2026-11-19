const $ = id => document.getElementById(id);
const say = text => { if ($('message').textContent !== text) $('message').textContent = text; };
const endpoint = '/api/staff/maintenance';
let catalogLoaded=false;
let state, publicKey, verified = false, generation = 0, selection = 0, timer, pending = false;
async function api(suffix = '', options) {
  const response = await fetch(endpoint + suffix, options);
  if(response.status===401||response.status===403){const error=Error('Sign in with an active Administrator account to see update progress.');error.status=response.status;throw error;}
  const value = await response.json();
  if (!response.ok) throw Error(value.error || 'Sign in again and retry.');
  return value;
}
const jsonRequest = (method, body) => ({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function fingerprint(modulus) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(modulus));
  return [...new Uint8Array(digest).slice(0,8)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function allowApproval() {
  $('approve').disabled = pending || !verified || !$('confirmed').checked;
}
function download(value,name) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('key').onclick = async () => {
  generation++; selection++; verified=false; publicKey=null; $('saved').value='';
  $('confirmed').checked=false; $('key').disabled=true; $('saved').disabled=true; allowApproval();
  try {
    const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
    const pub=await crypto.subtle.exportKey('jwk',pair.publicKey),id=await fingerprint(pub.n);
    download({format:'lt360-recovery-key-v1',installation:state.installed.installation,publicKey:pub,privateKey:await crypto.subtle.exportKey('jwk',pair.privateKey)},'LevelTwo360-PRIVATE-'+id+'.json');
    publicKey=pub; $('saved').disabled=false;
    say('Select the saved recovery file ending in '+id+' to check it on this device.');
  } catch {say('The recovery file could not be generated. Try again.');}
  finally {$('key').disabled=false;}
};
function invalidateFile() {selection++; verified=false; $('confirmed').checked=false; allowApproval();}
$('saved').addEventListener('cancel',invalidateFile);
$('saved').onchange=async () => {
  invalidateFile(); const attempt=selection,version=generation,file=$('saved').files[0];
  try {
    if(!file || file.size>32768)throw Error();
    const data=JSON.parse(await file.text());
    if(data.format!=='lt360-recovery-key-v1'||data.installation!==state.installed.installation)throw Error();
    const algo={name:'RSA-OAEP',hash:'SHA-256'};
    const pub=await crypto.subtle.importKey('jwk',publicKey,algo,false,['encrypt']);
    const priv=await crypto.subtle.importKey('jwk',data.privateKey,algo,false,['decrypt']);
    const challenge=crypto.getRandomValues(new Uint8Array(32));
    const cipher=await crypto.subtle.encrypt(algo,pub,challenge);
    const answer=new Uint8Array(await crypto.subtle.decrypt(algo,priv,cipher));
    if(answer.length!==challenge.length||!answer.every((b,i)=>b===challenge[i]))throw Error();
    if(version!==generation||attempt!==selection)return;
    verified=true; say('Recovery file verified. Review the release and confirm below.');
  } catch {if(attempt===selection)say('This file could not unlock the backup key. Select the latest recovery file.');}
  allowApproval();
};
$('confirmed').onchange=allowApproval;
async function renderRows(rows, target='requests'){
 const boxes=[];
 for(const row of rows){
  const box=document.createElement('section'),p=document.createElement('p');
  const id=row.modulus?await fingerprint(row.modulus):null;
  p.textContent=[new Date(row.created).toLocaleString(),row.version,row.revoked?'approval revoked':row.phase,row.message,id&&'Recovery file '+id].filter(Boolean).join(' · ');
  box.append(p);
  if(row.backup_digest){
   const button=document.createElement('button');button.textContent='Copy backup verification reference';
   button.onclick=async()=>{try{await navigator.clipboard.writeText(row.backup_digest);say('Backup reference copied. Store it separately.');}catch{say('Backup SHA-256: '+row.backup_digest);}};box.append(button);
  }
  if(!row.revoked && row.expires>Date.now() && !['complete','recovered'].includes(row.phase)){
   const button=document.createElement('button');button.textContent='Revoke update approval';
   button.onclick=async()=>{try{await api('',jsonRequest('DELETE',{id:row.id}));await refresh();}catch(e){say(e.message);}};box.append(button);
  }
  boxes.push(box);
 }
 $(target).replaceChildren(...boxes);
}
async function refresh(){
 clearTimeout(timer);
 const {locked,request,installed,companion}=await api('?view=status');
 if(state?.installed?.build!==installed.build){catalogLoaded=false;state={installed};}
 $('installed').textContent='Installed: '+installed.version;
 $('technical').textContent='Build '+installed.build+' · schema '+installed.schema;
 if(companion && new URL(companion).protocol==='https:'){$('companion').href=new URL(companion).origin;$('companion').hidden=false;}
 const active=locked || (request && !request.revoked && request.expires>Date.now() && !['complete','recovered'].includes(request.phase));
 if(!active && !catalogLoaded){
  state=await api();catalogLoaded=true;
  if(state.available){$('version').textContent='Available: '+state.available.version;$('notes').textContent=state.available.notes;}
 }
 $('handoff').hidden=!active;$('candidate').hidden=!!active||!state.available;
 await renderRows(request?[request]:[]);
 const terminal=['complete','recovered'].includes(request?.phase);
 const expired=request && !terminal && request.expires<=Date.now();
 const recovery=locked && (terminal || expired || request?.revoked || !request || request.phase==='operator-recovery-required');
 $('handoff-title').textContent=recovery?'Resume installation recovery':'Authorize infrastructure access';
 $('handoff-message').textContent=recovery?'Reconnect to the original account and installation. Resume this request to verify the website and restore editing.':'Your approval lasts two hours. Open the deployment service, reconnect to Cloudflare and choose this request for your original installation.';
 say(recovery?'Editing is paused until the installation is verified.':request?.revoked?'Update approval revoked.':expired?'Update approval expired. Review the current release to approve a new request.':request?.message||(active?'Update approval is recorded. Open the deployment service to continue.':state.notice));
 if(active){
  $('request').textContent=request?'Update request: '+request.id:'Ask your authorized infrastructure operator to inspect the maintenance lock.';
  if(!document.hidden)timer=setTimeout(poll,5000);
 }
}
function poll(){refresh().catch(error=>{if(error.status===401||error.status===403){say(error.message);$('candidate').hidden=true;$('handoff').hidden=true;$('requests').replaceChildren();$('history').hidden=true;return;}say('Progress connection interrupted. Reconnecting…');if(!document.hidden)timer=setTimeout(poll,10000);});}
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden&&state)poll();});
$('show-history').onclick=async()=>{
 const panel=$('history'),button=$('show-history');
 if(!panel.hidden){panel.hidden=true;button.textContent='Show update history';button.setAttribute('aria-expanded','false');return;}
 button.disabled=true;
 try{
  const data=await api('?view=history');await renderRows(data.requests,'history');
  for(const event of data.history){const p=document.createElement('p');p.textContent=new Date(event.created).toLocaleString()+' · '+event.event;panel.append(p);}
  panel.hidden=false;button.textContent='Hide update history';button.setAttribute('aria-expanded','true');
 }catch(e){say(e.message);}finally{button.disabled=false;}
};
$('approve').onclick=async()=>{
 if(pending||!verified||!$('confirmed').checked)return;
 pending=true;allowApproval();
 try{await api('',jsonRequest('POST',{manifestSha256:state.available.manifestSha256,publicKey,recoverySaved:true,confirm:true}));verified=false;await refresh();}
 catch(e){say(e.message+' Refresh to check whether approval was recorded.');}
 finally{pending=false;allowApproval();}
};
poll();
