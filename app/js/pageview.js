// The original page, drawn by PDF.js. Loaded only when first asked for, so
// the library opens without pulling in the renderer.

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { esc, icon } from './ui.js';

GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;

let cached = { blob: null, pdf: null, task: null };
let zoom = 1;

export async function showPage(blob, n, total, title) {
  const box = document.getElementById('pageview');
  box.innerHTML = `
    <header class="bar">
      <button class="icon-btn" data-pv="close" aria-label="Close">${icon('close')}</button>
      <h1>${esc(title)}</h1>
      <button class="icon-btn" data-pv="zoom" aria-label="Zoom">${icon('zoom')}</button>
    </header>
    <div class="canvas-wrap"><canvas></canvas></div>
    <footer class="player"><div class="row">
      <button class="icon-btn" data-pv="prev" aria-label="Previous page">${icon('back')}</button>
      <span class="where" style="margin:0 12px" id="pvWhere"></span>
      <button class="icon-btn" data-pv="next" aria-label="Next page" style="transform:scaleX(-1)">${icon('back')}</button>
    </div></footer>`;
  box.hidden = false;
  if (cached.blob !== blob) {
    cached.task?.destroy();
    const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false });
    cached = { blob, task, pdf: await task.promise };
  }
  let page = n;
  const draw = async () => {
    box.querySelector('#pvWhere').textContent = `Page ${page} of ${total}`;
    const p = await cached.pdf.getPage(page);
    const wrap = box.querySelector('.canvas-wrap');
    const base = p.getViewport({ scale: 1 });
    const cssW = (wrap.clientWidth - 16) * zoom;
    const scale = cssW / base.width;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const vp = p.getViewport({ scale: scale * dpr });
    const c = box.querySelector('canvas');
    c.width = vp.width; c.height = vp.height;
    c.style.width = cssW + 'px'; c.style.height = (vp.height / dpr) + 'px';
    c.style.margin = '8px auto';
    await p.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp }).promise;
  };
  box.onclick = async (e) => {
    const a = e.target.closest('[data-pv]')?.dataset.pv;
    if (a === 'close') { box.hidden = true; box.innerHTML = ''; }
    else if (a === 'prev' && page > 1) { page--; await draw(); }
    else if (a === 'next' && page < total) { page++; await draw(); }
    else if (a === 'zoom') { zoom = zoom === 1 ? 2 : zoom === 2 ? 3 : 1; await draw(); }
  };
  await draw();
}
