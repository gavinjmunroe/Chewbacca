# Mathematics that earns a place in ux-engine

## Refuse these first

This is an admission decision for this repository and these captures, not a claim that the mathematics is useless elsewhere. “Deferred” still means **do not implement the metric now**. No new aesthetic score passed this survey.

| Technique considered | Decision and reason |
|---|---|
| Persistent homology | **Refuse.** No current decision depends on persistent holes or connected components across a filtration; choosing a filtration would introduce another unvalidated judgment. [Edelsbrunner, Letscher & Zomorodian, 2002](https://pub.ista.ac.at/~edels/Papers/2002-J-04-TopologicalPersistence.pdf). |
| Isomap / manifold learning | **Refuse.** No unresolved nonlinear prediction task justifies it after the existing decomposition. Rank 2.39 does **not** prove there is no nonlinear manifold; that suggested argument is mathematically invalid. Lack of demonstrated utility is sufficient. [Tenenbaum, de Silva & Langford, 2000](https://doi.org/10.1126/science.290.5500.2319). |
| Graph neural networks | **Refuse.** No labeled outcome, training population, or gain over explicit collision and motion relationships. Representing relationships as a graph does not require learned message passing. [Scarselli et al., 2009](https://doi.org/10.1109/TNN.2008.2005605). |
| Wavelets for carrier/envelope separation | **Refuse.** No measured failure of a windowed Fourier approach that requires multiresolution analysis. An elegant basis does not fix absent timestamps or confounded inputs. [Mallat, 1989](https://www.di.ens.fr/~mallat/papiers/MallatTheory89.pdf). |
| Fractal dimension | **Refuse.** No established scaling regime in these finite layouts; rasterization and zoom can drive the result, and no current decision needs it. [Mandelbrot, 1967](https://gis.humboldt.edu/olm/courses/gsp_510/Articles/Mandelbrot1967.pdf). |
| Independent component analysis | **Refuse.** Shared scroll input intentionally couples channels; no source-separation question is improved by imposing independent latent components. [Hyvärinen & Oja, 2000](https://www.cs.helsinki.fi/u/ahyvarin/papers/NN00new.pdf). |
| Nonnegative matrix factorization | **Refuse.** Residuals are signed. Shifting/splitting signs to fit the method has no demonstrated parts-recovery benefit here. [Lee & Seung, 1999](https://www.nature.com/articles/44565). |
| Saliency as “good hierarchy” | **Refuse.** Attention capture can be the distracting defect. No intended target or fixation observations establish the desired direction. [Itti, Koch & Niebur, 1998](https://hasler.ece.gatech.edu/Courses/MachineLearning/FoundationalPapers/Itti_Koch_Neiber1998.pdf). |
| Feature congestion as a shipped quality score | **Defer.** It addresses visual-search clutter, a real judgment, but these films lack matched scene rasters and target-search outcomes. A load screenshot is not a whole-film test. No two-film measurement was possible for the proposed task. [Rosenholtz, Li & Nakano, 2007](https://doi.org/10.1167/7.2.17). |
| Continuous collision detection | **Defer.** The films lack consistent viewport-aligned painted text rectangles and paint order. SVG-local bounds cannot safely substitute. No eligible protected-text intervals in either capture under that definition; this is missing data, not zero collisions. [Redon, Kheddar & Coquillart, 2002](https://doi.org/10.1111/1467-8659.t01-1-00587). |
| Minimum-description-length spacing inference | **Defer.** This could penalize trivial divisors with explicit model and integer-code costs, but the films do not record spacing tokens. No held-out spacing prediction or two-film result; do not replace the existing heuristic on theory alone. Compression also cannot establish designer intention. [Rissanen, 1978](https://research.ibm.com/publications/modeling-by-shortest-data-description). |
| Bayesian optimization of composition weights | **Refuse.** No validated external objective. A more efficient search would optimize the same unproved taste assumptions. [Shahriari et al., 2016](https://dash.harvard.edu/entities/publication/73120379-2b5e-6bd4-e053-0100007fdf3b). |
| FFT/Hilbert **scroll-modulated-loop score** | **Refuse for production now.** Measured modulated candidates: **0/70 reference, 0/290 replica** eligible visible channel-runs. The synthetic amplitude-modulation case passes, but the required film separation fails. Detail below. [Bedrosian, 1963](https://doi.org/10.1109/PROC.1963.2308). |
| Corpus surprise as “remarkable” | **Refuse now.** The 74 records contain no technique-incidence matrix, and rarity is not usefulness or quality. Missing mentions are not absences. [Shannon, 1948](https://doi.org/10.1002/j.1538-7305.1948.tb00917.x). |
| Fitts-law score for these scroll films | **Defer.** Neither contains pointer acquisition trials or specified targets. The two-film result is unavailable, not equal difficulty. [Fitts, 1954](https://doi.org/10.1037/h0055392). |
| Queueing / Little's-law performance score | **Defer.** No arrival/service timestamps or queue occupancy. Frame count cannot estimate latency or throughput. [Little, 1961](https://doi.org/10.1287/opre.9.3.383). |
| Control-system damping or settling-time score | **Defer.** No wall-clock timestamps, commanded-input trace, or controlled step response. Existing films cannot identify these parameters. [Ljung, 1999](https://www.control.isy.liu.se/books/sysid/). |
| Sequential testing as an automatic iteration winner | **Defer.** No independent repeated user outcomes or prespecified competing hypotheses. Repeated frames are not repeated users. A stopping rule cannot repair the missing experiment. [Wald, 1945](https://doi.org/10.1214/aoms/1177731118). |

The expensive mistake would be implementing every row with a plausible formula and calling the resulting dashboard perception.

## What was actually measured

Read first: `HANDOFF.md`, `bin/ux-modes`, `bin/ux-eye`, `bin/ux-derive`, `bin/ux-morph`, and `bin/ux-place`. Existing SVD, linear-response removal, JND scaling, assignment, Procrustes, Sobel, and composition optimization were not reimplemented as new contributions.

The experiment and outputs are [math_survey_experiment.py](math_survey_experiment.py), [math-survey-results.json](math-survey-results.json), and [math-survey-baseline.txt](math-survey-baseline.txt). The script is a research instrument, not a production tool. All numerical results below come from completed runs. Thresholds were fixed before the first candidate run; window matching was a declared sensitivity analysis, not an independent confirmation dataset.

**The historical replica fixture is not what is currently on disk.** Running the existing `ux-modes` reproduces the reference's 2.39 but gives the replica 1.38, not 1.01. I cannot honestly validate against the historical 253/253 result using this file. No attempt was made to tune a metric until the old numbers appeared.

| Current input / existing metric | `lenses/lemma-geo2` | `lenses/replica` |
|---|---:|---:|
| Frames / tracked elements | 1,885 / 260 | 2,600 / 260 |
| Scroll span | 16,952 px | 8,994 px |
| Positive scroll intervals | 1,884 | 1,499 |
| Zero-scroll intervals | 0 | 1,100 |
| Frames with a wall-clock timestamp | 0 | 0 |
| Existing moving channels | 774 | 1,421 |
| Existing residual effective rank | 2.39 | 1.38 |
| Existing distinct nontrivial rates | 7 | 13 |
| Existing highly correlated position pairs | 25,906 / 96,141 | 103,290 / 263,901 |
| Existing maximum reported “Lipschitz” | 20,705.99 | 76,264.45 |

SHA-256, recorded before experiments:

- Reference: `fe074d1a7f20783d31e0793c1e16867e27ecfd50d3c43c3cfbb5bc83ced60836`
- Replica: `b1df177eb809812ff018ab4e9cf5d2addfca2b88b3939f6531ab80dd31386364`

The current reference advances 9px per interval except its last 5px; the replica advances either 6px or 0px. Unequal scroll coverage, DOM composition, and stationary samples are confounders, not aesthetic evidence. The two pages are one exploratory pair, not a population of interfaces.

## Implementation decisions ranked by expected value

Only the first item is recommended for implementation now. The second is the nearest research candidate, with its admission limits made explicit.

### 1. Repair the derivative's domain before trusting its alarms

- **Computes:** Within each contiguous observed channel-run, remove `a+b*y` and compute finite differences only across distinct, adjacent scroll coordinates, an application of finite differences on arbitrary grids ([Fornberg, 1988](https://www.colorado.edu/amath/sites/default/files/attached-files/mathcomp_88_fd_formulas.pdf)), using the elementary two-point case rather than adding his higher-order algorithm.
- **Faked judgment replaced:** “The page jumps here.” A gap, repeated scroll position, or hidden element currently can help produce the number mistaken for that judgment.
- **Falsifier:** A static or pinned affine control still reports residual motion; inserting missing observations invents a transition; or an actual observed step disappears under the valid-domain calculation. Separation alone would not rescue any of those failures.
- **Cheapest experiment:** Run both supplied films with visibility/gone masks and `Δy>0`, retaining each run's support and per-interval channel denominator; then run static, pinned, known-step, missing-node, and duplicate-position controls. The film run is completed below; this is a correctness repair to existing math, not a new taste score.
- **Existing plug-in:** `bin/ux-modes`, specifically `build()` and the derivative block in `report()`; acquire timestamps and distinguish attempted from reached scroll in `bin/ux-crawl` for a later temporal derivative.

`Δx/Δy` at `Δy=0` is undefined. Substituting `1e-6` is not a physical measurement. Excluding that interval from a scroll derivative does not mean nothing happened: time-driven motion during a hold needs a separate `Δx/Δt` channel, currently unavailable.

Completed valid-domain measurements:

| Residual derivative diagnostic | Reference | Replica |
|---|---:|---:|
| Defined observed intervals | 1,884 | 1,499 |
| Maximum sum across eligible channels, normalized units/px | 39.8605 | 49.0363 |
| Median sum, normalized units/px | 1.1180 | 0.2379 |
| Maximum per-interval mean across eligible channels | 0.306505 | 0.139471 |
| Scroll location of maximum sum | 9px | 30px |

The denominator for each mean is the count of channels observed at both endpoints, not all tracked channels. Both sums and means are retained because channel count can reverse the apparent ordering. Synthetic static, pinned, general-affine, mount-gap and repeated-position controls all return maximum residual slope below `2.3e-13`; a 100-unit observed step survives at `98.8281`, and repeated positions contribute only 127 defined intervals out of 255. Those are tests of domain handling, not calibration against human judgments.

The measured values differ between the films, but are **not** intended to rank the better page. Visibility, support, local detrending, and derivative formula all change in this experiment; it does not isolate the cause of the old y=288 spike. An ablation holding the other choices fixed is needed to attribute that spike.

A maximum observed secant slope is not a proven continuous Lipschitz upper bound. A jump can occur between samples. Label it “maximum observed slope,” and preserve the location and support rather than claiming smoothness between observations.

### 2. Defer segmented regression; preserve the experiment

- **Computes:** A continuous hinge fit `a+b*y+c*max(0,y-k)` estimates a local change of slope, following segmented regression ([Muggeo, 2003](https://doi.org/10.1002/sim.1545)), with a fixed-grid knot search here rather than Muggeo's iterative estimator.
- **Faked judgment replaced:** “This element changes pace somewhere around here.” It supplies the channel, local interval, candidate knot, and prediction improvement over the existing straight-line response.
- **Falsifier:** Matched-span separation vanishes, a linear/noise control passes, held-out improvement disappears on another capture, or the candidate knot shifts materially under modest changes in sampling/window origin. No universal quality direction is asserted.
- **Cheapest experiment:** Match 1,152px windows and 128 samples using only shared `top`/opacity channels, fit on alternating contiguous blocks and predict the other blocks; compare with a straight line, linear/noise/entrance controls, and shuffled values. Completed: **56/178 = 31.46%** reference versus **53/345 = 15.36%** replica pass the declared criterion; shuffled controls pass **0/178** and **0/345**.
- **Existing plug-in:** Experimental output beside the rate field in `bin/ux-modes`, then per-channel evidence in `bin/ux-film`; no `design-gate` threshold.

This produces an interpretable research diagnostic, but **does not yet earn production implementation**. Whole visible-run analysis reverses the ordering: **37/70 = 52.86%** versus **258/290 = 88.97%**. At half frame density it remains **33/66 = 50.00%** versus **256/290 = 88.28%**. The reversal exposes dependence on the unit of analysis. Never market either direction as “better choreography.”

The declaration was: at least 128 observations, at least one normalized unit of variation, base held-out MSE greater than 1, held-out error reduction above 25%, and a BIC-like improvement above 10. Nine possible knots span the central 80% of the run. These are experiment heuristics, not perceptual laws. The code retains existing channel scales for comparability; their universal psychophysical validity is not established.

BIC's ordinary likelihood interpretation does not hold automatically for autocorrelated/interpolated frames ([Schwarz, 1978](https://doi.org/10.1214/aos/1176344136)). Here it is only a complexity penalty. Alternating-block validation evaluates interpolation within one trajectory, not independent generalization. Multiple descendants may share the same motion and windows overlap in represented content; 178 and 345 are opportunity counts, not independent binomial sample sizes. Shuffling is a weak null because it destroys smoothness. The smooth linear and known-entrance controls are more informative.

An additional equal-scroll-window weighting nearly erases the apparent separation: **26.15% versus 23.81%** mean acceptance across 14 versus 7 spatial windows. These are spatial bins, not independently labeled scenes. The replica has 209 of its 345 opportunities in a single zero-hit bin. This fails a robust-separation reading of the admission rule; preserve the experiment, do not ship the aggregate. Before promotion, use another capture, shift window origins, and aggregate by actual scene rather than cloned descendants. Do not fit the acceptance rule to those new outcomes.

## Open problem 1: modulated loops

**Verdict: spectral separation is a plausible component; “the fix is spectral” is incomplete, and the attempted metric failed the required film test.**

Use a model such as

`x(t,s) = m(s) + A(s) cos(phi(t,s)) + error`.

FFT peak evidence asks whether a carrier exists. The magnitude of an analytic signal can estimate an amplitude envelope when carrier and envelope spectra are appropriately separated; this is conditional on the signal, not guaranteed for arbitrary UI movement ([Bedrosian, 1963](https://doi.org/10.1109/PROC.1963.2308); [SciPy's Hilbert implementation and example](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.hilbert.html)).

The experiment uses visible contiguous runs, existing normalized numeric channels, a detrended Hann-window spectrum, at least six cycles, at least 55% energy in the five bins around the peak, a narrow carrier band, and one-period edge trimming. A modulated candidate requires envelope percentile range/median of at least 25% and absolute envelope/scroll correlation at least 0.8. This tests amplitude modulation only. It can miss nonlinear envelopes, frequency modulation, short loops, transforms not represented by those channels, and loops outside the tracked sample.

| Completed test | Reference | Replica |
|---|---:|---:|
| Eligible visible channel-runs, full density | 70 | 290 |
| Spectral carrier candidates | 2 | 0 |
| Modulated candidates | **0** | **0** |
| Eligible runs, half density | 66 | 290 |
| Modulated candidates, half density | **0** | **0** |

The carrier count separates; the requested compound does not. Do not substitute the easier count for success on the compound. Zero candidates do not prove absence on the page.

Synthetic controls are 1,024 samples, 16 cycles where applicable. The pure sinusoid is detected as periodic but not modulated; the amplitude ramp times a sinusoid is detected as modulated (`r=0.991`, envelope change `0.656`); linear drift, a one-shot entrance and seeded noise do not produce carrier candidates. Two steady carriers produce a beating envelope but fail the scroll-correlation criterion in this fixture. That last outcome is not protection against every beating configuration.

**Causality is unidentified.** Along a monotone pass, a time-only envelope can produce exactly the same sampled values as a scroll envelope. The same synthetic amplitude-ramp vector passes whether its generating variable is named time or scroll. No classifier can recover an unobserved distinction from identical input. The films have frame indices, not time; frequencies would be cycles/frame, never Hz. Replica's holds provide some variation in scroll/frame relation, but no controlled repeat or timestamps to identify the intended causal model.

The cheapest next experiment is three stationary-scroll holds long enough for several periods, followed by two timestamped traversals at different speeds. Include pure-loop, scroll-amplitude, time-amplitude, transient, and mount-gap fixtures. Check amplitude at the same scroll location under different elapsed times. Frequency/phase modulation requires separate phase analysis and its own controls. This is acquisition design from system identification, not a proposed validated metric ([Ljung, 1999](https://www.control.isy.liu.se/books/sysid/)).

### The correct label formalism

Use evidence-bearing factors, not a growing exclusive enum ([Tsoumakas & Katakis, 2007](https://people.iee.ihu.gr/~stoug/odep/papers/Multi-Label%20Classification:%20An%20Overview.pdf)):

```text
channel + observed interval
  driver membership: {time, scroll, state, unknown}
  form: {periodic, transient, stepped, affine, static, unknown}
  coupling: {amplitude, frequency, phase, offset}
  evidence: carrier, envelope, intervention, support, uncertainty
```

`scroll -> amplitude(time-periodic channel)` is a relation within one channel. A loop on opacity plus a separate scroll translation is coexistence, not proof of modulation. Return “periodic with scroll-associated envelope; driver unverified” until interventions resolve it. `SPAWN` is a lifecycle pattern; `STATE-SWAP` is a transition form; `CONSTANT` in current `ux-film` is a residual catch-all, not spectral evidence of looping. The current winner-takes-all choice across properties loses information before any spectral test runs.

This representation can preserve uncertainty immediately, but the requested detector has not earned implementation from these films.

## Open problem 2: does 74 support surprise?

`I = -log2(p)` computes self-information, not approval, beauty, or usefulness ([Shannon, 1948](https://doi.org/10.1002/j.1538-7305.1948.tb00917.x)). The strongest defensible phrase is “uncommon among eligible audited examples.”

The corpus has 74 static design summaries, 64 with parsed frontmatter, and **zero technique-incidence annotations**. Fields describe canvas, accents, radii, fonts, refusals and component counts. Sixteen records lack mode. A document not mentioning a motion technique is not an audited negative, and related brands are not necessarily independent samples. The two films do not have matching corpus labels, so their corpus-surprise scores are **unavailable / unavailable**, not fabricated numbers. This fails admission.

Even after labeling, rare estimates would be uncertain. The experiment calculates hypothetical binomial intervals, not observations of techniques in this corpus. Using a Jeffreys `Beta(1/2,1/2)` prior, the posterior is `Beta(k+1/2, 74-k+1/2)`; transforming its central 95% interval gives the following. See [Brown, Cai & DasGupta, 2001](https://doi.org/10.1214/ss/1009213286) on binomial interval estimation.

| Hypothetical count | Plug-in bits `-log2(k/74)` | 95% posterior probability interval | Corresponding surprise interval, bits |
|---|---:|---:|---:|
| 0 / 74 | Undefined / infinite | 0.00000661–0.03326 | 4.910–17.206 |
| 1 / 74 | 6.209 | 0.001462–0.061414 | 4.025–9.418 |
| 2 / 74 | 5.209 | 0.005658–0.083876 | 3.576–7.465 |
| 5 / 74 | 3.888 | 0.026248–0.141742 | 2.819–5.252 |
| 37 / 74 | 1.000 | 0.387913–0.612087 | 0.708–1.366 |

For zero occurrences, the posterior combines the prior with the likelihood of 74 non-occurrences; its positive lower probability endpoint and finite upper surprise depend on the prior, not an observed rare occurrence. A frequentist zero-count bound instead allows arbitrarily large surprise. Singleton versus doubleton ranking is unjustified precision here. Broad common-versus-rare bins could be useful after consistent annotation. These intervals assume exchangeable observations and do not fix biased selection, correlated brands or extraction errors.

If the target is only the 74 documents, audited counts form a census; there is no sampling uncertainty about that finite set, but annotation uncertainty remains and nothing generalizes automatically to interfaces. If the target is a wider population, the sampling mechanism needs justification. Simply computing more decimal places is theatre.

The cheapest restart is a prespecified three-technique audit of 20 randomly selected corpus entries, labeled twice as `present`, `absent`, or `unobservable`, with evidence spans. Report disagreement and eligible denominators. Reopen implementation only when those annotations and two-film incidence observations exist, then test against independently collected unusualness judgments. The future connection would be `tools/extract.py` to `bin/ux-film`; no new production score is recommended now.

## Coverage of the requested fields

| Field | What could replace a real judgment | Outcome here |
|---|---|---|
| Psychophysics and vision | Feature congestion for target-search difficulty; Fitts for acquisition time | Neither has the task observations to pass. Existing JND/ink thresholds are not universal taste laws. |
| Signal processing | Carrier/envelope decomposition; local regime changes | Compound-loop metric fails 0 versus 0; hinge separation weakens sharply under equal-window weighting. |
| Optimization | MDL model choice; constrained objectives; Bayesian search | Spacing data absent; searching an unvalidated energy more efficiently is not progress. |
| Linear algebra beyond SVD | ICA, NMF, alternative latent components | No downstream decision improves; refuse. |
| Probability and statistics | Held-out prediction, uncertainty intervals, sequential iteration decisions | Prediction is exploratory; intervals expose limits; no repeated trial outcomes for sequential tests. |
| Information theory | Self-information of audited technique incidence | Missing labels and unstable rare probabilities prevent admission. |
| Computational geometry | Continuous protected-text collision detection | Required geometry absent; don't mix coordinate systems to manufacture a result. |
| Control theory / performance | Excited-input identification, settling/lag, queue load | Need timestamps and controlled inputs. Existing film frame counts cannot measure elapsed performance. |

## Existing claims that need narrower names

These are source-level observations, not newly implemented changes:

- `ux-modes.effective_rank()` computes `exp(entropy(normalized squared singular values))`. Its docstring calls that a participation ratio, but participation ratio is `1/sum(p**2)`. Preserve the measured function; correct the label before comparing numbers across definitions.
- Miller's memory-span result does not establish a universal ceiling on animation matrix rank or a seven-mode taste threshold. High common motion correlation also does not, alone, prove the eye binds DOM elements into one perceptual object.
- `ux-modes.build()` comments say “carry last seen,” but `np.interp` linearly bridges internal missing spans. Visibility is not consulted there. These are distinct choices requiring explicit support masks.
- `ux-eye`'s fixed ink, centroid and squint thresholds describe local heuristics, not universal perception laws. A centered page can be confusing; a deliberately asymmetric page can be clear.
- `ux-derive` can test regularity. It cannot infer that an off-lattice value was unintended, or that an on-lattice value was intentional.
- `ux-place` uses independent random starts with `minimize`, not basin hopping's accept/reject chain. Its “hard” text corridor is a finite penalty. Its depth term depends on fixed sizes/index order, not optimized positions, so that term cannot alter the solution. Adding another optimizer does not repair those definitions.

## Reproduction and limits

Run one local numerical job at a time:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 \
  python3 bin/ux-modes lenses/lemma-geo2 lenses/replica
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 \
  python3 research/math_survey_experiment.py > work/math-survey/recheck.json
```

Check each process's exit code directly. No `timeout` command and no output pipe was used to infer success. Two source-research branches fed one experiment owner; a separate verifier checked formulas, denominators and fixture hashes. The verifier caught the need to distinguish a raw-channel derivative from a residual derivative; the final experiment removes each visible run's linear response. This does not make its comparison with the old global calculation a controlled causal ablation.

Confidence is high in the missing-data/timestamp findings and the refusal of an unlabeled corpus score; low in generalizing any new page-level statistic from this pair. The known-better designation is supplied by the task, not independently established here. No new aesthetic metric is ready for `design-gate`, and the historical replica would need to be recovered before claiming replication of the handoff's exact experiment.
