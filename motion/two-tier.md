# Two tiers, split by frequency

Measured from uselemma.ai, 2026-09-20, by reading the shipped bundle rather
than the marketing. It is the cleanest real example of the frequency rule in
[research/03](../research/03-motion-craft.md) that this repo has found.

## What they actually ship

| | Duration | Easing | Applied to | Count |
|---|---|---|---|---|
| Small, constant, short travel | **220ms** | plain `ease-out` | SVG `cx`/`cy` on trace nodes | 1,684 |
| Large, occasional, long travel | **450ms** | `cubic-bezier(0.33, 0, 0.15, 1)` | `translate` + `border-color` on cards | 22 |

**No animation library.** No Framer Motion, no GSAP, no Lenis. Hand-written CSS
transitions plus 4 `requestAnimationFrame` calls and 22 `will-change`.

## The rule this demonstrates

Duration scales with how RARELY the element is seen and how FAR it travels.
Not with how important it is, which is the usual wrong instinct.

A node that jitters continuously in a diagram gets 220ms and the plainest
curve available, because at that frequency an expressive curve becomes a tic.
A card the user hovers a handful of times gets 450ms and the brand curve,
because it has the budget to be expressive.

**450ms is over Kowalski's 300ms ceiling on purpose.** It sits in the
documented exception: 400 to 500ms for a large surface moving a long distance,
the same band as Vaul's shipped 500ms drawer.

## The curve

```css
--ease-signature: cubic-bezier(0.33, 0, 0.15, 1);
```

Note `x2 = 0.15` is LEFT of `x1 = 0.33`. That inversion is what gives it the
hard S: slow entry, fast middle, soft landing. It appears in none of the system
tables in research/03 (Material 3, Carbon 11, Atlassian, Vaul), so it is a
house curve rather than a borrowed one. Worth studying; not worth copying,
since a borrowed signature curve is somebody else's signature.

## What they animate, and nothing else

`translate`, `border-color`, `opacity`, and SVG coordinate attributes. No
`width`, no `height`, no `top`/`left`, no `margin`. Entirely compositor-safe.

## Refuse

- A single duration for everything. One token across a whole site means either
  the frequent motion is too slow or the rare motion is too fast.
- An expressive curve on high-frequency motion. At 400 repetitions a
  personality curve reads as a malfunction.
- Animating any layout property. They animate none.

## The defect in it

**Zero `prefers-reduced-motion` anywhere on the site**, with 1,684 animated
elements. Continuous small-element motion is exactly the vestibular case
research/03 flags. Two tiers of craft and no reduce branch, which is the one
thing to do better than this reference.
