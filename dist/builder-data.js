export function blankApartment(title = 'Untitled apartment') {
  return { id: 'apartment', title, rooms: [], startRoom: '', builder: { version: 1, unplaced: [], missing: [] }, grid: { version: 2, positions: {}, manual: [], blocked: [] } };
}
export function validateBuilder(tour, draft = false) {
  const b = tour.builder;
  if (b === undefined) return;
  const ids = new Set(tour.rooms.map(r => r.id));
  if (!b || b.version !== 1) throw new Error('Invalid apartment draft state.');
  for (const list of [b.unplaced, b.missing]) if (!Array.isArray(list) || list.length > 12 || new Set(list).size !== list.length || list.some(id => !ids.has(id))) throw new Error('Invalid unplaced or incomplete room.');
  if(b.excluded!==undefined&&(!Array.isArray(b.excluded)||b.excluded.length>12||new Set(b.excluded).size!==b.excluded.length||b.excluded.some(id=>!ids.has(id))))throw Error('Invalid excluded viewpoint.');
  if (!draft && (!tour.rooms.length || b.unplaced.length || b.missing.length)) throw new Error('Place every stitch and attach an image to every room before publishing.');
}
export const hasStitch = (tour, id) => !tour.builder?.missing.includes(id);
export function retainConnections(tour) {
  for (const room of tour.rooms) for (const link of room.links) {
    const key = [room.id, link.target].sort().join('|');
    if (!tour.grid.manual.includes(key)) {
      tour.grid.manual.push(key);
      // Retained adjacency is still grid-generated, so Reset can distinguish it from explicit doors.
      tour.grid.inferred??=[];
      if(!tour.grid.inferred.includes(key))tour.grid.inferred.push(key);
    }
  }
}
export function unplace(tour, id) {
  retainConnections(tour);
  if (!tour.builder.unplaced.includes(id)) tour.builder.unplaced.push(id);
  delete tour.grid.positions[id];
}
export function addIncompleteRoom(tour, name) {
  if (tour.rooms.length >= 12) throw new Error('An apartment supports up to 12 viewpoints.');
  let n = 1; while (tour.rooms.some(r => r.id === 'room-' + n)) n++;
  const id = 'room-' + n;
  tour.rooms.push({ id, name, roomName: name, image: 'images/' + id + '.jpg', initialView: { yaw: 0, pitch: 0, fov: 1.45 }, links: [] });
  tour.builder.unplaced.push(id); tour.builder.missing.push(id); tour.startRoom ||= id;
  return id;
}
