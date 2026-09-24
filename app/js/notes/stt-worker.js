// Transcription worker: Whisper base (English), 8-bit, on the processor.
//
// Chosen on the S23 FE (DECISIONS.md D18): 3.7x real time with the best
// punctuation of the three models tried. Never the graphics chip on this
// phone (D15: it crashed). Basic graph optimization, or the 8-bit decoder
// will not load on ONNX Runtime 1.30 (D17).

import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
const MODEL = 'onnx-community/whisper-base.en';
let asr = null;

async function load() {
  if (asr) return asr;
  try { env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1; } catch { /* ignore */ }
  let last = -1;
  asr = await pipeline('automatic-speech-recognition', MODEL, {
    device: 'wasm', dtype: 'q8',
    session_options: { graphOptimizationLevel: 'basic' },
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total > 2e6) {
        const pct = Math.round((p.loaded / p.total) * 100);
        if (pct !== last) { last = pct; self.postMessage({ progress: pct, mb: Math.round(p.total / 1048576) }); }
      }
    },
  });
  return asr;
}

self.onmessage = async (e) => {
  const { id, audio } = e.data;
  try {
    const run = await load();
    self.postMessage({ id, status: 'working' });
    const t0 = performance.now();
    const out = await run(audio, { chunk_length_s: 30, stride_length_s: 5 });
    self.postMessage({ id, done: true, text: String(out.text || '').trim(), engine: 'whisper-base.en q8', seconds: (performance.now() - t0) / 1000 });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
