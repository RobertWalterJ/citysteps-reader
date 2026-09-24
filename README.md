# CitySteps Reader

Read PDFs aloud on the phone, and catch the ideas they spark. A CitySteps project: personal, not GPA.

The phone successor to CitySteps Studio. Everything runs on the phone. There are no accounts and no cloud services, and documents never leave the device.

## What works now (v0.2, Phase 1)

- **Add a PDF** from the file picker, or share one into the installed app from Drive, Gmail or Chrome (Android share sheet).
- **Cleaned-up text in reading order:**
  - two columns are read left then right, including under a full-width abstract;
  - running headers, footers and page numbers are removed;
  - hyphenated line breaks are rejoined.
- **Set aside, not read aloud unless you ask:** references, footnotes, captions, contents pages, formulas and garbled text. Each can be switched back on.
- **Tables and scanned pages** appear as cards that open the original page.
- **Read aloud** with the phone's own voice:
  - the sentence is highlighted, with a word cursor inside it;
  - you can play from any passage;
  - there are next and previous sentence controls and a speed setting;
  - the screen stays on while reading;
  - you pick up where you left off.
- **Sections list** for jumping around a long report.
- **Reading settings** carried over from Studio: text size, line spacing, word and letter spacing, background tint, and a night theme.
- **Details** (title, author, year, type, tags) can be edited per document.

The plan for the rest (voice notes, Kokoro voices on the lock screen, OCR, backup to GitHub) is in `PLAN.md`. The reasons behind each choice are in `DECISIONS.md`.

## Running it on the PC

Double-click **Launch CitySteps Reader.bat**. It opens the app at http://localhost:8898 and prints an HTTPS address for the phone on the same Wi-Fi.

## For Claude sessions

Read `CLAUDE.md` first.

```bash
npm install
npm run check     # house rules, colour audit, sentence and parser tests
npm run build     # check, then write docs/ for GitHub Pages
npm run serve
```

The parser test runs on real PDFs kept in `test-fixtures/local/`, which is not committed (see `test-fixtures/README.md`).
