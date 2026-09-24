// Reading and listening preferences. The reading controls are CitySteps
// Studio's "Reading & display" panel (BDA style guide: spacing matters more
// than font), trimmed for a phone. Stored as one versioned JSON blob, every
// read and write in try/catch so the app still works if storage is blocked.

import * as speech from './speech.js';
import { openSheet, esc } from './ui.js';
import { PIPER_VOICES } from './voices.js';

const KEY = 'csreader.prefs';
const DEFAULTS = {
  v: 1, size: 19, line: 1.7, letter: 0.01, word: 0.04, tint: 'paper', theme: 'auto',
  voice: '', engine: 'piper', piperVoice: 'en_GB-alba-medium', readFootnotes: false, readReferences: false, readCaptions: false,
};
const TINTS = { paper: null, cream: '#F8F1DD', blue: '#ECF2F6', green: '#EDF3EA', grey: '#EFEFEB' };

export const prefs = load();
function load() {
  try { const p = JSON.parse(localStorage.getItem(KEY) || 'null'); if (p && p.v === 1) return { ...DEFAULTS, ...p }; } catch { /* fresh */ }
  return { ...DEFAULTS };
}
export function savePrefs() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }

export function applyPrefs() {
  const r = document.documentElement.style;
  r.setProperty('--rd-size', prefs.size + 'px');
  r.setProperty('--rd-line', prefs.line);
  r.setProperty('--rd-letter', prefs.letter + 'em');
  r.setProperty('--rd-word', prefs.word + 'em');
  const night = prefs.theme === 'dark' || (prefs.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  // A tint is a daytime aid; at night the dark theme's own ground is used.
  if (TINTS[prefs.tint] && !night) r.setProperty('--rd-bg', TINTS[prefs.tint]); else r.removeProperty('--rd-bg');
  if (prefs.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = prefs.theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', night ? '#14130F' : '#FEFDF8');
  if (prefs.voice) speech.setVoice(prefs.voice);
}

export function prefsSheet({ onChange }) {
  const voices = speech.englishVoices();
  // Natural voices first (Alba is Robert's pick, D19), then the phone's own.
  const cur = prefs.engine === 'builtin' ? 'builtin' : prefs.piperVoice;
  const vopts = `<optgroup label="Natural voices (download once, keep going with the screen off)">${PIPER_VOICES.map(([id, name]) => `<option value="${id}" ${cur === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}</optgroup>
    <optgroup label="The phone's own voice (instant, stops when the screen locks)"><option value="builtin" ${cur === 'builtin' ? 'selected' : ''}>${esc(speech.currentVoice()?.name || 'Phone voice')}</option></optgroup>`;
  const sw = (k, label, sub) => `<label class="switch"><span>${label}${sub ? `<br><small style="color:var(--muted)">${sub}</small>` : ''}</span><input type="checkbox" data-k="${k}" ${prefs[k] ? 'checked' : ''}></label>`;
  const range = (k, label, min, max, step) => `<label class="field"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${prefs[k]}"></label>`;
  openSheet(`
    <h2>Listening</h2>
    <label class="field"><span>Voice</span><select id="voiceSel">${vopts}</select></label>
    <button class="text-btn" data-act="test" style="margin:-4px 0 16px">Hear this voice</button>
    ${sw('readFootnotes', 'Read footnotes')}
    ${sw('readReferences', 'Read the reference list')}
    ${sw('readCaptions', 'Read figure and table captions')}
    <p style="color:var(--muted);font-size:14px">Tables and contents pages are never read as prose. Open the original page to see them.</p>
    <h2 style="margin-top:22px">Reading</h2>
    ${range('size', 'Text size', 15, 26, 0.5)}
    ${range('line', 'Line spacing', 1.4, 2.2, 0.05)}
    ${range('word', 'Space between words', 0, 0.5, 0.02)}
    ${range('letter', 'Space between letters', 0, 0.1, 0.005)}
    <div class="field"><span>Background</span><div class="swatches">${Object.entries(TINTS).map(([k, c]) =>
      `<button class="swatch" data-act="tint" data-tint="${k}" aria-label="${k}" aria-pressed="${prefs.tint === k}" style="background:${c || 'var(--paper)'}"></button>`).join('')}</div></div>
    <div class="field"><span>Theme</span><div class="seg">${['auto', 'light', 'dark'].map((t) =>
      `<button data-act="theme" data-theme="${t}" aria-pressed="${prefs.theme === t}">${{ auto: 'Match phone', light: 'Day', dark: 'Night' }[t]}</button>`).join('')}</div></div>
    <div class="actions"><button class="text-btn" data-act="reset">Reset reading settings</button></div>`,
  (act, btn) => {
    if (act === 'test') { onChange('test'); return; }
    if (act === 'tint') { prefs.tint = btn.dataset.tint; document.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', s === btn)); }
    if (act === 'theme') { prefs.theme = btn.dataset.theme; btn.parentElement.querySelectorAll('button').forEach((s) => s.setAttribute('aria-pressed', s === btn)); }
    if (act === 'reset') {
      Object.assign(prefs, { size: DEFAULTS.size, line: DEFAULTS.line, letter: DEFAULTS.letter, word: DEFAULTS.word, tint: 'paper' });
      document.querySelectorAll('#sheet input[type=range]').forEach((i) => { i.value = prefs[i.dataset.k]; });
    }
    savePrefs(); onChange('look');
  },
  { onOpen: (sheet) => {
    sheet.querySelector('#voiceSel').onchange = (e) => {
      if (e.target.value === 'builtin') prefs.engine = 'builtin';
      else { prefs.engine = 'piper'; prefs.piperVoice = e.target.value; }
      savePrefs(); onChange('voice');
    };
    sheet.querySelectorAll('input[type=range]').forEach((i) => { i.oninput = () => { prefs[i.dataset.k] = +i.value; savePrefs(); onChange('look'); }; });
    sheet.querySelectorAll('input[type=checkbox]').forEach((i) => { i.onchange = () => { prefs[i.dataset.k] = i.checked; savePrefs(); onChange('skip'); }; });
  } });
}
