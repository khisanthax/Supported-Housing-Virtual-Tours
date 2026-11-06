import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {blankApartment,addIncompleteRoom} from '../dist/builder-data.js';
import {enablePanorama,generateLayout,reviewTour,publicationView} from '../dist/graph-tour.js';
import {placeDoorway} from '../dist/doorway-data.js';
import {reconcileGrid,moveGridRoom} from '../dist/room-grid.js';
import {captureLayout,restoreLayout,resetLayout,visitorManifest} from '../dist/layout-state.js';
import {packTour,unpackTour,validateDraft} from '../dist/tour-package.js';
import {validateApartment} from '../dist/tour-data.js';
import {tourAsset} from '../cloudflare/worker.mjs';
const fixture=()=>{const t=enablePanorama(blankApartment());for(const n of ['Living Room','Dining Room','Kitchen','Hallway','Bedroom','Bathroom','Office','Unused'])addIncompleteRoom(t,n);t.builder.missing=[];return t;};

test('panorama-first placement completes exactly one direction, survives reconciliation and names only the pending return',()=>{
 const t=fixture();placeDoorway(t,'room-1','room-2',{yaw:.83,pitch:.12});reconcileGrid(t);
 assert.deepEqual(t.grid.positions,{});assert.equal(t.rooms[0].links.length,1);assert.equal(t.rooms[0].links[0].pending,undefined);assert.equal(t.rooms[1].links[0].pending,true);
 const pending=reviewTour(t).filter(i=>i.index!==undefined);assert.equal(pending.length,1);assert.match(pending[0].message,/Dining Room → Living Room.*Return arrow/);
 placeDoorway(t,'room-1','room-2',{yaw:.83,pitch:.12});assert.equal(t.rooms[0].links.length,1);
 placeDoorway(t,'room-2','room-1',{yaw:-.6,pitch:.04});assert.equal(reviewTour(t).filter(i=>i.severity==='blocker').length,0);validateApartment(t);
});

test('stable graph diagram never creates phantom doors, preserves manual positions and Reset checkpoint',()=>{
 const t=fixture();placeDoorway(t,'room-1','room-2',{yaw:0,pitch:0});const links=structuredClone(t.rooms.map(r=>r.links));generateLayout(t);const generated=captureLayout(t);
 assert.equal(Object.keys(t.grid.positions).length,8);assert.equal(new Set(Object.values(t.grid.positions).map(p=>p.x+','+p.y)).size,8);assert.ok(t.grid.positions['room-3'].y>=4);
 moveGridRoom(t,'room-3',1,0);reconcileGrid(t);assert.deepEqual(t.rooms.map(r=>r.links),links);generateLayout(t);assert.deepEqual(t.grid.positions['room-3'],{x:1,y:0});
 generateLayout(t,{regenerate:true});assert.deepEqual(captureLayout(t),generated);resetLayout(t);assert.deepEqual(t.grid.positions,{});assert.deepEqual(t.rooms.map(r=>r.links),links);restoreLayout(t,t.layoutCheckpoint.layout);assert.deepEqual(captureLayout(t),generated);
});

test('exclusion retains backup bytes and Undo state but removes visitor and offline viewpoint access',async()=>{
 const t=fixture();t.builder.excluded=['room-8'];t.builder.missing=['room-8'];
 const jpeg=new Blob([await readFile(new URL('../cloudflare/sample-images/living.jpg',import.meta.url))]),images=new Map(t.rooms.filter(r=>r.id!=='room-8').map(r=>[r.id,jpeg]));
 validateDraft({tour:t,images});assert.equal(validateApartment(t).rooms.length,7);assert.equal(visitorManifest(t).rooms.length,7);assert.equal(publicationView(t).builder,undefined);
 const restored=await unpackTour(packTour({tour:t,images}));assert.deepEqual(restored.tour,t);assert.deepEqual(Buffer.from(await restored.images.get('room-1').arrayBuffer()),Buffer.from(await jpeg.arrayBuffer()));
 await assert.rejects(()=>tourAsset({manifest:JSON.stringify(t),photos:JSON.stringify({'room-8':'private'})},'room-8',{PHOTOS:{get(){throw Error('Must not read KV');}}},true),/excluded/);
 const before=captureLayout(t);t.builder.excluded=[];restoreLayout(t,before);assert.deepEqual(t.builder.excluded,['room-8']);
});

test('named broken navigation blocks publication while disconnected images and missing diagram positions are warnings',()=>{
 const t=fixture();assert.equal(reviewTour(t).filter(i=>i.severity==='blocker').length,0);assert.equal(validateApartment(t).rooms.length,8);
 placeDoorway(t,'room-1','room-2',{yaw:.1,pitch:0});assert.throws(()=>validateApartment(t),/Dining Room → Living Room/);
 placeDoorway(t,'room-2','room-1',{yaw:0,pitch:0});t.builder.excluded=['room-2'];assert.throws(()=>validateApartment(t),/Living Room → Dining Room.*excluded/);
 t.builder.excluded=[];t.rooms[0].links[0].yaw=Infinity;assert.throws(()=>validateApartment(t),/Living Room → Dining Room.*coordinates/);
});
