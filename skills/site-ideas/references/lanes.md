# Lane prompts

`scripts/lanes.py` builds every prompt from this file and runs each one as its
own headless call from an empty directory (`claude -p --restricted`). A lane
never sees the other lanes or the baseline, because seeing examples first
anchors generation to them (Smith, Ward and Schumacher 1993, via K-Dense's
scientific-brainstorming bibliography).

Every prompt is `HEADER`, then one lane body, then `FORMAT`. `{brief}`, `{draw}`
and `{functional}` are filled from the run's brief.md and `scripts/draw.py`.
Edit a prompt here, never in a run folder, or the next run loses the change.

## HEADER

```
You are proposing directions for a website. Not a visual style: what the site
is, how a visitor moves through it, and what it asks of them.

THE BRIEF
{brief}

THE FLOOR. Every direction keeps all of these. Break any other web convention
you like, but not these:
{functional}
```

## Lane: inversion

```
THE DRAW. Six habits that nearly every website follows for no reason a visitor
needs:
{draw}

For each habit: state its strongest plausible opposite for THIS site. Then ask
where that opposite is already true somewhere in the world outside websites, and
who benefits from it there. Develop the flips that survive into directions. A
flip that only makes the site stranger without helping a visitor is dead: mark
it dead.
```

## Lane: stimulus

```
THE DRAW. Ten things from outside the web, drawn at random:
{draw}

For each one: list three to five structural properties, meaning how it works,
not how it looks. Force-fit those properties onto the site. Then apply the
redundancy test: could you have reached this idea from the brief alone, without
the stimulus? If yes, the stimulus did nothing; abandon it. Two failed attempts
on one stimulus means abandon it. Expect two or three abandonments.
```

## Lane: mechanism

```
THE DRAW. Four principles from distant fields:
{draw}

For each: answer its bridging question for this site, then derive the site's
structure and interaction from the principle itself. Use the mechanism, never
the imagery: a site about tides that shows waves has failed.
```

## Lane: concept-fan

```
Ask "what is this site a way of doing?" and answer in one line. Ask it again of
that answer. At each of the two higher levels, list three or four other ways to
achieve the same thing, most of them not websites. Then come back down: for the
most promising alternatives, what website would do that job? Prune any branch
that is the obvious site wearing a new coat.
```

## Lane: subtraction

```
Removing is free and costs nothing. Start from the site any competent designer
would build for this brief. Remove pages, sections, the menu, the bio, the
portrait, the form, the footer, until removing one more thing would break the
floor. Each direction keeps a different single thing at its centre. Say what was
removed and why the visitor does not miss it.
```

## Lane: tension

```
Name two or three tensions that are true of THIS brief and would be false of a
different client's site: forces that cannot all be maximised at once. Generic
ones like "simple versus powerful" do not count. Resolve each tension hard in
one direction, then hard in the opposite direction. Each resolution is a
direction, and two resolutions of the same tension must disagree about what the
site is for.
```

## Baseline (the control arm)

No technique, no draw, no tails. This is what asking a model directly returns,
and it is the cloud every other lane has to land outside of.

```
Propose 10 different website concepts for this brief. Be specific.
```

## FORMAT

```
Write five directions. Sample from the tails of the distribution: each one's
probability of being what a typical web designer would propose for this brief
must be under 0.10. For each:

## <short name> (p=<probability>)
- Move: the chain from the draw to the idea, every link shown.
- First ten seconds: what a first-time visitor sees and does.
- Main action: how a visitor does the main thing the brief says the site is
  for.
- Their material: what only this client has that the direction depends on. Mark
  anything not in the brief as [NEED: ...].
- Refuses: two or three things this direction will not do.
- Floor risk: the F-id it strains most, and how it still keeps it.

Then "## Abandoned": every draw or branch that produced nothing new, one line
each, with the reason.

Rules: invent no facts, numbers, quotes, names, places or events. No emojis and
no em dashes. Leave out colours and fonts unless the idea depends on them.
```

The baseline gets `HEADER`, the line above, and `FORMAT` from "For each:" on,
with the p, the draw chain and the Abandoned section taken out. Same brief, same
floor, same fields: the only difference between the arms is the technique.

## What the first run showed (2026-10-14, one brief)

- Lanes with a random draw (inversion, stimulus, mechanism) kept 7 of 15
  directions after the baseline filter. Lanes without one kept 1 of 15.
  Subtraction kept none: all five of its directions were baseline structures.
- Every direction claimed p under 0.10, including the 21 the baseline produced
  unasked. The stated p is not a filter.
- Keep the no-draw lanes until a second brief agrees, since 15 and 15 from one
  brief is too few to drop them on.
