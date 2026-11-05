import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gridFor, gridEdges, moveGridRoom, toggleGridConnection, manualGridConnection, edgeKey } from '../dist/room-grid.js';
import { validateApartment } from '../dist/tour-data.js';
import { packTour, unpackTour, deleteRoom } from '../dist/tour-package.js';
const sample = JSON.parse(await readFile(new URL('../dist/data/apartment.json', import.meta.url)));
const fresh = () => { const t = structuredClone(sample); t.rooms.forEach(r => r.links = []); return t; };

test('grid adjacency creates two unpositioned arrows without guessed coordinates', () => {
  const t = fresh(), [a, b] = t.rooms;
  moveGridRoom(t, b.id, 1, 0);
  for (const room of [a, b]) { assert.equal(room.links.length, 1); assert.equal(room.links[0].pending, true); assert.equal(Object.hasOwn(room.links[0], 'yaw'), false); }
  assert.equal(a.links[0].pairId, b.links[0].pairId);
  validateApartment(t);
  toggleGridConnection(t, edgeKey(a.id, b.id));
  assert.equal(a.links.length, 0); assert.equal(b.links.length, 0);
  assert.equal(gridEdges(t).find(e => e.key === edgeKey(a.id, b.id)).enabled, false);
  moveGridRoom(t, b.id, 1, 1);
  moveGridRoom(t, b.id, 1, 0);
  assert.equal(a.links.length, 0, 'disabled adjacency must stay disabled after moving away and back');
  toggleGridConnection(t, edgeKey(a.id, b.id));
  assert.equal(a.links[0].pending, true);
});

test('valid edges retain exact placed arrows while moving, and manual nonadjacent links survive', () => {
  const t = fresh(), [a, b, c] = t.rooms;
  moveGridRoom(t, b.id, 1, 0);
  Object.assign(a.links[0], { yaw: 1.2, pitch: -.2 }); delete a.links[0].pending;
  const saved = structuredClone(a.links[0]);
  moveGridRoom(t, b.id, 0, 1);
  assert.deepEqual(a.links[0], saved);
  manualGridConnection(t, a.id, c.id);
  moveGridRoom(t, c.id, 7, 7);
  assert.ok(a.links.some(l => l.target === c.id));
  moveGridRoom(t, b.id, 3, 3);
  assert.equal(a.links.some(l => l.target === b.id), false);
  assert.equal(b.links.length, 0);
  validateApartment(t);
});

test('legacy tours remain untouched until layout changes and retain every existing position', () => {
  const t = structuredClone(sample), original = structuredClone(t);
  gridFor(t); gridEdges(t);
  assert.deepEqual(t, original);
  moveGridRoom(t, t.rooms[0].id, 7, 7);
  for (let i = 0; i < t.rooms.length; i++) assert.deepEqual(t.rooms[i].links, original.rooms[i].links);
  assert.throws(() => moveGridRoom(t, t.rooms[0].id, 2, 0), /occupied/);
  assert.throws(() => moveGridRoom(t, t.rooms[0].id, -1, 0), /inside/);
  const bad = structuredClone(t); bad.grid.positions[t.rooms[1].id] = bad.grid.positions[t.rooms[0].id];
  assert.throws(() => validateApartment(bad), /unique/);
  const mismatch = structuredClone(t); mismatch.grid.blocked.push(edgeKey(t.rooms[0].id, t.rooms[1].id));
  assert.throws(() => validateApartment(mismatch), /disagree/);
});

test('grid, disabled edges and pending pairs survive portable backup and room removal', async () => {
  const t = fresh(); moveGridRoom(t, t.rooms[1].id, 1, 0);
  manualGridConnection(t, t.rooms[2].id, t.rooms[4].id);
  toggleGridConnection(t, edgeKey(t.rooms[2].id, t.rooms[4].id));
  const images = new Map(await Promise.all(t.rooms.map(async r => [r.id, new Blob([await readFile(new URL('../dist/' + r.image, import.meta.url))])])));
  const restored = await unpackTour(packTour({ tour: t, images }));
  assert.deepEqual(restored.tour, t);
  const removed = deleteRoom(restored, t.rooms[1].id);
  validateApartment(removed.tour);
  assert.equal(Object.hasOwn(removed.tour.grid.positions, t.rooms[1].id), false);
});
