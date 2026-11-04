import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  hashStaffPassword, normalizeUsername, usernamePattern, validNewStaffPassword, verifyStaffPassword
} from '../cloudflare/staff-password.mjs';

const password = 'Synthetic staff password 🌲';

test('local staff password policy counts Unicode code points and caps UTF-8 bytes', () => {
  assert.equal(normalizeUsername('  Ada.L  '), 'ada.l');
  assert.equal(normalizeUsername(null), '');
  assert.equal(usernamePattern.test('ada.l'), true);
  assert.equal(usernamePattern.test('a b'), false);
  assert.equal(validNewStaffPassword('x'.repeat(14)), false);
  assert.equal(validNewStaffPassword('🌲'.repeat(14)), false);
  assert.equal(validNewStaffPassword('🌲'.repeat(15)), true);
  assert.equal(validNewStaffPassword('🌲'.repeat(64)), true);
  assert.equal(validNewStaffPassword('🌲'.repeat(65)), false);
  assert.equal(validNewStaffPassword('x'.repeat(14) + '\ud800'), false);
  assert.throws(() => hashStaffPassword('too short'), /15 characters/);
});

test('staff password records are salted and reject incorrect, absent and corrupt verifiers', () => {
  const verifier = hashStaffPassword(password);
  const [version, salt, digest] = verifier.split('$');
  assert.equal(version, 'scrypt-v1');
  assert.equal(Buffer.from(salt, 'base64url').length, 16);
  assert.equal(Buffer.from(digest, 'base64url').length, 32);
  assert.notEqual(hashStaffPassword(password).split('$')[1], salt);
  assert.equal(verifyStaffPassword(password, verifier), true);
  assert.equal(verifyStaffPassword('Different synthetic password', verifier), false);
  assert.equal(verifyStaffPassword(password, null), false);
  assert.equal(verifyStaffPassword(password, verifier.replace('v1', 'v2')), false);
  assert.equal(verifyStaffPassword(password, verifier.slice(0, -1) + 'B'), false);
});

test('password bootstrap reads stdin and only inserts an administrator into an empty staff table', () => {
  const script = fileURLToPath(new URL('../cloudflare/bootstrap-password-admin.mjs', import.meta.url));
  const bootstrap = spawnSync(process.execPath, [script, 'Ada.L'], {
    encoding: 'utf8',
    input: password + '\r\n'
  });
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  assert.equal(bootstrap.stdout.includes(password), false);

  const database = new DatabaseSync(':memory:');
  try {
    database.exec('CREATE TABLE staff_accounts (username TEXT PRIMARY KEY, password_verifier TEXT, role TEXT)');
    database.exec(bootstrap.stdout);
    const account = database.prepare('SELECT * FROM staff_accounts').get();
    assert.equal(account.username, 'ada.l');
    assert.equal(account.role, 'administrator');
    assert.equal(verifyStaffPassword(password, account.password_verifier), true);

    database.exec(bootstrap.stdout.replace("'ada.l'", "'another'"));
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM staff_accounts').get().count, 1);
  } finally {
    database.close();
  }
});
