import { validateGrid } from './room-grid.js';
export function validateApartment(data) {
  if (!data || typeof data.title !== 'string' || !data.title.trim() || !Array.isArray(data.rooms) || !data.rooms.length) throw new Error('Apartment needs a title and rooms.');
  const ids = new Set();
  for (const room of data.rooms) {
    if (!room || typeof room.id !== 'string' || !/^[a-z0-9-]+$/.test(room.id) || ids.has(room.id)) throw new Error('Room IDs must be unique lowercase slugs.');
    ids.add(room.id);
    if (typeof room.name !== 'string' || !room.name.trim()) throw new Error('Each room needs a name.');
    if (typeof room.image !== 'string' || !/^images\/[a-zA-Z0-9_./-]+\.jpe?g$/i.test(room.image) || room.image.includes('..')) throw new Error('Room images must be local JPEG paths under images/.');
    const view = room.initialView;
    if (!view || !Number.isFinite(view.yaw) || !Number.isFinite(view.pitch) || !Number.isFinite(view.fov) || view.fov < 0.35 || view.fov > 2.1 || Math.abs(view.pitch) > Math.PI / 2) throw new Error('Invalid initial view. Angles must be radians.');
    if (!Array.isArray(room.links)) throw new Error('Each room needs a links array.');
  }
  if (!ids.has(data.startRoom)) throw new Error('Start room does not exist.');
  for (const room of data.rooms) for (const link of room.links) {
    if (!link || !ids.has(link.target) || link.target === room.id || (link.pending !== undefined && typeof link.pending !== 'boolean') ||
        (link.pending !== true && (!Number.isFinite(link.yaw) || !Number.isFinite(link.pitch))) ||
        (link.yaw !== undefined && !Number.isFinite(link.yaw)) || (link.pitch !== undefined && (!Number.isFinite(link.pitch) || Math.abs(link.pitch) > Math.PI / 2))) throw new Error('Invalid doorway target or position.');
  }
  validateGrid(data);
  return data;
}
export function validateDimensions(width, height) {
  if (!width || !height || Math.abs(width / height - 2) > 0.04) throw new Error('Choose a full 360° equirectangular JPEG with a 2:1 width-to-height ratio.');
}
