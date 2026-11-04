import { validateApartment, validateDimensions } from './tour-data.js';
import { labelFor, openVault, seal, sealJSON, storage, unseal, unsealJSON } from './offline-store.js';

const $ = id => document.getElementById(id);
const endpoint = '/api/staff/offline';
const format = bytes => new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(bytes / 1e6) + ' MB';
const say = message => { $('offline-message').textContent = message; };

async function verifyShell() {
  if (!isSecureContext || !navigator.serviceWorker) throw new Error('Offline downloads require HTTPS or localhost.');
  const existing = await navigator.serviceWorker.getRegistration('/offline/');
  if (!existing?.active) await navigator.serviceWorker.register('/offline/sw.js', {scope:'/offline/'});
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_,reject) => setTimeout(() => reject(new Error('Offline app files could not be installed. Reconnect and reload.')),10000))
  ]);
  return new Promise((resolve,reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Offline app files could not be verified.')); },5000);
    channel.port1.onmessage = event => {
      clearTimeout(timeout);
      channel.port1.close();
      if (event.data === true) resolve();
      else reject(new Error('Offline app files are incomplete. Reconnect and reload.'));
    };
    registration.active.postMessage('verify-shell',[channel.port2]);
  });
}

async function readJSON(url, signal) {
  const response = await fetch(url,{cache:'no-store',signal});
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to download apartments.' : 'The apartment data could not be downloaded.');
  return response.json();
}

async function verifyJPEG(blob) {
  if (blob.type !== 'image/jpeg') throw new Error('A room did not return a JPEG.');
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    validateDimensions(image.naturalWidth,image.naturalHeight);
  } finally { URL.revokeObjectURL(url); }
}

export async function startOffline(showTour, closeTour) {
  document.title = 'Available Offline · Supported Housing';
  let key, controller, catalog = null, connection = 'Checking connection…';
  let active, timer, installPrompt, generation = 0, checkNumber = 0, opening = false, shellReady = false;
  const channel = new BroadcastChannel('housing-staff-offline');
  const locked = () => {
    generation++;
    controller?.abort();
    clearTimeout(timer);
    active = null;
    key = null;
    closeTour();
    document.body.classList.add('offline-locked');
    if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    $('offline-library').hidden = true;
    $('offline-saved').replaceChildren();
    $('offline-pass').value = '';
    updateControls();
  };
  channel.onmessage = event => { if (event.data === 'sign-out') locked(); };
  function updateControls() {
    $('offline-connection').textContent = connection;
    $('offline-unlock').hidden = !!key || (!catalog && connection !== 'Offline');
    $('offline-download').hidden = !key || !catalog;
  }
  async function refreshConnection() {
    const check = ++checkNumber;
    try {
      const response = await fetch(endpoint,{cache:'no-store',signal:AbortSignal.timeout(5000)});
      const result = response.ok ? await response.json() : null;
      if (check !== checkNumber) return;
      catalog = result?.apartments || null;
      if (response.ok) {
        connection = 'Online · Staff authenticated';
        if (active && !catalog.some(item=>item.id===active.id)) locked();
      }
      else {
        connection = [401,403].includes(response.status) ? 'Online · Staff sign-in required' : 'Online · Service unavailable';
        locked();
      }
    } catch (error) {
      if (check !== checkNumber) return;
      catalog = null;
      connection = error.name === 'TimeoutError' && navigator.onLine ? 'Server unreachable' : 'Offline';
      if (connection !== 'Offline') locked();
    }
    updateControls();
    if (key) await render();
  }
  function makeButton(text, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.onclick = () => Promise.resolve().then(handler).catch(error => say(error.message));
    return button;
  }
  async function render() {
    const vaultKey = key;
    if (!vaultKey) return;
    const records = (await storage('getAll')).filter(item => item.id);
    const saved = $('offline-saved');
    const entries = [];
    for (const record of records) {
      const entry = document.createElement('li');
      try {
        const tour = await unsealJSON(vaultKey,record.manifest,labelFor(record));
        const expired = record.expires <= Date.now();
        const current = catalog?.find(item => item.id === record.id);
        const missing = !!catalog && !current;
        const changed = current && current.revision !== record.revision;
        const complete = shellReady && tour.rooms.every(room => record.images[room.id]?.ciphertext?.size > 16)
          && Object.keys(record.images).length === tour.rooms.length;
        entry.textContent = `${tour.title} · ${format(record.bytes)} · ${missing ? 'Unavailable online' : expired ? 'Expired' : !complete ? 'Incomplete' : changed ? 'Update available' : 'Ready Offline'} `;
        if (!expired && !missing && complete) entry.append(makeButton('Open '+tour.title,()=>open(record)));
      } catch { entry.textContent = 'Damaged download. Remove and download again. '; }
      entry.append(makeButton('Remove download',async()=>{
        if (controller || opening) return;
        if (active?.id === record.id) { locked(); await storage('delete',record.id); return; }
        await storage('delete',record.id);
        await render();
      }));
      entries.push(entry);
    }
    if (vaultKey !== key) return;
    saved.replaceChildren(...entries);
    $('offline-used').textContent = `${format(records.reduce((sum, record) => sum + record.bytes, 0))} saved on this device`;
    const choices = $('offline-choices');
    const checked = new Set([...choices.querySelectorAll(':checked')].map(input=>input.value));
    choices.replaceChildren(...(catalog || []).map(apartment => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'apartment';
      input.value = apartment.id;
      input.checked = checked.has(apartment.id);
      label.append(input,document.createTextNode(`${apartment.title} · ${format(apartment.bytes)}`));
      return label;
    }));
  }
  async function open(record) {
    if (!key || controller || opening) return;
    if (record.expires <= Date.now() || (catalog && !catalog.some(item=>item.id===record.id))) throw new Error('Reconnect and download this apartment again.');
    opening = true;
    const vaultKey = key;
    const version = generation;
    try {
      const label = labelFor(record);
      const tour = validateApartment(await unsealJSON(vaultKey,record.manifest,label));
      const images = new Map();
      for (const room of tour.rooms) {
        if (version !== generation) return;
        images.set(room.id,new Blob([await unseal(vaultKey,record.images[room.id],label+'/'+room.id)],{type:'image/jpeg'}));
      }
      if (version !== generation || record.expires <= Date.now()) return;
      clearTimeout(timer);
      active = record;
      document.body.classList.remove('offline-locked');
      await showTour(tour,images,tour.startRoom);
      if (version !== generation) return;
      $('tour').scrollIntoView({block:'start'});
      say('Saved tour open · Read only');
      timer = setTimeout(() => { locked(); say('Offline access expired. Sign in and download again.'); },Math.max(0,record.expires-Date.now()));
    } finally { opening = false; }
  }
  async function download(apartment, signal, advance) {
    const vaultKey = key;
    const url = endpoint + '/' + apartment.id;
    const packageInfo = await readJSON(url+'/manifest',signal);
    const {tour,revision,expires,images} = packageInfo;
    validateApartment(tour);
    if (revision !== apartment.revision || !Number.isFinite(expires) || expires <= Date.now() ||
        images.length !== tour.rooms.length || tour.rooms.some(room => room.links.some(link=>link.pending))) throw new Error('This tour changed or is incomplete. Refresh the catalog and try again.');
    const record = {id:apartment.id,revision,expires,images:{},bytes:0};
    const label = labelFor(record);
    for (const room of tour.rooms) {
      const expected = images.find(image => image.room === room.id);
      const response = await fetch(url+'/images/'+room.id+'?revision='+encodeURIComponent(revision),{cache:'no-store',signal});
      if (!response.ok) throw new Error('A room download failed. The previous copy was kept.');
      const blob = await response.blob();
      if (!expected || blob.size !== expected.bytes) throw new Error('A room download was incomplete.');
      await verifyJPEG(blob);
      const encrypted = await seal(vaultKey,await blob.arrayBuffer(),label+'/'+room.id);
      Object.defineProperty(record.images,room.id,{value:encrypted,enumerable:true});
      record.bytes += encrypted.ciphertext.size + encrypted.iv.length;
      advance(blob.size);
    }
    record.manifest = await sealJSON(vaultKey,tour,label);
    record.bytes += record.manifest.ciphertext.size + record.manifest.iv.length;
    const latest = await readJSON(url+'/manifest',signal);
    if (latest.revision !== revision || signal.aborted || key !== vaultKey || expires <= Date.now()) throw new Error('The download changed or was cancelled. Try again.');
    // One transaction per apartment keeps an existing complete copy if the write fails.
    await storage('put',record,record.id);
  }
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    installPrompt = event;
    $('offline-install').hidden = false;
  });
  $('offline-install').onclick = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    installPrompt = null;
    $('offline-install').hidden = true;
  };
  $('offline-unlock').onsubmit = async event => {
    event.preventDefault();
    const button = $('offline-unlock-button');
    button.disabled = true;
    const version = generation;
    try {
      const unlocked = await openVault($('offline-pass').value,!!catalog);
      if (version !== generation) return;
      key = unlocked;
      $('offline-library').hidden = false;
      say('');
      updateControls();
      await render();
    } catch (error) { say(error.message); }
    finally { button.disabled = false; $('offline-pass').value = ''; }
  };
  $('offline-lock').onclick = locked;
  $('offline-storage').onclick = async () => {
    try { say(await navigator.storage.persist() ? 'Persistent storage granted. Downloads can still be cleared manually.' : 'The browser did not grant persistent storage.'); }
    catch { say('Persistent storage is unavailable on this browser.'); }
  };
  $('offline-cancel').onclick = () => controller?.abort();
  $('offline-download').onsubmit = async event => {
    event.preventDefault();
    if (!key || !catalog || controller || opening) return;
    const ids = new FormData(event.target).getAll('apartment');
    const apartments = catalog.filter(item=>ids.includes(item.id));
    if (!apartments.length) { say('Select at least one apartment.'); return; }
    controller = new AbortController();
    const {signal} = controller;
    const progress = $('offline-progress');
    const total = apartments.reduce((sum,item)=>sum+item.bytes,0);
    const button = event.target.querySelector('button');
    button.disabled = true;
    progress.max = total;
    progress.value = 0;
    progress.hidden = $('offline-cancel').hidden = false;
    try {
      await verifyShell();
      shellReady = true;
      const estimate = await navigator.storage.estimate();
      if (estimate.quota && estimate.quota-estimate.usage < total*1.05) throw new Error('Not enough browser storage. Remove downloads or free space and retry.');
      for (const apartment of apartments) {
        signal.throwIfAborted();
        say('Downloading '+apartment.title+'…');
        await download(apartment,signal,bytes=>{ progress.value+=bytes; });
      }
      say('Download verified. Ready Offline.');
    } catch (error) {
      say(signal.aborted ? 'Download cancelled. Completed apartments were kept.'
        : error.name === 'QuotaExceededError' ? 'Browser storage is full. Remove downloads and try again.' : error.message);
    } finally {
      controller = null;
      button.disabled = false;
      progress.hidden = $('offline-cancel').hidden = true;
      await render();
    }
  };
  const refresh = () => refreshConnection().catch(error=>say(error.message));
  window.addEventListener('online',refresh);
  window.addEventListener('offline',refresh);
  window.addEventListener('pagehide',locked);
  document.addEventListener('visibilitychange',()=>{
    if (document.hidden) return;
    if (active && active.expires <= Date.now()) locked();
    refresh();
  });
  setInterval(refresh,60000);
  // Register immediately so the browser can offer installation before a download.
  verifyShell().then(async () => {
    shellReady = true;
    if (key) await render();
  }).catch(error=>say(error.message));
  await refreshConnection();
  $('offline-unlock-button').textContent = await storage('get','settings') ? 'Unlock downloads' : 'Set up offline downloads';
}
