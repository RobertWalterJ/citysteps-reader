// Reading scanned pages (OCR) on the phone, with Tesseract.js.
//
// A scanned page has no text layer (PLAN.md 3.3: the Phase 0 spike found 0
// text items on one). Each such page is drawn by PDF.js, read by Tesseract,
// and the words that come back confidently are turned into positioned text
// items, the same shape PDF.js gives for a born-digital page. The layout
// engine then treats them like any other page, so columns, running headers
// and page numbers on scans are handled by the same, tested code.
//
// The engine and English data come from the jsDelivr CDN once and are cached
// by the browser ($0, D2). Nothing leaves the phone.

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;

const SCALE = 2.5;          // about 180 dpi: readable text without a huge image on a phone
const MIN_WORD_CONF = 55;   // below this a "word" is usually a smudge, a photo edge or an ad
const MIN_PAGE_WORDS = 12;  // fewer confident words than this: a photo or a map, not text

let tess = null, tessBusy = Promise.resolve();

async function engine(onStatus) {
  if (tess) return tess;
  // The bundled library exposes only a default export.
  const mod = await import('tesseract.js');
  const createWorker = mod.createWorker || mod.default?.createWorker;
  tess = await createWorker('eng', 1, {
    logger: (m) => { if (m.status === 'loading language traineddata' || m.status === 'loading tesseract core') onStatus?.({ state: 'loading', progress: m.progress }); },
  });
  return tess;
}

// A page's words -> text items in PDF coordinates (origin bottom left, like PDF.js).
export function wordsToItems(data, pageH, scale = SCALE) {
  const items = [];
  let kept = 0, confSum = 0;
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      // One size per paragraph: line heights from OCR wobble a little, and
      // the layout engine finds headings by size.
      const heights = para.lines.map((l) => l.rowAttributes?.rowHeight || (l.bbox.y1 - l.bbox.y0)).sort((a, b) => a - b);
      const size = Math.round((heights[Math.floor(heights.length / 2)] / scale) * 0.8 * 2) / 2 || 10;
      for (const line of para.lines) {
        const desc = line.rowAttributes?.descenders ?? 0;
        const base = pageH - (line.bbox.y1 - desc) / scale;
        for (const w of line.words) {
          const text = (w.text || '').trim();
          if (!text || w.confidence < MIN_WORD_CONF) continue;
          kept++; confSum += w.confidence;
          items.push({ s: text + ' ', x: w.bbox.x0 / scale, y: base, w: (w.bbox.x1 - w.bbox.x0) / scale, size, font: 'ocr' });
        }
      }
    }
  }
  const conf = kept ? confSum / kept : 0;
  return { items: kept >= MIN_PAGE_WORDS ? items : [], words: kept, conf: Math.round(conf) };
}

// Read the given pages of a PDF. Resolves to { [page]: { items, words, conf } }.
export async function ocrPages(blob, pages, { onPage, onStatus, done = {} } = {}) {
  const run = async () => {
    const t = await engine(onStatus);
    const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false });
    const pdf = await task.promise;
    const out = { ...done };
    try {
      for (const n of pages) {
        if (out[n]) continue;
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: SCALE });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        // 'print' draws without requestAnimationFrame, so it also runs when
        // the app is not on screen.
        await page.render({ canvas, canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
        const { data } = await t.recognize(canvas, {}, { blocks: true, text: false });
        out[n] = wordsToItems(data, base.height);
        canvas.width = canvas.height = 0;
        page.cleanup();
        onPage?.(n, out[n], out);
      }
    } finally {
      await task.destroy();
    }
    return out;
  };
  // One document at a time: two would fight over the phone's processor.
  const p = tessBusy.then(run, run);
  tessBusy = p.catch(() => {});
  return p;
}

export async function stopOcr() {
  try { await tess?.terminate(); } catch { /* ignore */ }
  tess = null;
}
