---
name: project_amber_code_lives_in_chewbacca
description: Every Amber repo is copied into chewbacca/amber; Karthik ruled 2026-10-20 that features move between Amber and Chewbacca with no credit exchanged
metadata:
  type: project
---

**Update 2026-11-05:** `amber/` was removed from main. Its copy stays in git history at ab2e3f13. Nothing in Chewbacca loads it at runtime.

Karthik, relayed by Caleb on 2026-10-20: Amber and Chewbacca build very similarly, so
when features are shared no credit is exchanged, since both would have built the same
thing anyway. Caleb: "Funnel all things Amber into chewbs".

So every Amber repo's main was copied into `amber/` on 2026-10-20 (id, ios, website,
sandbox, circles, fridge, outbound, phone-call, caleb, slack-mirror,
prometheus-targeting). amber-search was already at `togari/search/`. `amber/README.md`
maps each folder to its upstream commit.

How to apply: Chewbacca code taken from Amber carries only a technical upstream pointer
(repo, path, commit) for resyncing, never "ported with permission" or author credit.
CREDITS.md, `bin/people` and `bin/lib/name-split.js` were rewritten that way. This
settles the open attribution question in [[project_chewbacca_amber_port_authorized]].
Do not raise it again.

Scrubbed on the way in, because readers outside the Amber team can see this repo: nine
real team cells in fixtures became 555-010-XXXX fakes (one per number), the Prometheus
investor CSVs keep only headers, and an inline Todoist key now reads from the env.
Copy from the remote's main, never a local checkout. Related:
[[project_togari_code_lives_in_chewbacca]].
