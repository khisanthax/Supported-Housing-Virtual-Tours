import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { generatePhrase, guestCodeVerifier, normalizePhrase, tourAsset } from '../cloudflare/worker.mjs';
import words from '../cloudflare/phrase-words.mjs';

test('guest phrases use the full distinct word list and normalize human input', () => {
  assert.equal(new Set(words).size,2048);
  assert.equal(new Set(words.map(word=>word.slice(0,4))).size,2048);
  assert.equal(normalizePhrase(' Purple  RIVER-Lantern '),'purple-river-lantern');
  for (const count of [3,5,7]) {
    const phrases=Array.from({length:100},()=>generatePhrase(count));
    assert.ok(new Set(phrases).size>95);
    for (const phrase of phrases) {
      assert.equal(phrase.split('-').length,count);
      assert.ok(phrase.split('-').every(word=>words.includes(word)));
    }
  }
  assert.throws(()=>generatePhrase(4));
});

test('a guest verifier binds the code to both the share and a server secret', () => {
  const key='a'.repeat(64), code='example-code';
  const verifier=guestCodeVerifier(key,'share','salt',code);
  assert.match(verifier,/^hmac-v1:[a-f0-9]{64}$/);
  assert.equal(guestCodeVerifier(key,'share','salt',code),verifier);
  assert.notEqual(guestCodeVerifier(key,'other','salt',code),verifier);
  assert.notEqual(guestCodeVerifier('b'.repeat(64),'share','salt',code),verifier);
  assert.notEqual(guestCodeVerifier(key,'share','salt',code+'x'),verifier);
});

test('KV byte cap counts pending reservations and rejects an upload before storage is touched', async () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(await readFile(new URL('../cloudflare/schema.sql',import.meta.url),'utf8'));
    db.prepare('INSERT INTO photos(id,bytes) VALUES (?,?)').run('pending',399999999);
    assert.throws(()=>db.prepare('INSERT INTO photos(id,bytes) VALUES (?,?)').run('would-overflow',2),/photo budget exceeded/);
    db.prepare('INSERT INTO photos(id,bytes) VALUES (?,?)').run('fits',1);
    assert.equal(db.prepare('SELECT SUM(bytes) AS total FROM photos').get().total,400000000);
  } finally { db.close(); }
});

test('a KV propagation miss produces a private retry response with no stale photo substitution', async () => {
  const response=await tourAsset({photos:'{"living":"new-version-key"}'},'living',{
    PHOTOS:{async get(key){ assert.equal(key,'new-version-key'); return null; }}
  });
  assert.equal(response.status,503);
  assert.equal(response.headers.get('Retry-After'),'30');
  assert.match(response.headers.get('Cache-Control'),/no-store/);
});
