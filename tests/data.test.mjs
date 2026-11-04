import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { validateApartment, validateDimensions } from '../dist/tour-data.js';
const data = JSON.parse(await readFile(new URL('../dist/data/apartment.json', import.meta.url)));
test('six-room demo has reachable reciprocal doorway links', () => {
  validateApartment(data); assert.equal(data.rooms.length, 6);
  const seen = new Set(); const queue = [data.startRoom];
  while (queue.length) { const id=queue.shift(); if(seen.has(id))continue; seen.add(id); for(const link of data.rooms.find(r=>r.id===id).links)queue.push(link.target); }
  assert.equal(seen.size, 6);
  for (const room of data.rooms) for (const link of room.links) assert.ok(data.rooms.find(r=>r.id===link.target).links.some(l=>l.target===room.id));
});
test('all configured sample JPEG assets exist and use 2:1 dimensions', async () => {
  for (const room of data.rooms) {
    const bytes=await readFile(new URL(`../dist/${room.image}`,import.meta.url)); assert.equal(bytes.readUInt16BE(0),0xffd8);
    let offset=2, dimensions;
    while(offset<bytes.length) {
      assert.equal(bytes[offset++],0xff);
      const marker=bytes[offset++]; const length=bytes.readUInt16BE(offset);
      if([0xc0,0xc1,0xc2].includes(marker)) { dimensions={height:bytes.readUInt16BE(offset+3),width:bytes.readUInt16BE(offset+5)};break; }
      offset+=length;
    }
    assert.ok(dimensions);validateDimensions(dimensions.width,dimensions.height);assert.equal(dimensions.width,1774);
  }
  await access(new URL('../dist/vendor/marzipano.js', import.meta.url));
  validateDimensions(3072,1536);
});
test('rejects invalid room graph, duplicates, paths, and angles', () => {
  for (const mutate of [d=>d.rooms[0].links[0].target='missing',d=>d.rooms[1].id='living',d=>d.startRoom='missing',d=>d.rooms[0].image='../private.jpg',d=>d.rooms[0].initialView.fov=0,d=>d.rooms[0].links[0].pitch=9]) {
    const bad=structuredClone(data);mutate(bad);assert.throws(()=>validateApartment(bad));
  }
});
test('rejects ordinary photos and accepts 2:1 photosphere exports', () => {
  assert.throws(()=>validateDimensions(4032,3024)); assert.throws(()=>validateDimensions(0,0)); validateDimensions(8192,4096);validateDimensions(8000,4000);
});
