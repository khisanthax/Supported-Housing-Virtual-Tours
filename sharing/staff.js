const $ = id => document.getElementById(id);
let data = { apartments:[], shares:[] }, editing = null, busy = false;
const say = message => { $('message').textContent = message; };
async function api(url, method = 'GET', payload) {
  const binary = payload instanceof Blob;
  const response = await fetch('/api/staff/' + url,{ method, ...(payload === undefined ? {} : {
    headers:{'Content-Type':binary ? 'application/octet-stream' : 'application/json'},
    body:binary ? payload : JSON.stringify(payload)
  }) });
  if (response.status === 401) { location.replace('/staff'); throw new Error('Staff session ended.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function el(tag, content, className) {
  const element = document.createElement(tag);
  if (content) element.textContent = content;
  if (className) element.className = className;
  return element;
}
async function refresh() {
  data = await api('dashboard');
  $('replace-apartment').replaceChildren(new Option('New apartment',''),...data.apartments.map(a=>new Option('Replace '+a.title,a.id)));
  $('catalog').replaceChildren(...data.apartments.map(a=>el('li',a.title)));
  $('links').replaceChildren();
  if (!data.shares.length) $('links').append(el('p','No guest links yet.'));
  for (const share of data.shares) {
    const card = el('article',null,'share');
    const names = share.apartments.map(id=>data.apartments.find(a=>a.id===id)?.title).filter(Boolean);
    card.append(el('h3',names.join(' · ')),el('span',share.status,'badge'),el('p',`Expires ${new Date(share.expires).toLocaleString()} · Link ${share.id.slice(0,8)}`));
    if (share.status === 'active') {
      const buttons = el('div',null,'actions');
      const edit = el('button','Edit apartment selection','secondary');
      edit.onclick = () => openForm(share);
      const revoke = el('button','Revoke link','danger');
      revoke.onclick = () => revokeLink(share.id);
      buttons.append(edit,revoke); card.append(buttons);
    }
    $('links').append(card);
  }
}
function openForm(share) {
  if (busy) return;
  if (!data.apartments.length) { say('Import an apartment first.'); return; }
  editing = share?.id ?? null;
  $('share-form').reset();
  $('form-title').textContent = editing ? 'Edit apartment selection' : 'Create guest link';
  $('new-fields').hidden = !!editing; $('edit-note').hidden = !editing;
  $('passphrase').required = $('expiration').required = !editing;
  $('passphrase').disabled = $('expiration').disabled = !!editing;
  $('save').textContent = editing ? 'Save selection' : 'Generate link';
  $('choices').replaceChildren(...data.apartments.map(a=>{
    const label = el('label',null,'check');
    const input = el('input'); input.type='checkbox'; input.name='apartment'; input.value=a.id;
    input.checked = share?.apartments.includes(a.id) ?? false;
    label.append(input,document.createTextNode(a.title)); return label;
  }));
  $('share-form-panel').hidden = false;
  $('share-form-panel').scrollIntoView({block:'nearest'});
  $('choices').querySelector('input')?.focus({preventScroll:true});
}
async function operate(action) {
  if (busy) return;
  busy = true;
  try { await action(); } catch (e) { say(e.message); } finally { busy = false; }
}
function revokeLink(id) {
  return operate(async()=>{
    const dialog = $('revoke-dialog');
    dialog.returnValue = '';
    const choice = new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true}));
    dialog.showModal();
    if (await choice !== 'revoke') return;
    await api('shares/'+id,'DELETE');
    $('created').hidden = true; $('share-url').value = '';
    $('share-form-panel').hidden = true;
    await refresh(); say('Link revoked. Existing guest sessions were ended.');
  });
}
$('create').onclick = () => openForm(null);
$('cancel').onclick = () => { if (!busy) { $('share-form-panel').hidden = true; $('share-form').reset(); } };
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('share-url').value); say('Link copied.'); }
  catch { $('share-url').select(); say('Select and copy the URL.'); }
};
$('sign-out').onclick = () => operate(async()=>{
  await api('sign-out','POST');
  const channel = new BroadcastChannel('housing-staff-offline');
  channel.postMessage('sign-out');
  channel.close();
  const {storage} = await import('/offline/offline-store.js');
  await storage('clear');
  location.replace('/staff');
});
$('share-form').onsubmit = event => {
  event.preventDefault();
  operate(async()=>{
    const apartments = new FormData(event.target).getAll('apartment');
    if (!apartments.length) throw new Error('Select at least one apartment.');
    if (editing) {
      await api('shares/'+editing,'PATCH',{apartments}); say('Selection saved. Guests need to unlock the link again.');
    } else {
      const expires = new Date($('expiration').value).getTime();
      if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('Set an expiration in the future.');
      const { url } = await api('shares','POST',{apartments,passphrase:$('passphrase').value,expires});
      $('share-url').value = url;
      $('created').hidden = false;
      $('created').scrollIntoView({block:'nearest'});
      say('Guest link generated.');
    }
    $('share-form-panel').hidden = true; event.target.reset(); await refresh();
  });
};
$('import').onsubmit = event => {
  event.preventDefault();
  operate(async()=>{
    const file = event.target.elements.package.files[0];
    if (!file) return;
    const replacement = event.target.elements.replacement.value;
    if (replacement) {
      const dialog = $('replace-dialog');
      dialog.returnValue = '';
      const choice = new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true}));
      dialog.showModal();
      if (await choice !== 'replace') return;
    }
    say('Importing apartment…');
    await api('apartments'+(replacement ? '?replace='+encodeURIComponent(replacement) : ''),'POST',file);
    event.target.reset(); await refresh(); say(replacement ? 'Apartment updated.' : 'Apartment imported privately.');
  });
};
refresh().catch(e=>say(e.message));
