// Everything lives in IndexedDB on this device: receipts (with a compressed photo) and settings.
const NAME = 'shoebox', VERSION = 1;
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
const run = async (store, mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export const allItems = () => run('items', 'readonly', (s) => s.getAll());
export const putItem = (item) => run('items', 'readwrite', (s) => s.put(item));
export const deleteItem = (id) => run('items', 'readwrite', (s) => s.delete(id));
export const clearItems = () => run('items', 'readwrite', (s) => s.clear());
export const getMeta = (k) => run('meta', 'readonly', (s) => s.get(k));
export const setMeta = (k, v) => run('meta', 'readwrite', (s) => s.put(v, k));

export const blobToDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
export const dataURLToBlob = async (url) => (await fetch(url)).blob();
