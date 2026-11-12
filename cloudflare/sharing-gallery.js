// Extends existing invitation management; generated credentials live only in this page's memory.
const selectedTours=new Set();let massMode=false,lastInvitation=null;
const sharingShell=document.querySelector('.sharing-shell');
const main=document.querySelector('main');for(const h of main.querySelectorAll(':scope>h1,:scope>p:not(#message)'))h.hidden=true;
const sidebar=el('aside',null,'share-sidebar');sidebar.innerHTML='<h2>Virtual Tours</h2><p>Supported Housing</p><a href="/staff">⌂ Apartments</a><a href="/staff/editor/">▧ Upload Stitches</a><a href="/staff/guest-links" aria-current="page">↗ Guest Links</a><a href="/offline/">↓ Available Offline</a><a href="/staff">Backups & Settings</a>';document.body.prepend(sidebar);
$('catalog').closest('section').hidden=true;
function shareButton(text,fn){const b=el('button',text);b.type='button';b.onclick=()=>operate(fn);return b;}
function countSelection(){$('selected-count').textContent=selectedTours.size+' Selected';$('mass-create').disabled=!selectedTours.size;}
function setMass(value){massMode=value;document.body.classList.toggle('mass-sharing',value);$('mass-panel').hidden=!value;$('mass-toggle').setAttribute('aria-expanded',String(value));renderSharing();}
function renderSharing(){
 $('share-gallery').replaceChildren();const query=$('share-search').value.toLowerCase();
 for(const a of data.apartments.filter(a=>!a.archived&&a.title.toLowerCase().includes(query))){
 const eligible=!!a.published,active=data.shares.filter(s=>s.status==='active'&&s.expires>Date.now()&&s.apartments.includes(a.id)),card=el('article',null,'share-apartment'+(massMode&&selectedTours.has(a.id)?' selected':''));card.dataset.apartment=a.id;
 const photo=el('div',null,'share-photo'),img=el('img');img.src='/api/staff/tours/'+a.id+'/thumbnail?version='+a.version;img.alt='Panorama thumbnail for '+a.title;img.loading='lazy';img.onerror=()=>img.hidden=true;photo.append(img,el('span',eligible?'Published':'Draft','publication'),el('h2',a.title));
 if(massMode){const check=el('input');check.type='checkbox';check.checked=selectedTours.has(a.id);check.disabled=!eligible;check.setAttribute('aria-label','Select '+a.title);check.title=eligible?'Include in this invitation':'Publish this draft before sharing.';check.onchange=()=>{if(check.checked&&access.permissions&&!access.permissions['invitation.multi.create'])selectedTours.clear();check.checked?selectedTours.add(a.id):selectedTours.delete(a.id);renderSharing();};photo.append(check);}
 const details=el('div',null,'share-details');details.append(el('p',(a.roomCount??a.viewpoints??0)+' rooms · '+(a.viewpoints??0)+' viewpoints'),el('p',active.length+' active invitation'+(active.length===1?'':'s')+' · '+(active.length?'Passphrase protected':'Not shared')));
 details.append(el('p',active.length?'Next expiry: '+new Date(Math.min(...active.map(s=>s.expires))).toLocaleDateString():eligible?'Published without active guest access':'Publish in the editor before sharing.'));
 const actions=el('div',null,'share-card-actions');for(const [text,kind]of [['Copy Link','link'],['QR Code','qr'],['Share','invitation']]){const b=shareButton(text,()=>offerInvitation([a.id],kind));b.disabled=!eligible;actions.append(b);}
 const more=el('details');more.append(el('summary','•••'));const edit=el('a','Open apartment');edit.href='/staff/editor/?apartment='+a.id;more.append(edit,shareButton('Manage Guest Links',async()=>{$('links').scrollIntoView({block:'start'});}));details.append(actions,more);card.append(photo,details);$('share-gallery').append(card);
 }applyAccess(access);countSelection();$('share-summary').textContent=data.apartments.filter(a=>!a.archived).length+' Apartments · '+data.shares.filter(s=>s.status==='active'&&s.expires>Date.now()).length+' Active Invitations';
}
async function offerInvitation(ids,kind){
 if(lastInvitation&&JSON.stringify([...ids].sort())===JSON.stringify([...lastInvitation.apartments].sort())&&lastInvitation.expires>Date.now()&&data.shares.some(s=>s.id===lastInvitation.id&&s.status==='active')){showInvitation(lastInvitation,kind);return;}
 if(!confirm('Create a new passphrase-protected guest invitation for '+ids.length+' apartment(s)? Existing invitations stay unchanged.'))return;
 const result=await api('shares','POST',{apartments:ids,expirationPreset:$('mass-expiration').value,wordCount:3});lastInvitation={...result,apartments:ids};await refresh();showInvitation(lastInvitation,kind);
}
function invitationText(i){return 'View apartments: '+i.url+'\nAccess phrase: '+i.code+'\nExpires: '+new Date(i.expires).toLocaleString()+'\nIncluded: '+i.apartments.map(id=>data.apartments.find(a=>a.id===id)?.title??'Apartment').join(', ');}
function showInvitation(i,kind){
 const d=el('dialog');d.setAttribute('aria-label','Guest invitation');d.append(el('h2','Guest invitation'),el('p','Copy Invitation is recommended: guests need both the URL and access phrase.'));
 for(const [label,value]of [['Guest URL',i.url],['Access phrase',i.code],['Expires',new Date(i.expires).toLocaleString()],['Included apartments',i.apartments.map(id=>data.apartments.find(a=>a.id===id)?.title).join(', ')]]){const l=el('label',label),input=el('input');input.readOnly=true;input.value=value;l.append(input);d.append(l);}
 const copy=async text=>{try{await navigator.clipboard.writeText(text);say('Copied.');}catch{say('Clipboard unavailable. Select and copy the invitation fields.');}};
 const tools=el('div',null,'actions');tools.append(shareButton('Copy Invitation (recommended)',()=>copy(invitationText(i))),shareButton('Copy Link',()=>copy(i.url)),shareButton('Copy Passphrase',()=>copy(i.code)),shareButton('QR Code',()=>showQr(i.url)));
 for(const [label,protocol]of [['Email (opens mail app)','mailto:?subject=Apartment%20tour&body=']]){const a=el('a',label,'button secondary');a.href=protocol+encodeURIComponent(invitationText(i));tools.append(a);}d.append(el('p','Email opens your external mail application with a prepared invitation. This app does not send email directly.'),tools,shareButton('Close',async()=>d.close()));d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);d.showModal();if(kind==='qr')showQr(i.url);if(kind==='link')copy(i.url);
}
async function showQr(url){
 const {default:qrcode}=await import('/sharing/qr.js'),qr=qrcode(0,'M');qr.addData(url);qr.make();const d=el('dialog');d.setAttribute('aria-label','Guest link QR code');d.append(el('h2','Guest link QR code'),el('p','This QR contains only the guest URL. Send the access phrase separately.'));const canvas=el('canvas'),size=qr.getModuleCount(),scale=6;canvas.width=canvas.height=(size+8)*scale;const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#000';for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(qr.isDark(y,x))c.fillRect((x+4)*scale,(y+4)*scale,scale,scale);d.append(canvas);const save=el('a','Save PNG','button');save.href=canvas.toDataURL('image/png');save.download='guest-link-qr.png';d.append(save,shareButton('Copy QR',async()=>{try{const blob=await new Promise(r=>canvas.toBlob(r));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);say('QR copied.');}catch{say('Image clipboard unavailable. Use Save PNG.');}}),shareButton('Close',async()=>d.close()));d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);d.showModal();
}
$('mass-toggle').onclick=()=>setMass(!massMode);$('exit-mass').onclick=()=>setMass(false);$('select-eligible').onclick=()=>{data.apartments.filter(a=>a.published&&!a.archived).forEach(a=>selectedTours.add(a.id));renderSharing();};$('clear-selected').onclick=()=>{selectedTours.clear();renderSharing();};$('share-search').oninput=renderSharing;$('mass-create').onclick=()=>operate(()=>offerInvitation([...selectedTours],'link'));$('share-more').onclick=()=>$('links').scrollIntoView({block:'start'});
for(const b of sharingShell.querySelectorAll('[data-share]'))b.onclick=()=>operate(async()=>{if(lastInvitation&&data.shares.some(s=>s.id===lastInvitation.id&&s.status==='active'))showInvitation(lastInvitation,b.dataset.share);else{setMass(true);say('Select published apartments, then create an invitation.');}});
const managementRefresh=refresh;refresh=async()=>{await managementRefresh();if(lastInvitation&&!data.shares.some(s=>s.id===lastInvitation.id&&s.status==='active'&&s.apartments.length===lastInvitation.apartments.length&&s.apartments.every(id=>lastInvitation.apartments.includes(id))))lastInvitation=null;renderSharing();};refresh().catch(e=>say(e.message));

const previousPhraseDisplay=showPhrase;showPhrase=(url,code)=>{lastInvitation=null;previousPhraseDisplay(url,code);};

setInterval(()=>{if(!busy&&!document.querySelector('dialog[open]'))refresh().catch(e=>say(e.message));},60000);
window.addEventListener('focus',()=>{if(!busy)refresh().catch(e=>say(e.message));});
