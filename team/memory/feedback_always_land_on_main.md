---
name: feedback_always_land_on_main
description: Caleb's standing rule, 2026-09-21: finish on main, pushed, so anyone can pull and pick the work up; a feature branch is not shipped
metadata:
  type: feedback
---

Caleb, 2026-09-21, after a night's work sat on `feat/portal-hud` while main
had **zero** portal files:

> *"We good to close this tab and everything is on main in a way anyone
> could pull and easily pickup the work that has to be done? We should
> always push in that way"*

**Why:** a branch nobody knows about is indistinguishable from work that
never happened. He works across machines and with Gavin, Otis, Seabass and
Ravi, and the next session is usually a different context with no memory of
which branch anything landed on. Ten commits and 3,127 lines were one
forgotten branch name away from being lost.

**How to apply.** Before saying a session is done:

1. **Merge to main and push it.** Not "pushed the branch". `git log
   --oneline @{u}..HEAD` returning nothing on MAIN is the check.
2. **Verify the pickup.** Clone the remote fresh into a temp dir and run the
   documented command. That is the only proof the instructions work; it
   caught nothing this time and would have caught a missing bundled asset.
3. **Make the docs describe the present.** `docs/SPATIAL-OS.md` was still a
   plan for finished work, which is worse than no document, because the next
   person builds what it describes instead of what is missing. Rewrite a
   plan into a status report the moment the work lands.
4. **Say what is NOT done**, explicitly, in the same file.

Related: [[feedback_never_close_without_updating_chewbacca]] and
[[project_portal]].

2026-10-08, Caleb: "there should never be separate branches of chewbs." A worktree branch is fine while working, but it merges to main and gets deleted the same session; origin carries main only.

2026-10-08, Caleb: "Rmr always make sure there is just 1 branch, main". At the end of any session, check `git branch -a` in every repo touched: local and origin hold only main. A fork remote (gavin/*) is someone else's, so leave it alone. Delete one of ours only after confirming it is merged into origin/main.
