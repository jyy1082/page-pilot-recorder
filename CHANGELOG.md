# Changelog

All notable changes to this project are documented in this file, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.3]

### Added
- A real-browser regression suite (`test/browser-test.mjs`, `npm test`)
  using Playwright + Chromium, covering everything 0.1.1/0.1.2 fixed plus
  the original working cases — driven by actual `page.click()`/`page.fill()`
  /`page.selectOption()`/`keyboard.press()` interactions rather than
  synthetic `dispatchEvent()` calls. This exists because the bugs fixed in
  0.1.1 and 0.1.2 both passed a full jsdom-based suite; jsdom's event
  simulation doesn't reproduce real browser focus timing closely enough to
  have caught them before a real person did.
- Since `npx playwright install` needs `cdn.playwright.dev`, which isn't
  reachable in every environment (including the one these tests were
  developed in), the suite obtains Chromium via `@sparticuz/chromium`
  instead, which ships the binary inside its own npm tarball, and points
  Playwright's `launch({ executablePath })` at it directly.

## [0.1.2]

### Fixed
- Typing could still be silently lost in real-world use even after 0.1.1's
  fix, whenever focus moved away from a field without a `focusout` event
  being observably fired for it (e.g. moving focus into a native `<select>`
  in some browsers/interaction patterns) — the recorder relied on
  `focusin`/`focusout` exclusively, and that turned out to be fragile.
  Every `click`/`change`/`keydown` now also checks `document.activeElement`
  directly and flushes the typing buffer if it no longer matches, as a
  safety net independent of whether a focus event was seen at all.

### Changed
- A plain click into a text field/textarea (just focusing it to type) is no
  longer recorded as its own `click` step — it was pure noise, since
  focusing the element is already implicit in the `type` step that follows,
  and a redundant `click()` during replay could risk unwanted side effects.

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
