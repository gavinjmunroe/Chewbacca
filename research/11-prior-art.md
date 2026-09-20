# Prior art: has anyone engineered taste into AI already?

Researched 2026-09-20, adversarially, across 33 searches and fetches plus
direct inspection of four competing repos' source.

**The answer is yes, three times, and the closest one shipped 18 days ago.**

## The verdict first

> Is there any existing system that encodes aesthetic judgment as explicit
> executable refusals, derived from design systems, enforced at lint time,
> rather than as a learned preference score?

**Yes.**

| Project | Shipped | Stars | What it is |
|---|---|---|---|
| **`@shadcn/lint`** | **2026-09-02** | **2,226** | Agent-first ESLint plugin for Tailwind design systems. Per-component `allow`/`deny` contracts, `no-restyle`, `no-raw-colors`, `no-arbitrary-values`. **Errors written for the agent to read and fix.** README: "We developed these rules by studying production design systems" |
| **`ux-skill`** | 2026-05-24 | 75 | **152 executable regex refusals** with severity, `why` and `fix`. `--fail-on high` exits non-zero. Plus **160 brand spec JSONs** (Stripe, Linear, Apple, Bugatti, Aesop) each with an `ai_slop_avoided` deny list. Offline, never calls an LLM |
| **`auteur`** | 2026-07-11 | 1,022 | Claude Code skill. `slopscan` fails the build on "the 250-290 degree purple-to-blue AI gradient", `transition: all`, Inter defaults, em-dash slop |
| **`tinte`** | | 621 | Extracts identity from a live page into `SKILL.md` + `tokens.css`, then "exit 1 on any color that bypasses the tokens" |
| **`lyse`** | 2026-06-06 | 37 | Design-system drift scanner, 0-100 score, SARIF, diff-first CI gate, hands fixes to your agent over MCP |

And `stylelint-polaris` and `@atlaskit/eslint-plugin-design-system` have done
design-system-derived executable refusal **for years**. They are cited in this
repo's own README as examples. **They are prior art to it, not examples for
it.**

**`@shadcn/lint` has published agent evals this repo does not: 150+ task runs,
42 to 117 errors before feedback dropping to 0 after one correction round,
across Sonnet 5, Haiku 4.5, Opus 5 and GPT 5.6.**

**So the claim "nobody has built deny-list-based aesthetic enforcement" is
dead. Do not make it. Anyone who types "anti-slop linter" into GitHub catches
it.**

## The framing is also taken, and funded

**Taste Labs raised $18.5M seed** (Amplify, CRV) in June 2026, explicitly to
"end AI slop, starting with design." 1,000+ vetted design experts producing
critiques tied to source components, brand identity decomposed into
programmatic "ground truth verifiers", and **preference vectors kept per-judge
instead of averaged.**

**Frame this as taste engineering and you are the unfunded solo version of a
well-capitalized company whose approach is the opposite of yours.**
**[UNVERIFIED]** beyond press coverage; the Axios piece 403'd.

## What survives, and it is real

Two seams found by reading `ux-skill`'s actual source rather than its README.

### Seam 1: nobody ships a corpus of what many named real systems refuse, with provenance

`ux-skill`'s 152 executable rules have **no provenance field at all.** The keys
are exactly `id, name, severity, category, detection, why, fix`. They are
hand-authored regexes against generic AI tells, **derived from no system.**

Its 160 brand specs do carry per-brand denies, but those live in
`ai_slop_avoided` as **English prose for an LLM to read**, and the Stripe entry
literally opens *"An inspired interpretation of Stripi's design language"*
(their typo), **observed off marketing pages rather than read out of Stripe's
published system.**

`@shadcn/lint` ships six generic structural rules and expects **you** to author
the contracts. It provides no library of other people's systems.

**A 74-system refusal index where every constant traces to a source is the part
that does not exist elsewhere.**

### Seam 2: executable rules and design-system rules are different objects everywhere

In every competitor, **what is enforced is generic** (no arbitrary values, no
purple gradient) **and what is system-specific is advisory prose.**

**Making a named system's specific refusals themselves executable and
selectable, "lint this page as Bugatti", is the unclaimed move.**

## The centroid argument is right, and it is not ours

Worth knowing, because it is this repo's best argument and it is already in the
literature.

**The 2026 audit of LAION-Aesthetics** (arXiv:2601.09896) found the model
measures **photorealism, not quality**:

- WikiArt Realism scores 5.87. **Abstract Expressionism 4.96.**
- **Picasso 5.51 and Warhol 5.22 lose to cityscape painters** Edouard Cortes
  (7.09) and Antoine Blanchard (6.94).
- **Not one African, Oceanian, Native American, Islamic, Egyptian or West Asian
  work scored 6.5+.** Every 6.5+ image was Western or Japanese.
- ~60% of training images came from photography competitions. **One annotator
  contributed 87.4% of ratings** in one dataset. LAION's founder chose the
  weighting "from my subjective taste."
- Reward finetuning against it **reward-hacks into over-detailed images with
  high-frequency noise.**

That is a devastating and citable demonstration that optimizing a learned
aesthetic score produces a recognizable, narrow, culturally-specific look.

**And on RLHF: Kirk et al., arXiv:2310.06452**, found RLHF *"significantly
reduces output diversity compared to SFT across a variety of measures."*

**So the theoretical basis for the centroid argument is published. It is a
citation, not an insight.**

## Everything else in the space, for completeness

**Learned scorers:** LAION-Aesthetics (linear head on frozen CLIP, used to cut
LAION-5B at score thresholds; SD v1 trained on the >=5 subset), Google NIMA
(predicts the full 1-10 rating *distribution* with EMD loss), ImageReward,
PickScore, HPSv2, and RLHF/DPO reward models generally. All score. None refuse.

**Constitutional AI** is the interesting middle: written principles that the
model critiques itself against. **Principles are inspectable prose but
enforcement is a learned reward, not a runtime refusal.**

**Rule-based scorers, which are older than people think:** Ngo et al.
(2000-2003) published **14 closed-form formulas** over layout geometry:
balance, symmetry, equilibrium, unity, sequence, density, proportion, cohesion,
simplicity, regularity, economy, homogeneity, rhythm, order. **AIM** (Aalto
Interface Metrics, UIST 2018) is an open service computing 17 validated
perceptual metrics over a URL, and **explicitly never fails a design.**

**LACE** (ICLR 2024) puts alignment and overlap in as *differentiable*
constraints, soft during training and hard in post-processing. It penalizes and
repairs rather than rejecting.

**Automatic Feedback on UI Mockups** (CHI 2024) is the honest benchmark for
LLM critique: GPT-4 checking a Figma mockup against Nielsen's heuristics
reached **precision 0.603 against 0.829 for humans, and 29% of its suggestions
were rated not accurate.**

**Generators with no constraint engine at all:** v0, Lovable, Bolt, Galileo,
Uizard, Relume, Framer AI, TeleportHQ.

**Prose guidelines, instructing rather than enforcing:** Vercel's Web Interface
Guidelines (886 stars, 110 directives, **73 MUST, 30 SHOULD, 7 NEVER**) and
Anthropic's own `frontend-design` skill ("Never use: Inter, Roboto, Open Sans,
Lato").

## The recommended reframe

**Not taste. Provenance.**

> A citable index of what 74 named design systems refuse, where every constant
> traces to a source and nothing is invented.

That claim is defensible, checkable, and as far as 33 fetches can tell,
unoccupied. It is also the thing this repo actually did, and the thing its
extractor and its research discipline are already built for.

## [UNVERIFIED]

Taste Labs' method beyond press coverage. AIM's exact 17 metric names.
`@shadcn/lint`'s eval methodology (the results table was read, not
`docs/evals.md`). Galileo, Relume, Framer AI and TeleportHQ architectures (only
review-site paraphrase exists).
