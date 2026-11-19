const $=id=>document.getElementById(id);let timer;
history.replaceState(null,'',location.pathname);
const message=text=>$('message').textContent=text;
async function state(){
 const response=await fetch('/api/state'),data=await response.json();
 $('connect').hidden=data.connected||data.running||!!data.result;
 $('choose').hidden=!data.connected||data.running||!!data.result;
 $('disconnect').hidden=!data.connected||data.running;
 const current=$('account').value;$('account').replaceChildren(...data.accounts.map(a=>new Option(a.name,a.id)));if(current)$('account').value=current;
 if(!data.freeVerificationAvailable&&data.connected)message('This preview cannot yet verify Workers Free. The owner must complete the read-only plan verification before agency deployment can proceed.');
 if(data.running){message(data.progress||'Preparing your installation…');timer=setTimeout(()=>state().catch(()=>message('Connection interrupted. Refresh to check your existing setup job.')),1000);return;}
 if(data.error)message(data.error);
 if(data.result){
  const result=data.result,url=new URL(result.website);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.workers.dev')||url.pathname!=='/')throw Error('Unexpected installation address');
  $('next').hidden=false;$('address').textContent=result.website;
  if(result.phase){$('next').querySelector('h2').textContent=result.phase==='complete'?'Update complete':'Previous code recovered';$('next').querySelector('p').textContent='Your existing accounts and apartment data are retained. Open your website, or reconnect below to download the encrypted installation backup and review update history.';$('setup-expiry').hidden=true;$('reconnect').hidden=false;}
  $('open').href=result.website+(result.ready||result.phase?'/staff':'/setup#'+result.ticket);
  $('open').textContent=result.ready||result.phase?'Open LevelTwo360':'Continue agency setup';
  $('revocation').textContent=result.revoked?'The temporary Cloudflare deployment token has been revoked.':'The deployment service discarded its token but could not confirm revocation. Revoke this application in Cloudflare’s authorized applications before continuing.';
  message('');
 }
}
$('deploy').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;
 try{const r=await fetch('/api/deploy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:$('account').value,name:$('name').value,freeConfirmed:$('free').checked})});const data=await r.json();if(!r.ok)message(data.error);else await state();}catch{message('Connection interrupted. Refresh to check setup before retrying.');}finally{button.disabled=false;}
};
$('disconnect').onclick=async()=>{clearTimeout(timer);const r=await fetch('/api/disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await r.json();if(!r.ok){message(data.error);return;}location.reload();};
const selected=()=>({account:$('account').value,name:$('name').value});
async function updates(){
 const r=await fetch('/api/updates/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selected())}),data=await r.json();if(!r.ok){message(data.error);return;}
 $('updates').hidden=false;$('update-list').replaceChildren(...data.requests.map(row=>{const section=document.createElement('section'),p=document.createElement('p');p.textContent=`${row.version} · ${row.phase}${row.revoked?' · approval revoked':''} · ${new Date(row.created).toLocaleString()}`;section.append(p);
  if(!['complete','recovered'].includes(row.phase)){const button=document.createElement('button');button.textContent=row.phase==='approved'?'Apply approved update':'Resume / recover update';button.onclick=async()=>{button.disabled=true;const response=await fetch('/api/updates/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...selected(),requestId:row.id})});const result=await response.json();if(!response.ok){message(result.error);button.disabled=false;}else{message('Preparing the approved update…');await state();}};section.append(button);}
  if(row.backup_digest){const download=document.createElement('button');download.textContent='Download encrypted installation backup';download.onclick=async()=>{download.disabled=true;try{const response=await fetch('/api/updates/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...selected(),requestId:row.id})});if(!response.ok){message((await response.json()).error);return;}const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='LevelTwo360-encrypted-installation.lt360backup';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Keep the encrypted backup separately from the private recovery file.');}catch{message('Download interrupted. Reconnect and retry; the encrypted backup is retained.');}finally{download.disabled=false;}};section.append(download);}return section;}));
 if(!data.requests.length)message('No update is approved. An Administrator must review Software updates on your agency website first.');
}
$('inspect-updates').onclick=()=>updates().catch(()=>message('The saved installation could not be inspected. Check the original account and installation name.'));
state().catch(()=>message('Setup is temporarily unavailable. Refresh to reconnect. Your existing installation is preserved.'));
