let apartment = new URLSearchParams(location.search).get('apartment');
let savedPhotos = new Map();

async function request(path, options) {
  const response = await fetch('/api/staff/' + path, options);
  if (response.status === 401) location.assign('/staff');
  if (!response.ok) throw new Error((await response.json()).error);
  return response;
}

export async function loadDraft() {
  if (!apartment) return null;
  const { tour, photos, revision } = await (await request('drafts/' + apartment)).json();
  const images = new Map(await Promise.all(tour.rooms.filter(r=>Object.hasOwn(photos,r.id)).map(async room => [
    room.id,
    await (await request(`tours/${apartment}/images/${room.id}?version=${revision}`)).blob()
  ])));
  savedPhotos = new Map([...images].map(([room, blob]) => [room, { blob, id: photos[room] }]));
  return { tour, images, revision };
}

export async function saveDraft({ tour, images }, revision, progress = () => {}) {
  for (const image of images.values()) {
    if (image.size > 4 * 1024 * 1024) throw new Error('Each cloud JPEG must be 4 MiB or smaller.');
  }
  const uploaded = new Map();
  for (const [room, blob] of images) {
    let photo = savedPhotos.get(room);
    if (photo?.blob !== blob) {
      progress('Uploading ' + tour.rooms.find(item => item.id === room).name + ' (' + (uploaded.size + 1) + ' of ' + images.size + ')…');
      const result = await request('photos', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      photo = { blob, id: (await result.json()).id };
      savedPhotos.set(room, photo);
    }
    uploaded.set(room, photo);
  }
  progress('Saving shared draft…');
  const response = await request('apartments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tour, photos: Object.fromEntries([...uploaded].map(([room, photo]) => [room, photo.id])),
      replacement: apartment, expectedVersion: revision, draft: true
    })
  });
  const result = await response.json();
  apartment = result.id;
  savedPhotos = uploaded;
  history.replaceState(null, '', '?apartment=' + apartment + (new URLSearchParams(location.search).has('legacy') ? '&legacy=1' : ''));
  return result.version;
}
