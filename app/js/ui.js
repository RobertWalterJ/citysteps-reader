// Small shared pieces: bottom sheets, the toast, escaping, icons.

const $ = (id) => document.getElementById(id);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"/></svg>`;

let onAct = null, lastFocus = null;
export function openSheet(html, act, { onOpen } = {}) {
  const sheet = $('sheet');
  lastFocus = document.activeElement;
  sheet.innerHTML = `<div class="grab" aria-hidden="true"></div>${html}`;
  sheet.hidden = false;
  $('scrim').hidden = false;
  onAct = act;
  onOpen?.(sheet);
  sheet.querySelector('button, input, select')?.focus({ preventScroll: true });
}
export function closeSheet() {
  $('sheet').hidden = true;
  $('scrim').hidden = true;
  $('sheet').innerHTML = '';
  onAct = null;
  lastFocus?.focus?.({ preventScroll: true });
}
export function wireSheets() {
  $('scrim').onclick = closeSheet;
  $('sheet').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b && onAct) onAct(b.dataset.act, b);
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });
}

// Messages stay until tapped or replaced: no countdown (Robert is dyslexic;
// nothing should vanish before it has been read). A new message replaces the
// old one; the next tap anywhere dismisses it.
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  const off = () => { t.hidden = true; removeEventListener('pointerdown', off, true); };
  setTimeout(() => addEventListener('pointerdown', off, true), 0);
}
