import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare/worker.mjs';
import { generateKeyPairSync, sign } from 'node:crypto';

test('individual accounts enforce roles, reset and disable immediately, and expire sessions', async t => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(await readFile(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8'));
    const d1 = {
      withSession: () => d1,
      prepare(sql) {
        return { bind: (...args) => ({
          first: async () => database.prepare(sql).get(...args),
          all: async () => ({ results: database.prepare(sql).all(...args) }),
          run: async () => ({ meta: database.prepare(sql).run(...args) })
        }) };
      },
      async batch(statements) {
        database.exec('BEGIN');
        try {
          const result = await Promise.all(statements.map(statement => statement.run()));
          database.exec('COMMIT');
          return result;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      }
    };
    const env = { DB: d1, LOCAL_SYNTHETIC_ONLY: '1', STAFF_ACCOUNTS: '1', FIREBASE_PROJECT_ID: 'demo-housing-test', FIREBASE_AUTH_API_KEY: 'test-key', GUEST_CODE_KEY: 'a'.repeat(64) };
    const origin = 'http://localhost';
    const password = 'Local synthetic fixture password';
    const newPassword = 'Replacement synthetic fixture password';
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture-key' };
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const passwords = new Map([['admin@example.test', password], ['editor@example.test', password]]);
    let resetEmail, badSignature = false;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (url.startsWith('https://www.googleapis.com/')) return Response.json({ keys: [key] });
      const input = JSON.parse(options.body);
      if (url.includes('accounts:sendOobCode')) {
        resetEmail = input.email;
        return Response.json({});
      }
      assert.match(url, /accounts:signInWithPassword/);
      if (passwords.get(input.email) !== input.password) return Response.json({}, { status: 400 });
      const now = Math.floor(Date.now() / 1000);
      const head = encode({ alg: 'RS256', kid: key.kid });
      const body = encode({ aud: env.FIREBASE_PROJECT_ID, iss: 'https://securetoken.google.com/' + env.FIREBASE_PROJECT_ID,
        sub: input.email.split('@')[0], exp: now + 3600, iat: now, auth_time: now, firebase: { sign_in_provider: 'password' } });
      const content = head + '.' + body;
      const signature = sign('sha256', Buffer.from(badSignature ? content + 'tampered' : content), privateKey);
      return Response.json({ idToken: content + '.' + signature.toString('base64url') });
    });
    database.exec("INSERT INTO firebase_staff_accounts(username,firebase_uid,email,role) VALUES('admin','admin','admin@example.test','administrator')");
    const request = (path, { method = 'GET', cookie = '', body, ip = 'test' } = {}) =>
      worker.fetch(new Request(origin + '/api/staff/' + path, {
        method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: body === undefined ? undefined : JSON.stringify(body)
      }), env);
    const signIn = (username, value = password, ip = username) => request('sign-in', {
      method: 'POST', body: { username, password: value }, ip
    });
    const session = response => response.headers.get('Set-Cookie').split(';')[0];
    assert.equal((await request('accounts')).status, 401);
    assert.equal((await signIn('admin', 'Invalid synthetic password')).status, 401);
    badSignature = true;
    assert.equal((await signIn('admin')).status, 401);
    badSignature = false;
    const admin = session(await signIn('ADMIN'));
    const independentAdmin = session(await signIn('admin'));
    assert.notEqual(admin, independentAdmin);
    const accountList = await request('accounts', { cookie: admin });
    assert.equal(accountList.status, 200);
    assert.doesNotMatch(await accountList.text(), /example.test/);
    assert.equal((await request('dashboard', { cookie: admin.slice(0,-4)+'AAAA' })).status, 401);
    assert.equal((await request('accounts', { cookie: 'kv_guest='+'a'.repeat(43) })).status, 401);
    assert.equal((await request('accounts', {
      cookie: admin, method: 'POST', body: { username: 'editor', firebaseUid: 'editor', email: 'editor@example.test', role: 'editor' }
    })).status, 201);
    let editor = session(await signIn('editor'));
    assert.equal((await request('dashboard', { cookie: editor })).status, 200);
    assert.equal((await request('accounts', { cookie: editor })).status, 403);
    const crossOrigin = await worker.fetch(new Request(origin + '/api/staff/accounts', {
      method: 'PATCH', headers: { Cookie: admin, Origin: 'https://example.test' }
    }), env);
    assert.equal(crossOrigin.status, 403);
    const change = (action, extra) => request('accounts', {
      cookie: admin, method: 'PATCH', body: { username: 'editor', action, ...extra }
    });
    assert.equal((await change('reset')).status, 200);
    assert.equal(resetEmail, 'editor@example.test');
    passwords.set(resetEmail, newPassword);
    assert.equal((await request('dashboard', { cookie: editor })).status, 401);
    assert.equal((await signIn('editor')).status, 401);
    editor = session(await signIn('editor', newPassword));
    assert.equal((await change('disable')).status, 200);
    assert.equal((await request('dashboard', { cookie: editor })).status, 401);
    assert.equal((await signIn('editor', newPassword)).status, 401);
    assert.equal((await change('enable')).status, 200);
    editor = session(await signIn('editor', newPassword));
    assert.equal((await request('sign-out', { cookie: editor, method: 'POST' })).status, 200);
    assert.equal((await request('dashboard', { cookie: editor })).status, 401);
    assert.equal((await request('dashboard', { cookie: independentAdmin })).status, 200);
    database.prepare('UPDATE firebase_staff_sessions SET expires=0').run();
    assert.equal((await request('dashboard', { cookie: admin })).status, 401);
    for (let attempt = 0; attempt < 8; attempt++) assert.equal((await signIn('missing', '', 'rate')).status, 401);
    assert.equal((await signIn('missing', '', 'rate')).status, 429);
  } finally {
    database.close();
  }
});
