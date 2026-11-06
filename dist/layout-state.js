import {gridFor,edgeKey,reconcileGrid,validateGrid} from './room-grid.js';
import {publicationView} from './graph-tour.js';

export function captureLayout(tour) {
  return structuredClone({grid:gridFor(tour),unplaced:tour.builder?.unplaced??[],...(tour.builder?.excluded?{excluded:tour.builder.excluded}:{}),rooms:tour.rooms.map(r=>({id:r.id,links:r.links}))});
}

export function restoreLayout(tour,snapshot) {
  const ids=tour.rooms.map(r=>r.id).sort();
  if(JSON.stringify(ids)!==JSON.stringify(snapshot.rooms.map(r=>r.id).sort()))throw Error('Viewpoints have changed. Import the recovery backup to restore deleted viewpoints.');
  tour.grid=structuredClone(snapshot.grid);
  tour.builder??={version:1,unplaced:[],missing:[]};
  tour.builder.unplaced=[...snapshot.unplaced];
  if(snapshot.excluded)tour.builder.excluded=[...snapshot.excluded];else delete tour.builder.excluded;
  for(const room of tour.rooms)room.links=structuredClone(snapshot.rooms.find(r=>r.id===room.id).links);
  return reconcileGrid(tour);
}

export function resetLayout(tour,now=Date.now()) {
  // The first checkpoint is retained until explicitly restored; later edits/resets never replace it.
  tour.layoutCheckpoint??={version:1,created:now,layout:captureLayout(tour)};
  const grid=gridFor(tour),manual=new Set(grid.manual.filter(k=>!grid.inferred?.includes(k)));
  tour.builder??={version:1,unplaced:[],missing:[]};
  tour.builder.unplaced=tour.rooms.map(r=>r.id);
  tour.grid={version:2,...(grid.mode?{mode:grid.mode}:{}),positions:{},manual:[...manual],blocked:grid.blocked.filter(k=>manual.has(k))};
  for(const room of tour.rooms)room.links=room.links.filter(l=>manual.has(edgeKey(room.id,l.target))&&!tour.grid.blocked.includes(edgeKey(room.id,l.target)));
  return reconcileGrid(tour);
}

export function validateLayoutCheckpoint(tour) {
  const cp=tour.layoutCheckpoint;
  if(cp===undefined)return;
  if(!cp||cp.version!==1||!Number.isSafeInteger(cp.created)||cp.created<0||JSON.stringify(cp).length>65536)throw Error('Invalid layout recovery checkpoint.');
  const s=cp.layout;
  if(!s||!s.grid||!Array.isArray(s.rooms)||s.rooms.length>12||!Array.isArray(s.unplaced))throw Error('Invalid checkpoint viewpoints.');
  const ids=new Set(s.rooms.map(r=>r?.id));
  if(s.excluded!==undefined&&(!Array.isArray(s.excluded)||new Set(s.excluded).size!==s.excluded.length||s.excluded.some(id=>!ids.has(id))))throw Error('Invalid checkpoint exclusions.');
  if(ids.size!==s.rooms.length||[...ids].some(id=>typeof id!=='string'||!/^[a-z0-9-]{1,64}$/.test(id))||new Set(s.unplaced).size!==s.unplaced.length||s.unplaced.some(id=>!ids.has(id)))throw Error('Invalid checkpoint viewpoint IDs.');
  const pairs=new Map();
  for(const r of s.rooms){
    if(!Array.isArray(r.links)||r.links.length>40)throw Error('Invalid checkpoint arrows.');
    for(const l of r.links){
      if(!l||!ids.has(l.target)||l.target===r.id||(l.pending!==undefined&&typeof l.pending!=='boolean')||(l.pending!==true&&(!Number.isFinite(l.yaw)||!Number.isFinite(l.pitch)))||(l.yaw!==undefined&&(!Number.isFinite(l.yaw)||Math.abs(l.yaw)>Math.PI))||(l.pitch!==undefined&&(!Number.isFinite(l.pitch)||Math.abs(l.pitch)>Math.PI/2)))throw Error('Invalid checkpoint doorway.');
      if(l.pending&&l.pairId===undefined)throw Error('Checkpoint return needs its reciprocal pair.');
      if(l.pairId!==undefined){if(typeof l.pairId!=='string'||!/^door-\d{1,5}$/.test(l.pairId))throw Error('Invalid checkpoint pair.');const list=pairs.get(l.pairId)??[];list.push({from:r.id,to:l.target});pairs.set(l.pairId,list);}
    }
  }
  for(const list of pairs.values())if(list.length!==2||list[0].from!==list[1].to||list[1].from!==list[0].to)throw Error('Checkpoint arrows must be reciprocal.');
  validateGrid({rooms:s.rooms,grid:s.grid,builder:{unplaced:s.unplaced}});
}

export class LayoutUndo {
  entries=[];
  record(before,after,label) {
    const previous=captureLayout(before);
    if(JSON.stringify(previous)!==JSON.stringify(captureLayout(after))){this.entries.push({layout:previous,label});if(this.entries.length>20)this.entries.shift();}
  }
  get latest(){return this.entries.at(-1);}
  applied(){this.entries.pop();}
}

export function visitorManifest(tour) {
  const {layoutCheckpoint,...visible}=publicationView(tour);
  return visible;
}
