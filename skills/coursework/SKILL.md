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
- Hand something in: `brightspace submit <ou> <folderId> <file>...`. It finds
  the student's own group for a group dropbox, uploads headless, and proves it
  from the submission list (name and byte size). `--dry-run` says where it
  would go. Only on the user's word about THAT assignment, and the submit gate
  still applies
  A second submit to a GROUP dropbox that already holds a file timed out on
  its Submit button twice (2026-11-02, ACAD 185 A20 script PDF, deck already
  in), and a two-file call raised the same timeout after the first file
  landed. Submit every file for a group dropbox in the first call, then read
  `brightspace files <ou> <folderId>` to see which actually went in; the
  exception alone doesn't say.
- Pull files down: `brightspace files <ou> <folderId>` (the brief's attachments
  plus everything submitted), `brightspace content <ou>` (every Content file in
  module folders, links in links.tsv), `brightspace feedback <ou> <folderId>`
  (grade, comments, feedback files)
- Discussions: `brightspace discuss <ou>` lists forums and topics,
  `brightspace discuss <ou> <forum> <topic>` reads the posts, and
  `brightspace post <ou> <forum> <topic> --subject S --body-file F` posts
- Anything else: `brightspace get /le/1.75/<ou>/<path>`
- An assignment brief (the dropbox instructions, with its Google Doc template
  links and attachments): `brightspace get /le/1.99/<ou>/dropbox/folders/<folderId>`,
  then read `CustomInstructions.Html`. The path starts at `/le`, never
  `/d2l/api/le` (that 404s). folderIds come from the `assignments` op.
  `SubmissionType` 3 means observed in person: nothing gets uploaded, the work
  lives where the brief says (often the master spreadsheet). No `Availability`
  end date means a late upload still goes through.
- A worksheet with screenshots or nested lists: `chewbacca pdf` dropped every
  image and flattened the nested lists on 2026-10-21 (ACAD 185 A17). Render it
  with pandoc to standalone HTML, then Playwright `page.pdf`, and count images
  with `pdfimages -list` before handing it over.
- A dropbox upload is not the whole submission when the class grades in a
  shared sheet. ACAD 185 has a peer eval tab per assignment (`A18 Peer Eval`
  in the master spreadsheet) where each student posts a link. Before calling
  an assignment done, read that tab for the student's row and fill it. Build
  the work IN the template the brief links (copy a classmate's posted copy if
  the template link is missing), as a Google Sheet or Doc set to anyone with
  the link can EDIT. On 2026-10-27 his A18 went in as a custom PDF, his row
  sat empty mid peer eval, and he wrote "GOOGLE SHEET ANYONE CAN EDIT" and
  "THEY GAVE US A TEMPALTE AND WE DIDNT USE TI". Copying a template with
  `gws drive files copy` keeps its merged cells: unmerge the body rows before
  writing, or every value under a merge silently disappears.
- Peer evals: Round 1 is columns D to I, Round 2 is J to O. Write only into an
  empty round. If another student's name is already in that round's evaluator
  cell, use the other round. Never overwrite them.
- Uploading, only on his word "submit" for that assignment: POST multipart/mixed
  (a JSON part, then the file) with the d2l cookies and an `X-Csrf-Token` from
  `/d2l/lp/auth/xsrf-tokens` (`referrerToken`). Individual folders take
  `/d2l/api/le/1.75/<ou>/dropbox/folders/<id>/submissions/mysubmissions/`. A
  group folder 404s "Assignment not found" there and takes
  `.../submissions/group/<groupId>/`, trailing slash required (without it, a bare
  404). The groupId comes from `brightspace get /lp/1.43/<ou>/groupcategories/<groupTypeId>/groups/`.
  Check with the `submissions` op after. Never drive the web form in his
  Chrome: it takes his screen (ACAD 185 A19, 2026-10-22).

Course nicknames: read `aliases:` in each ledger file before searching. "POD" is ACAD 324g
The Practice of Design, and on 2026-11-02 he had to spell out "Practice of design peridot"
because a grep for POD hit ACAD 185 slides (points of difference) first.

Never call a dropbox upload BLOCKED before trying `brightspace submit --dry-run`. On
2026-11-02 a tab told him to upload P4b by hand from a stale checkout of this file that
predated the submit command. It only needed him to sign into Brightspace once, then
`brightspace submit 299120 603067 <pdf>` landed it at 10:16 for a 10:30 deadline.

Never-dos, in his words (2026-10-11, mid quiz):

- "IT should never take this long to find a place you already know": the
  first call for anything Brightspace is `brightspace due` or the api op,
  never grep, `find`, `chewie web` or a screenshot.
- "STOP FLASH BANGING ME": no read opens a window, a tab or a headless
  browser with a Dock icon. A sign-out is a BLOCKED line, nothing more.
- "Wait I alr figured that out, no?" (2026-10-22, BISC lab presentation
  topic): Gmail, Brightspace and the ledger only hold what was written down.
  When they're silent on something he could have heard in lab or in person
  (a topic, a presenting week, a makeup slot), ask him in one line first.
  Never offer to email the instructor to find it out.
- "No bio lab tmr?" then "No other school stuff?" (2026-10-29, a "what do I
  knock out today" list): a today list covers tonight's prep for tomorrow's
  first classes too. Run `coursework week` next to `coursework today`, list
  tomorrow morning's meetings (lecture, lab, room), any pre-lab or PPE they
  need tonight, and every school item due in the next 7 days. A lab whose
  pre-lab isn't in the ledger still gets a line: check the manual tonight.
  Read his calendar with `GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.chewbacca/email/calebnew@usc.edu
  gws calendar events list` (calendarId primary, singleEvents, orderBy
  startTime). On 2026-10-29 `gog calendar` had no token for calebnew@usc.edu
  and failed twice before gws answered.
- "lets make sure erik noakes isnt the one that sees it" then "bet email her"
  (2026-10-28, missed BISC Quiz #7): a missed-deadline reopen request goes to
  the lecture instructor only, from the USC inbox:
  `GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.chewbacca/email/calebnew@usc.edu gws gmail +send`.
  Draft it, send on his yes, then put the Gmail id and the time in that item's
  ledger notes. Keep the stated reason one staff can't disprove with a single
  email to the lab: an "I was in lab" excuse failed that test the day after
  the lab manager denied his makeup.
- "I totally missed his email" (2026-10-27, BISC Lab 5 makeup): an
  instructor picked a slot on 10/22 ("Monday 7:30am"), nobody confirmed it,
  and Noakes sat in his office alone. When an instructor's reply sets a time,
  the ledger entry says SLOT SET, UNCONFIRMED and it goes at the top of every
  `coursework` read until he confirms. Write the real reason in any apology;
  never invent a better excuse for him.
- "WHY DID YOU FLASH BANG ME" and "I want NO ONE to ever open brightspace
  ever again" (2026-10-22, A15/A17 group upload): a write goes through
  `brightspace submit`, never his Chrome. `open -g` to a Brightspace page
  still came to the front. When a job has no command yet, build one that
  runs headless before doing the job, never "just this once" in a tab.
- "whered you get 7:30 lab from?" (2026-10-26, midnight "what's due tn"): the
  ledger had `at: "07:30"` for a makeup slot the instructor offered and he
  never confirmed, plus a syllabus-dated quiz that wasn't posted. Before
  listing a ledger item as due, read its `notes`: an unconfirmed slot is said
  as "offered, not confirmed", never as an appointment. Check every quiz,
  dropbox and "overdue" against `brightspace due` and the quizzes op first;
  that night it showed WP2 already submitted and quiz #7 not posted at all.

- "is it slop" then "Fix it" (2026-11-02, ACAD 185 A20 Hero's Journey deck):
  slop-check scoring 0 doesn't answer "is it slop". Before handing over a
  graded deck or script, read each slide's last line and the closer yourself.
  A pitch kicker ("the next person who fronts money opens Kyber too") or
  presenter filler ("That's the whole journey on one slide") gets rewritten to
  end on a concrete moment before he has to ask. After any deck edit, look at
  the rendered page: that day Kyber's export.sh kept the old PDF because its
  wait loop saw a non-empty file, and the edit never showed.
A quiz's questions 403 until the student opens an attempt, so no tool can
read them first. Ask them to paste the questions; never start an attempt.
On 2026-10-11 a quiz check took six tool calls across four tools (grep,
`chewie web`, MCP, the ledger) before `brightspace` answered in one, and
`coursework due` had silently dropped the whole BISC ledger (21 multi-line
flow-map items parsed as the string "{"), which is why the quiz never
surfaced in the session briefing.

## When a course shows no files

A zero file count means the pull looked in one place. ACAD 185 keeps every
deck behind a Google master sheet (2026-10-11: "if you
actually read brightspace you'd see a masterspreadsheet with all the slides on
it"). Put the sheet id in the ledger as `master_sheet:` and the pull follows
it: `brightspace-sync files` then also runs

```bash
brightspace-sync decks <CODE> --out ~/coursework/slides --apply
```

which saves every session deck the sheet links as `<WnSn> <title>.pdf` plus a
`.txt` you can read, and a fresh `master.xlsx`. A daily daemon job runs it for
every ledger with a `master_sheet`. For a course with no master sheet, read the
announcements (`/le/1.67/<ou>/news/`) and homepage links before saying
anything is missing.

## Read the lecture that assigned it before building

Before drafting any graded deliverable, find the session that assigned it
(the master sheet's "Assignment(s) Given" column, or the course calendar),
make sure that deck is on disk, and read it whole. The dropbox brief is a
summary. The lecture is the spec. On 2026-11-02 the ACAD 185 A20 Hero's
Journey went in as 19 slides of text built from the dropbox brief. The W10S20
deck that assigned it asks for an AI-image storyboard ("Words are generic.
Pictures are specific", Nano Banana, one character bible), and that deck had
never been pulled. Angie caught it the night before it was due. Name the deck and
its slide in the build's SPEC file, or the draft hasn't started.

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

## Did it get submitted: the receipt email answers when the API can't

When `brightspace` 403s and the session won't renew, search the student's USC
Gmail for `from:brightspace@usc.edu "Submission receipt"`. Every dropbox upload
sends one naming the folder, the file and the time. No receipt for a folder
means it wasn't submitted through Brightspace, so say that plainly and name the
deadline. On 2026-10-30 that one search answered "did we submit our slides?"
in seconds while the API stayed blocked.

## A lab or study sheet for someone who knows nothing

Open with the big picture in plain words (what the lab is for, the 2 or 3 ideas
every step uses), then give each part one line on what they're doing and why
before its steps. Write it in full English, never chat shorthand: a sheet
written with u, ur and w came back on 2026-10-30 as "MAKE IT ENGLISH", and
`chewbacca pdf` now names any shorthand it finds. Post-lab answers copy the
worksheet's layout: every question word for word with its points, the answer
under it.

## A homework list for a performance class carries the material

A list of what to practice or record (guitar videos, a recital set) is used
with the instrument in hand, so each item gets the thing to play under its
title, not just a page number. The class slides usually already hold the book
excerpt: find the slide by its "p.53, Ex. 9-5" label with `pdftotext` per
page, render it with `pdftoppm -r 200`, and crop to the white music area.
Order assignments oldest first, the way they're worked through. Before
building, pull new slides with `chewbacca usc lockin --apply`, since a class
after the last pull can add an item. Say which items the slides only show in
part.

Caleb, 2026-10-19, on a titles-only guitar list: "put the sheet music on there
too I don't wanna have to open my book", then "make assignment 1 first and then
assignment 5 last".

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
- Asked "is it as good as Andy's?" or "is it ready?" near a deadline: name the
  weak spots AND fix them in the same turn, then recheck the word cap and
  `slop-check --essay`. Never end on "want me to fix those?" (Caleb,
  2026-10-21, ACAD 324 Quiz 2 at 11:28pm: the offer drew "Lock in", which
  meant he'd already said yes).
- Before calling a graded deliverable final, read the assignment's own
  guidelines file and check the draft against every format rule in it,
  references most of all. On 2026-10-29 the BISC lab deck had sat "done"
  since 10/26 with "et al." on every reference, while Presentation
  Guidelines.pdf p17 says to list all authors "in this exact format". That
  was found the night before it was due. Pull full author lists from PubMed
  esummary by PMID. Title search returned the wrong paper for 3 of 6.
- "Lock in" or "what else do we have" means do the next item, never ask which
  one (Caleb, 2026-10-29: "We gotta lock in tn" got a question back and the
  turn was refused). Pick by points and due date, say the pick in one line,
  start it.

Before drafting any argument essay, read the assignment prompt PDF and the
instructor's sample essays in full, and write down the prompt's actual job
(for a "how does this practice discourage engagement" prompt: name ONE
practice, prove OTHER students have the engagement problem, say why it
matters). The thesis has to be something a reader could argue with. The
user's personal story is evidence for that claim and can't stand in for it.
On 2026-10-21 a WRIT 150 draft built from his outline notes, with no prompt
or samples read, came back as "It sucks sounds ai slop is not creative at
all barely has an opinion and isn't aligned with the prompt be methodical".
It had taken the safest take available (AI bans are bad) and spent most of
its words on his own growth. The redo read the prompt and samples first,
modeled the blunt-thesis sample, and put a sharper practice on trial.

Before drafting any argument essay, read the assignment prompt PDF and the
instructor's sample essays in full, and write down the prompt's actual job
(for a "how does this practice discourage engagement" prompt: name ONE
practice, prove OTHER students have the engagement problem, say why it
matters). The thesis has to be something a reader could argue with. The
user's personal story is evidence for that claim and can't stand in for it.
On 2026-10-21 a WRIT 150 draft built from his outline notes, with no prompt
or samples read, came back as "It sucks sounds ai slop is not creative at
all barely has an opinion and isn't aligned with the prompt be methodical".
It had taken the safest take available (AI bans are bad) and spent most of
its words on his own growth. The redo read the prompt and samples first,
modeled the blunt-thesis sample, and put a sharper practice on trial.

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

A lab or section schedule is a syllabus too. Every row in its week-by-week
table (each pre-lab, post-lab, quiz) gets its own ledger row, then count both
sides and they must match. On 2026-10-29 the BISC ledger had Lab 2 to 6 pre and
post-labs but no Lab 7, due the next morning at 10:00 with no late credit, and
it only surfaced because Caleb asked "Is the bisc pre lab and slides the only
things I should do tn". When he asks what's due tomorrow, read the schedule
table for that week too, not just `coursework due`.

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

To ingest a new one, `"$(chewbacca where)/apps/texts/ingest/ingest.py" scan <pdf>` prints the
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
- **A date moves in an announcement or a class slide** and the ledger still
  carries the syllabus or prompt-PDF date. Before calling anything due on a
  day, read the last two weeks of announcements (`/le/1.67/<ou>/news/`, full
  Body) and the newest class deck's agenda slide. On 2026-10-16 a Saturday
  prep pass found three moves the ledger missed: WRIT 150 WP2 revised draft
  Oct 19 to Oct 21 (Chappelow's 10/12 "Correction of Dates"), ACAD 324 Quiz 2
  Oct 19 to Oct 21 and the P3 team eval Oct 14 to Oct 19 (Davina's 10/12 and
  10/14 slide agendas). The plan would have pointed him at the wrong Monday.
- **A sign-up sheet is not the whole record.** Before calling a conference,
  meeting or extension missed, search his school inbox for the instructor
  (`GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.chewbacca/email/<address> gws gmail
users messages list`, `q: "<instructor email> newer_than:14d"`). On
  2026-10-16 the WP2 conference sheet had no Caleb on it and the plan called
  it missed, but he had emailed Chappelow on 10/14 to reschedule and an unread
  reply offered Monday.
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

## Registration and advisor questions (USC)

Lessons from 2026-10-28, when "DID WE MISS THE EARLY REGISTRATION DATE" took 15 minutes to answer:

- A USC registration appointment is when the window OPENS. It stays open through the add deadline (Jan 29 for Spring 2027). Lead with that line, then the exact time.
- Exact time: `chewbacca api call usc-reg registrationAppointment term=<YYYYT>`. If it returns `HTTP 302` for every term (Fall too), the WebReg Entra/Duo login lapsed and `api renew` won't fix it. Open webreg.usc.edu in his Chrome and say BLOCKED: Duo Touch ID, in the first reply, not after three retries.
- Registering, or a checkout that failed: read `references/webreg-registration.md` first (no partial checkout, D clearance, GE codes, RMP picks).
- RNR88 on the appointment page is the priority-registration flag (OSAS), never a hold.
- Advisor emails (Adrian Coson, coson@usc.edu) are searchable through the Gmail connector: `from:coson@usc.edu`. "Advising Recap - <date>" threads are his written record of each meeting. Before repeating anything "Adrian said" (a promise, a contact, a waiver), read the recap and quote it. On 10/28 Caleb remembered intros for a GE waiver; the 9/22 recap promised none and said a waiver would be a first.
- "Read Adrian's email" means the newest coson@ thread plus the audit it replies to, then the class sections: `usc-classes getSections` for each required course, and the GE double-count list (dornsife.usc.edu/ge/courses/double-count/) filtered against his fixed classes. Do the section search unasked; don't offer it.
- GE core literacies A to F must be taken in residence at USC, which makes a GE-B or GE-C waiver unlikely. Tell him to register the GE anyway, since dropping is refundable until the add deadline.
- Any question about which GEs or major requirements are left: read STARS first, never infer from notes or an advisor email. ExperienceUSC > My Academics > View STARS Report opens stars.usc.edu in a new tab, readable as text once signed in. On 10/28 a reply guessed whether GE-H was owed and Caleb wrote "Bro dont u have access to my course history and ap history". STARS showed H was already done by AP World.
- WebReg holds only show at /Restrictions and /Checkout. A "mandatory advisement requirement" there blocks Register even when the appointment is open. Check Checkout before telling him he can register, and ask the advisor to lift it in the same turn.
- WebReg course lists (/Courses?Program=XXX) are collapsed accordions. Clicking an Add button inside a collapsed row does nothing and reports no error. Expand the course header first, click Add, confirm the button reads "Added to Course Bin", then read /CourseBin.
- Read each section's PRE-REQUISITES line before picking it. PSYC 367 needs PSYC 100 and nearly went into his schedule.
- IYA requirement swaps need the dean's approval (Adrian, 10/28). A waiver doesn't reduce the 128 units, so pitch swaps (ACAD 176 to ACAD 490, 2nd ACAD 174 to ACAD 406), not skips.

### Rearranging a schedule (Caleb, 2026-10-31)

"we gotta close the gaps... ending class way too late bruh", then "Break it down simply what are my options?"

- Pull the whole term from classes.usc.edu (`/api/Programs/TermCode`, then `/api/Courses/CoursesByTermSchoolProgram` per program; `geCode` 31 = B, 32 = C) and check every candidate's sections for discussions. A lecture that fits TTh can still add a Friday discussion, and that breaks "keep MWF free". On 10/31 every TTh 12:30 GE-C had one.
- A course counts as B+G only if its geCode is 31 AND it's listed with a "gw" suffix on Dornsife's double-count page. A "gw" with code 30 or 32 is A+G or C+G.
- Give the options as numbered day timelines, at most 3: the times, when he's done, what it costs (extra day, prof RMP), then one pick. Never a wall of section ids and discussion numbers on the first pass. He asked for the simple version right after the detailed one.
- Swapping a registered class: add the new section first, then drop the old one, so a failed add never loses the seat.
