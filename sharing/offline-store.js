const NAME = 'housing-staff-offline-v1';
const encode = new TextEncoder();
const decode = new TextDecoder();
const random = length => crypto.getRandomValues(new Uint8Array(length));
let opening;
function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vault');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  return opening;
}
export async function storage(operation, ...args) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('vault', ['get','getAll'].includes(operation) ? 'readonly' : 'readwrite');
    const request = tx.objectStore('vault')[operation](...args);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error('Offline storage transaction failed.'));
  });
}
export async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', encode.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:600000, hash:'SHA-256'}, material,
    {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
export async function seal(key, bytes, label) {
  const iv = random(12);
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:encode.encode(label)}, key, bytes);
  return {iv, ciphertext:new Blob([ciphertext])};
}
export async function unseal(key, record, label) {
  return crypto.subtle.decrypt({name:'AES-GCM', iv:record.iv, additionalData:encode.encode(label)}, key, await record.ciphertext.arrayBuffer());
}
export const sealJSON = (key, value, label) => seal(key, encode.encode(JSON.stringify(value)), label);
export const unsealJSON = async (key, record, label) => JSON.parse(decode.decode(await unseal(key,record,label)));
export async function openVault(passphrase, create) {
  const existing = await storage('get','settings');
  if (!existing && !create) throw new Error('Sign in online to set up offline downloads.');
  const salt = existing?.salt || random(16);
  const key = await deriveKey(passphrase,salt);
  if (existing) {
    try { await unsealJSON(key,existing.check,'vault-check'); }
    catch { throw new Error('Incorrect device passphrase or damaged storage.'); }
  } else {
    await storage('add',{salt,check:await sealJSON(key,true,'vault-check')},'settings');
  }
  return key;
}
export const labelFor = record => JSON.stringify([record.id,record.revision,record.expires]);
