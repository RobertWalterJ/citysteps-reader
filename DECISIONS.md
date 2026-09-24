# Decisions

Newest last. Each entry states the choice, what else was considered, and why.

## D1. Installable PWA on GitHub Pages (2026-09-23)

- **Chosen:** a PWA, plain ES modules, built to `docs/` and served from `main /docs`, matching Hok Gong.
- **Considered:** Capacitor wrapper; native Android app.
- **Why:** Robert is on Android (Galaxy S23), where PWAs can receive shared files, play audio on the lock screen and record audio. The iOS limits that motivated a Capacitor fallback do not apply. It can be revisited if Phase 0.5 shows Chrome pausing audio or the mic in ways we cannot work around.

## D2. $0 budget: on-device only (2026-09-23, Robert's call)

- **Chosen:** no cloud parsing, TTS or STT. The brief's "Tier 2" cloud parsing is replaced by on-device OCR, table and figure cards, and a manual "fix the order" mode.
- **Considered:** Claude PDF parsing (about $3 a month at his usage), Groq transcription, Google Chirp voices. Priced in PLAN.md section 8 for later.
- **Why:** Robert chose it. The design keeps a clean seam (a `parse.method` field and a transcription-engine field) so a paid engine can be added later without changing the data model.

## D3. No API-key proxy (2026-09-23)

- **Chosen:** no Cloudflare Worker. The only secret is a GitHub fine-grained token for backup, kept on the phone.
- **Considered:** (a) keys pasted into on-device settings; (b) a Worker proxy.
- **Why:** at $0 there are no paid keys to protect. For the GitHub token, option (a) is the right trade-off: the token is limited to one private repo and to file contents, it never leaves the phone except to api.github.com, and it can be revoked instantly. A proxy only earns its place when hiding one person's key from other users, and this app has one user. If paid APIs are added later, the same on-device approach works, since Anthropic, OpenAI, Groq and Google all accept direct browser calls.

## D4. IndexedDB + OPFS, not localStorage (2026-09-23)

- **Chosen:** IndexedDB for documents, notes and audio; the Origin Private File System for PDFs and models; `navigator.storage.persist()` after install.
- **Considered:** the sibling-app convention of a single versioned JSON blob in `localStorage`.
- **Why:** PDFs, audio and 80 to 250 MB models do not fit in `localStorage` (about 5 MB). Settings still follow the sibling pattern (versioned JSON, every read in try/catch) so the app works when storage is blocked.
- **Caveat:** every app on `robertwalterj.github.io` shares one origin, and therefore one storage quota and eviction decision. Database and cache names carry the `csreader-` prefix.

## D5. Save audio first, transcribe afterwards, on-device Whisper (2026-09-23)

- **Chosen:** MediaRecorder writes 5-second chunks to IndexedDB as they arrive. Whisper (Transformers.js, pinned to 4.2.0) transcribes when recording stops, from a persistent queue.
- **Considered:** Web Speech recognition for live text.
- **Why:** on Android Chrome, recognition returns nothing while a MediaRecorder is using the mic, `continuous` mode is ignored, and audio goes to Google's servers. It cannot meet the brief's rule that a failed transcription must never lose a thought. Transformers.js 4.3.0 has a WebGPU Whisper regression, hence the pin.

## D6. Two voices: built-in for instant, Kokoro for real listening (2026-09-23)

- **Chosen:** built-in `speechSynthesis` as the zero-download, instant voice. Kokoro 82M (8-bit, about 86 MB) renders audio for lock-screen and commute listening. The engine (sherpa-onnx or kokoro-js) is decided by measurement on the S23 in Phase 0.5.
- **Considered:** built-in only (no lock-screen playback, no word events on Android); cloud TTS (ruled out by D2); Piper or Kitten (kept as a lighter fallback).
- **Why:** Kokoro is the voice Robert picked in Studio. Only rendered audio in an `<audio>` element keeps playing when the screen is locked. kokoro-js has been unmaintained since May 2025, so sherpa-onnx is a real contender.

## D7. Word highlighting by proportional timing (2026-09-23)

- **Chosen:** reuse Studio's `startWordFollow` approach: time each word in proportion to its length across the sentence clip, drawn with the CSS Custom Highlight API.
- **Considered:** `onboundary` events from built-in speech.
- **Why:** those events never fire on Android Chrome. Studio's method works with any engine and Robert already uses it.

## D8. Tier 1 layout heuristics, gutter found from text items (2026-09-23)

- **Chosen:** use the PDF's tag tree when present; otherwise find column gutters from individual text items before building lines; strip repeated top and bottom lines; label footnotes, references, tables and figures; rejoin hyphenated breaks.
- **Considered:** building lines first and then finding columns (failed on the Stark paper: columns merged); LiteParse's browser build (still to evaluate in Phase 1; it may replace the table and figure work).
- **Why:** measured in `spikes/pdfjs-tier1-spike.mjs` on eight real PDFs. See PLAN.md section 3.3.

## D9. Backup to a private GitHub repo (2026-09-23, Robert's call)

- **Chosen:** a "Back up" action commits each note as a Markdown file (front matter holds type, tags and source anchors) plus library metadata as JSON, via the GitHub Contents API.
- **Considered:** Google Drive (needs a Google OAuth app), Notion (its API blocks browser calls, so a proxy would be needed), app only.
- **Why:** free, versioned, and readable as an Obsidian vault. PDFs themselves are not backed up (copyright, size); their source is recorded so they can be re-imported.

## D10. Test fixtures stay off the public repo (2026-09-23)

- **Chosen:** real PDFs live in the gitignored `test-fixtures/local/`. Parser tests commit expected structure (column counts, block kinds, headers found) and text hashes, never extracted text.
- **Why:** the Pages repo is public and most of the test documents are copyrighted.

## D11. PDFs in IndexedDB for now, not OPFS (2026-09-23, Phase 1)

- **Chosen:** PDF files are stored as Blobs in IndexedDB beside the parsed text.
- **Considered:** the Origin Private File System, as D4 planned.
- **Why:** one storage API is simpler, and IndexedDB holds Blobs of this size fine. OPFS stays the plan for the voice and transcription models (Phase 2 and 4), where streaming large files matters more. Revisit if big reports show slow imports on the phone.

## D12. Word cursor inverts to ink by day (2026-09-23, Phase 1)

- **Chosen:** the sentence being read has a pale yellow band; the word being read is ink with paper-coloured text (day) or signal yellow (night).
- **Considered:** Studio's look (word in signal yellow inside a paler yellow band), with and without an underline.
- **Why:** the colour audit failed it. Two light yellows differ by only 1.24:1 in lightness and collapse under tritanopia even with an underline. Inverting keeps the word unmistakable for any colour vision.

## D13. Phone is a Galaxy S23 FE (SM-S711W), not an S23 (2026-09-23)

- The Canadian S23 FE runs a Snapdragon (Adreno GPU), so the WebGPU plan holds. Recorded in PLAN.md section 2.

## D14. Kokoro on the processor will not read live (2026-09-23, measured on the PC)

- On Robert's laptop, Kokoro 8-bit on the processor (4 threads, isolated) rendered at 0.5x real time; on the Intel graphics chip (WebGPU, fp32) at 1.8x after warm-up. A phone processor will be slower than the laptop's, so live Kokoro on the phone depends on its GPU. Phase 0.5 measures it; if the phone is below 2x, Kokoro is used only to render ahead ("prepare for the commute") and the built-in voice reads live.

## D15. On the S23 FE, nothing heavy runs on the graphics chip (2026-09-24, measured on the phone)

- **Found:** Kokoro 8-bit on the processor ran at 0.27x real time. Kokoro on the Adreno graphics chip (WebGPU) produced noise: peaks past full scale and about 8,700 zero crossings a second (speech is roughly 1,000 to 3,000), and it slowed the phone badly. Whisper base and small on the graphics chip crashed Chrome and the phone.
- **Chosen:** voice and transcription run on the processor (WebAssembly, small 8-bit models). WebGPU is not used on this phone. Kokoro leaves the phone plan: the lighter **Piper** voices take its place (4.5x real time on the laptop's processor versus Kokoro's 0.5x), and **Moonshine base** is the leading transcription model (8x real time on the laptop, word for word; Whisper tiny 2.6x, base 1.6x). Phone numbers to confirm.
- **Kept open:** Robert's Studio Kokoro voices can still be used for commute audio rendered on the PC's RTX 4070 and brought to the phone; decide after the Piper results.

## D16. Built-in voice: leave a gap after cancel (2026-09-24)

- **Found:** the phone's built-in voice failed with "synthesis-failed" when speak() came straight after cancel(). The reader does exactly that when skipping sentences or changing speed.
- **Chosen:** `speech.js` waits out 250 ms after any cancel before speaking, and the player retries a failed sentence once before moving on.

## D17. 8-bit transcription models need basic graph optimization (2026-09-24)

- **Found:** with ONNX Runtime 1.30 on the processor, every 8-bit merged decoder (Whisper tiny, base, Moonshine) failed to load: "TransposeDQWeightsForMatMulNBits ... missing required scale". On the graphics chip that optimizer path never ran, which is why the first PC test passed.
- **Chosen:** `graphOptimizationLevel: 'basic'`. All three then transcribed a test sentence word for word.
