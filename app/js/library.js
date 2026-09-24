// The library: every PDF on this phone, newest first, with how far through
// each one Robert is.

import * as db from './db.js';
import { esc, icon, openSheet, closeSheet, toast } from './ui.js';
import { removeDoc, reparse } from './importer.js';
import { LAYOUT_VERSION } from './parse/layout.js';

const $ = (id) => document.getElementById(id);
const TYPES = { academic: 'Academic', report: 'Report', news: 'News', whitepaper: 'White paper', other: 'Other' };
export const working = new Map();   // id -> { name, progress }

export async function renderLibrary() {
  const docs = (await db.all('docs')).sort((a, b) => (b.progress?.at || b.addedAt) - (a.progress?.at || a.addedAt));
  const list = $('docList');
  const rows = [];
  for (const [id, w] of working) {
    if (docs.some((d) => d.id === id && d.parse?.status === 'ready')) continue;
    rows.push(`<li class="doc"><span class="doc-open"><span class="doc-title">${esc(w.name)}</span>
      <span class="working"><span class="dot"></span>Cleaning up the text${w.progress ? `, ${Math.round(w.progress * 100)}%` : ''}</span></span></li>`);
  }
  for (const d of docs) {
    // A document mid-import is shown by its working row above.
    if (d.parse?.status === 'parsing' && working.size) continue;
    if (working.has(d.id) && d.parse?.status !== 'ready') continue;
    // Parsing that never finished (the app was closed part way): say so.
    if (d.parse?.status === 'parsing') d.parse = { status: 'failed', error: 'interrupted. Tap the three dots, then Clean up the text again' };
    const pct = Math.round((d.progress?.frac || 0) * 100);
    const meta = [
      `<span class="chip">${TYPES[d.docType] || 'Other'}</span>`,
      d.authors?.[0] && esc(d.authors[0]), d.year, d.pageCount && `${d.pageCount} page${d.pageCount === 1 ? '' : 's'}`,
      d.parse?.status === 'failed' ? `<span style="color:var(--danger)">Could not read: ${esc(d.parse.error)}</span>` : '',
      pct ? `${pct}% read` : '',
    ].filter(Boolean).join('<span aria-hidden="true">·</span>');
    rows.push(`<li class="doc">
      <button class="doc-open" data-open="${d.id}"><span class="doc-title">${esc(d.title)}</span><span class="doc-meta">${meta}</span></button>
      <span class="doc-actions">
        <button class="icon-btn small" data-say="${d.id}" aria-label="Read the title aloud">${icon('speaker')}</button>
        <button class="icon-btn small" data-menu="${d.id}" aria-label="More for this document">${icon('more')}</button>
      </span>
      ${pct ? `<span class="progress" aria-hidden="true"><i style="width:${pct}%"></i></span>` : ''}
    </li>`);
  }
  list.innerHTML = rows.join('');
  $('emptyState').hidden = rows.length > 0;
  // Documents parsed by an older layout engine get quietly re-parsed, one at
  // a time.
  for (const d of docs) if (d.parse?.status === 'ready' && d.parse.version !== LAYOUT_VERSION && !upgrades.has(d.id)) upgrades.set(d.id, queueUpgrade(d));
}

const upgrades = new Map();   // id -> promise, so the reader can wait for one
let chain = Promise.resolve();
function queueUpgrade(d) {
  const p = chain.then(async () => {
    working.set(d.id, { name: d.title, progress: 0 });
    if (!$('libraryView').hidden) renderLibrary();
    try { await reparse(d); } catch { /* keep the old parse */ }
    working.delete(d.id);
    if (!$('libraryView').hidden) renderLibrary();
  });
  chain = p;
  return p;
}
// Opening a document that is waiting for its re-parse waits for it, so the
// reader never shows the old version.
export const upgradeDone = (id) => upgrades.get(id) || Promise.resolve();

export function docMenu(id, { onChanged }) {
  db.get('docs', id).then((d) => {
    if (!d) return;
    openSheet(`
      <h2>${esc(d.title)}</h2>
      <ul class="menu-list">
        <li><button data-act="edit">${icon('edit')} Edit details</button></li>
        <li><button data-act="restart">${icon('back')} Start again from the top</button></li>
        <li><button data-act="reparse">${icon('scan')} Clean up the text again</button></li>
        <li><button data-act="delete" class="danger">${icon('trash')} Remove from this phone</button></li>
      </ul>
      ${d.parse?.warnings?.length ? `<p style="color:var(--muted);font-size:14px">${d.parse.warnings.map(esc).join('. ')}.</p>` : ''}`,
    async (act) => {
      if (act === 'edit') return editSheet(d, onChanged);
      if (act === 'restart') { d.progress = null; await db.put('docs', d); closeSheet(); onChanged(); return; }
      if (act === 'reparse') { closeSheet(); working.set(d.id, { name: d.title }); onChanged(); try { await reparse(d); toast('Done.'); } catch (e) { toast(e.message); } working.delete(d.id); onChanged(); return; }
      if (act === 'delete') {
        openSheet(`<h2>Remove this PDF?</h2><p>${esc(d.title)} and your place in it will be removed from this phone. You can add it again later.</p>
          <div class="actions"><button class="text-btn solid" data-act="yes">Remove</button><button class="text-btn" data-act="no">Keep it</button></div>`,
        async (a) => { closeSheet(); if (a === 'yes') { await removeDoc(d.id); onChanged(); } });
      }
    });
  });
}

function editSheet(d, onChanged) {
  openSheet(`
    <h2>Details</h2>
    <label class="field"><span>Title</span><input type="text" id="edTitle" value="${esc(d.title)}"></label>
    <label class="field"><span>Author</span><input type="text" id="edAuthor" value="${esc(d.authors?.join(', ') || '')}"></label>
    <label class="field"><span>Year</span><input type="number" id="edYear" inputmode="numeric" value="${d.year || ''}"></label>
    <label class="field"><span>Publisher or source</span><input type="text" id="edPub" value="${esc(d.publisher || '')}"></label>
    <label class="field"><span>Type</span><select id="edType">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${d.docType === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="field"><span>Tags (comma separated)</span><input type="text" id="edTags" value="${esc(d.tags?.join(', ') || '')}"></label>
    <div class="actions"><button class="text-btn solid" data-act="save">Save</button><button class="text-btn" data-act="cancel">Cancel</button></div>`,
  async (act) => {
    if (act === 'save') {
      const v = (id) => document.getElementById(id).value.trim();
      Object.assign(d, {
        title: v('edTitle') || d.title, authors: v('edAuthor') ? v('edAuthor').split(/\s*,\s*/) : [], year: +v('edYear') || null,
        publisher: v('edPub'), docType: v('edType'), tags: v('edTags') ? v('edTags').split(/\s*,\s*/).filter(Boolean) : [], edited: true,
      });
      await db.put('docs', d);
      onChanged();
    }
    closeSheet();
  });
}
