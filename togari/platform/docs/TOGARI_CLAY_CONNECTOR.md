# Togari Universal Clay Connector

Add Togari to ANY Clay table in about 60 seconds. One endpoint, dropped onto a
table as an HTTP API enrichment column, gives you HubSpot-style bidirectional
flow with zero per-table setup. Any row shape works, unknown tables register
themselves, and the response is flat JSON that Clay maps straight back into
columns.

## The one honest constraint

This uses Clay's generic "HTTP API" enrichment column, which is available on
every Clay table, rather than a native Togari app listed in Clay's integration
sidebar. The behavior is the same drop-on-any-table bidirectional flow a native
app would give you: you add one column, point it at the Togari URL, and rows
flow into Togari while enriched fields flow back into Clay. There is nothing to
build per table.

## 60-second setup

1. In your Clay table, click "Add enrichment" and choose "HTTP API".
2. Method: POST.
3. URL: `https://<your-togari-host>/clay/v1/sync`
4. Auth: add a header `Authorization` with value `Bearer <CLAY_CONNECTOR_KEY>`.
   You can instead pass the key as an `X-Togari-Key` header or as a `?token=`
   query parameter. Any of the three works.
5. Body: send the whole row as JSON. Add one control field, `action`, to choose
   what Togari does (default is `ingest`). Optionally add `table` (your Clay
   table name, used for auto-registration and lineage) and `client_id`.
6. Map the response fields back into columns. Every response is a flat JSON
   object, so Clay shows each top-level key as a mappable column.

That is the whole setup. Repeat step 1 on any other table and it works
immediately, no code change on the Togari side.

## Actions

Set the `action` field in the body. Default is `ingest`.

### action: ingest (default)

Stores the raw row first (raw is the source of truth), then extracts structured
entities and routes them into the Togari warehouse (contacts, companies,
activities).

Request:

```json
{
  "action": "ingest",
  "table": "cold_outreach",
  "full_name": "Jane Doe",
  "email": "jane@acme.com",
  "company": "Acme",
  "title": "VP Sales"
}
```

Flat response fields:

- `ok`
- `togari_ingestion_id`
- `extracted`
- `routed_contacts`
- `routed_companies`
- `routed_activities`
- `summary`

### action: dnc

The compliance column any table can add. Checks the do-not-contact list for the
row's email (and its domain).

Request:

```json
{
  "action": "dnc",
  "table": "my_leads",
  "email": "blocked@acme.com"
}
```

Email is read from the body `email`, or from the row's `email` / `work_email`.
Domain is read from body `domain`, or from `domain` / `company_domain`.

Flat response fields:

- `ok`
- `is_dnc`
- `dnc_reason`
- `matched`

### action: upsert

Idempotent upsert of a contact into the Togari warehouse, keyed on lowercased
email.

Request:

```json
{
  "action": "upsert",
  "email": "jane@acme.com",
  "full_name": "Jane Doe",
  "company": "Acme",
  "title": "VP Sales"
}
```

Flat response fields:

- `ok`
- `togari_id`
- `upserted`

### action: enrich

A real combination: runs the DNC check and the ingest in one call, returning the
merged flat fields so a single column both records the row and flags compliance.

Request:

```json
{
  "action": "enrich",
  "table": "prospects",
  "email": "jane@acme.com",
  "full_name": "Jane Doe"
}
```

Flat response fields:

- `ok`
- `enrich` (value `combined`)
- `is_dnc`
- `dnc_reason`
- `matched`
- `togari_ingestion_id`
- `extracted`

## Response contract

`/clay/v1/sync` always answers HTTP 200 with a flat JSON object. If a single row
fails, the response is `{ "ok": false, "action": "...", "error": "..." }`, still
at 200, so one bad row never breaks the whole Clay column. Only a failed auth
returns 401.

## Discovery and health

- `GET /clay/v1/schema` (no auth) returns the full catalog of actions, their
  inputs, and the response fields each returns, so the connector is
  self-describing.
- `GET /clay/v1/health` returns `{ "ok": true, "service": "togari-clay-connector" }`.

## Auto-registration

The first time a new Clay table sends a row, Togari registers it in
`togari_data_lake.clay_table_registry` (table_key, client_id, first_seen_at,
last_seen_at, row_count, status). This is what makes "add the column to any
table and it just works" true: an unknown table is registered on the fly rather
than rejected with a 400. Registration is best-effort and never blocks the
action.

## Outbound direction (Togari to Clay)

The connector above is the inbound path (Clay to Togari). The outbound path
already exists as an MCP tool, `togari_clay_push`, which selects warehouse rows
for the active client and pushes them back into a Clay table webhook for
enrichment or outreach. Related outbound tools: `togari_clay_enrich` (push
specific row_ids for enrichment) and `togari_clay_list_pushable` (read-only
preview of what would be pushed). Together the inbound `/clay/v1/sync` column
and the outbound `togari_clay_push` tool give the full bidirectional loop.

## Configuration

- `CLAY_CONNECTOR_KEY`: the shared token for the `/clay/v1/sync` column. Falls
  back to `CLAY_INGEST_API_KEY` if unset. When neither is set, requests are
  allowed outside production and denied in production.
