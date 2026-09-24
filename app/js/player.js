// Reads a queue of sentences aloud, one utterance per sentence, and reports
// where it is so the reader can highlight the sentence and the word.
//
// Word timing: Android sends no boundary events, so the word cursor is placed
// by elapsed time in proportion to word length, the same approach CitySteps
// Studio uses (startWordFollow). Where boundary events do arrive (desktop
// Chrome), they correct the estimate.

import * as speech from './speech.js';

const CHARS_PER_SEC = 15.5;   // about 170 words a minute at 1.0x

export class Player {
  constructor({ onSentence, onWord, onState, onFinish }) {
    Object.assign(this, { onSentence, onWord, onState, onFinish });
    this.queue = [];
    this.idx = 0;
    this.playing = false;
    this.rate = 1;
    this.token = 0;
    this.wake = null;
    document.addEventListener('visibilitychange', () => this.#onVisible());
  }

  setQueue(queue, idx = 0) {
    const was = this.playing;
    this.stop(false);
    this.queue = queue;
    this.idx = Math.max(0, Math.min(idx, queue.length - 1));
    if (was) this.play();
  }

  play(idx = this.idx) {
    if (!this.queue.length) return;
    this.idx = Math.max(0, Math.min(idx, this.queue.length - 1));
    this.playing = true;
    this.onState?.(true);
    this.#keepAwake(true);
    this.#speak();
  }

  pause() {
    // Android treats pause() as cancel(), so pausing is cancel-and-remember;
    // play() restarts the current sentence from its beginning.
    this.stop(true);
  }

  stop(report = true) {
    this.playing = false;
    this.token++;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.watchdog);
    speech.cancel();
    this.#keepAwake(false);
    if (report) this.onState?.(false);
  }

  toggle() { this.playing ? this.pause() : this.play(); }
  next() { this.#jump(this.idx + 1); }
  prev() { this.#jump(this.idx - 1); }
  setRate(r) { this.rate = r; if (this.playing) this.#jump(this.idx); }

  #jump(i) {
    if (i < 0 || i >= this.queue.length) return;
    this.idx = i;
    if (this.playing) {
      // Android Chrome fails a speak() that follows cancel() too closely
      // ("synthesis-failed" on the S23 FE, Sept 2026), so leave a gap.
      const my = ++this.token;
      speech.cancel();
      this.onSentence?.(this.idx, this.queue[this.idx]);
      setTimeout(() => { if (my === this.token && this.playing) this.#speak(); }, 250);
    }
    else this.onSentence?.(this.idx, this.queue[this.idx]);
  }

  #speak() {
    const my = ++this.token;
    const s = this.queue[this.idx];
    this.onSentence?.(this.idx, s);
    cancelAnimationFrame(this.raf);
    clearTimeout(this.watchdog);
    let t0 = 0, offset = 0, boundary = false;
    const est = Math.max(1.5, s.text.length / (CHARS_PER_SEC * this.rate));
    const tick = () => {
      if (my !== this.token) return;
      if (!boundary && t0) {
        const pos = offset + ((performance.now() - t0) / 1000) * CHARS_PER_SEC * this.rate;
        this.onWord?.(this.idx, wordAt(s, pos));
      }
      this.raf = requestAnimationFrame(tick);
    };
    const advance = () => {
      if (my !== this.token || !this.playing) return;
      if (this.idx + 1 >= this.queue.length) { this.stop(); this.onFinish?.(); return; }
      this.idx++;
      this.#speak();
    };
    speech.speak(s.text, {
      rate: this.rate,
      onstart: () => {
        if (my !== this.token) return;
        t0 = performance.now();
        this.raf = requestAnimationFrame(tick);
        // If the engine goes quiet without an end event (seen on Android when
        // the screen dims), move on rather than hang.
        this.watchdog = setTimeout(() => {
          if (my === this.token && !speechSynthesis.speaking) advance();
        }, est * 2500 + 4000);
      },
      onboundary: (e) => {
        if (my !== this.token || e.name !== 'word') return;
        boundary = true;
        this.onWord?.(this.idx, wordAt(s, e.charIndex));
      },
      onend: () => advance(),
      onerror: (e) => {
        if (my !== this.token) return;
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        // One retry for a failed start before giving up on the sentence.
        if (e.error === 'synthesis-failed' && !s.retried) { s.retried = true; this.token++; setTimeout(() => { if (this.playing) this.#speak(); }, 500); return; }
        // A voice that fails on one sentence (a URL, a formula) should not
        // stop the whole document.
        advance();
      },
    });
  }

  #onVisible() {
    if (document.visibilityState !== 'visible' || !this.playing) return;
    // Coming back after the screen locked: Android will have silenced the
    // voice. Pick up at the start of the sentence it was on.
    if (!speechSynthesis.speaking && !speechSynthesis.pending) this.#speak();
    this.#keepAwake(true);
  }

  async #keepAwake(on) {
    try {
      if (on && !this.wake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        this.wake = await navigator.wakeLock.request('screen');
        this.wake.addEventListener('release', () => { this.wake = null; });
      } else if (!on && this.wake) { await this.wake.release(); this.wake = null; }
    } catch { this.wake = null; }
  }
}

// Offsets inside a sentence are relative to the sentence's own text.
function wordAt(s, pos) {
  let acc = 0;
  for (let k = 0; k < s.words.length; k++) {
    const w = s.words[k];
    acc = w.rend;
    if (pos < acc) return k;
  }
  return s.words.length - 1;
}
