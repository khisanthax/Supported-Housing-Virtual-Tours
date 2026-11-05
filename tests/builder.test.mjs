import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blankApartment, addIncompleteRoom, unplace, retainConnections } from '../dist/builder-data.js';
import { validateApartment } from '../dist/tour-data.js';
import { validateDraft, packTour, unpackTour, deleteRoom, retargetConnection } from '../dist/tour-package.js';
import { reconcileGrid, moveGridRoom } from '../dist/room-grid.js';
test('empty and incomplete apartments persist in backups but cannot become visitor tours',async()=>{
 const tour=blankApartment(),images=new Map();validateDraft({tour,images});assert.throws(()=>validateApartment(tour));
 assert.deepEqual((await unpackTour(packTour({tour,images}))).tour,tour);
 const id=addIncompleteRoom(tour,'Kitchen');reconcileGrid(tour);validateDraft({tour,images});assert.throws(()=>validateApartment(tour),/Place every/);
 const next=deleteRoom({tour,images},id);assert.equal(next.tour.rooms.length,0);validateDraft(next);
});
test('unplaced stitches round-trip, while removing from grid retains image and positioned navigation',async()=>{
 const tour=blankApartment();const a=addIncompleteRoom(tour,'Entry'),b=addIncompleteRoom(tour,'Kitchen');
 const jpeg=new Blob([await readFile(new URL('../cloudflare/sample-images/living.jpg',import.meta.url))]);const images=new Map([[a,jpeg],[b,jpeg]]);tour.builder.missing=[];
 moveGridRoom(tour,a,0,0);moveGridRoom(tour,b,1,0);
 for(const room of tour.rooms){Object.assign(room.links[0],{yaw:.2,pitch:.1});delete room.links[0].pending;}
 const original=structuredClone(tour.rooms[0].links);
 retainConnections(tour);moveGridRoom(tour,b,4,4);assert.deepEqual(tour.rooms[0].links,original);
 unplace(tour,b);reconcileGrid(tour);assert.deepEqual(tour.rooms[0].links,original);assert.equal(images.size,2);
 const restored=await unpackTour(packTour({tour,images}));assert.deepEqual(restored.tour,tour);assert.throws(()=>validateApartment(restored.tour),/Place every/);
 moveGridRoom(tour,b,3,3);validateApartment(tour);
});
test('builder rejects invented unplaced IDs and invalid missing state',()=>{
 const t=blankApartment();t.builder.unplaced=['not-a-room'];assert.throws(()=>validateDraft({tour:t,images:new Map()}));
 const valid=blankApartment();valid.builder.missing=['fake'];assert.throws(()=>validateDraft({tour:valid,images:new Map()}));
});

test('retargeting an unpositioned doorway keeps it pending and rejects a duplicate destination',()=>{
 const tour=blankApartment();const a=addIncompleteRoom(tour,'Entry'),b=addIncompleteRoom(tour,'Kitchen'),c=addIncompleteRoom(tour,'Study');
 moveGridRoom(tour,a,0,0);moveGridRoom(tour,b,1,0);moveGridRoom(tour,c,3,3);
 retargetConnection(tour,tour.rooms[0],0,c);reconcileGrid(tour);
 assert.equal(tour.rooms[0].links[0].target,c);assert.equal(tour.rooms[0].links[0].pending,true);assert.equal(tour.rooms[2].links[0].pending,true);
 validateDraft({tour,images:new Map()});
 tour.rooms[0].links.push({...tour.rooms[0].links[0],target:b});
 assert.throws(()=>retargetConnection(tour,tour.rooms[0],1,c),/already have/);
});
