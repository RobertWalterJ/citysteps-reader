// The reader: the cleaned-up document, read aloud with sentence and word
// highlighting, from wherever Robert taps.

import * as db from './db.js';
import * as speech from './speech.js';
import { Player } from './player.js';
import { splitSentences } from './sentences.js';
import { READ_BY_DEFAULT } from './parse/layout.js';
import { openSheet, closeSheet, toast, esc, icon } from './ui.js';
import { prefs, savePrefs, applyPrefs, prefsSheet } from './prefs.js';

const $ = (id) => document.getElementById(id);
const LABEL = { footnote: 'Footnote', reference: 'Reference', caption: 'Caption', contents: 'Contents', other: 'Not read', formula: 'Formula' };
const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75];

let doc = null, parsed = null, queue = [], els = new Map();
let lastUserScroll = 0, saveTimer = 0, programmaticScroll = 0;
const hasHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS;

const player = new Player({
  onSentence: (i, s) => showSentence(i, s),
  onWord: (i, w) => showWord(i, w),
  onState: (playing) => setPlayIcon(playing),
  onFinish: () => { toast('Finished. Tap play to hear it again from the top.'); player.idx = 0; },
});

export function readable(kind) {
  if (READ_BY_DEFAULT.has(kind)) return true;
  if (kind === 'footnote') return prefs.readFootnotes;
  if (kind === 'reference') return prefs.readReferences;
  if (kind === 'caption') return prefs.readCaptions;
  return false;
}

export async function openDoc(id) {
  player.stop(false);
  doc = await db.get('docs', id);
  parsed = await db.get('parsed', id);
  if (!doc || !parsed) { toast('That document is not on this phone any more.'); location.hash = ''; return false; }
  $('docTitle').textContent = doc.title;
  document.title = doc.title + ' · CitySteps Reader';
  render();
  buildQueue();
  const speed = await db.kvGet('speed:' + doc.docType, prefs.speed || 1);
  player.rate = speed;
  $('speedBtn').textContent = fmtSpeed(speed);
  // Resume where Robert left off.
  let start = 0;
  if (doc.progress) {
    const k = queue.findIndex((q) => q.seq > doc.progress.seq || (q.seq === doc.progress.seq && q.start >= doc.progress.start));
    start = k < 0 ? 0 : k;
  }
  player.queue = queue;
  player.idx = start;
  if (queue.length) { showSentence(start, queue[start], { scroll: start > 0, instant: true }); }
  else $('where').textContent = parsed.stats.textPages ? 'Nothing here is set to be read aloud.' : 'This PDF is scanned images. Text recognition comes in a later version.';
  return true;
}

export function closeDoc() {
  player.stop(false);
  saveProgress(true);
  CSS.highlights?.clear();
  doc = null; parsed = null;
}

function render() {
  const root = $('reader');
  root.textContent = '';
  els = new Map();
  let lastPage = 0;
  let contents = null;
  const frag = document.createDocumentFragment();
  for (const b of parsed.blocks) {
    if (b.page !== lastPage && b.page > 1 && lastPage) {
      const m = document.createElement('div');
      m.className = 'page-mark';
      m.textContent = 'PAGE ' + b.page;
      m.dataset.page = b.page;
      frag.append(m);
    }
    lastPage = b.page;
    if (b.kind === 'contents') {
      if (!contents) {
        contents = document.createElement('details');
        contents.className = 'b';
        contents.innerHTML = '<summary class="contents-toggle">Contents page (not read aloud)</summary>';
        frag.append(contents);
      }
      const p = document.createElement('p');
      p.className = 'b quiet';
      p.textContent = b.text;
      contents.append(p);
      continue;
    }
    contents = null;
    let el;
    if (b.kind === 'table' || b.kind === 'scan') {
      el = document.createElement('div');
      el.className = 'card-block';
      const isTable = b.kind === 'table';
      el.innerHTML = `<span class="ico">${icon(isTable ? 'table' : 'scan')}</span>
        <span class="txt"><b>${isTable ? 'Table' : 'Scanned page'}</b><span>Page ${b.page}. ${isTable ? 'Not read aloud. Open the page to see it as laid out.' : 'No text layer yet. Text recognition comes in a later version.'}</span></span>
        <button class="text-btn" data-page="${b.page}">View</button>`;
    } else {
      const tag = b.kind === 'heading' ? 'h' + Math.min(4, (b.level || 3) + 1) : 'p';
      el = document.createElement(tag);
      el.className = 'b ' + b.kind;
      if (LABEL[b.kind]) { el.classList.add('quiet'); el.dataset.label = LABEL[b.kind]; }
      el.textContent = b.text;
    }
    el.dataset.seq = b.seq;
    els.set(b.seq, el);
    frag.append(el);
  }
  root.append(frag);
  window.scrollTo(0, 0);
}

function buildQueue() {
  queue = [];
  for (const b of parsed.blocks) {
    if (!readable(b.kind) || !b.text) continue;
    for (const s of splitSentences(b.text)) {
      queue.push({
        seq: b.seq, start: s.start, end: s.end, text: b.text.slice(s.start, s.end),
        words: s.words.map((w) => ({ start: w.start, end: w.end, rend: w.end - s.start })),
      });
    }
  }
  for (const [seq, el] of els) {
    const b = parsed.blocks[seq];
    if (b && LABEL[b.kind]) el.classList.toggle('skipped-now', !readable(b.kind));
  }
}

// ---------- highlighting ----------

function rangeIn(el, start, end) {
  const node = el.firstChild;
  if (!node || node.nodeType !== 3) return null;
  const r = document.createRange();
  r.setStart(node, Math.min(start, node.length));
  r.setEnd(node, Math.min(end, node.length));
  return r;
}

let hereEl = null;
function showSentence(i, s, { scroll = true, instant = false } = {}) {
  if (!s) return;
  const el = els.get(s.seq);
  if (hereEl && hereEl !== el) hereEl.classList.remove('here');
  hereEl = el;
  el?.classList.add('here');
  if (el && hasHighlights) {
    const r = rangeIn(el, s.start, s.end);
    if (r) CSS.highlights.set('sent', new Highlight(r));
    CSS.highlights.delete('word');
  }
  const b = parsed.blocks[s.seq];
  const sec = [...parsed.sections].reverse().find((x) => x.seq <= s.seq);
  $('where').textContent = `${sec ? sec.title.slice(0, 60) + ' · ' : ''}page ${b.page}`;
  if (scroll && el && Date.now() - lastUserScroll > 5000) {
    const r = rangeIn(el, s.start, s.end)?.getBoundingClientRect() || el.getBoundingClientRect();
    const target = window.scrollY + r.top - window.innerHeight * 0.32;
    if (Math.abs(r.top - window.innerHeight * 0.32) > window.innerHeight * 0.25 || instant) {
      programmaticScroll = Date.now();
      window.scrollTo({ top: Math.max(0, target), behavior: instant ? 'instant' : 'smooth' });
    }
  }
  scheduleSave();
}

function showWord(i, w) {
  const s = queue[i];
  if (!s || !hasHighlights) return;
  const word = s.words[w];
  const el = els.get(s.seq);
  if (!word || !el) return;
  const r = rangeIn(el, word.start, word.end);
  if (r) CSS.highlights.set('word', new Highlight(r));
}

function setPlayIcon(playing) {
  const b = $('playBtn');
  b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  b.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  if (!playing) CSS.highlights?.delete('word');
}

// ---------- progress ----------

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProgress(), 1200);
}
async function saveProgress(now = false) {
  if (!doc || !queue.length) return;
  clearTimeout(saveTimer);
  const s = queue[player.idx];
  if (!s) return;
  doc.progress = { seq: s.seq, start: s.start, frac: queue.length > 1 ? player.idx / (queue.length - 1) : 1, at: Date.now() };
  const d = doc;
  if (now) await db.put('docs', d); else db.put('docs', d).catch(() => {});
}

// ---------- controls ----------

function fmtSpeed(r) { return (Number.isInteger(r) ? r.toFixed(1) : String(r)) + '×'; }

export function wireReader({ onBack }) {
  $('backBtn').onclick = onBack;
  $('playBtn').onclick = () => { speech.unlock(); player.toggle(); };
  $('nextBtn').onclick = () => player.next();
  $('prevBtn').onclick = () => player.prev();
  $('speedBtn').onclick = async () => {
    const k = SPEEDS.indexOf(player.rate);
    const r = SPEEDS[(k + 1) % SPEEDS.length];
    player.setRate(r);
    $('speedBtn').textContent = fmtSpeed(r);
    if (doc) await db.kvSet('speed:' + doc.docType, r);
  };
  $('pageBtn').onclick = () => {
    const s = queue[player.idx];
    const page = s ? parsed.blocks[s.seq].page : pageInView();
    openPage(page);
  };
  $('sectionsBtn').onclick = sectionsSheet;
  $('prefsBtn').onclick = () => prefsSheet({
    onChange: (what) => {
      applyPrefs();
      if (what === 'skip') {
        const cur = queue[player.idx];
        buildQueue();
        const k = cur ? queue.findIndex((q) => q.seq > cur.seq || (q.seq === cur.seq && q.start >= cur.start)) : 0;
        player.setQueue(queue, k < 0 ? 0 : k);
      }
    },
  });

  addEventListener('scroll', () => { if (Date.now() - programmaticScroll > 900) lastUserScroll = Date.now(); }, { passive: true });

  $('reader').addEventListener('click', (e) => {
    const view = e.target.closest('button[data-page]');
    if (view) { openPage(+view.dataset.page); return; }
    const el = e.target.closest('[data-seq]');
    if (!el || el.tagName === 'DETAILS') return;
    passageSheet(+el.dataset.seq, e);
  });

  addEventListener('keydown', (e) => {
    if ($('readerView').hidden || e.target.closest('input,select,textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); speech.unlock(); player.toggle(); }
    else if (e.key === 'ArrowRight') player.next();
    else if (e.key === 'ArrowLeft') player.prev();
    else if (e.key === 'Escape') closeSheet();
  });

  addEventListener('pagehide', () => saveProgress(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveProgress(true); });
}

function pageInView() {
  const marks = [...document.querySelectorAll('.page-mark')];
  let page = 1;
  for (const m of marks) if (m.getBoundingClientRect().top < window.innerHeight * 0.4) page = +m.dataset.page;
  return page;
}

function startAt(seq, offset = 0) {
  const k = queue.findIndex((q) => q.seq > seq || (q.seq === seq && q.end > offset));
  if (k < 0) { toast('Nothing after this point is set to be read aloud.'); return; }
  lastUserScroll = 0;
  speech.unlock();
  player.play(k);
}

function passageSheet(seq, e) {
  const b = parsed.blocks[seq];
  // Where in the block the tap landed, so "Read from here" starts at that sentence.
  let offset = 0;
  const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY) || (document.caretRangeFromPoint && (() => { const r = document.caretRangeFromPoint(e.clientX, e.clientY); return r && { offsetNode: r.startContainer, offset: r.startOffset }; })());
  if (pos && pos.offsetNode?.parentElement === els.get(seq)) offset = pos.offset;
  const sents = splitSentences(b.text);
  const s = sents.find((x) => x.end > offset) || sents[0];
  const preview = s ? b.text.slice(s.start, s.end) : b.text;
  const canRead = readable(b.kind);
  openSheet(`
    <h2>${LABEL[b.kind] || (b.kind === 'heading' ? 'Heading' : 'Passage')} · page ${b.page}</h2>
    <p style="margin:0 0 14px;color:var(--muted)">${esc(preview.slice(0, 240))}${preview.length > 240 ? '...' : ''}</p>
    <ul class="menu-list">
      <li><button data-act="here">${icon('speaker')} ${canRead ? 'Read from this sentence' : 'Read from the next passage that is read aloud'}</button></li>
      ${!canRead && b.text ? `<li><button data-act="once">${icon('play')} Read just this ${(LABEL[b.kind] || 'passage').toLowerCase()}</button></li>` : ''}
      <li><button data-act="page">${icon('page')} Show it on the original page</button></li>
    </ul>`, (act) => {
    closeSheet();
    if (act === 'here') startAt(seq, canRead && s ? s.start : 0);
    else if (act === 'page') openPage(b.page);
    else if (act === 'once') readOnce(b);
  });
}

function readOnce(b) {
  player.stop();
  speech.unlock();
  const one = splitSentences(b.text).map((s) => ({ seq: b.seq, start: s.start, end: s.end, text: b.text.slice(s.start, s.end), words: s.words.map((w) => ({ start: w.start, end: w.end, rend: w.end - s.start })) }));
  const back = queue, idx = player.idx;
  const restore = () => { player.queue = back; player.idx = idx; player.onFinish = finish; };
  const finish = player.onFinish;
  player.queue = one;
  player.onFinish = restore;
  player.play(0);
}

function sectionsSheet() {
  const secs = parsed.sections;
  const items = secs.length ? secs.map((s) => `<li class="l${s.level}"><button data-act="${s.seq}">${esc(s.title)}</button></li>`).join('') : '<li style="color:var(--muted);padding:8px 0">No headings were found in this document.</li>';
  const counts = {};
  for (const b of parsed.blocks) counts[b.kind] = (counts[b.kind] || 0) + 1;
  openSheet(`
    <h2>Sections</h2>
    <ul class="sec-list"><li class="l1"><button data-act="top">Start of the document</button></li>${items}</ul>
    <p style="color:var(--muted);font-size:14px;margin-top:14px">${parsed.stats.pages} pages. Set aside from reading: ${[
      counts.reference && `${counts.reference} references`, counts.footnote && `${counts.footnote} footnotes`,
      counts.table && `${counts.table} tables`, parsed.stats.runningDropped && `${parsed.stats.runningDropped} running headers`,
      parsed.stats.pageNumbersDropped && `${parsed.stats.pageNumbersDropped} page numbers`].filter(Boolean).join(', ') || 'nothing'}.</p>`, (act) => {
    closeSheet();
    const seq = act === 'top' ? 0 : +act;
    const el = els.get(seq) || $('reader').firstElementChild;
    programmaticScroll = Date.now();
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const k = queue.findIndex((q) => q.seq >= seq);
    if (k >= 0) { if (player.playing) player.play(k); else { player.idx = k; showSentence(k, queue[k], { scroll: false }); } }
  });
}

async function openPage(n) {
  const f = await db.get('files', doc.id);
  if (!f) { toast('The original PDF is not on this phone.'); return; }
  const { showPage } = await import('./pageview.js');
  showPage(f.blob, n, parsed.stats.pages, doc.title);
}

export { savePrefs };
