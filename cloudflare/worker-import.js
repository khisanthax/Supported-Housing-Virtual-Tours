import { packTour, unpackTour } from '/staff/editor/tour-package.js';
async function send(path,body,type) {
  const response = await fetch('/api/staff/'+path,{method:'POST',headers:{'Content-Type':type},body});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
export async function exportApartment(apartment) {
  const endpoint='/api/staff/tours/'+apartment;
  const get=async path=>{
    const response=await fetch(endpoint+'/'+path);
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
  const url=URL.createObjectURL(packTour({tour,images}));
  const link=document.createElement('a');
  link.href=url;
  link.download='apartment-'+apartment.slice(0,8)+'.shtour';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export async function importPackage(file,replacement,expectedVersion) {
  const {tour,images} = await unpackTour(file);
  for (const jpeg of images.values()) {
    if (jpeg.size > 4 * 1024 * 1024) throw new Error('Each cloud JPEG must be 4 MiB or smaller.');
  }
  const photos = {};
  for (const [room,jpeg] of images) photos[room] = (await send('photos',jpeg,'image/jpeg')).id;
  await send('apartments',JSON.stringify({tour,photos,replacement,expectedVersion,draft:true}),'application/json');
}
