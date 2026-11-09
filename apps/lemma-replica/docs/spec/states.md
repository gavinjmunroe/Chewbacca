# States: hover, focus-visible, pressed, keyboard

Measured 2026-10-03 on https://www.uselemma.ai/ at 1440x900 with Playwright
(Chromium, python sync API). Every control was hovered with `page.mouse.move`,
focused after a keypress so `:focus-visible` applied (confirmed with
`el.matches(':focus-visible')` on every one), and held with `mouse.down`. The
diff covers the control, every descendant of its nearest Tailwind `group`
ancestor, and their `::before`/`::after`, so group-triggered effects (a card
hover recolouring an icon elsewhere in the card) show up. Properties that
changed between two idle snapshots 300ms apart were discarded as animation
noise. Their CSS was grepped for `group-hover`, `focus-visible` and `active:`
to cross-check, and their carousel source (chunk `1204-*.js`) was read for the
keyboard and auto-scroll behaviour.

The sweep scripts are in the session scratchpad (`states.py`, `summ.py`,
`kb.py`, `shots.py`), not in this repo. Raw results: `states_REF.json`,
`states_OURS2.json`.

## The two focus rings

Theirs has exactly two, and nothing else on the page draws one.

1. **shadcn buttons** (Login, Book a demo, Read the docs, View trust center,
   bottom Book a demo, carousel arrows): `focus-visible:outline-none ring-2
ring-ring ring-offset-2`, computed as
   `box-shadow: 0 0 0 2px rgb(242,242,242), 0 0 0 4px rgb(117,92,254)`.
2. **Everything else** has no focus style of its own and shows the browser
   ring: `outline: auto 1px rgb(0,95,204)`, offset 1px on links, 0 on
   buttons.

Exceptions with their own ring: the newsletter input (`focus:`, so mouse focus
too) gets border `rgb(117,92,254)` plus `0 0 0 2px` of that purple at 30%; Get
Weekly gets `0 0 0 2px` purple at 40%; the cookie card buttons get
`0 0 0 2px rgb(29,25,86)`.

Ours matches the pixels and adds one thing theirs lacks: a 2px transparent
outline under every box-shadow ring, which is what forced-colors mode paints
(that mode drops box-shadow, so theirs shows no focus there at all).

## Per control

Transition notation is `property duration easing`.

| Control                                            | Theirs: hover                                                                                                                                                              | Theirs: focus-visible                                                        | Theirs: pressed | Ours now                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| Brand (header)                                     | nothing changes                                                                                                                                                            | UA ring                                                                      | nothing         | matches (was: turned accent)                                                                    |
| Nav links                                          | colour rgb(108,105,145) to rgb(29,25,86), `color 150ms cubic-bezier(.4,0,.2,1)`; no underline                                                                              | UA ring                                                                      | nothing         | matches (was: also grew an underline, now hidden)                                               |
| Login / ghost buttons                              | bg #e8e8e8 to #e0e0e0                                                                                                                                                      | ring 2px #f2f2f2 + 2px #755cfe                                               | `scale .96`     | matches (was: #dedde6, no press, 2px solid outline)                                             |
| Book a demo (primary)                              | bg stays #1d1956; inner layer `linear-gradient(135deg, #322C8A, #5D4EE7 50%, #1D1956)` opacity 0 to 1, `opacity 300ms cubic-bezier(0,0,.2,1)`                              | ring as ghost                                                                | `scale .96`     | matches via `::before` (was: flat bg swap to #5d4ee7)                                           |
| Button transitions                                 | `color, background-color, box-shadow, scale 150ms cubic-bezier(0,0,.2,1)`                                                                                                  |                                                                              |                 | matches                                                                                         |
| Banner "hiring"                                    | opacity 1 to .8, `150ms cubic-bezier(.4,0,.2,1)`                                                                                                                           | UA ring                                                                      | nothing         | matches                                                                                         |
| Banner dismiss                                     | opacity 1 to .8, same timing; cursor default; 28x28                                                                                                                        | UA ring                                                                      | nothing         | matches; hit area 30x28 (was: rested .85 and brightened)                                        |
| Hero logo wall                                     | lead's file (hero-scene.css)                                                                                                                                               |                                                                              |                 | not touched                                                                                     |
| Hero plate labels                                  | lead's file                                                                                                                                                                |                                                                              |                 | not touched                                                                                     |
| Pinned feature blocks                              | no control exists                                                                                                                                                          | none                                                                         | none            | tab stop per block, UA ring inset 1px; see Keyboard                                             |
| Copy prompt                                        | glyph rgb(161,160,184) to rgb(21,17,80), `color 250ms ease` (+ a 450ms spring on transform for the copied tick)                                                            | UA ring                                                                      | nothing         | colour and timing match; tick spring not built                                                  |
| Integrations glyph links (12, `hover:opacity-100`) | no measurable change at rest state                                                                                                                                         | UA ring                                                                      | nothing         | ours has no links there                                                                         |
| View trust center                                  | ghost button                                                                                                                                                               | ring                                                                         | `scale .96`     | matches                                                                                         |
| Testimonial card (a link)                          | `translate 0 -6px`, border rgb(212,212,221) to primary/20, `translate, border-color 450ms cubic-bezier(.33,0,.15,1)`; X icon primary/25 to /60 `150ms`                     | UA ring                                                                      | nothing         | lift and border match; ours has no X icon; ours is not a link, the viewport is the focus target |
| Carousel arrows                                    | bg #e8e8e8 to #e0e0e0; cursor default                                                                                                                                      | ring                                                                         | `scale .96`     | matches; hit area 44 (drawn 32)                                                                 |
| Carousel dots                                      | **no hover**; active primary, inactive primary/20, `colors 150ms cubic-bezier(.4,0,.2,1)`; 6x6, cursor default                                                             | UA ring                                                                      | nothing         | matches (was: dot darkened on hover); hit area 14x44                                            |
| Newsletter title, Read the latest, View all        | colour to rgb(117,92,254) `150ms cubic-bezier(.4,0,.2,1)`; underline span `clip-path inset(0 100% 0 0)` to `inset(0)` `300ms cubic-bezier(0,0,.2,1)`, at `-bottom-px h-px` | UA ring                                                                      | nothing         | matches with scaleX from the left; underline moved up 1px (was 150ms on the colour curve)       |
| Newsletter input                                   | **no hover**                                                                                                                                                               | border rgb(117,92,254), ring 2px purple/30, outline none; on mouse focus too | as focus        | matches (was: hover border, 2px solid outline)                                                  |
| Get Weekly                                         | opacity 1 to .9 `150ms cubic-bezier(.4,0,.2,1)`; cursor default                                                                                                            | ring 2px purple/40                                                           | nothing         | matches                                                                                         |
| Footer links                                       | as newsletter links                                                                                                                                                        | UA ring                                                                      | nothing         | matches                                                                                         |
| Cookie settings                                    | as newsletter links; cursor default                                                                                                                                        | UA ring                                                                      | nothing         | matches                                                                                         |
| Cookie card Reject / Customize                     | bg to primary/10, edge disappears; **bg not transitioned**, only `opacity, transform 80ms cubic-bezier(.4,0,.2,1)`                                                         | ring 2px #1d1956                                                             | `scale .97`     | matches                                                                                         |
| Cookie card Accept                                 | bg #1d1956 to #322c8a, same timing                                                                                                                                         | ring 2px #1d1956                                                             | `scale .97`     | matches                                                                                         |

Cursor: their `<button>`s keep the default cursor (Tailwind v4 preflight); links
are pointer. Ours follows that on the arrows, dots, dismiss, Get Weekly and
Cookie settings.

## Keyboard

### Testimonial carousel

Theirs (Embla, chunk 1204): `onKeyDownCapture` on the carousel region,
`ArrowLeft` scrollPrev, `ArrowRight` scrollNext, `preventDefault`. The region
holds the slides and both arrows, so the keys work with focus on a card or an
arrow; the dots sit outside it and ignore them. Each card is a link and a tab
stop; then previous, next, then 11 dots, each its own tab stop, the active
one carrying `aria-current`.

Ours: the region is `.tst-stage` (viewport plus arrows) with
`role=region aria-roledescription=carousel`; ArrowLeft/ArrowRight step it with
focus on the viewport or either arrow. Tab order is viewport, previous, next,
then the 12 dots, matching theirs (arrows moved after the viewport in the DOM;
they are absolutely placed, so the layout did not move, verified 0 rect
changes across every control). Dots are a `role=group` of buttons with
`aria-current` on the active one. The previous `role=tablist` was invalid with
no tabs or panels. The viewport is `aria-live=polite`; partially visible cards
stay `aria-hidden`.

**Not built, and the biggest remaining difference:** theirs auto-scrolls
continuously, Embla AutoScroll at `speed: .4`, measured at one 389px step per
14.8 to 15.5s (about 25px/s). It stops on pointer enter and on focus inside
(`onPointerEnter`/`onFocusCapture` call `stop()`), resumes on leave/blur with
`play(0)`, and adds `transition-transform 450ms ease-out` to the track for
450ms so the stop and restart ease. Under `prefers-reduced-motion` it is not
installed and `loop` is off. Ours steps on input only. This is motion, not a
state, and it moves card geometry continuously, which measure2 would read as
drift, so it was left for the motion wave.

### Pinned feature panels

Theirs: no controls. The four text blocks scroll past one sticky panel and a
keyboard user reaches the panels only by scrolling.

Ours (`src/sections/states.js`, mounted on `document.body`): each
`.feat-block` is a tab stop (`role=group`, labelled by its h2). Focusing one
scrolls it to the viewport centre, which is where app.js's nearest-centre test
switches its panel, with the same 500ms crossfade. ArrowDown/PageDown and
ArrowUp/PageUp move to the next and previous block, Home/End to the first and
last. Smooth scroll, or instant under reduced motion. app.js is untouched; the
scroll position stays the single source of truth for which panel is on.

Verified: Tab reaches blocks 0 to 3 with panels 0 to 3 on in turn; keys from
block 0: Down 1, Down 2, Down 3, Down 3, Up 2, Home 0, End 3, PageUp 2. Same at
390 wide.

## Whole-page tab order (ours, with states loaded)

Brand, 5 nav links, Login, Book a demo, hiring, Dismiss, hero Book a demo,
Read the docs, 4 feature blocks, Copy prompt, View trust center, carousel
viewport, previous, next, 12 dots, newsletter title, Read the latest, View all,
email, Get Weekly, Book a demo, footer logo, 9 footer links, Cookie settings,
Reject, Choose, Accept. 53 stops, every one `:focus-visible` with a visible
ring (outline auto or box-shadow), every one scrolled into view on focus.
0 console errors at 1440 and 390, no horizontal overflow at 390.
