# What the source says and the docs do not

Researched 2026-09-20 by reading roughly **110 source files** from Radix, Base
UI, Zag, React Aria, Headless UI, Floating UI, TanStack, cmdk, Vaul, Sonner,
react-remove-scroll, aria-hidden and the shadcn CLI.

**This file is the method bar for the whole repo.** Every other domain was
researched by reading what people wrote about their work. This one read the
work. It found 38 edge cases that appear in no documentation anywhere, and
most of them are comments explaining a browser bug by number.

## The constants

### Timing

| ms | What | Where |
|---|---|---|
| **700** | tooltip open delay | Radix `tooltip.tsx:30` |
| **300** | tooltip skip-delay window | Radix `tooltip.tsx:71` |
| 400 / 150 | tooltip open / close | Zag `tooltip.machine.ts` |
| **1000** | typeahead buffer reset | React Aria, Radix select and menu |
| 750 | typeahead buffer reset | Base UI |
| **350** | typeahead buffer reset | Zag, the clear outlier |
| **100** | submenu open delay | Radix `menu.tsx:1126` |
| **300** | submenu grace-area expiry | Radix `menu.tsx:1158` |
| 5000 / 4000 | toast duration | Radix / Sonner |
| 200 | toast unmount delay | Sonner, Zag |
| **500** | long-press threshold | React Aria `useLongPress.ts:57` |
| **80** | synthetic click after touch | React Aria `usePress` (WebKit min is 32) |
| 150 | `isScrolling` reset, and iOS momentum grace | TanStack Virtual |
| ~350 | the touch click delay browsers impose | cited in Radix DismissableLayer |

### Thresholds

| Value | What |
|---|---|
| 50 px | Radix toast swipe threshold |
| **10 / 2 px** | toast swipe move-start buffer, **touch / mouse** |
| 45 px or 0.11 velocity | Sonner dismiss |
| 40 / **10** / 1 px | Base UI swipe / **reverse-cancel** / min-drag |
| 0.4 / 0.25 | Vaul velocity / close threshold |
| **10x** | slider shift+arrow and PageUp/Down multiplier |
| **50** | Floating UI `MAX_RESET_COUNT` |
| **5 px** | Radix submenu polygon "bleed" |
| 150 / 20 / MAX_SAFE_INTEGER | TanStack column size / min / max |
| **1** | TanStack Virtual default overscan (not 5) |

**Z-index has no shared convention, and that is the finding.** Nobody
hardcodes 9999. Radix *copies the computed z-index off the user's content*
onto its positioning wrapper. Sonner uses `--z-index: toasts.length - index`.
Base UI delegates entirely to consumer CSS.

## Mechanisms worth stealing

### Floating UI is a restartable pipeline, not a chain

Middleware run in array order and **any one can return `reset`, which sets
`i = -1` and re-runs the whole array.** `MAX_RESET_COUNT = 50` exists to break
infinite flip-versus-size loops.

The sign convention, which is the single most useful thing to know:
*positive = overflowing by that many pixels, negative = pixels left before it
overflows, 0 = flush.*

**Order matters and here is why.** `offset` first, because it moves the
coordinates everything else measures. `shift` and `flip` next. **`size` after
flip**, because available space depends on the final side, and it returns
`reset: {rects: true}` when it changes dimensions. `arrow` near the end
because it needs final coordinates, and `flip` has to guard against it:

```js
if (middlewareData.arrow?.alignmentOffset) { return {}; }
```

Without that line flip and arrow fight forever (floating-ui #2549). `hide`
last, because it produces data and never coordinates.

### The submenu safe area is a five-vertex polygon, not a triangle

Radix `menu.tsx:1125-1170`. The cursor point plus the whole content rect, with
a **5-pixel bleed** on clientX "to ensure that our exit point is consistently
within polygon bounds", expiring after **300ms**. All pointer handlers are
wrapped in a `whenMouse` filter, so **touch never gets grace areas at all.**

### Click-outside is much harder than it looks

Radix's `usePointerDownOutside` is the most evolved implementation read.

- **Registration is deferred by `setTimeout`**, or a component mounted from a
  `pointerdown` handler immediately sees its own event bubble to document.
- **Left-click does not dismiss on `pointerdown`.** It stashes the handler and
  waits for `click`, for two stated reasons: the **~350ms touch delay**
  browsers impose, and the fact that **browser extensions call
  `stopPropagation` on mouse events** (radix #2055). Waiting also cancels for
  free on drag-scroll and long-press.
- It listens in **both capture and bubble** for six event types, recording
  `true` in capture and `false` in bubble. Any entry still `true` means
  something stopped propagation, and dismissal is cancelled. That is a genuine
  propagation-interception detector.
- **macOS ctrl+left-click is filtered out** because it is effectively a
  right-click.

### Focus traps need three guards, not one

Radix's `FocusScope` runs `focusin`, `focusout`, **and a MutationObserver**.
The observer exists because **when the focused element is deleted, browsers
reset focus to `document.body`**, which no focus event reports.

`focusout` **returns early when `relatedTarget === null`**, because that
happens both on tab-switch and, in Chrome, when the focused element is
removed. The comment says refocusing the deleted element "throws the CPU to
100%."

**Links are stripped from initial auto-focus candidates.** Tabbable, but a bad
first target.

Positive `tabindex` ordering is deliberately ignored: *"we do not take into
account the order of nodes with positive tabIndex as it hinders accessibility
to have tab order different from visual order."*

### Scroll locking is four different problems

**Scrollbar compensation** is `window.innerWidth - document.documentElement.clientWidth`.
React Aria **prefers `scrollbar-gutter: stable` over `padding-right`, because
padding does not fix fixed-position elements.**

The iOS work in React Aria's `usePreventScroll` is the deepest code in the
survey. It monkey-patches `HTMLElement.prototype.focus` for the lifetime of
the lock so every programmatic focus becomes `{preventScroll: true}`. It
prepends a `<style>` to `<head>` because **as of iOS 26 the
`overscroll-behavior` rule must exist before touchstart.** And it size-checks
before preventing, citing **WebKit 243452: `overscroll-behavior` does not stop
chaining when the element does not actually overflow.**

**Three libraries independently exempt `<input type="range">` from touchmove
blocking**, because sliders inside modals die otherwise. All three also exempt
active text selection, or iOS drag-select handles break.

### aria-modal is not what people use

Radix, verbatim: *"aria-hide everything except the content (**better supported
equivalent to setting aria-modal**)."*

React Aria's version refcounts with a `WeakMap` so nested overlays do not
un-hide each other, **skips `[data-live-announcer]`** so toasts stay
announceable inside a modal, and carries this exception:

> *"An exception is made for elements with `role="row"` since VoiceOver on iOS
> has issues hiding elements with `role="row"`. For that case we want to hide
> the cells inside as well"* (WebKit 222623).

### Toast accessibility, the most quotable line found

Radix `toast.tsx:589`:

```jsx
// Toasts are always role=status to avoid stuttering issues with role=alert in SRs.
role="status"
aria-live={type === 'foreground' ? 'assertive' : 'polite'}
```

**`role="status"` always**, with the urgency carried by `aria-live` alone. And
the announcement text is deferred by a **double `requestAnimationFrame`**,
because NVDA will not announce it otherwise.

### cmdk's fuzzy scorer documents its own constants

```
SCORE_CONTINUE_MATCH      = 1
SCORE_SPACE_WORD_JUMP     = 0.9    // space-separated word starts beat...
SCORE_NON_SPACE_WORD_JUMP = 0.8    // ...slashes, brackets, hyphens
SCORE_CHARACTER_JUMP      = 0.17
SCORE_TRANSPOSITION       = 0.1    // "ouch" beats "curtain" for "uc"
PENALTY_SKIPPED           = 0.999  // "bad" beats "bard" for "bd"
PENALTY_CASE_MISMATCH     = 0.9999 // "HTML" beats "haml" for "HM"
PENALTY_NOT_COMPLETE      = 0.99   // "html" beats "html5" for "html"
```

The decay budgets are stated: `PENALTY_SKIPPED` will not reorder results until
100 characters separate matches, `PENALTY_CASE_MISMATCH` until 1000.

**cmdk sorts by reordering actual DOM nodes**, not by re-rendering a sorted
list.

### Typeahead semantics everyone shares

**Repeated-character normalization:** pressing "aaa" cycles through items
starting with "a" rather than searching for "aaa". **Wrap-around from the
current item**, not from the top. **Space appends to the buffer when a search
is in progress**, which React Aria handles in the *capture* phase specifically
so no bubble handler treats it as a selection.

### Virtual focus, implemented as synthesized real events

React Aria's whole approach is 33 lines:

```js
to.dispatchEvent(new FocusEvent('focus', {relatedTarget: from}));
to.dispatchEvent(new FocusEvent('focusin', {bubbles: true, relatedTarget: from}));
```

**They synthesize real `FocusEvent`s on the virtually-focused option**, so
every hook written against `focus`/`focusin` works unchanged whether focus is
real or virtual.

### Forms: they deliberately do not use aria-errormessage

React Aria `useField.ts`, with the reason in the code:

```js
'aria-describedby': [
  descriptionId,
  // Use aria-describedby for error message because aria-errormessage is unsupported
  // using VoiceOver or NVDA. See adobe/react-spectrum#1346
  errorMessageId,
  props['aria-describedby'],
].filter(Boolean).join(' ') || undefined
```

Both description and error go into `aria-describedby`, joined.

## What makes React Aria different, from the source

Not "more hooks." Four things:

1. **Locale and direction come from context, not the DOM.** Radix reads a
   `dir` attribute and has to manually re-apply it to portalled content.
2. **They ship workarounds for specific cited bugs**, by number: WebKit 243452,
   WebKit 222623, Chromium 40732224, react-spectrum #1346.
3. **Pointer type is first-class**, including `'virtual'` for a screen-reader
   click, which gets its own synchronous branch. `useHover` keeps a global
   flag because *"iOS fires onPointerEnter twice: once with pointerType='touch'
   and again with pointerType='mouse'."*
4. **Virtual focus is real DOM events**, per above.

## Why Zag models components as state machines

A combobox has **four** states where most libraries have one boolean:
`closed.idle`, `closed.focused`, `open.suggesting`, `open.interacting`.
Suggesting (filtered by typing) and interacting (navigating by arrow) respond
differently to the same events, **and that difference is why boolean-flag
comboboxes have bugs.**

What the machine buys, visible in the code: guards compose and are named
(`and("isOpenControlled", "isCustomValue", not("hasHighlightedItem"))`);
**controlled mode is modelled as events rather than a `useEffect`**; timers are
declarative effects that cancel when the state exits; and a state can be its
own cleanup, as when the tooltip transitions `open -> closing -> open` purely
to tear down and rebuild its positioning effect.

## What shadcn/ui actually is

**A code generator with a typed distribution format, not a component library.**

The real mechanism is `transform-import.ts`, which uses **ts-morph** to rewrite
import specifiers at the AST level, mapping `@/registry/<style>/ui/*` onto the
consumer's configured aliases. Plus a JSON manifest with transitive
`registryDependencies`, and a Tailwind/CSS-var merger.

**Why the model spread, read from the code rather than the marketing:** the
hard accessibility work is still a dependency (Radix), so copy-paste only owns
the layer that genuinely varies per project, which is styling and composition.
**Copying a focus trap would be insane. Copying a `className` is free.** And
because the output is a plain file, there is no upgrade and no version skew: a
design change is a normal diff in a normal PR.

## The 38 edge cases that exist in no documentation

1. `focusout` with `relatedTarget === null` must be ignored, or the CPU pegs.
2. Links are stripped from initial auto-focus candidates.
3. Deleting the focused element resets focus to `body`, which only a
   MutationObserver catches.
4. Focus restore on unmount needs `setTimeout(0)` (React #17894).
5. Prefer `scrollbar-gutter: stable` over `padding-right`; padding does not fix
   fixed-position elements.
6. `overscroll-behavior: contain` silently fails when the element does not
   overflow (WebKit 243452).
7. **As of iOS 26 that style must exist before touchstart**, so it goes in a
   `<style>` in `<head>`, not inline.
8. React Aria monkey-patches `HTMLElement.prototype.focus` for the lock's
   lifetime.
9. **`<input type="range">` must be exempt from every touchmove block**, or
   sliders in modals die. Found independently in three libraries.
10. Active text selection must be exempt too, or iOS drag-select breaks.
11. `scroll-behavior: smooth` corrupts scroll save/restore; force `auto` in a
    microtask.
12. In-dialog `<a href="#id">` must be captured and replayed after close,
    because the browser will not scroll to an anchor while a dialog is open.
13. macOS ctrl+left-click is a right-click.
14. Browser extensions `stopPropagation` on mouse events; detect by comparing
    capture against bubble.
15. Body `pointer-events: none` must clean up when the prop flips, not only on
    unmount, or exit animations leave the page dead.
16. `useEffectEvent` returns stale closures inside `forwardRef` on React
    19.2.x.
17. **Submenu key events bubble through portals** in React's synthetic system;
    scope with `closest()`.
18. VoiceOver's virtual cursor only fires focus on `role="button"` elements via
    WebKit, so focus guards need that role on VoiceOver+WebKit specifically.
19. VoiceOver iOS cannot `aria-hidden` a `role="row"`; hide its cells instead.
20. VoiceOver mis-announces `aria-activedescendant`, so React Aria announces
    focus, count and selection manually through a live region.
21. **VoiceOver iOS fires two `touchend`s in quick succession**; ignore the
    second.
22. A VoiceOver click on iPad lands at the exact geometric centre of the
    element, which is usable as a virtual-click heuristic.
23. `role="alert"` stutters in screen readers; use `role="status"` plus
    `aria-live`.
24. **NVDA will not announce a toast unless its text renders a frame later.**
25. Toast remaining-time must reset when `duration` changes, or a loading toast
    keeps `Infinity` forever.
26. **Writing `scrollTop` during iOS momentum scrolling kills the momentum**;
    defer ~150ms past touchend.
27. `touchcancel` fires instead of `touchend` when the browser takes a gesture;
    without handling it a non-passive listener leaks onto document forever.
28. `offsetHeight` ignores `scale` transforms; `getBoundingClientRect().height`
    does not.
29. `flip` must bail when `arrow` set an `alignmentOffset` or they reset each
    other forever.
30. `size` changing dimensions requires `reset: {rects: true}`, re-running the
    whole array.
31. Portalled content that is a React child but a DOM sibling breaks both focus
    traps and scroll locks.
32. Writing to `document.body` for focus guards forces a synchronous reflow;
    only mutate when the invariant is actually broken.
33. **Numbers below 1e-6 serialize as `1e-7`**, so naive decimal counting breaks
    slider step rounding.
34. Outside-press scrollbar hit-testing must be skipped for touch, because
    scrollbars do not receive touch events.
35. Touch-opened anchored popups should not scroll-lock unless effectively
    full-width, or the user loses swipe-to-dismiss.
36. **Safari's bottom bar can appear as a result of setting `position: fixed`**,
    needing a 300ms delayed re-measure.
37. A drawer must not be draggable for 500ms after opening, or the open
    animation reads as a drag.
38. `<select>` must be excluded from drag targets.

## Could not retrieve

Zag's core machine runtime, Base UI's own `useScrollLock`, React Aria's tooltip
delay constants, and Headless UI's focus-trap wrapper all 404'd.
**[UNVERIFIED]** for those specifically.
