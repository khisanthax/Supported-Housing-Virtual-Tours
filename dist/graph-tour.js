// Graph-mode layouts describe relationships, never dimensions or camera orientation.
export const graphMode = tour => tour.grid?.mode === 'graph';
export function enablePanorama(tour) {
  tour.grid??={version:2,positions:{},manual:[],blocked:[]};
  tour.grid.mode='graph';
  for(const r of tour.rooms)for(const l of r.links){const key=[r.id,l.target].sort().join('|');if(!tour.grid.manual.includes(key))tour.grid.manual.push(key);}
  return tour;
}
export function reachable(tour) {
  const excluded=new Set(tour.builder?.excluded??[]),seen=new Set(),queue=[tour.startRoom];
  while(queue.length){const id=queue.shift(),r=tour.rooms.find(r=>r.id===id);if(!r||excluded.has(id)||seen.has(id))continue;seen.add(id);queue.push(...r.links.map(l=>l.target));}
  return seen;
}
export function reviewTour(tour) {
  const items=[],excluded=new Set(tour.builder?.excluded??[]),seen=reachable(tour),active=tour.rooms.filter(r=>!excluded.has(r.id));
  const add=(severity,message,room,target,index)=>items.push({severity,message,room,target,index});
  if(!active.length)add('blocker','Add at least one active stitched viewpoint.');
  if(excluded.has(tour.startRoom))add('blocker','The starting viewpoint is excluded. Choose an active starting viewpoint.',tour.startRoom);
  for(const r of tour.rooms){
    if(excluded.has(r.id)){add('info',r.name+': Excluded from publication; original JPEG retained.',r.id);continue;}
    if(tour.builder?.missing.includes(r.id))add('blocker',r.name+': No stitched photo attached.',r.id);
    if(!graphMode(tour)&&tour.builder?.unplaced.includes(r.id))add('blocker',r.name+': Legacy grid viewpoint is unplaced. Place it or choose panorama workflow.',r.id);
    if(!seen.has(r.id))add('warning',r.name+': Not connected to the walkthrough. It remains available in the room selector.',r.id);
    r.links.forEach((l,index)=>{
      const target=tour.rooms.find(t=>t.id===l.target),name=r.name+' → '+(target?.name??l.target);
      if(!target||excluded.has(l.target))add('blocker',name+': Destination is missing or excluded. Remove or change this connection.',r.id,l.target,index);
      else if(l.pending){const reverse=target.links.find(back=>back.target===r.id&&back.pairId===l.pairId);add('blocker',name+': '+(!graphMode(tour)?'Legacy/manual connection — ':'')+(reverse&&!reverse.pending?'Return arrow needs positioning.':'Arrow needs positioning.'),r.id,l.target,index);}
      else if(!Number.isFinite(l.yaw)||Math.abs(l.yaw)>Math.PI||!Number.isFinite(l.pitch)||Math.abs(l.pitch)>Math.PI/2)add('blocker',name+': Invalid arrow coordinates.',r.id,l.target,index);
    });
  }
  return items;
}
export function publicationView(tour) {
  if(!graphMode(tour))return tour;
  const blockers=reviewTour(tour).filter(i=>i.severity==='blocker');if(blockers.length)throw Error(blockers.map(i=>i.message).join(' '));
  const {builder,grid,layoutCheckpoint,...out}=structuredClone(tour);
  out.rooms=out.rooms.filter(r=>!builder?.excluded?.includes(r.id));return out;
}
export function generateLayout(tour,{regenerate=false}={}) {
  enablePanorama(tour);
  const excluded=new Set(tour.builder?.excluded??[]),seen=reachable(tour),order=[],queued=new Set(),queue=[tour.startRoom];
  while(queue.length){const id=queue.shift(),r=tour.rooms.find(r=>r.id===id);if(!r||queued.has(id))continue;queued.add(id);if(!excluded.has(id))order.push(id);queue.push(...r.links.map(l=>l.target).sort());}
  order.push(...tour.rooms.filter(r=>!queued.has(r.id)&&!excluded.has(r.id)).map(r=>r.id));
  const positions=regenerate?{}:structuredClone(tour.grid.positions),used=new Set(Object.values(positions).map(p=>p.x+','+p.y));
  const loose=order.filter(id=>!seen.has(id)),looseRows=Math.ceil(loose.length/4),connectedRows=loose.length?7-looseRows:8;
  const depths=new Map([[tour.startRoom,0]]),walk=[tour.startRoom];
  while(walk.length){const id=walk.shift();for(const link of tour.rooms.find(r=>r.id===id)?.links??[])if(seen.has(link.target)&&!depths.has(link.target)){depths.set(link.target,depths.get(id)+1);walk.push(link.target);}}
  const layers=new Map();for(const id of order.filter(id=>seen.has(id))){const d=depths.get(id)??0;const list=layers.get(d)??[];list.push(id);layers.set(d,list);}
  for(const id of order){if(positions[id])continue;const connected=seen.has(id),depth=depths.get(id)??0,list=layers.get(depth)??[],index=list.indexOf(id);
    const preferred=connected?{x:Math.min(6,depth*2),y:list.length===1?Math.floor((connectedRows-1)/2):index%connectedRows}:{x:(loose.indexOf(id)%4)*2,y:8-looseRows+Math.floor(loose.indexOf(id)/4)};
    const candidates=[preferred,...Array.from({length:32},(_,n)=>({x:(n%4)*2,y:Math.floor(n/4)}))];
    for(const p of candidates){if(connected&&p.y>=connectedRows)continue;if(!connected&&p.y<8-looseRows)continue;const key=p.x+','+p.y;if(!used.has(key)){positions[id]=p;used.add(key);break;}}
  }
  tour.grid.positions=positions;tour.builder.unplaced=tour.rooms.filter(r=>!positions[r.id]).map(r=>r.id);
  return tour;
}
