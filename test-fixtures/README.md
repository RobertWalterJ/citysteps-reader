# Test fixtures

The real PDFs are **not committed**. This repo is public (GitHub Pages), and most
of the test documents are copyrighted journal articles, newspaper pages or City
files. Copy them into `test-fixtures/local/` (gitignored) or point the spike at
their original paths.

| # | Brief category | File (on Robert's PC, under `Downloads\` unless noted) | What it tests |
|---|---|---|---|
| 1a | Two-column academic | `Stark-2016-Disempowering-Processes.pdf` | 2 columns, running header, 1-column abstract on p1 |
| 1b | Two-column academic | `Post-studentification_Promises_and_pitfalls_of_a_n.pdf` | 2 columns on most pages, 19 pages |
| 1c | Single-column manuscript | `Carson_etal_2020_Imagining_a_Post_Covid_19_World_of_Real_Estate.pdf` | cover page, footnote markers, references |
| 1d | Book-chapter style | `22423-Article Text-54244-1-10-20170201 (1).pdf` | 30 pages, epigraphs, running headers both sides |
| 2a | Municipal report | `1536-KING-ST-W - CA Staff Report.pdf` | City memo, photo, quoted OP policy |
| 2b | Municipal table | `Documents\GPA Work - Claude Cowork\Policy and Legislation\City of Toronto - Topic Files\Inclusionary Zoning\Inclusionary-zoning-jurisdictional-scan_ATTACHMENT2_backgroundfile-133050.pdf` | a whole-page table: must become a card, not be read aloud |
| 3 | News | `Is a bedroom for the cat a sign of Canada’s new housing aristocracy_ - The Globe and Mail.pdf` | browser-printed article: date/URL header and footer on every page |
| 4 | Scan, no text layer | `PLN-CA Sign Posting Photo - NOV 19  2020.pdf` | detection, then OCR |

Still wanted from Robert: a true **print newspaper or magazine page** (multi-article
layout with sidebars), a **long Toronto staff report** (60+ pages, with maps), and a
**scanned multi-page report**.

Run the Phase 0 spike:

```bash
npm install pdfjs-dist
node spikes/pdfjs-tier1-spike.mjs <pdf> [<pdf> ...]
```
