// Pull raw text items out of a PDF.js document, page by page.
//
// Kept separate from layout.js so the same layout code runs in the browser
// worker and in the Node tests (build/test-layout.mjs). This file only talks
// to the PDF.js API; it never imports PDF.js itself.

export async function extractPages(doc, { onPage } = {}) {
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
    pages.push({ n: p, W: vp.width, H: vp.height, items });
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
