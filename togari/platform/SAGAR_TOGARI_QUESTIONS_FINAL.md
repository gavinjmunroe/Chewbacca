# Togari — Questions for Sagar (trimmed)

Caleb has already decided everything technical/operational (below). **Sagar only needs to answer the 8 business/client questions in Part 2.** Reply with a letter + one sentence.

---

## Part 1 — Already decided by Caleb (for context, no action needed)

**Architecture & platform**

- Canonical tenancy key = **`client_id`** (map `tenant_id`/`org_id` onto it).
- Client data gets a **dedicated Togari GCP project** (split from the Medha-shared `midyear-glazing`).
- MCP/Perplexity has **full write access except live email-send and hard deletes** (those get a one-tap confirm).
- NL "reorganize my data" applies **silently + automatically** (raw always preserved so it stays recoverable).
- **One MCP connector per organization** (multi-org users install one each).

**Data & ingestion**

- Ingestion sources: **all of them** — portal file/CSV upload **and** Gmail **and** Fireflies.
- **Siloed per client** — no cross-client dedup of people/companies.
- Enrichment (Exa/ZoomInfo/AI) is **strictly per-client**, no reuse across clients.
- Raw content retained **indefinitely until a deletion request**.
- Deletion = **soft-delete by default, hard-purge raw on explicit request**, audited, re-ingest suppressed.
- Bad AI extractions fixed by **inline edit** (raw preserved, correction logged).
- Client data **never** trains/improves shared models or schemas.
- **Multimodal (PDF/image) is a fast-follow** — store raw now, add extraction next.

**DNC & CRM automation**

- DNC match keys = **email + domain + contact-id**, with reason, optional expiry, reversible + audited.
- Priority = **client > active pipeline > prospect, revenue-weighted**; overdue = past `next_action_date`.
- Inferred pipeline changes **auto-apply silently**.

**Access & ownership**

- **BMA staff see all clients; Joe sees only AIJ**; BMA-internal notes hidden from clients.
- AIJ uses **its own Clay account from day one** (per-client Clay keys wired into `tenant_secrets`).
- Perplexity onboarding = **connector install steps** (Spaces optional).
- Colin gets a **formal OpenAPI contract** once he shares his repo (Monday).
- Production migrations stay **manual/reviewed** for now.
- Sourcing engine (`togari_core`, absent in prod) is **retired**; revive on demand.

---

## Part 2 — Sagar, please answer these 8

**Q1. Promote AIJ to its own tenant with Joe as a user?**
Today AIJ is a `client_id` (`aij_communications_06302026`, one $3,800 proposal) inside the `bma` org, operated by BMA staff. A Joe-facing portal needs AIJ promoted to a real tenant with its own login.
A) Yes — AIJ becomes a tenant, Joe is its first user, sees only AIJ · B) No — stays a BMA client_id, BMA operates it for Joe · C) Tenant, but Joe read-only · D) Other

**Q2. What must a do-not-contact suppression actually block?**
The DNC store is deployed (4,323 contacts) but nothing is flagged and nothing enforces it. This is a compliance call.
A) Block outbound email + Clay distribution + export · B) Block outbound email only, tag the rest · C) Full suppression + hide the record everywhere · D) Other

**Q3. Opportunity email — what is it, and auto-send or BMA-approved?**
There's already a live signal-alert product (`opportunity_subscriptions` → matches → `notification_history`). Need to confirm this IS the opportunity email and define Joe's version.
A) Yes it's the signal alert; Joe requests → Togari drafts → BMA approves → send · B) Yes; auto-send with no human · C) It's something different (describe) · D) Other

**Q4. Joe portal — focused flow or "submit anything" from day one?**
(Caleb greenlit ingesting everything on the backend; this is specifically what we promise Joe in the first demo.)
A) Focused DNC + opportunity flow (fields + text + optional file) · B) Broad "submit any document" incl. PDFs/images day one · C) Structured forms only · D) Other

**Q5. What is the ONE AIJ workflow the first demo must reproduce exactly?**
AIJ has one outbound proposal today; AIJ is a comms/PR firm.
A) DNC / compliance intake + suppression proof · B) Opportunity generation → email · C) An AIJ outreach pipeline (define its stages) · D) Other

**Q6. Does Joe see the status and history of what he submits?**
A) Yes — a simple per-request status timeline · B) Fire-and-forget for v1 · C) Final outcome only · D) Other

**Q7. On a DNC hit during Clay distribution — block or tag?**
A) Block distribution on match · B) Tag and continue · C) Block + alert an internal user · D) Other

**Q8. What must you and Tyler trust before you stop using the spreadsheet/notebook?**
A) Reliable NL query+edit of deals, activity/next-action tracking, and daily priorities · B) Just a reliable deal list + stages · C) Something specific (list it) · D) Other
