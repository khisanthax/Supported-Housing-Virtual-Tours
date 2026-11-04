import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { packTour, unpackTour } from '../dist/tour-package.js';

const origin=process.env.PILOT_PROBE_ORIGIN ?? 'http://localhost:4193';
const staffPassphrase=process.env.PILOT_PROBE_STAFF ??
  (origin==='http://localhost:4193' ? 'Synthetic KV prototype staff only' : null);
assert.ok(staffPassphrase,'Set PILOT_PROBE_STAFF for a remote probe');
const call=(path,{method='GET',cookie,body,type='application/json'}={})=>fetch(origin+path,{
  method,redirect:'manual',headers:{Connection:'close',...(cookie?{Cookie:cookie}:{}),...(method==='GET'?{}:{Origin:origin}),...(body?{'Content-Type':type}:{})},
  body:body && (type==='application/json'?JSON.stringify(body):body)
});
async function check(path,status,options) {
  const response=await call(path,options);
  assert.equal(response.status,status,path);
  return response;
}
function token(response) { return response.headers.get('set-cookie').split(';')[0]; }
const post=(cookie,body)=>({method:'POST',cookie,body});
async function login() {
  return token(await check('/api/staff/sign-in',200,post(null,{passphrase:staffPassphrase})));
}
const staff=await login();
const secondStaff=await login();
assert.notEqual(staff,secondStaff);
const tour=JSON.parse(await readFile(new URL('./sample.json',import.meta.url),'utf8'));
const original=new Map();
const photos={};
await check('/api/staff/photos',401,{method:'POST',type:'image/jpeg',body:new Uint8Array([255,216,255,217])});
await check('/api/staff/photos',400,{method:'POST',cookie:staff,type:'image/jpeg',body:new Uint8Array([255,216,255,217])});
await check('/api/staff/photos',413,{method:'POST',cookie:staff,type:'image/jpeg',body:new Uint8Array(4*1024*1024+1)});
for (const room of tour.rooms) {
  const jpeg=await readFile(new URL('./sample-images/'+room.id+'.jpg',import.meta.url));
  original.set(room.id,new Blob([jpeg],{type:'image/jpeg'}));
  photos[room.id]=(await (await check('/api/staff/photos',201,{method:'POST',cookie:staff,body:jpeg,type:'image/jpeg'})).json()).id;
}
async function save(title,replacement='',expectedVersion) {
  return (await check('/api/staff/apartments',201,post(staff,{tour:{...tour,title},photos,replacement,expectedVersion}))).json();
}
const a=await save('Synthetic Willow'),b=await save('Synthetic Maple'),c=await save('Synthetic Cedar');
const publicationStarted=Date.now();
for(const apartment of [a,b,c]){
  await check('/api/staff/apartments/'+apartment.id,200,{
    method:'PATCH',cookie:staff,body:{action:'publish',expectedVersion:apartment.version}
  });
}
const fromServer=new Map();
for (const room of tour.rooms) {
  const response=await check('/api/staff/tours/'+a.id+'/images/'+room.id,200,{cookie:secondStaff});
  const jpeg=await response.blob();
  assert.deepEqual(await jpeg.arrayBuffer(),await original.get(room.id).arrayBuffer());
  fromServer.set(room.id,jpeg);
}
const restored=await unpackTour(packTour({tour,images:fromServer}));
assert.deepEqual(restored.tour,tour);
assert.equal(restored.images.size,3);
console.log('PASS upload validation, binary KV bytes, independent staff sessions and backup round-trip');

async function share(apartments, options={}) {
  const result=await (await check('/api/staff/shares',201,post(staff,{apartments,expires:Date.now()+3600000,...options}))).json();
  assert.match(result.code,options.wordCount ? /^[a-z]+(?:-[a-z]+){2}$/ : /^[A-Za-z0-9_-]{21}[AQgw]$/);
  assert.equal(result.url.includes(result.code),false);
  return result;
}
await check('/api/staff/shares',400,post(staff,{apartments:[a.id],passphrase:'chosen by staff',expires:Date.now()+60000}));
const link=await share([a.id,b.id],{wordCount:3});
const generated=await share([a.id]);
async function unlock(link,code=link.code,expected=200) {
  const response=await check('/api/guest/unlock',expected,post(null,{token:new URL(link.url).hash.slice(1),code}));
  return expected===200 ? token(response) : null;
}
const guest=await unlock(link,link.code.toUpperCase().replaceAll('-',' '));
const generatedGuest=await unlock(generated);
await unlock(link,generated.code,401);
assert.deepEqual(await (await check('/api/guest/catalog',200,{cookie:guest})).json(),[]);
console.log('PASS new versions are withheld during the KV warm-up');
const authPath='/api/staff/shares/'+link.id;
await new Promise(resolve=>setTimeout(resolve,Math.max(0,publicationStarted+62000-Date.now())));
const catalog=async cookie=>(await (await check('/api/guest/catalog',200,{cookie})).json()).map(v=>v.id).sort();
assert.deepEqual(await catalog(guest),[a.id,b.id].sort());
for (const route of ['manifest','thumbnail','images/living']) {
  await check(`/api/guest/tours/${a.id}/${route}`,200,{cookie:guest});
  await check(`/api/guest/tours/${c.id}/${route}`,404,{cookie:guest});
  await check(`/api/guest/tours/${a.id}/${route}`,401);
}
await check('/photos/'+photos.living,404,{cookie:guest});
await check('/viewer/images/living.jpg',404,{cookie:guest});
await check('/sharing/staff.html',404,{cookie:guest});
await check('/staff/editor/images/living.jpg',401,{cookie:guest});
await check('/staff/editor/index.html',303,{cookie:guest});
await check(authPath,200,{method:'PATCH',cookie:staff,body:{apartments:[b.id,c.id]}});
await check('/api/guest/catalog',401,{cookie:guest});
const rotation=await (await check(authPath+'/phrase',200,post(staff,{wordCount:5}))).json();
assert.equal(rotation.code.split('-').length,5);
await unlock(link,link.code,401);
const revised=await unlock(link,rotation.code);
assert.deepEqual(await catalog(revised),[b.id,c.id].sort());
await check(authPath,200,{method:'DELETE',cookie:staff});
await check(`/api/guest/tours/${b.id}/images/living`,401,{cookie:revised});
await unlock(link,rotation.code,401);
const expires=Date.now()+5000;
const expiry=await share([a.id],{expires});
const expiring=await unlock(expiry);
await new Promise(resolve=>setTimeout(resolve,Math.max(0,expires-Date.now()+100)));
await check(`/api/guest/tours/${a.id}/images/living`,401,{cookie:expiring});
const replacement=await save('Synthetic Willow revised',a.id,1);
assert.equal(replacement.version,2);
await check('/api/staff/apartments',409,post(staff,{tour,photos,replacement:a.id,expectedVersion:1}));
assert.ok((await catalog(generatedGuest)).includes(a.id));
const published=await check(`/api/guest/tours/${a.id}/manifest`,200,{cookie:generatedGuest});
assert.equal((await published.json()).title,'Synthetic Willow');
const offlinePath='/api/staff/offline/'+a.id;
await check('/offline/',200);
await check('/offline/sw.js',200);
await check('/api/staff/offline',401,{cookie:generatedGuest});
const offline=(await (await check(offlinePath+'/manifest',200,{cookie:secondStaff})).json());
assert.equal(offline.revision,'2');
assert.equal(offline.images.length,tour.rooms.length);
await check(offlinePath+'/images/living?revision=1',409,{cookie:secondStaff});
await check(offlinePath+'/images/living?revision=2',200,{cookie:secondStaff});
const changeState=action=>check('/api/staff/apartments/'+a.id,200,{
  method:'PATCH',cookie:staff,body:{action,expectedVersion:2}
});
await changeState('archive');
await check(offlinePath+'/manifest',404,{cookie:secondStaff});
await check(`/api/guest/tours/${a.id}/manifest`,404,{cookie:generatedGuest});
await check(`/api/staff/tours/${a.id}/manifest`,200,{cookie:staff});
await changeState('restore');
await check(offlinePath+'/manifest',200,{cookie:secondStaff});
await check(`/api/guest/tours/${a.id}/manifest`,404,{cookie:generatedGuest});
console.log('PASS staff-only offline downloads, revision checks, archive and restore as an unpublished draft');
console.log('PASS selected tours, unauthorized alternate URLs, share edits, immediate revocation, expiry, version conflict and prior published version');
let limited=false;
for (let i=0;i<12;i++) {
  const response=await call('/api/guest/unlock',post(null,{token:new URL(generated.url).hash.slice(1),code:randomBytes(16).toString('base64url')}));
  if (response.status===429) { limited=true; break; }
  assert.equal(response.status,401);
}
assert.ok(limited);
console.log('PASS generated phrases, case and separator normalization, regeneration, separate URLs, and rate limiting');
