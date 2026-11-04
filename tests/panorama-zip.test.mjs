import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { extractPanoramas } from '../cloudflare/panorama-zip.js';

function archive(path, bytes, declaredSize=bytes.length) {
  const name=Buffer.from(path);
  const compressed=deflateRawSync(bytes);
  const local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(8,8);
  local.writeUInt16LE(name.length,26);
  const entry=Buffer.concat([local,name,compressed]);
  const central=Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(8,10);
  central.writeUInt32LE(crc32(bytes),16);
  central.writeUInt32LE(compressed.length,20);
  central.writeUInt32LE(declaredSize,24);
  central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1,8);
  end.writeUInt16LE(1,10);
  end.writeUInt32LE(central.length+name.length,12);
  end.writeUInt32LE(entry.length,16);
  return new Blob([entry,central,name,end]);
}

test('ZIP extraction returns the exact original bytes and rejects unsafe entries before upload',async()=>{
  const bytes=Buffer.from('bytes to validate independently as JPEG');
  const [image]=await extractPanoramas(archive('room/Living Room.jpg',bytes));
  assert.equal(image.name,'Living Room.jpg');
  assert.deepEqual(Buffer.from(await image.file.arrayBuffer()),bytes);
  await assert.rejects(extractPanoramas(archive('../photo.jpg',bytes)),/unsafe/);
  await assert.rejects(extractPanoramas(archive('nested.zip',bytes)),/Nested/);
  await assert.rejects(extractPanoramas(archive('living.jpg',bytes,8)),/declared image size/);
  await assert.rejects(extractPanoramas(archive('living.jpg',bytes,49*1024*1024)),/safety limits/);
});
