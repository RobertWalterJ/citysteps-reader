// Build docs/ for GitHub Pages.
//
//   node build/build.mjs
//
// Pages serves this at https://robertwalterj.github.io/citysteps-reader/, a
// SUBPATH, so every URL is relative. Unlike Hok Gong this is not one HTML
// file: the parser (and later the voice and transcription models) run in
// Web Workers, which need their own script files.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app');
const OUT = join(ROOT, 'docs');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
let commit = 'local';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
  if (execFileSync('git', ['status', '--porcelain', '--', 'app', 'build'], { cwd: ROOT }).toString().trim()) commit += '+';
} catch { /* not a repo */ }
const d = new Date();
const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const stamp = `${commit}-${date.replace(/-/g, '')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'js'), { recursive: true });

const common = { bundle: true, format: 'esm', minify: true, target: 'es2022', legalComments: 'none', logLevel: 'warning' };
// The app, with the page renderer split into its own chunk (loaded only when
// "Show the original page" is used).
await build({ ...common, entryPoints: { main: join(APP, 'js', 'main.js') }, outdir: join(OUT, 'js'), splitting: true, chunkNames: 'chunk-[hash]' });
// The parse worker carries PDF.js and its worker code in one file.
await build({ ...common, entryPoints: { 'parse-worker': join(APP, 'js', 'parse', 'worker.js') }, outdir: join(OUT, 'js') });
// PDF.js's own worker, for the page renderer on the main thread.
cpSync(join(ROOT, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'), join(OUT, 'js', 'pdf.worker.min.mjs'));

for (const dir of ['css', 'fonts', 'icons']) cpSync(join(APP, dir), join(OUT, dir), { recursive: true });
cpSync(join(APP, 'manifest.webmanifest'), join(OUT, 'manifest.webmanifest'));

const BUILD = JSON.stringify({ v: pkg.version, commit, date });
let html = readFileSync(join(APP, 'index.html'), 'utf8');
html = html.replace('<script type="module" src="js/main.js"></script>', () => `<script>window.CSREADER_BUILD=${BUILD};</script>\n<script type="module" src="js/main.js"></script>`);
if (/(href|src)="\/(?!\/)/.test(html)) throw new Error('a root-absolute URL would break under /citysteps-reader/');
writeFileSync(join(OUT, 'index.html'), html);

const sw = readFileSync(join(APP, 'sw.js'), 'utf8').replace("'csreader-v1-dev'", JSON.stringify('csreader-v1-' + stamp));
if (sw.includes('csreader-v1-dev')) throw new Error('the service worker version was not stamped');
writeFileSync(join(OUT, 'sw.js'), sw);
writeFileSync(join(OUT, '.nojekyll'), '');

// Everything the worker precaches must exist.
const list = [...(sw.match(/PRECACHE = \[([^\]]*)\]/)?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((u) => u !== './');
const missing = list.filter((u) => !existsSync(join(OUT, u)));
if (missing.length) throw new Error('the service worker precaches files that do not exist: ' + missing.join(', '));
for (const f of readdirSync(join(OUT, 'css'))) if (/url\(\//.test(readFileSync(join(OUT, 'css', f), 'utf8'))) throw new Error(`root-absolute url() in css/${f}`);
if (/url\(\//.test(readFileSync(join(OUT, 'fonts', 'fonts.css'), 'utf8'))) throw new Error('root-absolute url() in fonts.css');

const kb = (p) => Math.round(statSync(p).size / 1024);
const js = readdirSync(join(OUT, 'js')).map((f) => `${f} ${kb(join(OUT, 'js', f))} KB`).join(', ');
console.log(`wrote docs/ (v${pkg.version}, ${commit}): ${js}`);
