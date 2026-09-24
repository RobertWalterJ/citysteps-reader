// Tier 1 layout: turn raw PDF text items into an ordered list of blocks.
//
// Measured on Robert's real PDFs in Phase 0 (spikes/pdfjs-tier1-spike.mjs).
// The one lesson that shaped this file: find column gutters from the
// individual text items FIRST, then build lines that never cross a gutter.
// Building lines first merged the two columns of the Stark paper into
// sentences that ran straight across the page.
//
// Input: pages from extract.js. Output: { blocks, sections, stats }.
// Pure functions, no DOM, no PDF.js: runs in the worker and in Node tests.

export const LAYOUT_VERSION = 3;

const HEAD_BAND = 0.09;          // top and bottom 9% of a page: where running headers live
const REFS_RE = /^(\d+\.?\s*)?(references|bibliography|works cited|literature cited|sources|endnotes|notes|reference list)\s*:?$/i;
const ABSTRACT_RE = /^(abstract|summary|executive summary)\s*:?$/i;
const CAPTION_RE = /^(figure|fig\.|table|map|chart|exhibit|photo|image|plate|diagram|graph)\s*[\dIVX]+[a-z]?\b/i;

// ---------- per page: gutter, lines ----------

// Join items that touch on the same baseline. A ligature ("ff", "Th") breaks
// a line into pieces with no gap between them; a real column gutter is at
// least half a character wide.
function runs(items) {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const out = [];
  for (const i of sorted) {
    const r = out[out.length - 1];
    if (r && Math.abs(r.y - i.y) < Math.max(1.5, i.size * 0.3) && i.x >= r.x + r.w - 1 && i.x - (r.x + r.w) < i.size * 0.5) {
      r.w = i.x + i.w - r.x; r.s += i.s;
    } else out.push({ ...i });
  }
  return out;
}

function findGutter(page) {
  const { W, H } = page;
  const body = runs(page.items.filter((i) => i.y > H * HEAD_BAND && i.y < H * (1 - HEAD_BAND)));
  if (body.length < 30) return null;
  // A full-width abstract or title above the columns crosses the gutter, so
  // only crossings INSIDE the vertical band the columns occupy count against
  // it (Phase 1: page 1 of the Stark paper).
  let best = null;
  for (let x = W * 0.3; x <= W * 0.7; x += W / 300) {
    const crossing = [];
    let L = 0, R = 0, loL = Infinity, hiL = -Infinity, loR = Infinity, hiR = -Infinity;
    for (const i of body) {
      if (i.x < x - 1 && i.x + i.w > x + 1) crossing.push(i);
      // Ligature fragments ("ff", "Th") split full-width lines into tiny
      // items; they must not stretch a column's extent (Stark, page 1).
      else if (i.s.trim().length < 4) continue;
      else if (i.x + i.w <= x) { L++; loL = Math.min(loL, i.y); hiL = Math.max(hiL, i.y); }
      else { R++; loR = Math.min(loR, i.y); hiR = Math.max(hiR, i.y); }
    }
    if (L < body.length * 0.15 || R < body.length * 0.15) continue;
    // A crossing only counts when both columns carry on above AND below it.
    const top = Math.min(hiL, hiR), bottom = Math.max(loL, loR);
    const inside = crossing.filter((i) => i.y < top && i.y > bottom).length;
    const score = inside / body.length;
    if (score < 0.04 && (!best || score < best.score)) best = { x, score };
  }
  return best ? best.x : null;
}

function buildLines(page, gutter) {
  const side = (i) => (gutter == null ? 0 : i.x + i.w <= gutter + 1 ? 1 : i.x >= gutter - 1 ? 2 : 0);
  const items = page.items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const sd = side(it);
    let ln = null;
    for (let k = lines.length - 1; k >= 0 && k >= lines.length - 12; k--) {
      const l = lines[k];
      if ((sd === 0 || l.side === sd || l.side === 0) && Math.abs(l.y - it.y) < Math.max(2, it.size * 0.4) &&
          (it.x >= l.x1 - 2 ? it.x - l.x1 < it.size * 3 : true)) { ln = l; break; }
    }
    if (!ln) { ln = { side: sd, y: it.y, x0: it.x, x1: it.x + it.w, parts: [], size: it.size, page: page.n }; lines.push(ln); }
    ln.parts.push(it);
    ln.x0 = Math.min(ln.x0, it.x); ln.x1 = Math.max(ln.x1, it.x + it.w);
    ln.size = Math.max(ln.size, it.size);
  }
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    let t = '', prevEnd = null;
    l.segments = 1;
    for (const p of l.parts) {
      const gap = prevEnd == null ? 0 : p.x - prevEnd;
      if (prevEnd != null && gap > p.size * 1.5) l.segments++;
      if (prevEnd != null && gap > p.size * 0.15 && !t.endsWith(' ') && !p.s.startsWith(' ')) t += ' ';
      t += p.s; prevEnd = p.x + p.w;
    }
    l.text = t.replace(/\s+/g, ' ').trim();
    // Size of the dominant text on the line, not the biggest glyph (a drop cap
    // or a superscript should not turn a body line into a heading).
    const bySize = new Map();
    for (const p of l.parts) bySize.set(Math.round(p.size * 2) / 2, (bySize.get(Math.round(p.size * 2) / 2) || 0) + p.s.length);
    l.size = [...bySize].sort((a, b) => b[1] - a[1])[0][0];
    const byFont = new Map();
    for (const p of l.parts) byFont.set(p.font, (byFont.get(p.font) || 0) + p.s.length);
    l.font = [...byFont].sort((a, b) => b[1] - a[1])[0][0];
    l.h = l.size;
  }
  return lines.filter((l) => l.text);
}

// Reading order: full-width lines split the page into bands; within a band,
// the left column is read before the right.
function order(lines, gutter) {
  const sorted = lines.slice().sort((a, b) => b.y - a.y || a.x0 - b.x0);
  if (gutter == null) return sorted;
  const out = []; let band = [];
  const flush = () => {
    out.push(...band.filter((l) => l.x1 <= gutter + 2));
    out.push(...band.filter((l) => l.x1 > gutter + 2));
    band = [];
  };
  for (const l of sorted) {
    if (l.x0 < gutter - 1 && l.x1 > gutter + 1) { flush(); out.push(l); } else band.push(l);
  }
  flush();
  return out;
}

// ---------- tables ----------

// A row is "tabular" when it breaks into three or more cells with wide gaps
// and the cells are short. Two-column prose gives two long segments per row,
// so it never qualifies. Tables are shown as cards, never read as prose: the
// Toronto inclusionary zoning scan read as word salad in Phase 0.
function tableRegions(page) {
  const rows = [];
  const items = page.items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of items) {
    let r = rows.find((q) => Math.abs(q.y - it.y) < Math.max(2, it.size * 0.4));
    if (!r) { r = { y: it.y, parts: [] }; rows.push(r); }
    r.parts.push(it);
  }
  for (const r of rows) {
    r.parts.sort((a, b) => a.x - b.x);
    const cells = []; let cur = null;
    for (const p of r.parts) {
      if (cur && p.x - cur.x1 <= p.size * 1.5) { cur.t += ' ' + p.s; cur.x1 = p.x + p.w; }
      else { cur = { t: p.s, x0: p.x, x1: p.x + p.w }; cells.push(cur); }
    }
    const lens = cells.map((c) => c.t.trim().length).sort((a, b) => a - b);
    r.cells = cells;
    r.tab = cells.length >= 3 && lens[Math.floor(lens.length / 2)] < 28;
  }
  rows.sort((a, b) => b.y - a.y);
  // Runs of tabular rows, allowing two plain rows inside (wrapped cells).
  const regions = [];
  let start = -1, lastTab = -1;
  for (let k = 0; k <= rows.length; k++) {
    const r = rows[k];
    if (r && r.tab) { if (start < 0) start = k; lastTab = k; continue; }
    if (start >= 0 && (!r || k - lastTab > 2)) {
      const run = rows.slice(start, lastTab + 1);
      if (run.filter((q) => q.tab).length >= 4) {
        // Wrapped cells leave short two-cell rows under the grid; they belong
        // to it. Two-column prose also gives two cells, but long ones.
        let end = lastTab;
        const shortCells = (q) => q.cells.length >= 2 && q.cells.every((c) => c.t.trim().length < 40);
        while (rows[end + 1] && shortCells(rows[end + 1])) end++;
        const all = rows.slice(start, end + 1);
        regions.push({ top: all[0].y + 12, bottom: all[all.length - 1].y - 4, rows: all });
        k = end;
      }
      start = -1;
    }
  }
  return regions;
}

// ---------- document level ----------

const norm = (s) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
const isPageNumber = (t) => /^((page|p\.)\s*)?[\divxlc]{1,5}(\s*(of|\/)\s*\d+)?$/i.test(t) || /^[-–|•]\s*\d{1,4}\s*[-–|•]$/.test(t);

export function layout(pages) {
  const stats = { pages: pages.length, textPages: 0, scanPages: [], twoColumnPages: 0, runningDropped: 0, pageNumbersDropped: 0, tables: 0, footnotes: 0, tagged: false };
  const per = pages.map((pg) => {
    const scan = pg.items.length < 5;
    if (scan) { stats.scanPages.push(pg.n); return { pg, scan, lines: [], tables: [] }; }
    stats.textPages++;
    const tables = tableRegions(pg);
    // Take table rows out before looking for a gutter: a grid of cells can
    // look like two columns.
    const inTable = (i) => tables.some((t) => i.y <= t.top && i.y >= t.bottom);
    const prose = { ...pg, items: pg.items.filter((i) => !inTable(i)) };
    const gutter = findGutter(prose);
    if (gutter != null) stats.twoColumnPages++;
    const lines = order(buildLines(prose, gutter), gutter);
    return { pg, scan, lines, tables, gutter };
  });

  // Body text size: the size carrying the most characters.
  const hist = new Map();
  for (const p of per) for (const l of p.lines) { const k = l.size; hist.set(k, (hist.get(k) || 0) + l.text.length); }
  const body = [...hist].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const fonts = new Map();
  for (const p of per) for (const l of p.lines) fonts.set(l.font, (fonts.get(l.font) || 0) + l.text.length);
  const bodyFont = [...fonts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  // Running headers and footers: same text (numbers ignored) in the top or
  // bottom band on at least 40% of pages.
  const n = per.filter((p) => !p.scan).length;
  const seen = new Map();
  for (const p of per) {
    const mine = new Set();
    for (const l of p.lines) if (edge(l, p.pg)) { const k = norm(l.text); if (k && !mine.has(k)) { mine.add(k); seen.set(k, (seen.get(k) || 0) + 1); } }
  }
  const running = new Set([...seen].filter(([, c]) => n >= 2 && c >= Math.max(2, Math.ceil(n * 0.4))).map(([k]) => k));

  // Heading sizes: distinct sizes clearly above body, ranked.
  const headSizes = [...hist.keys()].filter((s) => s >= body * 1.12).sort((a, b) => b - a);
  const levelOf = (size) => Math.min(3, Math.max(1, headSizes.findIndex((s) => Math.abs(s - size) < 0.6) + 1 || 3));

  const blocks = [];
  const push = (b) => { b.seq = blocks.length; blocks.push(b); return b; };

  for (const p of per) {
    const { pg } = p;
    if (p.scan) { push({ kind: 'scan', page: pg.n, text: '', bbox: { page: pg.n, x: 0, y: 0, w: pg.W, h: pg.H } }); continue; }

    // Tables become one block each, positioned by their top edge.
    const tableBlocks = p.tables.map((t) => ({
      kind: 'table', page: pg.n, y: t.top,
      text: t.rows.map((r) => r.cells.map((c) => c.t.trim()).join(' | ')).join('\n'),
      bbox: { page: pg.n, x: 0, y: t.bottom, w: pg.W, h: t.top - t.bottom },
    }));
    stats.tables += tableBlocks.length;

    // Drop running heads and page numbers; mark footnotes.
    const kept = [];
    let lowestBody = Infinity;
    for (const l of p.lines) if (l.size >= body * 0.9) lowestBody = Math.min(lowestBody, l.y);
    for (const l of p.lines) {
      if (edge(l, pg) && running.has(norm(l.text))) { stats.runningDropped++; continue; }
      if (edge(l, pg) && isPageNumber(l.text)) { stats.pageNumbersDropped++; continue; }
      l.foot = l.y < pg.H * 0.3 && l.y < lowestBody && l.size <= body * 0.88;
      kept.push(l);
    }

    // Where each column's text normally ends, to spot short lines.
    const right = {};
    for (const sd of [0, 1, 2]) {
      const xs = kept.filter((l) => l.side === sd).map((l) => l.x1).sort((a, b) => a - b);
      right[sd] = xs.length ? xs[Math.floor(xs.length * 0.9)] : pg.W;
    }
    right.left = {};
    for (const sd of [0, 1, 2]) {
      const xs = kept.filter((l) => l.side === sd).map((l) => l.x0).sort((a, b) => a - b);
      right.left[sd] = xs.length ? xs[Math.floor(xs.length * 0.1)] : 0;
    }
    // Lines into paragraphs.
    let para = null;
    const flush = () => { if (para) { push(finish(para, body, levelOf, bodyFont)); para = null; } };
    let ti = 0;
    for (const l of kept) {
      while (ti < tableBlocks.length && tableBlocks[ti].y > l.y) { flush(); push(tableBlocks[ti++]); }
      if (para && continues(para, l, body, right)) { add(para, l); continue; }
      flush();
      para = { lines: [l], page: pg.n, x0: l.x0, x1: l.x1, top: l.y, bottom: l.y, size: l.size, foot: l.foot, side: l.side, font: l.font };
    }
    flush();
    while (ti < tableBlocks.length) push(tableBlocks[ti++]);
  }

  // Paragraphs that continue across a page or column break: the first block
  // of the new column starts lower-case and the last one did not end a sentence.
  const merged = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === 'para' && b.kind === 'para' && !/[.!?:;"”’)]$/.test(prev.text) && /^[a-z(]/.test(b.text)) {
      prev.text = joinText(prev.text, b.text);
      prev.pages = [...new Set([...(prev.pages || [prev.page]), b.page])];
      continue;
    }
    merged.push(b);
  }

  // Section structure, abstract, references, captions.
  let inRefs = false, refLevel = 9, afterAbstract = false;
  const sections = [];
  for (const b of merged) {
    if (b.kind === 'heading') {
      if (REFS_RE.test(b.text)) { inRefs = true; refLevel = b.level; b.refsHeading = true; }
      else if (inRefs && b.level <= refLevel) inRefs = false;
      afterAbstract = ABSTRACT_RE.test(b.text);
      sections.push({ title: b.text, level: b.level, seq: b.seq });
      continue;
    }
    if (b.kind === 'para') {
      if (inRefs) b.kind = 'reference';
      // Contents pages: dotted leaders running to a page number.
      else if (/(\.\s?){5,}\s*[\divx]+\s*$/i.test(b.text) || /(\.\s?){5,}\s*[\divx]+\s/i.test(b.text)) b.kind = 'contents';
      // Text that is mostly outside the Latin alphabet in an English document:
      // either another language or a font with no text mapping (the Chinese
      // abstract in the Post-studentification paper came out as noise).
      else if (nonLatin(b.text) > 0.5) b.kind = nonLatin(b.text.normalize('NFKC')) > 0.5 ? 'other' : 'formula';
      else if (b.foot) { b.kind = 'footnote'; stats.footnotes++; }
      else if (CAPTION_RE.test(b.text)) b.kind = 'caption';
      // The abstract is the first substantial paragraph after its heading;
      // journal sidebars ("Urban Studies", a DOI line) can sit in between.
      else if (afterAbstract && b.text.length > 200) { b.kind = 'abstract'; afterAbstract = false; }
      else if (/^abstract[:.\s]/i.test(b.text) && b.text.length > 200) b.kind = 'abstract';
    }
  }
  // Reference entries use hanging indents: an indented block continues the
  // entry above it.
  for (let k = merged.length - 1; k > 0; k--) {
    const b = merged[k], prev = merged[k - 1];
    if (b.kind === 'reference' && prev.kind === 'reference' && b.page === prev.page && b.side === prev.side &&
        b.bbox.x > prev.bbox.x + 4) {
      prev.text = joinText(prev.text, b.text);
      merged.splice(k, 1);
    }
  }
  // A references section with no heading of its own (Phase 0: the Keil chapter)
  // is left alone rather than guessed at.

  merged.forEach((b, i) => { b.seq = i; delete b.foot; delete b.y; delete b.side; });
  for (const s of sections) s.seq = merged.findIndex((b) => b.kind === 'heading' && b.text === s.title && b.seq >= 0);
  stats.references = merged.some((b) => b.refsHeading);
  stats.body = body;
  stats.running = [...running];
  return { blocks: merged, sections: sections.filter((s) => s.seq >= 0), stats };
}

function nonLatin(t) {
  const letters = t.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters.length) return 0;
  return letters.replace(/[\p{Script=Latin}]/gu, '').length / letters.length;
}

function edge(l, pg) { return l.y > pg.H * (1 - HEAD_BAND) || l.y < pg.H * HEAD_BAND; }

function continues(para, l, body, right) {
  const last = para.lines[para.lines.length - 1];
  // A paragraph's first line runs the full column width. A short first line
  // with no closing punctuation is a subheading, whatever its font
  // ("Revitalization or Gentrification?" in the Stark paper shares a font id
  // with the paragraph under it).
  // Two guards learned in Phase 1: a next line starting lower-case continues a
  // sentence (Globe: "...as “landed" / "aristocrats"), and the break only
  // counts if the next line's first word would have fitted on this one.
  if (para.lines.length === 1 && Math.abs(last.size - body) < 0.9 && !/^[a-z]/.test(l.text) &&
      !/[.,;:]$/.test(last.text) && /^[A-Z0-9"“‘']/.test(last.text) && last.text.split(' ').length <= 14 &&
      last.x0 < (right.left[last.side] ?? last.x0) + last.size * 1.5) {
    const perChar = (l.x1 - l.x0) / Math.max(1, l.text.length);
    const nextWord = (l.text.split(' ')[0].length + 1) * perChar;
    if ((right[last.side] ?? last.x1) - last.x1 > nextWord + last.size * 1.5) { para.lead = true; return false; }
  }
  if (l.foot !== para.foot) return false;
  if (l.side !== last.side && last.side !== 0 && l.side !== 0) return false;
  const gap = last.y - l.y;                      // baseline to baseline
  const lead = Math.max(last.size, l.size);
  if (gap <= 0 || gap > lead * 1.75) return false;
  if (Math.abs(l.size - para.size) > 0.9) return false;
  // A short first line in another font, with no closing punctuation, is a
  // bold subheading at body size ("Revitalization or Gentrification?").
  if (para.lines.length === 1 && last.font !== l.font && last.text.length < 100 && !/[.,;:]$/.test(last.text)) return false;
  // A heading-sized line stands alone.
  if (para.size >= body * 1.12 && para.lines.length >= 3) return false;
  // First-line indent starts a new paragraph.
  if (l.x0 - para.x0 > lead * 0.9 && /[.!?:"”]$/.test(last.text)) return false;
  // A short line ending a sentence closes the paragraph.
  if (last.x1 < para.x1 - lead * 4 && /[.!?:"”]$/.test(last.text)) return false;
  // Bullets start new items.
  if (/^([•●▪◦‣\-–]|\(?[a-z0-9]{1,3}[.)])\s/i.test(l.text) && !/^\d+\.\d/.test(l.text)) return false;
  return true;
}

function add(para, l) {
  para.lines.push(l);
  para.x0 = Math.min(para.x0, l.x0); para.x1 = Math.max(para.x1, l.x1); para.bottom = l.y;
}

function joinText(a, b) {
  // "harm-" + "less" joins; "Weston-" + "Mount" keeps its hyphen.
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  if (/[A-Za-z]-$/.test(a)) return a + b;
  return a + ' ' + b;
}

function finish(para, body, levelOf, bodyFont) {
  let text = para.lines[0].text;
  for (let k = 1; k < para.lines.length; k++) text = joinText(text, para.lines[k].text);
  text = text.replace(/\s+/g, ' ').trim();
  const b = {
    kind: 'para', page: para.page, text, y: para.top, foot: para.foot, side: para.side,
    bbox: { page: para.page, x: para.x0, y: para.bottom, w: para.x1 - para.x0, h: para.top - para.bottom + para.size },
  };
  const short = text.length < 140 && para.lines.length <= 3 && !/[.,;]$/.test(text);
  if (short && para.size >= body * 1.12) { b.kind = 'heading'; b.level = levelOf(para.size); }
  else if (para.lead && para.lines.length === 1) { b.kind = 'heading'; b.level = 3; }
  else if (para.lines.length <= 2 && text.length < 110 && !/[.,;:]$/.test(text) && /^[A-Z"“‘']/.test(text) &&
           para.font !== bodyFont && Math.abs(para.size - body) < 0.9 && para.lines.every((l) => l.font === para.font)) { b.kind = 'heading'; b.level = 3; }
  else if (para.lines.length === 1 && text.length < 80 && !/[.,;:]$/.test(text) &&
           (/^(\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+[A-Z]/.test(text) || REFS_RE.test(text) || ABSTRACT_RE.test(text) ||
            (/^[A-Z][A-Z0-9 ,&'’\-–:]{3,}$/.test(text) && /[A-Z]{3}/.test(text)))) { b.kind = 'heading'; b.level = 3; }
  return b;
}

// What gets read aloud by default. The reader's skip switches can widen this.
export const READ_BY_DEFAULT = new Set(['heading', 'para', 'abstract']);
