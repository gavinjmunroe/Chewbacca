---
name: feedback_chewbacca_full_suite_is_slow
description: "tests/run.sh was serial at ~15 min; parallel at ~6 since d8efb90, plus suite-rerun and repo-overlap gates. Touched tests first, one tab per repo"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 5987f607-bd49-4447-b607-c7767df8939f
  modified: 2026-10-03T20:15:49.769Z
---

On 2026-10-03, saving the work Codex left behind took hours, and Caleb asked "smth's gotta be wrong with our process if it's taking this long every time." He was right. Most of the time went to:

- `bash tests/run.sh`, run serially four times at about 15 minutes each. Its hud group also runs `pytest tests/`, which reruns the whole Python suite, about 5 more minutes, inside the same run.
- Three Claude tabs and Codex all working in the Chewbacca checkout at once. One tab rewrote `tests/run.sh` mid-run and crashed it. Two tabs pushed to main mid-run, so I had to rebase twice.
- Codex's review gate uses Codex to review Codex. The tabs that hit the usage limit were the "full review" tabs, so the gate likely spent the quota itself (inferred, not measured).

**Why:** a slow gate gets run less, or it eats the session it was meant to protect.

**How to apply:** fixed in Chewbacca `d8efb90`. `bash tests/run.sh` now runs its groups in parallel, slowest first, in 6 minutes instead of 15. The floor is the `pytest` group at about 6 minutes. After a focused change, run the touched test files and their group, and run the whole suite once at the end. Give one tab ownership of Chewbacca at a time, and have other tabs work in worktrees and push from there. Related: [[feedback_one_job_not_six]], [[feedback_always_land_on_main]], [[feedback_enforce_dont_document]].
