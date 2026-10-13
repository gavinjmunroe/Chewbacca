---
name: feedback_tests_never_reach_the_screen
description: Suite groups have a 1200 s deadline and the pytest group runs only pytest files; send codes from tests, no-send runs and queued jobs never reach the HUD; real dialogs in tests are opt-in (2026-10-13)
metadata:
  type: feedback
---

On 2026-10-13 three things a test run did on Caleb's Mac all came from one habit,
code that assumed someone was watching:

- Job 1013-094230-c180 ran the full suite 3 h 35 min at load 170 with an empty
  log. Its pytest group handed pytest the whole tests/ folder; pytest imports
  every script-mode test file, which runs it, so one serial process reran all
  254 files the other groups already ran, and printed nothing until the end.
  Now each group runs under bin/lib/suite-group.sh (1200 s, then HUNG with the
  stuck process named), and pytest gets only tests/pytest_files.sh's list.
  The pytest group went from never finishing to 107 s.
- At 1:52pm a USC food test drew a real "usc-order to Bowls" send code on the
  live HUD. tools/send_approval.py unwatched() now sends any code from a test,
  CHEWBACCA_NO_SEND, CHEWBACCA_SUITE or a queued job (CHEWBACCA_JOB) to nowhere:
  the send is refused and the fake sink file notes it without the code, since
  every one of those markers is one an agent can set.
- tests/test_appctl.py opened a real "Permanently delete all 172,703 items?"
  dialog on every suite run. It's opt-in now (CHEWBACCA_LIVE_DIALOGS=1).

**How to apply:** a test never draws, notifies or opens a window by default;
put live checks behind an env flag. A test reading real data (Chrome cookies,
Brightspace, ~/coursework) is a bug even when it passes: use a scratch HOME and a
fixture, as tests/chewbacca_usc.sh does now. Related:
[[feedback_workers_never_wait_on_tail]], [[feedback_slow_means_broken]].
