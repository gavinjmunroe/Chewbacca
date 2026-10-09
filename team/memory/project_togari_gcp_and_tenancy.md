---
name: Togari GCP boundary and tenancy model
description: 48North gets its own GCP project + dataset; tenancy currently uses tenant_id matching (not per-tenant service accounts); be DB-agnostic eventually
type: project
originSessionId: ca5080bd-5c54-4ab4-98c2-85fe479727f9
---

**GCP project boundary (May 2026):**

- 48North gets a **separate GCP project** with their own dataset. They have full access and can manipulate it however they want.
- Data is simultaneously funneled into the BMA lakehouse.
- For now, operate as 48N having their own GCP dataset (NOT in the existing `midyear-glazing-485303-u3` project alongside `togari_pdw` / `togari_data_lake`).
- Schema finalization waits until Kevin + Karthik talk to the 48N dev team, Parker (48N) is the primary contact; their lead dev is Matija.
- 48N has used Supabase in past builds, so they're disorganized data-wise. Long-term plan: Togari should be **database-agnostic** (GCP, Supabase, Snowflake) so each client can pick their stack.

**Tenancy model (May 2026):**

- Currently relying on **`tenant_id = @tenant_id` injection through the SQL sanitizer**, NOT per-tenant service accounts.
- GCP confirmed this is safe and reliable for internal use + 1-2 customers.
- The togari-bma-dvlp PR #14 fix assumes this single-service-account model.
- Karthik has a follow-up GCP call Monday to understand enterprise-level setup; per-tenant service accounts on RAPs may come later as we scale customers.

**Why:** Sagar wants 48N onboarded with clean billing/IAM isolation but without the operational overhead of true per-tenant identity until we have more than 2 customers. DB-agnostic is the unlock for matching whatever stack a customer already uses (especially relevant since 48N is on Supabase).

**How to apply:** When wiring sourcing modules or new data flows for 48N, write SQL that filters by `tenant_id = @tenant_id` and trust the sanitizer. Don't build per-tenant service-account plumbing yet. Don't hardcode GCP-specific code paths where they'd block a Supabase swap, abstract the data layer.
