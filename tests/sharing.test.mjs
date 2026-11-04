import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSharingServer } from '../scripts/guest-server.mjs';
import { packTour } from '../dist/tour-package.js';

test('multi-apartment access is private, scoped, persistent and invalidated by edits, expiry and revocation', async t => {
  const dir = await mkdtemp(path.join(tmpdir(),'sharing-test-'));
  const probe = net.createServer().listen(0,'127.0.0.1');
  await once(probe,'listening');
  const port = probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const database = path.join(dir,'test.sqlite');
  const staffPassphrase = 'Synthetic staff passphrase for automated test';
  const passphrase = 'Synthetic guest passphrase';
  let time = Date.now();
  const server = await createSharingServer({database,origin,staffPassphrase,synthetic:true,now:()=>time});
  server.listen(port,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{ await new Promise(resolve=>server.close(resolve)); await rm(dir,{recursive:true}); });
  const request = (route,{method='GET',cookie,json,raw,from=origin}={}) => fetch(origin+route,{
    method,headers:{...(method==='GET'?{}:{Origin:from}),...(cookie?{Cookie:cookie}:{}),...(json?{'Content-Type':'application/json'}:raw?{'Content-Type':'application/octet-stream'}:{})},
    body:json?JSON.stringify(json):raw
  });
  const login = async () => {
    const response = await request('/api/staff/sign-in',{method:'POST',json:{passphrase:staffPassphrase}});
    assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  assert.equal((await request('/api/guest/catalog')).status,401);
  assert.equal((await request('/api/staff/dashboard')).status,401);
  assert.equal((await request('/sharing/staff.js')).status,401);
  assert.doesNotMatch(await (await request('/staff')).text(),/Create Guest Link|Apartment catalog/);
  const staff = await login();
  const dashboard = async () => (await request('/api/staff/dashboard',{cookie:staff})).json();
  const {apartments:[a,b,c]} = await dashboard();
  const offlinePath = '/api/staff/offline';
  assert.equal((await request(offlinePath)).status,401);
  const offlineCatalog = await (await request(offlinePath,{cookie:staff})).json();
  assert.deepEqual(offlineCatalog.apartments.map(item=>item.id),[a.id,b.id,c.id]);
  const savedManifest = await (await request(`${offlinePath}/${a.id}/manifest`,{cookie:staff})).json();
  assert.equal(savedManifest.expires,time+24*60*60*1000);
  assert.equal(savedManifest.revision,offlineCatalog.apartments[0].revision);
  assert.deepEqual(savedManifest.images.map(image=>image.room).sort(),savedManifest.tour.rooms.map(room=>room.id).sort());
  for (const room of savedManifest.images) {
    const photo = await request(`${offlinePath}/${a.id}/images/${room.room}?revision=${savedManifest.revision}`,{cookie:staff});
    assert.equal(photo.status,200);
    assert.match(photo.headers.get('cache-control'),/no-store/);
    assert.equal((await photo.arrayBuffer()).byteLength,room.bytes);
  }
  const create = (apartments, expires = time + 60_000) => request('/api/staff/shares',{method:'POST',cookie:staff,json:{apartments,expires,passphrase}});
  assert.equal((await create([])).status,400);
  assert.equal((await create([a.id,a.id])).status,400);
  assert.equal((await create([a.id],time)).status,400);
  const created = await create([a.id,b.id]);
  assert.equal(created.status,201);
  const share = await created.json();
  const token = new URL(share.url).hash.slice(1);
  assert.match(token,/^[a-zA-Z0-9_-]{43}$/);
  const unlock = (token,passphrase) => request('/api/guest/unlock',{method:'POST',json:{token,passphrase}});
  assert.equal((await unlock(token,'wrong passphrase')).status,401);
  const session = async () => {
    const response = await unlock(token,passphrase);
    assert.equal(response.status,200);
    assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    return response.headers.get('set-cookie').split(';')[0];
  };
  let guest = await session();
  for (const suffix of ['',`/${a.id}/manifest`,`/${a.id}/images/living`]) {
    assert.equal((await request(offlinePath+suffix,{cookie:guest})).status,401);
  }
  assert.equal((await request('/offline/images/living.jpg',{cookie:guest})).status,404);
  const catalog = async () => (await request('/api/guest/catalog',{cookie:guest})).json();
  assert.deepEqual((await catalog()).map(x=>x.id),[a.id,b.id]);
  const tour = (apt,asset,cookie=guest) => request(`/api/guest/tours/${apt.id}/${asset}`,{cookie});
  for (const apartment of [a,b]) {
    const page = await request('/guest/tour/'+apartment.id,{cookie:guest});
    assert.equal(page.status,200);
    const markup = await page.text();
    assert.match(markup,/data-guest="true"/);
    assert.match(markup,/src="\/viewer\/app.js"/);
    assert.doesNotMatch(markup,/edit-tour|editor-panel|Try your own|The Willow Apartment/);
    for (const asset of ['manifest','thumbnail','images/living']) {
      const response = await tour(apartment,asset);
      assert.equal(response.status,200);
      assert.match(response.headers.get('cache-control'),/no-store/);
    }
  }
  for (const asset of ['manifest','thumbnail','images/living']) {
    assert.equal((await tour(c,asset)).status,404);
    assert.equal((await tour(a,asset,'')).status,401);
    assert.equal((await tour(a,asset,staff)).status,401);
  }
  assert.equal((await request('/guest/tour/'+c.id,{cookie:guest})).status,404);
  assert.equal((await request('/staff/editor/',{cookie:guest})).status,401);
  assert.equal((await request('/staff/editor/',{cookie:staff})).status,200);
  assert.equal((await request('/staff/editor/app.js',{cookie:staff})).status,200);
  assert.equal((await request('/viewer/images/living.jpg',{cookie:guest})).status,404);
  assert.equal((await request('/viewer/tour-editor.js',{cookie:guest})).status,404);
  assert.equal((await request('/viewer/app.js',{cookie:guest})).status,200);
  const edit = `/api/staff/shares/${share.id}`;
  assert.equal((await request(edit,{method:'PATCH',cookie:guest,json:{apartments:[c.id]}})).status,401);
  assert.equal((await request(edit,{method:'PATCH',cookie:staff,from:'https://other.invalid',json:{apartments:[c.id]}})).status,403);
  assert.equal((await request(edit,{method:'PATCH',cookie:staff,json:{apartments:[b.id,c.id]}})).status,200);
  for (const asset of ['manifest','thumbnail','images/living']) assert.equal((await tour(b,asset)).status,401);
  guest = await session();
  assert.deepEqual((await catalog()).map(x=>x.id),[b.id,c.id]);
  assert.equal((await tour(a,'images/living')).status,404);
  assert.equal((await request(edit,{method:'DELETE',cookie:staff})).status,200);
  for (const asset of ['manifest','thumbnail','images/living']) assert.equal((await tour(b,asset)).status,401);
  assert.equal((await unlock(token,passphrase)).status,401);
  const expiring = await (await create([a.id],time+500)).json();
  const expiringSession = await unlock(new URL(expiring.url).hash.slice(1),passphrase);
  assert.equal(expiringSession.status,200);
  guest = expiringSession.headers.get('set-cookie').split(';')[0];
  time += 501;
  assert.equal((await tour(a,'images/living')).status,401);
  assert.deepEqual(new Set((await dashboard()).shares.map(s=>s.status)),new Set(['expired','revoked']));
  assert.equal((await request('/api/staff/sign-in',{method:'POST',json:{passphrase:staffPassphrase}})).status,429);
  const stored = new DatabaseSync(database,{readOnly:true});
  const record = stored.prepare('SELECT token_hash,pass_hash,salt FROM shares WHERE id=?').get(share.id);
  assert.notEqual(record.token_hash,token);
  assert.equal(record.pass_hash.length,32);
  assert.equal(record.salt.length,16);
  assert.equal(stored.prepare('SELECT COUNT(*) AS n FROM permissions WHERE share_id=?').get(share.id).n,2);
  stored.close();
  const manifest = JSON.parse(await readFile(new URL('../dist/data/apartment.json',import.meta.url),'utf8'));
  const images = new Map(await Promise.all(manifest.rooms.map(async room=>[room.id,new Blob([await readFile(new URL('../dist/'+room.image,import.meta.url))])])));
  const imported = await request('/api/staff/apartments',{method:'POST',cookie:staff,raw:packTour({tour:{...manifest,title:'Imported synthetic tour'},images})});
  assert.equal(imported.status,201);
  assert.ok((await dashboard()).apartments.some(a=>a.title==='Imported synthetic tour'));
  const replaced = await request('/api/staff/apartments?replace='+a.id,{method:'POST',cookie:staff,raw:packTour({tour:manifest,images})});
  assert.equal(replaced.status,200);
  assert.equal((await replaced.json()).id,a.id);
  const refreshed = await (await request(`${offlinePath}/${a.id}/manifest`,{cookie:staff})).json();
  assert.notEqual(refreshed.revision,savedManifest.revision);
  assert.equal((await request(`${offlinePath}/${a.id}/images/living?revision=${savedManifest.revision}`,{cookie:staff})).status,409);
});
