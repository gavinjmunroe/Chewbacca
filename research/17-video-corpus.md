# 17. The video corpus

**Built 2026-09-22.** Caleb sent two YouTube videos on how to think like a
designer and asked for a lot more like them. What came back is 94 videos, 89
transcribed, mined by six parallel passes into
[video-findings/](video-findings/), where every rule carries a video id and a
timestamp.

This file is the synthesis. It is organised around the only three questions
that change what this repo does: **what the corpus agrees on, what it
contradicts itself about, and what it says about acquiring taste rather than
applying it.**

## Method, and its limit

Forty-two `yt-dlp` search queries returned 573 unique videos. Filtering to
topical relevance left 380, from which 108 were selected across four tiers and
transcribed. Eight had no captions and went to local Whisper. One (`EbYH9j5NTsw`)
turned out to be Human Design astrology that matched on the word "taste" and was
dropped.

**The limit is stated up front because it decides how these rules are allowed to
be used.** [COVERAGE.md](../COVERAGE.md) sets this repo's bar: reading source and
counting things beat reading articles, every time. A video is a practitioner's
claim. Almost none of it was measured by the person saying it, and exactly one
source in 89 cites where his numbers came from (Tim Gabe, who measures Google,
Dropbox and Uber before giving a line-height range, and attributes the 50-to-75
character measure to Baymard).

So nothing here is allowed to block. In `ux-lint` terms every rule below is
HOUSE at best, and most are weaker than that: they are hypotheses with a
timestamp, useful for deciding what to go and measure.

## Was this worth doing

The falsifier set before building: **if the extracted rules turned out to be
things this repo's research already said, in the same words, then YouTube was
the wrong source and the corpus is padding.**

Checked against the existing research files. Already present: Artman
([research/02](02-product-ux-canon.md)), the Doherty threshold
([data/constants.json](../data/constants.json)), the 8pt grid
([research/04](04-constraints-and-tells.md)), x-height
([research/15](15-hci-foundations.md)). **Absent:** Quality Wednesdays, the
alphabet audit, the ranking-with-eviction mechanism, the create-to-consume
ratio, the three-year-old-work diagnostic, and the sourced origin of the indigo
tell. [research/12](12-developing-taste.md) covers deliberate practice,
critique, constraints and subtraction neglect, and none of the six mechanisms
just listed.

Not falsified. The corpus is additive, and it is additive in the half this repo
was weakest on, which is acquisition rather than application.

## What it changes here, in order of how much

### 1. Every rule needs a ceiling, and none of them has one

Apple's WWDC principles talk is the only source in the corpus that caps its own
advice, and it caps all of it at once ([Sv3G3z6WzxU, 57:22]):

> "It is also possible to have too much of a good thing. Too much feedback is
> annoying. Too much visibility is distracting. Too much progressive disclosure
> can make work flows inefficient."

Every rule in `ux-lint` has a floor and no upper bound. That is a real defect and
it is the same defect that produces the generated look: a page that applies every
good rule at maximum reads as generated, because nothing told it when to stop.
The same talk holds both sides of the conflict without resolving it, saying at
21:23 that hiding status "would greatly reduce usability" and at 49:56 that
hiding 80 percent of functions is fine.

### 2. The indigo rule gets a source

This repo has flagged indigo and violet gradients on its own authority. Tailwind's
founder, quoted in `NNv80mMzFDs` at 2:19:

> "I would like to formally apologize for making every button in Tailwind UI
> Indigo five hundred five years ago, leading every AI-generated UI on Earth also
> being Indigo."

A dated cause from the person responsible. That moves the rule from house opinion
to sourced, and it explains the mechanism: the tell is not that indigo is ugly, it
is that one default propagated into the training data.

### 3. A tool and a marketing page do not share a deny list

The clearest statement of a split this repo does not currently make, from
`XZf5A0wcruE` at 7:06 and 18:57:

> "tools should be simple easy straightforward and sometimes even a little bit
> more boring"
> "the tool is serving the content the tool is not serving the brand"

`ux-pick` already splits instrumental from expressive briefs. The corpus says the
split runs deeper than system selection: brand colour everywhere is correct on a
landing page and a defect in a dashboard.

### 4. Nothing here can say which of two acceptable options is better

`ux-lint` says what is wrong. It cannot rank two pages that both pass. The corpus
contains one mechanism that solves exactly this, and it comes from a painting
lecture with under 3,000 views, described in [batch 1](video-findings/batch-1-taste-acquisition-motion.md).

## How taste is acquired

The highest-value half of the corpus, and the part with no overlap with existing
research. Mechanisms only, grouped by whether an agent could run them.

### Implementable by a machine

**Ranking with forced eviction.** Paul Ingbretson, `q7AzRHoi4wo`, after failing to
answer which five painters were the best of all time, started buying postcards of
the top three paintings in every museum he visited and forcing them into a ranked
top ten, with each new visit evicting something: "i think i've outdone those i
think this one's better than any of those ten." His name for it: "i was evolving
taste by the experience of tasting." This is bounded-buffer pairwise preference
learning, and it is a direct answer to the gap in section 4 above.

**The alphabet audit.** Jesse Showalter, `LQbxFXPpIlM` at 5:58. Enumerate every
distinct visual variant on a page, letter each one, consolidate: "Into the
smallest alphabet possible. If you can get to A through F, you've done a really,
really good job." The only countable procedure anyone in the corpus handed over,
and a linter spec as written.

**The delay test.** `ApQN55NrJ2s` at 4:14: "Instead of asking, do I like this?
Ask, do I still like this tomorrow? Or next week?" Cheap to implement as a
re-scoring pass on a held artifact, and it replaces a first-impression judgment
with a stability judgment.

**The create-to-consume ratio.** Daniel Pink, `qYfTS1kDkAc` at 4:29: "If you're
consuming 10 times more than you're creating, you're starving your taste." The
only acquisition claim in the corpus carrying a number.

**Scoring on three named axes.** `qifGvtE31N4` at 7:14: "composition,
effectivity, and vibes," which is diagnostic rather than a verdict, because it
can return "everything's right, but the vibes are off."

### Requires a human, but shapes how the repo should be used

**Quality Wednesdays.** Tuomas Artman, Linear's CTO, `wjk0ulMAkbc`. A weekly
30-minute call where each of 25 engineers shows one quality fix they found
themselves, finished in 37 minutes. The load-bearing rule is the exclusion at
19:15: "No, that does not count. That's a defect. You have to find a quality
fix." An assigned bug is free and therefore does not count, which forces hunting.
It began as one hour auditing a single menu: "We found like 35 problems with that
tiny UI."

He also refuses to instrument it, at 11:21: "There will be no A-B test that you
can do in order to figure out whether you should invest in quality."

**Replication at page scale, never published.** Manu Arora, `g5R67TAhpbU`: a daily
categorized screenshot folder grown to thousands, then "you will have to replicate
this entire landing page top to bottom with the last minute details of even the
hover effects," and "Do not publish it." Plus "Study few people's deeply. Not many
shallowly."

**The three-year diagnostic.** `qYfTS1kDkAc` at 5:27: pull up something you made
three years ago and were proud of. If it still looks good to you, nothing
developed.

**Sitting with a work.** Both taste-focused videos independently name the failure
mode of high-volume exposure, which cuts against "just look at more stuff."
`d6oPSXG-UjM` at 3:35: "you also need to sit with each thing for some time, which
is something that you can easily skip doing once you're used to observing many
things."

**Consuming off-algorithm, deliberately.** `JZxwBEsokhs` at 3:12 and
`ujcEXPm1GpE` at 8:23, which reaches the same conclusion from the other side: the
recommendation feed is selecting what you think you like.

## What the corpus cannot decide, and this repo must

These are kept rather than resolved, because a contradiction between two
practitioners is information about where the real question is. Full detail with
quotes is in the batch files.

| Conflict | Sides |
| --- | --- |
| The 60 in 60-30-10 | Neutral (`UWwNIMHFdW4`) against brand (`KMS3VwGh3HY`) |
| Grid base | 4pt (`Al1xsdol4Pk`) against 8pt (`cf95Z7Ngg8k`), and both authors ship values violating their own |
| Dark mode | Derive by subtracting L from 100 (`9-oefwZ6Z74`) against never invert (`EOcY3hPMQkk`) |
| Red | Highest-converting CTA, +21% (`HKtTNOgfhAU`) against destructive-only (`XZf5A0wcruE`, `EOcY3hPMQkk`) |
| Micro-interaction duration | 150ms (`wjk0ulMAkbc`) against 600 to 800ms (`l0EkLsZiWUg`) |
| Animation | The thing that makes it good (`0N0NHlvMEWs`) against the thing that costs conversion (`Toonu-cTE60`) |
| Drop shadow | Evidence of a broken colour system (`XZf5A0wcruE`) against a deliberate device (`x8Vp8k3jXaA`) |
| Breadth | Stay open forever (`uNoolC94Dio`) against widen in order to narrow (`q7AzRHoi4wo`) |
| Convention | Default to it unless strongly justified (Apple) against the shared convention set being the problem (`d6oPSXG-UjM`) |
| Does a model have taste | "They have no taste. They simply don't" (Artman) against "you probably don't have better taste than the AI" (`nqepPcYxouY`) |

## What is not evidence

Recorded so nobody quotes these later as though they were measured.

- **`Toonu-cTE60` shows no data.** Twelve minutes arguing beautiful websites do
  not convert, with no conversion figure, sample size or cited study. Its
  strongest evidence is that Linear removed its header animations, which reports
  what Linear did, not what it did to Linear. It hedges in its own transcript:
  "it seems to perform better." Its testable claims are worth running as real
  experiments precisely because nobody ran them here.
- **The gendered colour claim** in `HKtTNOgfhAU` at 7:40 is asserted with no
  citation and must not enter a rules file.
- **The 21% red-over-green result** is attributed to HubSpot in `HKtTNOgfhAU` and
  was not verified here.
- **`5MJ7hzwjRbo` demonstrates nothing.** It reviews a Claude Code skill pack
  claiming to destroy AI slop, and the only visible anti-slop behaviour is the
  pack clamping the reviewer's own requested extremes downward. No slop score, no
  rubric, no failure case.
- **`wfIzvkjgInY`** (architecture principles) is ten abstract nouns with buildings
  attached, and its golden-ratio claim about the Parthenon is contested art
  history rather than a measurement.
- **Auto-captions are lossy in a way that matters.** `QrNi9FmdlxY` degenerates
  into a repetition loop and defeats local Whisper the same way, so it yielded
  nothing. The 8pt grid video says "eight point grid" and never "8pt", so numeric
  search misses it.

## Files

| File | Tier focus |
| --- | --- |
| [batch 1](video-findings/batch-1-taste-acquisition-motion.md) | Taste acquisition, motion, junior versus senior |
| [batch 2](video-findings/batch-2-type-spacing-color-motion.md) | Type, spacing, colour, Linear's quality process |
| [batch 3](video-findings/batch-3-apple-principles-slop-tells.md) | Apple's principles, the slop tells, taste frameworks |
| [batch 4](video-findings/batch-4-laws-spacing-hierarchy.md) | The 19 UX laws, spacing, hierarchy, the 50 mistakes |
| [batch 5](video-findings/batch-5-color-type-systems.md) | Colour recipes, type scales, dashboards, design systems |

Search the corpus with `ux-video "<term>"`, which returns the quote and a
`youtu.be` link that jumps to the second it was said.
