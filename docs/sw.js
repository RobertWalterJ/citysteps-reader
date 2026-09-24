// CitySteps Reader: service worker.
//
// This origin (robertwalterj.github.io) is shared with Hok Gong, Landfall,
// Coilover and the rest, so CacheStorage is SHARED: never use the global
// caches.match(), and never delete a cache that is not ours.
//
// Three jobs:
// 1. Offline: the app shell is cached, network first so a new deploy arrives
//    on the next open with signal.
// 2. The Android share sheet: a shared PDF is POSTed to ./share-target. It is
//    parked in IndexedDB (`inbox`) and the app picks it up on load.
// 3. Cross-origin isolation: GitHub Pages cannot send COOP/COEP headers, and
//    without them the on-device voice and transcription models run on one CPU
//    thread. The worker adds the headers to the pages it serves.

const VERSION = "csreader-v1-87153b6-202609240659";   // stamped per deploy by build/build.mjs
const PREFIX = 'csreader-';
const PRECACHE = ['./', 'index.html', 'css/app.css', 'fonts/fonts.css', 'js/main.js', 'js/parse-worker.js', 'manifest.webmanifest', 'icons/icon-192.png'];

// Must match app/js/db.js (build/verify.mjs checks).
const DB_NAME = 'csreader-v1';
const DB_VERSION = 1;
const SCHEMA = { docs: 'id', parsed: 'id', files: 'id', inbox: 'id', kv: 'k' };

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== VERSION && !k.startsWith(PREFIX + 'models')) await caches.delete(k);
    await self.clients.claim();
  })());
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const [name, key] of Object.entries(SCHEMA)) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: key });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('pdf').filter((f) => f && typeof f !== 'string');
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const t = db.transaction('inbox', 'readwrite');
      for (const f of files) t.objectStore('inbox').put({ id: Date.now() + '-' + Math.random().toString(36).slice(2), name: f.name, blob: f });
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage('inbox');
  } catch { /* the app shows its library; nothing was lost that was not already lost */ }
  return Response.redirect('./?shared=1', 303);
}

function isolate(res) {
  if (!res || res.type === 'opaque' || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  if (req.method === 'POST' && url.pathname === scope + 'share-target') { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET') return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return isolate(res);
    } catch {
      const hit = (await c.match(req, { ignoreSearch: req.mode === 'navigate' })) || (req.mode === 'navigate' ? await c.match('index.html') : null);
      return hit ? isolate(hit) : Response.error();
    }
  })());
});
