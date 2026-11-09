# Why AI design tools die

Researched 2026-09-20. 26 fetches plus 7 direct registry and liveness checks.
**This is the report that changed the architecture.**

## The one cause

> **There is no external, published, machine-checkable standard for "good
> design," so every tool in this space has to invent the standard it enforces,
> and a tool that invents its own standard cannot survive contact with a
> designer who disagrees.**

Every survivor escapes that exactly three ways:

- **axe-core enforces WCAG**, which Deque did not write. The argument is with
  the W3C, not the vendor.
- **Prettier abolishes the decision.** It has permanently closed formatting
  option requests. *"The debates over styles just turn into debates over which
  Prettier options to use."*
- **Google's Tricorder restricts to the provable subset** and hands the rest to
  humans.

Every corpse either promised taste or produced output whose review cost
exceeded the cost of redoing it.

## The graveyard

| Product | Cause of death |
|---|---|
| **The Grid** | ~$7M VC plus $5.2M crowdfunded. Locked users out of their own sites, refused refunds, 35 staff to 3. CEO: *"it's much more difficult than any of us realized."* |
| **Airbnb "Sketching Interfaces"** | The most-hyped artifact in the category. The URL now **404s** and there is **no public retrospective at all.** |
| **airbnb/react-sketchapp** | **14,861 stars. 188 npm downloads a week.** The clearest data point here: design tooling collects stars, not users |
| **Figma "Make Designs"** | Shipped at Config, **pulled in ~2 weeks** for reproducing Apple's Weather app. Field: *"it is my fault for not insisting on a better QA process"* |
| **Diagram "Genius"** | Never shipped past a waitlist. Acquired by Figma, **3 of 5 team members left within weeks** |
| **Uizard** | 3M users and **$3.5M ARR after 7 years on ~$21M raised**, sold to Miro mid-Series-B-raise. **That is the demonstrated revenue ceiling of this category** |
| **Galileo AI** | Acquired by Google, folded into Stitch, standalone terminated. Successor reviewed as failing *"basic accessibility requirements, such as color contrast and touch target sizes"* |
| **Builder.ai** | Insolvent at a $1.5B valuation. ~700 human engineers instructed to hide their location. Claimed $220M revenue, actual ~$50M |
| **AIM (Aalto)** | Best academic attempt, 17 validated metrics, still online. **65 stars, last commit 2023.** Eight years, essentially zero practitioner uptake |
| **Shopify Polaris React** | The poster child for enforced design systems. **Archived and deprecated Oct 2025** |

**Still alive and not a counterexample:** Locofy, Anima, TeleportHQ. Independent
testing across three real agency projects found *"none of them fully deliver on
production-ready code,"* and specifically that **"refactoring Anima output into
maintainable components typically takes longer than building from scratch."**

## The design-system numbers

zeroheight 2026, n=147:

- **38% widely or fully adopted. 91% trusted.** That gap is the whole story:
  the failure is friction, not credibility.
- **61% understaffed.** Federated models worst at 74%.
- **Executive buy-in satisfaction fell 42% to 32% in one year**, dissatisfaction
  rose 23% to 40%.
- **41% measure adoption. 5% measure ROI.**
- Sparkbox: **35% of in-house teams have considered or begun building a
  replacement system.**

**Spotify's GLUE**: centralized, became a bottleneck, **team disbanded**, and
they later counted **22 different design systems** inside one company. The
federated replacement has its own failure mode, since federated teams are the
most understaffed.

**The npm reality check:**

| Package | Weekly |
|---|---|
| `@mui/material` | 7,368,291 |
| `@shopify/polaris` | 202,023 |
| `@primer/react` | 44,612 |

Three of the best-funded in-house systems in the world, outnumbered **36x to
165x** by a generic library nobody's brand owns.

## Why linters get turned off, and it is not what people think

**"Quieting the Static," 1,425 Java projects:**

| Reason for suppression | Share |
|---|---|
| **Unactionable** | **61-68%** |
| Technical debt | 27-34% |
| **False positive** | **4-5%** |

**False positives are only 4-5%.** The dominant category is *unactionable*, and
its biggest sub-cause is **"Wrong Tool Assumptions" at 34-40%: the rule is
correct in general and wrong here, because the tool does not know the intent.**

For design that is fatal by construction. Every interesting design rule is
context-dependent.

**FSE 2025:** 7,357 suppressions across 46 Python projects, **one in six code
files**, growing monotonically, and **50.8% of suppressions do not affect any
warning** — they are dead ritual.

**Configuration is set once and never touched.** Across 16,562 JS commits,
*"the choice of linter and their configurations are rarely subjected to change
once introduced,"* and rules are **never disabled or removed**. 54% of SAST
users never configure at all.

**So your defaults are your product.**

### The thresholds

- **Google: under 10% effective false positives for a code-review check, ZERO
  for anything build-breaking.**
- Their definition is from the developer's side: *"An issue is an 'effective
  false positive' if developers did not take some positive action after seeing
  the issue."* **A true positive nobody acts on is a false positive.**
- Their failed attempt was a **dashboard engineers ignored**, with **84% of
  auto-filed bugs never fixed.** Their working system applies **~3,000
  automated fixes per day.**
- Deque's axe manifesto: **zero false positives**, and even **5% is "materially
  significant."**

**Measured LLM design critique: ~34% effective false positives (GPT-4), worse
for Claude and Gemini. That is 3.4x over the abandonment line.**

## The ground-truth problem, which may be unsolvable as posed

Duan et al., CHI 2024, GPT-4 critiquing UI mockups: **precision 0.603 against
0.829 for humans**, 29% of suggestions rated not accurate.

**And the number that should stop anyone:** inter-rater agreement among three
professional designers, on whether GPT-4's critique was even *accurate*, was
**κ = 0.112.** On helpfulness, **0.100.**

**Three design experts cannot agree with each other on whether a piece of
design feedback is correct.** There is no ground truth to train against and
none to evaluate against.

Zhong et al. 2025 is the strongest pro-LLM result and its own refutation:
GPT-4 found 73-77% of known usability issues, beating five aggregated human
experts at 57-63%. But of 147 **severity-0 non-issues** (Nielsen's *"I don't
agree this is a problem at all"*), the five experts reported 6% and **GPT-4
reported 65%.** Claude 84%. Gemini 93%.

## The survivor checklist

1. Does it enforce a standard **the author did not write**, or abolish the
   decision entirely?
2. Is its effective false-positive rate **under 10%**, measured as "developer
   took no action"?
3. Does it **decline the unprovable half out loud**?
4. Does it **fix in one keystroke** rather than report to a dashboard?
5. Does it sit at a gate that cannot be skipped, **applied to new work only,
   with the backlog ratcheted or suppressed by the tool's own migration**?
6. Does it **refuse configuration on the axis where taste lives**?
7. Is there a **budget owner outside the team** who is already afraid of
   something?
8. Does it **arrive by default** in something the user already runs?

axe-core scores 8/8. Prettier 7/8. Every dead product above: 0-2.

**The forcing function matters more than the tooling.** 3,117 federal ADA web
lawsuits in 2025, over 25,000 since 2018. **Nobody gets sued for inconsistent
border radius.**

**And the adoption gap, same technical problem, five orders of magnitude:**

`eslint-plugin-jsx-a11y` **34,959,582** weekly vs
`eslint-plugin-design-tokens` **174**. **200,916 to 1.**

## The honest counterweight

**axe-core won completely and the web is still broken.** 51M weekly downloads,
inside Chrome, backed by 25,000 lawsuits, and **94.8% of the top million home
pages still have detectable WCAG failures**, down 1.1 points in a year, at 51
errors per page.

**Winning the tooling war is not winning the outcome.**

## What this changed here, the same day

**The escape the report names:** *"a declared project convention is an external
standard from the tool's point of view."*

So `ux-lint` now splits its rules by **authority**, not just severity:

- **EXTERNAL** cites WCAG, MDN, W3C or NIST. **May block.**
- **HOUSE** is this repo's reading, however well sourced. **Advises, never
  blocks.**
- **PROJECT** is the project's own `DENY.md`. **May block**, because the
  project declared it.

On a real page that took the blocking surface from **34 findings to 4.**

And `ux-constrain --init` now writes a `DENY.md` scaffold **with a
suppressions section**, because 61-68% of real suppressions are legitimate
context the tool cannot see, and a gate with no documented escape hatch is a
gate that gets deleted.
