# Press feedback

The highest-frequency animation in any interface, so it gets the least time.

## Numbers

| | Value | Source |
|---|---|---|
| Duration | **100-160ms** | research/03, by-interaction table |
| Transform | `scale(0.97)` | same |
| Easing | `ease-out` | Kowalski: never `ease-in` on UI |
| Hover/colour | 50-150ms | research/03 |

```css
.btn {
  transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1),
              background-color 100ms ease;
}
.btn:active { transform: scale(0.97); }

@media (hover: hover) and (pointer: fine) {
  .btn:hover { background-color: var(--accent-hover); }
}

@media (prefers-reduced-motion: reduce) {
  .btn { transition-duration: 1ms; }
  .btn:active { transform: none; }
}
```

## Asymmetry is the craft

**Press and release must not share a duration.** Kowalski's shipped
press-and-hold: press is `clip-path 2s linear`, release is
`clip-path 200ms ease-out`. A symmetric hold-to-confirm is a defect, because
the press is a commitment the user is making slowly and the release is an
abort they want acknowledged instantly.

## Refuse

- Any press animation over 200ms. At this frequency it becomes latency.
- `ease-in` on the press. It delays the frame the finger is waiting for.
- A hover animation not gated behind `@media (hover: hover)`. Touch fires a
  false hover on every tap, so the button flashes its hover state on press.
- Animating `width`, `height`, `top` or `left`. Transform and opacity only.
