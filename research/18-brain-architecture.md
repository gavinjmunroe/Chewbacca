# What the brain does that this system does not

Caleb, 2026-09-20: *"Highk study the parts of the human brain that's a pretty
cracked system God designed it."*

Neuro-inspired design is usually metaphor: "layers, like cortex", "attention,
like attention". That is decoration. This file only keeps mechanisms that name
a specific defect in what is already built here.

## 1. Dopamine is a surprise detector, not a reward detector

Schultz: dopamine neurons are activated more strongly by **unpredicted** than
by predicted rewards. They do not fire for reward. They fire for the gap
between what was expected and what arrived. Positive prediction error raises
phasic firing; negative error suppresses tonic discharge. The same machinery
runs learning, habit formation and motivation.

Sources: [Schultz, *J Neurophysiol* 80:1](https://journals.physiology.org/doi/full/10.1152/jn.1998.80.1.1),
[Hollerman & Schultz, *Nat Neurosci* 1998](https://www.hms.harvard.edu/bss/neuro/bornlab/nb204/papers/Hollerman_Schultz_NatNeuro_1998.pdf)

**The defect it names.** `ux-viewer` probes a page and reports. Every report is
treated as equally informative, so a probe confirming exactly what was expected
costs the same and counts the same as one that overturns it. There is no
prediction, therefore no error, therefore nothing that functions as learning.

**The change.** Predict the probe's answer before running it. The finding is
the DIFFERENCE. A probe that matches prediction is a confirmation and should
be cheap and forgettable; a probe that contradicts it is the whole signal.

This also answers the open question in QUESTIONS.md 116, can the agent be
surprised by its own output. Surprise requires an expectation, and until now
nothing here formed one.

## 2. Complementary learning systems, and the consolidation this lacks

Fast system, hippocampus: rapid learning rate, sparse pattern-separated
representations, episodic detail, minimal interference. Slow system,
neocortex: slow rate, distributed overlapping representations, generalisation.
They are joined by **replay**, reinstating the activity patterns from the
original event, and consolidation happens offline during rest so it does not
interfere with behaviour.

Sources: [McClelland, McNaughton & O'Reilly 1995](https://stanford.edu/~jlmcc/papers/McCMcNaughtonOReilly95.pdf),
[*Science Advances* 2019 on rehearsal and sleep](https://www.science.org/doi/10.1126/sciadv.aav1695)

**The defect it names.** Chewbacca already has both halves and nothing between
them. `scars` is the hippocampus: 53 episodic failures, one commit per event,
sparse and specific. `methods/` is the neocortex: six general rules. **No
replay, no consolidation.** Those 53 episodes will still be 53 episodes in a
year. Nothing ever notices that four of them are the same mistake and promotes
it to a rule.

**The change.** A consolidation pass, run offline rather than mid-turn: cluster
the scars, and where several share a mechanism, propose a new `methods/` rule
citing its episodes. The brain does this during sleep specifically because
doing it during behaviour would interfere.

## 3. Pruning is not damage, it is development

Synaptic density peaks in childhood and is cut back substantially through
adolescence. The mature system is not the one with the most connections.

**The defect it names.** Every bank in this kit only grows. 120 questions, 53
scars, 30 lint rules, 6 methods, and nothing has ever been removed for being
dead. `crafts/web-ux.md` opens with "removal is free" and the repo itself has
never had a removal pass.

**The change.** Log whether a question or a rule ever changed an outcome.
Retire what never does. Already named as the missing half of `scars`.

## 4. What does NOT transfer, said plainly

The brain runs on prediction error because it is minimising surprise about
sensory input it cannot control. A design tool is generating artifacts it
fully controls, so "minimise prediction error" as an objective would mean
producing the most predictable possible interface, which is the mode, which is
slop. **The mechanism transfers; the objective inverts.** Use prediction error
as a LEARNING signal and never as a target.

That inversion is the reason to write this file rather than repeat "the brain
minimises free energy" and feel clever.
