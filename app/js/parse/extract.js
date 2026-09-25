// Pull raw text items out of a PDF.js document, page by page.
//
// Kept separate from layout.js so the same layout code runs in the browser
// worker and in the Node tests (build/test-layout.mjs). This file only talks
// to the PDF.js API; it never imports PDF.js itself.

// Where images land on a page (photos, maps drawn as images, tables pasted as
// pictures), from PDF.js's list of drawing operations: follow the transform
// stack and note each image's box. Measured cheap: 2.1 s for the 126-page
// CPPS report on the PC. OPS is PDF.js's operator table, passed in so this
// file never imports PDF.js.
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
async function imagesOn(page, OPS, W, H) {
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [], out = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (a?.[0]) ctm = mul(ctm, a[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]];
      const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]];
      // Clip to the page: images often bleed past the edge.
      const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(W, Math.max(...xs));
      const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(H, Math.max(...ys));
      const w = x1 - x0, h = y1 - y0;
      // Big enough to matter: not a logo, a rule or a bullet.
      if (w > 60 && h > 60 && w * h > W * H * 0.04) out.push({ x: x0, y: y0, w, h });
    }
  }
  return out;
}

export async function extractPages(doc, { onPage, OPS } = {}) {
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const i of tc.items) {
      if (!i.str || !i.str.trim()) continue;
      const t = i.transform;
      // Skip rotated text (vertical margin notes, watermarks). Reading it in
      // line with the body would splice it into sentences.
      if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;
      const size = Math.abs(t[3]) || Math.abs(t[0]) || i.height || 10;
      items.push({ s: i.str, x: t[4], y: t[5], w: i.width, size, font: i.fontName || '' });
    }
    const images = OPS ? await imagesOn(page, OPS, vp.width, vp.height).catch(() => []) : [];
    pages.push({ n: p, W: vp.width, H: vp.height, items, images });
    page.cleanup?.();
    onPage?.(p, doc.numPages);
  }
  return pages;
}

export async function readMeta(doc) {
  try {
    const m = await doc.getMetadata();
    const info = m?.info || {};
    const year = /(?:D:)?(\d{4})/.exec(info.CreationDate || '')?.[1];
    return {
      title: clean(info.Title),
      author: clean(info.Author),
      year: year ? +year : null,
      producer: clean(info.Producer),
    };
  } catch {
    return {};
  }
}

function clean(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  // Word and InDesign leave junk titles behind: file names, "untitled", "Microsoft Word - x.docx".
  if (!s || /^(untitled|document\d*|microsoft word\b)/i.test(s) || /\.(docx?|indd|pdf)$/i.test(s)) return '';
  return s;
}
