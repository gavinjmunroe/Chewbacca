---
name: feedback_solved_jobs_need_a_front_door
description: A fix buried inside one tool doesn't exist for anyone else; every solved job gets a general command, and hand-rolling it gets pointed there
metadata:
  type: feedback
---

When the kit solves a general job inside one tool, give it its own command. Otherwise the next session rebuilds it by hand and hits the same bug again.

**Why:** On 2026-10-11 at 9:56pm, making PDFs of four briefs took minutes: a hand-rolled pandoc + Chrome --print-to-pdf pipeline waited on a Chrome that never exits after printing. The fix for exactly that bug had shipped on 10/10 inside the GTM report (`gtme_operator.to_pdf`), and nobody making a PDF would have looked there. Caleb: "Bro this should be a 2 sec task wtf???" and then "Fix chewb so u never take forever on smth that should take 2 seconds find the root core".

**How to apply:**

- A routine that does a general job (PDF, inbox read, sign-in, file conversion) gets a `chewbacca <job>` front door the same day it's fixed, with a test that times it.
- Before hand-rolling a pipeline, run `chewbacca --help` and `chewbacca skills <job>`.
- `use-the-kit-guard.sh` refuses the hand-rolled version and names the command. It's a table: add a row whenever a solved job gets rebuilt by hand.
- Now in place: `chewbacca pdf` (about 1.6 s a file, 72239b7c).

See [[feedback_fix_the_class_at_the_source]] and [[feedback_find_the_existing_thing_first]].
