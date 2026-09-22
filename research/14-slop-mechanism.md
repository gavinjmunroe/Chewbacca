# AI slop: mechanism, cross-medium pattern, and escape

Researched 2026-09-20, ~110 fetches. Every ML claim traces to a primary.

## The finding that challenges this repo's architecture

**Post-editing does not work, and it fails invisibly.**

arXiv:2604.24444, **preregistered, n = 81.** Participants edited LLM drafts to
sound like themselves.

- Post-edited text **remained stylistically closer to LLM text than to the
  participants' own unassisted writing.**
- It showed **reduced stylistic diversity** versus unassisted human text.
- And the dangerous part: it was **"often perceived as representative of
  participants' personal style despite remaining detectable LLM stylistic
  traces."**

**The generate-then-humanize workflow produces output that is still LLM-shaped
and feels like yours. You cannot self-assess your way out of it.**

**So a tool that scores and rewrites a finished artifact is operating at the
end of the pipeline where the evidence says the leverage is not.**

This is a real challenge to `ux-lint` and it should be recorded as one. The
partial defense: `ux-lint` refuses and names rather than rewriting, and
`ux-pick` is an upstream intervention. But "lint it afterwards" is not the
strong move, and the research says so.

## What the strong move is

**Condition on a narrow, specific corpus instead of prompting a general
model.** This is the largest measured effect in the escape literature.

arXiv:2510.13939, **28 MFA-trained readers and 516 general readers**, 50
award-winning authors:

| Condition | Fidelity (MFA readers) |
|---|---|
| **In-context prompting** of an off-the-shelf model | **0.16 odds ratio, strongly disfavored** |
| **Fine-tuned on the author's complete works** | **8.16 odds ratio, favored** |

Median cost **$81 per author.**

**That is `SYSTEMS.md`'s thesis, measured.** A real extracted design system is a
narrow corpus that *replaces* the model's prior rather than a prompt that
argues with it.

Robin Sloan's version, training an RNN on 150MB of pulp sci-fi:

> *"I am absolutely 100% not talking about an editor that 'writes for you.'"*
> *"like writing with a deranged but very well-read parrot on your shoulder"*
> **"The goal is not to make writing easier; it's to make it harder."**
> *"decisions about the collection and processing of the text corpus have been
> more consequential than decisions about the RNN's design"*

## The mechanism, quantified

There is now a **documented causal chain from human cognitive bias in
preference data to the median aesthetic**, and it is a sharpening operation.

**Step 1.** Fluent, familiar, prototypical things get rated higher. The
physical analogue: Langlois and Roggman (1990) composited 192 faces and **the
32-face composite was the most attractive of all.**

**Step 2. That bias enters the reward model as a measurable term.**
arXiv:2510.01171 formalizes an annotator's rating as

```
r(x,y) = r_true(x,y) + α · log π_ref(y|x) + ε(x)
```

true utility **plus a weight on how likely the base model already was to say
it**. Verified on 6,874 response pairs sharing identical correctness ratings:
**α̂ = 0.57 ± 0.07 and 0.65 ± 0.07, both p < 10⁻¹⁴.**

**Step 3. Optimizing against it sharpens the distribution.**

```
π*(y|x) ∝ π_ref(y|x)^γ · exp(r_true/β),   γ = 1 + α/β > 1
```

Raising a distribution to a power above 1 is exactly what temperature below 1
does. **Alignment is a permanent, baked-in low-temperature setting on the base
model's prior. Any α > 0 strictly sharpens, and you cannot sample your way out
of a change to the distribution itself.**

**Step 4.** On Tulu-3-70B, direct prompting retains **23.8%** of base-model
diversity. Verbalized Sampling recovers **66.8%**.

### The same conclusion, reached from the other end

**2026-09-22.** Thais Castello Branco of Taste Labs, in a conference talk
called "Ending AI Slop" ([corpus/video/transcripts/lCBf9slCanI.txt](../corpus/video/transcripts/lCBf9slCanI.txt),
Whisper transcription, see the ASR caveat below), states this section's central
claim in a sentence, with no maths on screen and no citation of any of the
literature above:

> "The reason why this feels like slop and that we have this feeling that we're
> surrounded by slop is exactly because of this collapse to the mean and this
> repetition."

And the premise it rests on:

> "The average, meaning the most likely, does not necessarily coincide with the
> optimal."
> "a lot of greatness in creativity happens actually at the ends of the
> distribution. It's not the most likely outcome."

**This file reached that from Holtzman, Meister and a measured α̂. She reached
it from building evaluation infrastructure and watching judges reward-hack.**
A theoretical result and a practitioner's operational diagnosis landing on the
same sentence, independently, is the strongest form this claim has been stated
in here, and it is why it is recorded rather than folded in as another citation.

**Four things she has that this repo does not.**

**1. The substitution move.** "Make it great" is unverifiable, and this repo has
been trying to verify it anyway. Her move is to route around the contest instead
of resolving it: "if I just ask you to be like, okay, create something great,
that's very hard. But suddenly if I'm like, okay, make something that is on
brand, that is a much easier problem to define, and a brand is something that
can become decomposable." The decomposition is colours, typography, motion,
animation, textures, and the critical detail is that the judge is asked per
element rather than holistically, because "Verifying in general of some things
on brand, and you can try this by prompting an LLM as a judge to do it, is quite
hard." The grader is then the decomposition, never the source artifact, so a
genuinely new page can still pass: "You don't necessarily want to just see if
it's replicating the original."

**2. Design standards expire and code standards do not.** "What is considered
good today is different than five years ago and different than five years from
now. In code, that's not necessarily true, or in math." Every value in
[data/constants.json](../data/constants.json) inherits this and not one of them
carries a date for decay. That is a defect in this repo, found by a video.

**3. Preference data collapses too, and the fix is a schema change.**
[research/13](13-empirical-aesthetics.md) diagnoses the multi-preference problem
and stops at "pick deliberately and say which." She proposes attaching a
preference vector to each rater so disagreement survives aggregation as signal:
"it doesn't mean that the best answer is the average of what two people might
like." And she partitions disagreement by layer, which is a better use of
[research/12](12-developing-taste.md)'s kappa instability than research/12
currently makes: disagreement on alignment is a data bug because alignment is
objective, disagreement on style "is not necessarily bad data. That's actually
good data."

**4. Breaking from the mode has to be steered.** This file already ranks
"randomise at the input, not the output" and notes that temperature is a
coherence knob. She adds the positive requirement in four words: "In a way
that's also intentional." That is the difference between `tools/stances.py` and
turning temperature up.

**Treat her as convergent testimony, not as evidence.** She gives no effect
size, no n and no baseline, she is describing her own company's method on stage,
and she has a commercial interest in the claim that this problem needs a data
vendor. She also never addresses the finding at the top of this file, that
post-editing fails invisibly, because her pipeline is entirely upstream of it.
The honest note there stands unchanged.

**ASR caveat.** The transcript is local Whisper on an accented speaker. Its body
contains zero digits, every quantity is spoken as a word, so no number from this
talk is quoted anywhere in this repo.

### Why the median is recognizable *as* the median

The formal answer predates the slop discourse by five years.

Holtzman et al. (ICLR 2020) established **the likelihood trap**: maximization
decoding produces degenerate text because **human text is not the most
probable text under a good model of human text.** Meister et al. (TACL 2023)
supply the positive account: humans produce strings whose per-word information
sits near the model's conditional entropy. **Natural language lives in the
typical set, not at the mode.**

**The average is not a member of the population.** A face averaged from 32
faces is more attractive than any of them and belongs to no one. A sentence at
the conditional mode is more fluent than most human sentences and was written
by no one.

### The same operation in images

**Classifier-free guidance is the diffusion analogue of the γ > 1 exponent.**
It is an explicit fidelity-versus-diversity trade, and every production
text-to-image product ships with guidance well above 1 because low-guidance
output looks "bad" to raters. Same bias, different medium.

## The loop that actually closed: humans

The finding I did not expect and the most important in the section.

arXiv:2409.01754: words preferentially generated by ChatGPT, **delve,
showcase, boast, intricacies, meticulous**, increased abruptly **in
spontaneous human speech.** A synthetic-control analysis of **737,083 hours of
conversation from 824,634 podcast episodes** causally links the shift to
ChatGPT's release. Plus a **preregistered experiment, n = 496**: a brief
chatbot interaction led participants to adopt its words, persisting past a
distractor task.

Matching the written record: 15 million+ PubMed abstracts, **at least 10% of
2024 abstracts LLM-processed, up to 30% in some sub-corpora.**

**The mechanism no longer requires training on synthetic data. The loop runs
through people.** Delve was a tell for six months and then became a word people
say out loud.

And the nuance that matters for tooling: **exposure diversifies, co-writing
homogenizes.** Ashkinaze et al. (800+ participants) found AI *exposure*
increased collective idea diversity. Doshi and Hauser (300 writers, 600
evaluators) found AI *co-writing* raised individual novelty **+8.1%** while
producing a **10.7% increase in similarity between stories.**

## Model collapse: real as a mechanism, contested as a prophecy

Shumailov et al., *Nature* 631 (2024): recursive training on generated data
causes irreversible defects **"in which tails of the original content
distribution disappear."**

**The honest caveat:** Gerstgrasser et al. show the result depends on synthetic
data **replacing** real data each generation. If data **accumulates**, which is
the realistic case since the pre-2022 web is not deleted, test error has a
finite upper bound and collapse does not occur.

**So do not write that the models will collapse. Write that the
verifiably-human fraction of the commons is fixed and recedes further into the
past each year.**

## What is common across every medium

Four candidate unifying properties, ranked by how much work they do:

1. **Sharpening.** Every distributional tell reduces to raising a learned
   distribution to a power above 1. **This is why the tell is always "too
   fluent," never "wrong."**
2. **Zero indexicality.** LLM output is **~66% more reconstructible** from
   existing web snippets than professional human writing (the Creativity
   Index). A photo of your kitchen carries information about *your kitchen*. A
   diffusion image of "a kitchen" carries information only about
   kitchens-in-general.
3. **Broken costly signaling.** Surface polish was always a costly signal of
   care. Generation makes polish free, so **polish stops carrying
   information.** This explains why detection is structurally doomed (the
   surface is precisely what got cheap) and why the affect is what it is:
   being handed slop is being handed a signal of care by someone who did not
   care.
4. **Asymmetric effort.** The reviewer always does more work than the
   generator.

**One sentence: slop is the conditional mode of a sharpened distribution,
published without review, whose surface polish no longer signals the effort it
used to signal.**

## The word, and why the original definition is better

Simon Willison, who put it in circulation:

> *"Not all promotional content is spam, and not all AI-generated content is
> slop. But if it's mindlessly generated and thrust upon someone who didn't ask
> for it, slop is the perfect term for it."*
> *"I attach my name and stake my credibility on the things that I publish."*

**His definition is about provenance and accountability, not aesthetics.** Two
conditions: **unrequested, and unreviewed.** A thing you asked for, that a
named person stands behind, is not slop no matter how it was made.

**That is the same reframe the prior-art pass arrived at independently:
provenance, not taste.**

Correction to a common premise: slop was **Merriam-Webster's 2025 word of the
year** (announced 15 Dec 2025) and the American Dialect Society's (9 Jan 2026).
2024 was polarization and brain rot.

## Detection does not work and the cost of pretending it does is real

**Theoretical ceiling** (Sadasivan et al., TMLR): `AUROC ≤ 1/2 + TV − TV²/2`.
**At TV < 0.2 even the optimal detector is below AUROC 0.7.** Recursive
paraphrasing took watermarking from 99.3% to **9.7%** TPR.

**The bias is structural, not a vendor bug.** Liang et al., *Patterns* 2023.
Seven detectors on **91 TOEFL essays: 61.22% average false positive rate**
versus **5.19%** on US 8th-grade essays. **19.78% unanimously misclassified by
all seven.** The signal detectors use is low perplexity, and **low perplexity
is what constrained second-language writing looks like.**

**What shipped and died:** OpenAI's classifier, 26% TPR / 9% FPR, shut down
after five months. GPTZero **no longer uses perplexity and burstiness**, the
two signals that made the category famous. Vanderbilt disabled Turnitin's
detector with the arithmetic that matters: *"Vanderbilt submitted 75,000 papers
in 2022. Around 750 student papers could have been incorrectly labeled."*

**The human cost, from Bloomberg:** a returning student, seven months pregnant,
zeroed on an assignment and now **screen-records herself writing**. A student
on academic probation for a year over Grammarly spell-check. A UCSD student who
spends most of his time tweaking wording **"in ways he thinks make the writing
sound worse."**

And Brian Phillips on the em dash, who calls himself "an enthusiastic advocate
of AI-shaming":

> *"the prevalence of em dashes in AI-generated text is a sign of how reliant
> the AI companies are on the human writers they want to replace."*

**Every stylistic marker of AI writing is a marker of good human writing that
got scraped. The dead-tell logic eats itself.**

**The one precedent that worked is not detection.** World Press Photo
disqualified ~20% of 2015 finalists, then published a code of ethics and
**required raw files.** Disclosure plus the original working file.

## The escape, ranked by evidence

1. **Condition on a narrow corpus.** 8.16 vs 0.16 odds ratio. The largest
   measured effect.
2. **Diversify the specification, not the output.** Intent Factored Generation:
   **high temperature on the intent, low temperature on the prose.** That is the
   inverse of what people do.
3. **Verbalized Sampling** if you want one prompt change: ask for a
   distribution. 1.6-2.1x diversity gain, and **more capable models benefit
   more.**
4. **Crank the constraint count.** Constraints make the memorized version
   illegal.
5. **Randomize at the input, not the output.** Temperature is **weakly
   correlated with novelty and moderately correlated with incoherence.** It is
   a coherence knob, not a creativity knob.
6. **Curate hard.** Human curation significantly moves whether people can spot
   AI output. Selection is the cheapest real leverage and nobody counts it as
   work.
7. **Put reality in the loop.** Why code is the medium where assistance works
   best: *"Agents lint. They compile and run tests."* Where no harness exists,
   **you are the harness**, which means the escape requires already knowing what
   good looks like.
8. **Supply the indexical content yourself.** Your value is the
   non-reconstructible part.
9. **Do not publish anything unreviewed.** Under Willison's definition this is
   not a mitigation, it is the exit.

### What does not work

**Editing the draft afterward** (section 1). **Temperature.** **Avoiding the
named tells**, because the tells are markers of scraped good human writing.
**Iterating with the model toward a better version**, because preference models
prefer convincingly-written agreement over correctness a non-negligible
fraction of the time.

**Prompting alone** sits on a genuine seam: Generative Monoculture found
prompting insufficient and the root causes "embedded within the alignment
processes"; Verbalized Sampling recovers 66.8%. **The honest reading is that
distribution-level prompting recovers a lot and not all, and the residue is in
the weights.**

## The counter-case, taken seriously

**Sturgeon, cited correctly:** he coined "ninety percent of everything is crud"
in 1957 **defending a disrespected medium against critics dismissing the
category by pointing at its worst examples.** That is precisely today's
rhetorical situation.

**People cannot tell.** Porter and Machery, *Scientific Reports* 2024, **n =
1,634, 16,340 judgements**, human out of the loop: accuracy **46.6%,
significantly below chance.** *"The five poems with the lowest rates of 'human'
ratings were all written by actual human poets."*

The authors' explanation is the part to quote: readers **"mistakenly interpret
their own preference for a poem as evidence that it is human-written."**
Preference for the mode, mistaken for preference for a person.

**Use it to kill "you can always tell." Do not use it for aesthetic parity,
which it does not support.**

**The historical pattern:** the ontological objection ("a machine did it, so no
one authored it") has lost in every forum that heard it, twice at a supreme
court. The imperial advocate in *Mayer and Pierson* (1862) argued a
photographer "remains completely a stranger to what is about to happen; the
light has done the work." That is word-for-word the 2026 brief against
prompting.

**And the displacement critics were right every time and nobody credits them.**
Royal Academy miniature portraits went from **over 300 exhibited in 1830 to 33
in 1870.** The AFM estimated **22,000 theatre-musician jobs** gone within three
years of *The Jazz Singer*.

**The case where the critics won outright**, which you should lead with when
someone says "they said that about photography too": Grand Upright (1991) and
Bridgeport (2005) did not ban sampling, **they priced it out of reach.** *Paul's
Boutique* cost over $250,000 in clearances in 1989 and is universally described
as unmakeable after 1991. **"New tools always win eventually" is not a law.**

### What is genuinely new

1. **Marginal cost is zero and the supply curve is vertical.** Clarkesworld,
   February 2023: **500 machine-written submissions alongside 700 legitimate
   ones in 20 days**, against a baseline of "never more than 25 spam
   submissions per month." **You do not get more crap in the same proportion.
   You get a denial-of-service attack on the filter.**
2. **The reviewer always does more work than the generator.**
3. **The harm is fraud and dilution, and that case is far stronger than the
   aesthetic one.** Deezer: AI is **>50% of uploads, 1-3% of streams, and up to
   85% of those streams fraudulent.** **82% of what ChatGPT and Perplexity cite
   is human-written.** Nobody is consuming the slop. That is both the best
   evidence against cultural apocalypse and the clearest statement of the real
   injury: a royalty pool diluted, a queue flooded, an editorial process DDoSed.
4. **Trithemius (1492) is undefeated:** *"What we write we imprint more
   forcefully on our minds."* **The strongest anti-AI position is not "the
   output is bad." It is "the output being good is exactly the problem, because
   the labour was the point."**

## Two notes for the build

**The Generative Monoculture and Verbalized Sampling results genuinely
disagree** about how much prompting recovers. Anything built here sits on that
seam and should say so.

**Given the post-editing finding, a de-slop engine that scores and rewrites
finished artifacts operates where the leverage is not. The measurable wins are
all upstream: narrow corpus, hard spec, diversified intent, aggressive
rejection.**
