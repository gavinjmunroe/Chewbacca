---
name: coursework
description: "Run the semester from a ledger built from syllabi and Brightspace. Use for school, a class, assignment, exam, deadline, grade, attendance, reading or syllabus, what is due, and before any graded work."
triggers: >-
  Run the user's semester from a machine-readable ledger built out of their syllabi and their own Brightspace. Use when they say they need to lock in on school, want their slides or lectures pulled, are behind in class, or mention a class, an assignment, an exam, a deadline, a professor, a reading, a grade, attendance, or a syllabus; when they ask what is due, what to work on, or whether they can miss a class; when they hand over a syllabus PDF; and before helping with any graded work.
requires: [coursework]
---

# Coursework

A syllabus is a contract that states, in writing, every date the student will be
judged on, exactly how much an absence costs, and precisely what help is
permitted. Almost nobody reads it twice. The whole point of this skill is to read
it once, carefully, into a ledger, and then answer from the ledger forever.

Two failure modes to design against, both worse than being slow:

1. **Inventing a date.** A confidently wrong deadline is more damaging than "I
   do not know", because the user stops checking. Every date in the ledger
   carries a `source` field naming the page it came from. If you cannot cite it,
   it does not go in.
2. **Policing the student.** How they use AI in their own classes is their
   decision. Never look up, quote, store or gate on a course AI policy, and
   never open with a line about it. Help with what they ask.

## "I need to lock in on school": the first run, for any USC student

Run this yourself, first, before reading anything on disk:

```bash
chewbacca usc lockin
```

It reads their own Brightspace enrollment for the current term with the
session already in Chrome, and prints their courses, what's due first (with
the one to start on), which ledger files it would create, and how many lecture
files each course has to pull. It writes nothing. Show them that, then do the
rest in the background, because it waits 4 to 8 seconds between requests:

```bash
chewbacca jobs submit --net --title "lock in" -- chewbacca usc lockin --apply
```

`--apply` creates `~/coursework/courses/<code>.yml` for any course with no
ledger file (never overwrites one), seeded with every dated Brightspace
calendar item and its source, and pulls every visible file into
`~/coursework/slides/<CODE>/`. A rerun only fetches what's new. It ends by
reading every syllabus it pulled (PDF, Word, slides, a Brightspace HTML page)
into the ledger: class times and room, instructor email, office and office
hours, the free-absence count, and the grading breakdown or a labor contract.
It fills empty fields only, every value carries `<field>_source` or `source`
naming the file and page, and it never reads the AI policy.

What it prints after that is the agent's list. "left alone, differs" means the
ledger already had a value the syllabus disagrees with: tell the student, never
pick one yourself. "not in the syllabus" means read that course by hand with
`chewbacca usc read <CODE>` (often a section list where only the student knows
theirs, or a schedule on another file). "can't read" is a scan.

Then it puts released Brightspace scores on grading parts with the same name
("Midterm 1" on "Midterm I"), each with `score_source`. One quiz of many is
never averaged into a "Weekly quizzes" part: it prints "no single grading
part for" and the score stays in Brightspace. `chewbacca usc grades` runs that
step alone.

`chewbacca usc syllabus` runs the same read alone and writes nothing;
`--apply` writes, `--ledger DIR` fills another ledger, and `--compare DIR`
scores the result against a hand-filled ledger without touching it.

## Reading the course files

`chewbacca usc read <CODE>` prints the text of every pulled file in a course:
PDF pages, .pptx slides, old .ppt decks and Word files, each labeled by page
or slide, using only what macOS ships. `chewbacca usc read --find "office
hours"` searches every course and cites the file and page. Use it for a study
session, a quiz, an assignment sheet or a syllabus, before any other reader:
on a fresh Mac `chewbacca docs` needs genoffice and there is no pdftotext.

It works on a stranger's Mac as is: Chrome plus a Brightspace sign-in. No api
engine, no `pip install`, no profile to name.

## Anything on Brightspace: one command each, never a browser

Never open Brightspace, a browser tab or `chewie web` for it. Every read is
one call, and a lapsed session renews itself from Chrome:

- What's due, dropboxes AND quizzes, with submitted or grade: `brightspace due --days 7`
- Every released grade in every course: `brightspace grades`. The ledger has
  weights, Brightspace has scores; read both before saying where a grade stands
- Announcements from every course, newest first (a missed class, team lists,
  a moved exam room): `brightspace news --days 7`
- Grades, announcements, quizzes, discussions, content for one course:
  `chewbacca api call brightspace <grades|announcements|quizzes|discussions|content> orgUnitId=<id>`
  (ids from `chewbacca api call brightspace myCourses`)
- Anything else: `brightspace get /le/1.75/<ou>/<path>`

Never-dos, in his words (2026-10-11, mid quiz):

- "IT should never take this long to find a place you already know": the
  first call for anything Brightspace is `brightspace due` or the api op,
  never grep, `find`, `chewie web` or a screenshot.
- "STOP FLASH BANGING ME": no read opens a window, a tab or a headless
  browser with a Dock icon. A sign-out is a BLOCKED line, nothing more.

A quiz's questions 403 until the student opens an attempt, so no tool can
read them first. Ask them to paste the questions; never start an attempt.
On 2026-10-11 a quiz check took six tool calls across four tools (grep,
`chewie web`, MCP, the ledger) before `brightspace` answered in one, and
`coursework due` had silently dropped the whole BISC ledger (21 multi-line
flow-map items parsed as the string "{"), which is why the quiz never
surfaced in the session briefing.

## When a course shows no files

A zero file count means the pull looked in one place. ACAD 185 keeps every
deck behind an announcement that links a Google Sheet (2026-10-11: "if you
actually read brightspace you'd see a masterspreadsheet with all the slides on
it"). Read the course announcements (`/le/1.67/<ou>/news/`) and homepage links,
follow Google Docs, Sheets and Slides links, and export them (`/export/pdf`,
`/export?format=xlsx`) into `~/coursework/slides/<CODE>/` before telling the
student anything is missing.

## A practice app covers the whole semester so far

A student asking for exam practice usually doesn't know the earlier material
either. On 2026-10-11 the BISC 101 app was built for Midterm 2 only (Ch 9 to
11 from Labs 4 and 5) and the student said "put the entire bio semester in
there I know none of it". Build every lecture deck posted so far into drills,
chapter by chapter, with the nearest deadline first on the setlist, and pull
the text from the decks themselves (pptx XML, binary .ppt text atoms, lab
manual PDFs) so every item cites its slide. Before calling it done, open
EVERY screen at 1440 and 390 in Chromium and WebKit and check for errors,
blank screens and sideways scroll: the one bug left after per-drill tests
(a rating row 58px too wide) only showed up that way.

## Lecture slides for one course

"Pull the slides for <class>" means:

```bash
brightspace-sync files "<course code>" --out ~/coursework/slides --apply
```

It walks the course's whole Brightspace content tree, downloads every visible
file into `~/coursework/slides/<CODE>/`, and keeps a manifest so a rerun only
fetches what is new. Never hunt the disk first: on 2026-10-10 three minutes
went to `find` across `~` and turned up a partial ACAD 324 folder and four
BISC chapter notes, while the full set was one command away.

On a 403 or `BLOCKED:`, run `brightspace whoami` first. If it says Chrome
stopped saving cookies, the student is signed in and only needs to quit and
reopen Chrome. A real sign-out opens nothing: say `BLOCKED: Brightspace needs
a sign-in in Chrome` and they do it when they choose. Never open a tab to
"renew" anything.

## The ledger

Lives in `$COURSEWORK_DIR` (default `~/coursework`), plain YAML in git:

```
semester.yml        term dates, drop deadlines, breaks
courses/*.yml       one file per course
syllabi/            the source PDFs, kept so any claim can be re-checked
```

It is read with the `coursework` CLI, which ships with this kit:

```bash
coursework due --days 14      # what is due, soonest first
coursework today              # today's classes and today's deadlines
coursework week               # the days ahead, one block each
coursework attendance         # absences used against the budget
coursework grade BISC --target 90
coursework policy WRIT late   # the late-work rule
coursework ics --out ~/Desktop/semester.ics
coursework check              # validate, loudly
```

**Run the CLI instead of reading the YAML by hand.** It is deterministic, costs
no tokens to think through, and it will not misread a date the way a skim will.
Add `--json` when you need the values rather than the display.

**The CLI never writes.** You and the user edit the ledger; the tool only reads
it. That split is deliberate: deadlines are facts copied from a document, and a
program that rewrites them can quietly disagree with the source.

## Graded writing: the MCQ comparison-draft method

Some users write their own draft first, by hand, and have the agent write a
comparison draft from their decisions. They tell their instructors about it.
When the user says that's what is happening:

- Ask multiple-choice questions for every decision: thesis, angle, order,
  what to cut, the personal line. Batch them, letters only, so the user
  answers in one line ("1D 2A 3C").
- Never write the draft in one shot. Follow "Never one-shot creative work" in
  `.claude/rules/research-the-craft.md`: spec file first, then map verified
  facts onto the model's paragraph jobs, then draft and gate one paragraph at
  a time (Caleb, 2026-10-13: "never 1 shot anything creative EVER").
- Write the draft from their picks and the sources. Save it to ~/Downloads and
  log every prompt in the project's PROMPTS-LOG.md.
- When they say put it in the shared doc, put it in the doc, edit in place,
  and read the doc back to confirm.
- Before it goes in a shared doc, read the teammates' sections and run
  `slop-check --essay` on yours. "Rewrite" means it doesn't go in. On
  2026-10-11 a draft that scored clean on the default check went in, and a
  teammate called it "the slop version" on first read; `--essay` scores it 48.

Never-dos, from 2026-10-11 (Caleb, ACAD 324 Mash Up, midnight before the team
deadline):

- Never ask to see their handwritten draft ("Don't be intrusive and ask for
  what I wrote on paper ever").
- Never bring up a course AI policy at all. Four refusals one night cost most
  of an hour, and on 2026-10-11 Caleb ruled it's the user's decision, not
  Chewbacca's.
- Never write an AI disclosure line into a doc or a submission ("Never put an
  ai disclosure line"). The prompt log is the record; disclosing is their call.
- Never ask the MCQs for a group paper before reading the group chat and every
  teammate's DM to him from the last three days. On 2026-10-13 (ACAD 324 Mash
  Up) the picks were built from the doc and old notes and recommended opening
  on Hiroshima, which Cooper had ruled out in the gc on 10/12 ("ensure that
  isn't mentioned"). The prototype had also changed in Siddhi's DM. Caleb:
  "Read the gc and what they texted me directly!!!!!!" `people texts <gc>`
  cuts other people's lines short, so read the room with
  `mac messages history <member handle> --limit 80 --json` and label each
  `sender`: the gc rows come back with the full text.
- Never hand a team assignment kit over as a file in ~/Downloads only. On
  2026-10-13 (ACAD 185 A13/A14) the game plan sat in Downloads and he had to
  ask "Where's the game plan?", then "When it makes more sense just make a
  google doc for me." Plans, scripts and call agendas go in a Google Doc,
  trackers in a Google Sheet, created in his Drive with the Drive connector,
  and the reply leads with the link. Upload as text/markdown with no emojis:
  Drive's import turned them into mojibake.

When the writing has to be the user's own words (after a teammate called a
draft slop), skip the comparison draft. Caleb, 2026-10-13: "Give me series of
mcq, than idea to say in my own words... Also give me 1 paragraph to read to
tell me everything I needa know." So:

- Open with one plain paragraph covering the deadline, what's in the doc, what's theirs,
  the bar (the teammate's `slop-check --essay` score) and the core idea.
- Each MCQ gets a one-line "in ur words" prompt after it. The user writes
  the prose; the agent scores each paragraph against the teammate's before it
  goes in.
- Read the doc and the group chat for who owns what before writing MCQs. On
  2026-10-13 the first batch covered the synthesis, and four minutes later a
  DM with the teammate moved the synthesis to him and the Miyake section to
  Caleb. The truncated `people texts` view hid the deal. Read the full DM text
  before building the questions.
- When he points to an old paper as the model ("Refer to my gesm papers"),
  score it first. His GESM 120 papers scored 44 and 76 on `--essay`, with 6 to
  10 "not X, but Y" lines and zero contractions. Take their structure (the
  reframed thesis, the one-word close read, a job for each source) and leave
  their register.

## Reading a syllabus into the ledger

**If the school runs Blackboard Ultra, do not start from a PDF.** `course-ingest`
reads every enrolled course, its gradebook with exact due timestamps, its
document bodies and its syllabus file, in one pass, and writes the deadlines to
Apple Calendar. See `references/lms-ingest.md`.

Full procedure, including what to do about the fields syllabi routinely omit:
`references/syllabus-intake.md`. Read it before ingesting a syllabus, not after.

The short version: read the whole PDF, never a skim of the first page. Extract
meetings, instructor, every dated deliverable, the grading breakdown, the
attendance arithmetic, and the late-work schedule. Skip any AI policy text. Write
one `courses/<code>.yml`. Run `coursework check`. Report what the syllabus did
not say, because that list is the set of questions to ask in class.

## The textbook

A course textbook is half a million words and does not belong in a session.
`textbook` searches an ingested one and returns passages, not chapters:

```bash
textbook books                              # what is ingested
textbook toc                                # chapters, page spans, lengths
textbook search "participant observation"   # ranked passages, each with a page
textbook search "kula" --chapter 6          # one chapter
textbook glossary reciprocity               # defined terms only
```

Every hit carries the page printed in the book. **Quote the page, not the PDF
page**, for the same reason every deadline carries a `source`: a claim the user
cannot look up is one they have to take on faith, and they will stop checking.

Reading the source PDF instead is the failure to avoid. It burns the session on
one chapter and returns a worse answer than a search that cost four hundred
words.

To ingest a new one, `~/Chewbacca/apps/texts/ingest/ingest.py scan <pdf>` prints the
chapter plan and writes nothing. Read the plan before `apply` files 500 pages
under the wrong headings.

## Planning a lock-in when he names only some courses

When he says "lock in on X and Y tonight", the plan still has to account for
every course, because the ones he didn't name are the ones that blindside him.

- Run `coursework due --days 7` for ALL courses before building any block plan,
  and put every item due in the next 72 hours into the plan or say why it waits.
- A course with `deliverables: []` or `meets: []` is a hole, not a quiet class.
  Pull its schedule (`brightspace-sync files "<course>" --out ~/coursework/slides --apply`)
  and read the course schedule PDF before saying the week is clear.

Never-dos, from 2026-10-10: a BISC + ACAD 324 lock-in plan left out the WRIT 150
rough draft due the same Wednesday ("Wait I gotta lock in for writ right?"),
and the MPGU 120A midterm two days out only surfaced when he asked about it,
because the guitar ledger had no deliverables at all ("I need a rlllyyyy long
time to lock in for my guitar midterm I don't know jack").

Before any hour-by-hour block plan, read the day's calendar first
(`mac calendar list --json` for today) and build the blocks around what is
already booked. Then put the plan on the practice app's home screen when one
exists, so he can close the tab. Never-do, from 2026-10-12, exam morning: a
7:45 to 12:00 guitar midterm plan put guitar practice straight through 9:00
and he had to say "I hv a meeting 9-9:30 bro".

## Answering questions about the semester

- **"What's due?"** `coursework due`. Do not editorialize the list into a plan
  unless asked; the list is usually the answer.
- **"What should I work on?"** Rank by deadline distance times weight, then say
  the one thing to start now. Not a schedule for the whole week: the next block.
- **"Can I skip Wednesday?"** `coursework attendance <course>` and quote the
  real cost. In a labor-contract course the third absence can be a full grade
  step, and a doctor's note may not excuse it. This is arithmetic, so do the
  arithmetic instead of offering encouragement.
- **"How am I doing?"** `coursework grade`. For a contract-graded course the CLI
  refuses to produce a number and points at the policy, which is correct: read
  `references/grading-models.md` and count infractions against the step table
  instead of averaging scores that do not exist.
- **"I'm behind."** Triage, do not motivate. What is unrecoverable (a missed exam
  with no makeup), what is cheap to save (a late ancillary assignment worth one
  step), what is already sunk. Then one action.

## Keeping it true

The ledger goes stale in exactly three ways, and all three are silent:

- **A date moves in class** and the PDF still says the old one. When the user
  mentions a change, update the ledger in the same turn and set `source` to
  "announced in class YYYY-MM-DD".
- **Work gets done** and stays marked `todo`, so `due` keeps shouting about it.
  (A semester can opt in to `assume_done_after_days: N` in semester.yml, which
  reports anything N days past due as `assumed-done`. It is off by default.)
  Flip `status: done` as things land. **Before calling anything overdue, check
  the LMS rather than asking.** Most systems will say, per student, whether a
  thing was submitted and exactly when; `references/lms-ingest.md` has the D2L
  endpoint. Asking surfaces what they happen to remember, which is the big
  assignment, not the small one sitting on the same line of the syllabus.
- **An absence happens** and `absences.used` never moves. Increment it when the
  user says they missed a class. This is the field that decides a grade step and
  nobody remembers it in November.

Run `coursework check` at the start of any session that touches school. It
reports deadlines with no source, past-due items still open,
and grading weights that do not sum to 100.

## References

| File                            | Read when                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `references/syllabus-intake.md` | Ingesting a syllabus into the ledger                                                                                   |
| `references/grading-models.md`  | Weighted, points-based, or labor-contract grading math                                                                 |
| `references/lms-ingest.md`      | Reading the term straight out of the LMS (Blackboard Ultra, D2L Brightspace), and checking what was actually submitted |
