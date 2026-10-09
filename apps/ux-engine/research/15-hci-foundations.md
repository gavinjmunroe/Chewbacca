# The empirical foundations of interface design

Researched 2026-09-20, 142 tool calls, primary papers obtained and read rather
than summarized. Several scanned pre-1970 journals were recovered by OCR.

**This pass corrected an error already shipped in this repo.** See section 1.

## 1. The correction: Miller 1968 does not say 0.1 / 1 / 10

**That triad is Jakob Nielsen (1993), *Usability Engineering***, citing Miller
1968 **and** Card, Robertson and Mackinlay (1991).

**Miller's own numbers are 0.1, 2, 4 and 15 seconds, given per task type across
seventeen task types.** And the paper opens by arguing against exactly the
thing it gets cited for:

> *"Two major semantic issues prohibit resolving this controversy. One issue
> centers around the question of 'Response time to what?' ... **It will be
> shown that 'two-second response' is not a universal requirement.**"*

And on their status, verbatim, under his own heading "Basis of response-time
estimates":

> *"The estimates of delay times offered in the following pages are **the best
> calculated guesses by the author**, a behavioral scientist... **They should,
> indeed, be verified by extended systems studies** — not in artificial
> laboratories using abstract tasks."*
> *"the reader should accept the parameters cited as **indicative rather than
> conclusive**."*

**An earlier version of `constants.json` and `research/02` told the reader to
cite the triad to Miller and NOT to Nielsen. That was backwards and it has
been fixed.**

### What Miller actually claims, which is better than the triad

**The curve is not a slope.**

> *"There is not a straight-line decrease in efficiency as the response delay
> increases; rather, **sudden drops in mental efficiency occur when delays
> exceed a given point.** These sudden drops can be thought of as
> **psychological step-down discontinuities.** Thus, a ten-second response
> system may be no better for the human than a one-minute response."*

**And the mechanism is closure, which is the genuinely useful part:**

> *"humans spontaneously organize their activities into clumps that are
> terminated by the completion of a subjective purpose... **The rule is that
> more extended delays may be made in a conversation or transaction after a
> closure than in the process of obtaining a closure.**"*

**Past 15 seconds, stop trying to hold them:**

> *"response delays of approximately 15 seconds, and certainly any delays
> longer than this, rule out conversational interaction... the system had
> better be designed to **free the user from physical and mental captivity**."*

Selected per-task limits: control activation **0.1s**, keyboard echo
**0.1-0.2s** (with the note that the mechanical pipe organ had 0.1-0.2s delays
and organists adapted), routine request **2s**, complex tabular inquiry **4s**,
frame advance in a viewing series **2s**, graphic manipulation of dynamic
models *"not even readily conjectured."*

## 2. Fitts's law, from the 1954 paper

**Fitts never writes `MT = a + b·ID`. There is no intercept in Fitts 1954.** He
computes throughput by direct division, assuming zero intercept.

**And the factor of 2 is a fudge, which he says twice:** *"The choice of the
denominator for this index is arbitrary... Its use insures that the index will
be greater than zero for all practical situations."*

### Use the Shannon form

| Form | Equation | Problem |
|---|---|---|
| Fitts 1954 | `a + b·log2(2A/W)` | **goes negative when A < W/2**, which happens in real published data |
| Welford 1960 | `a + b·log2(A/W + 0.5)` | |
| **Shannon (MacKenzie 1989)** | **`a + b·log2(A/W + 1)`** | **ID cannot be negative** |

MacKenzie's reason: Fitts cited an approximation of Shannon's theorem
*"originally introduced with the caution that it is useful only if the
signal-to-noise ratio is large... **Fitts' experiments extended the A:W ratio
as low as 1:1!**"*

### The 2D rule: W = min(width, height)

MacKenzie and Buxton 1992, N = 12, five candidate models:

| Model for W | r | IP |
|---|---|---|
| **SMALLER-OF = min(W,H)** | **.9501** | 6.0 b/s |
| W' (along approach axis) | .9333 | 6.3 |
| W+H | .8755 | 4.6 |
| W x H | .8446 | 5.8 |
| **STATUS QUO (horizontal W)** | **.8097** | 7.4 |

**Use `min(width, height)`.** It fits best and needs no approach angle.

### The famous 10.3 bits/s for a mouse is wrong

Card, English and Burr 1978 claimed **10.3 bits/s**. Re-analysed to ISO 9241-9
by MacKenzie, Kauppinen and Silfverberg (CHI '03): **2.65 bits/s**, or **4.32**
after subtracting a nominal grasping time, *"a value typical in
ISO-conforming studies."* Modern ranges: **mouse 3.7-4.9 b/s**, touch up to
**~6.85**.

### Screen edges: the most-repeated and least-supported claim in HCI

**The formal justification is wrong.** "W = infinity so ID = 0" is only
derivable under the STATUS QUO horizontal-width model, **which is the
worst-fitting of the five**. Under SMALLER-OF, a menu bar's ID is set by its
20px height and the unbounded dimension is irrelevant by construction.

The empirics, such as they are:

- **Walker and Smelcer 1990/1991**, the origin, has **no recoverable numeric
  effect size** in the paper or in any citing paper. **[UNVERIFIED]**
- **Appert et al. 2008** state the claim *"has never been empirically
  tested"* and test it (N=8, 8,064 trials). The benefit runs from **-278ms
  (44.6% faster) at orthogonal approach to +33ms (nominally slower, CI crosses
  zero) at ±90 degrees.** Recommendation: **put edge widgets near the centre of
  their edge.** Corners untested.
- Magnitude is disputed 3x: **283-393ms and distance-dependent** (Farris et
  al.) versus **"typically 100 ms, independent of the ID"** (Dizmen et al.,
  N=71, the largest sample). Nobody has reconciled them.
- **Touch inverts it.** Usuba et al. (2023), 89,856 + 75,456 crowdsourced
  trials: increasing the gap **decreased both movement time and error rate**;
  at W = 4mm mean error was **23.71%**. Guidance: make edge targets **>= 12mm**.
- **Multi-monitor edges are a penalty.** Fitts's law may **underestimate** the
  difficulty of monitor-crossing motion.

### Where it fails

**Low ID** (Fitts's own ID=1 condition is **3.4 SD below his mean IP**).
**A and W are not symmetric** and the direction of the asymmetry is
unresolved. **Finger touch on small targets** needs FFitts (endpoint
distribution is a *sum of two normals* with an absolute-precision term
σa = **0.94mm 1D, 1.5mm 2D**; error rates hit **38% at W=2.4mm** and ordinary
effective-width adjustment makes the fit *worse*). **The intercept is
uninterpretable** because IDs run on non-ratio scales. And MacKenzie's own
verdict: *"Fitts' law remains an analogy waiting for a theory."*

## 3. Hick's law, and why citing it for menus is backwards

**Hick 1952 never writes `RT = a + b·log2(n)`.** His fit is
`RT = 0.518·log(n+1)` in base 10, about **156 ms/bit**.

**Subjects: Experiment 1 was n = 1. Hick himself.** Experiment 2 was n = 2, one
of whom was again Hick.

**On the "+1", verbatim:** *"**At this stage, the writer made a guess** that the
possibility of 'no stimulus' was treated by the subject as if it had the same
probability as any particular stimulus."*

**Hyman 1953** (4 undergraduates, >15,000 trials) got r = .938-.985 and slopes
**127-215 ms/bit**. **And his own stated limit is the one that matters:**

> *"we **cannot predict, on the basis of the regression line fitted to the means
> of the conditions, what the mean reaction times will be to the components
> which make up a condition.**"*

**Hick-Hyman is a block-level aggregate law. It never predicted the time to
pick a specific item**, which is the only prediction a generator wants.

### It flattens, and sometimes reverses

Proctor and Schneider (2018): *"**the slope of the function can vary between
zero and several hundreds of milliseconds.**"* Flat with high
stimulus-response compatibility; Lawrence (2010) found a **reversed**
"anti-Hick's effect" for saccades. With practice, slopes fall from **73 to 23
ms/bit**. Beyond ~8 alternatives it goes flat (Longstreth: *"Hick's law: Its
limit is 3 bits"*).

### Menu search is LINEAR, and this is measured

Sears et al.'s critique: Hick and Hyman *"timed decision time **in response to
clear visual stimuli**."* Visual search is serial, which yields a **linear**
function.

| Study | Finding |
|---|---|
| **Nilsen 1991** | Random menus: `MT = 515.8 + 116.7 x (item position)`, **r² = .99**. *"Fitts' law applies quite well when subjects know the location... **It does not apply when substantial visual search is required.**"* **~125 ms/item.** |
| **Byrne et al. 1999** (eye tracking) | Replicated linear at **~75 ms/item**. *"Users clearly have a non-random preference for the first three menu items."* |
| **Cockburn et al. 2007** | Both regimes in the same participants: **random menus `0.08n + 0.30`, LINEAR, r² = .99**. **Static and familiar: `0.08·log2(n) + 0.24`, LOG, r² = .98.** |

**Random menus have learnability L = 0, so they never leave the linear regime
no matter how much practice accrues.**

### And the formal kicker: Hick's law argues AGAINST splitting menus

Liu et al. (CHI '20) measured Hick slopes in real HCI tasks at **4 to 32
ms/bit** against Hick's own ~156, and concluded *"in practice, reaction time
can usually be treated as a constant."* Then, with 32 items:

```
one page:            RL = a + 5b
4 random pages:      RL = 2.5a + 7.5b
4 categorized pages: RL = 2a + 5b
```

> *"the optimal strategy according to Hick's law consists of **displaying all
> the items at once on the same page**, contrary to the design principle that
> choices should be categorized."*

Their diagnosis of the field: *"a very unfortunate **conflation between the
formula and the law**."*

## 4. KLM operator times

| Op | Value | Note |
|---|---|---|
| **K** keystroke | **0.28s** average non-secretary | 0.12 good typist, 0.20 skilled, 1.20 worst |
| **P** point | **1.1s** (0.8-1.5) | **Does not include the button press** |
| **B** button press or release | 0.1s | **BB** click = 0.2s |
| **H** home hands to device | **0.4s** | |
| **M** mentally prepare | **1.35s** (CMN) / **1.2s** (Kieras, revised) | |
| **W(t)** wait | measured | counted only when the user must wait |

**CMN's own validation: RMS error 21%** of average predicted time for a single
task, falling to ~9% over a five-task benchmark. Their scope statement:
*"limited to **error-free expert behavior**."*

### The number that should stop anyone using GOMS on a generated layout

Kieras and Hornof (CHI '14, Best Paper):

| Model | R² | Avg absolute error |
|---|---|---|
| **Standard GOMS (constant Look_for)** | **0.0** | **80%** |
| GOMS + acuity function | 0.91 | 26% |
| Full EPIC | 0.98 | 9% |

*"The standard GOMS model produced a short constant RT of 1.92s regardless of
the precue specifications... **The model is seriously inaccurate.**"*

**That R² = 0.0 regime is exactly what a freshly generated layout creates:** a
screen where the user has to *find* the control.

**Project Ernestine** remains the only real-world validation and the best story
in HCI: a naive keystroke count predicted the new workstation would be 18.6%
faster, *"wrong in both magnitude and sign."* CPM-GOMS predicted **0.63s
slower**; the field trial of 72,390 calls measured **0.65s slower**, costing
NYNEX *"almost $2 million a year."* NYNEX did not buy the workstations.

## 5. Steering law

**Accot and Zhai 1997.** A path you must stay inside costs `A/W`, **not
`log2(A/W)`.**

```
Straight tunnel:  MT = a + b·(A/W)
General:          T = a + b · ∫ ds/W(s)
Local:            v(s) = τ · W(s),   τ ≈ 50-70ms
```

Fits r² = .968 to .987. **But error rates were 6.4% to 18%**, and the authors
flag it: *"Modeling error rate as a function of task difficulty should be
conducted in future studies."* 18% is not a usable operating point. Stylus on a
tablet only; curvature is not in the model.

**So a cascading submenu or a narrow scroll rail scales linearly in length and
inversely in width. A log intuition underestimates the cost badly.**

## 6. Miller 1956 is about six categories, not seven items

**Two different limits, and he spends the paper insisting they are different:**

- **Span of absolute judgment**: how many levels of **one sensory dimension**
  you can label. *"the mean is 2.6 bits and the standard deviation is only 0.6
  bit."* **That is about six categories.**
- **Span of immediate memory**: about seven **chunks**, and **independent of
  bits per chunk**.

> *"In spite of the coincidence that the magical number seven appears in both
> places, the span of absolute judgment and the span of immediate memory are
> **quite different kinds of limitations**."*

**Neither is a menu-length limit.** A menu is on screen; nothing is being held
in memory. Cowan (2001) revises the memory span to **4±1** anyway.

## 7. Recognition versus recall: the heuristic has no memory-experiment behind it

The picture-memory results are real: Standing (1973) **83% raw accuracy at
10,000 pictures**; Brady et al. (2008) **87.2-92.5%** across 2,500 objects with
**~14,000 to 228,000 unique codes** of detail.

**But Brady's own boundary condition is the whole ballgame:** *"whereas in
everyday life we may often fail to encode the details of objects or scenes,
our results suggest that **under conditions where we attempt to encode such
details**, we are capable of succeeding."*

**And Nielsen's heuristic does not descend from any of it.** His own account of
the 1989 list: *"it wasn't the result of a systematic research process, other
than sitting around a table and talking."* The 1994 revision came from a
**factor analysis of 249 usability problems against 101 principles**. Shepard,
Standing and Brady appear nowhere in its lineage; they were attached later as
post-hoc justification.

**And the direct HCI evidence cuts the other way for experts.** Marking menus:
*"using a mark on average was **3.5 times faster** than selection using the
menu."* CommandMaps: no difference for novices, **significantly faster for
experienced users.**

**So: pair every recognition affordance with a recall accelerator**, a stable
shortcut or a spatially fixed position, rather than treating visibility as the
whole answer.

## 8. Change blindness, with the numbers that should scare a generator

- **Simons and Levin 1998, the door study:** an experimenter asking for
  directions was **physically swapped** behind a carried door. **Only 7 of 15
  (46.7%) noticed.** In a second version, **4 of 12 (33%).** And they read the
  scenario to a class of 50 students: *"By a show of hands, they claimed
  **without exception** that they would detect the change."*
- **Simons and Chabris 1999:** overall **46% missed the gorilla**. Even in the
  fully realistic single-camera condition, **33% missed it.**
- **Mack and Rock:** at fixation, inattentional blindness **more than doubles**,
  *"between 60% and 80% of the observers failed to detect it."* With learned
  inhibition plus narrowed focus, *"**IB is virtually 100%.**"*
- **Bravo-Lillo et al. 2013**, 872 participants: the salient field silently
  changed to *"Press the No option below to finish this study early."*
  **58-64% of users never noticed**, forgoing an early finish at the same pay.
- **Akhawe and Felt 2013**, **25,405,944 warning impressions**: **47% of
  clickthroughs happened within 1.5 seconds**, and *"For Mozilla Firefox
  warnings, **0 users clicked on 'Technical Details'**."*
- **Burke et al. 2005:** banners were fixated on only **11.7%** of trials, and
  *"participants did not directly look at **93.9%** of the banners they
  'remembered'."* Animated banners were remembered **worse than their own
  static frames** (d' = -0.07, not above chance). Their warning: **"Designers
  should be wary of habituating viewers to predictable banner locations."**
- **Boger et al. 2021**, scatterplots where ignored marks formed a dinosaur: at
  1,000ms per plot, **14 of 15 (93.3%) missed it.** *"visualization designers
  cannot assume that the same patterns that are salient to them will be salient
  for other viewers."*

**So: never make a change the only signal that something happened; never put
load-bearing information behind a disclosure control; and do not put
notifications in a fixed conventional slot, because location habituation is the
measured mechanism by which users learn not to look there.**

## 9. Latency thresholds are not one number

| Condition | Threshold |
|---|---|
| Direct touch **dragging** | **11 ms** |
| Direct touch **tapping** | **69 ms** |
| Indirect dragging | 55 ms |
| Indirect tapping | 96 ms |
| Collapsed | **direct 40ms, indirect 75ms** |

Jota et al. (N=45, 12,960 trials): **1ms vs 10ms was not significantly
different**; every other pair was. *"performance appears **little advantaged by
latencies much lower than 25 ms**."*

**And the baseline you are working against:** Casiez et al. measured end-to-end
desktop latency at **47.5 to 67.6 ms**, of which **the screen stage alone is
37.8-45.1 ms**. **Your generated code owns roughly 12ms of a 48-68ms budget.**

### The finding that inverts the latency rule for generative UIs

**Tan et al., CHI '26**, 240 participants, time-to-first-token 2s / 9s / 20s:

- **Behaviour was robust to latency.** No significant effect.
- **Perception ran backwards.** Thoughtfulness F(2,234) = 5.12, p = .007:
  **2s (M = 5.76) was rated LESS thoughtful than 9s (6.09) and 20s (6.11).**
  Usefulness: **9s rated more useful than 2s**, p = .021.
- 140 of 240 noticed a delay and **attributed it to AI deliberation.**

**So do not assume the touch-latency literature transfers. Making a generative
response faster made people rate identical output less thoughtful and less
useful.**

## 10. Mode errors: the one place with a clean design answer

Sellen, Kurtenbach and Buxton 1992. Mode switching by **keyboard** versus a
**held sustain pedal**, with and without visual feedback:

| Expert mode errors | kbd, no visual | kbd + visual | **pedal** |
|---|---|---|---|
| Mean | **8.0** | 4.5 | **2.6** |

**Kinesthetic feedback cut expert mode errors 67%. Visual feedback alone cut
them 44%.** Omega-squared: mode-switch method **15.6%** of variance, visual
feedback **4.8%**. Roughly **3:1 in favour of the physical channel**.

Experiment 2 isolates the mechanism: a **latching** pedal performed no better
than the keyboard. *"**user-maintained mode states prevent mode errors more
effectively than system-maintained mode states.**"*

Counterintuitive and worth keeping: **experts made more mode errors than
novices.**

**And Norman's finding on confirmation dialogs, which is the sharpest thing
here:**

> *"if confirmation is routinely asked for (and if the usual response is
> 'yes'), **the confirmation itself becomes an automatically invoked component
> of the command sequence.** Thus, if the command is given in error, it is
> likely to have the confirmation invoked as part of the same error."*

**A mode the system paints is worth about a quarter of a mode the user
physically holds. And a routine confirm dialog does not protect anything.**

## What could not be obtained, and one warning

**Landauer and Nachbar 1985** full text (ACM 403). The famous **"breadth of 8
is optimal" could not be traced to the paper** and is **[UNVERIFIED]**.

**Walker and Smelcer 1990/1991**: no numeric effect size for the infinite-width
claim exists in any source.

**Reason (1990), *Human Error***: not obtained. **The 61/27/11
skill/rule/knowledge split is [UNVERIFIED]**, traces only to a lecture slide,
and the three figures **sum to 99%**.

⚠️ **And a warning worth propagating:** the archive.org item labelled *"Human
Error / James T. Reason / 1990"* **is not Reason's book.** It is Shappell and
Wiegmann's FAA HFACS report with "HFACS" find-replaced by "Human Error" and a
CUP 1990 copyright page pasted on. **Since archive.org feeds training corpora,
any "Reason 1990" quote describing aviation unsafe-acts categories is likely
laundered from that file.**

**Norman 1981** contains **no frequency data at all.** Anyone citing it for a
rate is citing something that is not there.
