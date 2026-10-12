---
name: feedback_sites_renew_never_open
description: No Chewbacca read ever opens a site or a sign-in window; sessions renew from Chrome on their own (MCP proxy + 15 min keepalive), and signed out for real is a BLOCKED line
metadata:
  type: feedback
---

Caleb, 2026-10-11, mid BISC quiz: "IT should never take this long to find a
place you already know", then "STOP FLASH BANGING ME", then "Fix chewb so
anyone who sets up chewb at usc never has to open brightspace ever again. This
should be true for any site chewb uses".

What broke: the MCP path to api-anything had no re-import, so a lapsed
Brightspace session answered 403 and told the agent to open a login window.
`bin/brightspace` opened Chrome when it decided the session was dead, inside
a read nobody watched. And `brightspace due` read only dropboxes, so Quiz #5
was invisible and the agent hunted for it by hand.

**Why:** a window an agent opens lands on whatever the student is doing, and a
student who has to open a site to wake Chewbacca's session is doing its job.

**How to apply:**
- Agents reach sites through `chewbacca api mcp`, which runs
  bin/lib/api_mcp_proxy.mjs: a lapsed Chrome-imported session renews once and
  the call is resent; a `login` in window mode is refused.
- `chewbacca api keepalive` (run by `chewbacca usc setup`) renews every
  Chrome-session site every 15 min in the one background item.
- Nothing opens a page or window from a read. Signed out for real = say
  `BLOCKED: <site> needs a sign-in in Chrome` and keep going.
- A Brightspace quiz's questions 403 until the student opens an attempt;
  ask them to paste the questions, never start the attempt.
- Related: [[feedback_nothing_takes_the_screen]], [[project_chewbacca_usc_stack_wedge]].
