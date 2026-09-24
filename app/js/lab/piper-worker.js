// Phone test: Piper voice speed, on the processor.
//
// Why Piper: on Robert's S23 FE (Sept 2026) Kokoro ran at 0.27x real time on
// the processor, and on the Adreno graphics chip it produced noise (peaks past
// full scale, about 8,700 zero crossings a second). Piper voices are much
// smaller and built for exactly this kind of hardware.
//
// piper-tts-web defaults to ONNX Runtime 1.18 files from a CDN, but esbuild
// bundles the ONNX Runtime JavaScript from node_modules (1.30.0); the two must
// match, so the runtime files are pointed at the same version.

import { TtsSession } from '@mintplex-labs/piper-tts-web';

const ORT_VERSION = '1.30.0';
const SENTENCES = [
  'The inner suburbs are changing faster than the plans written for them.',
  'A comparative case study of two Toronto neighbourhoods shows how residents were included, or left out, of revitalization.',
  'Tap any paragraph to start reading from there.',
];

// Length of a 16-bit mono WAV, from its header.
async function wavSeconds(blob) {
  const v = new DataView(await blob.arrayBuffer());
  const rate = v.getUint32(24, true), bits = v.getUint16(34, true), ch = v.getUint16(22, true);
  let o = 12;
  while (o < v.byteLength - 8) {
    const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    const size = v.getUint32(o + 4, true);
    if (id === 'data') return size / (rate * ch * (bits / 8));
    o += 8 + size;
  }
  return 0;
}

self.onmessage = async (e) => {
  const { voiceId } = e.data;
  try {
    const t0 = performance.now();
    let lastPct = -1;
    const session = await TtsSession.create({
      voiceId,
      wasmPaths: {
        onnxWasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`,
        piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
        piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm',
      },
      progress: (p) => {
        if (!p.total) return;
        const pct = Math.round((p.loaded / p.total) * 100);
        if (pct !== lastPct) { lastPct = pct; self.postMessage({ status: `Downloading the voice: ${pct}% of ${Math.round(p.total / 1048576)} MB` }); }
      },
    });
    const loadSec = (performance.now() - t0) / 1000;
    const sentences = [];
    let first = null;
    for (let i = 0; i < SENTENCES.length; i++) {
      self.postMessage({ status: `Rendering sentence ${i + 1} of ${SENTENCES.length}...` });
      const s0 = performance.now();
      const wav = await session.predict(SENTENCES[i]);
      const synthSec = (performance.now() - s0) / 1000;
      sentences.push({ synthSec, audioSec: await wavSeconds(wav) });
      if (!first) first = wav;
    }
    const rest = sentences.slice(1);
    const speed = rest.reduce((a, s) => a + s.audioSec, 0) / rest.reduce((a, s) => a + s.synthSec, 0);
    self.postMessage({ result: { engine: 'piper', voiceId, device: 'wasm', loadSec, sentences, speed }, wav: first });
  } catch (err) {
    self.postMessage({ error: err?.message || String(err) });
  }
};
