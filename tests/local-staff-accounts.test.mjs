import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker, { StaffLogin } from '../cloudflare/worker.mjs';
import { hashStaffPassword } from '../cloudflare/staff-password.mjs';

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
    STAFF_ACCOUNTS: '1', STAFF_AUTH_MODE: 'password'
  };
  const delegated = [];
  const actors = new Map();
  const binding = { getByName(name) {
    if (!actors.has(name)) actors.set(name, new StaffLogin(null, env));
    return { fetch(request) {
      delegated.push(`${request.method} ${new URL(request.url).pathname}`);
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
  return { database, env, binding, outbound, delegated, request, signIn };
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

test('local staff accounts use private password operations and revoke sessions on reset, disable, expiry and logout', async t => {
  const { database, env, binding, outbound, delegated, request, signIn } = await fixture(t);
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
  assert.equal((await create(admin, 'staff-editor', 'too short')).status, 400);
  assert.equal((await create(admin)).status, 201);
  assert.equal(delegated.at(-1), 'POST /api/staff/accounts');
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
  assert.equal((await change(admin, 'disable')).status, 200);
  assert.equal((await request(dashboard, { cookie: replacement })).status, 401);
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
