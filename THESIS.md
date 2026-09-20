# The thesis

**Caleb, 2026-09-20:** *"Chewbacca has to be the first system to ever engineer
taste into ai."*

**The adversarial prior-art pass came back on the same day and killed it.**
This file records what died, why, and what survived, because a claim that
cannot survive a search is worse than no claim.

## What died

**The mechanism is not new.** Three projects ship executable deny lists for
generated UI, and the closest one shipped **18 days before this was written**:

- **`@shadcn/lint`** (2026-09-02, **2,226 stars**): per-component `allow`/`deny`
  contracts, errors written for an agent to read and fix, rules "developed by
  studying production design systems", **and published agent evals this repo
  does not have.**
- **`ux-skill`** (2026-05-24): **152 executable regex refusals**, `--fail-on
  high` exits non-zero, plus **160 brand specs** each with an `ai_slop_avoided`
  list, **and the identical centroid thesis.**
- **`auteur`** (1,022 stars) fails builds on the purple-blue AI gradient.
  **`tinte`** (621) exits 1 on any colour bypassing the tokens.

And `stylelint-polaris` and `@atlaskit/eslint-plugin-design-system` have done
this for years. **This repo's README cites them as examples. They are prior art
to it.**

**The framing is also taken and funded.** **Taste Labs raised $18.5M** in June
2026 explicitly to "end AI slop, starting with design", with a 1,000-expert
judging network. Framing this as taste engineering makes it the unfunded solo
version of a well-capitalized company.

**And the centroid argument is published, not ours.** Kirk et al.
(arXiv:2310.06452) found RLHF *"significantly reduces output diversity."* The
2026 LAION-Aesthetics audit found the scorer measures photorealism, not
quality: **Picasso scores 5.51 and loses to cityscape painter Edouard Cortes
at 7.09, and not one African, Oceanian, Native American, Islamic, Egyptian or
West Asian work scored above 6.5.** That is a devastating citation. It is not
an insight of ours.

## What survived

Two seams, found by reading a competitor's source rather than its README.

### 1. Nobody ships a corpus of what many named real systems refuse, with provenance

`ux-skill`'s 152 rules have **no provenance field at all**. They are
hand-authored regexes against generic tells, derived from no system. Its brand
specs are **English prose observed off marketing pages** (the Stripe entry
opens *"An inspired interpretation of Stripi's design language"*, their typo).

`@shadcn/lint` ships six generic rules and expects **you** to author the
contracts. It offers no library of other people's systems.

### 2. Everywhere else, the executable rules and the design-system rules are different objects

What is enforced is generic. What is system-specific is advisory prose.
**Making a named system's own refusals executable and selectable, "lint this
page as Bugatti", is unclaimed.**

## The claim, rewritten to be true

> **Not the first system to engineer taste. The first citable index of what 74
> named design systems refuse, where every constant traces to a source and
> nothing is invented.**

Smaller, checkable, and actually ours. It is also what the repo already is: an
extractor, a provenance discipline, and a research corpus that marks
`[UNVERIFIED]` where the trail ran out.

**Provenance, not taste.**

## What this repo has to do to earn even that

1. **Publish evals.** `@shadcn/lint` has 150+ agent task runs showing errors
   going 42-117 to 0 after one correction round. This repo has 12 unit tests.
   Until there is an eval showing generated output measurably improves, the
   linter is an assertion.
2. **Put provenance in the data.** Every rule in `ux-lint` should carry the
   system and the source it came from. Right now several are generic tells with
   no citation, which is the exact criticism levelled at `ux-skill` above.
3. **Make the 74 systems' refusals actually executable**, not just indexed.
   `ux-pick` prints Bugatti's refusals as prose. Nothing checks them.
4. **Cite the neighbours in the README**, including the ones that got there
   first. A repo that pretends `@shadcn/lint` does not exist is not credible.

## The objection still standing

Bourdieu: **taste classifies, and it classifies the classifier.** A deny list
built from Bugatti, Stripe and GOV.UK encodes one professional class's
preferences.

The LAION audit is the empirical version of exactly that objection, and it
lands on this repo too: **74 systems drawn overwhelmingly from Western tech and
luxury brands is a narrow corpus, and calling it "taste" is the move Bourdieu
described.**

Which is another reason **coherence and provenance are the honest words, and
taste is not.**
