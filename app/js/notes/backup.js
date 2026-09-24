// Back up notes to a private GitHub repo (DECISIONS.md D9), as Markdown files
// Obsidian can open, plus the library's details as JSON.
//
// The token is a fine-grained GitHub token that Robert makes himself, limited
// to that one repo and to file contents. It stays on this phone (IndexedDB)
// and is only ever sent to api.github.com. PDFs and audio are not backed up
// (size, and the PDFs are other people's copyright); their sources are
// listed so they can be added again.

import * as db from '../db.js';
import { listNotes, saveNote } from './store.js';
import { noteToMarkdown, slug, titleOf } from './markdown.js';

const API = 'https://api.github.com';

export async function getSettings() {
  return (await db.kvGet('backup', null)) || { owner: '', repo: '', branch: 'main', folder: 'notes', token: '' };
}
export const saveSettings = (s) => db.kvSet('backup', s);

function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function gh(s, method, path, body) {
  const res = await fetch(`${API}/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}${method === 'GET' ? `?ref=${encodeURIComponent(s.branch)}` : ''}`, {
    method,
    headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === 'GET') return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = res.status === 401 ? 'GitHub did not accept the token (it may have expired).'
      : res.status === 403 ? 'The token is not allowed to write to that repo. Give it Contents: Read and write.'
      : res.status === 404 ? 'GitHub cannot find that repo with this token. Check the owner and repo name.'
      : data.message || `GitHub said ${res.status}.`;
    const err = new Error(why); err.status = res.status; throw err;
  }
  return data;
}

async function putFile(s, path, text, sha, message) {
  const body = { message, content: b64(text), branch: s.branch, ...(sha ? { sha } : {}) };
  try { return await gh(s, 'PUT', path, body); } catch (err) {
    // The file changed on GitHub since we last wrote it (or we never knew its
    // sha): fetch the current one and write again.
    if (err.status === 409 || err.status === 422) {
      const cur = await gh(s, 'GET', path);
      return gh(s, 'PUT', path, { ...body, sha: cur?.sha });
    }
    throw err;
  }
}

export const pathFor = (s, note) => `${s.folder}/${note.type}/${new Date(note.createdAt).toISOString().slice(0, 10)}-${slug(titleOf(note), 50)}-${note.id.slice(-5)}.md`;

export async function checkConnection(s) {
  const res = await fetch(`${API}/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`, { headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'GitHub cannot see that repo with this token.' : res.status === 401 ? 'GitHub did not accept the token.' : `GitHub said ${res.status}.`);
  const repo = await res.json();
  return { private: repo.private, canPush: !!repo.permissions?.push, name: repo.full_name };
}

export async function backUp({ onProgress } = {}) {
  const s = await getSettings();
  if (!s.owner || !s.repo || !s.token) throw new Error('Set up the backup first: repo and token.');
  const notes = await listNotes();
  const due = notes.filter((n) => !n.backup || n.backup.at < n.updatedAt);
  let done = 0;
  for (const n of due) {
    onProgress?.(done, due.length);
    const path = pathFor(s, n);
    // A renamed note moves: the old file stays in the repo's history.
    const sha = n.backup?.path === path ? n.backup.sha : undefined;
    const r = await putFile(s, path, noteToMarkdown(n), sha, `${sha ? 'Update' : 'Add'} note: ${titleOf(n)}`);
    n.backup = { path, sha: r.content?.sha, at: Date.now() };
    await saveNote(n, { touch: false });
    done++;
  }
  // The library's details (no PDFs), so documents can be found and added again.
  const docs = (await db.all('docs')).map((d) => ({ title: d.title, authors: d.authors, year: d.year, publisher: d.publisher, type: d.docType, tags: d.tags, pages: d.pageCount, file: d.source?.name, added: new Date(d.addedAt).toISOString().slice(0, 10) }));
  const libPath = `${s.folder}/library.json`;
  const prev = await db.kvGet('backup-library', null);
  const key = JSON.stringify(docs);
  if (!prev || prev.key !== key) {
    const text = JSON.stringify({ exported: new Date().toISOString(), documents: docs }, null, 2) + '\n';
    const r = await putFile(s, libPath, text, prev?.sha, 'Update library list');
    await db.kvSet('backup-library', { sha: r.content?.sha, key });
  }
  await db.kvSet('backup-last', Date.now());
  onProgress?.(due.length, due.length);
  return { notes: due.length, total: notes.length };
}
