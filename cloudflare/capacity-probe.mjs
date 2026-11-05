import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const origin = process.env.PILOT_PROBE_ORIGIN ?? 'http://localhost:4193';
const password=process.env.PILOT_PROBE_STAFF ?? (origin==='http://localhost:4193'?'Synthetic KV prototype staff only':null);
assert.ok(password,'Set the synthetic staff credential through the environment');
let cookie;
async function post(path, body, expected) {
  const image = Buffer.isBuffer(body);
  const response = await fetch(origin + '/api/staff/' + path, {
    method:'POST', headers:{Origin:origin,Cookie:cookie ?? '', 'Content-Type':image?'image/jpeg':'application/json'},
    body:image?body:JSON.stringify(body)
  });
  assert.equal(response.status,expected,path);
  if (!cookie) cookie = response.headers.get('Set-Cookie').split(';')[0];
  return response.json();
}
await post('sign-in',process.env.PILOT_PROBE_USERNAME ? {username:process.env.PILOT_PROBE_USERNAME,password} : {passphrase:password},200);
const jpeg = await readFile(new URL('./sample-images/living.jpg',import.meta.url));
const sample = JSON.parse(await readFile(new URL('./sample.json',import.meta.url),'utf8'));
const rooms = Array.from({length:7},(_,i)=>({
  ...sample.rooms[0], id:'view-'+i, name:'View '+(i+1), image:'images/view-'+i+'.jpg', links:[]
}));
for (let i=0;i<rooms.length-1;i++) {
  const pairId='door-'+(i+1);
  rooms[i].links.push({target:rooms[i+1].id,yaw:0,pitch:0,pairId});
  rooms[i+1].links.push({target:rooms[i].id,yaw:0,pitch:0,pairId});
}
const titlePrefix = 'Synthetic capacity ' + Date.now() + ' ';
const disposable=[];
try {
for (let i=0;i<25;i++) {
  const pairs = [];
  for (const room of rooms) {
    const comment = Buffer.concat([Buffer.from([255,254,0,18]),randomBytes(16)]);
    const photo = await post('photos',Buffer.concat([jpeg.subarray(0,2),comment,jpeg.subarray(2)]),201);
    pairs.push([room.id,photo.id]);
  }
  disposable.push(await post('apartments',{tour:{...sample,title:titlePrefix+(i+1),startRoom:rooms[0].id,rooms},photos:Object.fromEntries(pairs)},201));
}
const response = await fetch(origin+'/api/staff/offline',{headers:{Cookie:cookie}});
assert.equal(response.status,200);
const rows = (await response.json()).apartments.filter(a=>a.title.startsWith(titlePrefix));
assert.equal(rows.length,25);
assert.equal(rows.reduce((sum,a)=>sum+a.bytes,0),(jpeg.length+20)*175);
console.log('PASS 25 catalog drafts with 175 distinct private JPEG uploads; total '+rows.reduce((sum,a)=>sum+a.bytes,0)+' bytes');
} finally {
  for(const item of disposable) {
    const response=await fetch(origin+'/api/staff/apartments/'+item.id,{
      method:'PATCH',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},
      body:JSON.stringify({action:'remove',expectedVersion:item.version})
    });
    assert.equal(response.status,200,'remove disposable capacity draft');
    await response.arrayBuffer();
  }
  console.log('PASS removed '+disposable.length+' disposable capacity drafts; immutable images retain the cleanup grace period');
}
