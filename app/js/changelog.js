// What changed, in plain words, newest first. Shown once after an update
// ("Updated to v...") and any time from the version tag in the top bar.
// build/verify.mjs fails if the newest entry does not match package.json.

export const CHANGES = [
  {
    v: '0.6.0', date: '2026-09-25',
    items: [
      'Search: a new tab searches every document and note on the phone, and opens right at the passage.',
      'Skim: in Sections, switch on Skim to hear just the headings, the abstract, the first paragraph of each section and the conclusions.',
      'Prepare several for the commute: tick documents in the library menu and each gets a screen-off file from where you left off.',
      'Add a PDF from a link, or share a link to the app from Chrome. arXiv works directly; for sites that refuse, the app shows the two-tap way in.',
      'Storage on this phone: see what is using space and clear prepared audio, voices and models safely.',
    ],
  },
  {
    v: '0.5.0', date: '2026-09-25',
    items: [
      'Scanned pages are read: text recognition runs on the phone in the background, and the pages become readable like any other.',
      'Figures, photos and tables show a picture of themselves in the reader, with their caption and a button to hear it.',
      'Chart numbers and labels on pictures are no longer read out as a string of figures.',
      'Fix the order: tap a passage to skip it, have a footnote read, or move it after another passage. Undo from Sections.',
    ],
  },
  {
    v: '0.4.0', date: '2026-09-24',
    items: [
      'Natural voices: Alba (Scottish) reads by default, with Northern English as a second choice. The phone’s own voice is still there as an instant fallback.',
      'Listen with the screen off: prepare the next stretch of a document as one audio file, then lock the phone and keep listening.',
      'Lock-screen controls: pause, play and skip from the lock screen and the notification.',
      'This version tag, and a notice like this one whenever the app updates.',
    ],
  },
  {
    v: '0.3.0', date: '2026-09-24',
    items: [
      'Notes: say or type a thought while reading, tied to the sentence it came from.',
      'Recordings are saved as you speak and written out on the phone.',
      'Share recordings in from Samsung Voice Recorder.',
      'Back up notes to a private GitHub repo, and bring in CitySteps Studio notes.',
    ],
  },
  {
    v: '0.2.0', date: '2026-09-23',
    items: ['The reader: PDFs cleaned up and read aloud, with the sentence and word highlighted.'],
  },
];
