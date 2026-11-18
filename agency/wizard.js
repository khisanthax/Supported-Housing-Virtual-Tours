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
  $('open').href=result.website+(result.ready?'/staff':'/setup#'+result.ticket);
  $('open').textContent=result.ready?'Open LevelTwo360':'Continue agency setup';
  $('revocation').textContent=result.revoked?'The temporary Cloudflare deployment token has been revoked.':'The deployment service discarded its token but could not confirm revocation. Revoke this application in Cloudflare’s authorized applications before continuing.';
  message('');
 }
}
$('deploy').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;
 try{const r=await fetch('/api/deploy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:$('account').value,name:$('name').value,freeConfirmed:$('free').checked})});const data=await r.json();if(!r.ok)message(data.error);else await state();}catch{message('Connection interrupted. Refresh to check setup before retrying.');}finally{button.disabled=false;}
};
$('disconnect').onclick=async()=>{clearTimeout(timer);const r=await fetch('/api/disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await r.json();if(!r.ok){message(data.error);return;}location.reload();};
state().catch(()=>message('Setup is temporarily unavailable. Refresh to reconnect. Your existing installation is preserved.'));
