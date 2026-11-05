import {addConnection} from './tour-package.js';

export function placeDoorway(tour,fromId,targetId,point,{another=false,index}={}) {
  const from=tour.rooms.find(r=>r.id===fromId),target=tour.rooms.find(r=>r.id===targetId);
  if(!from||!target||fromId===targetId)throw Error('Choose a different viewpoint as the destination.');
  if(!Number.isFinite(point.yaw)||Math.abs(point.yaw)>Math.PI||!Number.isFinite(point.pitch)||Math.abs(point.pitch)>Math.PI/2)throw Error('The doorway position is invalid.');
  let link;
  if(index!==undefined){link=from.links[index];if(!link||link.target!==targetId)throw Error('This arrow changed. Choose it again.');}
  else if(!another)link=from.links.find(l=>l.target===targetId&&l.pending)||from.links.find(l=>l.target===targetId);
  if(!link){addConnection(tour,from,targetId,point);link=from.links.at(-1);}
  Object.assign(link,point);delete link.pending;
  return link;
}
