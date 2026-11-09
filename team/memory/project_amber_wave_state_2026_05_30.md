---
name: amber-wave-state-2026-05-30
description: "Snapshot of what's actually shipped vs scaffolded vs planned in Amber/Medha as of 2026-05-30. Wave 1-2 live on origin/main, Wave 3-6 next. Read FIRST before resuming wave work."
metadata:
  node_type: memory
  type: project
  originSessionId: e25ae612-3eb2-4c7d-b3ba-83cd7dfa9b48
---

State of Amber/Medha as of 2026-05-30 (snapshot after a real audit of the codebase + live endpoints, not a vibes summary).

## What's actually live on origin/main

**Wave 1** (Tabs 1-21, "Pinecone foundation"): shipped + live.
**Wave 2** (Tabs 22-34, "user-facing + relational graph"): shipped + live. Final state:

- medha-platform `4d0c02d` (includes PR #268 audit fix that armed `generate_carousel` + `slack_create_canvas` and added `analyze_tabular`/carousel doctrine in prompts.js)
- medha-id `3066309`
  Both repos pushed to GitHub. Railway redeploys auto-triggered. All 5 Wave 2 crons (memory-consolidator, relationship-snapshot, contact-edges, people-rank, drift-detector) are env-armed (ENABLE\_\* vars set on Railway) and mounted at boot.

## What's scaffolded but EMPTY in production

These Wave 2 endpoints return well-formed `[]` because there's no data to feed them yet:

- `/knowledge/graph-as` → `{"neighbors":[]}`
- `/knowledge/people-rank-as` → `{"rows":[]}`
- `/knowledge/relationship-trajectory-as` → `{"rows":[]}` (also has strict intent enum, "top_composite" is rejected, must use "warming"/"cooling"/etc.)
  The gating dependency is **iOS contact import** (Wave 5). Until contacts land in Pinecone, every relationship feature is scoring an empty network.

## Honest Togari state (the part I almost oversold to Sagar)

- **togari-search**: codebase at github.com/amber-organization/togari-search, last commit 2026-05-03. Has real Python matching/scoring/rationale pipeline + Node MCP server (togari-amber) backed by BigQuery. **NOT deployed** at any obvious Railway URL (togari-search-production, togari-search-amber-production, togari-amber-production all return 404). **NOT integrated** with medha-id (no client file, no route).
- **togari-peoplerank**: HTTP client stub at medha-id `src/lib/peoplerank.js` points to `togari-amber-production.up.railway.app` (404). The Medha-internal scorer (Tab 34, `src/lib/people-rank-score.js`) is the only PeopleRank actually running. It degrades to `[]` because no contacts exist.
- The `togari_*` agent tools (togari_search_contacts, togari_list_people, etc.) point to Caleb's separate **BMA CRM**, NOT to the togari-search repo. Don't confuse them.

**Why:** I sold Togari to Sagar as the "social cortex" in an earlier draft; Caleb caught it and made me audit + rewrite. The truth: Togari is scaffolded code, not a running engine. See [[project_togari_honest_state_2026_05_30]] for the gap analysis.

## The next waves (post-audit, honest)

Following the version of the plan that survived the audit, saved at `~/Downloads/AMBER_ARCHITECTURE_CEO_BRIEF.md`:

- **Wave 3**, Domain Integrations (Tabs 35-44): Notion / Linear / GitHub / Calendly / Stripe / Apple Health. Stub tools exist for some but user flows aren't polished. No blocking dep, can start immediately.
- **Wave 4**, Power Features (Tabs 45-52): proactive briefings, smart cross-surface routing, cross-user intros. Depends on Wave 3.
- **Wave 5**, App Store Launch (Tabs 53-60): SwiftUI client polish, **contact import** (this is what unlocks the empty Wave 2 endpoints), App Store submission. No blocking dep.
- **Wave 6** (NEW, added after the audit), Togari Activation: deploy togari-search, write `peoplesearch.js` client in medha-id and wire into `ask.js`, decide on PeopleRank canonical impl, hook up BigQuery as real GCP project. **Depends on Wave 5** for real contact data.

## Open decision flagged for Sagar in the brief

For PeopleRank in Wave 6, pick ONE:
(a) Deploy togari-peoplerank as a separate service and decommission the Medha-internal Tab 34 scorer, OR
(b) Merge the Medha-internal scorer back into togari-peoplerank as the canonical implementation.

## Audit pattern that worked (use it again for Wave 3)

Two auditors in parallel, same shape as Wave 1 audit (which preempted the dormant-cron + silent-broken-tool disasters):

1. **Auditor 1 (infra)**: deploys, health, cron env vars, cron startup log lines, Pinecone namespace correctness, orphaned worktrees, conflict markers, Slack tokens.
2. **Auditor 2 (code+functional)**: tool registration+dispatch+arming matrix, prompts.js doctrine coverage, tool-selector keyword coverage, test suite results, broken imports, live API calls against new endpoints, live agent invocations via `/admin/say-as-user` to verify the model can actually call the tools.

**Why:** Wave 1 audit caught the dormant cron (ENABLE_MEMORY_CONSOLIDATOR unset) + silent-broken tools (PR #253). Wave 2 audit caught the same pattern again with generate_carousel + slack_create_canvas + analyze_tabular doctrine (PR #268). If we don't run this audit between Wave 3 → Wave 4, we WILL ship invisible features again.

**How to apply:** Before declaring any wave done, dispatch both auditors in parallel via the general-purpose Agent. Don't trust "all tabs reported done" as completion, tabs ship code, the audit verifies arming + integration.

Related memories: a private note, [[reference_medha_id_storage]], [[project_togari_honest_state_2026_05_30]]
