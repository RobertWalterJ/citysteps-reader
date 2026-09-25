// Parse worker: PDF bytes in, document model out. Runs off the main thread so
// a 126-page report never freezes the screen.
//
// PDF.js normally starts its own worker. We are already in one, so its worker
// code is bundled in here and handed over as `globalThis.pdfjsWorker`, which
// makes PDF.js run in this thread instead of starting another.

import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs';
import { getDocument, OPS } from 'pdfjs-dist';
import { extractPages, readMeta } from './extract.js';
import { layout, LAYOUT_VERSION } from './layout.js';

globalThis.pdfjsWorker = pdfjsWorker;

self.onmessage = async (e) => {
  const { id, buf, ocr } = e.data;
  try {
    const task = getDocument({ data: new Uint8Array(buf), verbosity: 0, isEvalSupported: false });
    const doc = await task.promise;
    const meta = await readMeta(doc);
    const pages = await extractPages(doc, { OPS, onPage: (p, n) => self.postMessage({ id, progress: p / n }) });
    // Scanned pages that have been read by OCR (ocr.js) get their words back
    // as ordinary positioned text, so the same layout rules apply to them.
    for (const pg of pages) {
      const o = ocr?.[pg.n];
      if (!o || pg.items.length >= 5) continue;
      if (o.items?.length) pg.items = o.items;
      else pg.ocrTried = true;
    }
    const out = layout(pages);
    const sizes = pages.map((p) => [p.W, p.H]);
    await task.destroy();
    self.postMessage({ id, done: true, meta, sizes, layoutVersion: LAYOUT_VERSION, ...out });
  } catch (err) {
    const msg = /password/i.test(err?.name || err?.message || '') ? 'This PDF is password-protected.' : (err?.message || String(err));
    self.postMessage({ id, error: msg });
  }
};
