# page-pilot-recorder

[中文](./README.zh-CN.md) · **English**

**Version 0.5.6** · see [CHANGELOG.md](./CHANGELOG.md) for release history

Records real user interactions on a page and turns them into a step array
in exactly the shape [page-pilot](https://github.com/jyy1082/page-pilot)'s
`run()` expects — record once, play it back, no hand-written selectors.

This is a companion tool, not part of the playback engine. It only listens
to real (`isTrusted`) DOM events and never dispatches anything itself — it's
the mirror image of page-pilot, which only ever dispatches synthetic events
and never listens for real ones.

## Demo

**[Open the live demo](https://jyy1082.github.io/page-pilot-recorder/demo.html)**
— interact with the sample form normally (type, pick a country, check a
box), press Stop, and watch the exact same sequence play back automatically
with page-pilot's cursor animation, using only what got recorded.

## Install

```bash
npm install page-pilot-recorder
```

Or just copy `page-pilot-recorder.js` directly into your project.

## Usage

```js
import { PagePilotRecorder } from 'page-pilot-recorder'

const recorder = new PagePilotRecorder()
recorder.start()

// ...interact with the page normally: click, type, select, check...

const steps = recorder.stop()
console.log(JSON.stringify(steps, null, 2))
```

The output is a plain array, ready to hand straight to page-pilot:

```js
import { PagePilot } from 'page-pilot'

const cursor = new PagePilot()
await cursor.run(steps) // the exact array recorder.stop() gave you
```

### With the floating control panel (default)

```js
const recorder = new PagePilotRecorder({ ui: true }) // default
recorder.start()
// a small "● 0 steps [Stop] [Copy]" panel appears in the corner;
// clicking Stop stops recording, Copy puts the JSON on the clipboard
```

### Watching steps as they're recorded

```js
const recorder = new PagePilotRecorder({
  onStep: (step) => console.log('recorded:', step),
})
```

## What gets recorded

| Interaction | Step produced |
|---|---|
| Click | `{ type: 'click', target }` |
| Typing (buffered until the field loses focus, not per keystroke) | `{ type: 'type', target, text }` |
| Native `<select>` (single or multi) | `{ type: 'select', target, value }` |
| Checkbox / radio | `{ type: 'check', target, checked }` |
| Non-character keys (Enter, Escape, Tab, arrows, etc.) and any key combined with a modifier (Ctrl+A, Cmd+S, etc.) | `{ type: 'pressKey', target, key, options }` |
| Scrolling a window or a container, debounced until it settles | `{ type: 'scroll', target, options }` (uses `{ to: 'top' \| 'bottom' }` when it lands on an edge, `{ amount }` otherwise) |
| Opening a custom dropdown/menu and picking an option inside it | `{ type: 'chooseOption', target, option, options: { waitAfterOpen } }` — merged automatically, see below |
| A drag gesture (mousedown, moved past a threshold, mouseup) | `{ type: 'dragTo', target, destination }` — `destination` is an element selector if one was under the pointer at mouseup, otherwise a raw `{ x, y }` point |

Any step can also carry:
- **`frame`** — present when the interaction happened inside a same-origin iframe (an iframe selector, or an array of them for nested iframes), so page-pilot knows which document to look in. See "iframe support" below.
- **`gapBefore`** (ms) — present when there was a long pause before this step, a nudge that something might have been loading. See "Wait hints" below.
- **`fragile: true`** — present when the selector had to fall back to a structural path. See "Selector generation" below.

### Custom dropdown detection (chooseOption)

A click that reveals something (a `MutationObserver` sees a DOM change —
whether a `style`/`class`/`hidden` change on an existing hidden menu, or
brand-new nodes), followed immediately by a click on something inside what
just appeared, gets merged into a single `chooseOption` step instead of two
separate `click` steps — as long as nothing else was recorded in between
and the second click follows within `chooseOptionMergeWindow` (default
4000ms). The gap between the two real clicks is captured as
`options.waitAfterOpen`, so replay times it the same way it actually happened.

This is a heuristic, not a certainty — set `mergeChooseOption: false` if you'd
rather always get two plain `click` steps and merge them yourself.

### Drag detection (dragTo)

A `mousedown` followed by enough movement (`dragThreshold`, default 10px)
before `mouseup` counts as a drag rather than a click — browsers already
suppress the `click` event themselves when the pointer moves that much
between down and up, so there's no risk of double-recording the same
gesture. A drag that ends inside a non-empty text selection is assumed to
be the person selecting text, not dragging a UI element, and isn't
recorded at all (there's no faithful way to "replay" a text selection).
Set `recordDragTo: false` to turn this off entirely.

### Wait hints (gapBefore)

If a step follows a pause of `waitHintThreshold` (default 1200ms) or more,
it gets a `gapBefore` (ms) field and fires `onWaitHint(gapMs, step)`. This
is **not** an automatic `waitFor()` step — the recorder has no way to know
what selector to wait for — just a nudge that a pause happened here, in
case something was loading asynchronously and the generated script should
have a `waitFor()` inserted at that point.

```js
const recorder = new PagePilotRecorder({
  onWaitHint: (gapMs, step) => console.log(`${gapMs}ms pause before`, step),
})
```

### iframe support

Interactions inside a **same-origin** iframe are recorded like anything
else, just with a `frame` field added so page-pilot knows which document to
resolve the selector in:

```json
{ "type": "click", "target": "#confirm-btn", "frame": "#payment-iframe" }
```

For nested iframes, `frame` becomes an array (outermost to innermost). This
"just works" on the page-pilot side — pass the recorded steps straight to
`run()`, no manual adjustment needed. **Cross-origin iframes can't be
observed at all** — that's a hard browser security limitation (the same
reason no automation tool can reach into them without special server-side
cooperation), not something this library can work around. Set
`recordIframes: false` to disable iframe traversal entirely.

## What does NOT get recorded (by design)

- **Password fields** — `<input type="password">` is never recorded, not
  even as a `type` step with the actual value. This is a hard exclusion,
  not a configurable option — there's no legitimate reason a generated
  automation script should contain someone's typed password.
- **Your own recording controls** — if you build a custom UI (Start/Stop/
  Replay buttons) instead of using the built-in floating panel, mark them
  with `data-ppr-ignore` so clicking "Stop" doesn't itself get recorded as
  the last step of the session:
  ```html
  <button id="stop-btn" data-ppr-ignore>Stop</button>
  ```

- **`waitFor()` steps themselves** — see "Wait hints" above for the closest
  thing to automatic help here; you still decide what to wait for. This
  matters most on pages that update content asynchronously without a full
  navigation (most modern apps): if a recorded step clicks something that
  triggers such an update, and the very next step depends on that update
  having landed, replaying the raw recording can run ahead of it and hit a
  stale/about-to-be-replaced element. If you hit that, insert a
  [page-pilot](https://github.com/jyy1082/page-pilot) `waitFor()` step
  between them — `{ state: 'gone' }` to wait for the old element to
  actually disappear first, or the default (wait for something to appear)
  for the new content:
  ```js
  { type: 'click', target: '#save-btn' },
  { type: 'waitFor', target: '#save-btn', options: { state: 'gone' } },
  { type: 'waitFor', target: '#saved-confirmation' },
  ```
- **`hover`/`unhover`** — real hover gestures aren't reliably distinguishable
  from incidental mouse movement without a lot of false-positive risk. Add
  these by hand.

Recording is a starting point, not a finished script — review the output,
especially anything marked `fragile: true` (see below), before relying on
it long-term.

## Selector generation

Every recorded step's `target` is generated by trying, in order, whichever
of these first produces a selector that uniquely matches the element:

1. `id` — and if the `id` isn't actually unique (duplicate ids happen a lot
   on real, messier sites — invalid HTML, but browsers don't stop anyone),
   disambiguate among just the elements sharing it by position instead of
   giving up on the id entirely. This produces a `{ selector, index }`
   target rather than a plain string, still marked `fragile: true`.
2. `data-testid` / `data-cy` / `data-test` / `data-qa`
3. Any other `data-*` attribute (e.g. `data-value` on a custom dropdown
   option) — the app's own JS usually reads these, so they tend to be
   stable even though they weren't put there specifically for testing
4. `aria-label`
5. `name` attribute
6. For `<button>`/`<a>`/`role="button"` elements: the visible text content,
   if it's reasonably short (≤60 chars) — often the most human-recognizable
   and redesign-resistant identifier a button has, and frequently present
   even when there's no id/aria-label/data attribute at all. Produces a
   `{ selector: 'button', text: '...' }` target (or with `index` added, the
   same way as duplicate ids, if more than one element shares that exact
   text — e.g. a "Delete" button repeated in every row of a list).
7. Non-utility class names (filters out Tailwind-style utility classes like
   `p-2`, `hover:bg-blue-500`, minified single-letter classes, etc.)
8. A structural `nth-of-type` path as a last resort, rooted at the nearest
   ancestor with an `id` if one exists

Steps that had to fall back to a duplicate-id index, duplicate text, or
option 8 (the structural path) carry a `fragile: true` flag — these are the
ones most likely to break if the page's markup changes even slightly. If
you see one, it's usually worth adding a `data-testid` to that element and
re-recording, rather than shipping the structural path as-is.

```js
import { generateSelector } from 'page-pilot-recorder'

const { selector, fragile, index, text } = generateSelector(document.querySelector('.some-el'))
// index/text are only present when disambiguating a duplicate id or matching by button/link text
```

## API

| Method | Description |
|---|---|
| `new PagePilotRecorder(options?)` | Create a recorder. See options below. |
| `start()` | Start listening for interactions. Returns `this`. |
| `stop()` | Stop listening and return the recorded steps array. |
| `clear()` | Empty the recorded steps without stopping. |
| `destroyUi()` | Remove the floating control panel, if shown. |
| `recorder.steps` | The steps recorded so far (also returned by `stop()`). |

### Options

```js
new PagePilotRecorder({
  ui: true,               // show the floating start/stop/copy panel
  scrollSettleDelay: 250, // ms of no scroll activity before a scroll step is recorded
  mergeChooseOption: true, // detect trigger-click + option-click into one chooseOption step
  chooseOptionMergeWindow: 4000, // max ms between the two clicks for them to still merge
  recordDragTo: true,     // detect mousedown-move-mouseup gestures as dragTo steps
  dragThreshold: 10,      // px of movement before a mousedown/mouseup pair counts as a drag
  waitHintThreshold: 1200, // ms of silence before a step gets a gapBefore hint
  recordIframes: true,    // also record interactions inside same-origin iframes
  onStep: (step) => {},   // called every time a step is recorded
  onWaitHint: (gapMs, step) => {}, // called when a long pause is detected before a step
})
```

## Testing

```bash
npm install
npm test
```

This runs a real-browser regression suite (Playwright + Chromium), not a
simulated one — that distinction matters here specifically. The earliest
bugs in this recorder (typing silently lost when a field was already
focused before `start()`, typing lost when focus moved to a `<select>`
without an observable `focusout`, a click on the recorder's own Stop button
getting self-recorded) all passed a full jsdom-based test suite; jsdom's
synthetic event dispatch doesn't reproduce real browser focus timing
closely enough to catch them. `test/browser-test.mjs` drives an actual
Chromium instance and interacts with a test page the way a real user would
(`page.fill()`, `page.click()`, `page.selectOption()`,
`keyboard.press()`), which is what actually exposed those bugs.

If `npx playwright install` can't reach `cdn.playwright.dev` in your
environment (some sandboxed/CI setups block it), the test script obtains a
working Chromium a different way — via `@sparticuz/chromium`, which ships
the browser binary inside its npm package tarball instead of a separate
download step, and points Playwright at that executable directly.

## License

MIT
