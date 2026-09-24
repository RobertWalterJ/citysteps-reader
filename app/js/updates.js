// The version tag, "What's new", and telling Robert when the app has updated.
//
// Two moments (asked for 2026-09-24):
// 1. After an update has arrived: the first open on a new version shows
//    "Updated to v...", with what changed. It stays until closed.
// 2. While the app is open and a new version is published: "v... is ready,
//    reload to get it". The build writes version.json; the app checks it when
//    it comes back to the screen and every 30 minutes while open.
// A notification while the app is closed would need a push server, which
// this app does not have ($0, no server), so these are in-app.

import { CHANGES } from './changelog.js';
import { esc, icon, openSheet, closeSheet } from './ui.js';
import * as speech from './speech.js';

const $ = (id) => document.getElementById(id);
const SEEN = 'csreader.seenVersion';
const BUILD = window.CSREADER_BUILD || { v: 'dev', commit: 'local', date: '' };
export const version = () => BUILD.v;

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

function notice(html, onAct) {
  const n = $('notice');
  n.innerHTML = html;
  n.hidden = false;
  n.onclick = (e) => { const a = e.target.closest('[data-n]')?.dataset.n; if (a) onAct(a); };
}
const hideNotice = () => { $('notice').hidden = true; };

const listText = (items) => items.map((t) => `<li>${esc(t)}</li>`).join('');
const spoken = (entries) => entries.map((c) => `Version ${c.v}. ` + c.items.join(' ')).join(' ');

export function whatsNew() {
  openSheet(`
    <h2>What’s new <button class="icon-btn small" data-act="say" aria-label="Read this aloud" style="vertical-align:middle">${icon('speaker')}</button></h2>
    <p style="color:var(--muted);font-size:14px;margin-top:-6px">You have version ${esc(BUILD.v)}${BUILD.date ? ', built ' + esc(BUILD.date) : ''}.</p>
    ${CHANGES.map((c) => `<h3 style="font:700 16px/1.3 var(--display);margin:16px 0 6px">v${esc(c.v)} <span style="color:var(--muted);font-weight:500">${esc(c.date)}</span></h3><ul style="margin:0;padding-left:20px">${listText(c.items)}</ul>`).join('')}
    <div class="actions" style="margin-top:16px"><button class="text-btn" data-act="close">Close</button></div>`, (act) => {
    if (act === 'say') { speech.unlock(); speech.cancel(); speech.speak(spoken(CHANGES.slice(0, 2)), { rate: 1 }); return; }
    speech.cancel();
    closeSheet();
  });
}

export function initUpdates() {
  document.querySelectorAll('.ver').forEach((b) => { b.textContent = 'v' + BUILD.v; b.onclick = whatsNew; });

  // 1. First open after an update.
  const seen = read(SEEN);
  if (!seen) write(SEEN, BUILD.v);                       // a fresh install: nothing to announce
  else if (BUILD.v !== 'dev' && seen !== BUILD.v) {
    const fresh = CHANGES.filter((c) => cmp(c.v, seen) > 0);
    notice(`<div class="notice-head"><b>Updated to v${esc(BUILD.v)}</b>
        <button class="icon-btn small" data-n="say" aria-label="Read this aloud">${icon('speaker')}</button></div>
      <ul>${listText((fresh[0] || CHANGES[0]).items)}</ul>
      <div class="actions"><button class="text-btn solid" data-n="ok">Got it</button><button class="text-btn" data-n="more">All changes</button></div>`, (a) => {
      if (a === 'say') { speech.unlock(); speech.cancel(); speech.speak(`Updated to version ${BUILD.v}. ` + (fresh[0] || CHANGES[0]).items.join(' '), { rate: 1 }); return; }
      speech.cancel();
      write(SEEN, BUILD.v);
      hideNotice();
      if (a === 'more') whatsNew();
    });
  }

  // 2. A newer version published while the app is open.
  let told = null;
  const check = async () => {
    if (document.visibilityState !== 'visible' || location.protocol === 'file:') return;
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const { v } = await r.json();
      if (!v || v === BUILD.v || v === told || cmp(v, BUILD.v) <= 0) return;
      told = v;
      notice(`<div class="notice-head"><b>Version ${esc(v)} is ready</b></div>
        <p>Reload to get it. Your place in each document and all notes are kept.</p>
        <div class="actions"><button class="text-btn solid" data-n="reload">Reload now</button><button class="text-btn" data-n="later">Later</button></div>`, (a) => {
        if (a === 'reload') location.reload(); else hideNotice();
      });
    } catch { /* offline: ask again later */ }
  };
  document.addEventListener('visibilitychange', check);
  setInterval(check, 30 * 60 * 1000);
  setTimeout(check, 20000);
}
