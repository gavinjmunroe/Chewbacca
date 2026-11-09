# motion/

`systems/` is the look. `presets/` is the behaviour. **This is the timing.**

Compiled from [research/03](../research/03-motion-craft.md), which read the
shipped source of Material 3, Carbon 11, Atlassian, Vaul and Sonner rather than
their documentation. Every number here traces to a file in one of those, and
the ones that contradict each other say so instead of averaging.

## Why this exists as a layer

Caleb, 2026-09-20, on open-source animation collections: *"we can have those in
the tool bank, and from those make way better ones and cooler ones."*

Copying a whole animation library gives you its identity, which is the same
mistake as copying a design system's palette. A motion **technique** is
different. An easing curve is a chord voicing: reusable craft that carries no
brand with it. So these are techniques with their numbers, not components.

## The two rules that override everything below

**Match motion to frequency.** The more often a user sees an animation, the
shorter and plainer it must be. A once-per-session drawer can take 500ms. A
hover state seen four hundred times cannot take 200ms.

**Reduce, do not delete.** `prefers-reduced-motion: reduce` means the spec's
own words, "removes, reduces, or replaces". Keep opacity and colour, drop
transforms and position changes, shorten rather than setting
`animation: none`, because some pages depend on animation events firing.
Listen for live changes with `matchMedia(...).addEventListener('change')`;
reading it once at boot is a bug.

## The conflict you have to resolve yourself

Material, Coyier and Atlassian say accelerate on exit (`ease-in`).
**Emil Kowalski, who wrote Sonner and Vaul, says never use `ease-in` on UI at
all**: it starts slow and delays the exact moment the user is watching.

These files follow Kowalski, because his position is backed by two shipped
libraries. If a project's DENY.md says otherwise, the project wins.

## Ceilings

Under **300ms** for anything the user triggers and then waits on. **400 to
500ms** for a large surface moving a long distance. Material's hard ceiling is
400ms; Vaul's own drawer ships at 500ms, which is why the rule is two-part.

## Editor-grade motion

Text animators, shape morphs, whips, the triple wheel, camera hand-offs and
parallax lag, from an editor's timeline and FilmCraft's source:
[library/crafts/motion-film.md](../../../library/crafts/motion-film.md). The
code is [primitives/motion.ts](primitives/motion.ts), dependency-free, tested
by `node primitives/motion.test.ts`.
