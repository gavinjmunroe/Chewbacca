---
name: feedback_inferred_authorship_misfires
description: Write-log "bash" rows are diff-inferred, so every guard that reads them (pre-commit, Stop hook, tab board) blames the wrong tab; check edit rows before believing "belongs to another session".
metadata:
  type: feedback
---

On 2026-10-09 with eight tabs live, one file (tools/tabs.py) was logged under five sessions and only one wrote it. Every "bash" row in ~/.chewbacca/write-log.tsv is a before/after tree diff, so any tab that ran a command in the same window gets credited. The pre-commit authorship guard then refused my own files three times, the Stop hook said other tabs' files were mine, and `ALLOW_STALE_STAGED=1` became the routine bypass. That same bypass is when an emptied setup.sh (0 bytes, staged with the empty file's checksum) nearly shipped, so the empty-file gate in .githooks/pre-commit now runs before it.

**Why:** a guard that cries wolf trains everyone to bypass it, and the bypass is when the real failure gets through.

**How to apply:** before believing an attribution, check `awk -F'\t' '$4=="edit"'` rows for the path. The tab board already uses edit rows only ([[reference_tab_board]]). The pre-commit and Stop hook still read bash rows and need the same fix.

Same night, a second way a commit went wrong with eight tabs live: I built a commit with `commit-tree` from a `setup.sh` I had read from HEAD a minute earlier. Another tab committed 153 lines to setup.sh in between, so my commit silently reverted them (b4309a73, repaired in 67669c85). Then a `python edit.py < setup.sh > setup.sh` whose assert failed truncated the file to 0 bytes. **How to apply:** in a shared checkout, build any plumbing commit inside a fresh worktree at the current HEAD, check `git diff --stat <parent> <new>` touches only your lines before moving main, and never redirect a script's output onto its own input file.

**Fixed further 2026-10-09.** stop-check credited a todo tab with the api tab's usc-jobs files and another tab's AGENTS.md rewrite every turn, because the todo tab's shell ran last. Now a shell-only claim loses to any other session's row for that file at any age, and the repeat-warning fingerprint is keyed per session (it was per repo, so every tab overwrote it and the same warning re-fired 10+ times). tests/stop_check_authorship.sh covers it. Live hooks are copies, so a fix needs installing: [[feedback_live_hooks_are_copies]].

**Also 2026-10-09, the long-call case.** A 10-minute `cd ~ && uv cache prune` was credited with 494 brain transcripts an ingest tab wrote during it, because context repos are watched on every shell call. write_log now ignores unnamed context-repo changes from calls over 60s (8c3dd889, test in tests/test_write_log.py). Short calls can still misattribute.
