// What CitySteps Reader keeps on the phone, and clearing the big things.
//
// Every app on robertwalterj.github.io shares one origin, so shared stores
// are never wiped whole: Whisper's cache ("transformers-cache") may also hold
// Hok Gong's models, so only this app's model files are deleted from it; the
// same goes for Tesseract's data and the Piper voices folder.

import * as db from './db.js';

const WHISPER = 'whisper-base.en';
const TESS_KEY = /eng\.traineddata/;

async function blobTotal(store) {
  let bytes = 0, count = 0;
  for (const r of await db.all(store)) { bytes += r.blob?.size || 0; count++; }
  return { bytes, count };
}

async function dirSize(dir) {
  let bytes = 0;
  for await (const [, h] of dir.entries()) {
    if (h.kind === 'file') bytes += (await h.getFile()).size;
    else bytes += await dirSize(h);
  }
  return bytes;
}

async function piperInfo() {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('piper').catch(() => null);
    const bytes = dir ? await dirSize(dir) : 0;
    const { stored } = await import('@mintplex-labs/piper-tts-web');
    return { bytes, voices: await stored().catch(() => []) };
  } catch { return { bytes: 0, voices: [] }; }
}

async function whisperInfo() {
  try {
    if (!(await caches.has('transformers-cache'))) return { bytes: 0, count: 0 };
    const c = await caches.open('transformers-cache');
    let bytes = 0, count = 0;
    for (const req of await c.keys()) {
      if (!req.url.includes(WHISPER)) continue;
      const res = await c.match(req);
      bytes += +(res?.headers.get('content-length') || 0) || (await res.blob()).size;
      count++;
    }
    return { bytes, count };
  } catch { return { bytes: 0, count: 0 }; }
}

function tessDb() {
  return new Promise((resolve) => {
    const req = indexedDB.open('keyval-store');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onupgradeneeded = () => { req.transaction.abort(); resolve(null); };
  });
}
async function tessInfo() {
  const d = await tessDb();
  if (!d || !d.objectStoreNames.contains('keyval')) { d?.close(); return { bytes: 0, keys: [] }; }
  return new Promise((resolve) => {
    const t = d.transaction('keyval'), s = t.objectStore('keyval');
    const keys = [], out = { bytes: 0, keys };
    s.openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return;
      if (TESS_KEY.test(String(cur.key))) { keys.push(cur.key); const v = cur.value; out.bytes += v?.byteLength ?? v?.length ?? v?.size ?? 0; }
      cur.continue();
    };
    t.oncomplete = () => { d.close(); resolve(out); };
    t.onerror = () => { d.close(); resolve(out); };
  });
}

export async function report() {
  const [files, renders, recordings, piper, whisper, tess, est, persisted] = await Promise.all([
    blobTotal('files'), blobTotal('renders'), blobTotal('recordings'), piperInfo(), whisperInfo(), tessInfo(),
    navigator.storage?.estimate?.().catch(() => null), navigator.storage?.persisted?.().catch(() => false),
  ]);
  return {
    rows: [
      { key: 'files', label: 'PDFs', detail: `${files.count} document${files.count === 1 ? '' : 's'}`, bytes: files.bytes, clear: null },
      { key: 'renders', label: 'Screen-off audio', detail: `${renders.count} prepared`, bytes: renders.bytes, clear: renders.count ? 'Remove all prepared audio' : null },
      { key: 'recordings', label: 'Voice note recordings', detail: `${recordings.count} recording${recordings.count === 1 ? '' : 's'}`, bytes: recordings.bytes, clear: null },
      { key: 'piper', label: 'Natural voices', detail: piper.voices.length ? piper.voices.map((v) => v.split('-')[1]).join(', ') : 'none downloaded', bytes: piper.bytes, clear: piper.voices.length ? 'Remove downloaded voices' : null, voices: piper.voices },
      { key: 'whisper', label: 'Transcription model', detail: whisper.count ? 'Whisper base' : 'not downloaded', bytes: whisper.bytes, clear: whisper.count ? 'Remove (downloads again when needed)' : null },
      { key: 'tess', label: 'Text recognition data', detail: tess.keys.length ? 'English' : 'not downloaded', bytes: tess.bytes, clear: tess.keys.length ? 'Remove (downloads again when needed)' : null, keys: tess.keys },
    ],
    usage: est?.usage || 0, quota: est?.quota || 0, persisted,
  };
}

export async function clear(key, row) {
  if (key === 'renders') { for (const r of await db.all('renders')) await db.del('renders', r.id); }
  if (key === 'piper') {
    const { remove } = await import('@mintplex-labs/piper-tts-web');
    for (const v of row.voices || []) await remove(v).catch(() => {});
  }
  if (key === 'whisper') {
    const c = await caches.open('transformers-cache');
    for (const req of await c.keys()) if (req.url.includes(WHISPER)) await c.delete(req);
  }
  if (key === 'tess') {
    const d = await tessDb();
    if (d) await new Promise((resolve) => { const t = d.transaction('keyval', 'readwrite'); for (const k of row.keys || []) t.objectStore('keyval').delete(k); t.oncomplete = t.onerror = () => { d.close(); resolve(); }; });
  }
}

export const mb = (n) => (n >= 1e9 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(n > 1e8 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
