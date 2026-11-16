import { exportBackup, readBackup } from '/staff/editor/backup-ui.js';
import { inspectJpeg,validateDraft } from '/staff/editor/tour-package.js';
import { beginOperation } from '/staff/editor/operation-trace.js';
async function send(path,body,type,trace) {
  const response = await fetch('/api/staff/'+path,{method:'POST',headers:{'Content-Type':type,...trace?.headers()},body});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
export async function exportApartment(apartment,title='Apartment') {
  return exportBackup(async (signal,trace) => {
  const endpoint='/api/staff/tours/'+apartment;
  const get=async path=>{
    const response=await fetch(endpoint+'/'+path,{signal,headers:trace.headers()});
    if (!response.ok) throw new Error('Tour is unavailable. Retry shortly.');
    return response;
  };
  const response=await get('manifest');
  const version=response.headers.get('X-Tour-Version');
  const tour=await response.json();
  const images=new Map();
  for (const room of tour.rooms) {
    if(tour.builder?.missing.includes(room.id)) continue;
    const photo=await get('images/'+room.id+'?version='+version);
    images.set(room.id,await photo.blob());
  }
  return {tour,images};
  },title);
}
export async function validateCloudBackup(draft){
  validateDraft(draft);
  for(const jpeg of draft.images.values()){
    const {width,height}=await inspectJpeg(jpeg);
    if(jpeg.size>4*1024*1024||width>8192||height>4096)throw Error('Each cloud JPEG must be 4 MiB or smaller and at most 8192 × 4096.');
    const end=new Uint8Array(await jpeg.slice(-2).arrayBuffer());if(end[0]!==255||end[1]!==217)throw Error('The backup contains a truncated JPEG.');
  }
  return draft;
}
export async function importDraft(draft,{replacement,expectedVersion,importKey,photos={},trace=beginOperation('migration'),progress=()=>{}}={}){
  const {tour,images}=await validateCloudBackup(draft);
  if(replacement&&!confirm('Replace this private draft with the backup? Guests retain the current publication until explicit publishing.')) throw new DOMException('Backup import cancelled.','AbortError');
  const start=performance.now();trace.mark('backup-import',{count:images.size});
  try{for(const [room,jpeg]of images){if(!photos[room]){progress('Uploading photograph '+(Object.keys(photos).length+1)+' of '+images.size+'…');photos[room]=(await send('photos',jpeg,'image/jpeg',trace)).id;}}progress('Saving new private draft…');const result=await send('apartments',JSON.stringify({tour,photos,replacement,expectedVersion,draft:true,purpose:'import',...(importKey?{importKey}:{})}),'application/json',trace);trace.mark('migration-import',{status:201,count:images.size,duration:performance.now()-start});return result;}catch(error){trace.mark('migration-import',{status:500,duration:performance.now()-start});trace.retry();throw error;}finally{trace.send();}
}
export async function importPackage(file,replacement,expectedVersion) {
  return importDraft(await readBackup(file),{replacement,expectedVersion});
}
