import { validateApartment, validateDimensions } from './tour-data.js';
const $ = (id) => document.getElementById(id);
const guest = document.body.dataset.guest === 'true';
const offline = document.body.dataset.offline === 'true';
const guestTour = guest ? '/api/guest/tours/' + location.pathname.split('/').at(-1) : null;
const state = { data: null, viewer: null, scene: null, room: null, request: 0, overrides: new Map(), busy: false };
let editor;
let imageUrls = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function report(message) { $('error').textContent = message; $('error').hidden = false; $('loading').hidden = true;if($('guide-status'))$('guide-status').textContent=message; }
function readImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The JPEG could not be opened. Choose another file or restore the sample room.'));
    img.src = url;
  });
}
async function prepareImage(url) {
  const img = await readImage(url);
  validateDimensions(img.naturalWidth, img.naturalHeight);
  // Single-resolution panoramas are bounded for phone GPU memory. The original file stays untouched.
  const gl = document.createElement('canvas').getContext('webgl');
  const widthLimit = Math.min(4096, gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096);
  if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
  if (img.naturalWidth <= widthLimit) return { url, width: img.naturalWidth };
  const canvas = document.createElement('canvas');
  canvas.width = widthLimit; canvas.height = widthLimit / 2;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return { url: canvas.toDataURL('image/jpeg', 0.9), width: widthLimit };
}
function updateUI(room) {
  $('scene-name').textContent = room.name;
  $('room-title').textContent = room.name;
  $('room-description').textContent = room.description || '';
  const index = state.data.rooms.indexOf(room);
  $('room-count').textContent = `${String(index + 1).padStart(2, '0')} / ${String(state.data.rooms.length).padStart(2, '0')}`;
  $('previous').disabled = index === 0;
  $('next').disabled = index === state.data.rooms.length - 1;
  document.querySelectorAll('.room-tab').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.room === room.id)));
  $('pano').setAttribute('aria-label', `${room.name}, 360 degree view. Drag or use arrow keys to look around. Pinch or scroll to zoom.`);
  $('announcement').textContent = `${room.name} opened. ${state.overrides.has(room.id) ? 'Local JPEG preview.' : `${room.links.length} connected doorway${room.links.length === 1 ? '' : 's'}.`}`;
  if ($('restore-demo')) $('restore-demo').disabled = !state.overrides.has(room.id);
  if ($('upload-status')) $('upload-status').textContent = state.overrides.has(room.id) ? 'Local preview only. No file was uploaded. Doorway arrows are hidden.' : '';
  updateCoordinates();
  editor?.roomChanged(room);
}
function updateCoordinates() {
  if (!state.scene) return;
  const view = state.scene.view();
  if ($('coordinates')) $('coordinates').textContent = `View position (radians): yaw ${view.yaw().toFixed(3)}, pitch ${view.pitch().toFixed(3)}`;
}
function initialView(room) {
  const rect = $('pano').getBoundingClientRect();
  return { ...room.initialView, fov: rect.width < rect.height ? Math.max(room.initialView.fov, 1.85) : room.initialView.fov };
}
function drawDoors(scene,room){
 const container=scene.hotspotContainer();for(const h of container.listHotspots())container.destroyHotspot(h);
    if (!state.overrides.has(room.id)) for (const [index, link] of room.links.entries()) {
      if (link.pending) continue;
      const target = state.data.rooms.find((r) => r.id === link.target);
      const button = document.createElement('button');
      button.className = 'hotspot'; button.dataset.doorIndex = index;
      button.setAttribute('aria-label', editor?.editing ? `Edit arrow ${index + 1} to ${target.name}` : `Go to ${target.name}`);
      const arrow = document.createElement('span'); arrow.className = 'hotspot-arrow'; arrow.textContent = '↑'; arrow.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'hotspot-label'; label.textContent = target.name;
      button.append(arrow, label); button.addEventListener('click', () => {
        if (editor?.editing) { if(editor.inspectDoor)editor.inspectDoor(index,button);else editor.selectDoor(index,true); }
        else openRoom(target.id, { focus: true });
      });
      if(editor?.editing)editor.bindDoorDrag?.(button,index,target);
      // Marzipano owns the anchor's transform; centre the inner button separately.
      const anchor = document.createElement('div'); anchor.append(button);
      scene.hotspotContainer().createHotspot(anchor, { yaw: link.yaw, pitch: link.pitch });
    }
}
async function openRoom(id, { focus = false, force = false, position } = {}) {
  const room = state.data.rooms.find((r) => r.id === id);
  if (!room || (room === state.room && !force)) return;
  const request = ++state.request;
  state.busy = true;
  $('error').hidden = true; $('loading').hidden = false;
  let nextScene;
  try {
    const image = await prepareImage(guest ? `${guestTour}/images/${id}` : state.overrides.get(id) || imageUrls.get(id)?.url || room.image);
    if (request !== state.request) return;
    const M = window.Marzipano;
    const limiter = M.RectilinearView.limit.traditional(image.width / 4, 110 * Math.PI / 180, 120 * Math.PI / 180);
    const view = new M.RectilinearView(position || initialView(room), limiter);
    nextScene = state.viewer.createScene({ source: M.ImageUrlSource.fromString(image.url), geometry: new M.EquirectGeometry([{ width: image.width }]), view, pinFirstLevel: true });
    nextScene.layer().textureStore().addEventListener('textureError', () => report('This device could not render the image. Try a smaller 2:1 JPEG.'));
    drawDoors(nextScene,room);
    // Zero-duration scene switches avoid retaining large old panoramas during transitions.
    nextScene.switchTo({ transitionDuration: 0 });
    const oldScene = state.scene;
    state.scene = nextScene; state.room = room;
    if (oldScene) state.viewer.destroyScene(oldScene);
    view.addEventListener('change', updateCoordinates);
    updateUI(room);
    history.replaceState(null, '', `#${room.id}`);
    if (focus) $('pano').focus({ preventScroll: true });
    $('loading').hidden = true;
  } catch (error) {
    if (nextScene && nextScene !== state.scene) state.viewer.destroyScene(nextScene);
    if (request === state.request) report(error.message || 'Unable to open this room.');
  } finally { if (request === state.request) state.busy = false; }
}
function zoom(factor) {
  if (!state.scene) return;
  const view = state.scene.view(); view.setFov(view.fov() * factor);
}
function setFullscreenLabel() {
  const active = document.fullscreenElement === $('tour') || $('tour').classList.contains('expanded');
  $('fullscreen').setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
  $('fullscreen').title = active ? 'Exit fullscreen' : 'Fullscreen';
}
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('tour').classList.contains('expanded')) { $('tour').classList.remove('expanded'); document.body.classList.remove('no-scroll'); }
    else if ($('tour').requestFullscreen && document.fullscreenEnabled) await $('tour').requestFullscreen();
    else { $('tour').classList.add('expanded'); document.body.classList.add('no-scroll'); }
  } catch { $('tour').classList.toggle('expanded'); document.body.classList.toggle('no-scroll', $('tour').classList.contains('expanded')); }
  setFullscreenLabel();
});
document.addEventListener('fullscreenchange', setFullscreenLabel);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('tour').classList.contains('expanded')) { $('tour').classList.remove('expanded'); document.body.classList.remove('no-scroll'); setFullscreenLabel(); }
});
$('pano').addEventListener('keydown', (event) => {
  if (!state.scene) return;
  const view = state.scene.view();
  const moves = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.10], ArrowDown: [0, 0.10] };
  if (moves[event.key]) { event.preventDefault(); const [yaw, pitch] = moves[event.key]; view.setYaw(view.yaw() + yaw); view.setPitch(view.pitch() + pitch); }
  if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(0.85); }
  if (event.key === '-') { event.preventDefault(); zoom(1.15); }
});
$('zoom-in').addEventListener('click', () => zoom(0.85));
$('zoom-out').addEventListener('click', () => zoom(1.15));
$('reset-view').addEventListener('click', () => { if (state.scene) state.scene.lookTo(initialView(state.room), { transitionDuration: reducedMotion ? 0 : 250 }); });
for (const [id, step] of [['previous', -1], ['next', 1]]) $(id).addEventListener('click', () => {
  const index = state.data.rooms.indexOf(state.room);
  const room = state.data.rooms[index + step]; if (room) openRoom(room.id);
});
$('photo-input')?.addEventListener('change', async (event) => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file || !state.room) return;
  const roomId = state.room.id;
  let url;
  try {
    if (!/\.jpe?g$/i.test(file.name) || (file.type && file.type !== 'image/jpeg')) throw new Error('Please choose a JPEG (.jpg or .jpeg) file.');
    if (file.size > 40 * 1024 * 1024) throw new Error('Choose a JPEG under 40 MB for this phone-friendly prototype.');
    url = URL.createObjectURL(file);
    const img = await readImage(url); validateDimensions(img.naturalWidth, img.naturalHeight);
    if (img.naturalWidth > 16384 || img.naturalHeight > 8192) throw new Error('Choose a JPEG no larger than 16384 × 8192 pixels.');
    if (state.overrides.has(roomId)) URL.revokeObjectURL(state.overrides.get(roomId));
    state.overrides.set(roomId, url);
    await openRoom(roomId, { force: true });
  } catch (error) { if (url) URL.revokeObjectURL(url); $('upload-status').textContent = error.message; }
});
$('restore-demo')?.addEventListener('click', async () => {
  if (!state.room) return;
  const id = state.room.id; const url = state.overrides.get(id); state.overrides.delete(id);
  await openRoom(id, { force: true }); if (url) URL.revokeObjectURL(url);
});
window.addEventListener('hashchange', () => { if (state.data) openRoom(location.hash.slice(1)); });
function currentView() {
  const view = state.scene?.view();
  return view && { yaw: view.yaw(), pitch: view.pitch(), fov: view.fov() };
}
async function showTour(data, images, preferredRoom, keepView = false) {
  const position = keepView && state.room?.id === preferredRoom ? currentView() : undefined;
  const previous = imageUrls;
  const newUrls = new Map();
  for (const [id, blob] of images ?? []) {
    const entry = previous.get(id);
    newUrls.set(id, entry?.blob === blob ? entry : { blob, url: URL.createObjectURL(blob) });
  }
  imageUrls = newUrls;
  for (const url of state.overrides.values()) URL.revokeObjectURL(url);
  state.overrides.clear();
  state.data = data;
  $('apartment-title').textContent = data.title;
  document.title = `${data.title} · 360° walkthrough`;
  document.querySelector('.tour-meta div span').textContent = `${data.rooms.length} rooms · Explore freely`;
  document.querySelector('.demo-tag').textContent = offline ? 'Saved tour · Read only' : guest ? 'Shared tour' : images ? 'Private draft' : '● Sample apartment';
  document.querySelector('.synthetic-badge').hidden = guest || !!images;
  if (!guest && !offline) document.querySelector('.local-preview').hidden = !!images;
  document.querySelector('.details aside').hidden = guest || !!images;
  document.querySelector('footer > span:last-child').textContent = guest || images ? '360° apartment walkthrough' : 'Six-room sample · No real apartment photography';
  $('room-tabs').replaceChildren();
  data.rooms.forEach((room, index) => {
    const button = document.createElement('button'); button.className = 'room-tab'; button.dataset.room = room.id; button.setAttribute('aria-pressed', 'false');
    const number = document.createElement('span'); number.className = 'room-number'; number.textContent = String(index + 1).padStart(2, '0'); number.setAttribute('aria-hidden', 'true');
    button.append(number, document.createTextNode(room.name)); button.addEventListener('click', () => openRoom(room.id)); $('room-tabs').append(button);
  });
  const target = data.rooms.some(room => room.id === preferredRoom) ? preferredRoom : data.startRoom;
  if(keepView&&state.scene&&state.room?.id===target&&previous.get(target)?.blob===newUrls.get(target)?.blob){state.room=data.rooms.find(r=>r.id===target);drawDoors(state.scene,state.room);updateUI(state.room);state.viewer.updateSize();}
  else await openRoom(target, { force: true, position });
  for (const [id, entry] of previous) if (newUrls.get(id) !== entry) URL.revokeObjectURL(entry.url);
}
async function init() {
  try {
    if (!window.Marzipano) throw new Error('The local Marzipano viewer could not load. Check that vendor/marzipano.js is present.');
    state.viewer = new window.Marzipano.Viewer($('pano'), { controls: { mouseViewMode: 'drag' } });
    new ResizeObserver(() => state.viewer.updateSize()).observe($('pano'));
    if (offline) {
      const { startOffline } = await import('./offline.js');
      await startOffline(showTour, () => {
        state.request++;
        if (state.scene) state.viewer.destroyScene(state.scene);
        state.scene = state.room = state.data = null;
        for (const {url} of imageUrls.values()) URL.revokeObjectURL(url);
        imageUrls.clear();
        $('room-tabs').replaceChildren();
        $('apartment-title').textContent = 'Saved apartment';
        $('scene-name').textContent = $('room-title').textContent = $('room-description').textContent = $('announcement').textContent = '';
        document.title = 'Available Offline · Supported Housing';
      });
      return;
    }
    if (document.body.dataset.guided === 'true') {
      const { createGuidedEditor } = await import('./guided-editor.js');
      editor = await createGuidedEditor({ showTour, openRoom, currentRoom: () => state.room,
        pausePanning: paused => paused ? state.viewer.controls().disable() : state.viewer.controls().enable(),
        coordinatesAt: event => {
          if (!state.scene || state.busy) throw new Error('Wait for the panorama to open.');
          state.viewer.updateSize();
          const rect = $('pano').getBoundingClientRect();
          const point = state.scene.view().screenToCoordinates(event.type==='click'&&event.detail === 0 ? {x: $('pano').clientWidth/2,y: $('pano').clientHeight/2}
            : {x:(event.clientX-rect.left)*$('pano').clientWidth/rect.width,y:(event.clientY-rect.top)*$('pano').clientHeight/rect.height});
          if(!Number.isFinite(point.yaw)||!Number.isFinite(point.pitch))throw new Error('Wait for the panorama to finish sizing, then tap the doorway again.');
          return point;
        }
      });
      return;
    }
    const response = await fetch(guest ? guestTour + '/manifest' : 'data/apartment.json');
    if (guest && !response.ok) { location.replace('/guest'); return; }
    if (!response.ok) throw new Error('Apartment data is unavailable. Serve this folder over HTTP, rather than opening the HTML file directly.');
    const sample = validateApartment(await response.json());
    if (!guest) {
      const { createTourEditor } = await import('./tour-editor.js');
      editor = createTourEditor({
      sample, showTour, currentView, openRoom,
      currentRoom: () => state.room,
      coordinatesAt: (event) => {
        if (!state.scene || state.busy) throw new Error('Wait for the room to finish opening.');
        const element = $('pano');
        const rect = element.getBoundingClientRect();
        return state.scene.view().screenToCoordinates(event.detail === 0
          ? { x: element.clientWidth / 2, y: element.clientHeight / 2 }
          : { x: (event.clientX - rect.left) * element.clientWidth / rect.width, y: (event.clientY - rect.top) * element.clientHeight / rect.height });
      }
      });
    }
    await showTour(sample, null, location.hash.slice(1));
    if (guest) {
      const checkAccess = async () => {
        try {
          const result = await fetch('/api/guest/catalog');
          if ([401,403].includes(result.status)) location.replace('/guest');
        } catch { /* Offline connections do not grant new access. */ }
      };
      setInterval(checkAccess, 15000);
      window.addEventListener('pageshow', checkAccess);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) checkAccess(); });
    }
  } catch (error) { report(error.message || 'A WebGL-capable browser is needed for the 360° viewer.'); }
}
init();
