// Phone test: transcription speed, on the processor only.
//
// Robert's S23 FE (Sept 2026): Whisper on the Adreno graphics chip crashed
// the browser and the phone, with base and with small, and Kokoro on the same
// chip produced noise. So this runs on the processor (WebAssembly, 8-bit
// models) and never touches WebGPU. Transformers.js pinned to 4.2.0
// (CLAUDE.md).

import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
const MODELS = {
  'whisper-tiny': 'onnx-community/whisper-tiny.en',
  'whisper-base': 'onnx-community/whisper-base.en',
  'moonshine-base': 'onnx-community/moonshine-base-ONNX',
};

self.onmessage = async (e) => {
  const { model, audio } = e.data;
  try {
    const threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    try { env.backends.onnx.wasm.numThreads = threads; } catch { /* ignore */ }
    const t0 = performance.now();
    let lastPct = -1;
    const asr = await pipeline('automatic-speech-recognition', MODELS[model], {
      device: 'wasm', dtype: 'q8',
      // ONNX Runtime 1.30's full graph optimizer fails on these 8-bit merged
      // decoders ("TransposeDQWeightsForMatMulNBits ... missing required
      // scale"); basic optimization loads them. Found on the PC, Sept 2026.
      session_options: { graphOptimizationLevel: e.data.opt || 'basic' },
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total > 2e6) {
          const pct = Math.round((p.loaded / p.total) * 100);
          if (pct !== lastPct) { lastPct = pct; self.postMessage({ status: `Downloading ${p.file}: ${pct}% of ${Math.round(p.total / 1048576)} MB` }); }
        }
      },
    });
    const loadSec = (performance.now() - t0) / 1000;
    self.postMessage({ status: 'Transcribing...' });
    const s0 = performance.now();
    const opts = model.startsWith('whisper') ? { chunk_length_s: 30 } : {};
    const out = await asr(audio, opts);
    const sttSec = (performance.now() - s0) / 1000;
    await asr.dispose?.();
    self.postMessage({ result: { model, device: 'wasm', dtype: 'q8', threads, loadSec, sttSec, audioSec: audio.length / 16000, text: String(out.text || '').trim() } });
  } catch (err) {
    self.postMessage({ error: err?.message || String(err) });
  }
};
