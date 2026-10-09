# What makes a generated interface look generated

Researched 2026-09-20. This one arrived at Caleb's own 2026-09-19 conclusion
without being given it:

> The generated look is not caused by bad taste, it is caused by an **empty
> deny list**. A constraint library that only says what to use will reproduce
> the median. The forbidding is the signal.

## 1. The tells

### It has a named culprit

Adam Wathan, who made Tailwind, took the blame publicly: *"I'd like to formally
apologize for making every button in Tailwind UI `bg-indigo-500` five years
ago, leading to every AI generated UI on earth also being indigo."*
[x.com/adamwathan](https://x.com/adamwathan/status/1953510802159219096)

The mechanism is that models trained on the median of every Tailwind tutorial
on GitHub from 2019 to 2024, and that median is indigo.

### The catalogue

[killaislop.com](https://killaislop.com) enumerates 35 named patterns with
exact values and a replacement for each. The ones with hard values:

**Colour**

| Tell | Value |
|---|---|
| Indigo to violet diagonal gradient on buttons, glows, heroes | `#6366f1` to `#a855f7` |
| Gradient headline text | `background-clip: text` with a rainbow fill |
| Default semantic palette | blue info, amber tip, green success, red error, each `-50` bg plus `-600` text |
| One-hue status box | border, text and background all one hue at different opacities |

**Type**

| Tell |
|---|
| A serif-italic single word swapped into a sans headline |
| Display serif (Playfair, Lora) on a dashboard |
| Uppercase letter-spaced kicker above every section |
| A full marketing sentence at `text-6xl` extrabold tight tracking |
| **Flat hierarchy: every size crammed between 14 and 18px.** Fix: at least 1.25x between steps |
| Space Grotesk display plus Inter body, or Geist / Manrope / Plus Jakarta Sans |

**Copy**

Scattered coloured or bolded keywords mid-paragraph. "Not just X, it's Y."
"Say goodbye to X." Punchy triads. The em-dash habit. Emoji section headers:
rocket for launch, lightning for fast, lock for secure.

**Components**

| Tell | Value |
|---|---|
| Glowing pulsing status dot in a pale halo, saturated green | |
| Rounded card with a thick left border on every list item | `border-l-4 rounded-lg bg-*-50` |
| Rounded-square icon tile with a line icon, tiled into a grid | |
| Max radius plus glassmorphism | `rounded-full` cards, `backdrop-blur bg-white/10` |
| Oversized drop shadow, big blur, low opacity, no offset | opacity is specifically `0.1`. Fix: a 1px contact shadow |
| **Corners that do not nest**: same radius inside and out | Fix: `inner = outer − padding` |
| Border dies at the corner | `rounded-xl overflow-hidden` around a bordered child |
| Badge spam: New, Beta, Popular | |
| Icon in a tint of itself | `bg-{color}/10` behind `text-{color}` |

**Motion**

Springy hover: `hover:scale-105` plus `transition-all` plus bounce easing. Fix:
transition only the changing property, 120 to 200ms, standard ease.

**Layout**

| Tell | Value |
|---|---|
| All-caps card grid, uppercase label plus number, six of them | `grid-cols-3` |
| **Invented stat trio**: `10k+`, `99.9%`, `24/7` with nothing measured behind them | |
| Giant faint `01 / 02 / 03` section ordinals | |
| Cards inside cards | |
| **One gap everywhere** | `gap-4`, `p-4`, `space-y-4` across the whole page. Fix: an uneven intentional scale |

**The section order is itself a tell.** Hero, features grid, social proof,
pricing, FAQ, footer. Not because it is wrong, but because it is the layout in
every shadcn example and Vercel template.

**Microcopy tells:** "Empower your team to unlock productivity." "Built for
modern teams." "Build faster. Ship smarter."

**Two newer tells worth knowing:** Linear's `#5E6AD2` is now itself a copied
tell, and so is the "tasteful terminal" look (mono everywhere, near-black, one
warm accent, ASCII art).

### The enforcement trick worth stealing

The best sources ship **ban lists as code**, not advice:

```
/bg-(indigo|violet|purple)-600/
/rounded-(2xl|3xl)/
/from-purple-\d+ to-(blue|pink)-\d+/
```

Another bans arbitrary values outright: no `text-[#hex]`, no `p-[13px]`, all
colour through semantic variables.

## 2. Real systems and their distinctive constraint

| System | The thing it forbids that others do not |
|---|---|
| **GOV.UK** | **"One thing per page."** One question or decision per form page, research-backed. **You must not paste a hex value**: `#1d70b8` is banned in favour of `govuk-functional-colour("brand")`. The focus yellow `#ffdd00` may **only** indicate focus. A mandated custom typeface, GDS Transport, chosen because it was tested for legibility "in the rain, at night, at speed" and beats Helvetica |
| **Shopify Polaris** | **The strictest machine-enforced set published.** `color-no-hex: true`, `color-named: never`, and `rgb`/`rgba`/`hsl`/`hsla` disallowed. **All 25 length units banned** on padding, margin, gap, border-width, border-radius, box-shadow, font and line-height. `@keyframes` banned outright. `text-shadow` banned outright. `position`, `display`, `flex`, `grid`, `justify-content`, `align-items` all on the property deny list. And: selectors matching `class*='Polaris-'` are banned with the message *"Overriding Polaris styles is disallowed. Please consider contributing instead"* |
| **Atlassian** | **Raw HTML elements are lint errors:** `no-html-button`, `no-html-anchor`, `no-html-heading`, `no-html-input` and eight more. Two UX bans nobody else makes: **`no-placeholder`** ("use a helper message associated to the input instead") and **`no-readonly-or-disabled-inputs`** ("inputs should almost always be interactive"). Plus `no-margin`, disallowing the margin property entirely |
| **Stripe Apps** | *"Custom styling of UI elements is intentionally limited."* Only two components accept a `css` prop. *"Unlike in vanilla CSS, you can't choose arbitrary font faces and styles."* No flexbox or grid: layout is a `stack: x/y/z` primitive. Eight spacing tokens, total. **Brand expression is confined to exactly one element, the app indicator** |
| **IBM Carbon** | A **13-step spacing scale with no escape hatch**: 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 160 |
| **Material 3** | **The tonal palette as a contrast guarantee.** 13 tones per key colour. Roles assigned by tone number, not by eye |
| **Radix Colors** | **12 steps, each with exactly one assigned job**, contrast specified in APCA. Step 9 is "the purest step, mixed with the least amount of white or black." Explicit exception list: most step 9 colours take white text, but Sky, Mint, Lime, Yellow and Amber take dark text |
| **Vercel Geist** | **A step number tells you what it is for, not just how dark it is.** 100-300 component backgrounds, 400-600 borders, 700-800 high-contrast backgrounds, 900-1000 text |
| **Apple HIG** | **Hard per-platform minimum type sizes and a ban on thin weights.** iOS default 17pt / minimum 11pt, macOS 13/10, watchOS 16/12. *"Avoid Ultralight, Thin, and Light."* *"Minimize the number of typefaces you use, even in a highly customized interface"* |
| **Linear** | Does **not** publish an engineering design system. The public brand page mandates monochrome: `#F4F5F8` and `#222326`, with the blue reserved for backgrounds |

**Two caveats carried forward.** M3's "a tone difference of 50 guarantees 4.5:1"
came through a search summary, not a page that could be read directly:
**[PARTIALLY VERIFIED]**. And every "Linear design system" or "Stripe design
system" token dump circulating (Inter Variable at weight 510, Söhne at 300,
`#635bff`, `#0a2540`) is **third-party reverse-engineering, not published
documentation**. Stripe's internal system, Sail, is private. Treat those as
observed, not declared. **[UNVERIFIED]**

## 3. Type

### Modular scales

| Ratio | Name | Where it belongs |
|---|---|---|
| 1.125 | major second | dense text, tight UI |
| 1.2 | minor third | dashboards |
| 1.25 | major third | the safer choice for complex UI |
| 1.333 | perfect fourth | the most widely used on the web |
| 1.5 | perfect fifth | high-contrast editorial |
| 1.618 | golden | creative, oversized headings on small screens |

**Run two scales in one system.** A tighter ratio for UI components, a wider
one for editorial. Landing pages want high heading-to-body contrast, dashboards
want low. Anything under 1.25x between steps reads as flat hierarchy and is
itself a tell.

### The counter-example: GOV.UK uses no ratio at all

Seven hand-tuned steps with a breakpoint at 640px. Body text is **19px, not
16px**, and the scale collapses on mobile rather than scaling uniformly.

### Line length

**Bringhurst**: 45 to 75 characters is satisfactory, **66 is ideal**.

**Baymard, empirical**: product descriptions wider than **80 characters** were
**skipped 41% more often** than those at 60 to 70.
[baymard.com](https://baymard.com/blog/line-length-readability)

Mobile wants 30 to 50. Generator rule: `max-width: 65ch` for prose, 45ch floor,
80ch hard ceiling, 50ch on narrow viewports.

### Line height

**The larger the font, the tighter the line height.** Body 1.5 to 1.7, captions
1.3 to 1.4, headings 1.1 to 1.3, display 1.0 to 1.2.

**WCAG 1.4.12 Text Spacing (AA) is normative and testable.** The layout must
survive a user setting line height to 1.5x, paragraph spacing to 2x, letter
spacing to 0.12x and word spacing to 0.16x of the font size. Apply all four and
confirm nothing clips.
[W3C](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)

### The trap

**Inter is now itself a tell**, and so are Geist, Manrope, Space Grotesk and
Plus Jakarta Sans. Substituting one default for a newer default buys nothing.

## 4. Colour

### Why OKLCH is winning

HSL is based on screen geometry, not perception. Equal `L` across hues does not
look equally bright, so an HSL ramp produces visually uneven steps you then
hand-correct per hue. **OKLCH fixes exactly that**: a 9-step lightness ramp
comes out visually even with no correction.

sRGB renders about **35% of human-visible colours**; P3 adds roughly **30%
more**, and RGB/HSL cannot address P3 at all. CIE LCH has its own bug, shifting
hue in the blue range 270 to 330 degrees, which Oklab was designed to fix.
[evilmartians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)

Tailwind v4 moved its whole default palette to OKLCH.

### Contrast

WCAG 2.2, normative today: **4.5:1** normal text and **3:1** large text at AA,
**7:1** at AAA, **3:1** for UI components and graphical objects.

**APCA status, which most write-ups get wrong.** APCA is exploratory, not
normative, and **was removed from WCAG 3** in the July 2023 working draft after
failing to gain working group support. WCAG 3 is not expected to reach
Recommendation before roughly **2030**.
[Adrian Roselli, April 2026](https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html)

**So compute WCAG 2 ratios and gate on them.** Target APCA additionally if you
like, as Radix does, but APCA alone satisfies no current regulation.

### How many colours a restrained system uses

GOV.UK ships **10 named functional colours total**. Radix ships 12 steps, each
with one job. Linear's brand page ships 2.

**The rule is not "few hex values", it is "few semantic roles."** The slop
signature is the opposite: many hues, no roles, chosen per component.

## 5. Spacing and grid

8 is divisible by 1, 2, 4 and 8 and scales cleanly at 1x, 1.5x, 2x and 3x. The
secondary benefit is decision elimination: *"You no longer wonder whether to use
14px or 17px."*

| System | Scale (px) |
|---|---|
| IBM Carbon | 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 160 |
| Stripe Apps | 0, 2, 4, 8, 16, 24, 32, 48 |
| Vercel Geist | 4, 8, 12, 16, 24, 32, 48, 64 |

**Note what they share: the scale is dense at the bottom and sparse at the
top.** And Carbon includes 40 and 80, so strict 8pt purity is not what real
systems ship.

**Mature systems remove raw layout primitives from product code.** Stripe has
no CSS grid at all. Polaris bans `display`, `grid` and `flex` with the message
"consider using a Polaris layout component." The generator equivalent is to
emit layout components, not `display: flex` sprinkled per element.

**When to break it.** One gap everywhere is the tell. The fix is
relationship-based spacing: tight inside a group, generous between groups, on
an intentionally uneven scale. The internal-less-than-external rule: spacing
inside a component should be less than the spacing around it, so grouping reads
before content does.

**Nested radius is arithmetic, not taste: `inner = outer − padding`.**

## 6. The counter-examples

What separates these from merely ugly is consistent: **the unconventional part
is the surface and the conventional part is the behaviour.**

### Brutalist Web Design, David Copeland's manifesto

Already written as rules. [brutalist-web.design](https://brutalist-web.design/)

1. Content is readable on all reasonable screens. Default HTML already achieves
   this; styling can only subtract.
2. **Only hyperlinks and buttons respond to clicks.**
3. **Hyperlinks are underlined and buttons look like buttons.**
4. The back button works. Breaking it *"requires ignorance of (or contempt
   for) the site visitor."*
5. View content by scrolling.
6. Decoration only when needed.
7. Performance is a feature, produced by following the other six.

**Rule 3 is the one most generated pages break first.**

### Low-tech Magazine, the most instructive case

Solar-powered server, goes offline in bad weather. Images converted to black
and white with **four levels of grey** via dithering, displayed **larger** than
before at **one tenth** the resources. Static site: five times smaller. Text
uses the browser's default typeface in a single weight, hierarchy from size
alone.

**The decision that makes it design rather than optimization:** they chose
dithering because it is *visibly* different. *"You could build a website that's
just as energy efficient, but it would look like any other website, and then
nobody would even realize that it's a special website."*
[solar.lowtechmagazine.com](https://solar.lowtechmagazine.com/about/the-solar-website/)

### gwern.net

Palette deliberately grayscale, *"an experiment in consistency."* IBM Plex Mono
for code, **chosen after comparing about 20 fonts**, with a slashed zero treated
as essential. JavaScript not required to read. The governing line: *"Anything
besides the content is distraction and not design."*

He also maintains a public [Design Graveyard](https://gwern.net/design-graveyard)
of things tried and removed. **A public record of subtractions is itself the
practice that produces a distinctive system.**

### What actually makes these work

1. **The constraint is external and stateable.** A solar power budget. A
   legibility mandate. Nobody decided to "look brutalist."
2. **Affordances are preserved while style is abandoned.** Links look like
   links. This is the entire difference between brutalist and broken.
3. **Hierarchy comes from size and space, never colour tricks.**
4. **The subtraction is visible.** A page that is visibly cheaper reads as a
   decision. A page that is merely plain reads as an absence of one.
5. **They are recognizable**, which is the whole thesis.
