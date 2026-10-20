# PR #17 — Clay Ingest Hardening: What Changed

**Branch:** `caleb/clay-integration-fixes` → `main` · **Status:** open, mergeable, 34/34 tests pass, typecheck clean · **Scope:** 9 files, +1,136 / −450

Hardens the live Clay → Togari ingest path and adds the bidirectional roadmap docs. Self-contained; does not depend on any open decision.

---

## Code changes

**1. Idempotency — no more duplicate leads**
Passthrough inserts now pass `row_id` as the BigQuery streaming `insertId`, so retries and accidental double-sends dedupe within BigQuery's window. Durable long-window dedup is via a `ROW_NUMBER() OVER (PARTITION BY row_id)` view (documented in the migration).
`src/routes/ingest/clay-passthrough.ts`

**2. Constant-time auth**
Replaced the plain `!==` bearer-key comparison with `crypto.timingSafeEqual`, closing a timing side-channel. Matches the sibling HMAC route.
`src/routes/ingest/clay-passthrough.ts`

**3. Rate limiting on inbound webhooks**
New dependency-free per-IP fixed-window limiter on both `/webhooks/clay/*` and `/api/ingest/clay`. Backstop against runaway BigQuery cost if the key leaks. Tunable via `CLAY_INGEST_RATE_LIMIT_PER_MIN` (default 600).
`src/middleware/ingest-rate-limit.ts` (new)

**4. Versioned schema for the target tables**
Added a migration for `togari_data_lake.companies` / `.contacts`, generated 1:1 from the passthrough allowlists (125 company / 98 contact columns) so the BigQuery schema is no longer unversioned/out-of-band. `IF NOT EXISTS` = safe no-op if the tables already exist.
`sql/migrations/0027_togari_data_lake_ingest.sql` (new)

**5. Disabled an unscalable legacy route**
The old HMAC batch route (`/api/ingest/clay`) persisted via per-row BigQuery DML, which does not scale (DML concurrency limits + seconds-per-statement). Gated behind `CLAY_HMAC_INGEST_ENABLED` (default off → returns `501`). Code preserved; footgun removed.
`src/routes/ingest/clay.ts`

**6. Tests + config**
Added rate-limiter unit tests; fixed a stale test (`tenant_id` default is `bma` after the `togari_data_lake` cutover, not `48north`). Updated `.env.example` with the new vars.
`tests/smoke/clay/rate-limit.test.ts` (new), `tests/smoke/clay/schema.test.ts`, `.env.example`

---

## Docs added

- `docs/CLAY_INTEGRATION_BRIEF.md` — 1-page bidirectional plan (current state, flagship, open decisions)
- `docs/CLAY_INTEGRATION_ROADMAP.md` — full inbound/outbound menu with effort sizing

## New env vars

| Var                              | Purpose                                    | Default |
| -------------------------------- | ------------------------------------------ | ------- |
| `CLAY_INGEST_RATE_LIMIT_PER_MIN` | Inbound rate cap                           | 600     |
| `CLAY_HMAC_INGEST_ENABLED`       | Revive legacy batch route                  | false   |
| `CLAY_API_KEY`                   | Outbound Clay key (already set in Railway) | —       |

## Not in this PR

- The Togari → Clay flagship (DNC screen + GCP insert + Rytual audience) — a separate future build, now **unblocked**: all three branches are BigQuery writes to per-brand tables (Rytual audience is a BigQuery table, not an external API).
