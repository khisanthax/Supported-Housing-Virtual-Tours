import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker, { StaffLogin } from '../cloudflare/worker.mjs';
import { hashStaffPassword } from '../cloudflare/staff-password.mjs';
import { moveGridRoom } from '../dist/room-grid.js';
import { blankApartment, addIncompleteRoom } from '../dist/builder-data.js';
import { resetLayout,restoreLayout } from '../dist/layout-state.js';
import {enablePanorama} from '../dist/graph-tour.js';

const origin = 'https://synthetic-test.workers.dev';
const adminPassword = 'Synthetic administrator password';
const editorPassword = 'Synthetic staff editor password';
const replacementPassword = 'Synthetic replacement password';
const digest = value => createHash('sha256').update(value).digest('hex');

async function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T00:00:30Z') });
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  database.exec(await readFile(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8'));
  const d1 = {
    withSession(mode) {
      assert.equal(mode, 'first-primary');
      return d1;
    },
    prepare(sql) {
      return { bind: (...args) => ({
        first: () => database.prepare(sql).get(...args),
        all: () => ({ results: database.prepare(sql).all(...args) }),
        run() {
          const statement = database.prepare(sql);
          return statement.columns().length
            ? { results: statement.all(...args) }
            : { meta: statement.run(...args) };
        }
      }) };
    },
    batch(statements) {
      // Execute each mock D1 batch atomically, including when logins overlap.
      database.exec('BEGIN');
      try {
        const result = statements.map(statement => statement.run());
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
  };
  const env = {
    DB: d1, SYNTHETIC_EDGE_PILOT: '1', PILOT_ORIGIN: origin, GUEST_CODE_KEY: 'a'.repeat(64),
    STAFF_ACCOUNTS: '1', STAFF_AUTH_MODE: 'password', TOUR_API_BACKEND: 'durable-object'
  };
  const delegated = [];
  const passwordWork = [];
  const actors = new Map();
  const binding = { getByName(name) {
    if (!actors.has(name)) actors.set(name, new StaffLogin(null, env));
    return { fetch(request) {
      const target = new URL(request.url);
      if (target.origin === origin) delegated.push(`${request.method} ${target.pathname}`);
      else passwordWork.push(target.pathname);
      return actors.get(name).fetch(request);
    } };
  } };
  env.STAFF_LOGIN = binding;
  const outbound = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Password mode attempted an outbound request');
  });
  const request = (path, {
    method = 'GET', cookie = '', body, ip = 'test', forwardedClient = '', requestOrigin = origin
  } = {}) => worker.fetch(new Request(origin + path, {
    method,
    headers: {
      Cookie: cookie, Origin: requestOrigin, 'Content-Type': 'application/json',
      'CF-Connecting-IP': ip, 'X-Staff-Login-Client': forwardedClient
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
  const signIn = (username, password, { ip = username, ...options } = {}) =>
    request('/api/staff/sign-in', { method: 'POST', body: { username, password }, ip, ...options });
  return { database, env, binding, outbound, delegated, passwordWork, request, signIn };
}

function session(response) {
  assert.equal(response.status, 200);
  const header = response.headers.get('Set-Cookie');
  assert.match(header, /^__Host-sht_staff=[A-Za-z0-9_-]{43};/);
  assert.match(header, /(?:^|;\s*)Secure(?:;|$)/);
  assert.match(header, /(?:^|;\s*)HttpOnly(?:;|$)/);
  assert.match(header, /(?:^|;\s*)Path=\/(?:;|$)/);
  assert.match(header, /(?:^|;\s*)SameSite=Strict(?:;|$)/);
  assert.match(header, /(?:^|;\s*)Max-Age=[1-9]\d*(?:;|$)/);
  assert.doesNotMatch(header, /(?:^|;\s*)Domain=/i);
  return header.split(';')[0];
}

test('cloud graph publication and offline downloads project explicit exclusions while keeping the full shared draft',async t=>{
 const {database,env,request,signIn}=await fixture(t);
 database.prepare('INSERT INTO staff_accounts(username,password_verifier,role) VALUES(?,?,?)').run('admin',hashStaffPassword(adminPassword),'administrator');
 const cookie=session(await signIn('admin',adminPassword)),tour=enablePanorama(blankApartment());
 for(const name of ['Living Room','Dining Room','Unused'])addIncompleteRoom(tour,name);
 tour.builder.missing=['room-3'];tour.builder.excluded=['room-3'];
 const photos={'room-1':'a'.repeat(32),'room-2':'b'.repeat(32)};for(const id of Object.values(photos))database.prepare('INSERT INTO photos VALUES(?,100,1)').run(id);
 const saved=await request('/api/staff/apartments',{method:'POST',cookie,body:{tour,photos}});assert.equal(saved.status,201);const {id,version}=await saved.json();
 assert.ok((await(await request('/api/staff/offline',{cookie})).json()).apartments.some(a=>a.id===id));
 const offline=await(await request('/api/staff/offline/'+id+'/manifest',{cookie})).json();assert.equal(offline.tour.rooms.length,2);assert.equal(offline.images.length,2);
 assert.equal((await request('/api/staff/offline/'+id+'/images/room-3?revision='+version,{cookie})).status,404);
 assert.equal((await request('/api/staff/apartments/'+id,{method:'PATCH',cookie,body:{action:'publish',expectedVersion:version}})).status,200);
 t.mock.timers.setTime(Date.now()+61000);
 const share=await(await request('/api/staff/shares',{method:'POST',cookie,body:{apartments:[id],expires:Date.now()+300000,wordCount:3}})).json();
 const unlocked=await request('/api/guest/unlock',{method:'POST',body:{token:new URL(share.url).hash.slice(1),code:share.code}});assert.equal(unlocked.status,200);const guest=unlocked.headers.get('set-cookie').split(';')[0];
 assert.equal((await(await request('/api/guest/tours/'+id+'/manifest',{cookie:guest})).json()).rooms.length,2);
 env.PHOTOS={get(){throw Error('Excluded JPEG must not be read');}};
 assert.equal((await request('/api/guest/tours/'+id+'/images/room-3',{cookie:guest})).status,404);
 assert.equal((await(await request('/api/staff/drafts/'+id,{cookie})).json()).tour.rooms.length,3);
});

test('private tour dispatch preserves ingress identity, rejects cross-origin writes and supports rollback',async t=>{
 const {env,request}=await fixture(t);let forwarded;
 env.STAFF_LOGIN={getByName(name){assert.equal(name,'tour-api-v2');return {fetch(r){forwarded=r;return new Response('{}');}};}};
 assert.equal((await request('/api/guest/unlock',{method:'POST',body:{},ip:'real-source',forwardedClient:'spoofed'})).status,200);
 assert.equal(forwarded.headers.get('X-Staff-Login-Client'),'real-source');
 forwarded=null;assert.equal((await request('/api/staff/apartments',{method:'POST',body:{},requestOrigin:'https://other.example'})).status,403);assert.equal(forwarded,null);
 env.TOUR_API_BACKEND='worker';assert.equal((await request('/api/staff/drafts/'+'a'.repeat(32))).status,401);assert.equal(forwarded,null);
});

test('cloud grid drafts reject incomplete publication and thumbnails require current staff authorization', async t => {
  const { database, env, request, signIn } = await fixture(t);
  database.prepare('INSERT INTO staff_accounts(username,password_verifier,role) VALUES(?,?,?)')
    .run('admin', hashStaffPassword(adminPassword), 'administrator');
  const admin = session(await signIn('admin', adminPassword));
  const tour = JSON.parse(await readFile(new URL('../cloudflare/sample.json', import.meta.url)));
  tour.rooms.forEach(r => r.links = []);
  moveGridRoom(tour, tour.rooms[1].id, 1, 0);
  const photos = Object.fromEntries(tour.rooms.map((r,i) => [r.id, String(i+1).repeat(32)]));
  for (const photo of Object.values(photos)) database.prepare('INSERT INTO photos(id,bytes,ready) VALUES(?,1,1)').run(photo);
  const saved = await request('/api/staff/apartments', { method:'POST', cookie:admin, body:{tour,photos} });
  assert.equal(saved.status,201);
  const {id,version} = await saved.json();
  const publish = () => request('/api/staff/apartments/'+id,{method:'PATCH',cookie:admin,body:{action:'publish',expectedVersion:version}});
  assert.equal((await publish()).status,400);
  env.PHOTOS = { get: async () => new Uint8Array([255,216,255,217]) };
  const thumb = '/api/staff/tours/'+id+'/thumbnail';
  assert.equal((await request(thumb)).status,401);
  assert.equal((await request(thumb,{cookie:admin})).status,200);
  const invalid = structuredClone(tour); invalid.grid.positions[tour.rooms[1].id] = {x:0,y:0};
  assert.equal((await request('/api/staff/apartments',{method:'POST',cookie:admin,body:{tour:invalid,photos}})).status,400);
  database.prepare("UPDATE staff_accounts SET disabled=1 WHERE username='admin'").run();
  assert.equal((await request(thumb,{cookie:admin})).status,401);
});

test('cloud reset checkpoints survive saves, reject corruption and stale writes, and preserve publication and JPEG references',async t=>{
 const {database,request,signIn}=await fixture(t);
 database.prepare('INSERT INTO staff_accounts(username,password_verifier,role) VALUES(?,?,?)').run('admin',hashStaffPassword(adminPassword),'administrator');
 const admin=session(await signIn('admin',adminPassword)),tour=JSON.parse(await readFile(new URL('../cloudflare/sample.json',import.meta.url)));
 const photos=Object.fromEntries(tour.rooms.map((r,i)=>[r.id,String(i+1).repeat(32)]));for(const photo of Object.values(photos))database.prepare('INSERT INTO photos(id,bytes,ready) VALUES(?,1,1)').run(photo);
 resetLayout(tour,1);const checkpoint=structuredClone(tour.layoutCheckpoint);
 const saved=await request('/api/staff/apartments',{method:'POST',cookie:admin,body:{tour,photos}});assert.equal(saved.status,201);const {id,version}=await saved.json();
 const loaded=await(await request('/api/staff/drafts/'+id,{cookie:admin})).json();assert.deepEqual(loaded.tour.layoutCheckpoint,checkpoint);assert.deepEqual(loaded.photos,photos);
 const invalid=structuredClone(tour);invalid.layoutCheckpoint.layout.rooms[0].links=[{target:'invented',yaw:0,pitch:0}];assert.equal((await request('/api/staff/apartments',{method:'POST',cookie:admin,body:{tour:invalid,photos,replacement:id,expectedVersion:version}})).status,400);
 restoreLayout(tour,checkpoint.layout);assert.equal((await request('/api/staff/apartments',{method:'POST',cookie:admin,body:{tour,photos,replacement:id,expectedVersion:version}})).status,201);
 assert.equal((await request('/api/staff/apartments/'+id,{method:'PATCH',cookie:admin,body:{action:'publish',expectedVersion:version+1}})).status,200);
 const publication=database.prepare('SELECT * FROM versions WHERE apartment=? AND seq=?').get(id,version+1);
 resetLayout(tour,2);assert.deepEqual(tour.layoutCheckpoint,checkpoint);
 assert.equal((await request('/api/staff/apartments',{method:'POST',cookie:admin,body:{tour,photos,replacement:id,expectedVersion:version+1}})).status,201);
 assert.equal((await request('/api/staff/apartments',{method:'POST',cookie:admin,body:{tour,photos,replacement:id,expectedVersion:version+1}})).status,409);
 assert.deepEqual(database.prepare('SELECT * FROM versions WHERE apartment=? AND seq=?').get(id,version+1),publication);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM photos').get().n,3);
});

test('blank and incomplete cloud apartments survive reload and remain excluded from publication and offline download',async t=>{
 const {database,request,signIn}=await fixture(t);
 database.prepare('INSERT INTO staff_accounts(username,password_verifier,role) VALUES(?,?,?)').run('admin',hashStaffPassword(adminPassword),'administrator');
 const admin=session(await signIn('admin',adminPassword));const tour=blankApartment('Synthetic empty apartment');
 const response=await request('/api/staff/apartments',{method:'POST',cookie:admin,body:{tour,photos:{}}});assert.equal(response.status,201);
 const {id,version}=await response.json();assert.equal((await(await request('/api/staff/drafts/'+id,{cookie:admin})).json()).tour.rooms.length,0);
 assert.equal((await request('/api/staff/apartments/'+id,{method:'PATCH',cookie:admin,body:{action:'publish',expectedVersion:version}})).status,400);
 assert.equal((await request('/api/staff/tours/'+id+'/thumbnail',{cookie:admin})).status,404);
 addIncompleteRoom(tour,'Kitchen');
 const saved=await request('/api/staff/apartments',{method:'POST',cookie:admin,body:{tour,photos:{},replacement:id,expectedVersion:version}});assert.equal(saved.status,201);
 const catalog=await(await request('/api/staff/offline',{cookie:admin})).json();assert.equal(catalog.apartments.some(a=>a.id===id),false);
 assert.equal((await request('/api/staff/offline/'+id+'/manifest',{cookie:admin})).status,409);
});

test('local staff accounts use private password operations and revoke sessions on reset, disable, expiry and logout', async t => {
  const { database, env, binding, outbound, delegated, passwordWork, request, signIn } = await fixture(t);
  const verifier = await hashStaffPassword(adminPassword);
  database.prepare('INSERT INTO staff_accounts (username, password_verifier, role) VALUES (?, ?, ?)')
    .run('admin', verifier, 'administrator');
  const accounts = '/api/staff/accounts';
  const dashboard = '/api/staff/dashboard';
  const create = (cookie, username = 'staff-editor', password = editorPassword) =>
    request(accounts, { method: 'POST', cookie, body: { username, password, role: 'editor' } });
  const change = (cookie, action, extra) => request(accounts, {
    method: 'PATCH', cookie, body: { username: 'staff-editor', action, ...extra }
  });

  assert.equal((await create('')).status, 401);
  assert.equal((await request(accounts)).status, 401);
  const signedOutPage = await request('/staff/accounts');
  assert.equal(signedOutPage.status, 303);
  assert.equal(signedOutPage.headers.get('Location'), '/staff');
  assert.equal((await request('/sharing/staff-accounts.js')).status, 401);
  assert.equal((await worker.fetch(new Request('https://staff-password.internal/verify', { method: 'POST' }), env)).status, 403);
  assert.equal((await signIn('admin', adminPassword, { requestOrigin: 'https://example.test' })).status, 403);
  delete env.STAFF_ACCOUNTS;
  env.STAFF_RANDOM_HASH = digest(adminPassword);
  assert.equal((await request('/api/staff/sign-in', { method: 'POST', body: { passphrase: adminPassword } })).status, 401);
  const beforeBindingFailure = delegated.length;
  delete env.STAFF_LOGIN;
  assert.equal((await signIn('admin', adminPassword)).status, 503);
  assert.equal(delegated.length, beforeBindingFailure);
  env.STAFF_LOGIN = binding;
  const admin = session(await signIn('ADMIN', adminPassword));
  assert.equal(delegated.at(-1), 'POST /api/staff/sign-in');
  assert.equal(passwordWork.at(-1), '/verify');
  assert.equal((await create(admin, 'staff-editor', 'too short')).status, 400);
  assert.equal((await create(admin)).status, 201);
  assert.equal(delegated.at(-1), 'POST /api/staff/accounts');
  assert.equal(passwordWork.at(-1), '/hash');
  assert.equal((await create(admin, 'STAFF-EDITOR', replacementPassword)).status, 409);
  const list = await request(accounts, { cookie: admin });
  assert.equal(list.status, 200);
  const data = await list.json();
  assert.equal(data.passwordAccounts, true);
  assert.deepEqual(data.accounts.map(({ username, role }) => [username, role]), [
    ['admin', 'administrator'], ['staff-editor', 'editor']
  ]);
  assert.ok(data.accounts.every(account => !Object.keys(account).some(key => /password|verifier/i.test(key))));
  const stored = database.prepare('SELECT password_verifier FROM staff_accounts WHERE username=?').get('staff-editor');
  assert.notEqual(stored.password_verifier, editorPassword);

  assert.equal((await signIn('staff-editor', 'Incorrect synthetic password')).status, 401);
  const [firstEditor, secondEditor] = (await Promise.all([
    signIn('staff-editor', editorPassword), signIn('staff-editor', editorPassword)
  ])).map(session);
  assert.notEqual(firstEditor, secondEditor);
  assert.equal((await request(dashboard, { cookie: firstEditor })).status, 200);
  assert.equal((await request(dashboard, { cookie: secondEditor })).status, 200);
  assert.equal((await request(accounts, { cookie: firstEditor })).status, 403);
  assert.equal((await request('/staff/accounts', { cookie: firstEditor })).status, 403);
  assert.equal((await create(firstEditor, 'blocked-editor')).status, 403);
  assert.equal((await change(firstEditor, 'disable')).status, 403);
  assert.equal((await change(admin, 'reset', { password: 'too short' })).status, 400);
  assert.equal((await request(dashboard, { cookie: firstEditor })).status, 200);

  assert.equal((await change(admin, 'reset', { password: replacementPassword })).status, 200);
  assert.equal(delegated.at(-1), 'PATCH /api/staff/accounts');
  for (const cookie of [firstEditor, secondEditor]) {
    assert.equal((await request(dashboard, { cookie })).status, 401);
  }
  assert.equal((await signIn('staff-editor', editorPassword)).status, 401);
  const replacement = session(await signIn('staff-editor', replacementPassword));
  const tour = JSON.parse(await readFile(new URL('../cloudflare/sample.json', import.meta.url), 'utf8'));
  const photos = Object.fromEntries(tour.rooms.map((room, index) => [room.id, String(index + 1).repeat(32)]));
  for (const photo of Object.values(photos)) database.prepare('INSERT INTO photos (id,bytes,ready) VALUES (?,1,1)').run(photo);
  const saveDraft = (cookie, body) => request('/api/staff/apartments', { method: 'POST', cookie, body });
  const created = await saveDraft(replacement, { tour, photos });
  assert.equal(created.status, 201);
  const { id: apartment, version } = await created.json();
  const edit = { tour: { ...tour, title: 'Synthetic Editor revision' }, photos, replacement: apartment, expectedVersion: version };
  const saved = await saveDraft(replacement, edit);
  assert.equal(saved.status, 201);
  const { revision, tour: storedTour } = await (await request('/api/staff/drafts/' + apartment, { cookie: admin })).json();
  assert.equal(storedTour.title, edit.tour.title);
  assert.equal(revision, version + 1);
  const offlineManifest='/api/staff/offline/'+apartment+'/manifest';
  assert.equal((await request(offlineManifest)).status,401);
  assert.equal((await (await request(offlineManifest,{cookie:admin})).json()).expires,Date.now()+24*3600000);
  for (const hours of ['1','168']) {
    env.TOUR_OFFLINE_HOURS=hours;
    assert.equal((await (await request(offlineManifest,{cookie:admin})).json()).expires,Date.now()+Number(hours)*3600000);
  }
  for (const hours of ['0','169','1.5','invalid']) {
    env.TOUR_OFFLINE_HOURS=hours;
    assert.equal((await request(offlineManifest,{cookie:admin})).status,503);
  }
  delete env.TOUR_OFFLINE_HOURS;
  assert.equal((await change(admin, 'disable')).status, 200);
  assert.equal((await request(dashboard, { cookie: replacement })).status, 401);
  assert.equal((await saveDraft(replacement, { ...edit, expectedVersion: revision })).status, 401);
  assert.equal((await signIn('staff-editor', replacementPassword)).status, 401);
  assert.equal((await change(admin, 'enable')).status, 200);
  assert.equal((await request(dashboard, { cookie: replacement })).status, 401);
  const reenabled = session(await signIn('staff-editor', replacementPassword));
  assert.equal((await request('/api/staff/sign-out', { method: 'POST', cookie: reenabled })).status, 200);
  assert.equal((await request(dashboard, { cookie: reenabled })).status, 401);
  assert.equal((await request(dashboard, { cookie: admin })).status, 200);
  const adminToken = admin.split('=')[1];
  const persisted = database.prepare('SELECT token,expires FROM staff_sessions WHERE username=?').get('admin');
  assert.equal(persisted.token, digest(adminToken));
  assert.ok(persisted.expires > Date.now());
  t.mock.timers.setTime(persisted.expires + 1);
  assert.equal((await request(dashboard, { cookie: admin })).status, 401);
  assert.equal(outbound.mock.callCount(), 0);
});

test('local staff throttling, guest sessions and Firebase rollback remain isolated', async t => {
  const { database, env, outbound, request, signIn } = await fixture(t);
  const token = 'b'.repeat(43);
  const expiry = Date.now() + 60_000;
  database.prepare('INSERT INTO shares (id, token, salt, verifier, expires) VALUES (?, ?, ?, ?, ?)')
    .run('guest-share', 'guest-token', 'guest-salt', 'guest-verifier', expiry);
  database.prepare('INSERT INTO sessions (token, expires, share, revision) VALUES (?, ?, ?, ?)')
    .run(digest(token), expiry, 'guest-share', 1);
  const guest = 'kv_guest=' + token;
  assert.equal((await request('/api/guest/catalog', { cookie: guest })).status, 200);
  assert.equal((await request('/api/staff/dashboard', { cookie: guest })).status, 401);
  assert.equal((await request('/api/staff/accounts', { cookie: guest })).status, 401);

  const firebaseToken = 'c'.repeat(43);
  database.prepare('INSERT INTO firebase_staff_accounts (username, firebase_uid, email, role) VALUES (?, ?, ?, ?)')
    .run('firebase-admin', 'fixture-uid', 'fixture@example.test', 'administrator');
  database.prepare('INSERT INTO firebase_staff_sessions (token, username, revision, expires) VALUES (?, ?, ?, ?)')
    .run(digest(firebaseToken), 'firebase-admin', 1, expiry);
  env.FIREBASE_PROJECT_ID = 'rollback-test';
  env.FIREBASE_AUTH_API_KEY = 'unused-test-key';
  const firebase = 'kv_firebase_staff=' + firebaseToken;
  assert.equal((await request('/api/staff/accounts', { cookie: firebase })).status, 401);
  env.STAFF_AUTH_MODE = 'firebase';
  assert.equal((await request('/api/staff/accounts', { cookie: firebase })).status, 200);
  env.STAFF_AUTH_MODE = 'password';

  for (let attempt = 0; attempt <= 8; attempt++) {
    const response = await signIn('missing-' + attempt, editorPassword, {
      ip: 'shared-source', forwardedClient: 'spoofed-source-' + attempt
    });
    assert.equal(response.status, attempt < 8 ? 401 : 429);
  }
  for (let attempt = 0; attempt <= 8; attempt++) {
    const response = await signIn('missing-user', editorPassword, { ip: 'source-' + attempt });
    assert.equal(response.status, attempt < 8 ? 401 : 429);
  }
  const minute = Math.floor(Date.now() / 60000);
  const globalBucket = minute + ':' + digest('password-staff-global:all');
  database.prepare('UPDATE attempts SET count=32 WHERE bucket=?').run(globalBucket);
  const before = database.prepare('SELECT COUNT(*) AS count FROM attempts').get().count;
  assert.equal((await signIn('new-name', editorPassword, { ip: 'new-ip' })).status, 429);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM attempts').get().count, before);
  assert.equal(outbound.mock.callCount(), 0);
});
