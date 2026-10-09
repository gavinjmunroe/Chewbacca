---
name: project-chewbacca-live-checks
description: Chewbacca gained `chewbacca live` (real-tool checks with mutants and honest SKIPs) and `chewbacca guide` (study guides with a progress sidecar), ported from Carlton Aikins' realm
metadata:
  type: project
---

2026-09-11. Six patterns pulled from `31Carlton7/realm` into Chewbacca, all
pushed to main.

**`chewbacca live`** is the load-bearing one. `tests/run.sh` is hermetic and
cannot tell you a tool is installed-but-unusable; `doctor.sh` asks whether a
binary is on PATH, which is a different question. Live checks drive the real
binaries with three states, and a SKIP is printed next to the count and never
counted as a pass. Every assertion carries a mutant that must fail.

It immediately found four real bugs:
- `people` was unusable on a **fresh** database: `ensureColumn` on `messages`
  ran two lines before `SCHEMA_V3` created that table.
- `setup.sh` **copied** tools into `~/.local/bin` instead of symlinking, which
  is the exact cause of the 2026-09-07 three-day outage. Fixed to symlink;
  `tests/live/people.sh` now asserts the link.
- `people dedupe` required a matching company, so **79 duplicate pairs** were
  invisible in the real store, Carlton and Tyler Larsen among them. Caleb has
  NOT bulk-merged them yet.
- `mac doctor` reports Calendar as **writeOnly** on this machine, so calendar
  reads return empty rather than erroring.

**`chewbacca guide`** builds one self-contained HTML study guide (quizzes,
step-throughs, flashcards) plus a `.progress.json` sidecar. Served over
localhost by `guide open` so results reach disk; opened as `file://` it can
only reach localStorage and the page says so. `guide progress` is what lets a
later session start on what was missed. See a private note and
the `study-system` skill.

Also added: a rule routing corrections (judgment to a doc, mechanical failure
to a test), a rule that constants carry the evidence that set them, a
scan-must-not-write rule, and a refusal in `chrome-js` to read password fields
in any mode. `docs/THREAT-MODEL.md` documents realm's keychain design as the
real bar and says plainly that Chewbacca does not implement it.

Carlton wrote mac-cli and Plynn, which Chewbacca already shipped. See
a private note.
