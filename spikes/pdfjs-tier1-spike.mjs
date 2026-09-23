// Phase 0 spike: how far do PDF.js text items + simple heuristics get us?
// Not app code. Measures: text layer present, columns found, running
// headers/footers found, footnote-size lines, references heading, and dumps
// a reading-order sample for eyeballing.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
import path from 'node:path';

const MAXPAGES = +process.env.MAXPAGES || 12;

function norm(s) { return s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase(); }

async function pageLines(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = tc.items.filter(i => i.str && i.str.trim()).map(i => {
    const size = Math.hypot(i.transform[0], i.transform[1]) || i.height || 10;
    return { s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, size };
  });
  // item-level gutter first: a vertical band that almost no text item crosses
  const H = vp.height, W = vp.width;
  const bodyItems = items.filter(i => i.y > H * 0.08 && i.y < H * 0.92);
  let gut = null;
  if (bodyItems.length > 40) {
    for (let x = W * 0.3; x <= W * 0.7; x += W / 300) {
      const cross = bodyItems.filter(i => i.x < x - 1 && i.x + i.w > x + 1).length;
      const L = bodyItems.filter(i => i.x + i.w <= x).length, R = bodyItems.filter(i => i.x >= x).length;
      const sc = cross / bodyItems.length;
      if (L > bodyItems.length * 0.2 && R > bodyItems.length * 0.2 && sc < 0.04 && (!gut || sc < gut.score)) gut = { x, score: sc };
    }
  }
  const side = i => !gut ? 0 : (i.x + i.w <= gut.x + 1 ? 1 : i.x >= gut.x - 1 ? 2 : 0);
  // group into lines by baseline, never merging across the gutter
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    let ln = lines.find(l => (side(it) === 0 || l.side === side(it)) && Math.abs(l.y - it.y) < Math.max(2, it.size * 0.35) &&
      (it.x > l.x1 - 2 ? it.x - l.x1 < it.size * 3 : true));
    if (!ln) { ln = { side: side(it), y: it.y, x0: it.x, x1: it.x + it.w, parts: [], size: it.size }; lines.push(ln); }
    ln.parts.push(it); ln.x0 = Math.min(ln.x0, it.x); ln.x1 = Math.max(ln.x1, it.x + it.w);
    ln.size = Math.max(ln.size, it.size);
  }
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    let t = '';
    let prevEnd = null;
    for (const p of l.parts) {
      if (prevEnd !== null && p.x - prevEnd > p.size * 0.15 && !t.endsWith(' ')) t += ' ';
      t += p.s; prevEnd = p.x + p.w;
    }
    l.text = t.replace(/\s+/g, ' ').trim();
  }
  return { W: vp.width, H: vp.height, lines, nItems: items.length, itemGutter: gut };
}

// Find a vertical gutter: an x band with no line crossing it over most of the body.
function findGutter(pg) {
  const body = pg.lines.filter(l => l.y > pg.H * 0.08 && l.y < pg.H * 0.92);
  if (body.length < 12) return null;
  const step = pg.W / 200;
  let best = null;
  for (let x = pg.W * 0.3; x <= pg.W * 0.7; x += step) {
    const crossing = body.filter(l => l.x0 < x - 1 && l.x1 > x + 1).length;
    const left = body.filter(l => l.x1 <= x).length, right = body.filter(l => l.x0 >= x).length;
    const score = crossing / body.length;
    if (left > 5 && right > 5 && score < 0.12 && (!best || score < best.score)) best = { x, score, left, right };
  }
  return best;
}

function readingOrder(pg, gutter, drop) {
  const keep = pg.lines.filter(l => !drop.has(l));
  if (!gutter) return keep.sort((a, b) => b.y - a.y);
  // full-width lines (crossing gutter) act as separators; between separators read left col then right col
  const sorted = keep.sort((a, b) => b.y - a.y);
  const out = []; let band = [];
  const flush = () => {
    out.push(...band.filter(l => l.x1 <= gutter.x + 2).sort((a, b) => b.y - a.y));
    out.push(...band.filter(l => l.x1 > gutter.x + 2).sort((a, b) => b.y - a.y));
    band = [];
  };
  for (const l of sorted) {
    if (l.x0 < gutter.x - 1 && l.x1 > gutter.x + 1) { flush(); out.push(l); } else band.push(l);
  }
  flush();
  return out;
}

async function run(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await getDocument({ data, verbosity: 0 }).promise;
  const n = Math.min(doc.numPages, MAXPAGES);
  const pages = [];
  for (let p = 1; p <= n; p++) pages.push(await pageLines(await doc.getPage(p)));
  const r = { file: path.basename(file), pages: doc.numPages, sampled: n };
  r.itemsPerPage = Math.round(pages.reduce((s, p) => s + p.nItems, 0) / n);
  r.textLayer = r.itemsPerPage > 5 ? 'yes' : 'NONE -> route to OCR/Tier 2';
  let tagged = false;
  try { const md = await doc.getMarkInfo(); tagged = !!md?.Marked; } catch {}
  r.tagged = tagged;
  // running header/footer: normalised text in top/bottom 9% repeated on >=40% of pages
  const counts = new Map();
  for (const pg of pages) {
    const seen = new Set();
    for (const l of pg.lines) if (l.y > pg.H * 0.91 || l.y < pg.H * 0.09) { const k = norm(l.text); if (k && !seen.has(k)) { seen.add(k); counts.set(k, (counts.get(k) || 0) + 1); } }
  }
  const running = new Set([...counts].filter(([k, c]) => n >= 3 && c >= Math.max(2, n * 0.4)).map(([k]) => k));
  r.runningHeaders = [...running].slice(0, 6);
  // body font = most common size
  const hist = new Map();
  for (const pg of pages) for (const l of pg.lines) { const k = Math.round(l.size * 2) / 2; hist.set(k, (hist.get(k) || 0) + l.text.length); }
  const bodySize = [...hist].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  r.bodyFont = bodySize;
  let cols = 0, fnLines = 0, pageNums = 0, refs = null;
  const sample = [];
  pages.forEach((pg, i) => {
    const g = pg.itemGutter || findGutter(pg); if (g) cols++;
    const drop = new Set();
    for (const l of pg.lines) {
      const edge = l.y > pg.H * 0.91 || l.y < pg.H * 0.09;
      if (edge && running.has(norm(l.text))) drop.add(l);
      else if (edge && /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d+)?$/i.test(l.text)) { drop.add(l); pageNums++; }
      else if (l.y < pg.H * 0.25 && l.size < bodySize * 0.85 && /^\d{1,3}\s?\S/.test(l.text)) { fnLines++; }
      if (!refs && /^(references|bibliography|works cited|literature cited|endnotes)$/i.test(l.text)) refs = `p${i + 1}`;
    }
    if (i < 2) {
      let txt = readingOrder(pg, g, drop).map(l => l.text).join('\n');
      txt = txt.replace(/(\w)-\n(\w)/g, '$1$2');
      sample.push(`--- p${i + 1} ${g ? `[2-col gutter @${Math.round(g.x)}/${Math.round(pg.W)}]` : '[1-col]'} ---\n` + txt.slice(0, 900));
    }
  });
  Object.assign(r, { pagesWithColumns: `${cols}/${n}`, pageNumbersDropped: pageNums, footnoteLikeLines: fnLines, referencesHeading: refs || 'not found' });
  return { r, sample: sample.join('\n') };
}

const files = process.argv.slice(2);
let report = '';
for (const f of files) {
  try {
    const { r, sample } = await run(f);
    report += `\n==================== ${r.file}\n${JSON.stringify(r, null, 1)}\n${sample}\n`;
  } catch (e) { report += `\n==================== ${path.basename(f)}\nERROR ${e.message}\n`; }
}
fs.writeFileSync('report.txt', report);
console.log(report.length, 'chars written to report.txt');
