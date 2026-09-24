// Notes as Markdown: for export, for the GitHub backup (readable as an
// Obsidian vault), and for bringing CitySteps Studio notes in.
//
// Pure functions, no DOM, so build/test-notes.mjs runs them in Node.

export const TYPES = {
  idea: 'Idea',
  post: 'Post start',
  article: 'Article start',
  thread: 'Research thread',
};

export function slug(s, max = 60) {
  const out = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
  return out || 'note';
}

// The first real line of a note is its title (as in Studio).
export function titleOf(note) {
  if (note.title) return note.title;
  const line = String(note.body || '').split('\n').map((l) => l.replace(/^#+\s*|^[-*>]\s*/, '').trim()).find(Boolean);
  if (line) return line.length > 70 ? line.slice(0, 67) + '...' : line;
  return TYPES[note.type] || 'Note';
}

const yamlStr = (s) => JSON.stringify(String(s ?? ''));
const day = (t) => new Date(t).toISOString().slice(0, 10);

// Front matter + body + the passages it came from, quoted and cited.
export function noteToMarkdown(note) {
  const fm = [
    '---',
    `title: ${yamlStr(titleOf(note))}`,
    `type: ${yamlStr(TYPES[note.type] || note.type)}`,
    `created: ${day(note.createdAt)}`,
    `updated: ${day(note.updatedAt || note.createdAt)}`,
  ];
  if (note.tags?.length) fm.push(`tags: [${note.tags.map(yamlStr).join(', ')}]`);
  if (note.anchors?.length) {
    fm.push('sources:');
    for (const a of note.anchors) fm.push(`  - ${yamlStr(`${a.docTitle}${a.page ? ', p. ' + a.page : ''}`)}`);
  }
  if (note.importedFrom) fm.push(`imported_from: ${yamlStr(note.importedFrom)}`);
  fm.push('---', '');
  const body = String(note.body || '').trim();
  const cites = (note.anchors || []).filter((a) => a.quote).map((a) =>
    `> ${a.quote.replace(/\n+/g, ' ').trim()}\n>\n> ${a.docTitle}${a.authors ? ', ' + a.authors : ''}${a.year ? ' (' + a.year + ')' : ''}${a.page ? ', p. ' + a.page : ''}`);
  const parts = [fm.join('\n'), body];
  if (cites.length) parts.push('## Sparked by\n\n' + cites.join('\n\n'));
  const pending = (note.recordings || []).filter((r) => r.transcript?.status !== 'done').length;
  if (pending) parts.push(`*${pending} voice recording${pending > 1 ? 's' : ''} not yet transcribed.*`);
  return parts.filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// ---------- CitySteps Studio HTML to Markdown ----------
// Studio's editor is a contenteditable: h1-h3, p, blockquote, pre, nested
// ul/ol, hr, b/strong, i/em, u, a, br, plus its own .is-title/.is-subtitle
// classes. A small tokenizer is enough; no DOM needed.

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

export function htmlToMarkdown(html) {
  const out = [];
  let line = '';
  const lists = [];          // stack of { type: 'ul'|'ol', n }
  let block = null;          // 'h1' | 'h2' | 'h3' | 'quote' | 'pre' | 'li' | null
  const hrefs = [];
  const flush = () => {
    const t = line.replace(/[ \t]+/g, ' ').trim();
    line = '';
    if (!t && block !== 'pre') return;
    const depth = Math.max(0, lists.length - 1);
    if (block === 'h1') out.push('# ' + t);
    else if (block === 'h2') out.push('## ' + t);
    else if (block === 'h3') out.push('### ' + t);
    else if (block === 'quote') out.push('> ' + t);
    else if (block === 'li') {
      const top = lists[lists.length - 1];
      out.push('  '.repeat(depth) + (top?.type === 'ol' ? `${++top.n}. ` : '- ') + t);
    } else out.push(t);
  };
  const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] != null) { line += decode(m[4]); continue; }
    const close = !!m[1], tag = m[2].toLowerCase(), attrs = m[3] || '';
    if (/^(h[1-3])$/.test(tag)) { flush(); block = close ? null : tag; if (close) out.push(''); continue; }
    if (tag === 'p' || tag === 'div') {
      flush();
      if (!close) block = /is-title/.test(attrs) ? 'h1' : /is-subtitle/.test(attrs) ? 'quote' : (lists.length ? 'li' : null);
      else { if (!lists.length) out.push(''); block = lists.length ? 'li' : null; }
      continue;
    }
    if (tag === 'blockquote') { flush(); block = close ? null : 'quote'; if (close) out.push(''); continue; }
    if (tag === 'pre') { flush(); block = close ? null : 'pre'; continue; }
    if (tag === 'ul' || tag === 'ol') {
      flush();
      if (close) { lists.pop(); block = lists.length ? 'li' : null; if (!lists.length) out.push(''); }
      else lists.push({ type: tag, n: 0 });
      continue;
    }
    if (tag === 'li') { flush(); block = close ? null : 'li'; continue; }
    if (tag === 'br') { if (block === 'li' || block === 'quote') line += ' '; else flush(); continue; }
    if (tag === 'hr') { flush(); out.push('---', ''); continue; }
    // Emphasis around nothing (contenteditable leaves <b></b> behind) is
    // dropped at the closing tag rather than by a pattern afterwards, which
    // would also eat real bold.
    if (tag === 'b' || tag === 'strong' || tag === 'i' || tag === 'em') {
      const mark = tag === 'b' || tag === 'strong' ? '**' : '*';
      if (close && line.endsWith(mark)) line = line.slice(0, -mark.length);
      else line += mark;
      continue;
    }
    if (tag === 'u') { line += close ? '</u>' : '<u>'; continue; }
    if (tag === 'a') {
      if (!close) { hrefs.push(decode(/href="([^"]*)"/i.exec(attrs)?.[1] || '')); line += '['; }
      else { const href = hrefs.pop(); line += href ? `](${href})` : ']'; }
      continue;
    }
  }
  flush();
  const md = out.join('\n');
  return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// A CitySteps Studio export ({ app, notes: [{ id, title, html, updated }] }),
// or the older single-note session file ({ html, title }), into notes.
export function fromStudioExport(json, type = 'post') {
  // Studio's "Save note to a .json file" writes { app, v: 1, notes: "<html>" }
  // (one note, as a string); "Export all notes for Reader" writes an array.
  const list = Array.isArray(json?.notes) ? json.notes : typeof json?.notes === 'string' ? [{ html: json.notes, updated: Date.parse(json.savedAt) || Date.now() }]
    : json?.html ? [json] : Array.isArray(json) ? json : [];
  return list.filter((n) => n && (n.html || n.text)).map((n) => {
    const body = n.html ? htmlToMarkdown(n.html) : String(n.text);
    const t = n.updated || n.updatedAt || Date.now();
    return { type, title: n.named ? n.title : '', body, tags: ['from-studio'], anchors: [], recordings: [], createdAt: t, updatedAt: t, importedFrom: 'CitySteps Studio' + (n.title ? ': ' + n.title : '') };
  });
}

// A Markdown file (IdeaBank) into a note. Existing front matter is kept in
// the body so nothing is lost.
export function fromMarkdownFile(name, text, type = 'article', modified = Date.now()) {
  const base = name.replace(/\.(md|markdown|txt)$/i, '');
  return { type, title: base, body: String(text).replace(/\r\n/g, '\n').trim() + '\n', tags: ['from-ideabank'], anchors: [], recordings: [], createdAt: modified, updatedAt: modified, importedFrom: name };
}
