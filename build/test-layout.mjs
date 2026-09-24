// Parser regression test on Robert's real PDFs.
//
//   node build/test-layout.mjs
//
// The brief (Sept 2026): "drop a two-column academic paper or a Toronto staff
// report onto my phone ... hear it read in the right order without page
// headers, footnote numbers and reference lists getting in the way."
//
// The PDFs are copyrighted and live only in test-fixtures/local/ (gitignored),
// so this test checks structure (counts, kinds, order markers) and never
// stores their text. A fixture that is missing is skipped, not failed, so the
// check still runs on a machine without them.

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from './dump-layout.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', 'local');
const kinds = (r) => r.blocks.reduce((m, b) => ((m[b.kind] = (m[b.kind] || 0) + 1), m), {});
const idx = (r, re) => r.blocks.findIndex((b) => re.test(b.text));

const CASES = {
  '1a-stark.pdf': (r, k) => [
    ['two-column pages found', r.stats.twoColumnPages >= 8],
    ['running headers dropped', r.stats.runningDropped >= 8],
    ['references section found and skipped', k.reference >= 20],
    // Page 1 has a full-width abstract above two columns; the left column
    // ("It is well established...") must come before the right one.
    ['page 1 columns in order', idx(r, /^It is well established/) >= 0 && idx(r, /^It is well established/) < idx(r, /^The need to consider/)],
    ['bold subheading at body size is a heading', r.blocks.some((b) => b.kind === 'heading' && /^Revitalization or Gentrification\?$/.test(b.text))],
    ['no reference split mid-entry', !r.blocks.some((b) => b.kind === 'reference' && /^[a-z]/.test(b.text))],
  ],
  '1b-studentification.pdf': (r, k) => [
    ['two-column pages found', r.stats.twoColumnPages >= 17],
    ['abstract is the real abstract', r.blocks.some((b) => b.kind === 'abstract' && b.text.length > 400)],
    ['garbled Chinese abstract not read', k.other >= 1],
    ['references found', k.reference >= 40],
  ],
  '1c-carson.pdf': (r, k) => [
    ['references found', k.reference >= 1],
    ['footnotes found', k.footnote >= 1],
  ],
  '1d-keil.pdf': (r, k) => [
    ['running headers dropped on every page', r.stats.runningDropped >= 28],
    ['footnotes found', k.footnote >= 8],
    ['epigraph is not a heading', !r.blocks.some((b) => b.kind === 'heading' && /^“I’ve said/.test(b.text))],
  ],
  '2a-memo.pdf': (r, k) => [
    ['text found', k.para >= 10],
  ],
  '2b-iz-table.pdf': (r, k) => [
    ['tables become table blocks', k.table >= 4],
    ['little table text leaks into prose', (k.para || 0) <= 9],
  ],
  '2c-cpps-report.pdf': (r, k) => [
    ['126 pages parsed', r.stats.pages === 126],
    ['contents page skipped', k.contents >= 20],
    ['tables found', k.table >= 30],
    // The appendix's own footer ("Town of Saugeen Shores – Affordable Housing
    // ... Engagement Summary", page number on the same line) was read as 39
    // footnotes until v4 learned running headers that last only a stretch.
    ['running headers and page numbers dropped', r.stats.runningDropped + r.stats.pageNumbersDropped >= 350],
    ['appendix footer is not a footnote', !r.blocks.some((b) => b.kind === 'footnote' && /Engagement Sum/.test(b.text))],
    ['appendix running header is not a section', r.sections.filter((s) => /Engagement Overview/.test(s.title)).length <= 1],
    ['formulas not read as prose', (k.formula || 0) >= 1],
  ],
  '3-globe.pdf': (r, k) => [
    ['browser print header and footer dropped', r.stats.runningDropped >= 8],
    ['a sentence split across lines stays one paragraph', !r.blocks.some((b) => b.kind === 'heading' && /landed$/.test(b.text.replace(/[“"]/g, '')))],
  ],
  '4-scan.pdf': (r) => [
    ['scan detected', r.stats.scanPages.length === 1 && r.blocks[0].kind === 'scan'],
  ],
};

let failed = 0, ran = 0;
for (const [file, check] of Object.entries(CASES)) {
  const path = join(DIR, file);
  if (!existsSync(path)) { console.log(`  skip  ${file} (not in test-fixtures/local)`); continue; }
  ran++;
  const r = await parseFile(path);
  for (const [name, ok] of check(r, kinds(r))) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${file}: ${name}`);
  }
}
console.log(ran ? `layout: ${failed ? failed + ' failed' : 'all passed'} (${ran} documents)` : 'layout: no fixtures present, skipped');
if (failed) process.exit(1);
