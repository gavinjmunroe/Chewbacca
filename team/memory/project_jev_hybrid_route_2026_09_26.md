---
name: project_jev_hybrid_route_2026_09_26
description: Hybrid skill router (code, Jev, haiku) calibrated 9/26 at 0.48; sealed 60-case test run 10/10, cascade 58/60 vs keyword 41/60; haiku and sonnet arms still owed
metadata:
  type: project
---

State at 2026-09-26 23:00, from the Codex handoffs continued in Claude.

**Chewbacca PR #3** branch `codex/portable-ux-learning-publication` is at bec880e, pushed: Gavin's main merged in, `tools/hybrid_route.py` (code, then Jev, then `claude -p --model haiku`, with budget, verifier, resume) and its harness. Full suite before the last fixes: 373 passed, 4 failed; amber-mcp and hud one-model-process are fixed, checksums resolve on commit, `start.ps1 installs into a clean HOME` is still unexplained. CI on the new push not yet read.

**Sealed result, 2026-10-10.** Run on `test.sealed.json` with the frozen code from bec880ef (hashes match `freeze.json`), threshold 0.48 untouched. Accuracy on 60: none 29, keyword 41, Jev 58, cascade 58 (Wilson 95% 0.886 to 0.991). Calibration was cascade 39/40 (0.975), so 0.967 holds within noise, no regression. The cascade escalated 0 of 60, so on this set it is Jev alone; McNemar vs keyword 17 to 0. Median latency: keyword 9 ms, cascade 281 ms (p95 1.0 s). Cost about $0.0005 per case. **haiku and sonnet arms are NOT run**: every `claude -p` call hit the subscription's weekly limit (429). Rerun per arm after the reset; the harness resumes. Results and notes are in `runs/hybrid-sealed/` in the experiment dir. Separately, on 10/3 the same sealed file scored the shipped skill-route.sh: vector 48/60, stem 41/60 (`runs/router-sealed/`).

**Jev experiment** lives outside the repo at `~/Documents/Codex/2026-09-26/jev-hybrid/` because Jev figures are private (TypeSafe 2.3(f)). Calibration (40 cases): keyword 29, Jev 38, haiku 38, sonnet 39; threshold 0.48 fitted. `freeze.json` is written. The sealed set has now been scored (above), except for the haiku and sonnet arms.

**Finding:** `claude -p` loads the person's auto-memory even with `--setting-sources project` and `--system-prompt`. It answered a routing question with his own project list. `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` stops it; the router also refuses answers whose token count shows extra context.

**Closeout fix** is on branch `fix/closeout-fast-and-suite-list` (6c7721a), pushed, **not on main**: closeout found 0 of 15 suite groups so it never fanned out, now streams, has `--fast`, and vibe-guard calls it. Needs one full suite run before landing on main.

**Brain mirror** fixed and pushed (6613ade2): bridge logs and the jev-ultrafast clone excluded.

**Why:** so the next session does not rerun calibration or treat the router as proven.
**How to apply:** finish the haiku and sonnet sealed arms, never refit 0.48 on sealed rows, then land the closeout branch. Related: [[feedback_one_job_not_six]], [[feedback_seal_the_test_set]].
