// CitySteps Reader: start-up, routing between the library and the reader,
// and the ways a PDF comes in (file picker, Android share sheet, drag and drop).

import * as db from './db.js';
import * as speech from './speech.js';
import { importFile } from './importer.js';
import { renderLibrary, docMenu, working, upgradeDone } from './library.js';
import { openDoc, closeDoc, wireReader } from './reader.js';
import { wireSheets, toast, esc, openSheet, closeSheet } from './ui.js';
import { applyPrefs } from './prefs.js';

const $ = (id) => document.getElementById(id);
const BUILD = window.CSREADER_BUILD || { v: 'dev', commit: 'local', date: '' };

applyPrefs();
speech.initSpeech();
wireSheets();
wireReader({ onBack: () => { location.hash = ''; } });
addEventListener('pointerdown', () => speech.unlock(), { once: true, capture: true });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyPrefs);

// ---------- routing ----------
async function route() {
  const id = /^#doc=([\w-]+)/.exec(location.hash)?.[1];
  if (id) {
    await upgradeDone(id);
    const ok = await openDoc(id);
    if (!ok) return;
    $('libraryView').hidden = true;
    $('readerView').hidden = false;
  } else {
    closeDoc();
    $('readerView').hidden = true;
    $('libraryView').hidden = false;
    document.title = 'CitySteps Reader';
    await renderLibrary();
  }
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
async function drainInbox() {
  let items = [];
  try { items = await db.all('inbox'); } catch { return; }
  if (!items.length) return;
  for (const it of items) await db.del('inbox', it.id);
  await addFiles(items.map((it) => new File([it.blob], it.name || 'shared.pdf', { type: 'application/pdf' })), 'share');
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

// ---------- updates (pattern from Hok Gong) ----------
function banner(html, act) {
  const b = document.createElement('div');
  b.className = 'banner';
  b.innerHTML = html;
  b.addEventListener('click', (e) => { const a = e.target.closest('[data-b]')?.dataset.b; if (a) act(a, b); });
  $('banners').append(b);
}
const loadedAt = performance.now();
function watchForUpdates(reg) {
  const ready = () => banner('<span>A new version is ready.</span><button class="text-btn solid" data-b="reload">Reload</button><button class="text-btn" data-b="later">Not now</button>',
    (a, b) => { if (a === 'reload') location.reload(); else b.remove(); });
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    // Pages load network-first, so an update found while this page was still
    // loading is the code already running. Only a deploy that lands while the
    // app is open needs a reload.
    if (performance.now() - loadedAt < 10000) return;
    w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ready(); });
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then(watchForUpdates).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data === 'inbox') drainInbox(); });
}

await route();
if (new URLSearchParams(location.search).has('shared')) history.replaceState(null, '', location.pathname + location.hash);
await drainInbox();
