// House rules, checked on every build.
//
//   node build/verify.mjs
//
// Each rule is one of Robert's standing instructions (CLAUDE.md), so a slip
// fails the build instead of reaching his phone.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const src = walk(join(ROOT, 'app')).filter((p) => ['.js', '.html', '.css', '.webmanifest'].includes(extname(p)));
const fails = [];
const fail = (file, msg) => fails.push(`${relative(ROOT, file)}: ${msg}`);

for (const f of src) {
  const s = readFileSync(f, 'utf8');
  const lines = s.split('\n');
  lines.forEach((line, i) => {
    const at = `line ${i + 1}`;
    // Plain writing: no em dashes in anything Robert reads.
    if (line.includes('—')) fail(f, `${at} has an em dash`);
    // CitySteps is personal, never GPA.
    if (/\bGPA\b|Gladki|520 Highway|Stoney Creek/i.test(line)) fail(f, `${at} mentions GPA or a GPA project`);
    if (/\badvocacy\b/i.test(line)) fail(f, `${at} says "advocacy"; the term is "public interest planning"`);
    // A control character in source is how a regex silently breaks (Phase 1:
    // a \b became a backspace byte through a shell heredoc).
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(line)) fail(f, `${at} contains a control character`);
    // No fast repeating timers: nothing may tick or advance faster than every 30s by itself.
    const iv = /setInterval\([^,]+,\s*(\d+)/.exec(line);
    if (iv && +iv[1] < 30000) fail(f, `${at} has a repeating timer under 30 seconds`);
  });
  if (extname(f) === '.html' && /(href|src)="\/(?!\/)/.test(s)) fail(f, 'root-absolute URL (the site lives under a sub-path)');
  if (extname(f) === '.css' && /url\(\//.test(s)) fail(f, 'root-absolute url()');
}

// The service worker opens the same database as the app; their schemas must match.
const dbjs = readFileSync(join(ROOT, 'app', 'js', 'db.js'), 'utf8');
const swjs = readFileSync(join(ROOT, 'app', 'sw.js'), 'utf8');
for (const k of ['DB_NAME', 'DB_VERSION', 'SCHEMA']) {
  const a = new RegExp(`${k} = ([^;]+);`).exec(dbjs)?.[1], b = new RegExp(`${k} = ([^;]+);`).exec(swjs)?.[1];
  if (!a || a !== b) fail(join(ROOT, 'app', 'sw.js'), `${k} differs from app/js/db.js (${a} vs ${b})`);
}
// Every cache and database name carries the app prefix (shared origin).
if (!/const PREFIX = 'csreader-'/.test(swjs)) fail(join(ROOT, 'app', 'sw.js'), 'cache prefix is not csreader-');
if (/caches\.match\(/.test(swjs.replace(/\/\/.*$/gm, ''))) fail(join(ROOT, 'app', 'sw.js'), 'uses the global caches.match(), which would read other apps\' caches');

// Pinned versions (CLAUDE.md): Transformers.js 4.3.0 breaks Whisper on WebGPU.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const tj = pkg.devDependencies?.['@huggingface/transformers'];
if (tj && tj !== '4.2.0') fail(join(ROOT, 'package.json'), `@huggingface/transformers is ${tj}, pinned to 4.2.0`);

if (fails.length) { console.log('verify failed:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`verify: ${src.length} files follow the house rules.`);
