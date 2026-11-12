import { gcm, zipSync, unzipSync } from './vendor/backup-crypto.js';
import { packTour, unpackTour, MAX_TOTAL } from './tour-package.js';

const encode = new TextEncoder(), decode = new TextDecoder('utf-8', { fatal: true });
export const ITERATIONS = 600000;
const MAX_PAYLOAD = MAX_TOTAL + 128 * 1024 + 12 + 16;
const MAX_ARCHIVE = MAX_PAYLOAD + 4096;
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
function unhex(value, length) {
  if (typeof value !== 'string' || !new RegExp('^[0-9a-f]{'+length*2+'}$').test(value)) throw new Error('Invalid encryption metadata.');
  return Uint8Array.from(value.match(/../g), b => parseInt(b, 16));
}
function check(signal) { if (signal?.aborted) throw new DOMException('Backup operation cancelled.', 'AbortError'); }
function passwordBytes(password, creating) {
  if (typeof password !== 'string' || (creating && Array.from(password).length < 12) || !password || encode.encode(password).length > 1024) {
    throw new Error('Use a backup password of at least 12 characters and at most 1024 UTF-8 bytes.');
  }
  return encode.encode(password);
}
async function derive(password, salt, creating) {
  const bytes = passwordBytes(password, creating);
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material, 256));
  } finally { bytes.fill(0); }
}
export async function isEncryptedBackup(blob) {
  const bytes = new Uint8Array(await blob.slice(0,4).arrayBuffer());
  return bytes.length === 4 && bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4;
}
export async function encryptBackup(draft, password, { signal, progress = () => {} } = {}) {
  check(signal);
  const packed = packTour(draft); // Validate before creating an archive.
  const salt = crypto.getRandomValues(new Uint8Array(16)), nonce = crypto.getRandomValues(new Uint8Array(12));
  const metadata = encode.encode(JSON.stringify({ format: 'SHTOUR-ENCRYPTED', version: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: hex(salt), nonce: hex(nonce) }));
  let key, plaintext;
  try {
    progress('Deriving encryption key locally…');
    key = await derive(password, salt, true); check(signal);
    plaintext = new Uint8Array(await packed.arrayBuffer()); check(signal);
    progress('Encrypting complete backup locally…');
    const encrypted = await gcm(key, nonce, metadata).encrypt(plaintext); check(signal);
    const archive = zipSync({ 'encryption.json': metadata, 'apartment.bin': encrypted }, { level: 0, mtime: new Date(1980,0,1) });
    check(signal);
    return new Blob([archive], { type: 'application/zip' });
  } finally { key?.fill(0); plaintext?.fill(0); }
}
export async function decryptBackup(blob, password, { signal, progress = () => {} } = {}) {
  check(signal);
  if (blob.size < 100 || blob.size > MAX_ARCHIVE) throw new Error('The encrypted backup is incomplete or exceeds the backup size limit.');
  let entries;
  try {
    const seen = new Set();
    entries = unzipSync(new Uint8Array(await blob.arrayBuffer()), { filter: entry => {
      if (!['encryption.json','apartment.bin'].includes(entry.name) || seen.has(entry.name) || entry.compression !== 0 || entry.originalSize !== entry.size || entry.originalSize > (entry.name === 'encryption.json' ? 1024 : MAX_PAYLOAD)) throw new Error('Invalid ZIP entry.');
      seen.add(entry.name); return true;
    } });
    if (Object.keys(entries).length !== 2 || !entries['encryption.json'] || !entries['apartment.bin']) throw new Error('Missing backup file.');
  } catch { throw new Error('The encrypted ZIP is damaged, incomplete or unsupported.'); }
  const metadata = entries['encryption.json'];
  let info, salt, nonce;
  try {
    info = JSON.parse(decode.decode(metadata));
    if (info.format !== 'SHTOUR-ENCRYPTED' || info.version !== 1 || info.cipher !== 'AES-256-GCM' || info.kdf !== 'PBKDF2-SHA256' || info.iterations !== ITERATIONS) throw new Error();
    salt = unhex(info.salt,16); nonce = unhex(info.nonce,12);
  } catch { throw new Error('The backup encryption metadata is damaged or unsupported.'); }
  let key, plaintext;
  try {
    progress('Deriving decryption key locally…');
    key = await derive(password, salt, false); check(signal);
    progress('Authenticating and decrypting backup locally…');
    try { plaintext = await gcm(key, nonce, metadata).decrypt(entries['apartment.bin']); }
    catch { throw new Error('Incorrect backup password or damaged archive. Nothing has been imported.'); }
    check(signal);
    progress('Checking every room and photograph…');
    const restored = await unpackTour(new Blob([plaintext])); check(signal);
    return restored;
  } finally { key?.fill(0); plaintext?.fill(0); }
}
