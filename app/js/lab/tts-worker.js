// Phone test: Kokoro speed. Loads kokoro-js's self-contained browser build
// (copied to vendor/ by the build), renders three sentences, times each.

const SENTENCES = [
  'The inner suburbs are changing faster than the plans written for them.',
  'A comparative case study of two Toronto neighbourhoods shows how residents were included, or left out, of revitalization.',
  'Tap any paragraph to start reading from there.',
];

self.onmessage = async (e) => {
  const { device } = e.data;
  try {
    const { KokoroTTS, env } = await import(new URL('../vendor/kokoro.web.js', import.meta.url).href);
    const dtype = device === 'webgpu' ? 'fp32' : 'q8';
    const threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    try { env.wasm && (env.wasm.numThreads = threads); } catch { /* older build */ }
    const t0 = performance.now();
    let lastPct = -1;
    const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype, device,
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total > 5e6) {
          const pct = Math.round((p.loaded / p.total) * 100);
          if (pct !== lastPct) { lastPct = pct; self.postMessage({ status: `Downloading the voice model: ${pct}% of ${Math.round(p.total / 1048576)} MB` }); }
        }
      },
    });
    const loadSec = (performance.now() - t0) / 1000;
    const sentences = [];
    let first = null;
    for (let i = 0; i < SENTENCES.length; i++) {
      self.postMessage({ status: `Rendering sentence ${i + 1} of ${SENTENCES.length}...` });
      const s0 = performance.now();
      const audio = await tts.generate(SENTENCES[i], { voice: 'af_heart' });
      const synthSec = (performance.now() - s0) / 1000;
      sentences.push({ synthSec, audioSec: audio.audio.length / audio.sampling_rate });
      if (!first) first = audio.toBlob();
    }
    // The first render warms things up; judge speed on the rest.
    const rest = sentences.slice(1);
    const speed = rest.reduce((a, s) => a + s.audioSec, 0) / rest.reduce((a, s) => a + s.synthSec, 0);
    self.postMessage({ result: { device, dtype, threads, loadSec, sentences, speed }, wav: first });
  } catch (err) {
    self.postMessage({ error: err?.message || String(err) });
  }
};
