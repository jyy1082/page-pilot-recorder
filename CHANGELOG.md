# Changelog

All notable changes to this project are documented in this file, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1]

### Fixed
- Typing was silently lost entirely (no `type` step produced at all) if a
  field already had focus at the moment `start()` was called — no
  `focusin` event ever fires in that case, since focus never changes, so
  the typing buffer was never created. `start()` now checks
  `document.activeElement` and seeds the buffer immediately if it's already
  sitting in a form field.
- Clicking a custom Stop/Start/Replay control (built outside the recorder's
  own floating UI) got recorded as a spurious extra `click` step, since the
  recorder's capture-phase listener fires before the control's own
  bubble-phase handler calls `stop()`. Added a `data-ppr-ignore` attribute
  you can put on your own controls to exclude them from recording (the
  built-in floating UI is already excluded automatically).

## [0.1.0] — Initial release

### Added
- `PagePilotRecorder` class: `start()`, `stop()`, `clear()`, `destroyUi()`.
- Records click, typing (buffered until blur), native `<select>`
  (single/multi), checkbox/radio (as `check` steps), non-character keys and
  modifier-key shortcuts (as `pressKey` steps), and debounced window/
  container scrolling.
- `generateSelector()`: id → data-testid/data-cy/data-test/data-qa →
  aria-label → name → non-utility class names → structural fallback
  (flagged `fragile: true`).
- Optional floating start/stop/copy control panel.
- `demo.html`: full record → generate steps → replay loop using page-pilot.
