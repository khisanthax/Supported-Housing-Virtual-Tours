const $=id=>document.getElementById(id);let timer;
const authOutcome=new URL(location.href).searchParams.get('authorization');
const rememberedName=sessionStorage.getItem('installationName');
if(rememberedName)$('name').value=rememberedName;
$('name').onchange=()=>sessionStorage.setItem('installationName',$('name').value);
history.replaceState(null,'',location.pathname);
let mayInstall=false,submitting=false;
const message=text=>$('message').textContent=text;
async function state(){
 const response=await fetch('/api/state'),data=await response.json();
 $('retry-state').hidden=true;
 mayInstall=!!data.freeVerificationAvailable;
 $('start-install').disabled=!mayInstall||submitting;
 $('availability').hidden=data.freeVerificationAvailable;
 $('authorize').textContent=data.freeVerificationAvailable?'Connect to Cloudflare':'Connect for an existing installation';
 if(authOutcome==='failed')message('Cloudflare authorization did not finish. Connect again when you are ready.');
 $('connect').hidden=data.connected||data.running||!!data.result;
 $('choose').hidden=!data.connected||data.running||!!data.result;
 $('disconnect').hidden=!data.connected||data.running;
 const current=$('account').value||sessionStorage.getItem('installationAccount');$('account').replaceChildren(...data.accounts.map(a=>new Option(a.name,a.id)));if(data.accounts.some(a=>a.id===current))$('account').value=current;
 if(!data.freeVerificationAvailable&&data.connected)message('This preview cannot yet verify Workers Free. The owner must complete the read-only plan verification before agency deployment can proceed.');
 if(data.running){$('updates').hidden=true;message(data.progress||'Preparing your installation…');timer=setTimeout(()=>state().catch(interrupted),1000);return;}
 if(data.error){
  message(data.error);
  $('connect').querySelector('h2').textContent='Reconnect to continue';
  $('authorize').textContent='Reconnect to Cloudflare';
 }else if(data.sessionExpired){
  $('connect').querySelector('h2').textContent='Cloudflare sign-in expired';
  $('authorize').textContent='Reconnect to Cloudflare';
  message('Reconnect and select the original account and installation name to continue.');
 }else if(authOutcome==='failed'&&!data.connected){
  $('connect').querySelector('h2').textContent='Authorization did not finish';
  $('authorize').textContent='Reconnect to Cloudflare';
 }
 if(data.result){
  const result=data.result,url=new URL(result.website);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.workers.dev')||url.pathname!=='/')throw Error('Unexpected installation address');
  $('next').hidden=false;$('address').textContent=result.website;
  if(result.ready && !result.phase){
   $('next').querySelector('h2').textContent='Your installation is ready';
   $('next').querySelector('p').textContent='Sign in with your existing agency account.';
   $('setup-expiry').hidden=true;
  }
  if(result.phase){$('next').querySelector('h2').textContent=result.phase==='complete'?'Update complete':'Previous code recovered';$('next').querySelector('p').textContent='Your existing accounts and apartment data are retained. Open your website, or reconnect below to download the encrypted installation backup and review update history.';$('setup-expiry').hidden=true;$('reconnect').hidden=false;}
  $('open').href=result.website+(result.ready||result.phase?'/staff':'/setup#'+result.ticket);
  $('open').textContent=result.ready?'Sign in':result.phase?'Open LevelTwo360':'Continue agency setup';
  if(!result.ready&&!result.phase&&result.expires<=Date.now()){
   $('next').querySelector('h2').textContent='Your setup link has expired';
   $('next').querySelector('p').textContent='Reconnect with the original Cloudflare account and installation name to finish setup.';
   $('setup-expiry').hidden=true;$('open').href='/oauth/start';$('open').textContent='Reconnect to Cloudflare';
  }
  $('revocation').textContent=result.revoked?'The temporary Cloudflare deployment token has been revoked.':'The deployment service discarded its token but could not confirm revocation. Revoke this application in Cloudflare’s authorized applications before continuing.';
  $('open').focus();message('');
 }
}
$('deploy').onsubmit=async event=>{
 event.preventDefault();if(submitting||!mayInstall)return;submitting=true;const button=$('start-install');button.disabled=true;
 try{const r=await fetch('/api/deploy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:$('account').value,name:$('name').value,freeConfirmed:$('free').checked})});const data=await r.json();if(!r.ok)message(data.error);else await state();}catch{message('Connection interrupted. Refresh to check setup before retrying.');}finally{submitting=false;button.disabled=!mayInstall;}
};
$('disconnect').onclick=async()=>{clearTimeout(timer);const r=await fetch('/api/disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await r.json();if(!r.ok){message(data.error);return;}location.reload();};
$('account').onchange=()=>{sessionStorage.setItem('installationAccount',$('account').value);$('updates').hidden=true;};
$('name').addEventListener('input',()=>{$('updates').hidden=true;});
const selected=()=>({account:$('account').value,name:$('name').value});
async function updates(){
 const r=await fetch('/api/updates/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selected())}),data=await r.json();if(!r.ok){message(data.error);return;}
 $('updates').hidden=false;$('update-list').replaceChildren(...data.requests.map(row=>{const section=document.createElement('section'),p=document.createElement('p');p.textContent=`${row.version} · ${row.phase}${row.revoked?' · approval revoked':''} · ${new Date(row.created).toLocaleString()}`;section.append(p);
  if(row.owns_lock||(!row.revoked&&row.expires>Date.now()&&!['complete','recovered'].includes(row.phase))){const button=document.createElement('button');button.textContent=row.owns_lock?'Resume and verify installation':row.phase==='approved'?'Apply approved update':'Resume / recover update';button.onclick=async()=>{button.disabled=true;const response=await fetch('/api/updates/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...selected(),requestId:row.id})});const result=await response.json();if(!response.ok){message(result.error);button.disabled=false;}else{message('Preparing the approved update…');await state();}};section.append(button);}
  if(row.backup_digest){const download=document.createElement('button');download.textContent='Download encrypted installation backup';download.onclick=()=>{
   const form=document.createElement('form');
   form.method='POST';form.action='/api/updates/backup';
   for(const [name,value] of Object.entries({...selected(),requestId:row.id})){
    const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);
   }
   document.body.append(form);form.submit();form.remove();
   message('Your browser will save the verified backup. Keep the private recovery file separately.');
  };section.append(download);}return section;}));
 if(!data.requests.length)message('No update is approved. An Administrator must review Software updates on your agency website first.');
}
$('inspect-updates').onclick=()=>updates().catch(()=>message('The saved installation could not be inspected. Check the original account and installation name.'));
function interrupted(){
 message('Setup is temporarily unavailable. Check progress again to continue.');
 $('retry-state').hidden=false;
}
$('retry-state').onclick=()=>state().catch(interrupted);
state().catch(interrupted);
