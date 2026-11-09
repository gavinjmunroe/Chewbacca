# Taste as a learnable skill

Researched 2026-09-20 across 30 searches and 25 fetches, with four primary
papers pulled and read as PDFs.

## The finding to act on first

**Adams et al., *Nature* 592 (2021), "People systematically overlook
subtractive changes."**

The mechanism is not that people prefer adding. It is that **subtraction is
not generated as a candidate during search at all.**

Lego task: a roof held by one narrow column. Improve it. **Each added piece
costs $0.10. Removal is free.** The optimal move is removing the column.

| Condition | Subtracted |
|---|---|
| No cue | **41%** |
| **Cued: "Removing pieces is free and costs nothing"** | **61%** |

**Eight words moved subtractive solutions by twenty points.**

**And here is the part that matters most: the task already priced additions at
ten cents each, and people still added. The price did not fix it. The sentence
did. Permission beats pricing.**

Other conditions: three practice trials moved a grid task from **49% to 63%**.
**Cognitive load reliably suppressed subtraction.** And the field archive is
the hardest evidence to explain away: of **651 real improvement proposals**
submitted to an incoming university president, **only 11% involved removing
anything.**

Across all experiments the subtractive rate **never exceeded 40%** and most
conditions clustered near **25%**.

### Why this explains additive generated output, point by point

1. **No cue.** "Improve this" is literally the uncued condition, and uncued
   tops out at 41%.
2. **One shot.** Single-pass generation is the paper's own worst-case
   moderator. The 49-to-63 gap is the size of that.
3. **Cognitive load.** A long context doing many things at once is a loaded
   searcher.
4. **Adding is legible as work. Removal leaves no token of effort.**

### Countermeasures, ranked by evidence

| Do this | Evidence |
|---|---|
| **State explicitly that removal is permitted and free** | strongest: 41% to 61% on eight words |
| Force multiple passes over the same artifact | 49% to 63% with three practice trials |
| Reduce concurrent load during the review pass | load manipulation confirmed |
| Require a subtraction quota | extrapolated, not tested |
| Price additions | **modelled in the study and it did not work** |

### Replication status, honestly

**Direction well supported, magnitude unsettled.** A 2024 cross-cultural
replication (*Sci Rep* 14) **failed to replicate the grid task**
(t(52) = -0.453, p = 0.653), found Swedish adults subtracted more than
American, and found children 9-10 showed *stronger* additive bias than adults.
The field archive is the sturdiest leg. **[UNVERIFIED]** on effect sizes: the
Nature paywall blocked the full text, so every number here is a proportion
from the abstract, the authors' popular writing, or detailed secondary
coverage.

## Constraints

### Dogme 95, the best encodable artifact found

Written by von Trier and Vinterberg in about 45 minutes, announced 13 March
1995, thrown at the audience as red pamphlets.

1. Shooting must be done on location. Props and sets must not be brought in
   (if a particular prop is necessary for the story, a location must be chosen
   where this prop is to be found).
2. The sound must never be produced apart from the images or vice versa.
3. The camera must be hand-held.
4. The film must be in colour. Special lighting is not acceptable (if there is
   too little light the scene must be cut or a single lamp attached to the
   camera).
5. Optical work and filters are forbidden.
6. The film must not contain superficial action.
7. Temporal and geographical alienation are forbidden.
8. Genre movies are not acceptable.
9. The film format must be Academy 35mm.
10. The director must not be credited.

**Read it as a spec. Nine of ten are prohibitions.** Only four contain a
positive requirement, and each of those forces a *single* value, not a range.
**There is no rule saying "make it emotionally truthful." The entire aesthetic
is the residue of a deny list.**

**The parentheticals are the second lesson: each one closes the obvious
workaround in advance.** If you need the prop, move the shoot. If there is not
enough light, cut the scene. **The rule anticipates the negotiation and
pre-refuses it.**

Honest outcome: certified Dogme films broke their own rules constantly.
*Festen* covered a window, *The Idiots* used Saint-Saëns, and rule 10 was
violated by the founders themselves. The movement dissolved in 2005 after 35
films. **The constraint was productive even where disobeyed, which is the
finding: it changed the default, and the violations were deliberate and few
rather than ambient.**

### The empirical base

**Acar, Tarakci and van Knippenberg (2019),** *Journal of Management* 45(1).
3,901 publications filtered to **145 empirical studies.**

Three constraint types: **input** (resources), **process** (steps), **output**
(what the result must or must not contain).

**The headline is an inverted U, and their explanation of the literature's
disagreement is the most valuable sentence in the paper:**

> *"The curvilinear effects theorized below can explain empirical evidence for
> positive, negative, or non-significant effects as these studies may have
> tapped into different parts of the whole range of constraints."*

**The mechanism for output constraints is exactly the generated-UI problem:**

> *"When there are no constraints on the search space, decision makers are
> prone to select the most intuitive solution rather than trying to identify
> novel ones, a process referred to as following the 'path-of-least-resistance'
> ... retrieving a known solution is cognitively less demanding than exploring
> innovative ones."*

Their own caveat: evidence for the output-constraint mechanism specifically is
**scarce and qualitative**. The quantitative curvilinear evidence is for input
constraints.

**Moreau and Dahl (2005),** *JCR* 32(1): fewer available parts produced more
original solutions, **but the benefit disappears under time pressure.**
Constrain the materials. Do not constrain materials and the clock at once.

**Stokes'** paired-constraint model (every constraint precludes something *and*
specifies its substitute) is a genuinely useful structure but is **an
interpretive framework illustrated with Matisse and Monk, not experimental
evidence.**

### Encodable summary

1. Prefer **output constraints phrased as prohibitions.**
2. **Write the workaround into the rule**, the way Dogme's parentheticals do.
3. **Constrain one dimension at a time.**
4. Expect an inverted U; assume any single study sampled one arm of it.
5. **Pair each prohibition with its substitute. A deny list with no replacement
   produces paralysis, not style.**

## The 10,000 hours thing is worse than you think

**Macnamara, Hambrick and Oswald (2014),** *Psychological Science* 25(8). 88
samples, 157 effect sizes.

**Overall r = .35. Deliberate practice explains 12% of variance. 88%
unexplained.**

| Domain | variance explained |
|---|---|
| Games | 26% |
| Music | 21% |
| Sports | 18% |
| Education | 4% |
| **Professions** | **<1%, n.s.** |

**And the moderator that should end the conversation: how practice was
measured changed the answer fourfold.**

| Method | variance explained |
|---|---|
| Retrospective interview | 20% |
| Retrospective questionnaire | 12% |
| **Practice log** | **5%** |

The 1993 violin study used retrospective estimates. The authors note a
higher-fidelity method "might reveal that the relationship is weaker than
these results indicate."

**The 2019 preregistered replication broke the rank order entirely:** the
"good" violinists had logged **9,844 hours against the "best" group's 8,224.**
Variance explained fell from 48% to 26%. *"We did not replicate Ericsson et
al.'s major result."*

**The number 10,000 is not in the source paper.** Ericsson objected publicly:
"There is nothing special or magical about ten thousand hours."

## What actually trains discrimination

**Chase and Simon (1973):** masters reconstructed real chess positions after
5 seconds where novices could not, and **on random positions the advantage
nearly vanished.** Not bigger memory, bigger chunks.

**Kellman (2013),** *Military Medicine* 178. Perceptual and Adaptive Learning
Modules: many short classification trials with feedback, **varying the
irrelevant features so the relevant ones separate out.**

- Mathematics: effect sizes **0.84 to 2.69** on assessments consisting
  primarily of **transfer items**.
- Dermatology and histopathology with medical students: mean effect sizes
  **>0.7, p < 0.0001**, on **previously unseen images**.
- Second-years entered with much higher pre-test scores than first-years, and
  **post-test scores were nearly identical. The module erased a year of
  curriculum.**

**Kellman attacks the stored-examples model directly:** it is "a common
misconception" that expertise is "committing to memory a great number of
examples." The radiologist "must detect the pathology in a **new** image."
What transfers is **attuned selectivity**, not instances.

**So a reference library is not valuable as a retrieval store. It is training
data for a classifier, and it only works while you are actively judging items
against each other.**

**The counterweight, Drew et al. (2013):** 24 radiologists, a gorilla 48 times
the size of a nodule pasted into the final case. **83% missed it, and eye
tracking showed most looked directly at it.** Trained perception is a filter
as well as a skill.

## Connoisseurship: what is real and what is confabulated

**Morrot, Brochet and Dubourdieu (2001),** *Brain and Language* 79(2). White
Bordeaux dyed red with odourless anthocyanins; subjects applied **red-wine
descriptors** to it.

**Two honesty corrections the popular retelling drops:** the 54 subjects were
**oenology undergraduates**, not Masters of Wine. And the authors locate the
illusion **at "the verbalization phase of odor determination."** Colour
hijacked the **naming**, and naming is most of what a tasting note is.

**Hodgson (2008),** *Journal of Wine Economics* 3(2), is the more damning
result and gets cited less. California State Fair, 65-70 judges, **triplicate
samples poured from the same bottle.**

- **Median maximum range on the same wine: about 8 points**, roughly Bronze to
  Gold.
- **Only 10% of judges** were consistent within a single medal group.
- Perfect consistency occurred about 18% of the time, and **"this usually
  occurred for wines that were rejected."**

**Consistency lives in rejection, not in praise.** Which is the whole argument
for a deny list, arriving from wine.

**The rule that survives both:** trust an expert's **comparative, blind,
repeated** judgment. Do not trust their causal explanation of it, and do not
trust a single absolute score.

### Morelli's method, the most portable idea here

Giovanni Morelli attributed paintings by the **unconsidered details**: ears,
fingernails, drapery folds, especially in secondary figures. The logic is that
conscious choices are imitable and reflexive shorthand is not. Ginzburg places
it alongside fingerprinting: **the trace is diagnostic precisely because
nobody was attending to it.**

**This applies directly to detecting generated output: check the parts a
generator would not have been optimizing.**

## Critique

Kolko's five postures: expert judgment, shared inquiry, demonstration,
**confrontation** (students "consistently report this as high-stress and
ineffective"), and **ritual performance** (the pinned-up jury, which
"amplifies hierarchy, obscures feedback, and elevates performance over
learning"). Peer critique fails the other way: **fear of offending produces
feedback that is positive, vague and non-actionable.**

His one rule is **alignment between intent and enactment**: decide what the
critique is for, then pick the posture, rather than inheriting the jury.

### Pixar's Braintrust, and the one design rule worth stealing

From Catmull, *Creativity, Inc.*:

1. **Candor, not honesty** — honesty carries a moral charge that makes people
   defensive.
2. **The Braintrust has no authority.** It cannot mandate a single change.
3. **No prescriptions.** Identify what is not working; the fix belongs to the
   director.
4. **Peers only.** Steve Jobs was never invited.
5. The frame is medical: the film is the patient, **nobody in the room is being
   evaluated.**

**The mechanism Catmull is explicit about: candor and authority cannot coexist
in the same conversation. Attach power to the feedback and the feedback goes
quiet.** Total candor with zero authority is the entire design.

## Self-evaluation, ranked by what actually holds up

| Technique | Evidence |
|---|---|
| **Show it to a stranger** | **Strong mechanism.** Curse of knowledge (Camerer et al. 1989; Newton 1990's tappers). You are structurally unable to simulate a first encounter with your own work. A stranger is the only available measurement of a variable you cannot observe |
| **Sleep on it** | Meta-analytic support (Sio and Ormerod 2009), **conditional**: longer preparation first makes the effect bigger, and filling the break with demanding work shrinks it |
| Grayscale / squint | Principled by analogy to perceptual learning (remove the irrelevant dimension so the relevant one separates). No direct study |
| Flip horizontally | Principled, no study. Cheap enough that it does not matter |
| Read aloud | **The usual citation does not support the usual claim.** The production effect is about memory, not error detection. The defensible rationale is different: it forces a serial unskippable pass at speaking speed |

## Beloved ideas with weak evidence

- **10,000 hours:** not in the source paper, 5% of variance when honestly
  logged, <1% for professions, and the original study failed to replicate.
- **Wine expertise:** the fooling studies used undergraduates and target the
  *verbalization* stage. Hodgson's instability result is stronger and less
  cited.
- **Subtraction bias:** direction supported, magnitude unsettled, one headline
  task failed to replicate cross-culturally.
- **Stokes on constraints:** interpretive, not experimental.
- **Swipe files:** zero empirical support as a practice, and the nearest
  science argues against the stored-examples model.
- **Squint, flip, grayscale:** universally taught, entirely unstudied.
