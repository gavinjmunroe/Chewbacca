---
kind: feedback
title: Four changes shipped to his presenter window while he waited to present
date: 2026-11-06
stability: stable
---

Caleb presented BISC 101's CRISPR talk at 10:00 on 2026-11-06. Between 9:59
and 10:14, while he sat in that room, four changes were pushed to the
presenter window he was about to use. The last landed after he had started.

The worst of them replaced the aid level. At 10:03 he asked for bullets
instead of the full sentence ("I needa yap to fill the time"); at 10:13 the
sentence went behind a disclosure and bullets became the page. He had
rehearsed against neither, and had learned the material that morning.

Afterwards: "Bro i ws j reading the bullet points and it wasnt coherent at all
the whole time", then "Fix chewbs bro u failed me. my grade is cookeeddddd
that was embarassing".

He was right on both counts. The transcript reads as the bullet list with "so"
between the items.

**Two things now stop it.**

- `live-event-guard.sh` refuses deploys, pushes and publishes from 30 minutes
  before a graded live event to 2 hours after, reading `coursework today
  --json` for type presentation, exam, quiz, interview or defense. The ledger
  had carried `type: presentation, at: 10:00` since the night before and
  nothing read it. `tests/live_event_guard.sh`, 15 assertions, four of them
  the actual pushes from that morning by shape.
- `skills/presenting/SKILL.md` owns how the aid gets built: the level is
  chosen from rehearsal out loud, never from what he asks for, and asking for
  a lower level gets both plus a line on which to lean on. The sentence is
  never taken away.

**The general lesson.** A tool in use during a live event is frozen. Anything
learned during it is written down and told to him in chat, never shipped under
him. The rule holds for a demo, a pitch, a client call and a presentation
alike.

**What it actually cost.** Less than it felt like: 42 of 42 rubric-checkable
items were in his talk, 1,315 words at 9.4 min against an 8-to-10 window, and
his cold Q&A answer about the BCL11A enhancer was correct and unprompted.
Scored against the real rubric PDF it reads 17.5 to 19 of 20. The damage was
to delivery, which is 3 of the 20 points, and to how it felt standing there.

## A git footnote from the same session

Two index mistakes made while landing these fixes, both worth not repeating:

- A temp index seeded with `cp .git/index` inherits whatever another tab left
  behind. Committing from it wrote trees missing four files HEAD already had,
  which silently deleted the guard, its test, the skill and this note. The
  files were still on disk, so nothing printed. Seed with
  `GIT_INDEX_FILE=$t git read-tree HEAD` instead, which starts from what is
  actually committed.
- `git reset -- .` to clear a stale entry resets the whole index, including
  other tabs' staged work. Name the paths.

## The gate that now stops it

`commit-deletes-guard.sh` (2026-11-06) works out what a commit would remove,
honouring a `GIT_INDEX_FILE` the command sets, and refuses when those paths
were not named after `--`. Twelve cases in `tests/commit_deletes_guard.sh`,
the first being this incident's exact shape. Registered in `setup.sh`, so a
fresh install carries it.

Two things it deliberately stands down for, both learned by it refusing the
commit that shipped it: a temp index that does not exist yet at hook time
(git reads an empty index as deleting everything, which is a blind spot and
not a judgement), and a command that seeds with `read-tree HEAD`, which is the
safe pattern.

One more habit this leaves behind: a commit written through a temp index does
not teach the real `.git/index` about the files it added, so `git status` will
keep reporting them as deleted afterwards. `git add` those exact paths once the
commit lands. Nothing is wrong with the tree; the index simply never heard.
