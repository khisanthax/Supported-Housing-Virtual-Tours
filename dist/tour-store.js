const NAME = 'supported-housing-tour-editor';
let database;

function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Browser storage is unavailable.')); return; }
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other editor tabs and retry.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
  }).catch(error => { database = undefined; throw error; });
  return database;
}

export async function loadDraft() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts').objectStore('drafts').get('current');
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDraft(draft, expectedRevision) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite');
    const store = transaction.objectStore('drafts');
    const current = store.get('current');
    let conflict = false;
    const revision = expectedRevision + 1;
    current.onsuccess = () => {
      if ((current.result?.revision ?? 0) !== expectedRevision) {
        conflict = true;
        transaction.abort();
        return;
      }
      store.put({ ...draft, revision }, 'current');
    };
    transaction.oncomplete = () => resolve(revision);
    transaction.onabort = () => reject(conflict
      ? new Error('The draft changed in another tab. Reload this page before editing again.')
      : transaction.error ?? new Error('The browser could not save this draft.'));
  });
}
