// The built-in voice (the phone's own text-to-speech).
//
// Instant and free, but on Android Chrome it gives no word-boundary events and
// stops when the screen locks (PLAN.md 3.4). Phase 4 adds rendered Kokoro
// audio for the lock screen; until then the player keeps the screen awake.
//
// Mobile browsers refuse to speak until speech has been started once inside a
// real user gesture, so unlock() runs on the first pointerdown (pattern from
// Wordhoard and Hok Gong).

let voices = [];
let chosen = null;
let unlocked = false;
const listeners = new Set();

const score = (v) => (/^en[-_]CA/i.test(v.lang) ? 6 : /^en[-_]GB/i.test(v.lang) ? 5 : /^en[-_]US/i.test(v.lang) ? 4 : 3) +
  (v.localService ? 2 : 0) + (/natural|neural|enhanced|premium/i.test(v.name) ? 2 : 0);

function load() {
  const list = window.speechSynthesis?.getVoices?.() || [];
  voices = list.filter((v) => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  if (chosen && !voices.includes(chosen)) chosen = voices.find((v) => v.voiceURI === chosen.voiceURI) || null;
  for (const fn of listeners) fn(voices);
}

export function initSpeech() {
  if (!('speechSynthesis' in window)) return;
  load();
  speechSynthesis.addEventListener?.('voiceschanged', load);
}
export const available = () => 'speechSynthesis' in window;
export const englishVoices = () => voices;
export const onVoices = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function setVoice(uri) { chosen = voices.find((v) => v.voiceURI === uri) || null; }
export const currentVoice = () => chosen || voices[0] || null;

export function unlock() {
  if (unlocked || !available()) return;
  unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch { /* nothing to unlock */ }
}

// Android Chrome fails a speak() that follows cancel() too closely (the S23 FE
// returned "synthesis-failed", Sept 2026), so every speak waits out a short
// gap after the last cancel, whoever called it.
let lastCancel = 0;
const GAP = 250;
export function cancel() { lastCancel = Date.now(); try { speechSynthesis.cancel(); } catch { /* ignore */ } }

// Speak one piece of text. Returns the utterance so the caller can tell a
// stale onend (from a cancelled sentence) from the current one.
export function speak(text, { rate = 1, onstart, onend, onerror, onboundary } = {}) {
  const u = new SpeechSynthesisUtterance(text);
  const v = currentVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-CA';
  u.rate = rate;
  u.onstart = onstart;
  u.onend = onend;
  u.onerror = onerror;
  u.onboundary = onboundary;
  const wait = GAP - (Date.now() - lastCancel);
  if (wait > 0) setTimeout(() => speechSynthesis.speak(u), wait); else speechSynthesis.speak(u);
  return u;
}
