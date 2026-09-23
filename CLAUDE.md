# CitySteps Reader: conventions for Claude sessions

Robert's personal phone app for reading PDFs aloud and capturing ideas. Read `PLAN.md` (what and why) and `DECISIONS.md` (choices and alternatives) before changing anything.

## Identity

- **CitySteps, not GPA.** This is Robert's personal project, paid for from his own credits. No GPA name, logo or client examples anywhere. Never use "520 Highway 8" or Stoney Creek as an example.
- Look and feel come from CitySteps Studio (`Documents\CitySteps - Claude CoWork\CitySteps Studio\webapp\index.html`): paper `#FEFDF8`, ink `#1B1B18`, signal yellow `#FFD400` (accent only, never carries text), butter `#FBF3C0`; Bricolage Grotesque, Hanken Grotesk and JetBrains Mono, bundled locally.
- Tone: relaxed, curious, plain.

## Writing rules (UI copy and docs)

- Plain, precise language. **No em dashes.**
- Never "advocacy"; the term is "public interest planning".

## Accessibility (standing rules: Robert is dyslexic)

- No timers or countdowns switched on by default. Nothing advances by itself unless it is generous and there is a "wait for a tap" option.
- Read-aloud is core, not optional. A visible speaker icon goes next to any substantial text.
- Prefer icons, colour and shape over extra words. Carry over Studio's reading preferences (size, letter and word spacing, line height, tint, line focus).
- Mobile will not speak until a user gesture: call `unlock()` on the first `pointerdown` (pattern from `Documents\Wordhoard\app\js\speech.js`).

## Build and deploy (matches Hok Gong, `Documents\Cantonese`)

- `app/` is hand-written source (plain ES modules). `docs/` is generated. Never edit `docs/` by hand.
- `npm run check` runs every gate. `npm run build` bundles and writes `docs/`. Pages serves `main /docs`.
- No absolute URLs; the site lives under `/citysteps-reader/`.
- The service worker and every cache and IndexedDB name use the `csreader-` prefix, because all of Robert's apps share the `robertwalterj.github.io` origin. Never call global `caches.match()`; on activate, delete only our own old caches.
- Commit messages: `vX.Y.Z, plain summary`. Behaviour tests open with a comment quoting the complaint that caused them, with a date.
- Ship a double-click `Launch CitySteps Reader.bat` for local preview. Robert does not use terminals.

## Hard rules

- **Save audio before transcribing.** A failed transcription must never lose a recording.
- Heavy work (PDF parsing, Kokoro, Whisper, OCR) runs in Web Workers, never on the main thread.
- Pinned versions: pdfjs-dist 6.3.x; Transformers.js 4.2.0 (4.3.0 breaks Whisper on WebGPU). Check current versions before upgrading.
- Copyrighted test PDFs never get committed. See `test-fixtures/README.md`.
- Verify on the real user path (the phone, real PDFs) and say plainly what was not verified.
