---
name: feedback_bma_amber_push_to_main
description: BMA and Amber repos (togari-platform, amber-*, medha-*) take pushes straight to main; Karthik said never open a PR on them
metadata:
  type: feedback
---

Work on any BMA or Amber repo, togari-platform included, gets pushed straight to main. No PRs.

**Why:** Karthik's rule, passed on by Caleb on 2026-10-11 after two Togari fixes (#84 and #85) sat as PRs waiting on a review that nobody was going to do: "karthik told me never pr on anything bma or amber just push to main". Railway auto-deploys main, so a PR just leaves a fix undeployed.

**How to apply:** Work in a worktree off origin/main. Rebase, run the touched tests and `tsc --noEmit`, then `git push origin HEAD:main`. Read back the GitHub deployment for the new sha. The tests are the only review, so a red test stops the push. See [[feedback_railway_autodeploy]].
