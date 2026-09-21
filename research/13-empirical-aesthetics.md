# The experimental science of aesthetic judgment

Researched 2026-09-20. **Nine papers downloaded and read in full text.** The
rest are abstract-level and say so. Where a famous claim rests on something
unverifiable, it says so.

## The finding that is specifically about our problem

**Vary the surface so the output cannot be *named* as generated.**

Not because variety is good in itself. Because **the fluency-to-liking path is
severed the instant the viewer has an explanation for why it felt easy.**

The mechanism is a clean dissociation from Winkielman and Fazendeiro (2003).
Participants rated primed pictures under a cover story that background music
might affect them:

- Told the music might affect **how easily things come to mind**: the priming
  effect on liking **survived**.
- Told the music might affect **how they feel**: the effect was **eliminated**.

So the causal path is **fluency to affect to judgment**, and an available
external attribution cuts it.

Van den Bergh and Vrana found the same with repetition: liking rose through
nine exposures, and at 27 exposures rose further **only when repetition
salience was low**. When salience was high, **liking fell.**

**That is why "the AI look" converts from an advantage into a liability rather
than merely plateauing.** Generated pages are maximally fluent, which is an
asset, right up until the viewer can say *"that's the AI look."* At that moment
they have a name for their own ease, the attribution is cut, and the fluency
stops paying.

**The naming is the damage, not the repetition.**

## The numbers worth hard-coding

| Finding | Strength | Number |
|---|---|---|
| **Complexity has an inverted U, and the high side is far more punishing** | very strong | peak **4.2/10**, **d = 0.6** undershooting vs **d = 2.0** overshooting. N ~= 40,000 |
| Prototypicality raises aesthetic response | very strong | **η²p = .812** for websites |
| **Prototypicality's benefit is destroyed by clutter** | strong | **d = 1.96** at low complexity, **d = 0.24** at high |
| Mere exposure raises liking, then turns down | very strong | **r = .26** over 208 experiments, inverted U over 268 curves, saturating by 10-20 exposures |
| First impressions form before 50ms and do not improve with time | strong | effects at **17ms**; no main effect of exposure time on beauty |
| Optimum complexity is culture and age dependent | strong | peaks **2.5 to 4.8** by subgroup |
| Colorfulness matters less | moderate | peak **6.1/9**, d = 0.3 and 0.8 |
| **Golden ratio** | **effectively zero** | 130 years, no convergence |

**Overshooting complexity costs roughly three times what undershooting costs.
When uncertain, err simple.**

## Reinecke's model is the strongest evidence base in the field

Reinecke et al., *CHI 2013*: N = 548, 450 screenshots, 500ms exposure.
Colourfulness model **R² = .78**, complexity model **R² = .65**, appeal model
**adj. R² = .48**.

Reinecke and Gajos, *CHI 2014*, settles it at scale: **~40,000 participants,
2.4 million ratings, 430 websites.**

The 2013 paper is more careful than its reputation: *"a high visual complexity
results in the largest decrease in appeal, but websites with low levels of
complexity are similarly liked to those with a medium complexity."* **That is
not a symmetric inverted U. It is a cliff on the high side and a plateau on
the low side.**

**And a number that should keep anyone humble:** the 20 **Webby Award** sites
in the 2013 stimulus set averaged 4.21 to 6.57 on a 9-point scale against an
overall mean of 4.73, with an average **SD of 1.69**. Award-winning design is
not universally liked and between-person disagreement is enormous.

## The prototypicality interaction, which is the actionable one

Tuch et al., *IJHCS* 2012, n = 59, 119 real screenshots:

- Prototypicality: **η²p = .812**
- Complexity: **η²p = .581**
- Interaction: **η²p = .604**

**Prototypicality's effect is destroyed by high complexity: d = 1.96 at low
complexity, 1.79 at medium, and 0.24 at high.**

**You cannot buy your way out of clutter with familiarity.**

Best combination, stated by the authors: **low complexity plus high
prototypicality.**

### Which means the novelty budget has a correct place to go

Hekkert et al. (2003) on MAYA: typicality and novelty are **negatively
correlated with each other and both positively predict preference**, so each
one's true effect is hidden until both are entered. Jointly they explain
**56%** of preference variance.

**So: keep the layout archetype and affordance placement canonical, and spend
novelty on colour, type, motion and one surprising detail.** And never spend it
on a cluttered page, where it buys **d = 0.24**.

## The aesthetic-usability effect does not say what everyone thinks

Tractinsky (1997) is cited everywhere for **r = .921** between rated beauty and
rated ease-of-use.

**The unit of analysis is the design, not the person.** In the paper's own
words: *"Participant ratings were averaged to form an apparent usability and
an aesthetics score for each of the 26 designs."* **Every one of those
correlations is computed over n = 26 aggregated means.** Averaging across 104
raters strips within-person noise out of both variables and inflates the
correlation mechanically. The literature has treated it as a person-level
correlation for 29 years.

Three more things the original says that nobody repeats:

1. **No usability was measured.** The variable is *apparent* usability, rated
   from a static image of an ATM nobody used.
2. **The cross-cultural hypothesis was disconfirmed**, and he says so.
3. His own caveat, repeated in his 2013 retrospective: *"it is still premature
   to rule out the possibility of method variance as a major cause."*

### And the study that breaks it

Tuch et al., *CHB* 2012. **N = 80**, 2x2 between subjects, four versions of the
same working online shop, **real tasks**.

- **Interface aesthetics did not affect perceived usability.** Not before use,
  not after.
- **Interface usability did affect post-use perceived aesthetics.**
- **Fully mediated by affect.** Entering valence as a covariate, the effect
  vanished: F(1,75) = .084, p = .772.
- Only two aesthetic items moved with usability: **"clean" and "organized."**

**The authors reverse the slogan: "what is usable is beautiful."**

**So the defensible version is narrower: beauty buys a favourable pre-use
expectation and nothing after that.** And since the only aesthetic items that
moved with real usability were clean and organized, **visual order is the
shared currency between the two, not decoration.**

## The golden ratio: put nothing in the constants file

**Markowsky (1992)** went to Fechner's original: ten rectangles, modal ratio
.62, **but 76% of choices fell across three rectangles at .57, .62 and .67.**
His comment: *"can hardly be viewed as overwhelming evidence."*

**Green (1995)** is the *sympathetic* review by someone annoyed at sloppy
debunking, and its century-long ledger runs positive, negative, artifact,
restored, artifact again, with **Boselie (1992) finding 1.5:1 preferred over
φ**. Green's own conclusion: the effects *"may well be real, but if they are,
they are fragile."*

**130 years, no convergence, no modern effect size, and the best available case
is "fragile." Use a modular scale because consistent ratios raise fluency, and
pick any ratio. 1.5 and 1.618 are indistinguishable to viewers.**

## Symmetry is conditional on the viewer evaluating

Makin et al. (2016), N = 54, gaze-driven evolutionary algorithm:

- Told to seek symmetry: populations evolved far more symmetrical.
- Free choice of preferred pattern: clear shift, **but they tolerated
  imperfection**, settling around 0.5 degrees of deviation rather than perfect.
- **Free viewing with no instruction: essentially no shift.** About 6 of 18
  drifted toward symmetry and roughly as many toward randomness.

**Symmetry preference requires the viewer to be evaluating. It is not an
automatic pull on a passive glance.**

And the computational-aesthetics taxonomies do not earn their complexity:
Ngo's 14 measures and Miniukovich's 8 both stall around **R² = .49**, which
**two crude features (complexity and colourfulness) already reach.**

## Expertise: your evaluator is not your user

*"People without art training prefer simple and symmetric visual elements,
whereas people with art training prefer complex and asymmetric."* And **music
novices prefer prototypical chord progressions; experts do not.**

Quantified (N = 60, 20 experts): beauty **4.3 vs 3.8**, p = .001; expertise
correlated with beauty **r = .434**. But **no group differences on valence or
arousal.** Expertise drives the evaluative layer, not the affective one.

**So the gap is systematic and predictable: tune on designer ratings and the
generator drifts complex; tune on general-population ratings and it drifts
plain. Neither is neutral. Pick deliberately and say which.**

**And one procedural finding worth obeying:** Wilson et al. (1993) found
participants required to **explain why** they liked a poster later chose
posters they enjoyed less. **Do not have a model explain why it likes an output
before choosing it.**

## Processing fluency, honestly

Reber, Schwarz and Winkielman (2004) has **2,000+ citations and contains zero
sample sizes, zero F values, zero p values and zero effect sizes.** It is a
review, not an experiment, and nobody who cites it says so.

The unifying claim is a theoretical reading of phenomena that each replicate
well. The one clean mechanistic result is the misattribution dissociation
above.

Two boundary conditions that matter:

- **Objective simplicity is not cognitive ease.** The paper says so:
  *"Simplicity per se does not necessarily imply ease of processing."* Complex
  shapes with high redundancy are recognized faster than simple ones.
- **Fluency only produces a strong felt experience when it is unexpected.**
  Predictable ease is uninformative ease. The paper calls this a conjecture
  that *"awaits empirical testing."*

**So optimize for the felt ease of the first parse, not for objective
minimalism, and never hand the viewer an obvious explanation for why it was
easy.** A layout that reads instantly but is not visibly formulaic is the
target. A layout that reads instantly **and announces the template that made it
easy** gives away the attribution and cancels the gain.

## The three things a generator should change

1. **Cap complexity and err simple.** The penalty is asymmetric by roughly 3:1.
2. **Spend novelty only where it does not cost category recognition**, and
   never on a cluttered page, where it buys d = 0.24.
3. **Vary the surface so the output cannot be named as generated.**

## Unverified

Lindgaard's scale correlations circulating on secondary sites (unclear whether
r or r²). Kirk et al. 2009 fMRI sample sizes. *Symmetry* 12(5) 707 (MDPI 403).
UI-Bench numbers (PDF returned structural metadata only). Veryzer and
Hutchinson sample sizes (paywalled).
