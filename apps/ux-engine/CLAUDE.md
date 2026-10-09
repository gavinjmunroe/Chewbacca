# Working in ux-engine

## What changed, and why the old instructions were wrong

This file used to say: pick one system from `SYSTEMS.md`, carry its refusals,
generate, lint. That is entirely subtractive. It gets you to **not slop** and
it never proposes anything.

Caleb, 2026-09-20: *"Good design isn't just avoiding bad design. It requires
thinking how could this be done in a way that is unique? What would a few of
the most creative ppl on earth propose and which path is the best?"*

And: *"It needs to put itself in the pov of the person looking at the site."*

So there are now two halves, and the generative one leads.

```
ux-gen "<brief>"        propose several genuinely different answers, look at
                        each one through a first-time viewer's eyes, rank them
ux-viewer check <file>  the looking, on its own, at any grain
ux-motion <thing>       timing and easing
ux-slop <files>         rank pages by how much they resemble a real system
ux-lint <path>          the floor: choices that are wrong on their own
```

## The four findings that dictate this architecture

**Sampling the same prompt N times does not give you N options.** The samples
cluster at that prompt's mode. Measure it before trusting any best-of-N:
`python3 tools/diversity.py corpus/slop --group-by-brief`.

**"Be creative" relocates the model to a second mode**, the stereotype of
creative: a gradient mesh, a glass card, brutalism as costume. Still one mode.

**A model asked "which design is better" picks the most median one.**
research/13 measured reward models overweighting typical outputs at
alpha-hat 0.57, p < 1e-14. So no LLM aesthetic judgement is load-bearing
anywhere in this repo, including yours.

**Three professional designers agreed at kappa = 0.112** on whether a design
critique was even accurate. There is no single expert view to imitate. Stop
trying to occupy one.

## So: how to actually build something here

**1. Say what success means before you build.** What should a first-time viewer
understand this is, what one thing should they be able to do, where should
their eye land first. `ux-gen` derives this automatically and writes
`intent.json`. Correct it if it is wrong; everything downstream is measured
against it.

**2. Partition, then draw once per cell.** `tools/stances.py` holds six
organizing principles, each abstracted from the corpus as a KIND of decision
rather than a palette, each carrying its own hard refusals. The refusals are
the load-bearing part: a stance without them is a mood board and the model
drifts back to the mode within three paragraphs.

**3. Look at it.** This is the part every generator in research/11 skips. They
write markup and never see pixels. `ux-viewer check` renders the thing and
hands the screenshot to a process that has **not** seen the brief, the code or
the intent, and asks a viewer's questions: where did your eye land, what is
this for, what are you meant to do, what made you stop. Gaps between that
report and the declared intent are real defects with locations.

The viewer must stay blind. A critic that can see the intent confirms the
intent.

**4. Removal pass.** Adams et al., *Nature* 592 (2021): only **41%** of people
removed anything when removal was free. Told *"removing pieces is free and
costs nothing"*, **61%** did. The price was already in the task; the sentence
is what worked. So say it out loud, and make a pass whose only legal move is
deletion.

## Any grain

A button, a page, one step of a flow, four components and how they sit
together. Stances and the viewer probe are both scale-free. For a button the
intent is "this reads as the primary action and says what will happen"; for a
flow, screenshot each step and ask what just changed.

## Do not copy a system

`ux-pick` exists to show you the SHAPE of a coherent refusal set. Read one as a
worked example. Do not adopt its answers. Copying produces the maximally
prototypical artifact, which novices prefer and experts reject, so copying to
escape the median lands you on a different median. research/12 and /13.

Derive this project's own deny list with `ux-constrain`.

## The corpus is measured, not asserted

`data/prior.json` is learned by `tools/build_prior.py` from 74 real design
systems against N unguided generations, as a log-odds ratio per design token.
Rebuild it after adding corpus samples.

**It ranks HTML against HTML and nothing else.** The two training corpora are
different file types, so part of the separation is format rather than taste.
`tools/validate_prior.py` reports AUC on the only comparison that holds format
constant, and prints n so a small one cannot be mistaken for a result.

## Regenerating

```
python3 tools/extract.py && python3 tools/index_md.py     # the index
python3 tools/gen_corpus.py --samples 3                   # more corpus samples
python3 tools/build_prior.py                              # relearn weights
./tests/run.sh
```

`data/systems.json` and `SYSTEMS.md` are generated. Edit `tools/extract.py`,
never the outputs.

**Check extractor output against brands you know before trusting it.** Every
bug found so far was found that way and none would have shown up as a crash:
Stripe's accent reading as a shadow colour, Bugatti's as its warning gold, ten
systems reporting a constraint they had no data for, and every `fontSize: 14px`
being read as a corner radius.

## Provenance

Never add a number to `data/constants.json` or `motion/` without a source in
`research/`. If the trail runs out, leave it out and say so. Several widely
repeated figures in this field do not survive checking.

## Adding a rule to ux-lint

Every rule names a user cost and cites a source; `tools/check_rules.py` fails
the build otherwise. A rule justified by how the artifact reflects on the
evaluator is a class marker, not a standard (Bourdieu, research/05). Add a case
to both fixtures in `tests/fixtures/`.
