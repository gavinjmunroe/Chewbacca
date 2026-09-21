# Scraping a whole site into something that fires

Caleb, 2026-09-20: *"Its understanding of a UX should be done in a smart
creative resourceful actually applyable way, not just some text."*

## What the research settles before we start

**Prose is the worst available format for this.** SOPBench, six models:
compiled pseudo-code never significantly hurt and gained up to **16.0 points**
where official prose underperformed. FlowBench formalised workflow knowledge
as text, code and flowchart across six domains and 51 scenarios, and
**flowcharts reduced planning hallucination most**.

So the default deliverable of every design-scraping tool, a written style
guide, is the format with the worst measured performance. That is the first
thing to throw away.

**Negative-only instructions fail.** The Pink Elephant Problem. "Avoid X"
without "instead do Y" does not work, and vague negatives like "avoid
hallucinations" do nothing at all. Negatives work when they are specific AND
paired with a replacement. `ux-lint` already carries a `fix` on every rule;
that was a guess and it is now a finding.

**Contrastive examples plus an instruction beats either alone.** Demonstrations
scaffold how to apply a directive; instructions supply the discipline.
Neither half works without the other.

## The thing we have that nobody else does

Contrastive learning needs a negative class. Everyone scraping design has
positives only: here is what Stripe did. We measured the negative class.
`corpus/slop/` is what the generator produces UNPROMPTED, and `data/prior.json`
is the log-odds between the two populations.

So every extracted decision can ship as a PAIR:

    this site:  border-radius 9999px      the default: 100px
    this site:  a licensed typeface       the default: -apple-system  (8/9 vs 0/74)
    this site:  entrance ordered by reading order   the default: by DOM index

A pair is contrastive. A style guide is not. And a decision that matches the
default is not a decision at all, which means **the prior is also the filter**:
it tells us which of a site's thousand choices were actually chosen.

## The high-leverage questions, and what each one decides

**What can only be learned from a WHOLE site, never from one page?**
The system, and more importantly its deliberate violations. Which rules hold
on every page, and the one place they are broken on purpose. Consistency is
cheap to extract and boring. **The exception is the art direction.** If the
crawler cannot find where a site breaks its own rule, it has learned the
skeleton and missed the intent.
*Decides:* we crawl for VARIANCE, not for averages. An averaged site is a
style guide, and averaging is how you rebuild the mode.

**What is the unit of extraction?**
Not a token. A DECISION, defined as a choice plus the alternative not taken.
`--accent: #755CFE` is a token and teaches nothing transferable. "One
saturated hue, used only on interactive and data elements, never on a
surface" is a decision and transfers to a different brand entirely.
*Decides:* the schema.

**How do we know a decision was deliberate rather than defaulted?**
Score it against `data/prior.json`. If the site did what the generator does
unprompted, it was not a decision. This is the one filter that cannot be
faked by reading harder.
*Decides:* what gets kept. Probably 95% of extracted properties get dropped.

**What does a live site teach that a DESIGN.md cannot?**
Everything temporal and everything conditional. Motion, states, what happens
on hover, what happens when the form fails, what happens between pages. Our
74 vendored systems are all static token dumps from marketing pages, which is
exactly why `presets/` had to be written by hand.
*Decides:* the crawler drives the interface. It does not just load pages.

**How does a decision from THIS site apply to a DIFFERENT brief?**
Only if it is abstracted to the decision-KIND. "Bugatti's gold" transfers
nothing. "One voltage against near-black, and refuse rounding" transfers to a
payroll app. Copying produces the maximally prototypical artifact, which
novices prefer and experts reject (research/12, /13).
*Decides:* every extracted decision carries both the concrete value and the
abstracted rule, and generation is only ever given the abstraction.

**What would make this WORSE than not scraping?**
Handing a model one site's answers and getting a clone. That is the failure
mode of every reference library, and it is why this outputs constraints and
never values.

## The output, in the three formats the research prefers

Not a document. Three artifacts, generated per site:

1. **A decision graph** (`flow.json`). States, transitions, and what motion
   attaches to each. FlowBench: the format that reduces planning hallucination
   most. This is what `ux-flow` already models and what a crawl can populate
   for real instead of by derivation.

2. **Executable assertions** (`assert.py`). Every extracted rule as a
   checkable predicate, not a sentence. "No element animates a layout
   property." "Every interactive element has a focus style that is not
   `outline: none` alone." These run against generated output, so the
   knowledge is enforced rather than remembered, which is the only thing that
   has worked in this repo all night.

3. **Contrastive pairs** (`pairs.md`). Each kept decision beside the measured
   default, with the abstracted rule. This is the in-context demonstration,
   and the assertions are the instruction. The research says ship both.

## What the crawler actually does per page

    load, settle, screenshot
    computed styles for every visible element, not the stylesheet
    document.getAnimations() at load
    then DRIVE it: hover every interactive element, focus every input,
      submit an empty form, open every disclosure, resize to 375px
    capture getAnimations() and a screenshot at each of those states
    record what changed

The driving is the part nobody does. HTTP Archive parses CSS statically at
17.2M sites. slicer.dev extracts one page at load. Chrome's animation panel is
manual. **Every one of them reads the entrance.** Most of an interface's
motion and nearly all of its state handling lives past the entrance.

## Order of work

1. Crawler core: load, settle, computed styles, animations, screenshots.
2. The driver: hover, focus, submit, disclose, resize. This is the novel half.
3. Decision extraction filtered by `data/prior.json`, so only non-default
   choices survive.
4. Emit the three artifacts.
5. Wire into generation as a loadable lens, abstractions only, never values.
6. Measure: does a generation given a lens beat one without it, on the blind
   viewer? If not, this was a beautiful pipeline that changed nothing, and
   that is the honest bar.

Step 6 is the one that decides whether any of this was worth building.
