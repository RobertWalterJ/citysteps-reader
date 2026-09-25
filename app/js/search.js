// Search across every document and note on the phone.
//
// All the text is already on the phone in IndexedDB, so a search is a plain
// scan: every word typed must appear in the passage (any order), ignoring
// case and accents. Results open at the passage (documents) or the note.
// A few thousand passages scan in well under a second on a phone.

import * as db from './db.js';
import { esc } from './ui.js';
import { titleOf, TYPES } from './notes/markdown.js';

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

let cache = null;   // { at, docs: [{ doc, blocks }] }
export function invalidateSearch() { cache = null; }

async function corpus() {
  if (cache && Date.now() - cache.at < 60000) return cache;
  const docs = await db.all('docs');
  const out = [];
  for (const d of docs) {
    const p = await db.get('parsed', d.id);
    if (p) out.push({ doc: d, blocks: p.blocks.filter((b) => b.text).map((b) => ({ seq: b.seq, page: b.page, kind: b.kind, text: b.text, folded: fold(b.text) })) });
  }
  cache = { at: Date.now(), docs: out };
  return cache;
}

// A snippet around the first match, with every matching word marked.
function snippet(text, words) {
  const f = fold(text);
  const first = Math.min(...words.map((w) => { const i = f.indexOf(w); return i < 0 ? Infinity : i; }));
  const from = Math.max(0, (first === Infinity ? 0 : first) - 60);
  let cut = text.slice(from, from + 220);
  if (from > 0) cut = '...' + cut.replace(/^\S*\s/, '');
  if (from + 220 < text.length) cut = cut.replace(/\s\S*$/, '') + '...';
  let html = esc(cut);
  for (const w of words) {
    const re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}

export async function search(query) {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return { docs: [], notes: [], words };
  const { docs } = await corpus();
  const docHits = [];
  for (const { doc, blocks } of docs) {
    const inTitle = words.every((w) => fold(doc.title).includes(w));
    // Body text first; contents lines, references and footnotes last (the
    // CPPS report's contents page otherwise tops every search).
    const rankOf = (k) => ({ para: 0, heading: 0, abstract: 0, caption: 1, figure: 1, table: 1, footnote: 2, reference: 3, contents: 4 }[k] ?? 2);
    const hits = blocks.filter((b) => words.every((w) => b.folded.includes(w))).sort((a, b) => rankOf(a.kind) - rankOf(b.kind) || a.seq - b.seq);
    if (hits.length || inTitle) docHits.push({ doc, hits: hits.slice(0, 6), total: hits.length, inTitle });
  }
  docHits.sort((a, b) => (b.inTitle - a.inTitle) || (b.total - a.total));
  const notes = (await db.all('notes')).filter((n) => {
    const t = fold([titleOf(n), n.body, (n.tags || []).join(' '), ...(n.anchors || []).map((a) => a.quote + ' ' + a.docTitle)].join(' '));
    return words.every((w) => t.includes(w));
  }).sort((a, b) => b.updatedAt - a.updatedAt);
  return { docs: docHits, notes, words };
}

export function renderResults(r, el) {
  if (!r.words.length) { el.innerHTML = '<p class="empty">Type a word or two. Every document and note on this phone is searched.</p>'; return; }
  const parts = [];
  const section = (title, items) => `<h2 class="small-h">${title}</h2><ul class="doc-list">${items.join('')}</ul>`;
  const noteItems = [], docItems = [];
  if (r.notes.length) {
    for (const n of r.notes.slice(0, 20)) {
      noteItems.push(`<li class="doc"><button class="doc-open" data-note="${n.id}"><span class="doc-title">${esc(titleOf(n))}</span>
        <span class="note-snip">${snippet(n.body || titleOf(n), r.words)}</span><span class="doc-meta"><span class="chip">${esc(TYPES[n.type] || n.type)}</span></span></button></li>`);
    }
  }
  if (noteItems.length) parts.push(section(`Notes (${r.notes.length})`, noteItems));
  if (r.docs.length) {
    for (const d of r.docs) {
      docItems.push(`<li class="doc result-doc"><span class="doc-open"><span class="doc-title">${esc(d.doc.title)}</span>
        <span class="doc-meta">${d.total ? `${d.total} passage${d.total > 1 ? 's' : ''}` : 'Title matches'}</span></span>
        <ul class="hit-list">${d.hits.map((h) => `<li><button data-hit="${d.doc.id}:${h.seq}"><span class="chip">p. ${h.page}</span> ${snippet(h.text, r.words)}</button></li>`).join('')}
        ${d.total > d.hits.length ? `<li class="more">and ${d.total - d.hits.length} more</li>` : ''}
        ${!d.total ? `<li><button data-hit="${d.doc.id}:-1">Open it</button></li>` : ''}</ul></li>`);
    }
  }
  if (docItems.length) parts.push(section(`Documents (${r.docs.length})`, docItems));
  el.innerHTML = parts.length ? parts.join('') : '<p class="empty">Nothing found. Try fewer or different words.</p>';
}
