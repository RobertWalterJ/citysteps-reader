// Notes and their recordings.
//
// The brief's hard rule: always save the raw audio first, transcribe second;
// a failed transcription must never lose a thought. So a recording lives in
// three stages:
//   1. while recording: 5-second pieces in `chunks`, written as they arrive;
//   2. on stop (or, after a crash, on the next start): pieces joined into one
//      Blob in `recordings`, pieces deleted;
//   3. transcription runs from a queue; the text is added to the note, and the
//      raw transcript is kept with the recording.

import * as db from '../db.js';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const listeners = new Set();
export const onNotesChanged = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = (id) => { for (const fn of listeners) fn(id); };

export async function newNote({ type = 'idea', body = '', anchors = [], title = '', importedFrom, tags = [] } = {}) {
  const t = Date.now();
  const note = { id: uid(), type, title, body, tags, anchors, recordings: [], createdAt: t, updatedAt: t };
  if (importedFrom) note.importedFrom = importedFrom;
  await db.put('notes', note);
  changed(note.id);
  return note;
}

export async function saveNote(note, { touch = true } = {}) {
  if (touch) note.updatedAt = Date.now();
  await db.put('notes', note);
  changed(note.id);
  return note;
}

export const getNote = (id) => db.get('notes', id);
export async function listNotes() {
  return (await db.all('notes')).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteNote(id) {
  const note = await db.get('notes', id);
  for (const r of note?.recordings || []) await db.del('recordings', r.id);
  await db.del('notes', id);
  changed(id);
}

// ---------- recordings ----------

export function newRecordingId() { return 'r' + uid(); }

export async function saveChunk(recId, noteId, seq, blob, mime) {
  await db.put('chunks', { id: `${recId}:${String(seq).padStart(5, '0')}`, recId, noteId, seq, blob, mime, at: Date.now() });
}

// Join a recording's pieces into one Blob, store it, and drop the pieces.
export async function finishRecording(recId, { noteId, durationSec, mime, interrupted = false } = {}) {
  const pieces = (await db.all('chunks')).filter((c) => c.recId === recId).sort((a, b) => a.seq - b.seq);
  if (!pieces.length) return null;
  const type = mime || pieces[0].mime || 'audio/webm';
  const blob = new Blob(pieces.map((p) => p.blob), { type });
  noteId = noteId || pieces[0].noteId;
  await db.put('recordings', { id: recId, noteId, blob, mime: type });
  const note = await db.get('notes', noteId);
  if (note) {
    const dur = durationSec ?? Math.round((pieces[pieces.length - 1].at - pieces[0].at) / 1000 + 5);
    let rec = note.recordings.find((r) => r.id === recId);
    if (!rec) { rec = { id: recId, createdAt: pieces[0].at }; note.recordings.push(rec); }
    Object.assign(rec, { durationSec: dur, mime: type, sizeKB: Math.round(blob.size / 1024), interrupted, transcript: rec.transcript?.status === 'done' ? rec.transcript : { status: 'queued' } });
    await saveNote(note);
  }
  for (const p of pieces) await db.del('chunks', p.id);
  return blob;
}

// Recordings the app was closed or killed in the middle of: nothing already
// saved is lost; they are joined and queued like any other.
export async function recoverInterrupted() {
  const pieces = await db.all('chunks');
  const ids = [...new Set(pieces.map((p) => p.recId))];
  for (const id of ids) await finishRecording(id, { interrupted: true });
  return ids.length;
}

// A recording made elsewhere (Samsung Voice Recorder, shared in).
export async function addAudioFile(file, { type = 'idea' } = {}) {
  const name = (file.name || 'Recording').replace(/\.[a-z0-9]+$/i, '');
  const note = await newNote({ type, title: name, importedFrom: file.name || 'shared audio' });
  const recId = newRecordingId();
  await db.put('recordings', { id: recId, noteId: note.id, blob: file, mime: file.type || 'audio/mp4' });
  note.recordings.push({ id: recId, createdAt: file.lastModified || Date.now(), mime: file.type, sizeKB: Math.round(file.size / 1024), source: file.name, transcript: { status: 'queued' } });
  await saveNote(note);
  return note;
}

export const getRecordingBlob = async (id) => (await db.get('recordings', id))?.blob || null;
