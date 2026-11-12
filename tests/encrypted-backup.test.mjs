import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pbkdf2Sync, createDecipheriv } from 'node:crypto';
import { encryptBackup, decryptBackup, isEncryptedBackup, ITERATIONS } from '../dist/encrypted-backup.js';
import { packTour, unpackTour } from '../dist/tour-package.js';
import { zipSync, unzipSync } from '../dist/vendor/backup-crypto.js';
const password = 'Synthetic backup test password only';
async function fixture(title) {
  const tour = JSON.parse(await readFile(new URL('../cloudflare/sample.json',import.meta.url)));
  tour.title = title;
  const images = new Map(await Promise.all(tour.rooms.map(async r => [r.id,new Blob([await readFile(new URL('../cloudflare/sample-images/'+r.image.split('/').at(-1),import.meta.url))],{type:'image/jpeg'})])));
  return {tour,images};
}
test('encrypted ZIP round-trips multiple apartments, exact metadata and every original JPEG; legacy remains readable', async () => {
  assert.equal(ITERATIONS,600000);
  for (const title of ['Synthetic encrypted Maple','Synthetic encrypted Cedar']) {
    const draft=await fixture(title), archive=await encryptBackup(draft,password);
    assert.ok(await isEncryptedBackup(archive));
    const contents=unzipSync(new Uint8Array(await archive.arrayBuffer()));
    assert.deepEqual(Object.keys(contents).sort(),['apartment.bin','encryption.json']);
    // Independently verify interoperability and exact KDF/AES parameters with Node/OpenSSL.
    const info=JSON.parse(new TextDecoder().decode(contents['encryption.json']));
    const key=pbkdf2Sync(password,Buffer.from(info.salt,'hex'),600000,32,'sha256');
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(info.nonce,'hex'));
    decipher.setAAD(contents['encryption.json']);decipher.setAuthTag(contents['apartment.bin'].subarray(-16));
    const plain=Buffer.concat([decipher.update(contents['apartment.bin'].subarray(0,-16)),decipher.final()]);
    assert.deepEqual(plain,Buffer.from(await packTour(draft).arrayBuffer()));key.fill(0);plain.fill(0);
    assert.ok(!new TextDecoder().decode(contents['encryption.json']).includes(title));
    const restored=await decryptBackup(archive,password);
    assert.deepEqual(restored.tour,draft.tour);
    for(const [id,blob] of draft.images)assert.deepEqual(await restored.images.get(id).arrayBuffer(),await blob.arrayBuffer());
    const legacy=packTour(draft);assert.equal(await isEncryptedBackup(legacy),false);assert.deepEqual((await unpackTour(legacy)).tour,draft.tour);
    assert.notDeepEqual(await archive.arrayBuffer(),await(await encryptBackup(draft,password)).arrayBuffer(),'fresh salt and nonce');
  }
});
test('wrong passwords, authenticated data corruption and truncated ZIPs fail without a partial restore',async()=>{
  const draft=await fixture('Synthetic failure tests'), archive=await encryptBackup(draft,password);
  await assert.rejects(decryptBackup(archive,'Wrong synthetic password'),/Incorrect backup password/);
  const entries=unzipSync(new Uint8Array(await archive.arrayBuffer()));entries['apartment.bin'][20]^=1;
  await assert.rejects(decryptBackup(new Blob([zipSync(entries,{level:0})]),password),/Incorrect backup password/);
  await assert.rejects(decryptBackup(archive.slice(0,-50),password),/damaged|incomplete/);
  const meta=unzipSync(new Uint8Array(await archive.arrayBuffer()));meta['encryption.json'][meta['encryption.json'].length-3]^=1;
  await assert.rejects(decryptBackup(new Blob([zipSync(meta,{level:0})]),password),/metadata|Incorrect/);
  await assert.rejects(decryptBackup(new Blob([zipSync({'../apartment.bin':new Uint8Array(20)},{level:0})]),password),/damaged/);
  await assert.rejects(decryptBackup(new Blob([zipSync({'apartment.bin':new Uint8Array(2000)})]),password),/damaged/);
  const unsafe=unzipSync(new Uint8Array(await archive.arrayBuffer()));
  const config=JSON.parse(new TextDecoder().decode(unsafe['encryption.json']));config.iterations=999999999;
  unsafe['encryption.json']=new TextEncoder().encode(JSON.stringify(config));
  await assert.rejects(decryptBackup(new Blob([zipSync(unsafe,{level:0})]),password),/metadata/);
});
test('cancelled exports yield no file, KDF input is bounded and incomplete private drafts are preserved',async()=>{
  const draft=await fixture('Synthetic interrupted export'), controller=new AbortController();
  await assert.rejects(encryptBackup(draft,password,{signal:controller.signal,progress:()=>controller.abort()}),{name:'AbortError'});
  await assert.rejects(encryptBackup(draft,'short'),/at least 12/);
  await assert.rejects(encryptBackup(draft,'a'.repeat(1025)),/1024/);
  draft.tour.builder={version:1,unplaced:[],missing:[draft.tour.rooms[0].id]};draft.images.delete(draft.tour.rooms[0].id);
  const round=await decryptBackup(await encryptBackup(draft,password),password);assert.deepEqual(round.tour,draft.tour);assert.equal(round.images.size,draft.images.size);
});
