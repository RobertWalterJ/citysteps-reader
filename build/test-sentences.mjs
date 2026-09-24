// Sentence splitting: what the voice reads as one piece, and where the
// highlight jumps.
//
//   node build/test-sentences.mjs
//
// Planning and academic text is full of abbreviations and citations that a
// naive splitter breaks on ("St. Clair Ave.", "O. Reg. 299/10", "(Razack,
// 2002, p. 16)"). A break in the wrong place makes the voice pause mid-name
// and the highlight jump early.

import { splitSentences } from '../app/js/sentences.js';

const CASES = [
  ['Two plain sentences. Here is the second.', 2],
  ['The site is at 1240 Weston Rd. near Jane St. in the north-west. It is a tower.', 2],
  ['Residents were excluded (Razack, 2002, p. 16) from the process. Yet change came.', 2],
  ['See e.g. the Official Plan, i.e. the policy framework. Then read the by-law.', 2],
  ['As J. D. Hulchanski showed, the city is dividing. Incomes polarized.', 2],
  ['Is this revitalization? Or is it gentrification! Both, perhaps.', 3],
  ['“It’s how we do work that is replicable.” She paused. Then went on.', 3],
  ['No full stop at the end', 1],
];

// Every non-space character must land in exactly one sentence. Phase 1: the
// first splitter dropped "See e." from "See e.g. the Official Plan" and the
// counts still passed, so coverage is checked directly.
const covered = (text, got) => {
  const hit = new Array(text.length).fill(0);
  for (const s of got) for (let k = s.start; k < s.end; k++) hit[k]++;
  return [...text].every((ch, k) => /\s/.test(text[k]) ? hit[k] <= 1 : hit[k] === 1);
};

let failed = 0;
for (const [text, want] of CASES) {
  const got = splitSentences(text);
  const ok = got.length === want && covered(text, got) && got.every((s) => s.words.length > 0 && s.end > s.start);
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${want} expected, ${got.length} found: ${got.map((s) => '[' + text.slice(s.start, s.end) + ']').join(' ')}`);
}
// A very long sentence is cut at a comma so the built-in voice never gets a
// clause long enough to stall on.
const long = 'Planning, ' + 'which balances many interests across the city and its neighbourhoods, '.repeat(8) + 'is hard.';
const pieces = splitSentences(long);
const okLong = pieces.length > 1 && pieces.every((p) => p.end - p.start <= 262);
if (!okLong) failed++;
console.log(`  ${okLong ? 'ok  ' : 'FAIL'}  a ${long.length}-character sentence is cut into ${pieces.length} pieces`);
console.log(`sentences: ${failed ? failed + ' failed' : 'all passed'}`);
if (failed) process.exit(1);
