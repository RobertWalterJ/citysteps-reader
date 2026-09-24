// The reader: the cleaned-up document, read aloud with sentence and word
// highlighting, from wherever Robert taps.

import * as db from './db.js';
import * as speech from './speech.js';
import { Voices, PIPER_VOICES } from './voices.js';
import { splitSentences } from './sentences.js';
import { READ_BY_DEFAULT } from './parse/layout.js';
import { openSheet, closeSheet, toast, esc, icon } from './ui.js';
import { prefs, savePrefs, applyPrefs, prefsSheet } from './prefs.js';
import { capture } from './notes/view.js';
import { newNote } from './notes/store.js';

const $ = (id) => document.getElementById(id);
const LABEL = { footnote: 'Footnote', reference: 'Reference', caption: 'Caption', contents: 'Contents', other: 'Not read', formula: 'Formula' };
const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75];

let doc = null, parsed = null, queue = [], els = new Map();
let lastUserScroll = 0, saveTimer = 0, programmaticScroll = 0;
const hasHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS;

const player = new Voices({
  onSentence: (i, s) => showSentence(i, s),
  onWord: (i, w) => showWord(i, w),
  onState: (playing) => setPlayIcon(playing),
  onFinish: () => { toast('Finished. Tap play to hear it again from the top.'); player.idx = 0; },
  onStatus: (st) => voiceStatus(st),
});

// What the Piper voice is doing, in the line above the controls.
const voiceName = () => (PIPER_VOICES.find(([id]) => id === prefs.piperVoice)?.[1] || 'Alba').split(' (')[0];
function voiceStatus(st) {
  if (!doc) return;
  if (st.state === 'downloading') $('where').textContent = `Getting ${voiceName()} ready (once): ${st.progress}% of ${st.mb} MB. The phone's voice reads meanwhile.`;
  else if (st.state === 'ready') { const s = queue[player.idx]; if (s) showSentence(player.idx, s, { scroll: false }); }
  else if (st.state === 'error') toast(`${voiceName()} could not start (${st.error}). Reading with the phone's voice.`);
}

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
  player.setEngine(prefs.engine, prefs.piperVoice);
  player.piper.setMeta(doc.title, '');
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
  applyJump();
  loadPrepared();
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

let hereEl = null, lastSection = null;
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
  // The lock screen shows the document and the section being read.
  if ((sec?.title || '') !== lastSection) { lastSection = sec?.title || ''; player.piper.setMeta(doc.title, lastSection); }
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

// The passage a note is about: the sentence being read (or tapped), with
// enough of the document to cite it later.
function anchorFor(seq, start, end) {
  const b = parsed.blocks[seq];
  const quote = (start != null ? b.text.slice(start, end) : b.text).trim();
  return { docId: doc.id, docTitle: doc.title, authors: doc.authors?.join(', ') || '', year: doc.year || null, page: b.page, seq, start: start ?? 0, quote: quote.length > 600 ? quote.slice(0, 597) + '...' : quote };
}
function currentAnchor() {
  const s = queue[player.idx];
  return s ? anchorFor(s.seq, s.start, s.end) : anchorFor(parsed.blocks.findIndex((b) => b.text) || 0);
}
// Pause, record, resume (the brief).
function sayAbout(anchor) {
  const wasPlaying = player.playing;
  player.pause();
  capture({ anchor, onDone: () => { if (wasPlaying) player.play(); } });
}
// Opening a note's source: go to the document and put the reading position
// on that passage.
export let pendingJump = null;
export function setPendingJump(a) { pendingJump = a; }
function applyJump() {
  if (!pendingJump || !doc || pendingJump.docId !== doc.id) return;
  const { seq, start } = pendingJump;
  pendingJump = null;
  const k = queue.findIndex((q) => q.seq > seq || (q.seq === seq && q.end > (start || 0)));
  if (k >= 0) { player.idx = k; lastUserScroll = 0; showSentence(k, queue[k], { instant: true }); }
  else els.get(seq)?.scrollIntoView({ block: 'center' });
}

export function wireReader({ onBack }) {
  $('micBtn').onclick = () => { speech.unlock(); sayAbout(currentAnchor()); };
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
  $('offBtn').onclick = screenOffSheet;
  $('prefsBtn').onclick = () => prefsSheet({
    onChange: (what) => {
      applyPrefs();
      if (what === 'voice') { player.setEngine(prefs.engine, prefs.piperVoice); if (prefs.engine === 'piper' && !player.playing) player.piper.warm(prefs.piperVoice).catch(() => {}); }
      if (what === 'test') testVoice();
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
      ${b.text ? `<li><button data-act="say">${icon('mic')} Say a thought about this</button></li>
      <li><button data-act="write">${icon('edit')} Write a note about this</button></li>` : ''}
      <li><button data-act="page">${icon('page')} Show it on the original page</button></li>
    </ul>`, (act) => {
    closeSheet();
    if (act === 'here') startAt(seq, canRead && s ? s.start : 0);
    else if (act === 'page') openPage(b.page);
    else if (act === 'say') sayAbout(anchorFor(seq, s?.start, s?.end));
    else if (act === 'write') {
      player.pause();
      newNote({ type: 'idea', anchors: [anchorFor(seq, s?.start, s?.end)] }).then((n) => { location.hash = 'note=' + n.id; });
    }
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

// ---------- listen with the screen off ----------
// One audio file for the next stretch, because a single file keeps playing
// with the phone locked and a chain of short ones does not (D18). Kept on the
// phone, so it can be prepared at home on Wi-Fi and played on the train.

const renderId = () => doc.id;
function locate(seq, start) { return queue.findIndex((q) => q.seq === seq && q.start === start); }

async function loadPrepared() {
  const r = await db.get('renders', doc.id).catch(() => null);
  if (!r || r.voiceId !== prefs.piperVoice) return;
  const from = locate(r.fromSeq, r.fromStart), to = locate(r.toSeq, r.toStart);
  // Only if the file still lines up with this document's sentences (skip
  // settings may have changed since) and the reading position is inside it.
  if (from < 0 || to - from + 1 !== r.times.length || player.idx < from || player.idx > to) return;
  player.piper.usePrepared({ from, to, times: r.times, seconds: r.seconds, blob: r.blob, voiceId: r.voiceId, prepared: true });
  $('where').textContent = `Ready to listen with the screen off: about ${Math.round(r.seconds / 60)} minutes prepared.`;
}

let preparing = false;
function screenOffSheet() {
  if (!queue.length) { toast('Nothing here is set to be read aloud.'); return; }
  const left = queue.slice(player.idx).reduce((n, q) => n + q.text.length, 0);
  const leftMin = Math.max(1, Math.round(left / 900));
  const opts = [15, 30, 60].filter((m) => m < leftMin);
  openSheet(`
    <h2>Listen with the screen off</h2>
    <p style="font-size:15px">${esc(voiceName())} prepares the next stretch as one audio file, starting from the sentence you are on. Then press play and lock the phone. Lock-screen controls pause and skip.</p>
    <p style="font-size:15px;color:var(--muted)">Preparing takes about a third of the listening time, with the screen on. You can do it at home and listen later: it is kept on the phone.${prefs.engine === 'builtin' ? ' This uses a natural voice; the phone’s own voice cannot keep going with the screen locked.' : ''}</p>
    <div class="actions" id="offChoices">
      ${opts.map((m) => `<button class="text-btn" data-act="m${m}">${m} minutes</button>`).join('')}
      <button class="text-btn solid" data-act="m${leftMin}">To the end (about ${leftMin} min)</button>
    </div>
    <div id="offProgress" style="margin-top:12px;font-size:15px"></div>`, async (act) => {
    if (!act.startsWith('m') || preparing) return;
    const minutes = +act.slice(1);
    if (prefs.engine !== 'piper') { prefs.engine = 'piper'; savePrefs(); player.setEngine('piper', prefs.piperVoice); }
    preparing = true;
    const box = document.getElementById('offProgress');
    document.getElementById('offChoices').hidden = true;
    const from = player.idx;
    player.pause();
    let wake = null;
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
    const say = (t) => { if (box) box.textContent = t; $('where').textContent = t; };
    try {
      const file = await player.piper.prepare(from, minutes, {
        onProgress: (p) => say(p.stage === 'voice' ? `Preparing: ${Math.round(p.done * 100)}% (${p.sentences} sentences). Keep the screen on.` : 'Nearly done: making the file smaller...'),
      });
      if (!file) throw new Error('nothing to prepare');
      const a = queue[file.from], b = queue[file.to];
      await db.put('renders', { id: renderId(), voiceId: file.voiceId, fromSeq: a.seq, fromStart: a.start, toSeq: b.seq, toStart: b.start, times: file.times, seconds: file.seconds, blob: file.blob, type: file.blob.type, at: Date.now() });
      player.piper.usePrepared(file);
      player.idx = from;
      const msg = `Ready: about ${Math.round(file.seconds / 60)} minutes (${Math.round(file.blob.size / 1048576 * 10) / 10} MB). Press play, then lock the phone.`;
      say(msg);
      toast(msg);
    } catch (err) {
      say('Could not prepare: ' + err.message);
    } finally {
      preparing = false;
      try { await wake?.release(); } catch { /* ignore */ }
    }
  });
}

// "Hear this voice" in the settings: one sentence in the chosen voice.
async function testVoice() {
  const line = 'This is how CitySteps Reader will sound with this voice.';
  speech.unlock();
  if (prefs.engine === 'builtin') { speech.cancel(); speech.speak(line, { rate: 1 }); return; }
  toast(`Getting ${voiceName()} ready (a one-time download the first time)...`);
  try {
    player.pause();
    const p = player.piper;
    await p.warm(prefs.piperVoice);
    const w = new Audio();
    const { pcm, rate } = await (async () => { const q = p.queue; p.queue = [{ text: line, words: [] }]; try { return await p.renderOne(0); } finally { p.queue = q; } })();
    const { wav } = await import('./tts/audio.js');
    w.src = URL.createObjectURL(wav(pcm, rate));
    await w.play();
    document.getElementById('toast').hidden = true;
  } catch (err) { toast('That voice could not start: ' + err.message); }
}
