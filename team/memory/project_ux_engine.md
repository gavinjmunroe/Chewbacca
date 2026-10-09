---
name: project_ux_engine
description: ux-engine indexes 74 real design systems by what they refuse, ships the numeric constants of interface behaviour, and lints the generated look; built 2026-09-20 from his UX-engine voice memo.
metadata:
  type: project
---

**2026-09-20.** Caleb asked for "deep research on all the coolest websites/ux
on earth", which is artifact #1 from his own voice memo the same morning
(`raw/caleb-ux-engine-spec-2026-09-20.md`): *"we should have it run deep
research on UX, deep research on what makes a good site."*

Repo: **`calebnewtonusc/ux-engine`**, private.

**The diagnosis in his memo was right and now has a number.** The corpus he
sent on 9/19, [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md),
is **40,446 lines across 74 systems**. No agent reads that before choosing a
direction, so it falls back on `~/.claude/rules/design-system.md` and ships the
violet gradient. **That is the lag.** The fix is caching the method, not the
pixels.

**The thesis, which a researcher reached independently without being given his
words:** *the generated look is not bad taste, it is an empty deny list.*
Polaris bans hex and all 25 length units in stylelint, Atlassian bans
`<button>` and `placeholder` in ESLint, GOV.UK bans pasted hex in Sass. This
confirms a private note from the Gavin Munroe build.

**So the index is built on refusals, not palettes.** Bugatti's radius scale is
literally `0px` and `9999px` with nothing between, no saturated colour, no
display weight over 400. Machine-readable, and most of what makes a page read
as Bugatti.

**What shipped:** `SYSTEMS.md` (64 systems, one page, sorted by how much each
refuses), `bin/ux-pick` (brief to system, prints the refusals), `bin/ux-lint`
(20 rules, 21 hits on the archetypal generated hero, silent on a Bugatti-styled
one), `data/constants.json`, `research/` with full sourcing, 12 tests.
`crafts/web-ux.md` went into the kit so **craft-gate now fires on UI work**, up
from two crafts to three.

**The best single rule found is about frequency, not taste.** An interaction
seen 100+ times a day gets **no animation at all**; tens of times a day gets a
reduced one; only rare or first-time earns delight. Raycast ships no open/close
animation and that is correct.

**Three extractor bugs, all found by checking output against brands whose
colours are known rather than trusting it.** Semantic tokens read as brand
accents (Bugatti came back gold, Stripe came back as its own drop-shadow),
inline comments ate hex values, and the ten prose-only systems all reported
"monochrome, no accent" because there was nothing to measure. That last one
would have taught the engine that Spotify has no green. **Absence of data is
not a constraint**, which is a private note in a new
place.

**Numbers that circulate and do not survive checking**, left out rather than
guessed: Apple publishes **no** millisecond values anywhere in the HIG, Warp's
"5ms input latency" is contradicted by Warp's own benchmark page, Amazon's
"100ms costs 1% of sales" traces to a 2006 talk. Every "Linear design system"
token dump online is third-party reverse-engineering.

**Still open**, both named in his memo and not built: the **component preset
layer** ("saving buttons", a dashboard, a slider, a nested UI) and the **data
loaders** plus the discovery file for scraping an unknown app's data.

**2026-09-22, verified by firing it rather than reading it.** `ux-guard.sh`
genuinely refuses: a deliberately bad `Hero.tsx` came back exit 2 with one
BLOCKING finding citing WCAG 2.4.7, and a clean file and a `.py` both exited 0,
so no false positive on the two cases tested. That is the real thing, and it
passes [[feedback_a_silent_guard_proves_nothing]].

**But it was registered on exactly one machine.** `setup.sh` copies every
`.claude/hooks/*.sh` into `~/.claude/hooks` and never called `_register` on this
one, so it fired here only because it had been hand-added to `settings.json`.
Dead on every other install since it was written. Fixed in Chewbacca `b63a41c`,
plus `doctor.sh` now checks it installed AND wired, verified in both directions.

**The ux-engine binaries were not on PATH**, so the guard's own remediation
("Derive the constraints first: ux-constrain", "ux-preset form") named commands
that did not exist. A refusal with an unrunnable next step teaches people to
route around the gate. setup.sh now links them from `UX_ENGINE_DIR`.

**Two lint bugs**, ux-engine `3ff021c`: the regex loop had no per-line dedup
while COMPUTED did, so `from-indigo-600 to-purple-600` reported `indigo` twice
and inflated the `--max` CI count; and `img-no-alt` fires only on an img with no
alt at all, which is WCAG 1.1.1 Level A, but cited only WebAIM so `authority()`
read it HOUSE and it never blocked. `div-onclick` and `placeholder-as-label`
stay advisory: both have real false-positive cases and the zero-FP bar for
blocking is the reason the split exists.

**Still true and still open:** the component preset layer and the data loaders.

Related: a private note, a private note,
[[project_chewbacca_craft_and_claude_tab]], a private note,
[[project_chewbacca]]

**2026-09-22, the video corpus.** Caleb sent two YouTube videos on how to think
like a designer and asked for a lot more like them. Built into a searchable
corpus: 42 `yt-dlp` searches, 573 unique videos, 380 topically relevant, 91
transcribed, four tiers (taste, think, craft, ai). Six parallel agents mined
every transcript into `research/video-findings/`, synthesised in
`research/17-video-corpus.md`. `bin/ux-video` searches all 233k words and
returns the quote with a `youtu.be` link that jumps to the second it was said,
because a pile nobody reads costs more than inventing an answer.

**The falsifier was set before building and it held.** If the extracted rules
had already been in `research/` in the same words, YouTube was the wrong source.
Checked: Artman, Doherty, the 8pt grid and x-height were already there. Quality
Wednesdays, the alphabet audit, ranking-with-eviction, the create-to-consume
ratio and the indigo origin were not. Additive in the half the repo was weakest
on, which is acquisition rather than application.

**Four things it changes in the repo.** Every rule has a floor and no ceiling,
and Apple's WWDC talk is the only source in 91 videos that caps its own advice
("Too much feedback is annoying. Too much visibility is distracting"). The
indigo rule gets a source: Tailwind's founder apologised on camera for
indigo-500 seeding every generated UI. A tool and a marketing page need
different deny lists. And nothing in the repo can rank two pages that both pass.

**The best mechanism came from a painting lecture with 2,936 views.** Paul
Ingbretson, asked to name the top five painters of all time and unable to,
started buying postcards of the top three paintings in each museum and forcing
them into a ranked top ten with eviction: "i was evolving taste by the
experience of tasting." Bounded-buffer pairwise preference learning, invented in
a shoebox, and the direct answer to the ranking gap above. It is also
a private note from the other side.

**Linear's actual quality mechanism is a calendar event.** Tuomas Artman:
Quality Wednesdays, 30 minutes weekly, 25 engineers, each shows one quality fix
they found themselves. The load-bearing rule is the exclusion: "That's a defect.
You have to find a quality fix." An assigned bug is free so it does not count.

**And somebody reached the repo's central claim independently.** Thais Castello
Branco of Taste Labs, from building eval infrastructure rather than from the ML
literature: "this feels like slop... is exactly because of this collapse to the
mean and this repetition." Recorded in `research/14` as convergent testimony,
not evidence, since she gives no n and sells the solution. She also names the
one move the repo lacks: replace the unverifiable "make it great" with the
decomposable "make it on brand", judged per element and graded against the
decomposition rather than the original.

**One defect she found in the repo by accident:** design standards expire and
code standards do not, so every value in `data/constants.json` should carry a
decay date and none of them does.
