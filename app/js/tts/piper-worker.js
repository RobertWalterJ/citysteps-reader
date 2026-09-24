// Piper voice worker: text in, 16-bit audio out.
//
// Measured on Robert's S23 FE (DECISIONS.md D18): medium Piper voices run at
// about 3x real time on the processor. He chose Alba (Scottish) and Northern
// English (man) (D19). ONNX Runtime files are pinned to the version esbuild
// bundles (see the lab worker for why).

import { TtsSession } from '@mintplex-labs/piper-tts-web';

const ORT_VERSION = '1.30.0';
const PATHS = {
  onnxWasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`,
  piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
  piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm',
};

let session = null, voice = null;

async function ready(voiceId) {
  if (session && voice === voiceId) return session;
  // TtsSession keeps one instance; a new voice needs a fresh one.
  TtsSession._instance = null;
  let last = -1;
  session = await TtsSession.create({
    voiceId, wasmPaths: PATHS,
    progress: (p) => {
      if (!p.total) return;
      const pct = Math.round((p.loaded / p.total) * 100);
      if (pct !== last) { last = pct; self.postMessage({ progress: pct, mb: Math.round(p.total / 1048576) }); }
    },
  });
  voice = voiceId;
  return session;
}

// The 16-bit samples and rate out of a WAV.
async function pcmOf(blob) {
  const buf = await blob.arrayBuffer();
  const v = new DataView(buf);
  const rate = v.getUint32(24, true);
  let o = 12;
  while (o < v.byteLength - 8) {
    const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    const size = v.getUint32(o + 4, true);
    if (id === 'data') return { pcm: new Int16Array(buf.slice(o + 8, o + 8 + size)), rate };
    o += 8 + size;
  }
  throw new Error('The voice returned no audio');
}

self.onmessage = async (e) => {
  const { id, voiceId, text } = e.data;
  try {
    const s = await ready(voiceId);
    if (text == null) { self.postMessage({ id, ready: true }); return; }
    const { pcm, rate } = await pcmOf(await s.predict(text));
    self.postMessage({ id, pcm, rate }, [pcm.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
