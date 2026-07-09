/**
 * page-pilot-recorder
 * Records real user interactions on a page and turns them into a step array
 * in the exact shape PagePilot's run() expects — so you can record once and
 * play it back with page-pilot.js without hand-writing selectors.
 *
 * This is a companion tool, not part of the playback engine. It only listens
 * to real (isTrusted) DOM events and never dispatches anything itself.
 *
 * Usage:
 *   import { PagePilotRecorder } from './page-pilot-recorder.js'
 *   const recorder = new PagePilotRecorder({ ui: true })
 *   recorder.start()
 *   // ...user interacts with the page normally...
 *   const steps = recorder.stop()
 *   console.log(JSON.stringify(steps, null, 2))
 *   // paste the result straight into: await cursor.run(steps)
 *
 * What gets recorded:
 *   - click            → { type: 'click', target } (not recorded for a
 *     plain click into a text field/textarea — that's just focusing it to
 *     type, already implicit in the 'type' step)
 *   - typing            → { type: 'type', target, text }  (buffered until blur, not per-keystroke)
 *   - native <select>   → { type: 'select', target, value }
 *   - checkbox/radio    → { type: 'check', target, checked }
 *   - non-character keys (Enter/Escape/Tab/arrows/etc.), and any key combined
 *     with a modifier (Ctrl+A, Cmd+S, etc.) → { type: 'pressKey', target, key, options }
 *   - scroll (window or a container), debounced until it settles → { type: 'scroll', target, options }
 *
 * What does NOT get recorded (by design, needs a human to decide):
 *   - waitFor() steps — the recorder has no way to know what's "loading
 *     asynchronously"; add these yourself where the generated script needs
 *     to wait for something.
 *   - hover/unhover, dragTo — real hover and drag gestures aren't
 *     meaningfully distinguishable from incidental mouse movement without a
 *     lot of false-positive risk, so v1 leaves these out. Add them by hand.
 *   - chooseOption — a custom dropdown just gets recorded as two separate
 *     click steps (open the menu, click the option), which plays back
 *     correctly, just without the more semantic chooseOption() call.
 *
 * Selector generation prefers stable attributes over structural position:
 *   id → data-testid/data-cy/data-test/data-qa → aria-label → name →
 *   non-utility class names → structural nth-of-type path (last resort).
 * Every generated step carries a `fragile: true` flag when it had to fall
 * back to a structural path, so you know which ones to double check before
 * relying on the script long-term.
 */

const UTILITY_CLASS_PATTERNS = [
  /:/, // Tailwind variants like hover:bg-blue-500
  /^\d/, // classes starting with a digit
  /^[a-z]{1,2}$/, // single/double letter classes (usually generated/minified)
  /^(w|h|p|m|px|py|mx|my|pt|pb|pl|pr|mt|mb|ml|mr|gap|text|bg|flex|grid|rounded|border|shadow|z|top|left|right|bottom|inset|opacity|transition|duration|ease|cursor|select|items|justify|space|col|row)-/,
];

function isStableClass(cls) {
  if (!cls) return false;
  return !UTILITY_CLASS_PATTERNS.some((re) => re.test(cls));
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return String(value).replace(/([^\w-])/g, '\\$1');
}

/** Escape a value going inside a quoted attribute selector, e.g. [name="..."]. */
function escapeAttrValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isUnique(selector) {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function nearestIdAncestor(el) {
  let node = el.parentElement;
  while (node) {
    if (node.id) return node;
    node = node.parentElement;
  }
  return null;
}

function structuralPath(el, stopAt) {
  const parts = [];
  let node = el;
  while (node && node !== stopAt && node.tagName) {
    const parent = node.parentElement;
    if (!parent) break;
    const siblingsOfType = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
    const index = siblingsOfType.indexOf(node) + 1;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
    node = parent;
  }
  return parts.join(' > ');
}

/**
 * Generate a CSS selector for an element, preferring stable attributes over
 * structural position. Returns { selector, fragile }. `fragile: true` means
 * this had to fall back to a structural path — review it before relying on
 * the generated script long-term; consider adding a data-testid instead.
 */
export function generateSelector(el) {
  if (el.id) {
    const sel = `#${cssEscape(el.id)}`;
    if (isUnique(sel)) return { selector: sel, fragile: false };
  }

  for (const attr of ['data-testid', 'data-cy', 'data-test', 'data-qa']) {
    const val = el.getAttribute(attr);
    if (val) {
      const sel = `[${attr}="${escapeAttrValue(val)}"]`;
      if (isUnique(sel)) return { selector: sel, fragile: false };
    }
  }

  // Any other data-* attribute is often a stable functional identifier too
  // (e.g. data-value on a custom dropdown option) — the app's own JS reads
  // it, so it's unlikely to get renamed casually, unlike a CSS class.
  const skipDataAttrs = new Set(['data-testid', 'data-cy', 'data-test', 'data-qa', 'data-ppr-ignore']);
  for (const attr of el.attributes || []) {
    if (!attr.name.startsWith('data-') || skipDataAttrs.has(attr.name)) continue;
    const sel = `${el.tagName.toLowerCase()}[${attr.name}="${escapeAttrValue(attr.value)}"]`;
    if (isUnique(sel)) return { selector: sel, fragile: false };
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const sel = `${el.tagName.toLowerCase()}[aria-label="${escapeAttrValue(ariaLabel)}"]`;
    if (isUnique(sel)) return { selector: sel, fragile: false };
  }

  const name = el.getAttribute('name');
  if (name) {
    const sel = `${el.tagName.toLowerCase()}[name="${escapeAttrValue(name)}"]`;
    if (isUnique(sel)) return { selector: sel, fragile: false };
  }

  const stableClasses = Array.from(el.classList || []).filter(isStableClass);
  if (stableClasses.length) {
    const sel = `${el.tagName.toLowerCase()}.${stableClasses.map(cssEscape).join('.')}`;
    if (isUnique(sel)) return { selector: sel, fragile: false };
  }

  const ancestor = nearestIdAncestor(el);
  const path = structuralPath(el, ancestor || document.body);
  const selector = ancestor ? `#${cssEscape(ancestor.id)} > ${path}` : path;
  return { selector, fragile: true };
}

const NON_CHARACTER_KEYS = new Set([
  'Enter', 'Escape', 'Tab', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
]);

const DEFAULTS = {
  ui: true, // show a small floating start/stop/copy control panel
  scrollSettleDelay: 250, // ms of no scroll activity before a scroll step is recorded
  mergeChooseOption: true, // detect trigger-click + option-click into one chooseOption step
  chooseOptionMergeWindow: 4000, // max ms between the two clicks for them to still merge
  onStep: null, // (step) => void, called every time a step is recorded
};

export class PagePilotRecorder {
  constructor(options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.recording = false;
    this.steps = [];
    this._typingBuffer = null; // { el, selector, startValue }
    this._scrollTimers = new Map(); // scroll target -> debounce timer
    this._scrollStartTop = new Map(); // scroll target -> scrollTop when this settle-cycle began
    this._pendingTrigger = null; // last click step, candidate to merge into a chooseOption
    this._recentMutations = []; // { target, time } — rolling window for chooseOption detection
    this._mutationObserver = null;

    this._onClick = this._onClick.bind(this);
    this._onChange = this._onChange.bind(this);
    this._onFocusIn = this._onFocusIn.bind(this);
    this._onFocusOut = this._onFocusOut.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onScroll = this._onScroll.bind(this);
  }

  /** Start listening. Returns this, so `recorder.start()` reads naturally. */
  start() {
    if (this.recording) return this;
    this.recording = true;
    this.steps = [];
    this._pendingTrigger = null;
    this._recentMutations = [];
    document.addEventListener('click', this._onClick, true);
    document.addEventListener('change', this._onChange, true);
    document.addEventListener('focusin', this._onFocusIn, true);
    document.addEventListener('focusout', this._onFocusOut, true);
    document.addEventListener('keydown', this._onKeyDown, true);
    document.addEventListener('scroll', this._onScroll, true);

    if (this.opts.mergeChooseOption) {
      this._mutationObserver = new MutationObserver((mutations) => this._onMutations(mutations));
      this._mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'open', 'aria-hidden'],
      });
    }

    // If a form field already has focus at the moment recording starts (the
    // person clicked into it before pressing "Start", or it was autofocused),
    // no 'focusin' will ever fire for it during this session — nothing would
    // trigger the typing buffer to be created, silently losing anything they
    // type. Seed the buffer immediately as if a focusin had just happened.
    const active = document.activeElement;
    if (active instanceof Element && this._isFormField(active)) {
      this._beginTypingBuffer(active);
    }

    if (this.opts.ui) this._showUi();
    return this;
  }

  /** Stop listening and return the recorded steps array. */
  stop() {
    if (!this.recording) return this.steps;
    this.recording = false;
    this._flushTyping();
    document.removeEventListener('click', this._onClick, true);
    document.removeEventListener('change', this._onChange, true);
    document.removeEventListener('focusin', this._onFocusIn, true);
    document.removeEventListener('focusout', this._onFocusOut, true);
    document.removeEventListener('keydown', this._onKeyDown, true);
    document.removeEventListener('scroll', this._onScroll, true);
    for (const timer of this._scrollTimers.values()) clearTimeout(timer);
    this._scrollTimers.clear();
    this._mutationObserver?.disconnect();
    this._mutationObserver = null;
    this._recentMutations = [];
    this._pendingTrigger = null;
    if (this._uiEl) this._setUiRecordingState(false);
    return this.steps;
  }

  /** Clear everything recorded so far without stopping. */
  clear() {
    this.steps = [];
    if (this._uiEl) this._updateUiCount();
  }

  _pushStep(step) {
    this.steps.push(step);
    this.opts.onStep?.(step);
    if (this._uiEl) this._updateUiCount();
  }

  _isFormField(el) {
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }

  /**
   * True for elements that shouldn't be recorded at all — the recorder's
   * own floating UI, or anything you've marked with a data-ppr-ignore
   * attribute (put it on your own Start/Stop/Replay controls if you build a
   * custom UI instead of using the built-in one, so pressing Stop doesn't
   * get recorded as a click step in the middle of your session).
   */
  _isIgnored(el) {
    if (this._uiEl && this._uiEl.contains(el)) return true;
    return !!el.closest?.('[data-ppr-ignore]');
  }

  /** Record a rolling window of recent DOM mutations, used to detect a
   * custom dropdown/menu opening for chooseOption merging (see _onClick). */
  _onMutations(mutations) {
    const now = performance.now();
    for (const m of mutations) {
      this._recentMutations.push({ target: m.target, time: now });
      if (m.addedNodes) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) this._recentMutations.push({ target: node, time: now });
        }
      }
    }
    const cutoff = now - this.opts.chooseOptionMergeWindow;
    while (this._recentMutations.length && this._recentMutations[0].time < cutoff) {
      this._recentMutations.shift();
    }
  }

  /** Was `el` (or one of its ancestors/descendants) touched by a DOM
   * mutation between `sinceTime` and `untilTime`? Used as the "a menu
   * probably just opened here" signal for chooseOption merging. */
  _wasRevealedSince(el, sinceTime, untilTime) {
    for (const { target, time } of this._recentMutations) {
      if (time < sinceTime || time > untilTime) continue;
      if (target === el) return true;
      if (target.contains?.(el)) return true;
      if (el.contains?.(target)) return true;
    }
    return false;
  }

  /**
   * Safety net: flush the typing buffer if the element it's tracking no
   * longer has focus, regardless of whether we ever saw a 'focusout' event
   * for it. focusin/focusout are the primary mechanism, but relying on them
   * exclusively turned out to be fragile in practice — real-world focus
   * transitions (e.g. clicking to open a native <select>) don't always fire
   * them in a way this recorder could observe reliably, silently losing
   * whatever was typed. Checking document.activeElement directly, on every
   * subsequent click/change/keydown, catches that regardless of the cause.
   */
  _flushIfBlurred() {
    if (this._typingBuffer && document.activeElement !== this._typingBuffer.el) {
      this._flushTyping();
    }
  }

  _onClick(e) {
    if (!this.recording) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (this._isIgnored(el)) return; // don't record clicks on the recorder's own controls
    this._flushIfBlurred();

    // Checkboxes/radios are recorded as check() via the 'change' handler
    // instead — a raw click() would be semantically weaker (loses the
    // explicit "set to this state" intent that check() carries), so skip
    // recording a click here to avoid a duplicate/conflicting step.
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) return;
    if (el.tagName === 'SELECT') return; // handled by 'change'

    // A plain click on a text field/textarea is just focusing it to type —
    // that's already implicit in the upcoming 'type' step (page-pilot's
    // type() focuses the element itself), so recording it separately would
    // just be noise (and a redundant click() during replay).
    if (this._isFormField(el)) return;

    const now = performance.now();
    this._flushTyping();
    if (this.opts.mergeChooseOption && this._tryMergeChooseOption(el, now)) {
      this._pendingTrigger = null;
      return;
    }

    const { selector, fragile } = generateSelector(el);
    const step = { type: 'click', target: selector };
    if (fragile) step.fragile = true;
    this._pushStep(step);

    // Remember this click as a possible chooseOption trigger — if the very
    // next recorded step turns out to be a click on something that appeared
    // shortly after this one, the two get merged (see _tryMergeChooseOption).
    this._pendingTrigger = { el, selector, fragile, time: now, step };
  }

  /**
   * If there's a pending trigger click, and this new click lands on
   * something that was revealed by a DOM mutation shortly after that
   * trigger — with nothing else recorded in between — merge both clicks
   * into a single chooseOption step instead of two separate click steps.
   * Returns true if it merged (caller should skip normal click recording).
   */
  _tryMergeChooseOption(el, now) {
    const pending = this._pendingTrigger;
    if (!pending) return false;
    // Nothing else may have been recorded between the trigger click and now.
    if (this.steps[this.steps.length - 1] !== pending.step) return false;
    if (now - pending.time > this.opts.chooseOptionMergeWindow) return false;
    if (pending.el === el || pending.el.contains(el)) return false;
    if (!this._wasRevealedSince(el, pending.time, now)) return false;

    const { selector: optionSelector, fragile: optionFragile } = generateSelector(el);
    const mergedStep = {
      type: 'chooseOption',
      target: pending.selector,
      option: optionSelector,
    };
    const waitAfterOpen = Math.round((now - pending.time) / 50) * 50;
    if (waitAfterOpen > 0) mergedStep.options = { waitAfterOpen };
    if (pending.fragile || optionFragile) mergedStep.fragile = true;

    const idx = this.steps.indexOf(pending.step);
    if (idx !== -1) this.steps.splice(idx, 1, mergedStep);
    else this.steps.push(mergedStep);

    this.opts.onStep?.(mergedStep);
    if (this._uiEl) this._updateUiCount();
    return true;
  }

  _onChange(e) {
    if (!this.recording) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (this._isIgnored(el)) return;
    this._flushIfBlurred();

    if (el.tagName === 'SELECT') {
      const { selector, fragile } = generateSelector(el);
      const value = el.multiple
        ? Array.from(el.selectedOptions).map((o) => o.value)
        : el.value;
      const step = { type: 'select', target: selector, value };
      if (fragile) step.fragile = true;
      this._pushStep(step);
      return;
    }

    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      const { selector, fragile } = generateSelector(el);
      const step = { type: 'check', target: selector, checked: el.checked };
      if (fragile) step.fragile = true;
      this._pushStep(step);
    }
  }

  _onFocusIn(e) {
    if (!this.recording) return;
    const el = e.target;
    if (!(el instanceof Element) || !this._isFormField(el)) return;
    this._beginTypingBuffer(el);
  }

  /** Establish a fresh typing buffer for a form field, flushing any prior one first. */
  _beginTypingBuffer(el) {
    this._flushTyping();
    const { selector, fragile } = generateSelector(el);
    this._typingBuffer = {
      el,
      selector,
      fragile,
      startValue: el.isContentEditable ? el.textContent : el.value,
    };
  }

  _onFocusOut(e) {
    if (!this.recording) return;
    if (this._typingBuffer && this._typingBuffer.el === e.target) this._flushTyping();
  }

  _flushTyping() {
    const buf = this._typingBuffer;
    this._typingBuffer = null;
    if (!buf) return;
    const currentValue = buf.el.isContentEditable ? buf.el.textContent : buf.el.value;
    if (currentValue === buf.startValue || currentValue === '') return; // nothing typed, skip
    const step = { type: 'type', target: buf.selector, text: currentValue };
    if (buf.fragile) step.fragile = true;
    this._pushStep(step);
  }

  _onKeyDown(e) {
    if (!this.recording) return;
    const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
    // Plain character keys (no modifier) flow into the typing buffer instead;
    // anything in NON_CHARACTER_KEYS, or any key combined with a modifier
    // (Ctrl+A, Cmd+S, etc. — these are shortcuts, not text being typed), gets
    // recorded as its own pressKey step.
    if (!NON_CHARACTER_KEYS.has(e.key) && !hasModifier) return;

    const el = e.target;
    this._flushTyping(); // whatever was typed before this key counts as its own step first

    const modifiers = {};
    if (e.ctrlKey) modifiers.ctrl = true;
    if (e.shiftKey) modifiers.shift = true;
    if (e.altKey) modifiers.alt = true;
    if (e.metaKey) modifiers.meta = true;

    let target = null;
    let fragile = false;
    if (el instanceof Element && el !== document.body) {
      ({ selector: target, fragile } = generateSelector(el));
    }

    const step = { type: 'pressKey', target, key: e.key };
    if (Object.keys(modifiers).length) step.options = { modifiers };
    if (fragile) step.fragile = true;
    this._pushStep(step);
  }

  _onScroll(e) {
    if (!this.recording) return;
    const target = e.target === document ? window : e.target;
    if (!this._scrollStartTop.has(target)) {
      this._scrollStartTop.set(target, target === window ? window.scrollY : target.scrollTop);
    }
    clearTimeout(this._scrollTimers.get(target));
    this._scrollTimers.set(target, setTimeout(() => this._flushScroll(target), this.opts.scrollSettleDelay));
  }

  _flushScroll(target) {
    const startTop = this._scrollStartTop.get(target) ?? 0;
    this._scrollStartTop.delete(target);
    this._scrollTimers.delete(target);

    const isWindow = target === window;
    const scrollTop = isWindow ? window.scrollY : target.scrollTop;
    const scrollHeight = isWindow
      ? (document.scrollingElement || document.documentElement).scrollHeight
      : target.scrollHeight;
    const clientHeight = isWindow ? window.innerHeight : target.clientHeight;

    let options;
    if (scrollTop <= 1) options = { to: 'top' };
    else if (scrollTop >= scrollHeight - clientHeight - 1) options = { to: 'bottom' };
    else options = { amount: scrollTop - startTop };

    const step = { type: 'scroll', target: null, options };
    if (!isWindow) {
      const { selector, fragile } = generateSelector(target);
      step.target = selector;
      if (fragile) step.fragile = true;
    }
    this._pushStep(step);
  }

  // --- minimal floating UI -------------------------------------------------

  _showUi() {
    if (this._uiEl) { this._setUiRecordingState(true); return; }
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      background: #111; color: #fff; font: 13px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 10px 12px; border-radius: 10px; display: flex; align-items: center; gap: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    `;
    el.innerHTML = `
      <span id="ppr-dot" style="width:8px;height:8px;border-radius:50%;background:#ef4444;"></span>
      <span id="ppr-count">0 steps</span>
      <button id="ppr-stop" style="margin-left:6px; padding:3px 8px; border-radius:6px; border:none; cursor:pointer;">Stop</button>
      <button id="ppr-copy" style="padding:3px 8px; border-radius:6px; border:none; cursor:pointer;" disabled>Copy</button>
    `;
    document.body.appendChild(el);
    this._uiEl = el;
    el.querySelector('#ppr-stop').addEventListener('click', () => {
      this.stop();
      el.querySelector('#ppr-copy').disabled = false;
    });
    el.querySelector('#ppr-copy').addEventListener('click', () => {
      const json = JSON.stringify(this.steps, null, 2);
      navigator.clipboard?.writeText(json).catch(() => {});
      console.log('[page-pilot-recorder] steps:\n' + json);
    });
  }

  _setUiRecordingState(isRecording) {
    const dot = this._uiEl.querySelector('#ppr-dot');
    if (dot) dot.style.background = isRecording ? '#ef4444' : '#6b7280';
  }

  _updateUiCount() {
    const count = this._uiEl?.querySelector('#ppr-count');
    if (count) count.textContent = `${this.steps.length} step${this.steps.length === 1 ? '' : 's'}`;
  }

  /** Remove the floating UI, if shown. Does not stop recording. */
  destroyUi() {
    this._uiEl?.remove();
    this._uiEl = null;
  }
}
