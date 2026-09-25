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
import { wireSheets, toast, esc, openSheet, closeSheet } from './ui.js';
import { applyPrefs } from './prefs.js';
import { initUpdates } from './updates.js';

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
const VIEWS = ['libraryView', 'notesView', 'noteView', 'readerView'];
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
  const files = items.map((it) => new File([it.blob], it.name || 'shared', { type: it.blob.type || '' }));
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const other = files.filter((f) => !pdfs.includes(f));
  if (pdfs.length) await addFiles(pdfs, 'share');
  if (other.length) { location.hash = 'notes'; await importFromShare(other); }
}

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

$('libMenuBtn').onclick = async () => {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const mb = (n) => (n / 1024 / 1024).toFixed(n > 1e8 ? 0 : 1);
  openSheet(`
    <h2>CitySteps Reader</h2>
    <p>Read PDFs aloud and catch the ideas they spark. Everything stays on this phone.</p>
    <p style="color:var(--muted);font-size:14px">
      Version ${esc(BUILD.v)} (${esc(BUILD.commit)}${BUILD.date ? ', ' + esc(BUILD.date) : ''}).<br>
      ${est ? `Storage used: ${mb(est.usage)} MB.` : ''} ${persisted ? 'Protected from automatic clean-up.' : 'Not yet protected from automatic clean-up: install the app to the home screen.'}<br>
      Voice: ${esc(speech.currentVoice()?.name || 'none found')}.
    </p>
    <div class="actions"><button class="text-btn" data-act="close">Close</button></div>`, () => closeSheet());
};

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
