import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey, labelFor, sealJSON, unsealJSON } from '../sharing/offline-store.js';

test('offline content requires the passphrase and authenticates the apartment revision and expiry', async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey('Synthetic offline vault passphrase',salt);
  const wrongKey = await deriveKey('Different offline vault passphrase',salt);
  const record = {id:'synthetic',revision:'version-1',expires:Date.now()+60_000};
  const manifest = {title:'Synthetic apartment'};
  const encrypted = await sealJSON(key,manifest,labelFor(record));
  assert.deepEqual(await unsealJSON(key,encrypted,labelFor(record)),manifest);
  await assert.rejects(unsealJSON(wrongKey,encrypted,labelFor(record)));
  await assert.rejects(unsealJSON(key,encrypted,labelFor({...record,expires:record.expires+60_000})));
  await assert.rejects(unsealJSON(key,encrypted,labelFor({...record,revision:'version-2'})));
});
