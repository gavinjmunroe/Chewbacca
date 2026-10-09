---
name: project_jev_hybrid_route_2026_09_26
description: Hybrid skill router (code, Jev, haiku) built and calibrated 9/26; sealed 60-case test NOT yet run; closeout fix on a branch, not main
metadata:
  type: project
---

State at 2026-09-26 23:00, from the Codex handoffs continued in Claude.

**Chewbacca PR #3** branch `codex/portable-ux-learning-publication` is at bec880e, pushed: Gavin's main merged in, `tools/hybrid_route.py` (code, then Jev, then `claude -p --model haiku`, with budget, verifier, resume) and its harness. Full suite before the last fixes: 373 passed, 4 failed; amber-mcp and hud one-model-process are fixed, checksums resolve on commit, `start.ps1 installs into a clean HOME` is still unexplained. CI on the new push not yet read.

**Jev experiment** lives outside the repo at `~/Documents/Codex/2026-09-26/jev-hybrid/` because Jev figures are private (TypeSafe 2.3(f)). Calibration (40 cases): keyword 29, Jev 38, haiku 38, sonnet 39; threshold 0.48 fitted. `freeze.json` is written. **The sealed test set (`test.sealed.json`, 60 cases) has NOT been opened or run.** Next step is `hybrid_route_eval.py run test.sealed.json` with all six arms, one job at a time.

**Finding:** `claude -p` loads the person's auto-memory even with `--setting-sources project` and `--system-prompt`. It answered a routing question with his own project list. `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` stops it; the router also refuses answers whose token count shows extra context.

**Closeout fix** is on branch `fix/closeout-fast-and-suite-list` (6c7721a), pushed, **not on main**: closeout found 0 of 15 suite groups so it never fanned out, now streams, has `--fast`, and vibe-guard calls it. Needs one full suite run before landing on main.

**Brain mirror** fixed and pushed (6613ade2): bridge logs and the jev-ultrafast clone excluded.

**Why:** so the next session does not rerun calibration or treat the router as proven.
**How to apply:** run the sealed test first, then land the closeout branch. Related: [[feedback_one_job_not_six]], [[feedback_seal_the_test_set]].
