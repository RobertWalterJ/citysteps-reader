// IndexedDB storage (DECISIONS.md D4).
//
// Every app on robertwalterj.github.io shares one origin, so the database
// name carries the csreader- prefix. The service worker opens the same
// database to drop shared PDFs into `inbox`, so SCHEMA below is repeated in
// sw.js; build/verify.mjs fails if the two drift apart.

export const DB_NAME = 'csreader-v1';
export const DB_VERSION = 2;
const SCHEMA = { docs: 'id', parsed: 'id', files: 'id', inbox: 'id', kv: 'k', notes: 'id', recordings: 'id', chunks: 'id' };

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, key] of Object.entries(SCHEMA)) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: key });
    };
    req.onsuccess = () => {
      // A newer copy of the app (another tab, or after an update) needs the
      // database at a higher version: let go so it is not blocked.
      req.result.onversionchange = () => { req.result.close(); dbp = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The database is open in an older copy of the app. Close other tabs and try again.'));
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((r) => { out = r; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage write was cancelled'));
  });
}
const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const get = (store, key) => tx(store, 'readonly', (s) => req2p(s.get(key)));
export const put = (store, value) => tx(store, 'readwrite', (s) => req2p(s.put(value)));
export const del = (store, key) => tx(store, 'readwrite', (s) => req2p(s.delete(key)));
export const all = (store) => tx(store, 'readonly', (s) => req2p(s.getAll()));

export async function kvGet(k, fallback = null) {
  try { const r = await get('kv', k); return r ? r.v : fallback; } catch { return fallback; }
}
export async function kvSet(k, v) {
  try { await put('kv', { k, v }); } catch { /* storage blocked: the app still works for this session */ }
}

// Ask the browser not to evict our data. Chrome grants this silently to
// installed apps; it never prompts.
export async function persist() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}
