# Running a semester through Claude

This kit spent its first six months being good at code and blind to everything
else. That is a strange gap for a tool a student uses every day, and it showed
up the same way every time: Claude re-reading a syllabus PDF to answer a
question the PDF had already answered, then giving an answer nobody could check.

The fix is not a bigger prompt. It is turning the syllabus into data once, and
then never guessing again.

## What a syllabus actually is

It is the most structured document a student is handed all year:

- every date they will be graded on
- the exact arithmetic of what an absence costs
- a written statement of what help is permitted
- the regrade window, the late schedule, the makeup rules

All of it is binding, none of it is in a format anything can read, and it is
read once during syllabus week and then filed.

## The ledger

```
$COURSEWORK_DIR (default ~/coursework)
  semester.yml        term dates, registrar milestones, breaks
  courses/*.yml       one file per course
  syllabi/            the source PDFs
  templates/          copies of the two templates, for reference
```

Start it with `/syllabus <path>`. That command loads the `coursework` skill,
reads the whole PDF, and writes one course file. It takes a few minutes per
course, once a term. Everything after it is a shell call.

The shape is in [library/templates/coursework/course.yml](../../library/templates/coursework/course.yml).
The parts that matter:

**`absences`, as numbers.** `allowed`, `used`, and the penalty in the course's own
words. This turns "can I skip Wednesday" into arithmetic.

**`source` on every deliverable.** The syllabus page a date came from. When a
date turns out to be wrong, this is the difference between a ten-second fix and
re-reading a PDF. When it changes in class, the new source is "announced in class
YYYY-MM-DD", which records on purpose that the ledger and the PDF now disagree.

## The CLI

`bin/coursework` is dependency-free Node, installed to `~/.local/bin` by
`setup.sh`. Every read command takes `--json`.

```bash
coursework due --days 14
coursework today
coursework week --days 7
coursework attendance ACAD
coursework grade BISC --target 90
coursework policy WRIT ai
coursework ics --out ~/Desktop/semester.ics
coursework check
```

Three design decisions worth stating, because each one was a choice:

**It never writes.** Deadlines are facts copied from a document. A program that
rewrites them can silently disagree with its own source, and then the ledger is
one more thing to distrust. Claude and the user edit the YAML; the tool reads it.
The single exception is `ics`, which writes a calendar file somewhere else
entirely.

**It refuses to model contract grading.** Labor-based writing courses do not
average scores; they count infractions against a step table. `grading_model:
contract` makes `coursework grade` print the policy instead of a number, because
a number there would be fiction with a decimal point.

**`check` fails on omissions, not just on errors.** A ledger that parses
perfectly and has a deadline with no source is worse than one that will not
parse, because it looks finished. So a missing `source` and a past-due item
still marked `todo` are both reported.

## The parts Claude brings

The CLI answers "what" and "when". The skills handle everything that needs
judgment.

**`coursework`** owns the ledger: how to read a syllabus into it, the three
and the grading models.

**`study-system`** exists because rereading feels like learning and mostly is
not. It defaults to asking rather than telling, builds retrieval questions and
cards from lecture material instead of summaries, plans exam run-ups backwards
from a diagnostic, and runs a four-cause postmortem on a returned exam. The
distribution of causes is the prescription, and it is usually not "study more".

**`life-ops`** covers the half of the week that is not class or code: the weekly
review, the non-academic deadlines that have no reminders attached, the
commitments made in passing, and what to cut when the week does not fit. Its
central rule is to plan against real capacity rather than the ideal version of
the person, because a plan built for someone with eight hours of sleep and no
surprises fails on Tuesday and then feels like a character flaw.

## How AI gets used is the student's call

Chewbacca never reads, stores, quotes or gates on a course's AI policy.
Those policies are written for students to read and decide on, and an
assistant that polices them reads as invasive and turns people away. A test
(`tests/no_ai_policy_gate.sh`) fails the build if the gate ever comes back.

## Brightspace

`brightspace-sync` reads your own Brightspace courses and does the paperwork
around them. It reuses the browser session that `api-anything` imports, so you
sign in to Brightspace in Chrome once and run `api-anything login
<your-brightspace-host> --profile "Chrome/<profile>"`. Set `BRIGHTSPACE_HOST`
if your school is not USC.

```bash
brightspace-sync due --days 30                        # everything on your course calendars
brightspace-sync reminders --exams --apply            # into an Apple Reminders list
brightspace-sync files BUAD-280 --from-chapter 4      # preview, then add --apply
brightspace-sync transcripts BUAD-280 --from-chapter 4 --apply
```

It never writes to Brightspace, waits 4 to 8 seconds between requests, and stops
on the first 401, 403 or 429. Scans show what they would do and change nothing
until you pass `--apply`. Lecture transcripts come from Panopto captions and
exist only where the instructor published them.

## Privacy

The machinery is public and the ledger is not. This repo contains the CLI, the
skills, the commands, and two templates. It contains no courses, no professors,
no deadlines, no grades.

Keep `~/coursework` in a private repo, or inside the private personal-context
repo that `setup.sh` creates. The generated `.ics` and any exported study
material carry the same rule.

## Setup

```bash
./setup.sh                  # installs the CLI, creates ~/coursework
/syllabus ~/Downloads/my-syllabus.pdf
coursework check
coursework ics --out ~/Desktop/semester.ics   # then import once
./doctor.sh                 # verifies the CLI and validates the ledger
```

The SessionStart hook picks it up from there and puts the next deadlines into
context before the first question of every session.
