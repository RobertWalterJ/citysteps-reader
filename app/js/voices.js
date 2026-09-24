// One set of controls, two voices: a Piper voice (Alba by default) and the
// phone's own. The reader talks to this; it passes each call to whichever
// voice is in use.
//
// The first time, Alba has to download (about 60 MB, once). The phone's voice
// reads meanwhile, and Alba takes over at the sentence being read as soon as
// she is ready, so pressing play never means waiting.

import { Player } from './player.js';
import { PiperPlayer } from './tts/piper-player.js';

export const PIPER_VOICES = [
  ['en_GB-alba-medium', 'Alba (Scottish, woman)'],
  ['en_GB-northern_english_male-medium', 'Northern English (man)'],
  ['en_GB-jenny_dioco-medium', 'Jenny (English, woman)'],
  ['en_GB-alan-medium', 'Alan (English, man)'],
  ['en_US-lessac-medium', 'Lessac (American, woman)'],
  ['en_US-ryan-medium', 'Ryan (American, man)'],
];

export class Voices {
  constructor(cbs) {
    this.cbs = cbs;
    const wrap = { ...cbs, onFinish: (...a) => this.onFinish?.(...a) };
    // The phone's voice reports each new sentence; that is where a waiting
    // Alba takes over, so there is no gap and no sentence heard twice.
    this.builtin = new Player({ ...wrap, onSentence: (i, s) => { cbs.onSentence(i, s); this.#handoverAt(i); } });
    this.handover = null;
    this.piper = new PiperPlayer({ ...wrap, onStatus: (s) => this.#status(s) });
    this.engine = 'piper';
    this.active = this.builtin;
    this.onFinish = cbs.onFinish;
    this.switching = false;
  }
  // Shared position and settings live on both voices.
  get queue() { return this.active.queue; }
  set queue(q) { this.builtin.queue = q; this.piper.queue = q; }
  get idx() { return this.active.idx; }
  set idx(i) { this.builtin.idx = i; this.piper.idx = i; }
  get rate() { return this.active.rate; }
  set rate(r) { this.builtin.rate = r; this.piper.rate = r; this.piper.el.playbackRate = r; }
  get playing() { return this.active.playing; }

  setEngine(engine, voiceId) {
    this.engine = engine;
    if (voiceId && voiceId !== this.piper.voiceId) this.piper.warm(voiceId).catch(() => {});
    if (engine === 'builtin' && this.active === this.piper) this.#move(this.builtin);
  }
  // Alba when she is loaded, or when a prepared screen-off file already holds
  // this sentence (it is finished audio: no voice model needed to play it).
  #want(i = this.idx) { return this.engine === 'piper' && (this.piper.ready || this.piper.covers(i)) ? this.piper : this.builtin; }
  #move(to) {
    if (to === this.active) return;
    const was = this.active.playing, i = this.active.idx;
    this.active.stop(false);
    to.idx = i;
    this.active = to;
    if (was) to.play(i);
  }
  #status(s) {
    this.cbs.onStatus?.(s);
    // Alba is ready while the phone's voice is reading: she renders the next
    // sentence now and takes over when the phone's voice gets there.
    if (s.state === 'ready' && this.engine === 'piper' && this.active === this.builtin) {
      if (!this.builtin.playing) { this.active = this.piper; return; }
      const at = this.builtin.idx + 1;
      if (at >= this.queue.length) return;
      this.handover = { at, ready: false };
      const h = this.handover;
      this.piper.preload(at).then((ok) => { if (ok && this.handover === h) h.ready = true; }).catch(() => { this.handover = null; });
    }
  }
  #handoverAt(i) {
    const h = this.handover;
    if (!h || this.active !== this.builtin || !this.builtin.playing) return;
    if (i < h.at) return;
    if (!h.ready) return;                       // still rendering: keep listening
    if (!this.piper.covers(i)) {
      // The phone's voice has moved past what was rendered: aim for the next sentence.
      if (i + 1 >= this.queue.length) { this.handover = null; return; }
      const next = { at: i + 1, ready: false };
      this.handover = next;
      this.piper.preload(i + 1).then((ok) => { if (ok && this.handover === next) next.ready = true; }).catch(() => { this.handover = null; });
      return;
    }
    this.handover = null;
    this.builtin.stop(false);
    this.active = this.piper;
    this.piper.play(i);
  }

  play(i) {
    const to = this.#want(i ?? this.active.idx);
    if (to !== this.active) { this.active.stop(false); to.idx = this.active.idx; this.active = to; }
    if (this.engine === 'piper' && !this.piper.ready) this.piper.warm().catch((e) => this.cbs.onStatus?.({ state: 'error', error: e.message }));
    this.active.play(i);
  }
  pause() { this.handover = null; this.active.pause(); }
  stop(report) { this.builtin.stop(false); this.piper.stop(false); if (report !== false) this.cbs.onState?.(false); }
  toggle() { this.active.playing ? this.pause() : this.play(); }
  next() { this.active.next(); }
  prev() { this.active.prev(); }
  setRate(r) { this.builtin.setRate(r); this.piper.setRate(r); }
  setQueue(q, i) { const was = this.active.playing; this.stop(false); this.queue = q; this.idx = i; if (was) this.play(i); }
}
