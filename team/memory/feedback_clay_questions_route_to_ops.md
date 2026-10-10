---
name: feedback-clay-questions-route-to-ops
description: Clay questions never reached `chewbacca clay` because the router picked a third-party playbook pack; how it was found, fixed and tested
metadata:
  type: feedback
---

The router, `skill-route.sh`, decides which skill a Clay question reaches. On
2026-10-10 Caleb said "it's so annoying that we open clay way too much". Twelve
real-shaped Clay questions went through the router and none reached a skill
that names `chewbacca clay`: `clay-playbooks` (a third-party pack linked into
`~/.claude/skills` on 10/9) took six, and `clay-navigation`'s description only
talked about driving the UI. The 27 reads were there and nothing pointed at them.
Two of them were also broken on main: any op with a query slot (`credit-usage`,
`campaign-leads`, `rows limit=`) refused before a call, and no test ran one.

**Why:** a capability the router never names is a capability nobody uses. A
description is routing input, so it has to say the questions people ask, not
the mechanism.

**How to apply:** when a skill gains ops, put the questions they answer in its
description and add them to a live route check (`tests/live/clay-route.sh`,
same shape as `gtm-route.sh`). A third-party pack installed later can steal a
route silently: `gtm-route.sh` was failing four prompts to them the same day.
Every new read gets a live call and `chewbacca clay measure` before it ships.
Togari's capabilities, row by row, are in `docs/reference/TOGARI-PARITY.md`.
Related: [[project_chewbacca_live_checks]].
