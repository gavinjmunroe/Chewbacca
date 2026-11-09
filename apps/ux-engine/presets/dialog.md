# Dialog / modal

Compiled from research/08 (Radix, React Aria, Headless UI, Vaul source) and
research/07 (ARIA APG, WCAG).

## Focus, the four rules

1. **Move focus in on open.** First focusable element; the title for long
   content; **the least destructive option for a destructive dialog.**
2. **Trap Tab**, wrapping first to last and last to first.
3. **`Esc` closes**, registered on the document with `capture: true`, and
   **only the highest layer registers.**
4. **Return focus to the trigger on close**, with `{ preventScroll: true }`.

## The three guards a real focus trap needs

Radix runs `focusin`, `focusout`, **and a MutationObserver.** The observer
exists because **when the focused element is deleted the browser resets focus
to `document.body`**, and no focus event reports that.

**`focusout` must return early when `relatedTarget === null`.** That fires both
on tab-switch and, in Chrome, when the focused element is removed. The source
comment says refocusing the deleted element *"throws the CPU to 100%."*

**Strip links from the initial auto-focus candidates.** Tabbable, but a bad
first target.

**Ignore positive `tabindex` ordering**, verbatim from the source: *"we do not
take into account the order of nodes with positive tabIndex as it hinders
accessibility to have tab order different from visual order."*

## aria-modal is not what shipped libraries use

Radix, in a comment: *"aria-hide everything except the content (**better
supported equivalent to setting aria-modal**)."*

Refcount the hiding with a `WeakMap` so nested overlays do not un-hide each
other, and **skip `[data-live-announcer]`** so toasts stay announceable inside
a modal.

**The `role="row"` exception:** VoiceOver on iOS cannot hide a `role="row"`
(WebKit 222623), so you must hide its cells instead.

## Scroll locking

Compensate the scrollbar with
`window.innerWidth - document.documentElement.clientWidth`.

**Prefer `scrollbar-gutter: stable` over `padding-right`**, because padding
does not fix fixed-position elements.

Three exemptions every implementation needs, discovered independently by three
libraries:

- **`<input type="range">`**, or sliders inside modals die.
- **An active text selection**, or iOS drag-select handles break.
- **Two touches**, for pinch zoom.

**As of iOS 26 the `overscroll-behavior` rule must exist before `touchstart`**,
so it goes in a `<style>` prepended to `<head>`, not inline. And size-check
before preventing: **WebKit 243452 means `overscroll-behavior` silently fails
when the element does not actually overflow.**

## Click-outside is harder than it looks

**Defer registration with a `setTimeout`**, or a dialog opened from a
`pointerdown` handler immediately sees its own event bubble to document.

**Do not dismiss on `pointerdown` for left-click.** Wait for `click`, for two
reasons: the **~350ms delay** browsers impose on touch, and the fact that
**browser extensions call `stopPropagation` on mouse events.** Waiting also
cancels for free on drag-scroll and long-press.

**Filter macOS ctrl+left-click.** It is a right-click.

## Motion

Enter 225ms, exit 195ms. **Exits are faster than entrances**: leaving should
not cost the user time.

**Never `scale(0)`.** Start at `scale(0.95)` with `opacity: 0`. **Modals are
the exception to transform-origin**: they keep `center`, while popovers and
dropdowns scale from their trigger.

Vaul's shipped drawer, for a large surface: **500ms** with
`cubic-bezier(0.32, 0.72, 0, 1)`, and **not draggable for 500ms after opening**
or the open animation reads as a drag.

On iOS, `position: fixed` can itself cause Safari's bottom bar to appear, so
re-measure **300ms later** inside a `requestAnimationFrame`.

## States

Loading (the dialog opened before its data), empty, error, and **destructive
confirm**.

**On the confirm: Norman's finding is that a routine confirmation stops
protecting anything.** *"if confirmation is routinely asked for, the
confirmation itself becomes an automatically invoked component of the command
sequence."* Make a destructive action **reversible** instead, or require typing
the object's name. Do not ship a yes/no dialog and call it safety.

## The failure mode

**A dialog that traps focus correctly and strands it on close**, because the
trigger unmounted. Check the trigger still exists before restoring, and fall
back to a container with `tabindex="-1"`.
