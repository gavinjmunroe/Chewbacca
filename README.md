# ux-engine

A UI generator's reference library: 74 real design systems indexed by what they
**refuse** to do, the numeric constants of good interface behaviour, and a
linter that fails a page carrying the generated look.

Built 2026-09-20 from four deep-research passes. Every number traces to a
source in [`research/`](research/), and figures that circulate without a
primary source are **absent rather than guessed**.

## The problem it solves

From Caleb's own spec on 2026-09-20:

> Right now it's laggy because it's needed to every time recalibrate how to
> make something. So if we preload instructions and operations and like MD
> files that have exactly how to make this, how to make that.

The cost is not rendering. It is the model re-deriving the method on every
request, then falling back on a house style that produces the same page every
time. The corpus of real systems is **40,446 lines**, which no agent reads
before picking a direction, so it invents one instead.

So this caches the method, not the pixels.

## The thesis

**The generated look is not bad taste. It is an empty deny list.**

Every recognizable system is recognizable because of a short list of things it
will not do, and in the strongest cases that list is executable: Shopify
Polaris bans hex and all 25 length units in stylelint, Atlassian bans
`<button>` and `placeholder` in ESLint, GOV.UK bans pasted hex in Sass.

Bugatti has no accent colour, no radius between 0 and a pill, and no display
weight above 400. Three refusals, and they are most of what makes a page read
as Bugatti instead of as every other generated page.

A library that only says what to use reproduces the median. The forbidding is
the signal, so the index is built on it.

## Use it

```
ux-pick "austere luxury dark"     pick a system from a brief, with its refusals
ux-pick --show bugatti            one system
ux-pick --no-accent --mode dark   filter on constraints
ux-lint src/                      find the generated-UI tells
ux-lint src/ --fix-help           and what to do instead
ux-lint src/ --max 0              exit 1 on any hit, for a hook or CI
```

The intended loop: **pick one system, read only that system, generate, then
lint.** Loading more than one full system produces an average of all of them,
which is the generated look arriving by a different road.

## What is here

| Path | What |
|---|---|
| [`SYSTEMS.md`](SYSTEMS.md) | All 64 machine-readable systems on one page, sorted by how much each refuses. **Start here.** |
| [`data/systems.json`](data/systems.json) | The same, as a signature per system |
| [`data/constants.json`](data/constants.json) | Durations, easings, thresholds, spring configs, budgets |
| [`research/`](research/) | The sourced findings behind all of it |
| [`systems/`](systems/) | The vendored corpus, one `DESIGN.md` per brand |
| [`bin/`](bin/) | `ux-pick`, `ux-lint` |
| [`tools/`](tools/) | The extractor and index renderer. Zero dependencies |
| [`tests/run.sh`](tests/run.sh) | 12 checks, including both directions of the linter |

## The numbers worth memorizing

```
100ms    instantaneous. 50ms of it is yours, the rest is reserved
200ms    INP ceiling at p75
10ms     your budget in a 16.66ms frame
<300ms   anything the user triggers and waits on
400-500ms a large surface crossing a long distance
225/195  Material enter / exit. Exits are faster than entrances
30-80ms  stagger between list items, never more
2s       show no loading indicator at all below this
65ch     prose width. 45 floor, 80 ceiling
1.25x    minimum ratio between type steps
4.5:1    WCAG AA body text. 3:1 large text and UI components
```

And the best single rule found, which is about frequency rather than taste:
an interaction seen **100+ times a day gets no animation at all**. Raycast
ships no open/close animation, and that is correct.

## One measured finding worth the whole repo

33 award-winning sites were fetched and 131 JS bundles grepped.
**Framer Motion appears on 0 of them. React Three Fiber on 0. Spline on 0.**
Lenis is on 18 of 23, more common than GSAP itself, and Nuxt beats Next 10 to 2.

That contradicts `~/.claude/rules/design-system.md`, which mandates Framer
Motion and React. The house rule is fine for product UI, where React really
does dominate, and it is measurably wrong as a description of award-grade work.

The synthesis is better than the stack, though: **the corpus does not say 3D
wins, it says one committed mechanism wins.** Dropbox Brand took CSSDA Website
of the Year, Best UX and a Webby with no WebGL at all, by turning its brand
guidelines into toys. Don't Board Me won Site of the Year Users' Choice on
copywriting and a funny 404.

## Honesty about the sources

`research/` marks `[UNVERIFIED]` on every claim whose trail ran out, and those
marks are load-bearing. Several figures repeated everywhere do not survive
checking: Apple publishes **no** millisecond values anywhere in the HIG, Warp's
"5ms input latency" is contradicted by Warp's own benchmark page, and Amazon's
"100ms costs 1% of sales" traces to a 2006 talk rather than a paper. Every
"Linear design system" token dump circulating online is third-party
reverse-engineering; Stripe's internal system is private.

The extractor had three bugs found the same way, by checking its output against
brands whose colours are known rather than trusting it. It read semantic status
tokens as brand accents, so Bugatti came back gold and Stripe came back as its
own drop-shadow. It ate hex values that had a comment after them. And it
reported the ten prose-only systems as "monochrome, no accent" because there
was nothing to measure, which would have taught the generator that Spotify has
no green. **Absence of data is not a constraint.**

## Credit

The 74 extracted systems under [`systems/`](systems/) are
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md),
MIT, vendored unmodified. This repo adds the index, the constants, the
selector, the linter and the research.

All glory to God! ✝️❤️
