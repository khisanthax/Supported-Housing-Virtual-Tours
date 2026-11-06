// Photo management only: this surface never reads or writes spatial coordinates.
export function createUploadWorkspace({host,files,addRoom,renameGroup,assign,preview,rename,replace,remove,url}){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text??'';if(cls)n.className=cls;return n;};
 const button=(text,action)=>{const b=el('button',text);b.type='button';b.onclick=action;return b;};
 const drop=button('＋ Drop stitched JPEGs or a ZIP here, or choose files',()=>document.getElementById('guide-files').click());drop.className='upload-drop';drop.ondragover=e=>{e.preventDefault();drop.classList.add('over');};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');files([...e.dataTransfer.files]);};
 const help=el('p','One completed 360° JPEG per viewpoint · up to 4 MiB each · review every image before upload. Room grouping is optional.');
 const columns=el('div',null,'upload-columns'),groups=el('aside',null,'upload-groups'),gallery=el('section',null,'upload-gallery');groups.setAttribute('aria-label','Room organization');gallery.setAttribute('aria-label','Uploaded stitched photographs');columns.append(groups,gallery);host.append(drop,help,columns);
 return {render(draft){
  const names=[...new Set(draft.tour.rooms.map(r=>r.roomName).filter(Boolean))];groups.replaceChildren(el('h2','Rooms (optional)'),button('Add Room',addRoom));
  for(const name of names){const row=el('div',null,'upload-group');row.append(el('strong',name),el('small',draft.tour.rooms.filter(r=>r.roomName===name).length+' viewpoints'),button('Rename room '+name,()=>renameGroup(name)));groups.append(row);}
  gallery.replaceChildren(el('h2','Uploaded photos'));
  if(!draft.tour.rooms.length)gallery.append(el('p','No stitches yet. Add JPEGs or a ZIP above. You can organize rooms later.'));
  for(const r of draft.tour.rooms){const card=el('article',null,'upload-photo');card.dataset.room=r.id;const img=el('img');img.alt='Stitched panorama preview of '+r.name;img.src=url(r.id);img.hidden=!draft.images.has(r.id);const label=el('label','Room group'),select=el('select');select.setAttribute('aria-label','Room group for '+r.name);select.add(new Option('No room group',''));for(const name of names)select.add(new Option(name,name));select.value=r.roomName??'';select.onchange=()=>assign(r.id,select.value);label.append(select);
   card.append(img,el('h3',r.name),el('p',draft.images.has(r.id)?'Uploaded · saved in private draft':'No stitch attached'),label,button('Preview in 360°',()=>preview(r.id)),button('Rename',()=>rename(r.id)),button('Replace Stitch',()=>replace(r.id)),button('Delete',()=>remove(r.id)));gallery.append(card);
  }
 }};
}
