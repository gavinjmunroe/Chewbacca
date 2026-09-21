# Reveal on scroll

## The safety constraint comes first

Val Head's vestibular trigger list: parallax, scrolljacking, full-screen wipes,
3D zooms covering large virtual distances, horizontal scroll fighting vertical.
**Safe by contrast, in her words: "animation that involves only non-moving
properties, like opacity, color, and blurs, are unlikely to be problematic."**

**The variable is virtual distance covered, not duration.** She publishes no
pixel threshold, so do not invent one. Keep the travel small: 16 to 32px is a
reveal, 400px is a ride.

## Native, no library

```css
.reveal {
  animation: reveal linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 40%;
}
@keyframes reveal {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .reveal { animation-range: entry 0% entry 1%; }
  @keyframes reveal { from { opacity: 0 } to { opacity: 1 } }
}
```

Reduced motion keeps the fade and drops the travel. That is "reduce, not
delete": the element still announces itself, it just does not move.

## Refuse

- Revealing above-the-fold content. The first screen must be readable at
  paint. An animation that gates the headline is a loading screen.
- Scroll hijacking. research/03 collects the case against it.
- Re-triggering on every scroll past. Reveal once, then leave it alone.
- Travel over ~32px, which crosses from emphasis into movement.
