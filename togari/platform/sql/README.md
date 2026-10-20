# Togari Core BigQuery schema

This directory holds the DDL for `togari_core`, the platform-level dataset that
houses mandates, runs, companies, contacts, costs, and integration bridges
(DealCloud, Clay).

The PDW dataset (`togari_pdw`) is a separate concern and lives in the older
`pdw_create_tables.sql` / `phase15a_*.sql` files in this directory.

## Dataset

Single dataset: **`togari_core`**, location `US`. Created idempotently by
`migrations/0000_dataset.sql`.

## Tenant isolation

Every fact and dimension table carries a `tenant_id STRING NOT NULL` column.
BigQuery has no equivalent of Postgres row-level security in this codebase's
v1, so isolation is enforced at the application layer: every query in the
worker, MCP tools, and HTTP routes must filter by `tenant_id`. This is a hard
contract. The 48North tenant is seeded by `0001_tenants.sql`.

## Migration order

Migrations are numbered for dependency order. Apply in lexicographic order.

| #    | File                                 | Notes                                                 |
| ---- | ------------------------------------ | ----------------------------------------------------- |
| 0000 | `0000_dataset.sql`                   | Creates the `togari_core` dataset                     |
| 0001 | `0001_tenants.sql`                   | Tenants table + seed for `48north`                    |
| 0002 | `0002_mandates.sql`                  | Search theses                                         |
| 0003 | `0003_mandate_criteria_versions.sql` | Version history of mandate criteria                   |
| 0004 | `0004_companies.sql`                 | Master company records; clustered on website          |
| 0005 | `0005_mandate_companies.sql`         | Join table; soft-delete via `removed_at`              |
| 0006 | `0006_mandate_tags.sql`              | User-defined labels per mandate                       |
| 0007 | `0007_mandate_company_tags.sql`      | Many-to-many tag join                                 |
| 0008 | `0008_datapoints.sql`                | Append-only facts; partitioned by day                 |
| 0009 | `0009_contacts.sql`                  | People records with DC bridge column                  |
| 0010 | `0010_tiering_runs.sql`              | Batch tiering jobs                                    |
| 0011 | `0011_tiering_run_companies.sql`     | Per-company progress within a tiering run             |
| 0012 | `0012_tiers.sql`                     | Final tier output; composite PK                       |
| 0013 | `0013_enrichment_runs.sql`           | Contact-discovery jobs                                |
| 0014 | `0014_enrichment_run_companies.sql`  | Per-company enrichment progress                       |
| 0015 | `0015_cost_logs.sql`                 | Append-only cost ledger                               |
| 0016 | `0016_prompt_logs.sql`               | AI input/output capture                               |
| 0017 | `0017_admin_settings.sql`            | Per-tenant config; seeds `agentic_max_steps`, pricing |
| 0018 | `0018_dealcloud_settings.sql`        | Cached DC entry-type IDs + industry tree              |
| 0019 | `0019_dc_sync_log.sql`               | Pull/push audit trail                                 |
| 0020 | `0020_enrichment_jobs.sql`           | Pub/Sub fan-out tracker                               |
| 0021 | `0021_clay_imports.sql`              | Inbound Clay webhook audit log                        |

All files use `CREATE TABLE IF NOT EXISTS` and `MERGE ... WHEN NOT MATCHED`
for seeds, so they are idempotent: rerunning is safe.

## Applying migrations

### Production (real `togari_core` dataset)

```bash
cd /Users/joelnewton/togari-platform
for f in sql/migrations/*.sql; do
  echo "Applying $f"
  bq query --use_legacy_sql=false --project_id="$GCP_PROJECT_ID" < "$f"
done
```

`GCP_PROJECT_ID` must be set to the Togari GCP project. The dataset name is
hard-coded as `togari_core` in every migration. To apply to a different project,
set `--project_id` on the `bq` call.

### Scratch (smoke test)

To validate the migrations end-to-end without touching production, create a
throwaway dataset with the same name in a personal sandbox project:

```bash
# 1. Point bq at your sandbox project
export GCP_PROJECT_ID="my-sandbox-project"

# 2. Run every migration
for f in sql/migrations/*.sql; do
  bq query --use_legacy_sql=false --project_id="$GCP_PROJECT_ID" < "$f" \
    || { echo "FAILED on $f"; exit 1; }
done

# 3. Verify all 21 tables exist
bq ls --max_results=50 "${GCP_PROJECT_ID}:togari_core"
# Expect 21 rows back.

# 4. Spot-check the seeded rows
bq query --use_legacy_sql=false \
  "SELECT id, name FROM \`${GCP_PROJECT_ID}.togari_core.tenants\`"
# Expect one row: 48north / 48North.

bq query --use_legacy_sql=false \
  "SELECT \`key\` FROM \`${GCP_PROJECT_ID}.togari_core.admin_settings\` ORDER BY \`key\`"
# Expect two rows: agentic_max_steps, pricing_config.

# 5. Tear down
bq rm -r -f -d "${GCP_PROJECT_ID}:togari_core"
```

Expect 0 errors. Each migration prints its result count; warnings about
empty result sets on the `CREATE TABLE` statements are normal.

## TypeScript types

`src/bigquery/schema.ts` exports a TypeScript interface for every table.
Import from `src/bigquery` (the barrel) or `src/bigquery/schema` directly:

```ts
import {
  TOGARI_CORE_TABLES,
  type Mandate,
  type TieringRun,
  type RunStatus,
} from "../bigquery/schema";
```

`TOGARI_CORE_TABLES` is a const map of friendly name -> fully-qualified table
name. Use it instead of hardcoded strings so table references stay grep-able.

## BigQuery design notes

- **No FK constraints.** BQ does not enforce them. References are documented in
  the DDL comments and enforced by the app layer.
- **PRIMARY KEY ... NOT ENFORCED.** Declared for query optimizer hints only;
  no uniqueness is enforced. Idempotent writes (e.g. Clay ingestion dedupe)
  go through `MERGE` statements in app code.
- **Partitioning.** Tables that grow append-only with time-ranged access
  patterns (`datapoints`, `tiering_runs`, `enrichment_runs`, `cost_logs`,
  `prompt_logs`, `dc_sync_log`, `enrichment_jobs`, `clay_imports`) are
  partitioned by `DATE(<created_at|received_at|synced_at>)`. This caps query
  cost when the worker filters by recent windows.
- **Clustering.** Every table clusters on `tenant_id` first to make per-tenant
  scans cheap. Additional cluster columns target the most common access
  patterns documented in `TOGARI_PARALLEL_PLAN.md` (Tabs 3 and 4).
- **JSON columns.** Use the native BQ `JSON` type, not stringified JSON in
  `STRING`. The `@google-cloud/bigquery` client serializes JS objects
  automatically.
- **No INTERVAL, SERIAL, or other Postgres-only types.** IDs are `STRING`
  (generated by the app as UUIDs); counters are `INT64`.
