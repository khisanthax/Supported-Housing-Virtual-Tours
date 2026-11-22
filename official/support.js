const byId = id => document.getElementById(id);
const durations = [2,24,48,72];
const permissionLabels = {diagnostics:'View diagnostics',settings:'View technical settings',apartments:'Inspect selected apartments',
  'reset-diagnostics':'Restore default diagnostic settings'};
const descriptions = {created:'Temporary support access created',activated:'Support access activated',expired:'Support access expired',
  key_expired:'Unused activation key expired',revoked:'Support access revoked',extension_requested:'More time requested',
  extension_approved:'More time approved',extension_denied:'More time denied',apartment_viewed:'Apartment reviewed',
  diagnostics_viewed:'Diagnostics reviewed',settings_viewed:'Technical settings reviewed',access_denied:'Operation denied',
  activation_rejected:'Activation key rejected',ended:'Technician ended support',diagnostics_reset:'Default diagnostic settings restored'};
const date = value => new Date(value).toLocaleString();
const add = (parent,tag,text) => {
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  parent.append(node);
  return node;
};
const show = message => {byId('message').textContent=message;};
let offset=0;
async function api(path,body) {
  const result=await fetch('/api/support/'+path,body===undefined?{}:{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  const data=await result.json();
  if(!result.ok)throw Object.assign(Error(data.error),{status:result.status});
  if(data.serverNow)offset=data.serverNow-Date.now();
  return data;
}
const operate = fn => async event => {
  event?.preventDefault();
  const button=event?.submitter??event?.currentTarget;
  if(button instanceof HTMLButtonElement)button.disabled=true;
  try{await fn(event);}catch(error){show(error.message);}
  finally{if(button instanceof HTMLButtonElement)button.disabled=false;}
};
function choices(node) {
  for(const hours of durations)node.append(new Option(hours+' hours',hours));
  return node;
}
function countdown(node,expires,label='Time remaining') {
  node.dataset.expiry=expires;
  node.dataset.label=label;
}
function tick(){
  for(const node of document.querySelectorAll('[data-expiry]')){
    const seconds=Math.max(0,Math.ceil((Number(node.dataset.expiry)-Date.now()-offset)/1000));
    node.textContent=seconds===0?'Expired':node.dataset.label+' · '+Math.floor(seconds/3600)+'h '+Math.floor(seconds%3600/60)+'m '+seconds%60+'s';
  }
}
setInterval(tick,1000);

function pdfBlob(lines) {
  const escape = text=>text.replace(/[^ -~]/g,'?').replace(/[\\()]/g,'\\$&');
  const stream='BT /F1 12 Tf 16 TL 48 744 Td '+lines.map(line=>'('+escape(line)+') Tj T*').join('\n')+' ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'];
  let contents='%PDF-1.4\n';
  const index=objects.map((object,i)=>{
    const start=contents.length;
    contents+=(i+1)+' 0 obj\n'+object+'\nendobj\n';
    return String(start).padStart(10,'0')+' 00000 n \n';
  });
  const offset=contents.length;
  contents+='xref\n0 6\n0000000000 65535 f \n'+index.join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+offset+'\n%%EOF\n';
  return new Blob([contents],{type:'application/pdf'});
}
function button(parent,label,handler){
  const result=add(parent,'button',label);
  result.addEventListener('click',operate(handler));
  return result;
}
const create=byId('create');
if(create){
  let issued;
  let filled=false;
  choices(create.elements.hours);
  const clearKey=()=>{issued=undefined;byId('key').textContent='';byId('issued').hidden=true;};
  byId('hide').onclick=clearKey;
  byId('copy').onclick=operate(async()=>{await navigator.clipboard.writeText(issued.key);show('Key copied. Share it through your approved secure channel.');});
  byId('pdf').onclick=operate(()=>{
    const {key,grant}=issued;
    const blob=pdfBlob(['LevelTwo360 temporary technical support','Installation: '+location.hostname,
      'Open '+location.origin+'/support','Enter this key and select Activate Support:',key,'',
      'Redeem by: '+new Date(grant.redeemBy).toISOString(),'Initial session: '+grant.hours+' hours',
      ...grant.permissions.map(p=>'Permission: '+permissionLabels[p]),
      ...grant.apartments.map(id=>'Apartment reference: '+id),
      'Administrator: open Request Technical Support to revoke access.',
      'Send this document only through an approved secure channel.']);
    const url=URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url;link.download='LevelTwo360-support-key.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  async function refresh(force=false){
    const {grants,events,apartments,hubAvailable}=await api('admin');
    byId('hub-option').hidden=!hubAvailable;
    if(!filled||force){
      const select=create.elements.apartments;
      const selected=new Set([...select.selectedOptions].map(o=>o.value));
      select.replaceChildren(...apartments.map(a=>new Option(a.title,a.id,false,selected.has(a.id))));
      filled=true;
    }
    const pane=byId('grants');
    // Keep an Administrator's pending decision stable while the list is focused.
    if(!force&&pane.contains(document.activeElement))return;
    pane.replaceChildren();
    for(const grant of grants){
      const card=add(pane,'article');
      add(card,'h3',grant.status+' · '+date(grant.created));
      add(card,'p',grant.permissions.map(p=>permissionLabels[p]).join(', '));
      if(grant.status==='active')countdown(add(card,'p'),grant.expires);
      if(grant.status==='pending')countdown(add(card,'p'),grant.redeemBy,'Time to activate');
      if(grant.requested&&grant.status==='active'){
        add(card,'p','Technician requested more time on '+date(grant.requested));
        const select=choices(add(card,'select'));select.setAttribute('aria-label','Additional duration');
        const decide=async approve=>{await api('admin/'+grant.id+'/extension',{approve,hours:Number(select.value),requested:grant.requested});await refresh(true);};
        button(card,'Approve extension',()=>decide(true));
        button(card,'Deny extension',()=>decide(false));
      }
      if(['active','pending'].includes(grant.status))button(card,'Revoke Support Access',async()=>{
        if(confirm('Revoke this support access immediately?')){await api('admin/'+grant.id+'/revoke',{});await refresh(true);}
      });
    }
    const audit=byId('audit');audit.replaceChildren();
    for(const event of events)add(audit,'li',(descriptions[event.event]??event.event)+' · '+date(event.at)+' · '+event.actor);
    tick();
  }
  async function refreshTickets(){
    byId('hub-tickets').hidden=byId('hub-option').hidden;
    if(byId('hub-tickets').hidden)return;
    const pane=byId('tickets');
    try {
      const {tickets}=await api('admin/tickets');
      pane.replaceChildren();
      for(const ticket of tickets){
        const card=add(pane,'article');
        add(card,'h3',ticket.ticket+' · '+ticket.status.replaceAll('_',' '));
        add(card,'p',ticket.issue);
        for(const note of ticket.history.filter(entry=>entry.note))add(card,'p',date(note.at)+' · '+note.note);
      }
      if(!tickets.length)add(pane,'p','No Help Hub tickets.');
    } catch {pane.textContent='The Help Hub is unavailable. You can still use and revoke local support keys.';}
  }
  create.onsubmit=operate(async()=>{
    clearKey();
    const values=new FormData(create);
    issued=await api('admin',{hours:Number(values.get('hours')),permissions:values.getAll('permission'),
      apartments:values.getAll('apartments'),issue:values.has('submitHub')?values.get('issue'):undefined});
    byId('key').textContent=issued.key;byId('issued').hidden=false;
    show(issued.ticket?'Help Hub ticket '+issued.ticket+' created.':issued.hubError??'Key generated. Save it now; it is shown only once.');
    await refresh(true);
    await refreshTickets();
  });
  const poll=()=>refresh().then(refreshTickets).catch(error=>show(error.message));
  await poll();setInterval(poll,10000);
}else{
  const form=byId('activation'),panel=byId('session');
  let active=false;
  async function refresh(){
    let data;
    try{data=await api('session');}
    catch(error){if(error.status!==401)throw error;if(active)show(error.message);active=false;panel.hidden=true;form.hidden=false;byId('resource-detail').textContent='';return;}
    form.hidden=true;panel.hidden=false;
    countdown(byId('remaining'),data.expires);
    byId('extension').textContent=data.requested?'Extension requested. The current expiry still applies.':
      data.decision==='extension_denied'?'Extension denied.':data.decision==='extension_approved'?'Extension approved.':'';
    byId('request-time').disabled=Boolean(data.requested);
    tick();
    if(active)return;
    active=true;
    const container=byId('resources');container.replaceChildren();
    const inspect=async path=>{const detail=byId('resource-detail');detail.textContent=JSON.stringify(await api(path),null,2);detail.hidden=false;};
    for(const key of ['diagnostics','settings'])if(data.permissions.includes(key))button(container,permissionLabels[key],()=>inspect(key));
    if(data.permissions.includes('reset-diagnostics'))button(container,permissionLabels['reset-diagnostics'],async()=>{
      if(confirm('Restore the default diagnostic settings?')){await api('reset-diagnostics',{});show('Default diagnostic settings restored.');}
    });
    for(const id of data.apartments)button(container,'Inspect apartment '+id,()=>inspect('apartments/'+id));
  }
  form.onsubmit=operate(async()=>{const key=form.elements.key.value.trim();form.reset();await api('activate',{key});await refresh();});
  byId('request-time').onclick=operate(async()=>{await api('request-time',{});await refresh();});
  byId('end').onclick=operate(async()=>{await api('end',{});await refresh();});
  const poll=()=>refresh().catch(error=>show(error.message));
  await poll();setInterval(poll,5000);
}
