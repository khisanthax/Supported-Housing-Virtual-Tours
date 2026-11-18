const $=id=>document.getElementById(id);
// Remove the fragment before any request. Never persist the bootstrap credential.
let ticket=location.hash.slice(1);history.replaceState(null,'',location.pathname);
$('website').textContent='Your website: '+location.origin;
if(!/^[A-Za-z0-9_-]{43}$/.test(ticket)){$('setup').hidden=true;$('message').textContent='Return to the deployment wizard to authorize setup, or open /staff if your Administrator account already exists.';}
let summary='';
$('setup').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.submitter;
 if($('password').value!==$('confirmation').value){$('message').textContent='The passwords do not match.';return;}
 button.disabled=true;$('message').textContent='Creating your Administrator account…';
 try{
  const r=await fetch('/api/agency-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket,username:$('username').value,password:$('password').value})});
  const data=await r.json();
  if(!r.ok){if(data.complete){ticket='';$('setup').hidden=true;}$('message').textContent=data.error;return;}
  ticket='';$('setup').reset();$('setup').hidden=true;$('intro').hidden=true;$('message').textContent='';$('success').hidden=false;
  $('address').textContent=data.website;
  summary=`LevelTwo360 setup summary\nWebsite: ${data.website}\nAdministrator username: ${data.username}\nVersion: ${data.version}\nCompleted: ${new Date().toISOString()}\n\nSign in at ${data.website}/staff\nCreate accounts in Manage staff accounts. Assign permissions and apartment access.\nKeep encrypted apartment backups and store their passwords separately.\nHelp: ${data.website}/staff/help\nSupport: use Diagnostics; never share passwords or Cloudflare credentials.\nThis summary contains no passwords or deployment credentials.\n`;
 }catch{$('message').textContent='The connection was interrupted. Retry with the same details. If setup already completed, sign in at /staff. Your existing Administrator will never be reset.';}
 finally{$('password').value='';$('confirmation').value='';button.disabled=false;}
});
$('summary').onclick=()=>{const url=URL.createObjectURL(new Blob([summary],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='LevelTwo360-setup-summary.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('print').onclick=()=>window.print();
