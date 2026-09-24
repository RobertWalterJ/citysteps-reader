// Audio files built on the phone: sentences joined into one WAV, and long
// "screen off" stretches compressed to Opus in an Ogg file.
//
// Why one long file: on the S23 FE a chain of short files stopped about 30 s
// after the screen locked (Android froze the page, so nothing started the
// next one), while a single 4-minute file played on (DECISIONS.md D18).
// Why compress: 30 minutes of the voice as WAV is about 80 MB; as Opus at
// 32 kbit/s it is about 7 MB.

export const GAP = 0.28;   // seconds of silence between sentences

// Join 16-bit mono pieces with a short pause; returns the samples and where
// each piece starts and ends (seconds).
export function join(pieces, rate) {
  const gap = Math.round(GAP * rate);
  const total = pieces.reduce((n, p) => n + p.length + gap, 0);
  const out = new Int16Array(total);
  const times = [];
  let o = 0;
  for (const p of pieces) {
    out.set(p, o);
    times.push([o / rate, (o + p.length) / rate]);
    o += p.length + gap;
  }
  return { pcm: out, times, seconds: total / rate };
}

export function wav(pcm, rate) {
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------- Opus in Ogg ----------

const OPUS_RATE = 24000;     // Opus takes 8, 12, 16, 24 or 48 kHz; Piper speaks at 22.05 kHz

function resample(pcm, from, to) {
  const n = Math.floor(pcm.length * to / from);
  const out = new Float32Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * step, k = Math.floor(x), f = x - k;
    const a = pcm[k] || 0, b = pcm[k + 1] ?? a;
    out[i] = (a + (b - a) * f) / 32768;
  }
  return out;
}

let CRC = null;
function crc32(bytes) {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0; CRC[i] = r >>> 0; }
  }
  let c = 0;
  for (const b of bytes) c = ((c << 8) ^ CRC[((c >>> 24) ^ b) & 0xff]) >>> 0;
  return c >>> 0;
}

function page(packets, { granule, serial, seq, bos = false, eos = false }) {
  const lacing = [];
  for (const p of packets) { let n = p.length; while (n >= 255) { lacing.push(255); n -= 255; } lacing.push(n); }
  const bodyLen = packets.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(27 + lacing.length + bodyLen);
  const v = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53]);        // "OggS"
  out[4] = 0; out[5] = (bos ? 2 : 0) | (eos ? 4 : 0);
  v.setBigUint64(6, BigInt(granule), true);
  v.setUint32(14, serial, true); v.setUint32(18, seq, true); v.setUint32(22, 0, true);
  out[26] = lacing.length;
  out.set(lacing, 27);
  let o = 27 + lacing.length;
  for (const p of packets) { out.set(p, o); o += p.length; }
  v.setUint32(22, crc32(out), true);
  return out;
}

export async function opusSupported() {
  try { return !!(window.AudioEncoder && (await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: 1, bitrate: 32000 })).supported); } catch { return false; }
}

// 16-bit mono at `rate` in, an Ogg Opus Blob out (or null if the phone
// cannot encode Opus, and the caller falls back to WAV).
export async function oggOpus(pcm, rate, onProgress) {
  if (!(await opusSupported())) return null;
  const f32 = resample(pcm, rate, OPUS_RATE);
  const packets = [];
  let failed = null;
  const enc = new AudioEncoder({
    output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); packets.push({ data: b, samples48: Math.round((chunk.duration || 20000) * 48000 / 1e6) }); },
    error: (e) => { failed = e; },
  });
  enc.configure({ codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: 1, bitrate: 32000 });
  const FRAME = OPUS_RATE;   // feed one second at a time
  for (let i = 0; i < f32.length; i += FRAME) {
    const part = f32.subarray(i, Math.min(f32.length, i + FRAME));
    enc.encode(new AudioData({ format: 'f32', sampleRate: OPUS_RATE, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round(i / OPUS_RATE * 1e6), data: part }));
    if (i % (FRAME * 30) === 0) { onProgress?.(i / f32.length); await new Promise((r) => setTimeout(r, 0)); }
  }
  await enc.flush();
  enc.close();
  if (failed || !packets.length) return null;

  const serial = (Math.random() * 0xffffffff) >>> 0;
  const PRE_SKIP = 312;
  const head = new Uint8Array(19), hv = new DataView(head.buffer);
  head.set([...'OpusHead'].map((c) => c.charCodeAt(0)));
  head[8] = 1; head[9] = 1; hv.setUint16(10, PRE_SKIP, true); hv.setUint32(12, OPUS_RATE, true); hv.setUint16(16, 0, true); head[18] = 0;
  const vendor = [...'CitySteps Reader'].map((c) => c.charCodeAt(0));
  const tags = new Uint8Array(8 + 4 + vendor.length + 4), tv = new DataView(tags.buffer);
  tags.set([...'OpusTags'].map((c) => c.charCodeAt(0))); tv.setUint32(8, vendor.length, true); tags.set(vendor, 12); tv.setUint32(12 + vendor.length, 0, true);

  const pages = [page([head], { granule: 0, serial, seq: 0, bos: true }), page([tags], { granule: 0, serial, seq: 1 })];
  let seq = 2, granule = PRE_SKIP, batch = [], lace = 0;
  for (let i = 0; i < packets.length; i++) {
    const p = packets[i];
    const need = Math.floor(p.data.length / 255) + 1;
    if (batch.length && lace + need > 255) { pages.push(page(batch, { granule, serial, seq: seq++ })); batch = []; lace = 0; }
    batch.push(p.data); lace += need; granule += p.samples48;
  }
  pages.push(page(batch, { granule, serial, seq: seq++, eos: true }));
  return new Blob(pages, { type: 'audio/ogg; codecs=opus' });
}
