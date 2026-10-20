# Togari — Questions for Sagar

Answer each with a letter + one sentence. Full context in `SAGAR_TOGARI_DECISION_QUESTIONS.md`.

## P0 — Required before we build

**P0-01. Promote AIJ to a tenant?** AIJ is a `client_id` (one $3,800 deal) inside the `bma` tenant today.
A) Promote AIJ to its own tenant, Joe is first user (rec) · B) Keep as BMA client_id, no client login · C) Tenant but Joe read-only · D) Other

**P0-02. Which key is canonical tenancy?** Data is keyed 4 ways: `client_id`, `tenant_id`, `org_id`+`owner_did`, `client_brand`.
A) Standardize on `client_id` (rec) · B) Use `tenant_id` · C) Keep separate per subsystem · D) Other

**P0-03. What must a DNC suppression block?** Store exists (4,323 contacts) but 0 flagged and nothing enforces it.
A) Block email + Clay + export; match email/domain/person; retain+flag+audit (rec) · B) Block email only, tag rest · C) Full suppress + hide record · D) Other

**P0-04. Opportunity email = the signal alert, and auto-send or approved?** `opportunity_subscriptions` product is already live.
A) Yes; Joe requests → draft → BMA approves → send (rec) · B) Yes; auto-send, no human · C) It's something different · D) Other

**P0-05. Own GCP project for client data, or share with Medha?** Project `midyear-glazing` is shared with Medha today.
A) Dedicated Togari project (rec) · B) Keep shared, isolate by client · C) One project per client · D) Other

**P0-06. Joe portal — focused flow or "submit anything"?** No portal input or document processing exists yet.
A) Focused DNC + opportunity (fields + text + optional raw file) (rec) · B) Broad, incl. PDFs/images day one · C) Structured forms only · D) Other

**P0-07. Which Perplexity/MCP actions fire without confirmation?** `send_email` sends live mail as Sagar today.
A) Everything except live email-send + hard deletes (rec) · B) Truly everything · C) Everything except outbound · D) Other

**P0-08. One connector per org, and can a user span orgs?** Per-org token issuing already works.
A) One per org; multi-org users install one each (rec) · B) One connector, switch org inside · C) One per user, org per request · D) Other

**P0-09. NL "reorganize data" — visible + reversible, or silent?** No dynamic schema exists yet.
A) Visible + reversible custom fields, no live DDL (rec) · B) Silent + automatic · C) Proposed-then-approved · D) Other

**P0-10. First AIJ workflow the demo must nail?** AIJ = one outbound proposal today.
A) DNC / compliance intake + suppression (rec) · B) Opportunity → email · C) Outreach pipeline · D) Other

**P0-11. Ingestion source #2 after Clay, and backfill?** Gmail/Fireflies adapters exist but aren't scheduled.
A) Portal file/CSV upload next; Gmail/Fireflies later, go-forward only (rec) · B) Gmail next + backfill · C) Fireflies next · D) Other

## P1 — Before production rollout

**P1-01. BMA staff see all clients; can Joe see BMA-internal notes?**
A) BMA sees all, Joe sees AIJ only, internal notes hidden (rec) · B) Strict isolation even for BMA · C) Joe sees BMA notes · D) Other

**P1-02. People/companies deduped globally across clients, or siloed?**
A) Siloed per client (rec) · B) Global record, shared facts · C) Global identity, client-scoped facts · D) Other

**P1-03. Can enriched data (Exa/ZoomInfo/AI) be reused across clients?**
A) Strictly per-client (rec) · B) Reuse public firmographics · C) Reuse everything · D) Other

**P1-04. Does Joe see status/history of his submissions?**
A) Yes, per-request timeline (rec) · B) Fire-and-forget v1 · C) Final outcome only · D) Other

**P1-05. On a DNC hit during Clay distribution — block or tag?**
A) Block on match (rec) · B) Tag and continue · C) Block + alert internal · D) Other

**P1-06. DNC lifecycle — keys, expiration, removal, external sync?**
A) email+domain+id, reason, optional expiry, reversible+audited (rec) · B) email only, permanent · C) email+phone+domain, permanent · D) Other

**P1-07. AIJ uses BMA's Clay workspace or its own?**
A) BMA's now, client keys later (rec) · B) Client's own day one · C) Separate BMA workspace per client · D) Other

**P1-08. Connector-install UX — is Perplexity Spaces part of onboarding?**
A) Connector steps only, Spaces optional (rec) · B) Guided Spaces in v1 · C) Spaces is primary · D) Other

**P1-09. How are ownership, priority, and "overdue" defined?**
A) client>pipeline>prospect, revenue-weighted, overdue past next_action_date (rec) · B) Manual priority · C) Recency-based · D) Other

**P1-10. What must you + Tyler trust before dropping the spreadsheet?**
A) NL query+edit, activity/next-action, daily priorities (rec) · B) Reliable deal list+stages only · C) Something specific · D) Other

**P1-11. How does a client data-deletion request work?**
A) Soft-delete + on-request hard-purge of raw, audited, suppress re-ingest (rec) · B) Always hard-purge · C) Soft-delete only · D) Other

## P2 — During iteration

**P2-01. Inferred pipeline changes — silent or surfaced?** A) Suggest-then-accept (rec) · B) Silent auto-apply · C) Silent+logged with undo · D) Other

**P2-02. How does a user correct a bad AI extraction?** A) Inline edit, raw preserved, logged (rec) · B) Re-submit source · C) None in v1 · D) Other

**P2-03. Retention for raw ingested content?** A) Indefinite until deletion request (rec) · B) Fixed window · C) Client-configurable · D) Other

**P2-04. May client data improve shared models/schemas?** A) Never cross-tenant (rec) · B) Aggregate/anonymized only · C) With consent · D) Other

**P2-05. Production migrations auto-run on deploy?** A) Manual/reviewed for now (rec) · B) Auto on deploy · C) Auto in staging only · D) Other

**P2-06. Formal frontend integration contract for Colin (once he shares Monday)?** A) Yes, OpenAPI + typed client (rec) · B) Informal endpoint list · C) Not yet · D) Other

**P2-07. Multimodal (PDF/image) ingestion in v1 or fast follow?** A) Fast follow, store raw now (rec) · B) Needed in v1 · C) Never · D) Other

**P2-08. Revive or retire the sourcing engine (`togari_core`, absent in prod)?** A) Retired, revive on demand (rec) · B) Revive + unify now · C) Delete the code · D) Other
