// The transcription queue. Works through every recording whose transcript is
// not done, one at a time, oldest first. It survives the app closing (the
// queue is the notes themselves), and if the model cannot download (no
// signal) it waits and tries again when the phone is back online.

import * as db from '../db.js';
import { listNotes, saveNote } from './store.js';

let worker = null, running = false, seq = 0;
const status = { state: 'idle', progress: null, note: null };
const listeners = new Set();
export const onTranscribeStatus = (fn) => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };
const emit = (patch) => { Object.assign(status, patch); for (const fn of listeners) fn(status); };

function getWorker() {
  if (!worker) worker = new Worker(new URL('./stt-worker.js', import.meta.url), { type: 'module' });
  return worker;
}

// Any audio format the phone can play, down to 16 kHz mono for Whisper.
async function toMono16k(blob) {
  const buf = await blob.arrayBuffer();
  const ac = new OfflineAudioContext(1, 16000, 16000);
  const audio = await ac.decodeAudioData(buf);
  if (audio.numberOfChannels === 1) return audio.getChannelData(0).slice();
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) { const ch = audio.getChannelData(c); for (let i = 0; i < out.length; i++) out[i] += ch[i] / audio.numberOfChannels; }
  return out;
}

function transcribe(audio) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const onMsg = (e) => {
      const m = e.data;
      if (m.progress != null) { emit({ state: 'downloading', progress: m.progress, mb: m.mb }); return; }
      if (m.id !== id) return;
      if (m.status === 'working') { emit({ state: 'working', progress: null }); return; }
      w.removeEventListener('message', onMsg);
      m.error ? reject(new Error(m.error)) : resolve(m);
    };
    w.addEventListener('message', onMsg);
    w.onerror = (e) => { w.removeEventListener('message', onMsg); worker = null; reject(new Error(e.message || 'The transcriber stopped')); };
    w.postMessage({ id, audio }, [audio.buffer]);
  });
}

export async function runQueue() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const notes = await listNotes();
      const jobs = [];
      for (const n of notes) for (const r of n.recordings || []) if (['queued', 'working', 'waiting'].includes(r.transcript?.status)) jobs.push([n, r]);
      jobs.sort((a, b) => a[1].createdAt - b[1].createdAt);
      if (!jobs.length) break;
      const [note, rec] = jobs[0];
      const stored = await db.get('recordings', rec.id);
      if (!stored?.blob) { rec.transcript = { status: 'failed', error: 'The audio for this recording is missing.' }; await saveNote(note, { touch: false }); continue; }
      rec.transcript = { status: 'working' };
      await saveNote(note, { touch: false });
      emit({ state: 'working', note: note.id });
      try {
        const audio = await toMono16k(stored.blob);
        const r = await transcribe(audio);
        const fresh = (await db.get('notes', note.id)) || note;
        const fr = fresh.recordings.find((x) => x.id === rec.id);
        fr.transcript = { status: 'done', text: r.text, engine: r.engine, seconds: Math.round(r.seconds), at: Date.now() };
        // The words go into the note; the raw transcript stays with the recording.
        if (r.text) fresh.body = (fresh.body ? fresh.body.replace(/\s+$/, '') + '\n\n' : '') + r.text;
        await saveNote(fresh);
      } catch (err) {
        const offline = !navigator.onLine || /fetch|network|Failed to load/i.test(err.message);
        const fresh = (await db.get('notes', note.id)) || note;
        const fr = fresh.recordings.find((x) => x.id === rec.id);
        fr.transcript = offline ? { status: 'waiting', error: 'Waiting for a connection to download the transcription model.' } : { status: 'failed', error: err.message };
        await saveNote(fresh, { touch: false });
        if (offline) { emit({ state: 'waiting' }); break; }
      }
    }
  } finally {
    running = false;
    if (status.state !== 'waiting') emit({ state: 'idle', progress: null, note: null });
  }
}

addEventListener('online', () => runQueue());

export async function retry(noteId, recId) {
  const note = await db.get('notes', noteId);
  const r = note?.recordings.find((x) => x.id === recId);
  if (!r) return;
  r.transcript = { status: 'queued' };
  await saveNote(note, { touch: false });
  runQueue();
}
