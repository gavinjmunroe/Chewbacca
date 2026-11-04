---
name: study-guide
description: "Build an interactive HTML study guide, review sheet, quiz or flashcards from notes, slides, transcripts or problem sets, recording what was missed. Use to make or extend a guide or review for an exam."
triggers: >-
  Build an interactive study guide, review sheet, practice quiz, walkthrough or flashcard set for a course topic, from lecture notes, slides, a transcript, a reading or a problem set. Produces one HTML file with quizzes, step-throughs and flashcards that records what was missed, so a later session picks up there. Use when asked to make or extend a guide, turn notes into practice, or review before an exam.
requires: [guide, coursework]
---

# Study guide

The [study-system](../study-system/SKILL.md) skill is the pedagogy: ask, do not
tell; mark the gap specifically; bring the question back later. Its weakness is
that a conversation ends and takes the retrieval practice with it. Next week
starts from zero on material already failed once.

A guide is where that survives. One HTML file with quizzes, step-throughs and
flashcards, plus a JSON sidecar holding per-topic results that `guide progress`
reads back. Write markup only. The runtime is already written.

## Before writing anything

```sh
guide list                       # extend an existing guide, do not start a rival
guide progress                   # what they already got wrong
```

If `guide progress` shows missed topics, the new guide opens on those. Do not
rebuild the whole unit because one section was weak.

**Teach before you test.** Every item gets a teach step (the answer shown,
spelled out in words, with the move from the item before it) before any recall
drill reaches it. Caleb, 2026-10-12, two hours before a guitar midterm whose
chord drills were all quizzes: "idk any of the chords". When time is short, the
items on the exam come first and in the order they're performed, and a day
plan on the page shifts from the real start time when he's behind.

The same failure happened again on 2026-11-02 with the BISC Midterm 2 app
(bio-midterm2.up.railway.app): 250+ flashcards and drills, no lessons. Caleb:
"evaluate if the midterm 2 ux can be improved in any way for me to GET AN A I
know literally nothing". So an exam app always ships three things in this
order, shown on its home screen as the plan: lessons written for zero
knowledge in study-guide order (with exam traps and a few check questions),
then drills, then a timed mock in the real exam's format (read the syllabus for
the question types, matching included) graded by topic, sending each weak
topic back to its lesson. Material that isn't on this exam gets moved out of
the main list.

**Night-before mode: lessons are skims, drills do the teaching.** On
2026-11-03, the night before BISC Midterm 2, Caleb was 16 min behind by lesson 3
bc he was rewriting every sentence as bullets: "not sure if read + write down it
rlly teaching me much compared to the drills? I rlly like the drill practice I
feel like I learn quickly w the diagrams and repetition". So the night before,
the plan says: skim the lesson (big idea, diagram, exam traps) in 3 to 4 min with
no notes, answer the check questions, then that chapter's drill sets, and flip
back to the lesson only for a missed item. Never budget a lesson as close
reading the night before, and never tell him to take notes.

**Every lesson diagram is labeled.** Leader lines and part names on the lesson
copy ("For diagrams like this plz label!", 2026-11-03, on an unlabeled membrane
picture). Drills that ask him to name a part reuse the same SVG unlabeled, so
add labels at the lesson call site (bio-midterm2 `tagSVG`), not inside the shared
drawing. Check the labels rendered at desktop and phone width, since they collide
easily.

**Lessons are one idea per card, and every process card has a picture.** A
lesson page of paragraphs got "a fat wall of texts isn't teaching me much", then
a text-only calcium pump card got "Plz plz plz add diagrams stuff like this is
so hard to comprehend bro" (2026-11-03). Build lessons as a card stepper with a
diagram mapped to each card (bio-midterm2 `FIGS`): steps drawn as a strip
(pump, endocytosis), gradients with arrows, Punnett squares built from the
gametes, cell-cycle wheels, phase pictures. Write the pictures before the text.

**Assume zero vocabulary, short answers, one Lock in button.** Same night:
"Assume I know NO terms", a flashcard answer of 30 words got "too dense to
remember", and "we need a streamlined lock in". So every bolded lesson term is
tappable for a plain definition of 18 words or fewer (`GLOSS`), every flashcard
shows 1 to 4 short lines with the full answer behind a tap (`SHORTQ`), and the
home screen and pace bar carry one button that opens the exact next thing
(`nextUp`: unread lesson, then that chapter's weak drill sets, then the mock
once, then the weakest set). He chose one mock plus drill spam over two mocks.

**Exam apps carry tonight's schedule and a pace bar.** He asks for both every
time (guitar, marketing, bio): a timed schedule on the home screen that moves
when he pushes the start, and a fixed bottom bar saying what's next, the time
it ends, and "On pace / N min behind" based on real progress. Read the exam time
from him, not the ledger: on 2026-11-03 the ledger parsed "10:25" out of an
email-confirmation timestamp in the notes, and the real exam was 9am.

**Read every source whole, including the videos.** "Go through the entirety of
the semester DONT SKIM" (Caleb, 2026-11-02). That means every deck, the study
guide, the lab manuals for the labs the exam covers, and the class animations,
since study guides say "watch all animations". Transcribe the videos
(`mlx_whisper` through `chewbacca jobs submit --heavy`) and check them against
the lessons. `head`, `cut -c` and reading part of a file don't count as reading
it. When something was only partly read, the reply says which file.

A video with only music comes back from Whisper as "Thank you." or one line
repeated over and over. On 2026-11-02, 2 of the 11 BISC animations (endo and
exocytosis, vesicle transport) did this. Treat that output as no narration,
say so, and cover the video from its slides. Never quote those lines as content.

**A process is an animation, never cards.** When the topic is a sequence that
changes something physical (mitosis, meiosis, transcription, a reaction, a
cycle), build one drawn object that changes state step by step: Next/Back, a
scrub slider, plain-English line first and the term second, a live counter for
whatever the exam counts, then a no-labels "name that stage" quiz on the same
drawing. Caleb, 2026-11-04 at 5am before BISC Midterm 2, after the mitosis
lesson cards: "Rlly not getting this mitosis stuff can you make it an
interactive animation that's easier to follow rather than a bunch of cards idk
any of the terms bruh". The version that landed is
`bisc-101/midterm2/mitosis.html`. Screenshot every stage before pushing: the
first render had metaphase and anaphase chromosomes stacked into one bar.


**One screen, one sentence, then a check.** A teaching page fits the viewport
with no scroll: the drawing on top, one short sentence under it (one new term
bolded at a time), Back and Next, and every 3 or 4 beats a question that has to
be answered right before Next unlocks. The checks are the flashcards. No term
cards, rule boxes or counter grids under the drawing. Caleb, 2026-11-04, on the
first mitosis animation: "it doesnt even fit in 1 page and its too much to
comprehend at once, rlly walk be through it plz! This goes for every time u
ever teach me smth - also isn't the whole point that this is going to be in
replace of the flash cards to learn?" The shared engine is
`bisc-101/midterm2/walk.js` + `walk.css`; reuse it.

## Making one

```sh
guide new "cache coherence" --course CSCI170   # writes guides/cache-coherence.html
```

Then edit the file: replace the starter blocks with real content and delete the
ones you did not use. Then:

```sh
guide open cache-coherence
```

**Always tell them to open it with `guide open`, never by double-clicking the
file.** Opened as a `file://` URL the runtime can only reach localStorage, which
nothing outside that one browser can read, so the next session cannot see what
was missed and the entire reason the guide exists is gone. The page says which
mode it is in, in the corner.

## The markup

**Quiz.** One `section.rg-quiz` per concept. `data-topic` is a stable slug and
progress is keyed on it, so renaming it orphans the history.

```html
<section class="rg-quiz" data-topic="mesi-states">
  <h2>Check yourself: MESI</h2>

  <div class="rg-question" data-answer="c">
    <p>
      A line in the Shared state is written by this core. What state does it
      move to?
    </p>
    <ol class="rg-options">
      <li>Invalid</li>
      <li>Exclusive</li>
      <li>Modified</li>
      <li>It stays Shared</li>
    </ol>
    <div class="rg-explain">
      A write needs ownership, so the other sharers are invalidated and the line
      becomes Modified.
    </div>
  </div>

  <div class="rg-question" data-answer="a,c">
    <p>Which states allow a silent read hit, with no bus traffic?</p>
    <ol class="rg-options">
      <li>Modified</li>
      <li>Invalid</li>
      <li>Shared</li>
    </ol>
  </div>

  <div class="rg-question" data-answer="write-back|writeback">
    <p>What does a Modified line do on eviction?</p>
    <input class="rg-input" placeholder="one or two words" />
  </div>

  <button class="rg-check">Check answers</button>
</section>
```

`data-answer` takes a letter (`c`), a 1-based index (`3`), a comma list for
select-all (`a,c`), or `|`-separated alternatives for typed answers, matched
case- and whitespace-insensitively.

**Step-through.** A procedure one step at a time, Prev/Next and arrow keys. Put
the resulting **state** in each step, not only the action: the state is the thing
they have to be able to reconstruct in an exam.

```html
<div class="rg-steps">
  <div class="rg-step">
    <h3>1. Core 0 reads X</h3>
    <p>Miss, goes to memory. Line enters <b>Exclusive</b> in C0.</p>
  </div>
  <div class="rg-step">
    <h3>2. Core 1 reads X</h3>
    <p>Snoop hit in C0, both now <b>Shared</b>.</p>
  </div>
</div>
```

**Flashcards** and **reveal**:

```html
<div class="rg-cards">
  <div class="rg-card">
    <div class="rg-front">Write-allocate</div>
    <div class="rg-back">
      On a write miss, fetch the line, then write into it.
    </div>
  </div>
</div>

<details class="rg-reveal">
  <summary>Show the derivation</summary>
  <p>...</p>
</details>
```

## Writing good questions

This is the whole job. The markup is trivial and a guide full of bad questions
is a worksheet with extra steps.

- **A wrong answer must be tempting.** Every distractor should be something a
  person who half-learned this would actually pick: the right idea in the wrong
  direction, the adjacent term, the answer to the previous question. Three
  obviously-absurd options make a question that tests reading, not knowing.
- **Ask for the mechanism, not the label.** "What does MESI stand for" is
  recognition. "A line is Shared and this core writes it, what happens to the
  other copies" is the thing the exam asks.
- **Use the typed-answer form for anything they must produce from nothing.**
  Multiple choice always leaks the answer set, which is exactly the crutch the
  exam removes.
- **`rg-explain` explains the tempting wrong answer**, not just the right one.
  Saying why C is correct teaches less than saying why B is the trap.
- **Cite sources in the footer**, with the lecture date or slide range. A guide
  whose claims cannot be traced is worth nothing a week later when it disagrees
  with the professor.

## Afterwards

```sh
guide progress                 # what is still wrong
guide progress <name> --json   # for another skill to read
```

Bring the missed items back in the next session before anything new. That is the
whole loop, and skipping it makes the sidecar decoration.
