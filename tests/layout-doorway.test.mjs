import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {blankApartment,addIncompleteRoom,retainConnections} from '../dist/builder-data.js';
import {captureLayout,restoreLayout,resetLayout,LayoutUndo,visitorManifest} from '../dist/layout-state.js';
import {moveGridRoom,reconcileGrid} from '../dist/room-grid.js';
import {placeDoorway} from '../dist/doorway-data.js';
import {validateDraft,packTour,unpackTour,removeConnection,retargetConnection} from '../dist/tour-package.js';
import {tourAsset} from '../cloudflare/worker.mjs';
const fixture=()=>{const t=blankApartment();for(const name of ['Living Room','Dining Room','Living Room'])addIncompleteRoom(t,name);return t;};

test('new stitches stay unplaced without inferred layout or connections',()=>{
 const t=fixture();reconcileGrid(t);assert.equal(t.builder.unplaced.length,3);assert.deepEqual(t.grid.positions,{});assert.ok(t.rooms.every(r=>!r.links.length));
 const before=structuredClone(t);captureLayout(t);assert.deepEqual(t,before);
});

test('reset retains manual doorways and exact identity while cloud checkpoint and Undo restore inferred navigation',async()=>{
 const t=fixture();moveGridRoom(t,'room-1',0,0);moveGridRoom(t,'room-2',1,0);moveGridRoom(t,'room-3',4,4);
 placeDoorway(t,'room-1','room-2',{yaw:.2,pitch:.1});placeDoorway(t,'room-2','room-1',{yaw:-.3,pitch:.05});
 placeDoorway(t,'room-1','room-3',{yaw:1,pitch:.2});reconcileGrid(t);
 const before=structuredClone(t),snapshot=captureLayout(t),undo=new LayoutUndo();resetLayout(t,123);undo.record(before,t,'Reset Layout');
 assert.deepEqual(t.grid.positions,{});assert.equal(t.builder.unplaced.length,3);assert.equal(t.rooms[0].links.length,1);assert.equal(t.rooms[0].links[0].target,'room-3');
 assert.deepEqual(t.rooms.map(r=>({id:r.id,image:r.image,name:r.name})),before.rooms.map(r=>({id:r.id,image:r.image,name:r.name})));
 restoreLayout(t,undo.latest.layout);undo.applied();assert.deepEqual(captureLayout(t),snapshot);
 const first=structuredClone(t.layoutCheckpoint);moveGridRoom(t,'room-3',5,5);resetLayout(t,456);assert.deepEqual(t.layoutCheckpoint,first);
 restoreLayout(t,t.layoutCheckpoint.layout);assert.deepEqual(captureLayout(t),snapshot);assert.equal(before.layoutCheckpoint,undefined);
 const jpeg=new Blob([await readFile(new URL('../cloudflare/sample-images/living.jpg',import.meta.url))]);t.builder.missing=[];const images=new Map(t.rooms.map(r=>[r.id,jpeg]));validateDraft({tour:t,images});const backup=await unpackTour(packTour({tour:t,images}));assert.deepEqual(backup.tour,t);
});

test('doorway drops reuse pending links, create reciprocal returns, move arrows and support explicit extra doorways by viewpoint ID',()=>{
 const t=fixture();moveGridRoom(t,'room-1',0,0);moveGridRoom(t,'room-2',1,0);const pair=t.rooms[0].links[0].pairId;
 placeDoorway(t,'room-1','room-2',{yaw:.7,pitch:.3});assert.equal(t.rooms[0].links.length,1);assert.equal(t.rooms[0].links[0].pairId,pair);assert.equal(t.rooms[1].links[0].pending,true);
 placeDoorway(t,'room-2','room-1',{yaw:-.6,pitch:.1});placeDoorway(t,'room-1','room-2',{yaw:1,pitch:.2});assert.equal(t.rooms[1].links[0].yaw,-.6);assert.equal(t.rooms[0].links.length,1);
 placeDoorway(t,'room-1','room-2',{yaw:1.3,pitch:.1},{another:true});assert.equal(t.rooms[0].links.length,2);assert.equal(t.rooms[1].links.length,2);assert.notEqual(t.rooms[0].links[1].pairId,pair);
 placeDoorway(t,'room-1','room-3',{yaw:0,pitch:0});reconcileGrid(t);validateDraft({tour:t,images:new Map()});assert.throws(()=>placeDoorway(t,'room-1','room-1',{yaw:0,pitch:0}),/different viewpoint/);
 const history=new LayoutUndo(),before=structuredClone(t);placeDoorway(t,'room-1','room-2',{yaw:-1,pitch:0},{index:0});history.record(before,t,'Move doorway');restoreLayout(t,history.latest.layout);assert.deepEqual(captureLayout(t),captureLayout(before));
});

test('checkpoint validation rejects corrupt recovery data and public manifests exclude staff recovery metadata',async()=>{
 const t=fixture();resetLayout(t,1);validateDraft({tour:t,images:new Map()});assert.ok(t.layoutCheckpoint);assert.equal(visitorManifest(t).layoutCheckpoint,undefined);
 const response=await tourAsset({manifest:JSON.stringify(t),seq:1},undefined,{},true);assert.equal((await response.json()).layoutCheckpoint,undefined);
 const bad=structuredClone(t);bad.layoutCheckpoint.layout.rooms[0].links=[{target:'invented',yaw:0,pitch:0}];assert.throws(()=>validateDraft({tour:bad,images:new Map()}),/checkpoint doorway/);
 const missing=structuredClone(t);missing.rooms.pop();assert.throws(()=>restoreLayout(missing,t.layoutCheckpoint.layout),/Viewpoints have changed/);
});

test('Reset clears retained grid-generated edges after movement while a checkpoint keeps their exact arrows',()=>{
 const t=fixture();moveGridRoom(t,'room-1',0,0);moveGridRoom(t,'room-2',1,0);placeDoorway(t,'room-1','room-2',{yaw:.4,pitch:.1});
 retainConnections(t);moveGridRoom(t,'room-2',3,3);assert.ok(t.grid.inferred.includes('room-1|room-2'));const before=captureLayout(t);
 resetLayout(t);assert.equal(t.rooms.flatMap(r=>r.links).length,0);restoreLayout(t,t.layoutCheckpoint.layout);assert.deepEqual(captureLayout(t),before);
});

test('deleting or retargeting one intentional doorway preserves the other door to that viewpoint',()=>{
 const t=fixture();placeDoorway(t,'room-1','room-2',{yaw:.1,pitch:0});placeDoorway(t,'room-1','room-2',{yaw:.7,pitch:0},{another:true});reconcileGrid(t);
 const first=t.rooms[0].links[0].pairId;removeConnection(t,t.rooms[0],1);reconcileGrid(t);assert.equal(t.rooms[0].links.length,1);assert.equal(t.rooms[0].links[0].pairId,first);assert.equal(t.rooms[1].links.length,1);
 placeDoorway(t,'room-1','room-2',{yaw:.7,pitch:0},{another:true});retargetConnection(t,t.rooms[0],1,'room-3');reconcileGrid(t);assert.equal(t.rooms[0].links.find(l=>l.target==='room-2').pairId,first);assert.equal(t.rooms[1].links.length,1);assert.equal(t.rooms[2].links.length,1);validateDraft({tour:t,images:new Map()});
});
