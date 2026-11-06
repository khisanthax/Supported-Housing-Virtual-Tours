import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
const root = new URL('../',import.meta.url);
const output = new URL('./generated/',import.meta.url);
async function put(name,bytes) {
  const url = new URL(name,output);
  await mkdir(new URL('./',url),{recursive:true});
  await writeFile(url,bytes);
}
const copy = async (from,to) => put(to,await readFile(new URL(from,root)));
const common = ['styles.css','app.js','tour-data.js','room-grid.js','builder-data.js','layout-state.js','graph-tour.js','vendor/marzipano.js'];
const index = await readFile(new URL('dist/index.html',root),'utf8');
const guestViewer = index.replace('<body>','<body data-guest="true">')
  .replace(/(href|src)="(styles\.css|app\.js|vendor\/marzipano\.js)"/g,'$1="/viewer/$2"')
  .replaceAll('The Willow Apartment','Shared apartment')
  .replaceAll('Two-Bedroom Apartment','Shared apartment')
  .replace(/<section class="editor-bar"[\s\S]*?<\/section>/,'')
  .replace(/<section id="editor-panel"[\s\S]*?<\/section>/,'')
  .replace(/<dialog\b[\s\S]*?<\/dialog>/g,'')
  .replace(/<details class="local-preview"[\s\S]*?<\/details>/,'')
  .replace(/<link rel="stylesheet" href="editor.css">/,'')
  .replace(/<button id="(?:place-on-pano|cancel-on-pano)"[\s\S]*?<\/button>/g,'')
  .replace('<main>','<main><p><a href="/guest">← Back to shared apartments</a></p>')
  .replace('href="./"','href="/guest"');
await put('viewer/index.html',guestViewer);
const offlinePanel = await readFile(new URL('sharing/offline-panel.html',root),'utf8');
await put('offline/index.html',guestViewer
  .replace('data-guest="true"', 'data-offline="true" class="offline-locked"')
  .replaceAll('/viewer/', '/offline/')
  .replace('href="/guest">← Back to shared apartments', 'href="/staff">← Staff catalog')
  .replace('<head>', '<head><link rel="manifest" href="/offline/app.webmanifest"><link rel="stylesheet" href="/offline/offline.css"><meta name="theme-color" content="#254e3e">')
  .replace('<main>', '<main>' + offlinePanel));
for (const name of ['app.webmanifest','sw.js','offline.js','offline-store.js','offline.css','icon-192.png','icon-512.png']) {
  await copy('sharing/'+name,'offline/'+name);
}
await put('staff/editor/index.html',index
  .replace('<main>','<main><p><a href="/staff">← Staff apartment catalog</a></p>')
  .replace('Add room JPEGs<input id="add-rooms" type="file" accept="image/jpeg,.jpg,.jpeg"', 'Add JPEGs or ZIP<input id="add-rooms" type="file" accept="image/jpeg,.jpg,.jpeg,.zip,application/zip"')
  .replace('Start new tour<input id="new-tour" type="file" accept="image/jpeg,.jpg,.jpeg"', 'Replace draft from JPEGs or ZIP<input id="new-tour" type="file" accept="image/jpeg,.jpg,.jpeg,.zip,application/zip"')
  .replace('Saved in this browser. Export a backup before clearing browser data or switching devices.','Edits save to a private cloud draft. Return to the staff catalog to publish or export a backup.'));
for (const name of common) {
  await copy('dist/'+name,'viewer/'+name);
  await copy('dist/'+name,'staff/editor/'+name);
  await copy('dist/'+name,'offline/'+name);
}
for (const name of ['editor.css','tour-package.js','room-grid-ui.js','doorway-data.js']) await copy('dist/'+name,'staff/editor/'+name);
await put('staff/editor/legacy.html',await readFile(new URL('staff/editor/index.html',output)));
let guidedIndex=await readFile(new URL('staff/editor/index.html',output),'utf8');
await put('staff/editor/index.html',guidedIndex.replace('<body>','<body data-guided="true">').replace('</head>','<link rel="stylesheet" href="guided-editor.css"></head>'));
for(const name of ['guided-editor.js','guided-editor.css','doorway-drag.js'])await copy('cloudflare/'+name,'staff/editor/'+name);
for (const name of ['living.jpg','kitchen.jpg','bedroom.jpg']) await copy('cloudflare/sample-images/'+name,'staff/editor/images/'+name);
await copy('cloudflare/sample.json','staff/editor/data/apartment.json');
for (const name of ['batch-review.js','batch-draft.js','panorama-zip.js']) await copy('cloudflare/'+name,'staff/editor/'+name);
const editorCss = await readFile(new URL('dist/editor.css',root),'utf8');
await put('staff/editor/editor.css',editorCss + '\n.batch-review{overflow:auto}.batch-review section{margin:12px 0;overflow-wrap:anywhere}.batch-review img{display:block;width:100%;aspect-ratio:2;object-fit:contain}.batch-review input,.batch-review select{display:block;width:100%;min-height:44px;font-size:16px}');
await copy('cloudflare/cloud-tour-store.js','staff/editor/tour-store.js');
const editor = await readFile(new URL('dist/tour-editor.js',root),'utf8');
await put('staff/editor/tour-editor.js',"import { importBatch } from './batch-draft.js';\n" + editor
  .replace(/  function askNames\([\s\S]*?(?=  filesFrom\('add-rooms')/, '')
  .replace('files => addRooms(files, false)', 'files => importBatch(files, draft, false, verifyImage, commit)')
  .replace('files => addRooms(files, true)', 'files => importBatch(files, draft, true, verifyImage, commit)')
  .replace('keepView = true) {', 'keepView = true, progress) {')
  .replace('saveDraft(next, revision)', 'saveDraft(next, revision, progress)')
  .replace('await inspectJpeg(blob);', `const {width,height}=await inspectJpeg(blob);
  if (blob.size>4*1024*1024 || width>8192 || height>4096) throw new Error('Use a JPEG no larger than 4 MiB and 8192 × 4096.');
  const end = new Uint8Array(await blob.slice(-2).arrayBuffer());
  if(end[0]!==255 || end[1]!==217) throw new Error('The JPEG is truncated.');`)
  .replace('Saved on this device.','Saved to the cloud.')
  .replace('Draft saved on this device. Export a backup to move or keep a copy.','Cloud draft saved. Return to the staff catalog to publish.')
  .replace('Backup imported and saved on this device.','Backup imported and saved as a cloud draft.'));
for (const name of ['staff.html','staff-login.html','guest.html','staff.js','staff-login.js','guest.js','sharing.css']) {
  let content = await readFile(new URL('sharing/'+name,root),'utf8');
  if (name === 'staff-login.html') content = content
    .replace('<label>Staff passphrase', '<label id="username-field" hidden>Username<input name="username" maxlength="64" autocomplete="username" disabled></label><label id="password-field">Staff passphrase')
    .replace('<button>Sign in','<button disabled>Sign in');
  if (name === 'staff-login.js') content = content
    .replace("form.addEventListener",`let individualAccounts;
fetch('/api/staff/sign-in-mode').then(response => {
  if (!response.ok) throw new Error();
  return response.json();
}).then(mode => {
  individualAccounts = mode.individualAccounts;
  document.querySelector('#username-field').hidden = !individualAccounts;
  form.elements.username.disabled = !individualAccounts;
  form.elements.username.required = individualAccounts;
  document.querySelector('#password-field').firstChild.textContent = individualAccounts ? 'Password' : 'Staff passphrase';
  form.querySelector('button').disabled = false;
}).catch(() => { document.querySelector('#message').textContent = 'Sign-in is unavailable. Reload and try again.'; });
form.addEventListener`)
    .replace('JSON.stringify({passphrase:form.elements.passphrase.value})',
      'JSON.stringify(individualAccounts ? {username:form.elements.username.value,password:form.elements.passphrase.value} : {passphrase:form.elements.passphrase.value})');
  if (name === 'staff.html') content = content
    .replace('<nav class="actions">', '<nav class="actions"><a class="button secondary" href="https://github.com/khisanthax/Supported-Housing-Virtual-Tours/blob/main/PILOT.md" target="_blank" rel="noopener noreferrer">Staff guide</a>')
    .replace('<ul id="catalog">','<p><a hidden id="staff-accounts" href="/staff/accounts">Manage staff accounts</a></p><ul id="catalog">')
    .replace('Open tour editor','Start an apartment')
    .replace('<ul id="catalog"></ul>','<ul id="catalog"></ul><button class="secondary" id="cleanup">Clean up unused storage</button>')
    .replace('Import an approved .shtour package. A new apartment stays private until shared. Replacing an apartment updates it for guests who already have access.','Create or import a draft. Publish it when it is ready for guest links. Use synthetic images in this pilot.')
    .replace('<label>Guest passphrase<input id="passphrase" type="password" minlength="12" maxlength="256" autocomplete="new-password"><small>At least 12 characters.</small></label>','<label>Phrase length<select id="word-count"><option value="3">3 words</option><option value="5">5 words</option><option value="7">7 words</option></select></label>')
    .replace('<button id="copy">Copy link</button>','<button id="copy">Copy Link</button><label>Generated access phrase<input id="generated-code" readonly style="font-size:1.4rem;font-weight:700"></label><div class="actions"><button id="copy-phrase">Copy Phrase</button><button id="copy-invitation">Copy Invitation</button></div>')
    .replaceAll('passphrase','access phrase')
    .replace('<p id="edit-note"', '<label hidden id="rotation-length">New phrase length<select id="rotate-count"><option value="3">3 words</option><option value="5">5 words</option><option value="7">7 words</option></select></label><p id="edit-note"');
  if (name === 'guest.html') content = content
    .replace('Guest passphrase<input', 'Guest access phrase<input autocapitalize="none" spellcheck="false"')
    .replace('<button>Open shared apartments','<small>Spaces or hyphens both work. Older invitations can use their original code.</small><button>Open shared apartments');
  if (name === 'guest.js') content = content
    .replace('passphrase:form.elements.passphrase.value','code:form.elements.passphrase.value.trim()')
    .replaceAll('passphrase supplied','access phrase or code supplied')
    .replaceAll('its passphrase','its access phrase or code');
  if (name === 'staff.js') {
    content = "import { exportApartment, importPackage } from '/sharing/worker-import.js';\n" + content
      .replace("data = await api('dashboard');","data = await api('dashboard');\n  $('staff-accounts').hidden = data.staffRole !== 'administrator';")
      .replace("await api('apartments'+(replacement ? '?replace='+encodeURIComponent(replacement) : ''),'POST',file);","await importPackage(file,replacement,data.apartments.find(item=>item.id===replacement)?.version);")
      .replace("say(replacement ? 'Apartment updated.' : 'Apartment imported privately.');", "say(replacement ? 'Backup imported as a private draft. Publish explicitly to update guests.' : 'Backup imported as a private draft.');")
      .replaceAll('Import an apartment first.', 'Create and publish an apartment first.')
      .replace("$('passphrase').required = $('expiration').required = !editing;","$('expiration').required = !editing;")
      .replace("$('passphrase').disabled = $('expiration').disabled = !!editing;","$('expiration').disabled = !!editing;")
      .replace("const { url } = await api('shares','POST',{apartments,passphrase:$('passphrase').value,expires});","const { url, code } = await api('shares','POST',{apartments,expires,wordCount:Number($('word-count').value)});\n      showPhrase(url,code);")
      .replace("$('share-url').value = '';","$('share-url').value = ''; $('generated-code').value = '';")
      .replace("buttons.append(edit,revoke);",`const rotate=el('button','Regenerate phrase','secondary');
      rotate.onclick=()=>openRotation(share.id);
      buttons.append(edit,rotate,revoke);`)
      .replace("$('create').onclick", `function showPhrase(url,code){
  $('share-url').value=url;
  $('generated-code').value=code;
  $('copy').disabled=$('copy-invitation').disabled=!url;
  $('created').hidden=false;
  $('created').scrollIntoView({block:'nearest'});
}
function openRotation(id){
  const dialog=$('rotate-dialog');
  dialog.returnValue='';
  dialog.addEventListener('close',()=>{ if(dialog.returnValue!=='rotate') return;
    operate(async()=>{
      const {code}=await api('shares/'+id+'/phrase','POST',{wordCount:Number($('rotate-count').value)});
      showPhrase('',code);
      say('Phrase regenerated. Send the new phrase with the original guest link.');
    });
  },{once:true});
  dialog.showModal();
}
async function copyText(value){ try{ await navigator.clipboard.writeText(value); say('Copied.'); }
  catch{ say('Copy failed. Select and copy the text manually.'); } }
$('copy-phrase').onclick=()=>copyText($('generated-code').value);
$('copy-invitation').onclick=()=>copyText('Supported Housing virtual tour\\n'+$('share-url').value+'\\nAccess phrase: '+$('generated-code').value);
$('create').onclick`)
      .replace("$('choices').replaceChildren(...data.apartments.map", "$('choices').replaceChildren(...data.apartments.filter(a=>a.published).map")
      .replace("$('create').onclick", `$('cleanup').onclick=()=>operate(async()=>{
    if(!confirm('Remove old revisions and unused JPEGs? Export any backups you want to keep first.')) return;
    const result=await api('cleanup','POST');
    say('Cleaned up '+result.versions+' old revisions and '+result.photos+' unused JPEGs.');
  });
  $('create').onclick`)
      .replace("$('catalog').replaceChildren(...data.apartments.map(a=>el('li',a.title)));", `$('catalog').replaceChildren(...data.apartments.map(a=>{
    const item=el('li',null,'gallery-card');
    const image=el('img'); image.alt=''; image.loading='lazy'; image.decoding='async';
    image.src='/api/staff/tours/'+a.id+'/thumbnail?version='+a.version;
    image.onerror=()=>{ image.hidden=true; };
    const heading=el('h3',a.title);
    const badge=el('span',a.archived ? 'Archived' : a.published ? 'Published' : 'Private draft','badge');
    item.append(image,heading,badge);
    const controls=el('div',null,'actions');
    const edit=el('a','Edit draft','button secondary');
    edit.href='/staff/editor/?apartment='+a.id;
    const backup=el('button','Export .shtour','secondary');
    backup.onclick=()=>operate(()=>exportApartment(a.id));
    if(!a.archived) controls.append(edit);
    controls.append(backup);
    const lifecycle=a.archived ? [['restore','Restore as draft']] :
      [['publish','Publish latest draft'],['unpublish','Unpublish'],['archive','Archive'],['remove','Remove']];
    for(const [action,label] of lifecycle){
      if(action==='unpublish' && !a.published) continue;
      const button=el('button',label,action==='remove'?'danger':'secondary');
      button.onclick=()=>operate(async()=>{
        if(action==='remove' && !confirm('Remove this apartment and hide it from all guest links? Export a backup first if needed.')) return;
        await api('apartments/'+a.id,'PATCH',{action,expectedVersion:a.version});
        await refresh();
        say({publish:'Publication requested. New images may take about a minute to appear.',
          remove:'Apartment removed.',unpublish:'Apartment unpublished.',
          archive:'Apartment archived.',restore:'Apartment restored as an unpublished draft.'}[action]);
      });
      controls.append(button);
    }
    item.append(controls);
    return item;
  }));`);
  }
  if (name === 'staff.html') content = content
    .replace('<title>Guest links · Supported Housing</title>', '<title>Apartment gallery · Supported Housing</title>')
    .replace('<h1>Guest links</h1>', '<h1>Apartment gallery</h1>')
    .replace('Share a private selection of apartments with one link and one passphrase.', 'Manage your apartments, connect rooms and share approved tours.')
    .replace('<ul id="catalog">', '<ul id="catalog" class="staff-gallery">')
    .replace('Existing guest links will show the new tour. Staff with offline copies will see an update when they reconnect.', 'This replaces the latest staff draft. The published guest tour stays unchanged until you choose Publish latest draft. Staff offline downloads use the latest draft.')
    .replace(/<label hidden id="rotation-length">[\s\S]*?<\/label>/,'')
    .replace('</main>', '<dialog id="rotate-dialog"><form method="dialog"><h2>Regenerate guest phrase?</h2><p>The old phrase or code and all current guest sessions will stop working. The existing link still works with the new phrase.</p><label>New phrase length<select id="rotate-count"><option value="3">3 words</option><option value="5">5 words</option><option value="7">7 words</option></select></label><div class="actions"><button value="cancel" class="secondary">Cancel</button><button value="rotate">Regenerate phrase</button></div></form></dialog></main>');
  if (name === 'staff.html') content = content
    .replaceAll('<option value="3">3 words</option>', '<option value="0">128-bit code</option><option value="3">3 words</option>')
    .replaceAll('Phrase length','Access code format').replaceAll('New phrase length','New access code format')
    .replaceAll('Generated access phrase','Generated access code or phrase');
  await put('sharing/'+name,content);
}
await copy('cloudflare/worker-import.js','sharing/worker-import.js');
await copy('cloudflare/gallery.html','sharing/gallery.html');
await copy('cloudflare/gallery.js','sharing/gallery.js');
let guestLinks=await readFile(new URL('sharing/staff.html',output),'utf8');
guestLinks=guestLinks.replace('<body>','<body class="guest-links-page">').replace('<h1>Apartment gallery</h1>','<h1>Guest Links</h1>').replace('<nav class="actions">','<nav class="actions"><a class="button secondary" href="/staff">Apartment Gallery</a>');
await put('sharing/staff.html',guestLinks);
let linksScript=await readFile(new URL('sharing/staff.js',output),'utf8');
linksScript=linksScript.replace('refresh().catch(e=>say(e.message));',`refresh().then(()=>{
  const selected=new URL(location.href).searchParams.get('apartment');
  if(selected&&data.apartments.some(a=>a.id===selected&&a.published)){
    $('create').click();
    for(const checkbox of $('choices').querySelectorAll('input'))checkbox.checked=checkbox.value===selected;
  }
}).catch(e=>say(e.message));`);
await put('sharing/staff.js',linksScript);
const vars = new URL('./.dev.vars',import.meta.url);
let settings = '';
try { settings = await readFile(vars,'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const staffHash = createHash('sha256').update('Synthetic KV prototype staff only').digest('hex');
if (!/^GUEST_CODE_KEY=/m.test(settings)) settings += `\nGUEST_CODE_KEY=${randomBytes(32).toString('hex')}\n`;
if (!/^STAFF_RANDOM_HASH=/m.test(settings)) settings += `\nSTAFF_RANDOM_HASH=${staffHash}\n`;
if (!/^LOCAL_SYNTHETIC_ONLY=/m.test(settings)) settings += '\nLOCAL_SYNTHETIC_ONLY=1\n';
await writeFile(vars,settings.replace(/^STAFF_(?:SALT|VERIFIER)=.*\r?\n/gm,''));
await copy('cloudflare/staff-accounts.html','sharing/staff-accounts.html');
await copy('cloudflare/staff-accounts.js','sharing/staff-accounts.js');
