---
name: Rave-master STAYS in medha-imessage (Medha owns embodied logistics)
description: Initial 2026-05-13 framing said rave-master should migrate to Togari; Caleb corrected later that day, Medha owns embodied/community logistics like raves. Keep rave-master in medha-imessage; lift the Sagar-only gate to fire for Medha expert mode.
type: project
originSessionId: 791166fc-3862-4168-b279-3884bd900a2b
---

**This file was rewritten 2026-05-13 after a domain-map correction from Caleb.**

PR #82 (medha-imessage) and PR #37 (medha-id) merged 2026-05-13 to ship Rave Master v1, scoped to Sagar's tenant only for EDC 2026. The first version of this memory file proposed migrating it to Togari because rave-coordination "looks like social logistics."

**Caleb corrected this same day, verbatim:**

> _"Medha is for rave master! Spiritual, Emotional, Physical. I know we said togari for social, but raves fit into medha better. Medha should be able to coordinate social logistics."_

So the correct domain map is:

- **Medha** owns: spiritual, emotional, physical, **PLUS** the community / embodied logistics that serve those dimensions (rave plans, retreat coordination, friend meetups, group rituals, road trips, festivals, weddings, funerals, birth circles).
- **Togari** owns: professional / transactional territory (B2B sales, work-network, careers, deals, money-as-business, CRMs, proposals, smartlead). Even though intellectual/financial/social are "Togari dimensions," only the professional flavor of those lives in Togari.

**Test for routing:** "Is this MAKING MONEY or BUILDING A BUSINESS RELATIONSHIP FOR WORK?" → Togari. "Is this HOW DO I SHOW UP FULLY WITH PEOPLE I LOVE?" → Medha. Rave coordination is the second, even though it looks like the first on the surface.

**Implications for the rave-master code:**

- Rave-master code STAYS in `Newton/agent/lib/rave-master/` in medha-imessage. Do NOT migrate to togari-platform.
- Storage stays in medha-id (`event_cards` + `event_items` already allowlisted via PR #37).
- The `tenant.phoneNumber === Sagar's` gate is the only thing that needs to change. Lift it to fire when:
  - the inbound is on the Medha expert sender (`tenant.expertMode === true`), OR
  - the legacy Sagar tenant gate (preserve for EDC 2026 backwards compat until that event passes)
- The expert-mode prompt in prompts.js was updated 2026-05-13 to claim community/embodied logistics as Medha's domain (commit on branch `feat/medha-claims-embodied-logistics`).

**Open question for next session:**
The existing rave-master flow assumes a single owner (Sagar) reviews drafts. In Medha expert mode there is no owner. The flow needs to either:

- (a) Skip the draft-for-approval step in expert mode and reply directly to the user, OR
- (b) Synthesize a per-user "owner" on the fly so each texter is their own draft-approver, OR
- (c) Build a multi-user planning mode where Medha facilitates a group's plan in real-time without any single approver.

Option (c) is the most aligned with how Caleb described it ("coordinate rave plans with my rave fam" implies group planning, not draft-for-approval).

**How to apply:** Future rave-master work should keep the code in medha-imessage and lift the Sagar-only gate. The next concrete piece of work is a no-owner flow for Medha expert mode.
