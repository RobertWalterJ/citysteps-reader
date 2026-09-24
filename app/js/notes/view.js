// Notes: the list, one note, recording, import, export and backup.

import * as db from '../db.js';
import * as speech from '../speech.js';
import { esc, icon, openSheet, closeSheet, toast } from '../ui.js';
import { TYPES, titleOf, noteToMarkdown, slug, fromStudioExport, fromMarkdownFile } from './markdown.js';
import { newNote, saveNote, getNote, listNotes, deleteNote, getRecordingBlob, addAudioFile, onNotesChanged } from './store.js';
import { startRecording, canRecord } from './recorder.js';
import { runQueue, onTranscribeStatus, retry } from './transcribe.js';
import { getSettings, saveSettings, backUp, checkConnection } from './backup.js';

const $ = (id) => document.getElementById(id);
let filter = 'all', query = '', current = null, saveTimer = 0;
let synced = '';   // the note's body as last read from or written to storage

// ---------- list ----------

function statusOf(n) {
  const recs = n.recordings || [];
  if (recs.some((r) => r.transcript?.status === 'working')) return ['Writing out your recording...', ''];
  if (recs.some((r) => r.transcript?.status === 'queued')) return ['Recording saved, waiting to be written out', ''];
  if (recs.some((r) => r.transcript?.status === 'waiting')) return ['Recording saved, waiting for a connection', ''];
  if (recs.some((r) => r.transcript?.status === 'failed')) return ['Could not write out a recording (the audio is kept)', 'failed'];
  return null;
}

export async function renderNotes() {
  const fl = $('noteFilters');
  if (!fl.childElementCount) {
    fl.innerHTML = [['all', 'All'], ...Object.entries(TYPES)].map(([k, v]) => `<button data-f="${k}" aria-pressed="${k === filter}">${v}</button>`).join('');
  }
  const q = query.trim().toLowerCase();
  const notes = (await listNotes()).filter((n) => (filter === 'all' || n.type === filter) &&
    (!q || (titleOf(n) + ' ' + n.body + ' ' + (n.tags || []).join(' ') + ' ' + (n.anchors || []).map((a) => a.docTitle + ' ' + a.quote).join(' ')).toLowerCase().includes(q)));
  $('noteList').innerHTML = notes.map((n) => {
    const st = statusOf(n);
    const src = n.anchors?.[0];
    const snip = n.body.replace(/^#+\s.*$/m, '').replace(/\s+/g, ' ').trim().slice(0, 160);
    return `<li class="doc">
      <button class="doc-open" data-note="${n.id}">
        <span class="doc-title">${esc(titleOf(n))}</span>
        ${snip && snip !== titleOf(n) ? `<span class="note-snip">${esc(snip)}</span>` : ''}
        <span class="doc-meta"><span class="chip">${esc(TYPES[n.type] || n.type)}</span>${src ? `<span>from ${esc(src.docTitle.slice(0, 50))}${src.page ? ', p. ' + src.page : ''}</span>` : ''}<span>${new Date(n.updatedAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span></span>
        ${st ? `<span class="status-chip ${st[1]}"><span class="dot"></span>${esc(st[0])}</span>` : ''}
      </button>
      <span class="doc-actions"><button class="icon-btn small" data-say-note="${n.id}" aria-label="Read this note aloud">${icon('speaker')}</button></span>
    </li>`;
  }).join('');
  $('notesEmpty').hidden = notes.length > 0 || !!q || filter !== 'all';
}

// ---------- one note ----------

export async function openNote(id) {
  current = await getNote(id);
  if (!current) { toast('That note is not on this phone.'); location.hash = 'notes'; return false; }
  $('noteHead').textContent = titleOf(current);
  $('noteType').innerHTML = Object.entries(TYPES).map(([k, v]) => `<button data-t="${k}" aria-pressed="${current.type === k}">${v}</button>`).join('');
  $('noteBody').value = current.body;
  synced = current.body;
  $('noteTags').value = (current.tags || []).join(', ');
  renderSources();
  await renderRecs();
  $('noteSaved').textContent = 'Saved on this phone.';
  return true;
}

function renderSources() {
  const a = current.anchors || [];
  $('noteSources').innerHTML = a.length ? `<h2 class="small-h">Sparked by</h2>` + a.map((x, i) => `
    <div class="source-card"><q>${esc(x.quote || '')}</q>
      <span>${esc(x.docTitle)}${x.page ? ', page ' + x.page : ''}</span><br>
      <button data-src="${i}">Open it at this passage</button></div>`).join('') : '';
}

const urls = [];
async function renderRecs() {
  for (const u of urls.splice(0)) URL.revokeObjectURL(u);
  const recs = current.recordings || [];
  const parts = [];
  for (const r of recs) {
    const blob = await getRecordingBlob(r.id);
    const url = blob ? URL.createObjectURL(blob) : '';
    if (url) urls.push(url);
    const st = r.transcript?.status;
    const label = st === 'done' ? 'Written out' : st === 'working' ? 'Writing out now...' : st === 'waiting' ? 'Waiting for a connection' : st === 'failed' ? 'Could not write out: ' + (r.transcript.error || '') : 'Waiting to be written out';
    parts.push(`<div class="rec-card">
      <b>${r.source ? esc(r.source) : 'Recording'}</b> · ${r.durationSec ? Math.max(1, Math.round(r.durationSec / 60)) + ' min' : ''} ${r.interrupted ? '(the app closed while recording; everything up to then is kept)' : ''}
      ${url ? `<audio controls preload="none" src="${url}"></audio>` : '<p>The audio is missing.</p>'}
      <span class="status-chip ${st === 'failed' ? 'failed' : ''}"><span class="dot"></span>${esc(label)}</span>
      ${st === 'failed' || st === 'waiting' ? `<button class="text-btn" data-retry="${r.id}">Try again</button>` : ''}
      ${st === 'done' && r.transcript.text ? `<details><summary>What the phone heard</summary><p>${esc(r.transcript.text)}</p></details>` : ''}
    </div>`);
  }
  $('noteRecs').innerHTML = parts.length ? `<h2 class="small-h">Recordings</h2>` + parts.join('') : '';
}

function scheduleSave() {
  clearTimeout(saveTimer);
  $('noteSaved').textContent = 'Saving...';
  saveTimer = setTimeout(async () => {
    if (!current) return;
    // A transcript may have landed while Robert was typing: it was added to
    // the stored body, so keep that addition rather than typing over it.
    const fresh = await getNote(current.id);
    let body = $('noteBody').value;
    if (fresh) {
      current.recordings = fresh.recordings;
      if (fresh.body !== synced && fresh.body.startsWith(synced)) {
        body = body.replace(/\s+$/, '') + fresh.body.slice(synced.length);
        const at = $('noteBody').selectionStart;
        $('noteBody').value = body;
        $('noteBody').setSelectionRange(at, at);
      }
    }
    current.body = body;
    synced = body;
    current.tags = $('noteTags').value.split(',').map((t) => t.trim()).filter(Boolean);
    await saveNote(current);
    $('noteHead').textContent = titleOf(current);
    $('noteSaved').textContent = 'Saved on this phone.';
  }, 600);
}

// ---------- recording ----------

let recState = null;
// Record a thought. From the reader it carries the passage being read and
// resumes playback afterwards (the brief: pause, record, resume).
export async function capture({ noteId = null, anchor = null, type = 'idea', onDone } = {}) {
  if (!canRecord()) { toast('This browser cannot record audio.'); return; }
  if (recState) return;
  speech.cancel();
  let note = noteId ? await getNote(noteId) : await newNote({ type, anchors: anchor ? [anchor] : [] });
  const box = $('recorder');
  $('recFrom').textContent = anchor ? `About: “${anchor.quote.slice(0, 120)}${anchor.quote.length > 120 ? '...' : ''}” ${anchor.docTitle}, page ${anchor.page}` : noteId ? `Adding to: ${titleOf(note)}` : '';
  $('recType').innerHTML = Object.entries(TYPES).map(([k, v]) => `<button data-rt="${k}" aria-pressed="${note.type === k}">${v}</button>`).join('');
  $('recType').hidden = !!noteId;
  $('recSaved').textContent = 'Starting the microphone...';
  $('recLevel').style.width = '0';
  box.hidden = false;
  try {
    const rec = await startRecording(note.id, {
      onLevel: (v) => { $('recLevel').style.width = Math.round(v * 100) + '%'; },
      // Updated as each 5-second piece is stored: a record of what is safe,
      // not a clock.
      onSaved: (sec) => { $('recSaved').textContent = sec < 60 ? 'Saved so far: under a minute.' : `Saved so far: about ${Math.round(sec / 60)} minute${sec >= 90 ? 's' : ''}.`; },
    });
    $('recSaved').textContent = 'Listening. Everything is saved as you speak.';
    recState = { rec, note, onDone };
  } catch (err) {
    box.hidden = true;
    if (!noteId && !note.body && !note.recordings.length) await deleteNote(note.id);
    toast(/denied|NotAllowed/i.test(err.name + err.message) ? 'The microphone is blocked. Allow it for this app in Chrome site settings.' : 'Could not start the microphone: ' + err.message);
  }
}

async function stopCapture() {
  if (!recState) return;
  const { rec, note, onDone } = recState;
  recState = null;
  $('recSaved').textContent = 'Saving...';
  const type = $('recType').querySelector('[aria-pressed="true"]')?.dataset.rt;
  await rec.stop();
  const fresh = await getNote(note.id);
  if (type && fresh && fresh.type !== type) { fresh.type = type; await saveNote(fresh); }
  $('recorder').hidden = true;
  toast('Saved. The phone is writing it out now; you can keep going.');
  runQueue();
  onDone?.(fresh);
}

// ---------- import and export ----------

async function importFiles(files) {
  let made = 0;
  for (const f of files) {
    const text = await f.text();
    if (/\.json$/i.test(f.name) || f.type === 'application/json') {
      let json;
      try { json = JSON.parse(text); } catch { toast(`${f.name} is not a notes file.`); continue; }
      for (const n of fromStudioExport(json, 'post')) { await newNote(n).then((x) => saveNote(Object.assign(x, n, { id: x.id }), { touch: false })); made++; }
    } else {
      const n = fromMarkdownFile(f.name, text, 'article', f.lastModified || Date.now());
      const x = await newNote(n);
      await saveNote(Object.assign(x, n, { id: x.id }), { touch: false });
      made++;
    }
  }
  toast(made ? `Brought in ${made} note${made > 1 ? 's' : ''}.` : 'Nothing was brought in.');
  renderNotes();
}
export async function importAudio(files) {
  for (const f of files) await addAudioFile(f);
  toast(`Saved ${files.length} recording${files.length > 1 ? 's' : ''}. The phone is writing ${files.length > 1 ? 'them' : 'it'} out now.`);
  runQueue();
  renderNotes();
}
export async function importFromShare(files) {
  const audio = files.filter((f) => /^audio\//.test(f.type) || /\.(m4a|mp3|wav|ogg|opus|webm|aac|3gp|amr)$/i.test(f.name));
  const text = files.filter((f) => !audio.includes(f));
  if (audio.length) await importAudio(audio);
  if (text.length) await importFiles(text);
}

async function shareMarkdown(note) {
  const md = noteToMarkdown(note);
  const file = new File([md], slug(titleOf(note)) + '.md', { type: 'text/markdown' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: titleOf(note) }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function exportAll() {
  const notes = await listNotes();
  const md = notes.map(noteToMarkdown).join('\n\n---\n\n');
  const file = new File([md], `citysteps-notes-${new Date().toISOString().slice(0, 10)}.md`, { type: 'text/markdown' });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
}

// ---------- backup ----------

async function backupSheet() {
  const s = await getSettings();
  const last = await db.kvGet('backup-last', null);
  openSheet(`
    <h2>Back up to GitHub</h2>
    <p style="font-size:15px">Notes go to a private GitHub repo as Markdown files, which Obsidian can open. PDFs and audio stay on the phone.</p>
    <details style="margin-bottom:14px"><summary><b>How to set it up (once)</b></summary>
      <ol style="font-size:15px;padding-left:20px">
        <li>On GitHub, make a new <b>private</b> repo, for example <code>citysteps-notes</code>.</li>
        <li>Go to Settings, Developer settings, Fine-grained tokens, Generate new token.</li>
        <li>Repository access: <b>Only select repositories</b>, pick that repo.</li>
        <li>Permissions: <b>Contents: Read and write</b>. Nothing else.</li>
        <li>Paste the token below. It stays on this phone and is only sent to GitHub.</li>
      </ol></details>
    <label class="field"><span>GitHub user</span><input type="text" id="bkOwner" value="${esc(s.owner || 'RobertWalterJ')}" autocapitalize="off"></label>
    <label class="field"><span>Repo</span><input type="text" id="bkRepo" value="${esc(s.repo || 'citysteps-notes')}" autocapitalize="off"></label>
    <label class="field"><span>Token</span><input type="password" id="bkToken" value="${esc(s.token)}" autocomplete="off" placeholder="github_pat_..."></label>
    <p id="bkMsg" style="font-size:15px;color:var(--muted)">${last ? 'Last backed up ' + new Date(last).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) + '.' : 'Not backed up yet.'}</p>
    <div class="actions"><button class="text-btn solid" data-act="now">Save and back up now</button><button class="text-btn" data-act="check">Check the connection</button></div>`,
  async (act) => {
    const next = { ...s, owner: $('bkOwner').value.trim(), repo: $('bkRepo').value.trim(), token: $('bkToken').value.trim() };
    await saveSettings(next);
    const msg = $('bkMsg');
    try {
      if (act === 'check') {
        msg.textContent = 'Checking...';
        const c = await checkConnection(next);
        msg.textContent = `Connected to ${c.name}. ${c.private ? 'It is private.' : 'Warning: this repo is PUBLIC; notes there are visible to anyone.'} ${c.canPush ? 'The token can write to it.' : 'The token cannot write to it yet.'}`;
      } else if (act === 'now') {
        const c = await checkConnection(next);
        if (!c.private) { msg.textContent = 'That repo is public. Notes would be visible to anyone, so nothing was sent. Use a private repo.'; return; }
        const r = await backUp({ onProgress: (d, t) => { msg.textContent = t ? `Backing up ${d} of ${t}...` : 'Backing up...'; } });
        msg.textContent = r.notes ? `Backed up ${r.notes} changed note${r.notes > 1 ? 's' : ''} (${r.total} in all).` : `Everything was already backed up (${r.total} notes).`;
      }
    } catch (err) { msg.textContent = err.message; }
  });
}

export function notesMenu() {
  openSheet(`
    <h2>Notes</h2>
    <ul class="menu-list">
      <li><button data-act="backup">${icon('share')} Back up to GitHub</button></li>
      <li><button data-act="audio">${icon('mic')} Add a recording (from Samsung Voice Recorder or anywhere)</button></li>
      <li><button data-act="import">${icon('note')} Bring in notes (Studio export, or Markdown files)</button></li>
      <li><button data-act="export">${icon('share')} Share all notes as one Markdown file</button></li>
    </ul>`, (act) => {
    if (act === 'backup') return backupSheet();
    closeSheet();
    if (act === 'audio') $('audioInput').click();
    else if (act === 'import') $('importInput').click();
    else if (act === 'export') exportAll();
  });
}

// ---------- wiring ----------

export function wireNotes({ openDocAt }) {
  $('recStop').onclick = stopCapture;
  $('recType').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rt]');
    if (!b) return;
    $('recType').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  });
  $('recNewBtn').onclick = () => capture({ type: 'idea', onDone: (n) => { if (n) location.hash = 'note=' + n.id; } });
  $('typeNewBtn').onclick = async () => { const n = await newNote({ type: filter === 'all' ? 'idea' : filter }); location.hash = 'note=' + n.id; };
  $('noteFilters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    $('noteFilters').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    renderNotes();
  });
  $('noteSearch').addEventListener('input', (e) => { query = e.target.value; renderNotes(); });
  $('noteList').addEventListener('click', (e) => {
    const o = e.target.closest('[data-note]');
    if (o) { location.hash = 'note=' + o.dataset.note; return; }
    const s = e.target.closest('[data-say-note]');
    if (s) getNote(s.dataset.sayNote).then((n) => { speech.unlock(); speech.cancel(); speech.speak(titleOf(n) + '. ' + n.body, { rate: 1 }); });
  });
  $('notesMenuBtn').onclick = notesMenu;
  $('importInput').onchange = (e) => { importFiles([...e.target.files]); e.target.value = ''; };
  $('audioInput').onchange = (e) => { importAudio([...e.target.files]); e.target.value = ''; };

  $('noteBackBtn').onclick = () => { location.hash = 'notes'; };
  $('noteBody').addEventListener('input', scheduleSave);
  $('noteTags').addEventListener('input', scheduleSave);
  $('noteType').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-t]');
    if (!b || !current) return;
    current.type = b.dataset.t;
    $('noteType').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    await saveNote(current);
  });
  $('noteSources').addEventListener('click', (e) => {
    const b = e.target.closest('[data-src]');
    if (b && current) openDocAt(current.anchors[+b.dataset.src]);
  });
  $('noteRecs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-retry]');
    if (b && current) retry(current.id, b.dataset.retry);
  });
  $('noteRecordBtn').onclick = () => { if (current) capture({ noteId: current.id }); };
  $('noteShareBtn').onclick = () => { if (current) shareMarkdown(current); };
  $('noteSpeakBtn').onclick = () => { if (!current) return; speech.unlock(); speech.cancel(); speech.speak($('noteBody').value || titleOf(current), { rate: 1 }); };
  $('noteMenuBtn').onclick = () => {
    if (!current) return;
    openSheet(`<h2>${esc(titleOf(current))}</h2><ul class="menu-list">
      <li><button data-act="share">${icon('share')} Share as Markdown</button></li>
      <li><button data-act="delete" class="danger">${icon('trash')} Delete this note</button></li></ul>`, (act) => {
      if (act === 'share') { closeSheet(); shareMarkdown(current); }
      if (act === 'delete') {
        openSheet(`<h2>Delete this note?</h2><p>${esc(titleOf(current))} and its recordings will be removed from this phone. A copy already backed up to GitHub stays there.</p>
          <div class="actions"><button class="text-btn solid" data-act="yes">Delete</button><button class="text-btn" data-act="no">Keep it</button></div>`, async (a) => {
          closeSheet();
          if (a === 'yes') { await deleteNote(current.id); current = null; location.hash = 'notes'; }
        });
      }
    });
  };

  // Keep what is on screen in step with transcripts landing in the background.
  onNotesChanged(async (id) => {
    if (!$('notesView').hidden) renderNotes();
    if (current && id === current.id && !$('noteView').hidden) {
      const fresh = await getNote(id);
      if (!fresh) return;
      const bodyChanged = fresh.body !== current.body && document.activeElement !== $('noteBody');
      current.recordings = fresh.recordings;
      if (bodyChanged) { current.body = fresh.body; synced = fresh.body; $('noteBody').value = fresh.body; }
      renderRecs();
    }
  });
  onTranscribeStatus((s) => {
    const el = $('transcribeStatus');
    if (s.state === 'downloading') { el.hidden = false; el.textContent = `Getting the transcription model ready (once): ${s.progress}% of ${s.mb} MB.`; }
    else if (s.state === 'working') { el.hidden = false; el.textContent = 'Writing out a recording on the phone...'; }
    else if (s.state === 'waiting') { el.hidden = false; el.textContent = 'Recordings are saved. They will be written out when the phone is back online (the model downloads once).'; }
    else el.hidden = true;
  });
}
