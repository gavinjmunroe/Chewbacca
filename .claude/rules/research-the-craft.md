# Research the craft before producing the artifact

Always on, and short on purpose.

## The failure

Asked to record a product demo, this kit drove the UI competently and produced
four taps on a tab bar. Every mechanical part worked: the window capture, the
virtual cursor, the encoder, the export. The artifact was still worthless,
because nothing in the process had ever asked **what makes a product demo
good**.

The user had to send two YouTube videos and an article. The first rule in them
was that showing many features is the single biggest mistake people make, which
is exactly what had been asked for and exactly what had been delivered.

Driving the tool is not the skill. It is the part that looks like the skill.

## The rule

When the deliverable belongs to a **genre with practitioners**, spend the first
few minutes learning the genre, before opening an editor or a capture tool.

Genres this covers, non-exhaustively: demo videos, pitch decks, landing pages,
cold emails, README files, conference talks, job applications, grant proposals,
onboarding flows, changelogs, press releases, thumbnails, logos.

What that looks like, in order:

1. **Find three good ones and one teardown.** A teardown by somebody who makes
   them for a living beats ten examples with no commentary, because it tells you
   what they were deciding, not just what they chose.
2. **Extract the rules, not the vibes.** "One to three features, never more" is
   a rule. "Make it engaging" is nothing.
3. **Write the rules into the skill that owns the work**, so the research
   happens once and the next session inherits it. A lesson that stays in a
   transcript was not learned.
4. **Produce only once those three are done.**

For anything on the machine, prefer sources already installed: `yt-transcript`
for a video, `summarize` for a page. Never WebFetch a YouTube URL, it returns no
transcript.

## When the brief contradicts the craft

The person asking is usually not a practitioner of the genre either, and their
brief will often name the exact anti-pattern. "Show all the screens", "put
everything above the fold", "list every feature".

Say which rule it breaks, in one line. Build the version that works. Offer the
literal version as a separate artifact if they still want it. Delivering the
anti-pattern silently, and delivering something they did not ask for silently,
are both wrong.

## The test

Before producing, answer: **what do the people who do this for a living say
separates a good one from a bad one?** No answer means the research step was
skipped.

## Never one-shot creative work

Anything creative, meaning an essay section, a personal statement, a script, a
post, copy or a design, goes through these steps in order and never as one
generated draft:

1. **Find the model.** That's the teammate's section, the user's own best
   writing, or three good examples from the genre. Read the actual text.
2. **Write the spec to a file** (`<NAME>-SPEC.md` next to the work). Say what
   each paragraph or section of the model does, list its moves and register,
   and give it a few numbers (words, sentences, citations per paragraph).
3. **Map verified material onto those jobs.** Check each fact on a live page
   first. A fact with no source stays out, and a quote that can't be found
   anywhere is fake.
4. **Draft one unit at a time** against its counterpart in the model.
5. **Gate each unit.** Check what it opens on, what it closes on, its
   citation count against the model's, and run slop-check. Then read the whole
   thing next to the model.
6. **Report the method and the gaps**, then hand it over.

On 2026-10-13 the Miyake section of a team paper was rewritten five times in
an hour, each version generated whole and each read worse than Andy's
hand-written Douglas half ("Its nowhere near as good as andy's", "Stop 1
shotting things, be methodical"). One draft carried a quote that had no source
anywhere. The version that held up came from `MIYAKE-SECTION-SPEC.md`, built
from Andy's five paragraph jobs. Caleb: "never 1 shot anything creative EVER".
`essay-gate` now refuses a Google Doc write of 300+ words when no
`*SPEC*.md` or `*OUTLINE*.md` file from the last 24 hours exists.
