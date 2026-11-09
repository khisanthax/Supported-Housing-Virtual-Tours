// Staff-only Pointer Events surface. Visitor/offline viewers never import this module.
export function createDoorwayDrag({isEditing,canStart=isEditing,currentRoom,coordinatesAt,pausePanning,onPlace,onSelect,onStart,say}) {
  let cancelActive;
  const pano=()=>document.getElementById('pano'),tour=()=>document.getElementById('tour');
  const inside=e=>{const r=pano().getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;};
  function bind(node,targetId,name,{handle=false,index}={}) {
    let suppressUntil=0;
    node.addEventListener('click',e=>{if(performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
    node.addEventListener('pointerdown',event=>{
      if(!canStart()||!event.isPrimary||event.button!==0||targetId===currentRoom()?.id||(!handle&&index===undefined&&event.pointerType!=='mouse'))return;
      cancelActive?.();const fromId=currentRoom().id,start={x:event.clientX,y:event.clientY};let active=false,preview;
      if(handle||index!==undefined){event.preventDefault();event.stopPropagation();}
      node.setPointerCapture(event.pointerId);
      const cleanup=()=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',end);node.removeEventListener('pointercancel',end);if(node.hasPointerCapture(event.pointerId))node.releasePointerCapture(event.pointerId);preview?.remove();node.style.opacity='';tour().classList.remove('door-drop-active','door-drop-over');if(active)pausePanning(false);cancelActive=null;};
      const move=e=>{
        if(!active&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<6)return;
        if(!active){active=true;if(index!==undefined)node.style.opacity='0';onStart();pausePanning(true);tour().classList.add('door-drop-active');preview=document.createElement('div');preview.className='door-drag-preview';preview.setAttribute('aria-hidden','true');preview.textContent='↑ '+name;document.body.append(preview);say('Drop on the doorway to '+name+'. Escape cancels.');}
        e.preventDefault();preview.style.left=e.clientX+'px';preview.style.top=e.clientY+'px';tour().classList.toggle('door-drop-over',inside(e));
      };
      const end=e=>{
        const placed=active&&e.type!=='pointercancel'&&inside(e)&&canStart();
        if(active){suppressUntil=performance.now()+600;e.preventDefault();e.stopPropagation();}
        let point;if(placed)try{point=coordinatesAt({type:'pointerup',clientX:e.clientX,clientY:e.clientY});}catch(error){say(error.message);}
        cleanup();
        if(point)Promise.resolve(onPlace({fromId,targetId,index,point})).then(()=>{
          const focus=index===undefined?document.querySelector('.destination-handle[data-destination="'+targetId+'"]'):pano().querySelector('.hotspot[data-door-index="'+index+'"]');focus?.focus({preventScroll:true});
        }).catch(error=>say(error.message));
        else if(active)say('Placement canceled. The private draft was not changed.');
      };
      cancelActive=()=>{suppressUntil=performance.now()+600;cleanup();say('Placement canceled.');node.focus({preventScroll:true});};
      node.addEventListener('pointermove',move);node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);
    });
  }
  function decorate(rooms) {
    if(!isEditing())return;
    for(const tab of document.querySelectorAll('#room-tabs>.room-tab,#room-tabs .destination-chip>.room-tab')){
      const id=tab.dataset.room,room=rooms.find(r=>r.id===id);if(!room)continue;
      let handle=tab.parentElement.classList.contains('destination-chip')?tab.parentElement.querySelector('.destination-handle'):null;
      if(!handle){const chip=document.createElement('span');chip.className='destination-chip';tab.replaceWith(chip);chip.append(tab);handle=document.createElement('button');handle.type='button';handle.className='destination-handle';handle.textContent='⠿';handle.dataset.destination=id;handle.setAttribute('aria-label','Place doorway to '+room.name);handle.setAttribute('aria-describedby','doorway-instructions');handle.title='Drag to a doorway, or select then tap the panorama';handle.onclick=()=>{if(canStart())onSelect(id);};chip.append(handle);bind(handle,id,room.name,{handle:true});bind(tab,id,room.name);}
      handle.disabled=id===currentRoom()?.id;
    }
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape')cancelActive?.();});
  return {decorate,bindArrow(node,index,target){bind(node,target.id,target.name,{index});},cancel(){cancelActive?.();}};
}
