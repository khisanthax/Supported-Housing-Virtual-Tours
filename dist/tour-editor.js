import { addConnection, deleteRoom, inspectJpeg, MAX_ROOMS, packTour, pairedArrow, removeConnection, retargetConnection, unpackTour, validateDraft } from './tour-package.js';
import { loadDraft, saveDraft } from './tour-store.js';
import { validateDimensions } from './tour-data.js';

const $ = id => document.getElementById(id);

async function verifyImage(blob) {
  await inspectJpeg(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    validateDimensions(image.naturalWidth, image.naturalHeight);
  } catch {
    throw new Error('The JPEG could not be decoded as a full 2:1 panorama.');
  } finally { URL.revokeObjectURL(url); }
}

export function createTourEditor({ sample, showTour, currentRoom, currentView, coordinatesAt, openRoom }) {
  let draft, revision = 0, mode = 'sample', selected = null, placement = null, busy = false, editRoomId;
  const room = () => draft?.tour.rooms.find(item => item.id === currentRoom()?.id);
  const pendingCount = () => draft?.tour.rooms.reduce((sum, item) => sum + item.links.filter(link => link.pending).length, 0) ?? 0;
  const status = message => {
    $('editor-status').textContent = message;
    $('editor-feedback').textContent = message;
  };
  function renderMode() {
    $('edit-tour').hidden = mode === 'edit';
    $('edit-tour').textContent = mode === 'preview' ? 'Back to editor' : 'Edit Tour';
    $('preview-tour').hidden = mode !== 'edit';
    $('exit-editor').hidden = mode === 'sample';
    $('editor-panel').hidden = mode !== 'edit';
    $('place-return').hidden = true;
  }
  function cancelPlacement() {
    placement = null;
    $('place-on-pano').hidden = $('cancel-placement').hidden = $('cancel-on-pano').hidden = true;
  }
  function renderDoors() {
    const active = room();
    if (!active) return;
    const select = $('door-target');
    const previous = select.value;
    select.replaceChildren();
    const others = draft.tour.rooms.filter(r => r.id !== active.id);
    for (const item of others) select.add(new Option(item.name, item.id));
    if (!others.length) select.add(new Option('Add another room first', ''));
    select.value = active.links[selected]?.target ?? (others.some(r => r.id === previous) ? previous : others[0]?.id ?? '');
    $('add-door').disabled = select.disabled = !others.length;
    $('selected-door-actions').hidden = !active.links[selected];
    const current = active.links[selected];
    $('move-door').textContent = current?.pending ? 'Position arrow' : 'Move arrow';
    $('retarget-door').disabled = !!current?.pending;
    $('delete-door').textContent = current?.pairId ? 'Delete connection' : 'Delete arrow';
    $('place-return').hidden = !current?.pending && !pairedArrow(draft.tour, current)?.link.pending;
    $('place-return').textContent = current?.pending ? 'Place return in this room' : 'Position return arrow';
    $('door-list').replaceChildren();
    if (!active.links.length) $('door-list').textContent = 'No doorway arrows in this room yet.';
    active.links.forEach((link, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'edit-button secondary';
      button.textContent = `${index + 1}. ${draft.tour.rooms.find(r => r.id === link.target).name}${link.pending ? ' · Needs position' : ''}`;
      button.setAttribute('aria-pressed', String(selected === index));
      button.addEventListener('click', () => selectDoor(index));
      $('door-list').append(button);
    });
    $('pano').querySelectorAll('[data-door-index]').forEach(button => {
      button.classList.toggle('selected-door', Number(button.dataset.doorIndex) === selected);
    });
  }
  function roomChanged(active) {
    if (mode !== 'edit') return;
    cancelPlacement();
    if (!room()) return;
    $('draft-title').value = draft.tour.title;
    $('draft-room-name').value = active.name;
    $('start-badge').hidden = active.id !== draft.tour.startRoom;
    $('set-start').disabled = active.id === draft.tour.startRoom;
    $('delete-room').disabled = draft.tour.rooms.length === 1;
    if (editRoomId !== active.id) selected = null;
    editRoomId = active.id;
    renderDoors();
  }
  function selectDoor(index, reveal = false) {
    if (busy || !room()?.links[index]) return;
    cancelPlacement();
    selected = index;
    renderDoors();
    if (reveal) $('door-list').children[index]?.scrollIntoView({ block: 'nearest' });
  }
  async function perform(operation) {
    if (busy) return;
    busy = true;
    for (const id of ['editor-fields', 'edit-tour', 'preview-tour', 'exit-editor', 'place-return']) $(id).disabled = true;
    try { await operation(); }
    catch (error) {
      status(error?.name === 'QuotaExceededError'
        ? 'This browser is out of storage. The previous draft was kept. Export a backup and try smaller JPEGs.'
        : error?.message || 'The edit could not be completed. The previous draft was kept.');
    } finally {
      busy = false;
      for (const id of ['editor-fields', 'edit-tour', 'preview-tour', 'exit-editor', 'place-return']) $(id).disabled = false;
    }
  }
  async function commit(next, preferredRoom, message, keepView = true) {
    validateDraft(next);
    revision = await saveDraft(next, revision);
    draft = next;
    await showTour(draft.tour, draft.images, preferredRoom, keepView);
    const unfinished = pendingCount();
    status(`${message || 'Saved on this device.'}${unfinished ? ` ${unfinished} return ${unfinished === 1 ? 'arrow needs' : 'arrows need'} positioning.` : ''}`);
  }
  function modify(mutate, message, keepView = true) {
    const active = room();
    if (!active) return;
    return perform(async () => {
      const next = { tour: structuredClone(draft.tour), images: new Map(draft.images) };
      mutate(next.tour.rooms.find(r => r.id === active.id), next.tour, next.images);
      await commit(next, active.id, message, keepView);
    });
  }
  async function sampleDraft() {
    const tour = structuredClone(sample);
    const images = new Map();
    for (const item of tour.rooms) {
      const response = await fetch(item.image);
      if (!response.ok) throw new Error('A sample JPEG could not be opened.');
      images.set(item.id, await response.blob());
      item.image = `images/${item.id}.jpg`;
    }
    return { tour, images };
  }
  $('edit-tour').addEventListener('click', () => perform(async () => {
    const fromPreview = mode === 'preview';
    if (!fromPreview) {
      const saved = await loadDraft();
      revision = saved?.revision ?? 0;
      draft = saved ? validateDraft({ tour: saved.tour, images: saved.images }) : await sampleDraft();
      if (!saved) revision = await saveDraft(draft, revision);
    }
    mode = 'edit';
    selected = null;
    renderMode();
    await showTour(draft.tour, draft.images, fromPreview ? editRoomId : undefined);
    status(pendingCount() ? `${pendingCount()} return arrows still need positioning. Check the room arrow lists.` : 'Draft saved on this device. Export a backup to move or keep a copy.');
  }));
  $('exit-editor').addEventListener('click', () => perform(async () => {
    cancelPlacement();
    mode = 'sample';
    renderMode();
    await showTour(sample, null);
    status('Sample tour. Your saved draft is still available under Edit Tour.');
  }));
  $('preview-tour').addEventListener('click', () => perform(async () => {
    cancelPlacement();
    mode = 'preview';
    renderMode();
    await showTour(draft.tour, draft.images);
    status(pendingCount() ? 'Visitor preview · Return arrows without a position are hidden.' : 'Visitor preview · Private to this browser');
    $('tour').scrollIntoView({ block: 'nearest' });
  }));
  $('tour-title-form').addEventListener('submit', event => {
    event.preventDefault();
    const title = $('draft-title').value.trim();
    if (!title) { status('Enter an apartment title.'); return; }
    modify((_, tour) => { tour.title = title; }, 'Apartment title saved.');
  });
  $('room-name-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('draft-room-name').value.trim();
    if (!name) { status('Enter a room name.'); return; }
    modify(active => { active.name = name; }, 'Room name saved.');
  });
  $('set-start').addEventListener('click', () => modify((active, tour) => { tour.startRoom = active.id; }, 'Start room saved.'));
  $('set-view').addEventListener('click', () => {
    const position = currentView();
    if (!position) return;
    modify(active => { active.initialView = { ...position, fov: Math.max(.35, Math.min(2.1, position.fov)) }; }, 'Starting view saved.');
  });
  function confirmEdit(title, message, action) {
    const dialog = $('confirm-edit');
    $('confirm-edit-title').textContent = title;
    $('confirm-edit-help').textContent = message;
    $('confirm-edit-action').textContent = action;
    dialog.returnValue = '';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
      dialog.showModal();
    });
  }
  $('delete-room').addEventListener('click', () => perform(async () => {
    const active = room();
    if (!active || !await confirmEdit('Delete room?', `“${active.name}” and its doorway connections will be removed from this draft.`, 'Delete room and connections')) return;
    const next = deleteRoom(draft, active.id);
    selected = null;
    await commit(next, next.tour.startRoom, 'Room and its doorway links deleted.', false);
  }));
  function filesFrom(id, operation) {
    $(id).addEventListener('change', event => {
      const files = [...event.target.files];
      event.target.value = '';
      if (files.length) perform(() => operation(files));
    });
  }
  function askNames(files, fresh) {
    const dialog = $('name-rooms');
    $('name-rooms-help').textContent = fresh
      ? 'Name each viewpoint. Saving replaces the current draft. Cancel and export a backup first if you want to keep it.'
      : 'Give each viewpoint a room name visitors will recognize.';
    $('save-named-rooms').textContent = fresh ? 'Replace draft and save rooms' : 'Save rooms';
    const inputs = files.map((file, index) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.required = true;
      input.maxLength = 80;
      input.value = file.name.replace(/\.jpe?g$/i, '').trim().slice(0, 80) || `Room ${index + 1}`;
      label.append(`Room ${index + 1} · ${file.name}`, input);
      return { label, input };
    });
    $('room-name-inputs').replaceChildren(...inputs.map(item => item.label));
    dialog.returnValue = '';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'save' ? inputs.map(item => item.input.value.trim()) : null), { once: true });
      dialog.showModal();
    });
  }
  async function addRooms(files, fresh) {
    const tour = fresh ? { id: 'apartment', title: 'Untitled apartment', rooms: [] } : structuredClone(draft.tour);
    const images = fresh ? new Map() : new Map(draft.images);
    if (tour.rooms.length + files.length > MAX_ROOMS) throw new Error('This editor supports at most 12 rooms per tour.');
    status('Checking JPEGs…');
    for (const file of files) {
      try { await verifyImage(file); }
      catch (error) { throw new Error(`${file.name}: ${error.message} No rooms were added.`); }
    }
    const names = await askNames(files, fresh);
    if (!names) { status('Current draft kept.'); return; }
    if (names.some(name => !name)) throw new Error('Each room needs a name. No rooms were added.');
    let firstId;
    for (const [index, file] of files.entries()) {
      let number = 1;
      while (images.has(`room-${number}`)) number++;
      const id = `room-${number}`;
      firstId ??= id;
      tour.rooms.push({ id, name: names[index],
        image: `images/${id}.jpg`, initialView: { yaw: 0, pitch: 0, fov: 1.45 }, links: [] });
      images.set(id, file);
    }
    tour.startRoom ??= firstId;
    const next = validateDraft({ tour, images });
    selected = null;
    await commit(next, firstId, `${files.length} room ${files.length === 1 ? 'photo' : 'photos'} saved.`, false);
  }
  filesFrom('add-rooms', files => addRooms(files, false));
  filesFrom('new-tour', files => addRooms(files, true));
  filesFrom('replace-photo', async ([file]) => {
    const active = room();
    if (!active) return;
    await verifyImage(file);
    const images = new Map(draft.images);
    images.set(active.id, file);
    await commit({ tour: draft.tour, images }, active.id, 'Photo replaced. Doorway links kept.');
  });
  $('export-tour').addEventListener('click', () => perform(async () => {
    const url = URL.createObjectURL(packTour(draft));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${draft.tour.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'apartment'}.shtour`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    status(pendingCount() ? 'Draft backup download started. It includes unpositioned return arrows.' : 'Backup download started. It contains every original JPEG and doorway link.');
  }));
  filesFrom('import-tour', async ([file]) => {
    status('Checking backup…');
    const next = await unpackTour(file);
    for (const image of next.images.values()) await verifyImage(image);
    if (!await confirmEdit('Import this backup?', 'Import replaces the current draft. Cancel and export the current draft first if you want to keep it.', 'Replace draft with backup')) {
      status('Current draft kept.');
      return;
    }
    selected = null;
    await commit(next, next.tour.startRoom, 'Backup imported and saved on this device.', false);
  });
  function beginPlacement(kind) {
    const active = room();
    if (busy || !active || (kind === 'add' && draft.tour.rooms.length < 2) || (kind === 'move' && !active.links[selected])) return;
    placement = { roomId: active.id, kind, index: selected };
    $('place-on-pano').hidden = $('cancel-placement').hidden = $('cancel-on-pano').hidden = false;
    $('tour').scrollIntoView({ block: 'center' });
    $('place-on-pano').focus({ preventScroll: true });
  }
  $('add-door').addEventListener('click', () => beginPlacement('add'));
  $('move-door').addEventListener('click', () => beginPlacement('move'));
  $('place-return').addEventListener('click', async () => {
    const current = room()?.links[selected];
    if (current?.pending) { beginPlacement('move'); return; }
    const reverse = pairedArrow(draft.tour, current);
    if (!reverse?.link.pending || busy) return;
    await perform(async () => {
      await openRoom(reverse.room.id);
      if (room()?.id !== reverse.room.id) throw new Error('The destination room could not be opened.');
      selected = reverse.index;
      renderDoors();
    });
    if (room()?.id === reverse.room.id) {
      // Let staff pan first; placement locks the view until they tap.
      status('Look toward the doorway you came through, then choose Place return in this room.');
      $('editor-status').scrollIntoView({ block: 'nearest' });
      $('place-return').focus({ preventScroll: true });
    }
  });
  $('cancel-placement').addEventListener('click', cancelPlacement);
  $('cancel-on-pano').addEventListener('click', cancelPlacement);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') cancelPlacement(); });
  let pointerStart;
  $('place-on-pano').addEventListener('pointerdown', event => { pointerStart = [event.clientX, event.clientY]; });
  $('place-on-pano').addEventListener('click', async event => {
    const pending = placement;
    if (!pending || room()?.id !== pending.roomId) return;
    if (event.detail && pointerStart && Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 12) return;
    try {
      const point = coordinatesAt(event);
      cancelPlacement();
      let target;
      if (pending.kind === 'add') {
        const dialog = $('choose-destination');
        const select = $('new-door-target');
        select.replaceChildren(new Option('Choose a room', ''), ...draft.tour.rooms
          .filter(item => item.id !== pending.roomId)
          .map(item => new Option(item.name, item.id)));
        dialog.returnValue = '';
        const result = new Promise(resolve => dialog.addEventListener('close', () => {
          resolve(dialog.returnValue === 'save' ? select.value : '');
        }, { once: true }));
        dialog.showModal();
        target = await result;
        if (!target || room()?.id !== pending.roomId) return;
      }
      modify((active, tour) => {
        if (pending.kind === 'add') {
          addConnection(tour, active, target, point);
          selected = active.links.length - 1;
        } else {
          Object.assign(active.links[pending.index], point);
          delete active.links[pending.index].pending;
        }
      }, pending.kind === 'add' ? 'Doorway saved. Position its return arrow next.' : 'Doorway arrow positioned.');
    } catch (error) { status(error.message); }
  });
  $('retarget-door').addEventListener('click', () => {
    const target = $('door-target').value;
    if (!room()?.links[selected] || !target) return;
    modify((active, tour) => retargetConnection(tour, active, selected, target), 'Doorway destination saved.');
  });
  $('delete-door').addEventListener('click', () => {
    if (!room()?.links[selected]) return;
    const paired = !!room().links[selected].pairId;
    modify((active, tour) => { removeConnection(tour, active, selected); selected = null; }, paired ? 'Connection deleted from both rooms.' : 'Doorway arrow deleted.');
  });
  return { get editing() { return mode === 'edit'; }, roomChanged, selectDoor };
}
