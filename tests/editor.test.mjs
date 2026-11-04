import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addConnection, deleteRoom, inspectJpeg, packTour, pairedArrow, removeConnection, retargetConnection, unpackTour, validateDraft } from '../dist/tour-package.js';

const tour = JSON.parse(await readFile(new URL('../dist/data/apartment.json', import.meta.url)));
const images = new Map(await Promise.all(tour.rooms.map(async room => [
  room.id, new Blob([await readFile(new URL(`../dist/${room.image}`, import.meta.url))], { type: 'image/jpeg' })
])));
const draft = { tour, images };

test('a portable package round-trips every room, doorway, and original JPEG byte', async () => {
  const backup = packTour(draft);
  const restored = await unpackTour(backup);
  assert.deepEqual(restored.tour, tour);
  for (const [id, jpeg] of images) {
    assert.equal(restored.images.get(id).type, 'image/jpeg');
    assert.deepEqual(await restored.images.get(id).arrayBuffer(), await jpeg.arrayBuffer());
  }
});

test('import rejects unrelated files, truncated JPEGs, trailing data, and damaged manifests', async () => {
  const backup = packTour(draft);
  await assert.rejects(unpackTour(new Blob(['not an archive'])), /package/);
  await assert.rejects(unpackTour(backup.slice(0, backup.size - 4)), /truncated/);
  await assert.rejects(unpackTour(new Blob([backup, 'extra'])), /extra data/);
  const header = new Uint8Array(await backup.slice(0, 12).arrayBuffer());
  header.fill(255, 8);
  await assert.rejects(unpackTour(new Blob([header, backup.slice(12)])), /manifest/);
  const corrupt = new Map(images);
  corrupt.set(tour.startRoom, new Blob(['not a JPEG']));
  await assert.rejects(unpackTour(packTour({ tour, images: corrupt })), /stitched JPEG/);
});

test('room deletion removes its JPEG and inbound links and leaves the original intact', () => {
  const removed = deleteRoom(draft, 'kitchen');
  assert.deepEqual(removed.tour.rooms.map(r => r.id), ['living', 'hallway', 'primary-bedroom', 'second-bedroom', 'bathroom']);
  assert.ok(removed.tour.rooms.every(r => r.links.every(link => link.target !== 'kitchen')));
  assert.equal(removed.images.has('kitchen'), false);
  assert.equal(draft.images.has('kitchen'), true);
  const withoutStart = deleteRoom(draft, tour.startRoom);
  assert.equal(withoutStart.tour.startRoom, 'kitchen');
  validateDraft(withoutStart);
});

test('JPEG header validation accepts a sample panorama and rejects a regular phone photo', async () => {
  assert.deepEqual(await inspectJpeg(images.get(tour.startRoom)), { width: 1774, height: 887 });
  const regular = await readFile(new URL('./ordinary-photo.jpg', import.meta.url));
  await assert.rejects(inspectJpeg(new Blob([regular])), /2:1/);
});

test('one placement creates a paired return that can be positioned independently and backed up', async () => {
  const fresh = structuredClone(tour);
  for (const room of fresh.rooms) room.links = [];
  const [living, kitchen] = fresh.rooms;
  addConnection(fresh, living, kitchen.id, { yaw: 0.6, pitch: 0.1 });
  const reverse = pairedArrow(fresh, living.links[0]);
  assert.equal(reverse.room.id, kitchen.id);
  assert.equal(reverse.link.target, living.id);
  assert.equal(reverse.link.pending, true);
  const draftBackup = await unpackTour(packTour({ tour: fresh, images }));
  assert.equal(draftBackup.tour.rooms[1].links[0].pending, true);
  Object.assign(reverse.link, { yaw: -0.55, pitch: 0.2 });
  delete reverse.link.pending;
  const completed = await unpackTour(packTour({ tour: fresh, images }));
  assert.equal(completed.tour.rooms[0].links[0].yaw, 0.6);
  assert.equal(completed.tour.rooms[1].links[0].yaw, -0.55);
  assert.equal(completed.tour.rooms[1].links[0].pending, undefined);
});

test('retargeting moves only the return to the new room; deletion removes both arrows', () => {
  const fresh = structuredClone(tour);
  for (const room of fresh.rooms) room.links = [];
  const [living, kitchen, bedroom] = fresh.rooms;
  addConnection(fresh, living, kitchen.id, { yaw: 0.6, pitch: 0.1 });
  retargetConnection(fresh, living, 0, bedroom.id);
  assert.equal(living.links[0].yaw, 0.6);
  assert.equal(kitchen.links.length, 0);
  assert.equal(bedroom.links[0].target, living.id);
  assert.equal(bedroom.links[0].pending, true);
  validateDraft({ tour: fresh, images });
  bedroom.links[0].pairId = 'door-999';
  assert.throws(() => validateDraft({ tour: fresh, images }), /reciprocal/);
  bedroom.links[0].pairId = living.links[0].pairId;
  removeConnection(fresh, living, 0);
  assert.ok(fresh.rooms.every(r => r.links.every(link => link.target !== 'kitchen')));
});
