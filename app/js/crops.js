// Pictures of figures and tables, cut from the original page, for the cards
// in the reader. Drawn only when a card comes near the screen, so a long
// report does not render every figure at once.

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;

let current = { id: null, pdf: null, task: null };
const made = new Map();   // doc id + seq -> object URL
let observer = null;

async function pdfFor(id, blob) {
  if (current.id === id) return current.pdf;
  current.task?.destroy();
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false });
  current = { id, task, pdf: await task.promise };
  return current.pdf;
}

// Render one region (PDF units, origin bottom left) to a PNG object URL.
async function crop(pdf, n, box, cssWidth) {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const pad = 6;
  const x = Math.max(0, box.x - pad), w = Math.min(base.width - x, box.w + pad * 2);
  const top = Math.min(base.height, box.y + box.h + pad), h = Math.min(top, box.h + pad * 2);
  const scale = Math.min(4, (cssWidth * Math.min(2, devicePixelRatio || 1)) / w);
  const vp = page.getViewport({ scale, offsetX: -x * scale, offsetY: -(base.height - top) * scale });
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  // 'print' draws without requestAnimationFrame (works off screen too).
  await page.render({ canvas: c, canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  c.width = c.height = 0;
  return URL.createObjectURL(blob);
}

// Watch the reader's picture slots and fill them as they come into view.
export function watchCrops(root, id, blobOf) {
  observer?.disconnect();
  for (const [k, url] of made) if (!k.startsWith(id + ':')) { URL.revokeObjectURL(url); made.delete(k); }
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const slot = e.target;
      observer.unobserve(slot);
      const key = id + ':' + slot.dataset.seq;
      const show = (url) => { slot.innerHTML = `<img alt="${slot.dataset.alt}" src="${url}">`; slot.classList.add('ready'); };
      if (made.has(key)) { show(made.get(key)); continue; }
      (async () => {
        try {
          const blob = await blobOf();
          if (!blob) return;
          const pdf = await pdfFor(id, blob);
          const url = await crop(pdf, +slot.dataset.page, JSON.parse(slot.dataset.box), slot.clientWidth || 320);
          made.set(key, url);
          show(url);
        } catch { slot.textContent = 'The picture could not be drawn. Open the page to see it.'; }
      })();
    }
  }, { rootMargin: '600px 0px' });
  root.querySelectorAll('.crop[data-box]').forEach((s) => observer.observe(s));
}
