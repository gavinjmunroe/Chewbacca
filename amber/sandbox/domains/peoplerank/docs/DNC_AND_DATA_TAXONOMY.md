# DNC + contact data taxonomy (dynamic Pinecone-synced)

Owner: Caleb. Task from Karthik: "DNC completion + identification of immutable
and other miscellaneous data and how to generally categorize it." Goal locked
with Caleb: the DNC/contacts dataset should **dynamically reflect a user's live
contact graph (Sagar's, in medha-id Pinecone/Firestore) and stay in sync as that
graph is updated**, with a field taxonomy designed for safe repeated re-sync.

This doc is the written taxonomy spec + the sync design it implies.

---

## 1. Current state (inspected live, 2026-06-08)

BigQuery: `midyear-glazing-485303-u3.togari_dnc` (Karthik's dataset; I have
query+modify via the `togari-mcp` service account).

Tables / views:

- `contacts` (2135 rows) — the unified contact spine. Every row is
  `owner_did="env-default"`, `org_id="bma"` (Karthik's Gmail import). **Zero rows
  have `is_dnc=TRUE`** — the DNC flag exists but nothing is flagged yet.
- `social_connections` — per-platform connections (LinkedIn etc.), own `is_dnc`,
  joined to `contacts` by `dnc_contact_id`.
- `contacts_backup`, `contacts_pre_migration` — safety copies from a prior
  schema migration (the live `contacts` already carries the post-migration
  columns: `owner_did`, realness*\*, apple*_, full*name/first/last, current*_).
- `sync_log`, `api_keys`.
- Views: `v_dnc_only` (is_dnc=TRUE), `v_contacts_enriched` (adds source_count),
  `v_dnc_unified` + `v_dnc_unified_by_owner` (social_connections LEFT JOIN
  contacts, owner-scoped).

**Gap #1 (the headline):** Sagar's contacts are NOT in here. His graph lives in
medha-id (Firestore canonical + Pinecone DID namespace
`tenant-did-privy-cmobxrpvr00ml0cjp5gq5mdyd`). Nothing syncs medha-id → BigQuery.

**Gap #2:** Several of Karthik's stated immutables are missing as columns:
`geographic location`, `gender`, `age`/`DOB`, `alma mater`. The spine can't hold
them yet, so DNC/matching can't gate or enrich on them.

**Gap #3:** DNC is inert — no rows flagged, and the flag isn't read by the
rank/search path, so a do-not-contact person can still surface.

---

## 2. The taxonomy (four tiers + a gate)

Every contact field belongs to exactly one tier. The tier decides **what a
re-sync is allowed to do to it** — that is the whole point for dynamic updating.

### Tier I — IMMUTABLE (canonical spine; write-once)

Stable facts that identify the human. Karthik: "consistent, always enriched."
On re-sync, **fill if empty, never overwrite** (`COALESCE(existing, incoming)`).

| Field                                             | In schema?   | Notes                                      |
| ------------------------------------------------- | ------------ | ------------------------------------------ |
| `owner_did`                                       | yes          | who owns this contact record (Sagar's DID) |
| `contact_id` / `id`                               | yes          | stable key                                 |
| `name` / `full_name` / `first_name` / `last_name` | yes          |                                            |
| `email` (primary)                                 | yes          | identity-grade                             |
| `phone`                                           | yes          | identity-grade                             |
| geographic location / home city                   | **NO — add** | Karthik immutable                          |
| gender                                            | **NO — add** | Karthik immutable                          |
| age / DOB                                         | **NO — add** | Karthik immutable                          |
| alma mater                                        | **NO — add** | Karthik immutable                          |

> Closing Gap #2 = ALTER `contacts` to add `home_location`, `gender`, `dob DATE`,
> `age` (or derive age from dob at read time), `alma_mater`. These become Clay's
> enrichment targets.

### Tier II — VARIABLE (current state; overwrite on sync)

Changes over time; the latest sync wins (`incoming` replaces `existing`).

`company` / `current_company`, `title` / `current_title`, `company_domain`
(derive), `linkedin_url`, `linkedin_username`, `instagram_username`,
`twitter_username`, `facebook_username`, `tiktok_username`, current city (if we
track "where they are now" distinct from home_location).

### Tier III — DERIVED (computed; recompute on sync, never user-stated)

Outputs of our own logic. Recompute every sync; never trust an inbound value.

`confidence_score`, `merge_count`, `is_real_person`, `realness_score`,
`realness_reason`, source_count (view), and future: centrality / personalized
PageRank, relationship warmth. (These are the "intuition" signals for matching.)

### Tier IV — MISC / PROVENANCE (metadata; merge/union on sync)

Bookkeeping. Union sources, bump timestamps; never gate or rank on these.

`source_platform`, `sources`, `platform_sources[]`, `source_detail` (JSON),
`apple_contact_id`, `apple_etag`, `imported_at`, `first_seen_at`,
`last_updated_at`, `last_synced_at`, `sync_status`.

### The GATE — DNC (sticky; survives every sync)

`is_dnc`, `dnc_reason`, `dnc_added_at`. **Critical rule: a re-sync must NEVER
clear or downgrade DNC.** Once flagged, it stays flagged regardless of what the
contact source says. DNC is set by humans/Clay/imports, not by the contact feed.

---

## 3. Dynamic sync design (medha-id → BigQuery)

Source of truth = medha-id contacts (Firestore, read today via the people-rank
engine path; the `/internal/users/:did/contacts` list 404s because there's no
Privy user row — fix that or read Firestore directly for the exporter).

Mechanism = an incremental **BigQuery `MERGE`** keyed on
`(owner_did, contact_id)`:

```
MERGE contacts T
USING <staged medha-id contacts for owner_did=Sagar> S
ON  T.owner_did = S.owner_did AND T.contact_id = S.contact_id
WHEN MATCHED THEN UPDATE SET
  -- Tier II variable: overwrite
  current_company = S.company, current_title = S.title, linkedin_url = S.linkedin_url, ...,
  -- Tier I immutable: fill-only
  home_location = COALESCE(T.home_location, S.city),
  email = COALESCE(T.email, S.email), phone = COALESCE(T.phone, S.phone), ...,
  -- Tier III derived: recompute
  merge_count = T.merge_count + 1, realness_score = S.realness_score, ...,
  -- Tier IV provenance: union + stamp
  platform_sources = ARRAY(SELECT DISTINCT x FROM UNNEST(ARRAY_CONCAT(T.platform_sources, S.platform_sources)) x),
  last_synced_at = CURRENT_TIMESTAMP(), sync_status = 'synced'
  -- GATE: is_dnc / dnc_* intentionally NOT in the SET list (sticky)
WHEN NOT MATCHED THEN INSERT (...) VALUES (...)   -- is_dnc defaults FALSE
```

Why MERGE: idempotent, safe to re-run, and the SET list **encodes the taxonomy**
(immutable=COALESCE, variable=overwrite, derived=recompute, provenance=union,
DNC=absent). Re-syncing 10x changes nothing it shouldn't.

Trigger options (Caleb's call):

- **Push (preferred for "whenever Pinecone updates"):** medha-id's contact
  upsert/index path enqueues the changed contact(s) to a BQ sync. Lowest latency.
- **Pull (simplest first):** a scheduled job MERGEs all medha-id contacts with
  `last_updated_at > last watermark` for the owner. Robust, a few-minute lag.
- Recommended: ship Pull first (one MERGE on a cron + a manual "sync now"),
  add Push later once the contact-change event exists.

---

## 4. DNC enforcement (make the gate do something)

Today DNC is inert. Wire it in two places:

1. **Write:** Clay / Gmail / LinkedIn imports and a manual endpoint set
   `is_dnc=TRUE, dnc_reason, dnc_added_at`. (Karthik's `/api/dnc/*` already does
   this for his data; extend to per-owner.)
2. **Read (the actual protection):** the rank/search path must exclude DNC
   before returning. Cleanest: the PeopleRank engine (or the medha-id endpoint
   that feeds it) filters out `is_dnc=TRUE` contacts for that owner. A
   `v_dnc_only` / per-owner DNC set is the lookup.

---

## 5. Schema changes to land (DNC completion checklist)

- [ ] ALTER `contacts` add immutables: `home_location STRING`, `gender STRING`,
      `dob DATE`, `alma_mater STRING` (age derived from dob).
- [ ] medha-id contact exporter (read Firestore for a DID → BQ staging shape).
- [ ] MERGE job (taxonomy-encoded) + a `sync_now` entrypoint + `sync_log` row.
- [ ] Backfill Sagar (owner_did=did:privy:cmobxrpvr…) as the first synced owner.
- [ ] DNC read-filter in the rank/search path.
- [ ] Fix `/internal/users/:did/contacts` user_not_found (or document Firestore
      read path for the exporter).

---

## 6. Open questions for Caleb / Karthik

- Is "geographic location" immutable (home/origin) or current city? If both
  matter, we keep `home_location` (Tier I) and a `current_city` (Tier II).
- Per-owner DNC scope: does an org-level DNC (org_id=bma) override an individual
  owner, or vice versa? (`v_dnc_unified_by_owner` hints owner-scoped; confirm
  precedence.)
- Source-of-truth on conflict: if Clay enriches an immutable that medha-id also
  has, who wins? (Proposed: first non-null wins; Clay only fills nulls.)
