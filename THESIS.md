# The thesis

**Caleb, 2026-09-20:** *"Chewbacca has to be the first system to ever engineer
taste into ai."*

This file states the claim precisely enough to be wrong, and records what
would have to be true for it to hold. **Nothing here is settled.** A prior-art
pass is running and this file gets rewritten by whatever it finds.

## The claim as stated is puncturable

"First system to engineer taste into AI" does not survive a knowledgeable
reader, because aesthetic scoring is old:

- **LAION-Aesthetics** and Google's **NIMA** both train on human ratings and
  output a beauty score. They are used to filter diffusion training sets.
- **RLHF is preference-encoding at industrial scale.** That is arguably
  "engineering taste" already, and it is how every frontier model is tuned.
- Style transfer, layout-generation models, and the whole v0 / Lovable / Bolt
  / Galileo class of design tools all encode *something* about what looks good.

Say the sentence as written and one of those gets named back at you.

## The distinction that actually holds

**Every one of those systems learns a preference and moves toward it. That is
the machine that produces slop, not the cure for it.**

A model trained to maximize an aesthetic score produces the
most-liked-on-average output. The most-liked-on-average interface is the
indigo gradient, the rounded card and the three-column feature grid. Optimizing
a learned aesthetic score does not escape the median. **It is the fastest known
route to it.**

This is the same conclusion the constraint research reached from the other
direction: *the generated look is not bad taste, it is an empty deny list.*

## The defensible version

> **The first system that encodes taste as executable refusals rather than as a
> learned preference score.**

Narrower, checkable, and harder. The differences that matter:

| | Learned preference | Executable refusal |
|---|---|---|
| Shape | a score to maximize | a list of things that fail |
| Failure mode | regression to the mean | too restrictive, which is visible and fixable |
| Provenance | a training set nobody can inspect | a named system with a citation |
| Output | the average of everything | recognizably one thing |
| Auditable | no | yes, line by line |

`bin/ux-lint` is a primitive instance: it does not score a page, it fails
twenty specific choices and names the replacement for each. `SYSTEMS.md` is the
other half: 64 real systems indexed by **what they forbid**, so a generator can
adopt a coherent set of refusals instead of averaging them.

## What would have to be true

For the claim to hold, all four:

1. **No existing system does this.** Being tested now. The closest known prior
   art is design linting: `stylelint-polaris` bans hex and every length unit,
   `@atlaskit/eslint-plugin-design-system` bans raw `<button>` and
   `placeholder`. **Those are real and they are genuinely the same shape.** The
   distinction, if there is one, is that they enforce *one house system* for
   people already inside it, rather than letting a generator adopt any of 64
   and be held to it.
2. **Refusals actually produce better output than scores.** Untested. It is a
   hypothesis, and the honest experiment is a head-to-head.
3. **The refusals have to be derived, not invented.** Extracted from real
   systems with citations, which is what `tools/extract.py` does.
4. **It has to fire.** Caleb's own rule: *"I don't want this to be just
   knowledge somewhere in chewbacca I want it to actually be applied."*
   Enforcement is code that runs. A markdown file of good advice is worth zero.

## The strongest objection, kept in view

Bourdieu's, and it is not a technicality: **taste classifies, and it classifies
the classifier.** A deny list derived from Bugatti, Stripe and GOV.UK encodes
the preferences of a particular professional class, and calling that "taste"
rather than "one aesthetic" is exactly the move Bourdieu is describing.

The honest answer is probably that this system does not encode *taste*. It
encodes **coherence**: the property of having committed to one thing rather
than averaging several. Coherence is measurable, defensible across cultures,
and it happens to be what the award corpus independently concluded too: *the
corpus does not say 3D wins, it says one committed mechanism wins.*

**If the claim has to shrink, it shrinks to that, and that version is still
worth building and still appears to be unbuilt.**
