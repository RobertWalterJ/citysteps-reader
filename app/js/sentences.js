// Split a block of text into sentences and words, keeping character offsets
// so the reader can highlight exactly what is being spoken.
//
// The sentence pattern comes from CitySteps Studio's collectReadSentences.
// Added here: abbreviations common in planning and academic text ("e.g.",
// "St.", "No.", "Fig.") do not end a sentence, and a very long sentence is
// cut at a comma or semicolon so the built-in voice never gets a clause it
// might choke on.

// Sentences are cut at boundaries (end punctuation, any closing quotes or
// brackets, then a space), so every character lands in some sentence.
// Studio's original pattern matched sentences instead, and silently dropped
// text it could not match ("See e.g. the Plan" lost "See e.").
const BOUND_RE = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
const ABBR = /\b(e\.g|i\.e|n\.d|etc|vs|cf|al|Dr|Mr|Mrs|Ms|St|Ave|Rd|Blvd|No|Nos|Fig|Figs|Vol|pp|p|ch|ed|eds|approx|Inc|Ltd|Co|Corp|Jr|Sr|Ont|Prof|Sec|s|ss|O\.Reg|Reg|Cl)\.$/i;
const MAX = 260;

export function splitSentences(text) {
  const raw = [];
  let from = 0;
  for (const m of text.matchAll(BOUND_RE)) {
    const end = m.index + m[0].length;
    if (text.slice(from, end).trim()) raw.push({ start: from, end });
    from = end;
  }
  if (text.slice(from).trim()) raw.push({ start: from, end: text.length });
  // Glue abbreviation breaks and initials ("J. D. Hulchanski") back together.
  const glued = [];
  for (const r of raw) {
    const prev = glued[glued.length - 1];
    if (prev) {
      const before = text.slice(prev.start, prev.end).trimEnd();
      const next = text.slice(r.start, r.end).trimStart();
      if (ABBR.test(before) || /\b[A-Z]\.$/.test(before) || /^[a-z0-9(]/.test(next)) { prev.end = r.end; continue; }
    }
    glued.push({ ...r });
  }
  const out = [];
  for (const g of glued) {
    // Trim leading space so offsets point at the first real character.
    let { start, end } = g;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start) continue;
    for (const piece of cut(text, start, end)) out.push({ ...piece, words: words(text, piece.start, piece.end) });
  }
  return out;
}

function cut(text, start, end) {
  if (end - start <= MAX) return [{ start, end }];
  const pieces = [];
  let s = start;
  while (end - s > MAX) {
    const window = text.slice(s, s + MAX);
    let k = Math.max(window.lastIndexOf('; '), window.lastIndexOf(', '), window.lastIndexOf(': '));
    if (k < MAX * 0.4) k = window.lastIndexOf(' ');
    if (k <= 0) k = MAX;
    pieces.push({ start: s, end: s + k + 1 });
    s = s + k + 1;
    while (s < end && /\s/.test(text[s])) s++;
  }
  if (end > s) pieces.push({ start: s, end });
  return pieces;
}

function words(text, start, end) {
  const out = [];
  const re = /\S+/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(text)) && m.index < end) out.push({ start: m.index, end: Math.min(end, m.index + m[0].length) });
  return out;
}
