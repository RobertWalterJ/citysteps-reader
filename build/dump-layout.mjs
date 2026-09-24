// Look at what the layout engine makes of a PDF.
//
//   node build/dump-layout.mjs test-fixtures/local/1a-stark.pdf [maxBlocks]
//
// Prints the stats, then one line per block: kind, page, first words.
// For eyeballing only; the output contains document text, so never commit it.

import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPages } from '../app/js/parse/extract.js';
import { layout } from '../app/js/parse/layout.js';

export async function parseFile(file) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
  const pages = await extractPages(doc);
  return layout(pages);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('dump-layout.mjs')) {
  const [file, max = 60, only] = process.argv.slice(2);
  const { blocks, sections, stats } = await parseFile(file);
  console.log(JSON.stringify(stats));
  console.log('sections:', sections.map((s) => `${'#'.repeat(s.level)} ${s.title.slice(0, 50)}`).join(' | '));
  const kinds = {};
  for (const b of blocks) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
  console.log('kinds:', JSON.stringify(kinds));
  for (const b of (only ? blocks.filter((x) => x.kind === only) : blocks).slice(0, +max)) console.log(`${String(b.seq).padStart(3)} p${b.page} ${b.kind.padEnd(9)} ${b.level ? 'L' + b.level : '  '} ${b.text.slice(0, 110).replace(/\n/g, ' / ')}`);
}
