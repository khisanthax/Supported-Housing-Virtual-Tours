import { extractPanoramas, MAX_CLOUD_JPEG } from './panorama-zip.js';

const element = (tag, text) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
};
const suggestedName = name => name.replace(/\.jpe?g$/i, '').replace(/^\d+[\s_.-]+/, '')
  .replace(/[_-]+/g, ' ').trim().slice(0, 80);
const digest = async file => {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hash)].join(',');
};

export async function reviewBatch(files, existing, verify, save) {
  if (files.length > 24 || files.reduce((sum, file) => sum + file.size, 0) > 48 * 1024 * 1024) {
    throw new Error('Choose at most 24 files totaling at most 48 MiB.');
  }
  const items = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) items.push(...await extractPanoramas(file));
    else items.push({ name: file.name, file });
    if (items.length > 24 || items.reduce((sum, item) => sum + (item.file?.size ?? 0), 0) > 48 * 1024 * 1024) {
      throw new Error('Review at most 24 images and 48 MiB per batch.');
    }
  }
  const known = new Map();
  for (const room of existing.tour.rooms) if(existing.images.has(room.id)) known.set(await digest(existing.images.get(room.id)), room.name);
  const dialog = element('dialog');
  dialog.className = 'name-rooms batch-review';
  const title = element('h2', 'Review stitched panoramas');
  title.id = 'batch-title';
  dialog.setAttribute('aria-labelledby', title.id);
  dialog.append(title, element('p', 'Add another viewpoint by using the same room name, or choose an existing viewpoint to replace. Capture frames need to be stitched before import.'));
  const rows = [];
  const urls = [];
  for (const item of items) {
    const card = element('section');
    card.className = 'editor-card';
    card.append(element('h3', item.name));
    dialog.append(card);
    try {
      if (item.error) throw new Error(item.error);
      if (!/\.jpe?g$/i.test(item.name)) throw new Error('Choose a JPEG file.');
      if (item.file.size > MAX_CLOUD_JPEG) throw new Error('Each cloud JPEG must be 4 MiB or smaller.');
      await verify(item.file);
      const image = element('img');
      image.alt = 'Preview of ' + item.name;
      image.src = URL.createObjectURL(item.file);
      urls.push(image.src);
      card.append(image);
      const hash = await digest(item.file);
      const duplicate = known.get(hash);
      known.set(hash, item.name);
      if (duplicate) card.append(element('p', 'Exact duplicate of ' + duplicate + '. Skipped by default.'));
      const assignment = element('select');
      assignment.append(new Option('Add viewpoint', 'add'), new Option('Skip', 'skip'),
        ...existing.tour.rooms.map(room => new Option('Replace ' + room.name + ' (' + room.id + ')', room.id)));
      assignment.value = duplicate ? 'skip' : 'add';
      const name = element('input');
      name.maxLength = 80;
      name.value = suggestedName(item.name);
      const assignmentLabel = element('label', 'Assignment');
      const nameLabel = element('label', 'Room or viewpoint name');
      assignmentLabel.append(assignment);
      nameLabel.append(name);
      assignment.onchange = () => {
        name.disabled = assignment.value === 'skip';
        const replacement = existing.tour.rooms.find(room => room.id === assignment.value);
        if (replacement) name.value = replacement.name;
      };
      name.disabled = assignment.value === 'skip';
      card.append(assignmentLabel, nameLabel);
      rows.push({ name, assignment, file: new Blob([item.file], { type: 'image/jpeg' }) });
    } catch (error) {
      card.append(element('p', error.message + ' Skipped. Use a completed stitched panorama.'));
    }
  }
  const progress = element('p');
  progress.setAttribute('role', 'status');
  const saveButton = element('button', 'Upload and save draft');
  const cancel = element('button', 'Cancel');
  saveButton.className = 'edit-button';
  cancel.className = 'edit-button secondary';
  const actions = element('div');
  actions.className = 'edit-actions';
  actions.append(saveButton, cancel);
  dialog.append(progress, actions);
  document.body.append(dialog);
  try {
    await new Promise(resolve => {
      dialog.addEventListener('close', resolve, { once: true });
      dialog.addEventListener('cancel', event => { if (cancel.disabled) event.preventDefault(); });
      cancel.onclick = () => dialog.close();
      saveButton.disabled = !rows.length;
      saveButton.onclick = async () => {
        saveButton.disabled = cancel.disabled = true;
        const chosen = rows.filter(row => row.assignment.value !== 'skip').map(row => ({
          name: row.name.value.trim(), assignment: row.assignment.value,
          file: row.file
        }));
        try {
          if (!chosen.length || chosen.some(row => !row.name)) throw new Error('Select at least one image and name each selected viewpoint.');
          await save(chosen, message => { progress.textContent = message; });
          dialog.close();
        } catch (error) {
          progress.textContent = error.message;
          saveButton.textContent = 'Retry save';
        } finally {
          saveButton.disabled = cancel.disabled = false;
        }
      };
      dialog.showModal();
    });
  } finally {
    dialog.remove();
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
