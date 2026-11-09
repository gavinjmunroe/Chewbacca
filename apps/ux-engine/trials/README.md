# Trials

The log of blind paired comparisons. **This is the memory, and it is the eval.**

Each row is one classification trial: two variants of the same brief, rendered
headless, shuffled, judged by a critic who was not told which was which and
who had to name the specific feature responsible rather than express a
preference.

`ux-trial avoid` reads this back as the list of features that have lost here,
which is what makes "do not converge" enforceable instead of an instruction to
a stateless model.

**A human overrule counts triple**, because it is the only row where taste
that is not a model's enters the system.

## Why the first trial matters more than the log length suggests

Two pricing pages, same brief. `ux-lint` found **34 hits across 10 rules** on
the losing one: indigo, the gradient, the gradient headline, big radius, soft
shadow, `transition: all`, hover scale, invented stats, slop copy, ordinals.

None of those was the reason it lost.

It lost because **the three plans carry no differentiating information.** Every
card is identical except the number, so a reader cannot answer *"which plan am
I"* without leaving the page. The winning variant answers it in one scan with a
column: one person / up to five who deploy / unlimited plus SSO.

**Zero of the 30 rules mention information, content, or differentiation.** A
linter cannot hold that thought. Strip every tell from the losing page and it
is still the worse page.

That is the argument for the trial over the rule set, demonstrated rather than
asserted, on the first run.
