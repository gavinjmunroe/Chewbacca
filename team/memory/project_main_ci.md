---
name: project_main_ci
description: bin/main-ci runs the full suite on origin/main's newest commit on this Mac, on demand only; why it never runs unattended, and where results live
metadata:
  type: project
---

`bin/main-ci` (built 2026-10-10) tests the newest origin/main commit in a throwaway worktree through `chewbacca jobs` as build work, writes `~/.chewbacca/ci/results.jsonl`, and on red-after-green writes `~/.chewbacca/ci/RED`, posts a notification and names the `git bisect <last green>..<sha>` range. `main-ci status` shows recent runs and exits 1 when main is red. Tests: `tests/test_main_ci.py`, `tests/test_main_ci_sandbox.py`.

It exists because GitHub Actions has been dead since 2026-10-03 over billing (the ask to Sagar is draft #41), so nothing tested main itself.

It is on demand only. The first design ticked from launchd every 10 minutes; a security review called that unattended remote code execution for anyone with push access, and a second review broke the sandbox-exec blocklist added in response (IPC, persistence, egress). `main-ci install` now refuses unless `MAIN_CI_ALLOW_UNATTENDED` is set, and the sandbox stays as a backstop. Unattended runs belong in GitHub Actions or a throwaway VM. See [[feedback_denylist_gate_is_a_backstop]].

Under load a queued run waits: at load 27 to 33 on 10/10 the first run on main never got admitted while the tab was open.
