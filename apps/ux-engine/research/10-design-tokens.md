# Design tokens and theming

Researched 2026-09-20 from 46 fetches, mostly primary: the spec text itself,
plus token JSON and library source from Primer, Spectrum, Polaris and
material-color-utilities.

## The finding that matters most here

**Primer already ships agent-targeted metadata inside their token files.**

```json5
'org.primer.llm': {
  usage: ['page-background', 'main-content', 'card-background'],
  rules: 'Use as the primary background for pages and content areas. Do NOT use for emphasis or highlighting.'
}
```

The token carries its own usage contract, written for a model to read,
including a **do-not** clause. That is the deny-list idea arriving in the token
layer from a completely different direction, and it is the closest prior art
to [`../THESIS.md`](../THESIS.md) found anywhere so far. See
[`09-prior-art.md`](09-prior-art.md) when that lands.

## 1. The DTCG spec

**Design Tokens Format Module 2025.10, Final Community Group Report, published
28 October 2025.** Not a W3C Standard and not on the Standards Track.

It is **three modules**, which most write-ups miss: **Format** (structure,
types, groups, aliases), **Color** (the value object and its 14 colour
spaces), and **Resolver** (combining token sets across theme x brand x
density).

Origin credit is in the spec text itself: *"Design tokens were created by the
Salesforce design system team, and the name comes from them (Jon and Jina)."*

### What is settled and what is not

**Primitive types are stable:** `color`, `dimension`, `fontFamily`,
`fontWeight`, `duration`, `cubicBezier`, `number`.

**Every composite type still has an open design issue.** From the spec's own
Appendix A: `strokeStyle` (98), `border` (99), `shadow` (100), `gradient`
(101), `typography` (102), `transition` (103), plus `fontFamily` (53).

**So: treat colour, dimension, number, duration, cubicBezier and fontWeight as
durable. Treat composites as likely to churn.**

Style Dictionary's own docs say 2025.10 "lacks complete support, with full
compatibility being developed in v5."

### Two alias syntaxes, and you need both

```json
"primary":    { "$value": "{colors.blue}" },
"primaryRef": { "$ref": "#/colors/blue/$value" },
"primaryHue": { "$ref": "#/colors/blue/$value/components/0", "$type": "number" }
```

Curly braces target **complete tokens only** and implicitly append `/$value`.
JSON Pointer targets **any location**, including a single channel of a colour.
Pointer support is required, not optional.

Names must not contain `{`, `}` or `.`, because those are load-bearing in the
alias syntax.

### Deprecation is in the spec

`$deprecated` takes `true`, `false` (to override a group default), or an
explanatory string. The spec suggests tools emit it as a JSDoc `@deprecated`.

## 2. The three tiers, with counted evidence

Every major system converged on the same shape with different words:

| System | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Material 3 | `md.ref.palette.primary40` | `md.sys.color.primary` | `md.comp.filled-button.container-color` |
| Primer | `src/tokens/base/` | `functional/` | `component/` |
| Spectrum | `color-palette.json` | `color-aliases.json` | per-component JSON |
| SLDS 2 | internal | `--slds-g-*` | `--slds-c-*` |

### The numbers, which are the argument

| System | Count | What |
|---|---|---|
| Spectrum | **369** palette, all `"private": true` | tier 1 |
| Spectrum | **191** aliases | tier 2 |
| **Spectrum `button.json`** | **1 token** | tier 3 |
| Spectrum `layout.json` | 340 | |
| **Primer `light.css`** | **1,918 custom properties** | one of nine themes |
| Primer `removed.json` | **426 entries, 258 with a successor** | accumulated churn |
| Polaris | **452** `--p-*` total | deliberately small |

**Adobe runs the largest public token set in the industry and their Button
contributes exactly one component token.** That is the entire tier-3 argument
in one data point.

Primer at 1,918 and Polaris at 452 are both mature and both good. But 1,918 is
past the point where a human holds the vocabulary in their head.

### Why the middle tier is the one that matters

A primitive is an **absolute** statement ("this is #0066cc"). A semantic token
is a **relational** one ("this is the colour of a dangerous thing"). **Only
relational statements can be re-pointed.**

Skip tier 2 and dark mode has two bad options: redefine `--blue-500` to a
different blue, at which point the name is a lie, or fork the component CSS
per theme, which is the thing tokens existed to prevent.

**Spectrum deliberately chose option 1 and made it coherent**, which is worth
studying because it is the road less travelled. Their palette is
**theme-relative and ordered by contrast, not lightness**: `blue-500` is pale
in light theme and a deep saturated blue in dark. The scale means "distance
from the background." They make it safe by marking **every** palette token
`"private": true` so product code cannot reach it.

The more common failure is building tier 2 and having nobody use it.

## 3. Naming

Nathan Curtis's taxonomy: **namespace + object + base (category, concept,
property) + modifier (variant, state, scale, mode)**.

```
$esds-color-feedback-background-error
 namespace  category  concept  property  variant
```

His two rules: **avoid homonyms** (`type` and `text` collide across contexts)
and **do not globalize decisions prematurely**.

Polaris's `--p-color-bg-fill-critical-hover` is the cleanest proof the taxonomy
pays off: every segment is one axis, the axes never swap order, so the name is
machine-parseable and a designer can guess it.

**What breaks:** value-named semantics (`color-blue-500` as a button
background); inconsistent segment order; homonyms; state words that are also
variant words (`selected` vs `active` vs `current`); and mixing two numeric
scale conventions in one system.

## 4. Theming

**Dark mode is a re-pointing operation.** Primer authors it as a base value
plus per-mode override pointers in `$extensions['org.primer.overrides']`, and
ships **nine** themes from one source.

Two shipping strategies, both valid:

- **Primer** resolves at build time into flat hex per theme and swaps whole
  stylesheets. Cost: CSS weight. Benefit: no resolution chain at paint.
- **Polaris** ships one file where a theme is a class containing **only the
  deltas**. `.p-theme-dark-experimental` redefines about 40 of 452 tokens.
  `.p-theme-light-mobile` redefines only shadows and type sizes, which is
  density theming for free.

### `light-dark()`

Baseline since May 2024. **`color-scheme: light dark` at root is mandatory or
it does nothing.** Only works on `<color>` and `<image>`, so you cannot
`light-dark()` a spacing or a shadow.

**Shipping dark tokens without `color-scheme: dark` gives you white scrollbars
on a dark page.**

### Forced colors is the one people forget

In `forced-colors: active` the UA overrides every colour property and **forces
`box-shadow` and `text-shadow` to `none`.** So anything communicated *only* by
a shadow disappears. Both Primer's Button and Polaris lean on shadow for
affordance.

The fix is three lines:

```css
@media (forced-colors: active) { .button { border: 2px ButtonText solid; } }
```

System colour keywords come from **native element semantics, not ARIA**. A
`role="button"` on a `<div>` will not get `ButtonText`.

A high-contrast *theme* and forced-colors mode are different things. You want
both: the theme serves users who asked your app, forced-colors serves users
who told the OS.

## 5. Generating colour scales

### Material's HCT, where contrast becomes arithmetic

From the source comment in `hct.ts`:

> *"A difference of 40 in HCT tone guarantees a contrast ratio >= 3.0, and a
> difference of 50 guarantees a contrast ratio >= 4.5."*

**That sentence is the whole design.** Once tone is linear in contrast,
accessibility is arithmetic instead of an audit. Role-to-tone is then a lookup
table: `primary` is tone 40 light / 80 dark, `on_surface` is 10 / 90.

And each role carries a `ContrastCurve` giving its target at four user contrast
levels, so **Material's high-contrast mode is not a hand-authored theme, it is
the same generator run at a different contrast level.**

### Leonardo inverts the problem

Adobe Leonardo takes **the target contrast ratio as input** and produces the
colour as output, "rather than a post-color-selection auditing process." The
payoff is adaptive colour: a user can drag a contrast slider and the whole
palette regenerates while honouring the designer's ratios.

### OKLCH plus relative colour syntax

```css
:root { --accent: oklch(0.57 0.18 286); }
.button:hover { background: oklch(from var(--accent) calc(l + 0.1) c h); }
```

**Hover and active states stop being tokens at all. They become a function of
one token.**

Gamut caveat: Chrome and Safari currently use fast RGB clipping, which can
visibly shift hue.

### Picking one

| Approach | Optimizes for | Cost |
|---|---|---|
| HCT / Material | runtime generation from any source colour, guaranteed contrast | you inherit Material's role vocabulary |
| Radix 12-step | immediate correctness, zero maths, **the step semantics are the API** | fixed palette |
| Leonardo | contrast as input, user-adjustable | needs a build step |
| OKLCH + relative | pure CSS, states derived not stored | gamut mapping is browser-dependent |

**Radix's genius is that the scale is already semantic.** Step 9 is not "the
saturated one", it is "solid backgrounds." That collapses tiers 1 and 2 for
common cases, which is why small teams get so far on it so fast.

## 6. Style Dictionary

Nine steps: parse config, find files, run **parsers**, deep-merge, run
**preprocessors**, apply **transforms**, resolve references, apply **filters**,
run **formats**, run **actions**.

**The one gotcha worth internalizing:** value transforms are **skipped if the
token references another token**, unless the transform is declared
*transitive*. That is the source of most "my px-to-rem transform did not apply
to my semantic token" bugs.

`outputReferences` is what decides whether your CSS ships `var(--blue-500)` or
flattened hex.

### Most systems run Figma backwards from what people assume

**Primer's source of truth is JSON5 in git, and Figma is a consumer**, fed by
`$extensions['org.primer.figma']`. Figma-as-source is the easier start and the
harder steady state, because git gives you review, blame and CI.

## 7. Tailwind v4

`@theme` does more than `:root`: **declaring `--color-avocado-500` generates
`bg-avocado-500`, `text-avocado-500`, `border-avocado-500`.** The namespace is
the contract.

Escape hatches: `--color-*: initial` wipes one namespace, `--*: initial` wipes
everything, `@theme inline` resolves rather than indirects, `@theme static`
emits all vars.

### Implications for a generator

1. **The output artifact is a `@theme` block, not a JS object.**
2. **Namespace names are the public API.** If tokens are named
   `color.brand.primary`, the transform must emit `--color-brand-primary` or no
   utility is generated. The name transform does semantic work.
3. **Three tiers do not map onto one `@theme` block.** Put primitives in a
   plain `:root` and only semantics in `@theme`, so **nobody can write
   `bg-blue-500`.** That is Tailwind's version of Spectrum's `"private": true`.
4. **`--*: initial` is how a design system takes over.**

## 8. The zero-runtime wave

They are not competing for the same job.

| | Theming primitive | Type safety | Strongest when |
|---|---|---|---|
| **Tailwind v4** | CSS vars per selector | via plugins, not structural | fastest path to consistency |
| **Panda** | `semanticTokens` with conditions | full, generated | Chakra DX on server components |
| **vanilla-extract** | `createThemeContract` | **contracts enforced: every theme must supply every token** | you want the compiler to prove no theme is missing one |
| **StyleX** | `defineVars` | full | very large codebases; CSS size plateaus |
| **Open Props** | plain custom properties | none | tokens with no build step |

**vanilla-extract's contract is the feature nobody else has**, and it is the
best answer to "we added dark mode and forgot eleven tokens":

```ts
export const vars = createThemeContract({ color: { brand: null } });
// omit a key in a theme and it is a type error, not a runtime undefined
```

## 9. Governance

**Versioning consensus:** major for removing, renaming, or changing a type or a
semantic meaning. Minor for adding. Patch for changing a primitive value within
its meaning.

**That last line is where teams disagree and where incidents come from.**
Changing `--color-bg-critical` from one red to another is a patch by the letter
and a visible product change in practice. **No major system publishes a written
rule for this. [UNVERIFIED]**

Murphy Trueman's framing: *"changing a single token isn't just a design
decision, it's a deployment that touches production systems."* At ~100 tokens
manual updates become unreliable; by **500** manual management is impossible.
The failure signature of no ownership is `color.blue`, `color.blue-new`,
`color.blue-final`.

### Three deprecation mechanisms worth copying

**Spectrum puts a rename target on the token**, so a codemod can be *generated*
from the data rather than hand-written:

```json
"deprecated": true,
"deprecated_comment": "Use semantic token base-padding-vertical-extra-large instead.",
"renamed": "base-padding-vertical-extra-large",
"uuid": "92fef7e7-45bc-4dcd-91c2-c42e696263a8"
```

**Every Spectrum token carries a `uuid`**, giving it a stable identity
independent of its name. That makes a rename a non-event for tooling. No other
public system does this.

**Primer's `removed.json`** is 426 entries where `null` means gone and a string
means "here is where it went." It is simultaneously the changelog, the
migration map and the codemod input, in 426 lines instead of 426 blog posts.

### Practices worth stealing

- **Source in git, not the design tool.**
- **Lint the tokens** (Primer runs `lint:tokens`).
- **Contrast is CI, not a review comment.** Primer runs an `a11y-contrast`
  GitHub Action on every change.
- **Privacy markers** as access control inside the data.

## 10. What goes wrong

1. **Token sprawl from unowned decisions.**
2. **Semantic sprawl:** hundreds of one-off roles that are really component
   tokens wearing a semantic name.
3. **A semantic layer nobody uses**, because the path of least resistance beats
   the correct path. The three real answers are all structural: Primer's
   "Never use raw values" header, Spectrum's `"private": true`, Tailwind's
   `--color-*: initial`.
4. **Over-building tier 3.** Spectrum's Button: one token.
5. **Adoption treated as a technical problem.** It is change management.
6. **The spec does not save you.** DTCG standardizes the *format*. Two
   DTCG-valid files can be mutually unintelligible.

### The rules that fall out

1. Three tiers, boundary enforced **in code**, not documentation.
2. Generate primitives from an algorithm; author semantics by hand. Far fewer
   semantics than primitives, and **semantics are the only thing product code
   may reference.**
3. Component tokens only after reuse is proven across two components.
4. **Every token gets a stable id independent of its name**, so a rename is a
   data change.
5. Every removal writes a machine-readable row with a successor or explicit
   `null`, and the codemod is generated from it.
6. **Contrast is CI.**
7. **A theme is a diff, not a file.**
8. Count tokens in CI and fail on unexplained growth.

## Gaps

Medium and Salesforce docs return 403 to automated fetch, so the Baldwin essays
and exact SLDS prefixes are **[UNVERIFIED]**. No system publishes a written
rule on whether a primitive value change is patch or minor. Spectrum's
generation method is strongly implied by shared authorship with Leonardo but
not stated.
