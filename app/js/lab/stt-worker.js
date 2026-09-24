// Phone test: Whisper speed. Transformers.js pinned to 4.2.0 (4.3.0 breaks
// Whisper on WebGPU; CLAUDE.md). Uses WebGPU when the phone has it, else the
// processor.

import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

self.onmessage = async (e) => {
  const { model, audio } = e.data;
  try {
    const hasGpu = !!(await navigator.gpu?.requestAdapter?.().catch(() => null));
    const device = hasGpu ? 'webgpu' : 'wasm';
    const dtype = hasGpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8';
    const threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    try { env.backends.onnx.wasm.numThreads = threads; } catch { /* ignore */ }
    const t0 = performance.now();
    let lastPct = -1;
    const asr = await pipeline('automatic-speech-recognition', 'onnx-community/' + model, {
      device, dtype,
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total > 5e6) {
          const pct = Math.round((p.loaded / p.total) * 100);
          if (pct !== lastPct) { lastPct = pct; self.postMessage({ status: `Downloading ${p.file}: ${pct}% of ${Math.round(p.total / 1048576)} MB` }); }
        }
      },
    });
    const loadSec = (performance.now() - t0) / 1000;
    self.postMessage({ status: 'Transcribing...' });
    const s0 = performance.now();
    const out = await asr(audio, { language: 'en', task: 'transcribe', chunk_length_s: 30 });
    const sttSec = (performance.now() - s0) / 1000;
    self.postMessage({ result: { device, dtype: typeof dtype === 'string' ? dtype : 'fp32 + q4', threads, loadSec, sttSec, audioSec: audio.length / 16000, text: out.text.trim() } });
  } catch (err) {
    self.postMessage({ error: err?.message || String(err) });
  }
};
