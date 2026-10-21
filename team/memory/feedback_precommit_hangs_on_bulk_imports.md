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

**How to apply:** for a bulk import, build it in a detached worktree of origin/main whose
index holds only the import, commit there with `--no-verify`, and land the sha with
`chewbacca land <sha>` so pre-push still checks it. The real fix is one pass (load the
log into an awk map, then read the staged list) so the hook scales; not done yet.
Related: [[project_amber_code_lives_in_chewbacca]], [[feedback_push_race_retry_loop]].
