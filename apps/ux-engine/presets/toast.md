# Toast

Compiled from research/08 (Radix, Sonner, Zag, Base UI source) and research/07.

## The accessibility line that matters most

Radix, verbatim from source:

```jsx
// Toasts are always role=status to avoid stuttering issues with role=alert in SRs.
role="status"
aria-live={type === 'foreground' ? 'assertive' : 'polite'}
```

**`role="status"` always.** Urgency is carried by `aria-live` alone.

**And NVDA will not announce it unless the text renders a frame later.** Radix
uses a **double `requestAnimationFrame`** for exactly this.

The live region container **must exist in the DOM before the text is
inserted.** Injecting the container and its content together announces nothing.

## Constants, from shipped source

| | Radix | Sonner |
|---|---|---|
| Duration | 5000ms | **4000ms** |
| Swipe threshold | 50px | **45px or velocity > 0.11 px/ms** |
| Move-start buffer | **10px touch / 2px mouse** | axis locked after 1px |
| Unmount delay | | 200ms, equal to the exit animation |
| Visible at once | | **3** |
| Width / gap | | 356px / 14px |

**Dismiss on distance OR velocity. A flick should be enough; never require
distance alone.**

## Pause

Radix pauses via **DOM CustomEvents on the viewport** (`toast.viewportPause` /
`toast.viewportResume`), with each toast tracking its own remaining time.

Sonner adds one Radix does not: **pause when the document is hidden.**

**Reset remaining time when `duration` changes**, or a loading toast with
`duration: Infinity` keeps infinite remaining time after being updated to a
finite one.

## Stacking

Compute offset as `heightIndex * gap + heightsBefore`, with heights in a
separate array updated **before** the toast array, because that is what lets
you calculate the new layout in one pass.

Measure with **`offsetHeight`, not `getBoundingClientRect().height`**:
`offsetHeight` ignores the `scale` transform applied to sibling toasts in
overlap mode.

## Motion

Transform 400ms, swipe-out 200ms. Use **CSS transitions, not `@keyframes`**:
transitions retarget mid-flight, keyframes restart from zero, and toasts are
triggered rapidly by definition.

## Never

**Never put a required action only in a toast.** It disappears, it is not
focusable by default, and 4 seconds is not a decision window.

**Never stack more than 3.** Beyond that the earlier ones are gone before they
are read.

**Never use a toast for an error the user must fix.** That is an inline error
next to the field, plus an error summary.

## The failure mode

**A toast that announces perfectly in testing and is silent in NVDA**, because
the text was rendered in the same frame as the container.
