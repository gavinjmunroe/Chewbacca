---
name: Amber vision lives in amber-organization/amber-mission
description: Canonical Amber vision (BMA + Rytual = Amber, Medha + Togari split, 1:1 per-user destination) lives in github.com/amber-organization/amber-mission. Read that repo first; this file only carries the pointer and the load-bearing facts needed in conversation context.
type: project
originSessionId: 791166fc-3862-4168-b279-3884bd900a2b
---

**Canonical source of truth: [github.com/amber-organization/amber-mission](https://github.com/amber-organization/amber-mission), README.md.**

Caleb (2026-05-14): _"Everything vision related should be here."_ When making any architectural or product decision in `amber-organization/*`, read amber-mission first.

## Load-bearing facts to keep in context (don't re-fetch)

**The thesis:** BMA + Rytual Health = Amber. Medha (S/E/P) + Togari (I/F/S) are halves built separately during the learning phase; long-term they merge into one Amber, with every user getting their own dedicated 1:1 phone number and unified amber-id.

**The two companies behind the agents:**

- **Rytual Health** (joinrytual.com), behavioral health community for creatives + neurodivergent. 4 pillars: Health Protocols, Immersive Events, Nature Retreats, Behavioral Research. Caleb + Sagar + Arnav (rytual-website) + Matthew (rytual-admin, ColorBridge). Productizes **Medha** as the always-on agent layer.
- **Blue Modern Advisory** (bluemodernadvisory.com), GTM Strategy & Engineering firm. Sagar (Founder & Chairman) + Kevin Cong (GTM Strategist) + Karthik Devarakonda (GTM Engineer, GitHub `karthikBMA`). Customers: fintech (Tide Rock), AI (Maple AI), healthcare consulting, education. Productizes **Togari** as the agent.

**The routing test (baked into Medha's expert prompt today):**

- "Is this MAKING MONEY or BUILDING A BUSINESS RELATIONSHIP FOR WORK?" → **Togari**
- "Is this HOW DO I SHOW UP FULLY WITH PEOPLE I LOVE?" → **Medha**

**The corner case** (per Caleb 2026-05-13): rave coordination LOOKS like social logistics but its substance is communal/embodied/spiritual → **Medha**. Friend's wedding planning, retreat coordination, group rituals, road trips, festivals, funerals, birth circles → **Medha**.

**The phones:**

- **+1 (630) 392-6460** → Medha (Loop sender UUID `00069c6f-7e7a-4059-a677-a1fdc77d8813`, Medha Loop org)
- **+1 (626) 755-4085** → Togari (Loop sender UUID `c351f20c-dec0-44b3-8127-55b662e237a6`, Togari Loop org, separate from Medha's)

**Phase markers:**

- v0 (deprecated): per-person Camber (Caleb) / Samber (Sagar)
- v1 (now): two separate agents, two phones, two identity layers
- v2 (destination): unified Amber, 1:1 per-user phones, unified amber-id

**Sibling product**: Tizzy, discreet necklace-form wearable for autism conversation coaching, on "Medha hardware." Caleb is the author. Pre-launch as of Feb 2026. The Medha/Tizzy hardware relationship is an open question logged in amber-mission.

## When to update amber-mission vs this memory file

- **Vision changes / new product directions / strategic decisions** → PR to `amber-organization/amber-mission`. After merging, update this memory's "load-bearing facts" if any of them moved.
- **Tactical changes** (new env var, new endpoint, new branch convention) → DO NOT put in amber-mission; those belong in the individual repos' READMEs / CLAUDE.mds / dedicated memory files.

## Cross-references in this memory store

- [`project_medha_togari_split.md`](project_medha_togari_split.md), pre-vision-doc memory; mostly superseded by amber-mission/README.md but contains the original split detail
- [`project_togari_imessage_live.md`](project_togari_imessage_live.md), togari-imessage deploy state
- [`project_rave_master_needs_togari_migration.md`](project_rave_master_needs_togari_migration.md), filename is legacy; rave-master STAYS in Medha, lift the Sagar-only gate as next step
- [`project_togari_strategy.md`](project_togari_strategy.md), Sagar's tactical priorities for Togari
- [`project_togari_collaborators.md`](project_togari_collaborators.md), who owns what across Togari work

## How to apply

When asked anything Amber/Medha/Togari-vision-related, FIRST recall this memory's load-bearing facts (so I have grounding without a fetch), THEN if the question requires nuance beyond these facts, fetch the current state of `amber-organization/amber-mission/README.md` because the vision evolves there. Don't try to remember the long-form vision verbatim, point at the repo and recall a small handful of facts.
