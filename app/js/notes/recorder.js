// The microphone.
//
// Measured on the S23 FE (Sept 2026): Chrome stops the microphone when the
// screen locks and starts it again on unlock. So while recording, the app
// holds a screen wake lock and shows a dark "pocket" screen; for long or
// locked sessions Robert records in Samsung Voice Recorder and shares the
// file in. Every 5 seconds of audio is written to storage as it arrives, so a
// crash or a kill loses at most the last few seconds.

import { saveChunk, finishRecording, newRecordingId } from './store.js';

const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';

export async function startRecording(noteId, { onLevel, onSaved } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const rec = new MediaRecorder(stream, MIME ? { mimeType: MIME } : undefined);
  const recId = newRecordingId();
  const t0 = Date.now();
  let seq = 0, savedSec = 0, pending = Promise.resolve();
  rec.ondataavailable = (e) => {
    if (!e.data.size) return;
    const n = seq++;
    // Writes are chained so pieces land in order.
    pending = pending.then(() => saveChunk(recId, noteId, n, e.data, rec.mimeType)).then(() => {
      savedSec = (Date.now() - t0) / 1000;
      onSaved?.(savedSec);
    }).catch(() => {});
  };
  rec.start(5000);

  // Level meter, so Robert can see the phone is hearing him.
  let raf = 0, ac = null;
  try {
    ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 512;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      onLevel?.(Math.min(1, Math.sqrt(s / buf.length) * 6));
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch { /* no meter; recording still works */ }

  let wake = null;
  const holdAwake = async () => { try { if (document.visibilityState === 'visible') wake = await navigator.wakeLock?.request('screen'); } catch { wake = null; } };
  const onVis = () => { if (document.visibilityState === 'visible' && !wake) holdAwake(); };
  document.addEventListener('visibilitychange', onVis);
  holdAwake();

  return {
    recId,
    get seconds() { return (Date.now() - t0) / 1000; },
    async stop() {
      const stopped = new Promise((r) => { rec.onstop = r; });
      if (rec.state !== 'inactive') rec.stop();
      await stopped;
      await pending;
      stream.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(raf);
      ac?.close().catch(() => {});
      document.removeEventListener('visibilitychange', onVis);
      try { await wake?.release(); } catch { /* ignore */ }
      const durationSec = Math.round((Date.now() - t0) / 1000);
      await finishRecording(recId, { noteId, durationSec, mime: rec.mimeType });
      return { recId, durationSec };
    },
  };
}

export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
