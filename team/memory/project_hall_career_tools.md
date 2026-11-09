---
name: project_hall_career_tools
description: Tyler Larsen's 4 recruiting tools live in calebnewtonusc/hall under career/, imported by subtree w history on 2026-10-30
metadata:
  type: project
---

"chewbs/hall" means the private repo calebnewtonusc/hall (the USC student
layer, cloned at ~/code/hall), not a folder in Chewbacca.

On 2026-10-30 Caleb said to funnel all of Tyler Larsen's repos into it. Four
went in with `git subtree add --prefix=career/<repo>`, history kept:
career-monitors, networking-engine, internship-scanner, career-page-monitor
(an older career-monitors). Left out: his claude-cookbooks fork (Anthropic's)
and his Chewbacca copy. `bash tests/career.sh` runs their 234 pytest tests and
prints skip w the missing module when deps aren't installed.

**Why:** the GitHub Actions crons inside career/*/.github don't run from Hall,
since Actions only reads the root .github. They still run in Tyler's repos.

**How to apply:** for a new Tyler tool, subtree add it under career/ the same
way, scrub any prompt that names him (Hall's rule: nothing keyed to one
person), and add it to career/README.md. Related: [[project_tts_tcombinator_sites]].
