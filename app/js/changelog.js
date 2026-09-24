// What changed, in plain words, newest first. Shown once after an update
// ("Updated to v...") and any time from the version tag in the top bar.
// build/verify.mjs fails if the newest entry does not match package.json.

export const CHANGES = [
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
