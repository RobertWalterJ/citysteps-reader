// CitySteps Reader: start-up, routing between the library and the reader,
// and the ways a PDF comes in (file picker, Android share sheet, drag and drop).

import * as db from './db.js';
import * as speech from './speech.js';
import { importFile } from './importer.js';
import { renderLibrary, docMenu, working, upgradeDone } from './library.js';
import { openDoc, closeDoc, wireReader, setPendingJump } from './reader.js';
import { renderNotes, openNote, wireNotes, importFromShare } from './notes/view.js';
import { recoverInterrupted } from './notes/store.js';
import { runQueue } from './notes/transcribe.js';
import { queueOcr, resumeOcr, onOcrStatus } from './ocr-queue.js';
import { wireSheets, toast, esc, openSheet, closeSheet, icon } from './ui.js';
import { applyPrefs } from './prefs.js';
import { initUpdates } from './updates.js';
import { search, renderResults, invalidateSearch } from './search.js';

const $ = (id) => document.getElementById(id);
const BUILD = window.CSREADER_BUILD || { v: 'dev', commit: 'local', date: '' };

applyPrefs();
speech.initSpeech();
wireSheets();
wireReader({ onBack: () => { location.hash = ''; } });
wireNotes({ openDocAt: (a) => { setPendingJump(a); location.hash = 'doc=' + a.docId; } });
addEventListener('pointerdown', () => speech.unlock(), { once: true, capture: true });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyPrefs);

// ---------- routing ----------
const VIEWS = ['libraryView', 'notesView', 'noteView', 'readerView', 'searchView'];
function show(view) { for (const v of VIEWS) $(v).hidden = v !== view; }
async function route() {
  const h = location.hash;
  const doc = /^#doc=([\w-]+)/.exec(h)?.[1];
  const note = /^#note=([\w-]+)/.exec(h)?.[1];
  if (!doc) closeDoc();
  if (doc) {
    await upgradeDone(doc);
    if (!(await openDoc(doc))) return;
    show('readerView');
  } else if (note) {
    if (!(await openNote(note))) return;
    show('noteView');
    document.title = 'Note · CitySteps Reader';
  } else if (h === '#search') {
    show('searchView');
    document.title = 'Search · CitySteps Reader';
    invalidateSearch();
    runSearch();
    setTimeout(() => $('searchBox').focus(), 50);
  } else if (h === '#notes') {
    show('notesView');
    document.title = 'Notes · CitySteps Reader';
    await renderNotes();
  } else {
    show('libraryView');
    document.title = 'CitySteps Reader';
    await renderLibrary();
  }
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

// ---------- importing ----------
async function addFiles(files, source = 'file') {
  files = [...files].filter(Boolean);
  if (!files.length) return;
  db.persist();
  let lastId = null;
  for (const f of files) {
    const key = 'w' + Math.random().toString(36).slice(2);
    working.set(key, { name: f.name || 'Shared PDF', progress: 0 });
    renderLibrary();
    try {
      const { doc, duplicate } = await importFile(f, {
        source,
        onProgress: (p) => { const w = working.get(key); if (w) { w.progress = p; throttledRender(); } },
      });
      lastId = doc.id;
      if (!duplicate) queueOcr(doc);
      if (duplicate) toast(`${doc.title} is already in your library.`);
    } catch (e) {
      toast(e.message || 'That PDF could not be read.');
    } finally {
      working.delete(key);
    }
  }
  await renderLibrary();
  // One PDF shared in from another app: open it straight away.
  if (source === 'share' && files.length === 1 && lastId) location.hash = 'doc=' + lastId;
}
let rt = 0;
function throttledRender() { if (rt) return; rt = setTimeout(() => { rt = 0; if (!$('libraryView').hidden) renderLibrary(); }, 400); }

$('addBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };

// Drag and drop, for testing on the PC.
const lib = $('libraryView');
lib.addEventListener('dragover', (e) => { e.preventDefault(); $('addBtn').classList.add('drop-hint'); });
lib.addEventListener('dragleave', () => $('addBtn').classList.remove('drop-hint'));
lib.addEventListener('drop', (e) => { e.preventDefault(); $('addBtn').classList.remove('drop-hint'); addFiles(e.dataTransfer.files); });

// PDFs shared from another app arrive through the service worker, which
// parks them in the `inbox` store and sends us to ./?shared=1.
// PDFs go to the library; recordings (Samsung Voice Recorder) and Markdown
// go to Notes.
async function drainInbox() {
  let items = [];
  try { items = await db.all('inbox'); } catch { return; }
  if (!items.length) return;
  for (const it of items) await db.del('inbox', it.id);
  for (const it of items.filter((x) => x.link)) await addFromLink(it.link);
  items = items.filter((x) => x.blob);
  if (!items.length) return;
  const files = items.map((it) => new File([it.blob], it.name || 'shared', { type: it.blob.type || '' }));
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const other = files.filter((f) => !pdfs.includes(f));
  if (pdfs.length) await addFiles(pdfs, 'share');
  if (other.length) { location.hash = 'notes'; await importFromShare(other); }
}

// ---------- a PDF from a web link ----------
// Many sites do not let a web app download their files (no CORS header):
// arXiv does, most government sites do not. Try directly; if refused, say
// how to get it in with two taps instead.
async function addFromLink(raw) {
  let url = String(raw || '').trim();
  if (!/^https?:\/\//i.test(url)) { toast('That does not look like a web link.'); return; }
  url = url.replace(/^(https?:\/\/(export\.)?arxiv\.org)\/abs\//i, '$1/pdf/');   // an arXiv page -> its PDF
  toast('Getting the PDF...');
  let blob = null;
  try {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (r.ok) blob = await r.blob();
  } catch { /* refused by the site */ }
  const head = blob ? new TextDecoder().decode(new Uint8Array(await blob.slice(0, 1024).arrayBuffer())) : '';
  $('toast').hidden = true;
  if (!blob || !head.includes('%PDF')) {
    openSheet(`<h2>That site does not hand its files to apps</h2>
      <p style="font-size:15px">${blob ? 'The link opened a web page, not a PDF.' : 'The site blocks downloads from other apps, which most government sites do.'} Two taps get it in:</p>
      <ol style="font-size:15px;padding-left:20px"><li>Open the link in Chrome and download the PDF.</li><li>Share it to CitySteps Reader, or use Add a PDF and pick it from Downloads.</li></ol>
      <div class="actions"><button class="text-btn solid" data-act="open">Open the link in Chrome</button><button class="text-btn" data-act="close">Close</button></div>`,
    (a) => { if (a === 'open') window.open(url, '_blank', 'noopener'); closeSheet(); });
    return;
  }
  const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'download') .replace(/(\.pdf)?$/i, '.pdf');
  await addFiles([new File([blob], name, { type: 'application/pdf' })], 'url');
}
$('linkBtn').onclick = () => {
  openSheet(`<h2>Add from a link</h2>
    <label class="field"><span>Web address of the PDF</span><input type="url" id="linkIn" placeholder="https://..." inputmode="url" autocapitalize="off"></label>
    <p style="font-size:14px;color:var(--muted)">Works for sites that allow it (arXiv does). You can also share a link to this app from Chrome's share menu.</p>
    <div class="actions"><button class="text-btn solid" data-act="go">Add it</button><button class="text-btn" data-act="close">Cancel</button></div>`,
  (a) => { const v = $('linkIn')?.value; closeSheet(); if (a === 'go') addFromLink(v); });
};

// ---------- search ----------
let searchTimer = 0;
async function runSearch() { renderResults(await search($('searchBox').value), $('searchResults')); }
$('searchBox').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });
$('searchResults').addEventListener('click', (e) => {
  const n = e.target.closest('[data-note]');
  if (n) { location.hash = 'note=' + n.dataset.note; return; }
  const h = e.target.closest('[data-hit]');
  if (!h) return;
  const [id, seq] = h.dataset.hit.split(':');
  if (+seq >= 0) setPendingJump({ docId: id, seq: +seq, start: 0 });
  location.hash = 'doc=' + id;
});

// ---------- library list clicks ----------
$('docList').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) { location.hash = 'doc=' + open.dataset.open; return; }
  const menu = e.target.closest('[data-menu]');
  if (menu) { docMenu(menu.dataset.menu, { onChanged: renderLibrary }); return; }
  const say = e.target.closest('[data-say]');
  if (say) {
    db.get('docs', say.dataset.say).then((d) => { speech.unlock(); speech.cancel(); speech.speak(d.title, { rate: 1 }); });
  }
});

$('libMenuBtn').onclick = () => {
  openSheet(`
    <h2>CitySteps Reader</h2>
    <ul class="menu-list">
      <li><button data-act="commute">${icon('moon')} Prepare several for the commute</button></li>
      <li><button data-act="storage">${icon('settings')} Storage on this phone</button></li>
      <li><button data-act="about">${icon('book')} About this app</button></li>
    </ul>`, (act) => {
    if (act === 'commute') commuteSheet();
    else if (act === 'storage') storageSheet();
    else if (act === 'about') aboutSheet();
  });
};

function aboutSheet() {
  openSheet(`
    <h2>CitySteps Reader</h2>
    <p>Read PDFs aloud and catch the ideas they spark. Everything stays on this phone: no accounts, no cloud, and documents never leave it.</p>
    <p style="color:var(--muted);font-size:14px">Version ${esc(BUILD.v)} (${esc(BUILD.commit)}${BUILD.date ? ', ' + esc(BUILD.date) : ''}). Tap the version tag at the top for what's new.</p>
    <div class="actions"><button class="text-btn" data-act="close">Close</button></div>`, () => closeSheet());
}

// ---------- storage ----------
async function storageSheet() {
  openSheet('<h2>Storage on this phone</h2><p style="color:var(--muted)">Adding it up...</p>', () => {});
  const { report, clear, mb } = await import('./storage.js');
  const r = await report();
  const pct = r.quota ? Math.round((r.usage / r.quota) * 1000) / 10 : 0;
  openSheet(`
    <h2>Storage on this phone</h2>
    <p style="font-size:15px">This app is using about ${mb(r.usage)}${r.quota ? ` of the ${mb(r.quota)} Chrome allows (${pct}%)` : ''}. ${r.persisted ? 'It is protected from automatic clean-up.' : 'Install it to the home screen so Chrome does not clean it up when space is short.'}</p>
    <ul class="menu-list storage-list">${r.rows.map((x) => `<li><div class="st-row"><span><b>${esc(x.label)}</b><br><small style="color:var(--muted)">${esc(x.detail)}</small></span><span class="st-size">${x.bytes ? mb(x.bytes) : ''}</span></div>
      ${x.clear ? `<button class="text-btn" data-act="clear:${x.key}">${esc(x.clear)}</button>` : ''}</li>`).join('')}</ul>
    <p style="font-size:14px;color:var(--muted)">PDFs and voice notes are removed from the document or note itself (the three dots). Voices and models download again on their own the next time they are needed.</p>
    <div class="actions"><button class="text-btn" data-act="close">Close</button></div>`, async (act) => {
    if (!act.startsWith('clear:')) { closeSheet(); return; }
    const key = act.slice(6);
    await clear(key, r.rows.find((x) => x.key === key));
    storageSheet();
  });
}

// ---------- the commute queue ----------
async function commuteSheet() {
  const docs = (await db.all('docs')).filter((d) => d.parse?.status === 'ready').sort((a, b) => (b.progress?.at || b.addedAt) - (a.progress?.at || a.addedAt));
  if (!docs.length) { toast('Add a PDF first.'); return; }
  const ready = new Set((await db.all('renders')).map((r) => r.id));
  openSheet(`
    <h2>Prepare for the commute</h2>
    <p style="font-size:15px">Tick what you want to hear. Each one is prepared as a screen-off file from where you left off, one after another. Keep the screen on while it works (about a third of the listening time).</p>
    <ul class="menu-list">${docs.slice(0, 12).map((d, i) => `<li><label class="switch"><span>${esc(d.title.slice(0, 80))}${ready.has(d.id) ? '<br><small style="color:var(--muted)">already has prepared audio</small>' : ''}</span><input type="checkbox" data-doc="${d.id}" ${i < 2 && !ready.has(d.id) ? 'checked' : ''}></label></li>`).join('')}</ul>
    <div class="field"><span>For each one</span><div class="seg" id="commuteLen">${[15, 30, 60].map((m) => `<button data-act="len" data-m="${m}" aria-pressed="${m === 30}">${m} min</button>`).join('')}</div></div>
    <div class="actions" id="commuteGo"><button class="text-btn solid" data-act="go">Prepare</button><button class="text-btn" data-act="close">Cancel</button></div>
    <div id="commuteProgress" style="font-size:15px;margin-top:10px"></div>`, async (act, btn) => {
    if (act === 'len') { btn.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === btn)); return; }
    if (act === 'close') { closeSheet(); return; }
    if (act !== 'go') return;
    const ids = [...document.querySelectorAll('#sheet input[data-doc]:checked')].map((i) => i.dataset.doc);
    const minutes = +document.querySelector('#commuteLen [aria-pressed="true"]').dataset.m;
    if (!ids.length) { toast('Tick at least one.'); return; }
    document.getElementById('commuteGo').hidden = true;
    const out = document.getElementById('commuteProgress');
    const { prepareFor } = await import('./reader.js');
    const lines = [];
    for (const [k, id] of ids.entries()) {
      const d = docs.find((x) => x.id === id);
      const head = `${k + 1} of ${ids.length}: ${d.title.slice(0, 50)}`;
      try {
        const msg = await prepareFor(id, minutes, (t) => { if (out) out.textContent = [...lines, `${head}. ${t}`].join('\n'); });
        lines.push(`${head}: ${msg.replace(/ Press play.*$/, '')}`);
      } catch (err) { lines.push(`${head}: could not prepare (${err.message}).`); }
      if (out) out.textContent = lines.join('\n');
    }
    if (out) { out.style.whiteSpace = 'pre-line'; out.textContent = lines.join('\n') + '\n\nAll done. Open any of them, press play and lock the phone.'; }
    renderLibrary();
  });
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    // Pick up a new service worker when the app comes back to the screen.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data === 'inbox') drainInbox(); });
}

initUpdates();
await route();
// Recordings interrupted by a crash are joined and queued; then anything
// waiting to be written out carries on.
recoverInterrupted().catch(() => 0).then(() => runQueue());
// Scanned pages are read in the background; the library shows progress, and
// a document open in the reader refreshes when its pages have been read.
resumeOcr();
onOcrStatus((id, s) => {
  if (!$('libraryView').hidden) throttledRender();
  if (s?.state === 'done' && location.hash === '#doc=' + id) { toast('Scanned pages are now readable.'); route(); }
});
if (new URLSearchParams(location.search).has('shared')) history.replaceState(null, '', location.pathname + location.hash);
await drainInbox();
