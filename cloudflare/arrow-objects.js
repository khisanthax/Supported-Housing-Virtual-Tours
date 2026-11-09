// Fail closed for ambiguous legacy directions; never infer a reciprocal by room name.
export function canDeletePair(tour,from,link){
 const target=tour.rooms.find(r=>r.id===link?.target),pair=link?.pairId;
 if(!target||!pair||from.links.filter(l=>l.pairId===pair).length!==1)return false;
 const reverse=target.links.filter(l=>l.pairId===pair);
 if(reverse.length)return reverse.length===1&&reverse[0].target===from.id;
 // Removing the final edge also blocks its grid relationship. Do not erase an
 // unpaired legacy return as a side effect of that reconciliation.
 return from.links.filter(l=>l.target===target.id).length>1||!target.links.some(l=>l.target===from.id);
}

export function createArrowObjects({editing,currentRoom,inspect:onInspect,remove,move}){
 let label,lastTap=0,lastNode;
 const clear=()=>{label?.remove();label=null;};
 const inspect=(node,index)=>{if(!editing())return;clear();onInspect(index);const r=currentRoom();label=document.createElement('div');label.className='arrow-inspection';label.setAttribute('role','status');label.textContent=r.name+' → '+node.querySelector('.hotspot-label').textContent+' · Doorway positioned';const b=node.getBoundingClientRect();label.style.left=Math.max(8,Math.min(innerWidth-260,b.right+12))+'px';label.style.top=Math.max(8,b.top-45)+'px';document.body.append(label);};
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('.hotspot,.arrow-inspection'))clear();});
 function bind(node,index){
  node.style.touchAction='none';
  let start,dragged=false;
  node.setAttribute('aria-description','Click to inspect. Drag to move. Shift and arrow keys adjust position. Double-click, double-tap or Delete opens deletion confirmation.');
  for(const type of ['dblclick','mousedown','touchstart'])node.addEventListener(type,e=>{if(!editing())return;e.stopPropagation();if(type==='dblclick'){e.preventDefault();if(dragged)return;clear();remove(index);}});
  node.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY};dragged=false;clear();});
  node.addEventListener('pointermove',e=>{if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>=6){dragged=true;lastTap=0;}});
  node.addEventListener('pointerup',e=>{if(e.pointerType==='touch'&&!dragged&&editing()){const now=performance.now();if(lastNode===node&&now-lastTap<350){e.preventDefault();e.stopPropagation();lastTap=0;clear();remove(index);}else{lastTap=now;lastNode=node;}}start=null;});
  node.addEventListener('keydown',e=>{if(!editing())return;if(['Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopPropagation();clear();remove(index);}if(e.shiftKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();const d={ArrowLeft:[-.03,0],ArrowRight:[.03,0],ArrowUp:[0,.03],ArrowDown:[0,-.03]}[e.key];move(index,...d);}});
 }
 return {bind,inspect,clear};
}
