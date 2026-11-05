export const GRID_SIZE = 8;
export const edgeKey = (a, b) => [a, b].sort().join('|');
const linked = tour => [...new Set(tour.rooms.flatMap(room => room.links.map(link => edgeKey(room.id, link.target))))];

export function gridFor(tour) {
  const ids = new Set(tour.rooms.map(room => room.id));
  const grid = structuredClone(tour.grid ?? { version: 1, positions: {}, manual: linked(tour), blocked: [] });
  grid.positions = Object.fromEntries(Object.entries(grid.positions).filter(([id]) => ids.has(id)));
  const valid = key => key.split('|').length === 2 && key.split('|').every(id => ids.has(id));
  grid.manual = grid.manual.filter(valid);
  grid.blocked = grid.blocked.filter(valid);
  for (const room of tour.rooms) if (!Object.hasOwn(grid.positions, room.id)) {
    if (tour.builder?.unplaced.includes(room.id)) continue;
    // Spaced initial tiles never infer doors merely from the upload order.
    for (let i = 0; i < 64; i++) {
      const columns = Math.min(4, Math.ceil(Math.sqrt(tour.rooms.length)));
      const cell = i < 16 ? { x: (i % columns) * 2, y: Math.floor(i / columns) * 2 } : { x: (i - 16) % 8, y: Math.floor((i - 16) / 8) };
      if (cell.y >= GRID_SIZE) continue;
      if (!Object.values(grid.positions).some(p => p.x === cell.x && p.y === cell.y)) { grid.positions[room.id] = cell; break; }
    }
  }
  return grid;
}

export function gridEdges(tour) {
  const grid = gridFor(tour), edges = [];
  for (let i = 0; i < tour.rooms.length; i++) for (let j = i + 1; j < tour.rooms.length; j++) {
    const a = tour.rooms[i], b = tour.rooms[j], key = edgeKey(a.id, b.id);
    const p = grid.positions[a.id], q = grid.positions[b.id];
    const adjacent = !!p && !!q && Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
    if (adjacent || grid.manual.includes(key)) edges.push({ a, b, key, adjacent, enabled: !grid.blocked.includes(key) });
  }
  return edges;
}

export function reconcileGrid(tour) {
  tour.grid = gridFor(tour);
  const wanted = new Set(gridEdges(tour).filter(e => e.enabled).map(e => e.key));
  for (const room of tour.rooms) room.links = room.links.filter(link => wanted.has(edgeKey(room.id, link.target)));
  const used = new Set(tour.rooms.flatMap(r => r.links.map(l => l.pairId)));
  for (const { a, b, key } of gridEdges(tour)) if (wanted.has(key)) {
    const forward = a.links.find(l => l.target === b.id), reverse = b.links.find(l => l.target === a.id);
    if (forward && reverse) continue; // Preserve every existing position and paired doorway.
    let n = 1; while (used.has('door-' + n)) n++;
    const pairId = forward?.pairId ?? reverse?.pairId ?? 'door-' + n;
    used.add(pairId);
    if (forward) forward.pairId = pairId;
    else a.links.push({ target: b.id, pairId, pending: true });
    if (reverse) reverse.pairId = pairId;
    else b.links.push({ target: a.id, pairId, pending: true });
  }
  return tour;
}

export function moveGridRoom(tour, id, x, y) {
  if (!tour.rooms.some(r => r.id === id) || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) throw new Error('Choose a cell inside the grid.');
  tour.grid = gridFor(tour);
  if (Object.entries(tour.grid.positions).some(([other, p]) => other !== id && p.x === x && p.y === y)) throw new Error('That grid cell is occupied. Move to an empty cell.');
  tour.grid.positions[id] = { x, y };
  if (tour.builder) tour.builder.unplaced = tour.builder.unplaced.filter(room => room !== id);
  return reconcileGrid(tour);
}

export function manualGridConnection(tour, a, b) {
  tour.grid = gridFor(tour);
  const key = edgeKey(a, b);
  if (a === b || ![a, b].every(id => tour.rooms.some(r => r.id === id))) throw new Error('Choose two different rooms.');
  if (!tour.grid.manual.includes(key)) tour.grid.manual.push(key);
  tour.grid.blocked = tour.grid.blocked.filter(k => k !== key);
  return reconcileGrid(tour);
}

export function toggleGridConnection(tour, key) {
  tour.grid = gridFor(tour);
  if (!gridEdges(tour).some(e => e.key === key)) throw new Error('Connection no longer exists.');
  tour.grid.blocked = tour.grid.blocked.includes(key) ? tour.grid.blocked.filter(k => k !== key) : [...tour.grid.blocked, key];
  return reconcileGrid(tour);
}

export function validateGrid(tour) {
  if (tour.grid === undefined) return;
  const g = tour.grid, ids = new Set(tour.rooms.map(r => r.id));
  if (ids.size > 12 || !g || ![1,2].includes(g.version) || !g.positions || Array.isArray(g.positions) || Object.keys(g.positions).length !== ids.size - (tour.builder?.unplaced.length ?? 0)) throw new Error('Invalid room grid.');
  const cells = new Set();
  for (const [id, p] of Object.entries(g.positions)) {
    if (!ids.has(id) || tour.builder?.unplaced.includes(id) || !p || !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0 || p.x >= GRID_SIZE || p.y >= GRID_SIZE || cells.has(p.x + ',' + p.y)) throw new Error('Grid cells must be unique and inside the layout.');
    cells.add(p.x + ',' + p.y);
  }
  for (const list of [g.manual, g.blocked]) if (!Array.isArray(list) || list.length > 66 || new Set(list).size !== list.length || list.some(key => typeof key !== 'string' || key.length > 129 || key.split('|').length !== 2 || key.split('|')[0] === key.split('|')[1] || !key.split('|').every(id => ids.has(id)) || edgeKey(...key.split('|')) !== key)) throw new Error('Invalid grid connection.');
  const enabled = new Set(gridEdges(tour).filter(e => e.enabled).map(e => e.key));
  for (const r of tour.rooms) for (const l of r.links) if (!enabled.has(edgeKey(r.id, l.target))) throw new Error('Room arrows disagree with the grid.');
  for (const e of gridEdges(tour).filter(e => e.enabled)) if (!e.a.links.some(l => l.target === e.b.id) || !e.b.links.some(l => l.target === e.a.id)) throw new Error('Grid connections require two-way arrows.');
}
