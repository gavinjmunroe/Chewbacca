---
name: feedback_clay_api_vs_ux
description: "Clay work picks the faster surface per job, API when it answers, UI when only the UI can; route table lives in the clay-navigation skill."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 380d5ca0-cf58-46a3-9497-41e9d7e2940e
  modified: 2026-10-09T07:40:04.915Z
---

Caleb, 2026-10-09, watching a reply read drive the Clay page campaign by campaign: "The time from load to click is ridiculously long... We should obviously use the clay api for things that are faster through the clay api. And vice versa for the clay UX. Fix chewbacca."

**Why:** the page route slept ~10s per campaign over 30 campaigns and saw one thread each. Clay's own sequencer inbox API (POST master-inbox/replies + message-history, called from the signed-in tab) returned all 65 replies with threads in ~3s.

**How to apply:** check the route table at the top of chewbacca `skills/clay-navigation/SKILL.md` first. Replies: `clay-inbox`. For an unlisted read, capture the page's api.clay.com calls once (raise the resource-timing buffer first, the default 250 fills before the data calls) and add a row plus a bin tool. Related: a private note, [[feedback_use_the_ui_not_just_cli]].
