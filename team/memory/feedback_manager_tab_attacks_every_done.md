---
name: feedback_manager_tab_attacks_every_done
description: A tab managing other tabs drives them and attacks every done claim on a clean copy of main before accepting it; idle tabs get reused for new work because event turns can't start sessions
metadata:
  type: feedback
---

A manager tab drives the other tabs. It doesn't wait for them to report in. Caleb, 2026-10-16 4:43pm: "You haven't been managing them." Then at 4:47pm: "I need you to see when a session is complete, bc often times it is a false positive there's more stuff to do and things that were broken that were missed."

What worked that night:

- Attack each done claim on a detached worktree of origin/main, never by reading the tab's recap. In about 10 minutes each, the attacks broke next_move twice (a move with no kind crashed the loop, and a delete labeled "write" plus a send phrased "reach out by email" got past the boundaries) and launch-guard once (a fake dir with an empty .git plus the registry file let arbitrary test code run). All three tabs had green tests. The harnesses are kept as scripts so the next round reruns them.
- Check that "on main" also means "installed". break-it-guard landed but wasn't in ~/.claude/settings.json, so it refused nothing live. The tab was waiting for a yes Caleb had already given in another tab. Forward his exact words, with the time.
- Start the work tabs yourself, so their finishes wake you. A turn started by an automated event can't start a new session, so give a finished idle tab its next job by message instead. Rename it to match the new job.
- Archive a tab only after its commits are verified on origin/main. Archiving a parent also archives finished side sessions.
- A hook that matches words fires on the wrong domain: ready-guard refused a reply about ACAD 185 assignments as a Zeutara launch claim. Send false fires to the hook's owner as test cases.

Related: [[feedback_claims_match_the_mechanism]], tools/break_it.py.
