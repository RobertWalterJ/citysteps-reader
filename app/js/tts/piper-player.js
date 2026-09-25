// Reading with a Piper voice (Alba by default), through one <audio> element.
//
// Same controls as the built-in voice's Player (play, pause, next, prev,
// speed, sentence and word callbacks), so the reader can use either.
//
// Sentences are rendered in a worker and joined into audio "pieces". The
// first piece is one sentence, so reading starts within a second or so; each
// next piece is about twice as long, rendered while the current one plays
// (Piper runs about 3x real time on the S23 FE, so it stays ahead). Longer
// pieces mean fewer hand-overs, and a hand-over is what fails with the screen
// locked (D18). For a whole commute, prepare() renders one long file.

import { join, wav, oggOpus } from './audio.js';

const MAX_PIECE_SEC = 12 * 60;

export class PiperPlayer {
  constructor({ onSentence, onWord, onState, onFinish, onStatus }) {
    Object.assign(this, { onSentence, onWord, onState, onFinish, onStatus });
    this.queue = []; this.idx = 0; this.playing = false; this.rate = 1;
    this.voiceId = 'en_GB-alba-medium';
    this.ready = false;
    this.cache = new Map();             // voice + text -> { pcm, rate }
    this.piece = null;                  // { from, to, times, url, prepared }
    this.nextPiece = null;              // promise of the following piece
    this.token = 0;
    this.meta = { title: 'CitySteps Reader', section: '' };
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.preservesPitch = true;
    this.el.addEventListener('timeupdate', () => this.#tick());
    this.el.addEventListener('ended', () => this.#ended());
    // The audio element reports its time about four times a second; the word
    // cursor needs every frame while the screen is on.
    const frame = () => { this.#tick(); if (!this.el.paused) this.raf = requestAnimationFrame(frame); };
    this.el.addEventListener('play', () => { this.#media('playing'); cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(frame); });
    this.el.addEventListener('pause', () => { this.#media('paused'); cancelAnimationFrame(this.raf); });
    this.worker = null; this.seq = 0; this.pending = new Map();
    // One request at a time goes to the worker. Pausing or jumping drops the
    // ones still waiting: before this, a paused document's look-ahead kept the
    // voice busy and a new request waited behind it (Phase 4, on the PC).
    this.waiting = []; this.busy = false;
  }

  // ---------- the voice ----------
  #w() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./piper-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.progress != null) { this.onStatus?.({ state: 'downloading', progress: m.progress, mb: m.mb }); return; }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.error ? p.reject(new Error(m.error)) : p.resolve(m);
    };
    this.worker.onerror = (e) => { for (const p of this.pending.values()) p.reject(new Error(e.message || 'The voice stopped')); this.pending.clear(); this.worker = null; };
    return this.worker;
  }
  #ask(text, gen = this.token) {
    return new Promise((resolve, reject) => { this.waiting.push({ text, gen, resolve, reject }); this.#pump(); });
  }
  #pump() {
    if (this.busy) return;
    const job = this.waiting.shift();
    if (!job) return;
    this.busy = true;
    const id = ++this.seq;
    const done = (fn) => (v) => { this.busy = false; fn(v); this.#pump(); };
    this.pending.set(id, { resolve: done(job.resolve), reject: done(job.reject) });
    this.#w().postMessage({ id, voiceId: this.voiceId, text: job.text });
  }
  // Drop queued renders that belong to an earlier play/pause.
  #cancelStale() {
    const keep = [];
    for (const j of this.waiting) { if (j.text === null || j.gen === this.token || j.gen === 'keep') keep.push(j); else j.reject(new Error('cancelled')); }
    this.waiting = keep;
  }
  async warm(voiceId = this.voiceId) {
    if (voiceId !== this.voiceId) { this.voiceId = voiceId; this.ready = false; this.cache.clear(); this.#dropPieces(); }
    if (this.ready) return true;
    this.onStatus?.({ state: 'loading' });
    await this.#ask(null, 'keep');
    this.ready = true;
    this.onStatus?.({ state: 'ready' });
    return true;
  }
  async #render(i, gen) {
    const text = this.queue[i].text;
    const key = this.voiceId + '|' + text;
    let hit = this.cache.get(key);
    if (!hit) {
      const r = await this.#ask(text, gen);
      hit = { pcm: r.pcm, rate: r.rate };
      this.cache.set(key, hit);
      if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
    }
    return hit;
  }

  // One sentence on its own (the settings' "Hear this voice").
  renderOne(i) { return this.#render(i, 'keep'); }

  // Render sentences from `from` until `count` sentences or `maxSec` of audio.
  async #build(from, { count = 1, maxSec = MAX_PIECE_SEC, onProgress, gen = this.token } = {}) {
    const pieces = [];
    let rate = 22050, sec = 0, i = from;
    while (i < this.queue.length && pieces.length < count && sec < maxSec) {
      const r = await this.#render(i, gen);
      rate = r.rate;
      pieces.push(r.pcm);
      sec += r.pcm.length / rate;
      i++;
      onProgress?.(sec, i - from);
    }
    if (!pieces.length) return null;
    const j = join(pieces, rate);
    return { from, to: i - 1, times: j.times, pcm: j.pcm, rate, seconds: j.seconds };
  }
  #dropPieces() {
    if (this.piece?.url) URL.revokeObjectURL(this.piece.url);
    this.piece = null; this.nextPiece = null;
  }
  #load(p) {
    if (this.piece?.url && this.piece.url !== p.url) URL.revokeObjectURL(this.piece.url);
    if (!p.url) p.url = URL.createObjectURL(p.blob || wav(p.pcm, p.rate));
    p.pcm = null;   // the audio element has it now
    this.piece = p;
    this.el.src = p.url;
    this.el.playbackRate = this.rate;
  }
  #queueNext() {
    const p = this.piece;
    if (!p || p.to + 1 >= this.queue.length || this.nextPiece) return;
    const count = Math.min(200, Math.max(2, (p.to - p.from + 1) * 2));
    const my = this.token;
    this.nextPiece = this.#build(p.to + 1, { count }).then((n) => (my === this.token ? n : null)).catch(() => null);
  }

  // ---------- controls ----------
  async play(idx = this.idx) {
    if (!this.queue.length) return;
    this.idx = Math.max(0, Math.min(idx, this.queue.length - 1));
    const my = ++this.token;
    this.#cancelStale();
    this.playing = true;
    this.onState?.(true);
    this.onSentence?.(this.idx, this.queue[this.idx]);
    try {
      const inPiece = this.piece && this.idx >= this.piece.from && this.idx <= this.piece.to;
      if (!inPiece) {
        await this.warm();
        if (my !== this.token) return;
        this.#dropPieces();
        this.onStatus?.({ state: 'rendering' });
        const p = await this.#build(this.idx, { count: 1 });
        if (my !== this.token || !p) return;
        this.#load(p);
      }
      // Paused part-way through this sentence: carry on from there.
      const [a, b] = this.piece.times[this.idx - this.piece.from];
      const t = this.el.currentTime;
      if (!(t >= a && t < b)) this.el.currentTime = a;
      await this.el.play();
      this.onStatus?.({ state: 'playing' });
      this.#queueNext();
    } catch (err) {
      if (my !== this.token) return;
      this.playing = false;
      this.onState?.(false);
      this.onStatus?.({ state: 'error', error: err.message });
    }
  }
  // Render and load from sentence i without playing, so a hand-over from the
  // phone's voice can start the instant that voice reaches i.
  async preload(i) {
    await this.warm();
    if (this.piece && i >= this.piece.from && i <= this.piece.to) return true;
    const my = this.token;
    const p = await this.#build(i, { count: 1 });   // one sentence: ready as soon as possible
    if (my !== this.token || !p) return false;
    this.#dropPieces();
    this.#load(p);
    this.el.currentTime = 0;
    return true;
  }
  covers(i) { return !!(this.piece && i >= this.piece.from && i <= this.piece.to); }
  pause() { this.playing = false; this.token++; this.#cancelStale(); this.el.pause(); this.onState?.(false); }
  stop(report = true) { this.playing = false; this.token++; this.#cancelStale(); this.el.pause(); if (report) this.onState?.(false); }
  toggle() { this.playing ? this.pause() : this.play(); }
  next() { this.#jump(this.idx + 1); }
  prev() { this.#jump(this.idx - 1); }
  setRate(r) { this.rate = r; this.el.playbackRate = r; }
  setQueue(queue, idx = 0) { const was = this.playing; this.stop(false); this.queue = queue; this.idx = idx; this.#dropPieces(); if (was) this.play(); }
  #jump(i) {
    if (i < 0 || i >= this.queue.length) return;
    this.idx = i;
    if (this.piece && i >= this.piece.from && i <= this.piece.to) {
      this.el.currentTime = this.piece.times[i - this.piece.from][0];
      this.onSentence?.(i, this.queue[i]);
    } else if (this.playing) this.play(i);
    else this.onSentence?.(i, this.queue[i]);
  }

  // Where the audio is -> which sentence and word.
  #tick() {
    const p = this.piece;
    if (!p || !this.playing) return;
    const t = this.el.currentTime;
    let k = this.idx - p.from;
    if (k < 0 || k >= p.times.length || t < p.times[k][0] - 0.05 || t > p.times[k][1] + 0.3) {
      k = p.times.findIndex(([a, b]) => t >= a - 0.05 && t <= b + 0.3);
      if (k < 0) return;
    }
    const i = p.from + k;
    if (i !== this.idx) { this.idx = i; this.onSentence?.(i, this.queue[i]); }
    const [a, b] = p.times[k];
    const s = this.queue[i];
    const pos = Math.max(0, Math.min(1, (t - a) / (b - a))) * s.text.length;
    let w = s.words.findIndex((x) => pos < x.rend);
    if (w < 0) w = s.words.length - 1;
    this.onWord?.(i, w);
    if ('mediaSession' in navigator && this.el.duration) {
      try { navigator.mediaSession.setPositionState({ duration: this.el.duration, position: Math.min(t, this.el.duration), playbackRate: this.rate }); } catch { /* ignore */ }
    }
  }
  async #ended() {
    if (!this.playing) return;
    const my = this.token;
    const p = this.piece;
    if (p.to + 1 >= this.queue.length) { this.stop(); this.onFinish?.(); return; }
    this.onStatus?.({ state: 'rendering' });
    const next = await (this.nextPiece || this.#build(p.to + 1, { count: 2 }));
    this.nextPiece = null;
    if (my !== this.token || !next) return;
    this.#load(next);
    this.idx = next.from;
    this.onSentence?.(this.idx, this.queue[this.idx]);
    this.el.currentTime = 0;
    try { await this.el.play(); this.onStatus?.({ state: 'playing' }); } catch { /* locked: it resumes when Robert unlocks and taps play */ }
    this.#queueNext();
  }

  // ---------- lock screen ----------
  setMeta(title, section) {
    this.meta = { title, section };
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: section || 'CitySteps Reader', album: 'CitySteps Reader', artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      navigator.mediaSession.setActionHandler('seekbackward', () => { this.el.currentTime = Math.max(0, this.el.currentTime - 10); });
      navigator.mediaSession.setActionHandler('seekforward', () => { this.el.currentTime = Math.min(this.el.duration || 0, this.el.currentTime + 10); });
    } catch { /* older Chrome */ }
  }
  #media(state) { try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state; } catch { /* ignore */ } }

  // ---------- listen with the screen off ----------
  // One file from `from` for about `minutes`, compressed if the phone can.
  async prepare(from, minutes, { onProgress } = {}) {
    await this.warm();
    const target = minutes * 60;
    // Progress is measured against what will actually be read: the chosen
    // length, or less if the document ends first (about 14 characters a second).
    const left = this.queue.slice(from).reduce((n, q) => n + q.text.length, 0) / 14;
    const goal = Math.max(1, Math.min(target, left));
    const p = await this.#build(from, { count: 100000, maxSec: target, gen: 'keep', onProgress: (sec, n) => onProgress?.({ stage: 'voice', done: Math.min(0.99, sec / goal), sentences: n }) });
    if (!p) return null;
    onProgress?.({ stage: 'compress', done: 0 });
    const blob = (await oggOpus(p.pcm, p.rate, (d) => onProgress?.({ stage: 'compress', done: d })).catch(() => null)) || wav(p.pcm, p.rate);
    const file = { from: p.from, to: p.to, times: p.times, seconds: p.seconds, blob, voiceId: this.voiceId, prepared: true };
    return file;
  }
  usePrepared(file) {
    this.stop(false);
    this.#dropPieces();
    this.#load({ ...file, url: null });
  }
}
