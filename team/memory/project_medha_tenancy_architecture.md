---
name: project_medha_tenancy_architecture
description: "Medha multi-tenant architecture DECIDED 6/4 by Sagar+Karthik (decentralized one-person medha-id, logical isolation, domain-matched org workspaces, agent-to-agent)"
metadata:
  node_type: memory
  type: project
  originSessionId: 7fb8f02d-9120-440d-b667-55a18c527cb7
---

Sagar + Karthik answered the 15 architecture questions on 2026-06-04. These are the locked decisions (full text in `medha/MOG_THE_COMPETITION.md` Reference E + `~/Downloads/15_AMBER_QUESTIONS_ANSWERED.md`). Supersedes the "open/gated" framing in [[project_medha_tenancy_architecture]] history.

**Identity (decentralized, one person):**

- medha-id = ONE person, decentralized identity, NO exceptions. One GLOBAL medha-id per human across all orgs + platforms.
- A person can belong to MULTIPLE orgs (multiple "Togaris"). Identity stays global; org membership is layered on.
- **NOT Firestore.** Sagar+Caleb want decentralized identity: Privy / atproto / Farcaster. Each person owns a decentralized network UNLESS they pay enterprise → they get a BigQuery instance. Tiering TBD. "Decentralized tenant ids are the big draw." (Note: current code still uses Firestore per [[reference_medha_id_storage]]; this is the decided future direction.)

**Graphs + permissions (private, node-level):**

- Private per-person graphs. Permissions are decentralized + custom per node. Org-level mass permissions can be requested and granted when a medha-id onboards to an org.
- Permission sets map to the 6 dimensions of health (e.g., "he's part of my financial-health network").
- Unregistered people in a group chat → store as plain contacts, keep training the contact model (mentions, multiple numbers). Don't force-register them.

**Isolation + infra:**

- LOGICAL isolation (shared GCP project `midyear-glazing-485303-u3` + tenant_id + RLS), like HubSpot/Salesforce. Hard isolation rejected: too expensive, not recommended by GCP. Q8 (own project vs shared) still "think on more"; warehouse stays in midyear-glazing for now, Karthik to keep following up with GCP.
- 48North = guinea pigs this month with NO security enforcement yet (high trust, first external buildout). By **July**: enforce isolation (RLS/per-tenant keys) so all clients onboard with zero cross-contamination.

**Org model (domain matching):**

- Org-level secrets/clearances via DOMAIN MATCHING: a client at `@48northpartners.com` is recognized → org-level clearances delivered. Org invites people into a "workspace"; each workspace does org-level data mapping (not per-individual). "Only logical way to scale."

**Surface + routing:**

- ONE Medha number for now → scale to dedicated 1:1 number per user later ("in the rock" = justarock.ai future).
- Slack: multiple Medha orgs can live in one workspace; "replace Slack asap."
- Medha↔Togari gate = generic AGENT-TO-AGENT handoff (both Sagar + Karthik agree). Design it generic so any org's agents interoperate.

**Sequencing:**

- Togari = the multi-tenant FOUNDATION/blueprint. But get Sagar, Emily, and Tyler onto INDIVIDUAL medha-ids testing soon (Caleb to figure out how; Karthik to keep honest).

Open registration question (Q5, Shirley owns): how to go viral while keeping network tightness, Partiful-style open vs in-person-only adds (Caleb likes in-person-only as a growth/alpha tactic). Relates to [[project_medha_relationship_agent_direction]], [[project_amber_vision]], a private note.
