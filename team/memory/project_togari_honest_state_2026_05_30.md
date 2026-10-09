---
name: togari-honest-state-2026-05-30
description: 'The gap between "Togari is the relationship brain" pitch and the actual state. Codebase exists, NOT deployed, NOT integrated with medha-id. Read this before pitching Togari to anyone.'
metadata:
  node_type: memory
  type: project
  originSessionId: e25ae612-3eb2-4c7d-b3ba-83cd7dfa9b48
---

The honest state of Togari-PeopleRank and Togari-PeopleSearch as of 2026-05-30, after a code-level audit Caleb forced me to do when I almost shipped an oversold CEO brief.

## The headline

Togari is NOT a running engine that powers Medha today. It is **planned infrastructure** with one half partially implemented inside medha-id as a stopgap, and the other half sitting as un-deployed code in a separate repo.

## togari-search (a.k.a. togari-amber MCP server)

- **Repo**: github.com/amber-organization/togari-search
- **Last commit**: 2026-05-03 (Caleb hasn't touched it in ~4 weeks as of 2026-05-30)
- **What's in it**: real Python matching/scoring/rationale pipeline (api/main.py, matching.py, scoring.py, rationale.py) + Node MCP server wrapper backed by BigQuery (@google-cloud/bigquery dependency)
- **package.json name**: `togari-amber`, version 1.0.0. Description: "Togari Amber MCP Server, Development, deployment, and operations tools for the Amber health network iOS app platform"
- **Deployment status**: NOT DEPLOYED. Probed togari-search-production.up.railway.app (404), togari-search-amber-production.up.railway.app (404), togari-amber-production.up.railway.app (404).
- **Integration status**: NOT WIRED INTO medha-id. No client file, no route, no env var pointing at it. Nothing in `src/lib/` of medha-id references togari-search.

## togari-peoplerank

- **Client stub**: medha-id `src/lib/peoplerank.js` exists. Points to `togari-amber-production.up.railway.app` via `PEOPLERANK_BASE_URL` env (currently unset → falls back to the hardcoded 404 URL).
- **Used by**: `src/lib/ask.js` as an OPTIONAL rerank step. Gracefully degrades to `null` when the upstream is down (always). Caller (`prepare()`) catches the failure and falls back to pure Pinecone ranking.
- **Medha-internal parallel impl**: Tab 34's `src/lib/people-rank-score.js` is a pure scoring composer that does NOT call out to Togari. It's the thing actually running in `/knowledge/people-rank-as` today. Its file comment literally says: "Reconciliation note: medha-id/CLAUDE.md describes PeopleRank as a Togari microservice we ADAPT to. This file is the Medha-side scoring layer Caleb shipped while Togari ships its own PeopleRank, the two can dual-write or reconcile by [comparison]."
- **Production data state**: empty. `/knowledge/people-rank-as` returns `{"rows":[]}` because no contacts have been imported into anyone's Pinecone namespace yet (iOS contact import is Wave 5).

## The togari\_\* tools confusion

In medha-platform, the agent has tools named `togari_search_contacts`, `togari_list_people`, `togari_get_person`, `togari_create_person`, `togari_enrich_person`, `togari_enrich_company`, `togari_submit_lead`, `togari_list_companies`, `togari_list_campaigns`. These point to **Caleb's separate BMA CRM system**, not to the togari-search repo. Easy to confuse. Don't.

Source: prompts.js:765 explicitly clarifies: "Togari = Caleb's own BMA (Blue Modern Advisory) CRM, the authoritative database of leads, people, companies, and outreach campaigns. This is HIS OWN SYSTEM, not a third-party product."

## What "Togari activation" actually requires (Wave 6)

To make the CEO pitch true ("Medha knows your network"):

1. Deploy togari-search to Railway as a real service with a stable public URL.
2. Write `src/lib/peoplesearch.js` in medha-id (mirroring the existing `peoplerank.js` shape: timeout, retry, graceful degradation) and wire it into `ask.js` for "find me people who…" queries.
3. **Sagar's decision**: deploy a separate togari-peoplerank service and decommission Tab 34's Medha-internal scorer, OR merge the Medha-internal scorer back into togari-peoplerank as the canonical implementation. Both are defensible. Sagar picks.
4. Hook up the @google-cloud/bigquery dependency to a real GCP project with credentials, currently it's a dependency without an upstream.
5. Wait for Wave 5 iOS contact import so there's a real network to search and rank. Without that, deploying Togari just gives us empty 200s with more steps.

**Why:** Saving this so I never again describe Togari as "the social cortex that powers Medha's relationship intelligence" without immediately qualifying it as future infrastructure. The reality must lead.

**How to apply:** Any time the user asks about Togari capabilities, or anyone in a meeting asks "does Medha know my network," or any architecture brief gets drafted, START from this memory. Update it the moment any of (1)-(5) above ships.

Related memories: [[project_amber_wave_state_2026_05_30]], [[project_togari_strategy]], [[project_togari_autotier_lift_plan]], [[project_togari_48north_platform_lift]]
