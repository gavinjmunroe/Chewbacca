---
name: Togari collaborators
description: Who's involved in Togari work, Sagar, Karthik, Parker, Matija, Kevin, Maggie, and what each person owns
type: project
originSessionId: ca5080bd-5c54-4ab4-98c2-85fe479727f9
---

**Inside Blue Modern Advisory (the team building Togari):**

- **Sagar Tiwari**, Product/strategy lead for Togari. Sets direction (warehouse-first, Clay-elimination, DealCloud-sync prize). Has already secured "a full, production ready repo to build off of" but its location is not yet documented, open thread to chase down. Also co-builds Amber with Caleb.
- **Karthik Devarakonda**, Engineering lead on togari-platform. Owns architecture: Auth0/Privy, GCP boundaries, RAPs, tenancy, CI health. Currently solo committer on platform `main`. Confident about a Wed/Thu (week of May 11, 2026) deliverable for the 48N team to test. Has Monday calls scheduled with Auth0 team + GCP folks. Generally pushing and vibing as the only platform user until Caleb landed on it.
- **Kevin**, BMA, will be in the room with Karthik when 48N's dev team meets to finalize schemas. Referenced as `u_kevin` in the fixture seed data.
- **Maggie**, Contributor to togari-bma-dvlp; merged the firestore→bigquery migration PR (#4) on `Karthik_Work_Branch` ~7 weeks ago.
- **Caleb Newton**, Sourcing modules + AI orchestration on togari-platform, plus the togari-frontend dashboard. Two unmerged branches sit at the heart of the Friday delivery: `caleb/sourcing-ai-orchestration` and `caleb/sourcing-prewrites-and-validation`.

**48North side (the first tenant):**

- **Parker**, 48N point person. Will confirm dataset preferences (currently disorganized; past builds used Supabase). Picks whether to use 48N sales numbers for Retell callbacks vs Retell-issued numbers.
- **Matija**, 48N lead dev (per Karthik's note: "lead dev I believe is their title"). The technical counterpart in the Kevin/Karthik schema-finalization conversations.

**How to apply:** When a Togari task touches strategy/positioning, that's Sagar. When it touches platform architecture, infra, or auth, that's Karthik. When it touches 48N data shape or Retell number plumbing, the answer waits on Parker + Matija. Caleb owns the sourcing pipeline pieces and the frontend.
