# Stagger

## The one number

**30 to 80ms between items.** research/03: longer feels slow. This is the
single most-violated motion constant, because 100ms reads fine on three items
and is unbearable on twelve.

**Stagger has a length limit.** At 60ms, twelve items means the last one
arrives 660ms after the first, past every ceiling in the book. So cap the
number of staggered items, not the delay:

```
total = (n - 1) * step   must stay under ~400ms
```

Twelve items at 60ms is 660ms and wrong. Either drop to 30ms, or stagger the
first six and bring the rest in together.

```css
.item {
  animation: rise 220ms cubic-bezier(0.23, 1, 0.32, 1) both;
  animation-delay: calc(var(--i) * 45ms);
}
@keyframes rise {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .item { animation-delay: 0ms; animation-duration: 1ms; }
}
```

## Refuse

- Staggering a list the user is waiting to read. Stagger is for arrival, not
  for content they requested.
- Staggering on every re-render or filter change. Once, on first paint.
- A per-item delay that makes the last item land after 400ms.
