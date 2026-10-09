---
name: Medha and Togari are two separate agents owned by two separate teams
description: The Amber org rebrand split, Medha (Rytual Health, S/E/P) and Togari (BMA, I/F/S) are kept separate during build-out, each with its own iMessage phone, transport repo, and backend
type: project
originSessionId: 791166fc-3862-4168-b279-3884bd900a2b
---

The Amber-organization GitHub umbrella now contains two parallel agent stacks. Caleb's framing: "We are keeping them separate until they are fully built out."

## The split

- **Medha** (Rytual Health team), feminine / inward dimensions: spiritual, emotional, physical. **PLUS the community / embodied logistics that serve those dimensions** (rave plans, retreat coordination, friend meetups, group rituals, road trips, festivals, weddings, funerals, birth circles). Phone +1 (630) 392-6460.
- **Togari** (Blue Modern Advisory team), professional / transactional territory: B2B sales pipeline, work-network, careers, deals, money-as-business, CRMs, proposals, smartlead. The intellectual / financial / social half of the six dimensions LIVE here, but only their **professional / transactional** flavor. Phone +1 (626) 755-4085.

**Test for which agent handles a request:** is this about MAKING MONEY or BUILDING A BUSINESS RELATIONSHIP FOR WORK? → Togari. Is this about HOW TO SHOW UP FULLY WITH THE PEOPLE YOU LOVE? → Medha. Rave coordination, even though it's "social logistics" on the surface, is really about communal embodied experience → Medha.

## Repos

- **Medha family** (Rytual Health team): medha-id, medha-imessage, medha-ipados, medha-macos, medha-visionOS, tizzy, rytual-admin, rytual-website, silo, sagartiwari-site
- **Togari family** (BMA team): togari-imessage, togari-platform, togari-bma-dvlp, togari-stitch, togari-search, togari-schedule
- **Amber umbrella**: amber-ios (legacy MVP, kept for App Store continuity)

## Architecture pattern

Same shape on both sides:

- `*-id` / `*-platform` = the canonical backend with identity, knowledge, data plane
- `*-imessage` = thin iMessage transport (Loop webhook in, Loop SDK out)

medha-imessage is more substantial than togari-imessage because Medha's agent logic lives in the iMessage repo. Togari's agent logic lives in togari-platform; togari-imessage is just the iMessage edge.

## Local layout

`~/2026-code/medha/{medha-id, medha-imessage}` and `~/2026-code/togari/{togari-*}` mirror the team boundary.

**Why:** Production strings (Loop hostname, Railway service names, Pinecone index `amber-people`, env vars `AMBER_*`) still carry the Amber name and cannot move without a coordinated cutover. RENAME-CUTOVER.md in each \*-imessage repo catalogs what's pending.

**How to apply:** When working on iMessage features, scope to the right phone/repo. Wrong-number = drop, never fall back to the other agent's backend. Identity is unlinked between the two stacks until explicit unification work happens.

## CRITICAL UPDATE 2026-05-13: Camber and Samber are gone as a concept

Caleb (verbatim): _"They are no longer samber and camber, it is medha and togari, very different."_

The old per-person agent variants (Camber for Caleb, Samber for Sagar) were Amber-era concepts where each owner had their own agent instance with their own personality on their own iMessage sender. **That model is deprecated.** The new model is:

- **Medha** = the public S/E/P agent. ONE agent. Anyone who texts +1 (630) 392-6460 gets Medha. Currently runs in expert mode (no per-tenant owner) on the medha-imessage Railway service via the `MEDHA_EXPERT_SENDER_ID` env-driven short-circuit in tenant.js.
- **Togari** = the public I/F/S agent. ONE agent. Anyone who texts +1 (626) 755-4085 gets Togari. Runs on togari-imessage → togari-platform.

There are no more "personal Amber" instances. There are no more per-owner tenants in the user-facing model.

**Implications for code:**

- The `Camber` / `Samber` tenant warmup (` Warmed caches for 2 tenant(s): Camber, Samber`) is a legacy artifact still in production. It should eventually be removed.
- Anything gated to `tenant.phoneNumber === Sagar's` or `tenant.agentName === "Samber"` (e.g. rave-master in `Newton/agent/lib/rave-master/`) was scoped to the old model and needs reconsideration in the new agent-first world.
- New features should be designed at the agent level (Medha or Togari), not the tenant/owner level.

**How to apply:** When something is currently scoped to "Sagar's tenant" or "Caleb's tenant", ask whether it should be re-scoped to "Medha-domain" or "Togari-domain" instead. Camber/Samber are not the future targets; Medha and Togari are.
