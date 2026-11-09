---
name: feedback_text_guard_needs_index_backstop
description: A guard that reads command text can't stop a commit hidden in script code; put the real check in a git pre-commit hook on the index, and keep its allow rule explicit
metadata:
  type: feedback
---

The commit-deletes text guard (tools/commit_tree_guard.py) went through 4 independent reviews on the night of 2026-11-08, in the isolated recovery repo /Users/joelnewton/Documents/Codex/2026-11-06/fahhh/work/recovery-chewbacca. Every round found new bypasses, each confirmed on a throwaway repo: `git ci` aliases, `$'-a'` quoting, early heredoc delimiters, then commits hidden inside perl, python, node, awk and osascript code with the word split ("gi"+"t"). Reading command text can't win against code that builds the command at run time.

**Why:** The fix that held was moving the check into `.githooks/pre-commit`, which reads the index git is actually committing. Even that failed review once, because it guessed which paths were named by parsing git's argv, and git accepts abbreviations (`--mess`) and value-taking options that made `--` look like a separator. Rewriting it so a removal passes only when listed in `ALLOW_DELETES` (or a real merge/pick removed it, checked against the reflog) closed it (local commit 13b88d19).

**How to apply:** For any agent guard, put the decisive check where the real state is (the index, the file system, the API response) and treat command-text checks as a first filter only. Never parse another tool's option grammar to decide what's allowed; require an explicit opt-in instead. Run a reviewer that actually executes the attacks before calling a guard done. Known gaps that stay open: `--no-verify`, `commit-tree` plus `update-ref`, and checkouts whose `core.hooksPath` doesn't point at the hook.
