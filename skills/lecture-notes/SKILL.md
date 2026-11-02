---
name: lecture-notes
description: "Answer questions from a lecture, clean up class notes, fold in a transcript, and turn a lecture into flashcards and a study guide. Use during or after a class."
triggers: >-
  During or after a class: answer a question from what the lecture just covered, clean up notes typed in class, fold a recording's transcript into the notes, answer the questions left in the notes, or turn a lecture into flashcards and a study guide. Use for "wrap up today's lecture", "what did she mean by", "clean up my notes" or "make flashcards from class".
requires: [coursework, study-guide]
---

# lecture-notes: before, during and after a class

Adapted from realm's `lecture-notes` skill by Carlton Aikins
([31Carlton7/realm](https://github.com/31Carlton7/realm), MIT). Realm reads a
course folder through its own `docs_search`; here that's `rg` over the folder,
and the study guide is the kit's `study-guide` skill.

## Where a lecture lives

One Markdown file per class: `<course folder>/lectures/YYYY-MM-DD-<topic>.md`
(the BISC 101 folder at `~/code/school/bisc-101/lectures/` names them by
chapter instead, `ch04-the-cell.md`, and that's fine: follow whatever the
folder already does). Sections: `## Notes`, `## Questions`, `## Follow-ups`,
and `## Transcript` after a rule when a recording was transcribed.

If there's no file yet, make one with those headings and a front matter of
`course`, `title`, `date`. Find the course folder from the coursework ledger
(`coursework today --json`) before guessing a path.

**The lecture is the record.** The job is to organize and connect what was
said, never to write the lecture you'd have given. Mark anything inferred as
_(inferred)_.

## During class

The student is listening to someone else and typing in the same file.

1. Read the lecture file first, since its last few lines are the context.
2. `rg -i "<term>" <course folder>` across `lectures/`, `slides/` and `guides/`.
   The answer is usually in an earlier lecture or the slides; cite it by path.
3. Answer in two short paragraphs at most, then offer to go deeper.
4. A question sitting under `## Questions` gets its answer written in the file,
   indented under that bullet, so it survives the chat.

Never rewrite the notes while class is running.

## After class: the wrap-up

1. Read the whole file, where `## Transcript` is what was said and `## Notes` is what
   the student thought worth typing, which is the emphasis. With no
   transcript, work from the notes and course materials and say so at the top.
2. Connect: `rg` the lecture's main terms across the course folder, slides
   included, and note which earlier lecture introduced each idea.
3. Rewrite `## Notes` as structured notes: a heading per idea in the order
   taught, the student's own phrasing kept where it's theirs, transcript
   material added where the notes are thin, definitions on their own line,
   worked examples kept worked. About two screens at most.
4. Answer `## Questions` in place under each bullet, citing the transcript or
   the file. One the material doesn't answer says so and moves to
   `## Follow-ups`.
5. Keep `## Follow-ups` as a `- [ ]` checklist, adding what the lecturer said
   to do. A due date the lecturer announced goes in the coursework ledger in
   the same turn, with this file as its source.
6. Append `## Flashcards`: 8 to 15 `**Q:** / **A:**` pairs on the core ideas,
   no trivia.
7. Leave the transcript untouched, since it's the evidence.
8. Build or extend the study guide for the topic with the `study-guide` skill.
   Extend an existing guide on the same topic rather than making a second.
9. Reply in five lines: what changed, what to review first, what's still open.

## Before an exam

`guide progress` says which topics were missed. Build the review from those:
reread the lectures behind them, add questions to the guide's existing
quizzes (keep the `data-topic` slugs so the history survives), and name the
three things to redo by hand.

## Never

- Invent what the lecture said. No transcript and no note means "not covered".
- Rewrite the file while the student is typing in it.
- Edit or trim `## Transcript`.
