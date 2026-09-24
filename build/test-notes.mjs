// Notes: Markdown export and the CitySteps Studio import.
//
//   node build/test-notes.mjs
//
// The brief (Sept 2026): "export any note, post start or research thread as
// Markdown (with citations back to the source passage)", and bring the
// Studio notes library in on day one. Studio's HTML comes from a
// contenteditable, so the cases below use the shapes it really produces
// (title class, nested lists inside the parent item, empty emphasis).

import { htmlToMarkdown, noteToMarkdown, fromStudioExport, fromMarkdownFile, slug, titleOf } from '../app/js/notes/markdown.js';

let failed = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`}`);
};
const has = (name, text, part) => { const ok = text.includes(part); if (!ok) failed++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        missing: ${JSON.stringify(part)}\n        in: ${JSON.stringify(text)}`}`); };

eq('title class becomes a heading, body stays a paragraph',
  htmlToMarkdown('<p class="is-title">Walking the Weston Hub</p><p>First thought.</p>'),
  '# Walking the Weston Hub\n\nFirst thought.\n');
eq('inline bold, italic and a link',
  htmlToMarkdown('<p>A <b>bold</b> and <i>quiet</i> idea, see <a href="https://example.org">the plan</a>.</p>'),
  'A **bold** and *quiet* idea, see [the plan](https://example.org).\n');
eq('nested bullets (Studio puts the sublist inside its parent item)',
  htmlToMarkdown('<ul><li>Housing<ul><li>missing middle</li><li>tenure</li></ul></li><li>Transit</li></ul>'),
  '- Housing\n  - missing middle\n  - tenure\n- Transit\n');
eq('numbered list',
  htmlToMarkdown('<ol><li>Read</li><li>Walk</li></ol>'),
  '1. Read\n2. Walk\n');
eq('quote, rule and headings',
  htmlToMarkdown('<h2>Why</h2><blockquote>Cities are made of stories.</blockquote><hr><p>After.</p>'),
  '## Why\n\n> Cities are made of stories.\n\n---\n\nAfter.\n');
eq('entities and empty emphasis',
  htmlToMarkdown('<p>Rents &amp; incomes <b></b>&lt;2026&gt;</p>'),
  'Rents & incomes <2026>\n');

const note = {
  type: 'post', body: 'Revitalization is not one thing.\n\nIt depends who is in the room.', tags: ['inner suburbs'],
  anchors: [{ docTitle: 'Revitalization on the Margins', authors: 'Stark', year: 2016, page: 3, quote: 'If revitalization is to empower local residents, it must materialize in such a way that is based on the needs of residents.' }],
  recordings: [], createdAt: Date.UTC(2026, 8, 24), updatedAt: Date.UTC(2026, 8, 24),
};
const md = noteToMarkdown(note);
has('front matter type', md, 'type: "Post start"');
has('title from the first line', md, 'title: "Revitalization is not one thing."');
has('source listed', md, '  - "Revitalization on the Margins, p. 3"');
has('passage quoted', md, '> If revitalization is to empower local residents');
has('passage cited', md, '> Revitalization on the Margins, Stark (2016), p. 3');
has('untranscribed recordings flagged', noteToMarkdown({ ...note, recordings: [{ transcript: { status: 'queued' } }] }), '1 voice recording not yet transcribed');

const studio = fromStudioExport({ app: 'citysteps-studio', notes: [{ id: 'a', title: 'Draft', named: true, html: '<p class="is-title">Draft</p><p>Body</p>', updated: 1 }, { id: 'b', html: '' }] });
eq('Studio export: empty notes skipped', studio.length, 1);
eq('Studio export: body converted', studio[0].body, '# Draft\n\nBody\n');
eq('Studio export: type', studio[0].type, 'post');
eq('Studio single-note session file ({ notes: "<html>" })',
  fromStudioExport({ app: 'citysteps-studio', v: 1, savedAt: '2026-07-12T10:00:00Z', notes: '<p>One note</p>' })[0]?.body, 'One note\n');
eq('IdeaBank file: title from file name', fromMarkdownFile('CPPS Article - Working Draft.md', '# CPPS\r\ntext').title, 'CPPS Article - Working Draft');
eq('slug', slug('Weston Hub: who’s in the room?'), 'weston-hub-whos-in-the-room');
eq('title of an empty idea', titleOf({ type: 'idea', body: '' }), 'Idea');

console.log(`notes: ${failed ? failed + ' failed' : 'all passed'}`);
if (failed) process.exit(1);
