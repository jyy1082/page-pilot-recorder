# Changelog

All notable changes to this project are documented in this file, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.0] — Text-based matching for buttons/links

### Added
- `generateSelector()` now tries the visible text content of `<button>`,
  `<a>`, and `role="button"` elements (if reasonably short) as a selector
  tier, producing a `{ selector: 'button', text: '...' }` target — often
  the most human-recognizable and redesign-resistant identifier a button
  has, and frequently the only thing available when there's no id/
  aria-label/data attribute at all. When more than one element shares the
  exact same text, it's disambiguated by position (adding `index`), the
  same approach already used for duplicate ids.
  Requires page-pilot 0.12.0+, which understands this target shape.
- 4 new real-browser tests: unique text matching, duplicate-text
  disambiguation, a plain `<a>` link with no attributes, and a full record
  → replay round trip confirming the exact duplicate-text element that was
  clicked during recording is the one clicked again on replay.

## [0.4.1]

### Documentation
- Added guidance on a real race condition: on pages that update content
  asynchronously without a full navigation, replaying a step right after
  one that triggers such an update can run ahead of it and hit a stale
  element. Points to page-pilot 0.11.0's new `waitFor(target, { state:
  'gone' })`, which waits for the old element to actually disappear (or the
  new one to appear) before continuing, instead of guessing a fixed delay.

## [0.4.0] — Duplicate-id disambiguation

### Added
- `generateSelector()` now handles duplicate `id` attributes (invalid HTML,
  but common on real, messier sites) instead of just discarding the id and
  falling all the way back to a deep structural path once it's found not to
  be unique. It disambiguates among the elements sharing that id by
  position, producing a `{ selector: '[id="..."]', index: N, fragile: true }`
  target — still marked fragile (a duplicate id is itself a markup smell
  worth reviewing), but far shorter and more robust than a structural path.
  Requires page-pilot 0.10.0+, which understands this target shape.
- 5 new real-browser tests: the disambiguation itself, and a full record →
  replay round trip confirming the exact duplicate that was clicked during
  recording is the one that gets clicked again on replay.

### Changed
- Internally, every step-producing code path now goes through one shared
  `_buildTarget(el, generated)` helper that decides whether a step's target
  needs to be a plain selector string or a `{ selector, index?, frame? }`
  object — previously frame-handling was duplicated across every call site;
  this also fixed a latent inconsistency where a couple of paths could have
  ended up attaching frame info differently. No change to the recorded
  output's meaning, just how it's assembled internally.

## [0.3.2]

### Security
- `<input type="password">` is now never recorded — a hard, non-configurable
  exclusion. Previously any input, regardless of type, was treated as a
  typeable field, meaning a typed password could end up verbatim inside a
  recorded `type` step. Excluded both from the normal `focusin`-triggered
  buffering and from the "field already focused before `start()`" seeding
  path. Verified with 2 new real-browser tests confirming the actual
  password text never appears anywhere in the recorded output.

## [0.3.1]

### Fixed
- Multi-line typing into a `<textarea>` (or `contenteditable`) only
  captured the first line. Enter is in the "non-character keys" list so
  keyboard shortcuts like Enter-to-submit get recorded — but inside a
  multi-line field, pressing Enter is just a newline, not a shortcut. Every
  newline was prematurely flushing the typing buffer into its own `type`
  step and clearing it, so anything typed after the first line had no
  buffer left to land in and was silently lost. Enter now flows into the
  typing buffer like any other character when the focused element is a
  `<textarea>` or `contenteditable` — single-line `<input>` fields are
  unaffected, Enter there still records as its own `pressKey` step.
- Added a real-browser regression test: typing three lines separated by
  Enter into a textarea now correctly captures all three, joined by `\n`.

## [0.3.0] — Drag detection, wait hints, and iframe support

### Added
- `dragTo` recording: a `mousedown` followed by movement past `dragThreshold`
  (default 10px) before `mouseup` is recorded as `{ type: 'dragTo', target,
  destination }`. Text-selection drags are detected and skipped. Set
  `recordDragTo: false` to disable.
- Wait hints: a step following a pause of `waitHintThreshold` (default
  1200ms) or more gets a `gapBefore` (ms) field and fires
  `onWaitHint(gapMs, step)` — a nudge that a `waitFor()` might belong there,
  not an automatic one (the recorder still can't know what selector to wait
  for).
- Same-origin iframe recording: interactions inside a same-origin iframe
  now get a `frame` field (an iframe selector, or an array for nested
  iframes) alongside the usual `target`, so page-pilot's `run()` knows
  which document to resolve the selector in. Cross-origin iframes remain
  unobservable (a hard browser security limitation). Set
  `recordIframes: false` to disable.
- `generateSelector()` (and the whole recorder) now resolves uniqueness
  against each element's own document (`el.ownerDocument`), not always the
  top-level `document` — required for correct selectors on elements inside
  iframes.

### Fixed
- Every `el instanceof Element` (and one `instanceof Document`) check
  silently failed for anything inside an iframe, since each iframe has its
  own separate realm with its own `Element`/`Document` constructors —
  `instanceof` across realms is always `false` even for structurally
  identical elements. Replaced with realm-safe `nodeType` checks
  (`nodeType === 1` / `=== 9`). This is what actually broke iframe click
  recording during development, caught only once real cross-frame
  interactions were tested in an actual browser.
- `_flushIfBlurred()`'s safety net compared the typing buffer's element
  against the top-level `document.activeElement` — for a field focused
  inside an iframe, the top document's `activeElement` is the `<iframe>`
  tag itself, never equal to the actual input, so this incorrectly flushed
  (and discarded) the buffer the instant it was created. Now compares
  against the buffered element's own `ownerDocument.activeElement`.
- A same-origin iframe's `contentDocument` gets replaced by a brand-new
  `Document` object once it finishes navigating to its real content —
  attaching listeners to whatever's there the instant the iframe is
  discovered could mean attaching to a transitional, about-to-be-discarded
  document. Iframe discovery now also listens for the iframe's own `load`
  event and re-attaches at that point.
- 12 new real-browser test cases covering dragTo (including the
  click-vs-drag threshold), wait hints, and iframe recording (typing,
  clicking, and a full record → replay round trip through a real
  `PagePilot.run()`).

## [0.2.0] — Custom dropdown detection (chooseOption)

### Added
- Automatic `chooseOption` merging: a click that reveals something (via a
  `MutationObserver` on style/class/hidden attribute changes or new nodes),
  immediately followed by a click on something inside what just appeared —
  with nothing else recorded in between, within `chooseOptionMergeWindow`
  (default 4000ms) — now merges into one `{ type: 'chooseOption', target,
  option, options: { waitAfterOpen } }` step instead of two separate
  `click` steps. Set `mergeChooseOption: false` to always get two plain
  clicks instead.
- `generateSelector()` now also tries any other `data-*` attribute (not
  just `data-testid`/`data-cy`/`data-test`/`data-qa`) as a selector
  candidate before falling back further — attributes like `data-value` on
  a custom dropdown option are usually read by the app's own logic, so
  they're a meaningfully more stable identifier than a structural fallback,
  even though they weren't put there specifically for testing.
- 8 new real-browser test cases covering the merge itself, the two
  false-positive-avoidance conditions (unrelated clicks, something else
  recorded in between), and a full record → replay round trip confirming
  the recorded `chooseOption` step actually works when fed into a real
  `PagePilot.run()`.

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
