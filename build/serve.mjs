// Serve the built app (docs/) locally.
//
//   node build/serve.mjs
//     http://localhost:8898              on this PC
//     https://<this PC's Wi-Fi address>:8444   on the phone, same Wi-Fi
//
// The phone needs HTTPS for the microphone and for WebGPU. The certificate is
// self-signed (made once with openssl into .cert/, which is gitignored), so
// Chrome on the phone shows a warning to click through. On a self-signed
// origin the service worker will not install, so "install to home screen"
// and the share sheet only work from the real GitHub Pages address.
//
// Both servers send the cross-origin isolation headers that GitHub Pages
// cannot, so thread counts measured here match the installed app.

import { createServer } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
};

async function handle(req, res) {
  // Local testing only: save an image the page made (a figure crop, say) so
  // it can be looked at. Written into the gitignored fixtures folder.
  if (req.method === 'POST' && req.url.startsWith('/__save/')) {
    const name = (req.url.slice(8).match(/^[\w.-]+\.png$/) || [])[0];
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (name) (await import('node:fs')).writeFileSync(join(ROOT, 'test-fixtures', 'local', name), Buffer.concat(chunks));
    res.writeHead(name ? 204 : 400); res.end();
    return;
  }
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = normalize(path === '/' ? 'index.html' : path.slice(1)).replace(/^(\.\.[/\\])+/, '');
  const headers = { 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'credentialless' };
  try {
    // Local testing only: the gitignored test PDFs, never part of docs/.
    const fixture = /^__fixtures[/\\]([\w.-]+\.pdf)$/.exec(rel);
    const body = await readFile(fixture ? join(ROOT, 'test-fixtures', 'local', fixture[1]) : join(DOCS, rel));
    res.writeHead(200, { ...headers, 'content-type': TYPES[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not here');
  }
}

const PORT = +process.env.PORT || 8898;
createServer(handle).listen(PORT, () => console.log(`\n  On this PC:  http://localhost:${PORT}`));

// HTTPS for the phone.
const certDir = join(ROOT, '.cert');
const key = join(certDir, 'key.pem'), cert = join(certDir, 'cert.pem');
try {
  if (!existsSync(key)) {
    mkdirSync(certDir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '825', '-subj', '/CN=CitySteps Reader local'], { stdio: 'ignore' });
  }
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  createHttps({ key: readFileSync(key), cert: readFileSync(cert) }, handle).listen(8444, () => {
    for (const ip of ips) console.log(`  On the phone: https://${ip}:8444   (same Wi-Fi; accept the certificate warning)`);
    console.log('');
  });
} catch {
  console.log('  (No openssl found, so no HTTPS address for the phone. Use the GitHub Pages address instead.)\n');
}
