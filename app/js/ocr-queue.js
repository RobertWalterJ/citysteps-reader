// Reading scanned pages in the background, one document at a time.
//
// Starts on its own after a PDF with scanned pages is added, and carries on
// at the next start if the app was closed part way: each page's result is
// saved as soon as it is read (kv 'ocr:<doc id>'), so no page is read twice.
// When a document's scanned pages are all read, it is re-parsed with the new
// text, and anything open on it is told to refresh.

import * as db from './db.js';
import { reparse } from './importer.js';

const status = new Map();          // doc id -> { done, total }
const listeners = new Set();
export const onOcrStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (id, s) => { if (s) status.set(id, s); else status.delete(id); for (const fn of listeners) fn(id, s); };
export const ocrStatus = (id) => status.get(id) || null;

let chain = Promise.resolve();
const queued = new Set();

export function queueOcr(doc) {
  const pages = doc.parse?.scanPages || [];
  if (!pages.length || queued.has(doc.id)) return;
  queued.add(doc.id);
  // A failure is shown in the library row, not swallowed: the first version
  // hid a broken import and sat at "0 of 1" forever.
  chain = chain.then(() => run(doc.id)).catch((err) => {
    console.warn('Text recognition failed', err);
    emit(doc.id, { state: 'failed', error: err?.message || String(err) });
  }).finally(() => queued.delete(doc.id));
}

async function run(id) {
  const doc = await db.get('docs', id);
  const file = await db.get('files', id);
  if (!doc || !file) return;
  const rec = (await db.kvGet('ocr:' + id, null)) || { pages: {} };
  const todo = (doc.parse?.scanPages || []).filter((n) => !rec.pages[n]);
  if (!todo.length) return;
  const total = (doc.parse.scanPages || []).length;
  let done = total - todo.length;
  emit(id, { done, total, state: 'reading' });
  const { ocrPages } = await import('./ocr.js');
  await ocrPages(file.blob, todo, {
    done: rec.pages,
    onStatus: (s) => { if (s.state === 'loading') emit(id, { done, total, state: 'loading' }); },
    onPage: async (n, result) => {
      rec.pages[n] = result;
      await db.kvSet('ocr:' + id, rec);
      done++;
      emit(id, { done, total, state: 'reading' });
    },
  });
  emit(id, { done, total, state: 'finishing' });
  const fresh = await db.get('docs', id);
  if (fresh) await reparse(fresh);
  emit(id, null);
  for (const fn of listeners) fn(id, { state: 'done' });
}

// At start-up: pick up anything left unread.
export async function resumeOcr() {
  for (const d of await db.all('docs')) if (d.parse?.status === 'ready' && d.parse.scanPages?.length) queueOcr(d);
}
