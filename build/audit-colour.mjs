// CitySteps Reader: does the palette still carry its information without colour?
//
//   node build/audit-colour.mjs            report, and fail on any loss
//   node build/audit-colour.mjs --full     every check, including the passes
//
// The rule and the engine live in build/lib/audit-template.mjs, shared with
// Hok Gong, Landfall, Palimpsest, Halyard, Wordhoard and Commonplace. This
// file only says which tokens mean what, and where.
//
// The one place colour carries meaning here is read-aloud: the sentence band
// and the word cursor must separate from each other and from the page, and
// text on both must stay readable.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit } from './lib/audit-template.mjs';

const SPEC = {
  files: ['app/css/app.css'],
  surfaces: [['light', ':root'], ['dark (phone)', ':root:not([data-theme="light"])'], ['dark (chosen)', ':root[data-theme="dark"]']],
  pairs: [
    { a: '--hl-sent', b: '--paper', channel: 'tint', where: 'the sentence being read against the page' },
    // First try (Phase 1): two yellows, word signal and sentence pale. They
    // collapsed under tritanopia even with an underline, so by day the word
    // cursor now inverts to ink.
    { a: '--hl-word', b: '--hl-sent', channel: 'lightness', where: 'the word being read inside its sentence' },
    { a: '--ink', b: '--line', channel: 'lightness', where: 'reading progress bar: read against still to read' },
  ],
  text: [
    { fg: '--ink', bg: '--paper', where: 'body text on the page' },
    { fg: '--ink', bg: '--card', where: 'library cards and sheets' },
    { fg: '--muted', bg: '--paper', where: 'footnotes, references and page marks' },
    { fg: '--muted', bg: '--card', where: 'details under a document title' },
    { fg: '--ink', bg: '--butter', where: 'the Add a PDF card' },
    { fg: '--muted', bg: '--butter', where: 'the line under Add a PDF' },
    { fg: '--ink', bg: '--butter-soft', where: 'an abstract' },
    { fg: '--ink', bg: '--chip', where: 'type and label chips' },
    { fg: '--ink', bg: '--hl-sent', where: 'the sentence being read' },
    { fg: '--hl-ink', bg: '--hl-word', where: 'the word being read' },
    { fg: '--paper', bg: '--ink', where: 'the play button and solid buttons' },
    { fg: '--danger', bg: '--card', where: 'a document that could not be read' },
  ],
};

runAudit(SPEC, join(dirname(fileURLToPath(import.meta.url)), '..'));
