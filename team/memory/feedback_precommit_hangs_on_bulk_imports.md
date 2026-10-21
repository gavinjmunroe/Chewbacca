---
name: feedback_precommit_hangs_on_bulk_imports
description: .githooks/pre-commit greps the write-log once per staged file, so a 5,217-file import (amber/, 2026-10-20) ran 40+ minutes without finishing
metadata:
  type: feedback
---

The two-sessions check in `.githooks/pre-commit` runs `grep -F` over
`~/.chewbacca/write-log.tsv` once per staged path. On 2026-10-20 the `amber/` import
staged 5,217 files and the hook was still in that loop after 41 minutes.

**Why:** the check is O(staged files x log rows), fine for a 10-file commit and hopeless
for a repo import.

**Fixed the same night:** the authorship check is one awk pass over the log, and the
mtime check is one `stat` call for the whole list. A 3,000-file commit against a
100,000-row log went from 27 s to 1 s; `tests/precommit_authorship.sh` fails past 30 s.

**How to apply:** if a commit hook runs past a minute, look for a per-file subprocess
before reaching for `--no-verify`, and fix the loop.
Related: [[project_amber_code_lives_in_chewbacca]], [[feedback_push_race_retry_loop]].
