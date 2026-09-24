// Phase 0.5 phone tests (PLAN.md section 7). Throwaway, but honest: every
// number shown is measured on the phone, and the results copy out as text.

const $ = (id) => document.getElementById(id);
const KEY = 'csreader.lab';
const results = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(results)); } catch { /* ignore */ } };
const show = (id, text) => { $(id).textContent = text; };
const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toString();
const now = () => new Date().toTimeString().slice(0, 8);

// ---------- 1. device ----------
async function device() {
  const r = {
    ua: navigator.userAgent,
    crossOriginIsolated: self.crossOriginIsolated,
    cores: navigator.hardwareConcurrency,
    memoryGB: navigator.deviceMemory ?? null,
    webgpu: 'no',
    storageMB: null, persisted: null,
    builtInVoices: 0,
  };
  try {
    const a = await navigator.gpu?.requestAdapter();
    if (a) { const i = a.info || (await a.requestAdapterInfo?.()) || {}; r.webgpu = `yes: ${[i.vendor, i.architecture, i.description].filter(Boolean).join(' ') || 'adapter found'}`; r.webgpuF16 = a.features.has('shader-f16'); }
  } catch (e) { r.webgpu = 'error: ' + e.message; }
  try { const e = await navigator.storage.estimate(); r.storageMB = Math.round(e.quota / 1048576); r.persisted = await navigator.storage.persisted(); } catch { /* ignore */ }
  const voices = () => (speechSynthesis.getVoices() || []).filter((v) => /^en/i.test(v.lang));
  r.builtInVoices = voices().length;
  if (!r.builtInVoices) await new Promise((res) => { speechSynthesis.onvoiceschanged = res; setTimeout(res, 1500); });
  r.builtInVoices = voices().length;
  r.voiceNames = voices().slice(0, 6).map((v) => `${v.name} (${v.lang}${v.localService ? '' : ', online'})`);
  results.device = r; save();
  show('outDevice', Object.entries(r).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : v}`).join('\n') +
    (r.crossOriginIsolated ? '' : '\n\nNot isolated yet: reload this page once so the service worker can add the headers that allow several threads.'));
}

// ---------- 2. Kokoro ----------
let ttsWorker = null;
document.querySelectorAll('[data-tts]').forEach((b) => b.onclick = () => {
  const device = b.dataset.tts;
  document.querySelectorAll('[data-tts]').forEach((x) => { x.disabled = true; });
  show('outTts', `Starting (${device})...`);
  ttsWorker?.terminate();
  ttsWorker = new Worker(new URL('./lab-tts-worker.js', import.meta.url), { type: 'module' });
  ttsWorker.onmessage = (e) => {
    const m = e.data;
    if (m.status) { show('outTts', m.status); return; }
    document.querySelectorAll('[data-tts]').forEach((x) => { x.disabled = false; });
    if (m.error) { show('outTts', `Failed on ${device}: ${m.error}`); results['tts_' + device] = { error: m.error }; save(); return; }
    results['tts_' + device] = m.result; save();
    const r = m.result;
    show('outTts', [`Engine: kokoro-js, ${device}, ${r.dtype}, ${r.threads} thread(s)`, `Download and load: ${fmt(r.loadSec)} s`,
      ...r.sentences.map((s, i) => `Sentence ${i + 1}: ${fmt(s.synthSec, 2)} s to make ${fmt(s.audioSec, 2)} s of speech (${fmt(s.audioSec / s.synthSec)}× real time)`),
      `Overall: ${fmt(r.speed)}× real time. ${r.speed >= 2 ? 'Fast enough to read live.' : r.speed >= 1 ? 'Keeps up, but only just: render ahead.' : 'Slower than speech: render ahead for the commute.'}`].join('\n'));
    const a = $('ttsAudio'); a.src = URL.createObjectURL(m.wav); a.hidden = false;
  };
  ttsWorker.postMessage({ device });
});

// ---------- 3. Whisper ----------
// No countdown (Robert is dyslexic: nothing on a clock by default). Start and
// Stop are both his.
let clip = null, recording = null;
$('recBtn').onclick = async () => {
  if (recording) { recording.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    const rec = new MediaRecorder(stream);
    const parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.start(1000);
    recording = rec;
    $('recBtn').textContent = 'Stop recording';
    show('outStt', 'Recording. Talk normally, then tap Stop recording.');
    await stopped;
    recording = null;
    $('recBtn').textContent = 'Record again';
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(parts, { type: rec.mimeType });
    const ac = new AudioContext({ sampleRate: 16000 });
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    clip = buf.getChannelData(0).slice();
    ac.close();
    show('outStt', `Saved ${fmt(clip.length / 16000)} s of audio (${Math.round(blob.size / 1024)} KB, ${rec.mimeType}). Now choose a model to transcribe it.`);
    document.querySelectorAll('[data-stt]').forEach((x) => { x.disabled = false; });
  } catch (e) { recording = null; show('outStt', 'Could not record: ' + e.message); }
};
let sttWorker = null;
document.querySelectorAll('[data-stt]').forEach((b) => b.onclick = () => {
  if (!clip) return;
  const model = b.dataset.stt;
  document.querySelectorAll('[data-stt]').forEach((x) => { x.disabled = true; });
  sttWorker?.terminate();
  sttWorker = new Worker(new URL('./lab-stt-worker.js', import.meta.url), { type: 'module' });
  sttWorker.onmessage = (e) => {
    const m = e.data;
    if (m.status) { show('outStt', m.status); return; }
    document.querySelectorAll('[data-stt]').forEach((x) => { x.disabled = false; });
    if (m.error) { show('outStt', `Failed: ${m.error}`); results['stt_' + model] = { error: m.error }; save(); return; }
    results['stt_' + model] = m.result; save();
    const r = m.result;
    show('outStt', [`Model: ${model} on ${r.device} (${r.dtype}), ${r.threads} thread(s)`, `Download and load: ${fmt(r.loadSec)} s`,
      `Transcribed ${fmt(r.audioSec)} s of speech in ${fmt(r.sttSec)} s (${fmt(r.audioSec / r.sttSec)}× real time)`, `Text: ${r.text}`].join('\n'));
  };
  sttWorker.postMessage({ model, audio: clip }, []);
});

// ---------- 4. lock screen ----------
const SR = 22050;
function beepWav(n, seconds = 15) {
  const len = SR * seconds, data = new Int16Array(len);
  for (let b = 0; b < n; b++) {
    const start = Math.floor(SR * (0.3 + b * 0.45)), dur = Math.floor(SR * 0.18);
    for (let i = 0; i < dur && start + i < len; i++) {
      const env = Math.min(1, i / 400, (dur - i) / 400);
      data[start + i] = Math.round(Math.sin((2 * Math.PI * 660 * i) / SR) * 5000 * env);
    }
  }
  const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, len * 2, true);
  new Int16Array(buf, 44).set(data);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
let lockLog = [], lockRunning = false, lockKind = '';
function logLock(what) {
  lockLog.push(`${now()} ${document.visibilityState === 'visible' ? 'screen on ' : 'LOCKED/away'} ${what}`);
  results['lock_' + lockKind] = lockLog.slice(); save();
  show('outLock', lockLog.slice(-40).join('\n'));
}
document.addEventListener('visibilitychange', () => { if (lockRunning) logLock(document.visibilityState === 'visible' ? 'came back' : 'went away'); });

$('lockAudio').onclick = () => {
  stopLock(); lockKind = 'audio'; lockLog = []; lockRunning = true;
  const el = $('lockEl');
  let n = 1;
  const play = () => { el.src = beepWav(((n - 1) % 9) + 1); el.play().then(() => logLock(`piece ${n} playing`)).catch((e) => logLock('could not play: ' + e.message)); };
  el.onended = () => { if (!lockRunning) return; URL.revokeObjectURL(el.src); n++; if (n > 16) { logLock('done after 16 pieces (4 minutes)'); lockRunning = false; return; } play(); };
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Lock screen test', artist: 'CitySteps Reader' });
    navigator.mediaSession.setActionHandler('pause', () => { el.pause(); logLock('paused from lock screen'); });
    navigator.mediaSession.setActionHandler('play', () => { el.play(); logLock('resumed from lock screen'); });
  }
  play();
};
$('lockSpeech').onclick = () => {
  stopLock(); lockKind = 'speech'; lockLog = []; lockRunning = true;
  let n = 1;
  const say = () => {
    if (!lockRunning) return;
    const u = new SpeechSynthesisUtterance(`Sentence ${n}. The built-in voice is still reading while the screen is locked, as far as it can tell.`);
    u.onstart = () => logLock(`sentence ${n} started`);
    u.onend = () => { n++; if (n > 30) { logLock('done after 30 sentences'); lockRunning = false; return; } say(); };
    u.onerror = (e) => logLock('voice error: ' + e.error);
    speechSynthesis.speak(u);
  };
  say();
};
function stopLock() { lockRunning = false; $('lockEl').pause(); speechSynthesis.cancel(); }
$('lockStop').onclick = () => { if (lockRunning) logLock('stopped'); stopLock(); };

// ---------- 5. background recording ----------
let bg = null;
$('bgStart').onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const t0 = Date.now();
    bg = { rec, stream, parts: [], log: [], t0 };
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      bg.parts.push(e.data);
      bg.log.push({ at: (Date.now() - t0) / 1000, kb: Math.round(e.data.size / 1024), vis: document.visibilityState });
      results.bgRecording = bg.log; save();
      show('outBg', bg.log.map((l) => `${fmt(l.at)} s: saved ${l.kb} KB (${l.vis === 'visible' ? 'screen on' : 'away'})`).join('\n'));
    };
    rec.start(5000);
    $('bgStart').disabled = true; $('bgStop').disabled = false;
    show('outBg', 'Recording. Leave the app or lock the phone now; come back in about a minute.');
  } catch (e) { show('outBg', 'Could not record: ' + e.message); }
};
$('bgStop').onclick = async () => {
  if (!bg) return;
  bg.rec.stop(); bg.stream.getTracks().forEach((t) => t.stop());
  await new Promise((r) => { bg.rec.onstop = r; });
  const total = (Date.now() - bg.t0) / 1000;
  const gaps = [];
  let prev = 0;
  for (const l of bg.log) { if (l.at - prev > 7.5) gaps.push(`${fmt(prev)} s to ${fmt(l.at)} s`); prev = l.at; }
  const blob = new Blob(bg.parts, { type: bg.rec.mimeType });
  const a = $('bgAudio'); a.src = URL.createObjectURL(blob); a.hidden = false;
  results.bgSummary = { totalSec: Math.round(total), pieces: bg.log.length, gaps, kb: Math.round(blob.size / 1024) }; save();
  show('outBg', $('outBg').textContent + `\n\nStopped after ${fmt(total)} s. ${gaps.length ? 'Gaps: ' + gaps.join(', ') : 'No gaps: the microphone kept going.'} Play it back below to check.`);
  $('bgStart').disabled = false; $('bgStop').disabled = true;
  bg = null;
};

// ---------- results ----------
const text = () => 'CitySteps Reader phone tests, ' + new Date().toISOString() + '\n' + JSON.stringify(results, null, 1);
$('copyAll').onclick = async () => { try { await navigator.clipboard.writeText(text()); $('copyAll').textContent = 'Copied'; } catch { prompt('Copy this:', text()); } };
$('shareAll').onclick = () => navigator.share?.({ title: 'Reader phone tests', text: text() }).catch(() => {});
$('clearAll').onclick = () => { for (const k of Object.keys(results)) delete results[k]; save(); location.reload(); };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
device();
