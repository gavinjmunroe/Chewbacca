---
name: feedback_ff_work_lives_in_ff_repo
description: Firm Foundation work goes in gavinjmunroe/firm-foundation, never a side repo under one founder's account; a handoff is done only when a fresh clone as the recipient builds
metadata:
  type: feedback
---

Firm Foundation's work lives in the shared repo, github.com/gavinjmunroe/firm-foundation (private, both founders can push). The hero video lived for a week in calebnewtonusc/ff-hero-video, which Gavin couldn't open. On 2026-10-18 an agent invited him, read back "invited, write" and told Caleb the handoff was done. The invite was never accepted, so at 12:28 AM Caleb wrote "Gav said he checked the repo and couldn't access/edit the vid?" and then "Bro just put all FF things in the FF repo bruh".

The fix was to bring the video in under `video/` with `git subtree add --squash` (history stays in the old repo, which now says Moved), plus the sources a tool needs to rebuild, the latest render and the notes, then prove it by cloning fresh from GitHub, typechecking and rendering one frame.

How to apply:
- New FF work (video, site, outbound, research) starts as a folder in the FF repo, never as its own repo.
- A handoff isn't done until a fresh clone, the way the recipient gets it, has every file the handoff doc names and builds. Neither an invite nor a push to a repo they can't open counts.
- Inviting someone means they still have to accept. Say that and send the invitations link, or skip the invite and use a repo they can already reach.
