// Getting a PDF in: store the file, parse it once, keep the result.
//
// A document's id is a hash of its bytes, so sharing the same PDF twice finds
// the copy already in the library instead of making a second one. A parse is
// redone only when the layout engine's version moves on.

import * as db from './db.js';
import { READ_BY_DEFAULT } from './parse/layout.js';

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./parse-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    if (e.data.progress != null) { p.onProgress?.(e.data.progress); return; }
    pending.delete(e.data.id);
    e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'The parser stopped unexpectedly'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function parse(buf, onProgress) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, buf }, []);   // copy, not transfer: the caller keeps its bytes
  });
}

async function hash(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d).slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Guess what kind of document this is; Robert can change it in Details.
// Academic signals are checked first: a paper that discusses "news reports"
// is still a paper (Phase 1: the Stark paper came out as News).
function guessType(r, name) {
  const k = {};
  for (const b of r.blocks) k[b.kind] = (k[b.kind] || 0) + 1;
  const text = r.blocks.slice(0, 30).map((b) => b.text).join(' ');
  if ((k.reference || 0) > 5 || k.abstract || /\bdoi\b|journal of|university press|keywords/i.test(text)) return 'academic';
  if (/globe and mail|toronto star|cbc news|national post|the guardian|new york times|spacing magazine|the narwhal/i.test(text + ' ' + name) && r.stats.pages <= 12) return 'news';
  if (/white paper/i.test(text + name)) return 'whitepaper';
  if (r.stats.pages >= 4 || /report|staff|council|committee|city of|town of|region of|ministry/i.test(text + ' ' + name)) return 'report';
  return 'other';
}

// The PDF's own Title field is often a file name ("Landmarks_2016_Journal_
// FinalFull"), so the main heading on page 1 wins when there is one.
function titleFrom(r, meta, name) {
  const p1 = r.blocks.filter((b) => b.page === 1 && b.kind === 'heading');
  const main = p1.find((b) => b.level === 1 && b.text.length >= 10 && b.text.length <= 160);
  const sane = meta.title && /\s/.test(meta.title) && !/_/.test(meta.title) && meta.title.split(/\s+/).length >= 2 ? meta.title : '';
  const any = p1.find((b) => b.text.length >= 10 && b.text.length <= 160);
  const fromName = name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const t = (main && main.text) || sane || (any && any.text) || fromName;
  return t.length > 140 ? t.slice(0, 137) + '...' : t;
}

// PDF metadata dates are when the file was made, not published, and its
// Author field is often whoever laid it out. Only a stated date is trusted.
function yearFrom(r) {
  const text = r.blocks.filter((b) => b.page <= 2).map((b) => b.text).join(' ');
  const m = /(published|©|copyright|issued?|dated?|posted)[^.\n]{0,40}?\b((?:19|20)\d{2})\b/i.exec(text);
  return m ? +m[2] : null;
}

export async function importFile(file, { onProgress, source = 'file' } = {}) {
  const buf = await file.arrayBuffer();
  const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 1024)));
  if (!head.includes('%PDF')) throw new Error(`${file.name || 'That file'} is not a PDF.`);
  const id = await hash(buf);
  const existing = await db.get('docs', id);
  if (existing && existing.parse?.status === 'ready') return { doc: existing, duplicate: true };

  await db.put('files', { id, blob: new Blob([buf], { type: 'application/pdf' }), name: file.name || 'shared.pdf' });
  const doc = existing || {
    id, title: (file.name || 'Shared PDF').replace(/\.pdf$/i, ''), authors: [], year: null, publisher: '', docType: 'other',
    source: { kind: source, name: file.name || '' }, pageCount: 0, tags: [],
    parse: { status: 'parsing', method: 'heuristic' }, progress: null, addedAt: Date.now(),
  };
  doc.parse = { status: 'parsing', method: 'heuristic' };
  await db.put('docs', doc);

  try {
    const r = await parse(buf, onProgress);
    return { doc: await saveParse(doc, r, file.name || '') };
  } catch (err) {
    doc.parse = { status: 'failed', error: err.message };
    await db.put('docs', doc);
    throw err;
  }
}

async function saveParse(doc, r, name) {
  await db.put('parsed', { id: doc.id, blocks: r.blocks, sections: r.sections, sizes: r.sizes, stats: r.stats, layoutVersion: r.layoutVersion });
  doc.pageCount = r.stats.pages;
  if (!doc.edited) {
    doc.title = titleFrom(r, r.meta, name);
    doc.authors = [];
    doc.year = yearFrom(r);
    doc.docType = guessType(r, name);
  }
  const scanOnly = r.stats.textPages === 0;
  doc.parse = {
    status: 'ready', method: scanOnly ? 'scan' : 'heuristic', version: r.layoutVersion,
    warnings: [
      ...(r.stats.scanPages.length ? [`${r.stats.scanPages.length} scanned page${r.stats.scanPages.length > 1 ? 's' : ''} with no text yet`] : []),
      ...(r.stats.tables ? [`${r.stats.tables} table${r.stats.tables > 1 ? 's' : ''} shown as cards`] : []),
    ],
    readable: r.blocks.filter((b) => READ_BY_DEFAULT.has(b.kind)).length,
  };
  await db.put('docs', doc);
  return doc;
}

// Re-parse a stored document (used when the layout engine improves).
export async function reparse(doc, onProgress) {
  const f = await db.get('files', doc.id);
  if (!f) throw new Error('The original PDF is no longer on this phone. Add it again.');
  const r = await parse(await f.blob.arrayBuffer(), onProgress);
  return saveParse(doc, r, f.name);
}

export async function removeDoc(id) {
  await db.del('docs', id);
  await db.del('parsed', id);
  await db.del('files', id);
}
