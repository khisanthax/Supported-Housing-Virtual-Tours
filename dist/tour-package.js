import { validateApartment, validateDimensions } from './tour-data.js';
import { edgeKey, reconcileGrid } from './room-grid.js';
import { hasStitch } from './builder-data.js';

export const MAX_ROOMS = 12;
export const MAX_IMAGE = 40 * 1024 * 1024;
export const MAX_TOTAL = 160 * 1024 * 1024;
const MAX_MANIFEST = 128 * 1024;
const MAGIC = 'SHTOUR01';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export async function inspectJpeg(blob) {
  if (!(blob instanceof Blob) || blob.size < 4 || blob.size > MAX_IMAGE) throw new Error('Each JPEG must be under 40 MB.');
  // Scan segment headers without decoding a potentially oversized image.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Choose a stitched JPEG image.');
  for (let i = 2; i + 3 < bytes.length;) {
    if (bytes[i++] !== 255) break;
    while (bytes[i] === 255) i++;
    const marker = bytes[i++];
    if (marker === 218 || marker === 217) break;
    const length = bytes[i] * 256 + bytes[i + 1];
    if (length < 2 || i + length > bytes.length) break;
    if ([192, 193, 194].includes(marker) && length >= 8) {
      const height = bytes[i + 3] * 256 + bytes[i + 4];
      const width = bytes[i + 5] * 256 + bytes[i + 6];
      validateDimensions(width, height);
      if (width > 16384 || height > 8192) throw new Error('JPEG dimensions must be at most 16384 × 8192.');
      return { width, height };
    }
    i += length;
  }
  throw new Error('The JPEG header could not be read.');
}

export function validateDraft(draft) {
  const { tour, images } = draft;
  validateApartment(tour, { draft: true });
  if (tour.rooms.length > MAX_ROOMS || tour.title.length > 120) throw new Error('Use at most 12 rooms and a title under 121 characters.');
  if (!(images instanceof Map) || images.size !== tour.rooms.filter(r => hasStitch(tour,r.id)).length) throw new Error('Each complete viewpoint must have exactly one JPEG.');
  let size = 0;
  const pairs = new Map();
  for (const room of tour.rooms) {
    const blob = images.get(room.id);
    if (room.id.length > 64 || room.name.length > 80 || room.image !== `images/${room.id}.jpg` ||
        (room.description != null && (typeof room.description !== 'string' || room.description.length > 500)) ||
        room.links.length > 40 || room.links.some(link => Math.abs(link.yaw) > Math.PI)) {
      throw new Error('A room or doorway exceeds the editor limits.');
    }
    if (hasStitch(tour,room.id) && (!(blob instanceof Blob) || !blob.size || blob.size > MAX_IMAGE)) throw new Error('A room JPEG is missing or exceeds 40 MB.');
    for (const link of room.links) {
      if (link.pending !== undefined && typeof link.pending !== 'boolean') throw new Error('An arrow has an invalid placement state.');
      if (link.pairId === undefined && !link.pending) continue;
      if (typeof link.pairId !== 'string' || !/^door-[0-9]{1,5}$/.test(link.pairId)) throw new Error('A doorway connection is missing its pair ID.');
      if (!pairs.has(link.pairId)) pairs.set(link.pairId, []);
      pairs.get(link.pairId).push({ room: room.id, target: link.target, pending: link.pending });
    }
    size += blob?.size ?? 0;
  }
  if (size > MAX_TOTAL) throw new Error('The combined JPEG size must be at most 160 MB.');
  for (const entries of pairs.values()) {
    const [first, second] = entries;
    if (entries.length !== 2 || first.room !== second.target || first.target !== second.room) {
      throw new Error('A doorway connection must have two reciprocal arrows.');
    }
  }
  return draft;
}

export function addConnection(tour, from, target, point) {
  const destination = tour.rooms.find(room => room.id === target);
  if (!destination || destination === from) throw new Error('Choose another room.');
  if (tour.grid) {
    const key = edgeKey(from.id, target);
    if (!tour.grid.manual.includes(key)) tour.grid.manual.push(key);
    tour.grid.blocked = tour.grid.blocked.filter(k => k !== key);
  }
  const used = new Set(tour.rooms.flatMap(room => room.links.map(link => link.pairId)));
  let number = 1;
  while (used.has(`door-${number}`)) number++;
  const pairId = `door-${number}`;
  from.links.push({ target, ...point, pairId });
  destination.links.push(returnArrow(from, destination, pairId));
}

function returnArrow(from, destination, pairId) {
  return { target: from.id, pairId, pending: true };
}

export function pairedArrow(tour, link) {
  if (!link?.pairId) return null;
  const room = tour.rooms.find(item => item.id === link.target);
  const index = room?.links.findIndex(item => item.pairId === link.pairId);
  return index >= 0 ? { room, index, link: room.links[index] } : null;
}

export function retargetConnection(tour, from, index, target) {
  const link = from.links[index];
  if (link.target === target) return;
  const destination = tour.rooms.find(room => room.id === target);
  if (!destination || destination === from) throw new Error('Choose another room.');
  if (from.links.some((item, position) => position !== index && item.target === target)) throw new Error('These rooms already have a connection. Edit that doorway instead.');
  if (tour.grid) {
    const old = edgeKey(from.id, link.target), next = edgeKey(from.id, target);
    tour.grid.manual = tour.grid.manual.filter(k => k !== old);
    if (!tour.grid.blocked.includes(old)) tour.grid.blocked.push(old);
    if (!tour.grid.manual.includes(next)) tour.grid.manual.push(next);
    tour.grid.blocked = tour.grid.blocked.filter(k => k !== next);
  }
  if (!link.pairId) {
    const { yaw, pitch } = link;
    from.links.splice(index, 1);
    addConnection(tour, from, target, { yaw, pitch });
    from.links.splice(index, 0, from.links.pop());
    return;
  }
  const reverse = pairedArrow(tour, link);
  if (reverse) reverse.room.links.splice(reverse.index, 1);
  link.target = target;
  // The forward arrow keeps its position. Only the new return needs placing.
  if (Number.isFinite(link.yaw) && Number.isFinite(link.pitch)) delete link.pending;
  else link.pending = true;
  destination.links.push(returnArrow(from, destination, link.pairId));
}

export function removeConnection(tour, from, index) {
  if (tour.grid) {
    const key = edgeKey(from.id, from.links[index].target);
    if (!tour.grid.blocked.includes(key)) tour.grid.blocked.push(key);
  }
  const reverse = pairedArrow(tour, from.links[index]);
  if (reverse) reverse.room.links.splice(reverse.index, 1);
  from.links.splice(index, 1);
}

export function packTour(draft) {
  const { tour, images } = validateDraft(draft);
  const manifest = encoder.encode(JSON.stringify({ version: 1, tour, sizes: tour.rooms.map(room => images.get(room.id)?.size ?? 0) }));
  if (manifest.length > MAX_MANIFEST) throw new Error('The tour configuration is too large.');
  const header = new Uint8Array(12);
  header.set(encoder.encode(MAGIC));
  new DataView(header.buffer).setUint32(8, manifest.length, true);
  return new Blob([header, manifest, ...tour.rooms.filter(r=>hasStitch(tour,r.id)).map(room => images.get(room.id))], { type: 'application/octet-stream' });
}

export async function unpackTour(blob) {
  if (blob.size < 12 || blob.size > MAX_TOTAL + MAX_MANIFEST + 12) throw new Error('This tour package has an invalid size.');
  const header = await blob.slice(0, 12).arrayBuffer();
  if (decoder.decode(header.slice(0, 8)) !== MAGIC) throw new Error('Choose a Supported Housing .shtour package.');
  const length = new DataView(header).getUint32(8, true);
  if (!length || length > MAX_MANIFEST || 12 + length > blob.size) throw new Error('The package manifest is invalid.');
  const { version, tour, sizes } = JSON.parse(decoder.decode(await blob.slice(12, 12 + length).arrayBuffer()));
  if (version !== 1) throw new Error('This tour package version is not supported.');
  validateApartment(tour, { draft: true });
  if (tour.rooms.length > MAX_ROOMS || !Array.isArray(sizes) || sizes.length !== tour.rooms.length) throw new Error('The package room list is invalid.');
  let offset = 12 + length;
  const images = new Map();
  for (const [index, room] of tour.rooms.entries()) {
    const size = sizes[index];
    if (!hasStitch(tour,room.id)) { if(size!==0) throw new Error('Incomplete room has unexpected JPEG data.'); continue; }
    if (!Number.isSafeInteger(size) || size < 4 || size > MAX_IMAGE || offset + size > blob.size) throw new Error('A package JPEG is truncated or too large.');
    images.set(room.id, blob.slice(offset, offset + size, 'image/jpeg'));
    offset += size;
  }
  if (offset !== blob.size) throw new Error('The package contains unexpected extra data.');
  const draft = validateDraft({ tour, images });
  for (const image of images.values()) await inspectJpeg(image);
  return draft;
}

export function deleteRoom(draft, id) {
  const tour = structuredClone(draft.tour);
  if (tour.rooms.length < 2 && !tour.builder) throw new Error('Keep at least one room in the tour.');
  tour.rooms = tour.rooms.filter(room => room.id !== id);
  for (const room of tour.rooms) room.links = room.links.filter(link => link.target !== id);
  if (tour.startRoom === id) tour.startRoom = tour.rooms[0]?.id ?? '';
  if (tour.builder) for(const key of ['unplaced','missing']) tour.builder[key] = tour.builder[key].filter(room=>room!==id);
  const images = new Map(draft.images);
  images.delete(id);
  if (tour.grid) reconcileGrid(tour);
  return { tour, images };
}
