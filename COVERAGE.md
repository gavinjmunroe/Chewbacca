# Coverage

**What has actually been researched, and what has not.** This file exists
because on 2026-09-20 four web-research passes got presented as if they were a
finished education, and Caleb called it: *"did you fr research the entire
internet and research papers and repos."* The answer was no.

Status is honest. `done` means primary sources were read and the findings are
in `research/` with citations. `partial` means real work exists with a named
gap. `none` means nothing.

**The method bar, set by what actually worked.** The motion pass read the
shipped source of Vaul and Sonner and found the published docs were wrong. The
award pass fetched 33 sites and grepped 131 bundles and found Framer Motion on
zero of them. **Reading source and counting things beat reading articles, every
time.** Any domain below marked `done` off blog posts alone should be treated
as `partial`.

## Wave 1, 2026-09-20 (complete)

| # | Domain | Status | Method | File |
|---|---|---|---|---|
| 01 | Award corpus, Awwwards / FWA / CSSDA / Webby | done | 33 sites fetched, 131 JS + 65 CSS grepped, rubrics from source | [research/01](research/01-award-corpus.md) |
| 02 | Product-UX canon, Linear / Stripe / Superhuman / Figma | done | company engineering writing, one reverse-engineering repo | [research/02](research/02-product-ux-canon.md) |
| 03 | Motion and interaction craft | done | spec token files + shipped library source | [research/03](research/03-motion-craft.md) |
| 04 | Constraint systems and the generated-UI tells | done | published design systems, lint configs | [research/04](research/04-constraints-and-tells.md) |

## Wave 2, launched 2026-09-20 (in flight)

| # | Domain | Why it matters |
|---|---|---|
| 05 | **Academic HCI foundations** | Fitts, Hick-Hyman, GOMS/KLM, Steering, Miller. Wave 1 cited these **secondhand through blog posts**. No paper was read. |
| 06 | **Forms, inputs, validation, checkout** | Almost certainly higher ROI than everything in wave 1. Untouched. |
| 07 | ~~Accessibility~~ **done** | 57 primary-source fetches. [research/07](research/07-accessibility.md) |
| 08 | **Component library source** | Radix, Base UI, React Aria, Zag, Floating UI. The hard primitives: focus trap, scroll lock, positioning, roving tabindex. |
| 09 | **Data visualization and dashboards** | Cleveland & McGill, chart selection, colour in viz, tables. Nothing. |
| 10 | **Design tokens and theming** | The DTCG spec, three-tier architecture, colour-scale generation, Tailwind v4. Nothing. |

## Wave 3, taste, launched 2026-09-20 (in flight)

| # | Domain | Why |
|---|---|---|
| 11 | **The theory of taste** | Hume, Kant, Bourdieu, Rams, Vignelli, Paul Graham. What taste *is*, including the strongest case that it is class signalling |
| 12 | **Empirical aesthetics** | Processing fluency, MAYA/prototypicality, Reinecke's complexity model, the aesthetic-usability effect, golden-ratio debunking |
| 13 | **AI slop across every medium** | The *mechanism*: mode collapse, RLHF diversity loss, model collapse. And the escape |
| 14 | **How taste is developed** | Deliberate practice, critique culture, constraints, and the Nature 2021 subtraction-neglect result |
| 15 | **Prior art on engineering taste** | Adversarial: has this been built already? Gates the claim in [THESIS.md](THESIS.md) |

## Not yet started

| Domain | Note |
|---|---|
| Information architecture, navigation, search UX | Card sorting, nav patterns, faceted search, zero-results |
| Mobile and touch | iOS HIG and Material in depth, gestures, thumb zones, safe areas |
| Performance as UX | Core Web Vitals depth, image formats, font loading, bundle budgets |
| Typography, deeply | Wave 1 got a start. No variable fonts, optical sizing, vertical rhythm, or non-Latin |
| Colour science | OKLCH beyond the basics, gamut mapping, contrast algorithms, palette generation maths |
| Layout and grid systems | Müller-Brockmann, intrinsic design, container queries, subgrid |
| Content design and microcopy | Voice, error wording, button labels, i18n-safe copy |
| Dark patterns and design ethics | A deny list by another name, and now regulated in the EU |
| Onboarding and progressive disclosure | First-run, empty states beyond the basics, feature discovery |
| Tables and enterprise data UI | Virtualization, selection, bulk actions, filtering |
| 3D, WebGL and shader craft | Codrops teardowns, Three.js patterns, render-loop architecture |
| Email and print | Different rendering engines, different rules entirely |
| Internationalization | RTL, text expansion, CJK line breaking, locale formatting |
| Design engineering practice | How systems get built, versioned, adopted and abandoned |
| Games and realtime interfaces | Input latency, HUD design, feedback loops |

## The rule

**Nothing gets generated from a domain marked `none`.** `craft-gate` already
enforces this shape for whole genres. The point of this file is that "I know
web design" is not one genre, and the parts nobody studied should not be
bluffed.
