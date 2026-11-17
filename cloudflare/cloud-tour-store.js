import {beginOperation} from './operation-trace.js';
let pendingTrace;
let apartment = new URLSearchParams(location.search).get('apartment');
let savedPhotos = new Map();

async function request(path, options) {
  const response = await fetch('/api/staff/' + path, options);
  if (response.status === 401) location.assign('/staff');
  if (!response.ok) throw new Error((await response.json()).error);
  return response;
}

export async function loadDraft() {
  apartment=new URLSearchParams(location.search).get('apartment');
  if (!apartment) return null;
  const trace=beginOperation('apartment',apartment);trace.mark('open');try{
  const { tour, photos, revision } = await (await request('drafts/' + apartment,{headers:trace.headers()})).json();
  const images = new Map(await Promise.all(tour.rooms.filter(r=>Object.hasOwn(photos,r.id)).map(async room => [
    room.id,
    await (await request(`tours/${apartment}/images/${room.id}?version=${revision}`,{headers:trace.headers()})).blob()
  ])));
  savedPhotos = new Map([...images].map(([room, blob]) => [room, { blob, id: photos[room] }]));
  trace.mark('open',{status:200,count:images.size});return { tour, images, revision };
  }catch(error){trace.mark('open',{status:500});throw error;}finally{trace.send();}
}

async function performSaveDraft({ tour, images }, revision, progress = () => {}, options = {}) {
  for (const image of images.values()) {
    if (image.size > 4 * 1024 * 1024) throw new Error('Each cloud JPEG must be 4 MiB or smaller.');
  }
  const uploaded = new Map();
  for (const [room, blob] of images) {
    let photo = savedPhotos.get(room);
    if (photo?.blob !== blob) {
      progress('Uploading ' + tour.rooms.find(item => item.id === room).name + ' (' + (uploaded.size + 1) + ' of ' + images.size + ')…');
      const result = await request('photos'+(options.purpose==='uploads'?'?purpose=uploads&apartment='+apartment:''), { method: 'POST', headers: { 'Content-Type': 'image/jpeg',...options.trace?.headers() }, body: blob });
      photo = { blob, id: (await result.json()).id };
      savedPhotos.set(room, photo);
    }
    uploaded.set(room, photo);
  }
  progress('Saving shared draft…');
  const response = await request('apartments', {
    method: 'POST', headers: { 'Content-Type': 'application/json',...options.trace?.headers() },
    body: JSON.stringify({
      tour, photos: Object.fromEntries([...uploaded].map(([room, photo]) => [room, photo.id])),
      replacement: apartment, expectedVersion: revision, draft: true,...(options.purpose==='uploads'?{purpose:'uploads'}:{})
    })
  });
  const result = await response.json();
  apartment = result.id;
  savedPhotos = uploaded;
  history.replaceState(null, '', '?apartment=' + apartment + (new URLSearchParams(location.search).has('legacy') ? '&legacy=1' : ''));
  return result.version;
}

export async function saveDraft(draft,revision,progress=()=>{},options={}){const trace=options.trace??(pendingTrace??=beginOperation(options.purpose==='uploads'?'upload':'editor',apartment));trace.mark('save',{count:draft.images.size});try{const result=await performSaveDraft(draft,revision,progress,{...options,trace});trace.mark('save',{status:201,count:draft.images.size});pendingTrace=null;return result;}catch(e){trace.mark('save',{status:400});trace.retry();throw e;}finally{trace.send();}}

export async function completeDraft(revision){await request('apartments/'+apartment,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'publish',expectedVersion:revision})});return {revision};}
