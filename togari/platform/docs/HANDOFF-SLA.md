# BMA → Togari Handoff SLA (Proposal)

**Owner:** Caleb Newton
**Reviewer:** Karthik
**Status:** Proposal, awaiting Karthik sign-off
**Target sign-off date:** 2026-06-30
**Drafted:** 2026-05-28

This is the SLA contract for inbound leads moving from BMA's surfaces (LinkedIn DMs, newsletter replies, Twitter, contact form, cold-email replies, referrals, Camber-captured) into Togari for qualification and follow-through. Karthik: push back on values, not on the structure. Defaults below are deliberately concrete so we have something to negotiate.

---

## 1. Response-time SLA

- Acknowledge within **2 business hours** (M-F, 9a-6p PT).
- First substantive reply: same business day if received before 12p PT, next business morning otherwise.
- Hard cap: **24 hours calendar time** from inbound timestamp to first substantive reply.
- Timer pauses outside business hours (see Section 7).

## 2. First-reply ownership by tier

| Tier   | Who they are                                                               | Owner                                                        | Agent role                            |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------- |
| Tier-1 | PE / VC / IB Partner, MD, Principal, VP. Warm referral OR firm AUM > $500M | **Caleb** writes the first reply                             | Agent drafts, Caleb edits and sends   |
| Tier-2 | Qualified PE / finance, cold inbound                                       | **Karthik** owns                                             | Agent drafts, Karthik edits and sends |
| Tier-3 | College / pre-prof, students, early-career exploratory                     | **Agent** auto-reply with template, adds to nurture sequence | Fully automated                       |
| Tier-4 | Other (out-of-scope, vendor pitches, recruiters)                           | **Agent** auto-decline with polite redirect                  | Fully automated                       |

## 3. Qualification criteria (hard signals)

A lead is Tier-1 or Tier-2 only if it satisfies BOTH the role check AND the firm check, plus passes at least one deal-size signal:

- **Role check:** job title contains one of `Partner | MD | Managing Director | Principal | VP | Vice President | Associate | Analyst`.
- **Firm check:** firm type is one of `PE | VC | IB | Investment Bank | Family Office | Allocator | Hedge Fund | Sovereign Wealth`.
- **Deal-size signal (any one):** mention of fund size, deal value, transaction, LP, GP, carry, IRR, MOIC, DPI, AUM.
- **Geography routing:** US/Canada is standard. EMEA/APAC flags for Caleb to handle the timezone window, regardless of tier.
- **Warm vs cold:** warm = referral name in the inbound copy OR prior LinkedIn 1st-degree connection. Warm always upgrades one tier (Tier-2 cold → Tier-1 warm).

## 4. Handoff mechanism (v1)

Default to a **manual Acknowledge button** in Slack `#pipelineupdates`. Clicking it writes a `handoff_events` Firestore entry with the tier, source, and acknowledger.

Auto-detection runs as a **hint**, not as a decision:

- If the classifier outputs `qualification_tier >= 2` with confidence > 0.75, the Slack post is prepended with `[AUTO: tier-N, confidence X.XX]`.
- A human still clicks Acknowledge. No auto-routing in v1.

## 5. Lead-source attribution

Every record carries a `source` enum so we can measure conversion per channel:

- `linkedin_dm` (manual paste from Caleb or Karthik into Medha, via `togari_submit_lead`)
- `newsletter_reply` (Smartlead webhook)
- `twitter` (manual paste from Caleb)
- `bma_contact_form` (when form ships, deferred)
- `referral` (manual, free-text referrer field)
- `cold_email_reply` (Smartlead)
- `camber_capture` (Medha-captured during a conversation)

## 6. Escalation

If a Tier-1 or Tier-2 lead is not Acknowledged within the SLA windows:

- **> 2 business hours unacknowledged:** Slack DM to Caleb with the lead summary.
- **> 4 business hours:** Slack DM to Karthik.
- **> 8 business hours:** mark as `breach`, attach to the weekly review doc, and post to `#pipelineupdates` as a thread reply.

## 7. Business-hours pause

The SLA clock pauses outside **M-F, 9a-6p PT**. A lead landing at 5:55 PT Friday is considered received at 9:00 PT Monday for SLA purposes. Holidays (US federal) also pause the clock. Caleb's calendar (school + travel) does NOT pause the clock; Karthik's coverage rotation handles those windows.

## 8. Reporting (weekly, light-touch)

Karthik or Caleb posts one summary in `#pipelineupdates` every Monday:

- Inbound counts per source per tier.
- Median time-to-Acknowledge per tier.
- Breach count and the lead IDs.
- Conversion: tier-1/2 leads that progressed to a scheduled meeting.

No dashboard in v1. The Slack post IS the dashboard.

---

## Out of scope for this proposal (file as follow-up PRs after sign-off)

- `togari-platform/src/ontology/handoff-state.ts` (Zod enum for `source`, `tier`, `handoff_status`).
- `togari-platform/src/services/handoff-tracker.ts` (Firestore event writer).
- `togari-platform/src/routes/leads/intake.ts` (`POST /v1/leads/intake` shared by Smartlead webhook, manual paste, and Camber capture).
- `togari-platform/src/agents/smartlead-responder/index.ts` (Slack Acknowledge button + threaded reply preview).
- `togari-platform/src/scripts/handoff-sla-monitor.ts` (cron that walks `handoff_events`, fires escalation DMs).
- BMA contact form on bma.com that POSTs to `/v1/leads/intake` with `source=bma_contact_form`.

---

## Decision log

| Date       | Decision                      | Decided by |
| ---------- | ----------------------------- | ---------- |
| 2026-05-28 | First draft proposal authored | Caleb      |

Karthik: when you sign off (in chat or in a Slack thread), append the row here and ship the code PRs in Section "Out of scope" above. If you want to change values, edit the relevant section directly in this doc and reply with the diff.
