# Why this is not another rule set

Every AI design toolkit shipped so far is the same shape: **somebody's taste,
encoded once, as files.** ux-skill's 152 regexes. plugin87's 138 systems.
shadcn/lint's contracts. Anthropic's `frontend-design`. The first 30 rules in
this repo.

They differ in quality and not in kind, and the kind has a known ceiling:

> Taste is stateful, closed-loop and project-specific. A skill file is
> stateless, open-loop and global. You can raise the floor with one. **You
> cannot install a point of view.**

The proof is that **Anthropic's own design skill became the tell it was written
to prevent.** Cream, serif, terracotta. A community playbook now flags the fix
as the new slop. Adding a 31st rule does not escape that; it is the same
architecture with better citations.

## What the research says taste actually is

From `research/05`, defended against Hume, Kant, Bourdieu and the fluency
literature:

> **Taste is trained discrimination: the ability, acquired by high-volume
> comparison within a domain, to detect which of two near-identical artifacts
> is worse, and to name the specific feature responsible.**

Read the operative words. **Comparison. Two. Worse. Name the feature.**

Now read what every tool in the category does: **it scores one artifact against
a fixed rule list.** That is not the definition. It is not even close to it.

And the mechanism that trains discrimination is equally specific.
`research/12`, Kellman: not hours, not stored examples, but **many
classification trials with immediate feedback, varying the irrelevant features
so the relevant one separates**. Effect sizes of 0.84 to 2.69 **on transfer
items**, meaning previously unseen cases. A dermatology module erased a full
year of curriculum difference in one session.

**Nobody has built the classification trial. Everybody has built the rule
list.**

## The four things the evidence says are missing

**1. The model cannot see its own output.** Anthropic's own engineering blog:
*"When asked to evaluate work they've produced, agents tend to respond by
confidently praising the work, even when, to a human observer, the quality is
obviously mediocre."* Their skill says to screenshot *"if your environment
supports it."*

**2. The critic is the author.** Same source. Self-evaluation collapses into
self-praise, and their own fix was a separate evaluator agent driving a
browser. They demonstrated the architecture in research and shipped prose.

**3. Nothing is remembered.** The original `frontend-design` instructed Claude
to *"NEVER converge on common choices across generations."* That instruction is
unfollowable: each conversation is isolated. **Telling a stateless model not to
repeat itself is asking it to condition on information it does not have.**

**4. Scoring optimizes toward the median by construction.** `research/13`:
prototypicality is preferred by novices and **not** by experts. A learned
aesthetic score is the novice end of that split, which is why optimizing one
produces the look everyone recognizes.

## The loop

```
  ux-constrain          derive THIS project's deny list. Not borrowed.
        |
        v
  generate N variants   different constraint sets, same brief
        |
        v
  ux-trial render       headless Chrome, one PNG per variant
        |
        v
  BLIND paired compare  a critic that did not write them, seeing only
                        shuffled images, must say which is WORSE and
                        NAME THE FEATURE responsible
        |
        v
  trials/log.jsonl      the discrimination, with its reason
        |
        +--> feeds the next generation, so "do not converge" becomes
             enforceable instead of an instruction to a stateless model
        +--> IS the eval nobody in this category publishes
```

Every arrow is something the evidence asked for:

| Step | Why, and from where |
|---|---|
| Derive, not borrow | copying yields the maximally prototypical artifact (research/12, /13) |
| N variants | constraint as generator, not filter (Oulipo, Dogme, research/12) |
| Render | models improve when they can observe output (1D-Bench); the skill makes this conditional |
| **Blind** | expectation drives the judgment; readers mistake their own preference for evidence (research/13) |
| **Critic ≠ author** | self-evaluation collapses into self-praise (Anthropic) |
| **Which is WORSE** | the definition of taste is discrimination between near-identical artifacts (research/05) |
| **Name the feature** | *"an unarticulated preference is a preference. An articulated one is a judgment."* Hume's Sancho |
| Log it | classification trials **with feedback** is the mechanism (Kellman, research/12) |

## What this changes about the claim

The repo stops being a corpus with a linter, which is a crowded category where
it is the Nth entrant with the fewest stars.

It becomes **the only one of these that runs the trial.** Static rules are the
floor it starts from, not the product.

And it produces, as a by-product, the thing this whole category is missing:
`@shadcn/lint` publishes agent evals, nobody publishes **design** evals, and
UI-Bench exists precisely because automated aesthetic proxies do not correlate
with expert preference. A log of blind paired comparisons with named reasons is
an eval, and it accumulates.

## The honest risk

**The critic is a model, and models are not expert judges.** `research/13`:
GPT-4 checking a mockup against Nielsen's heuristics reached precision 0.603
against 0.829 for humans, and 29% of its suggestions were rated inaccurate.
TASTE found VLMs fail to reach majority agreement with a designer panel, and
that **the panel only moderately agrees with itself.**

So the trial does not produce truth. It produces **a logged, blind, reasoned
comparison that a human can overrule in one line**, and the overrule is the
highest-value row in the log, because it is the one place real taste enters the
system.

That is the difference between this and a scorer: **a scorer asks you to trust
it. A trial hands you two images and its reasoning and asks you to correct it.**
