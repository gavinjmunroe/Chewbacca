/**
 * CREATE AMBER'S BIGQUERY LAYERS. Datasets first; the rest follows the data.
 *
 *   railway run node scripts/bq-setup.js                  DRY RUN
 *   railway run node scripts/bq-setup.js --apply          create them
 *   railway run node scripts/bq-setup.js --apply --kms projects/P/locations/L/keyRings/R/cryptoKeys/K
 *   railway run node scripts/bq-setup.js --views --apply  once CDC has landed
 *
 * DRY RUN BY DEFAULT. It prints exactly what it would create and creates
 * nothing.
 *
 * ── THREE DATASETS, BECAUSE THEY ARE LAYERS ───────────────────────────────────
 *
 *   amber_raw     what Datastream writes. One table per Cloud SQL table. Nobody
 *                 queries it: no service, no dashboard. You can, as the owner,
 *                 and that access lands in the audit log, which is the point.
 *   amber_core    six views. This is the source of truth anything else reads.
 *   amber_marts   three tables rebuilt on a schedule. Small and boring.
 *
 * Subject areas -- people, facts, messaging -- are NOT datasets. They are groups
 * of tables inside these three. A dataset is a folder; the only decision is what
 * the folders mean, and here they mean "how processed", because that is also the
 * access boundary.
 *
 * ── CMEK IS SET AT CREATION OR NOT AT ALL ─────────────────────────────────────
 *
 * A dataset's default encryption key cannot be added later without recreating
 * the dataset. Pass --kms now and every table Datastream creates inherits it;
 * skip it and switching later means rebuilding all three. That is the whole
 * reason this script exists before the stream does.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────────
 *
 * It does not create the Datastream stream. That is a console/gcloud operation
 * needing a network config and a connection profile, and it needs logical
 * decoding enabled on the Cloud SQL instance first (a flag change and a
 * restart). This script prints the settings to use and stops there.
 *
 * It does not create the amber_core views unless you pass --views, because a
 * view over a table that does not exist yet fails. Run it again with --views
 * after the first sync completes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const APPLY = argv.includes("--apply");
const WITH_VIEWS = argv.includes("--views");
const KMS_KEY = flag("--kms");
const LOCATION = flag("--location") || process.env.BQ_LOCATION || "US";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existing && fs.existsSync(existing))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-bq-setup.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const PROJECT = process.env.GCP_PROJECT_ID;
if (!PROJECT) {
  console.error(`\n  GCP_PROJECT_ID is not set. Nothing to create against.\n`);
  process.exit(2);
}

const { BigQuery } = await import("@google-cloud/bigquery");
const bq = new BigQuery({ projectId: PROJECT });

const DATASETS = [
  {
    id: "amber_raw",
    description:
      "Datastream CDC landing zone. One table per Cloud SQL table. No service " +
      "or dashboard reads this directly; amber_core is the read surface.",
  },
  {
    id: "amber_core",
    description:
      "The read surface. Seven views over amber_raw, one per question shape. Every " +
      "row carries owner_id.",
  },
  {
    id: "amber_marts",
    description:
      "Scheduled aggregates: fleet metrics, per-owner rollups, and the " +
      "PeopleRank training set.",
  },
];

/**
 * The six views. Written against the table names Datastream will create, which
 * mirror Cloud SQL exactly.
 *
 * EVERY ONE SELECTS owner_id. Not decoration -- it is what a row-access policy
 * filters on, and a view without it cannot be secured per tenant later without
 * being rewritten.
 */
/**
 * APPEND-ONLY MEANS EVERY VERSION OF EVERY ROW IS IN THE TABLE.
 *
 * That is the point -- it is the archive, and an update never destroys what it
 * replaced. It also means a plain SELECT returns a contact once for every time
 * anyone edited them, so a view over raw without this is not merely untidy, it
 * multiplies people.
 *
 * live(alias, pk) collapses a table to its CURRENT state: newest version of each
 * primary key, deletes dropped. Everything in amber_core is built on it, because
 * "who are my warmest contacts" means the contacts as they are now. Asking what
 * they looked like in 2029 means querying amber_raw directly, which is exactly
 * what amber_raw is for.
 *
 * ORDERING IS ON source_timestamp THEN change_sequence_number. The timestamp
 * alone is not enough: two changes inside the same millisecond are a coin flip,
 * and the sequence number is the tiebreak Datastream provides for precisely that.
 *
 * THE DELETE TEST IS change_type, NOT is_deleted. This was written against
 * is_deleted from memory; the actual struct Datastream created here is
 * <uuid STRING, source_timestamp INT64, change_sequence_number STRING,
 * change_type STRING, sort_keys ARRAY<STRING>> and has no such field. Every view
 * would have failed on creation with "field not found".
 *
 * AND THE FILTER GOES INSIDE QUALIFY, AFTER the row-number, not in a WHERE
 * before it. A deleted row must still WIN its partition -- that is how the view
 * learns the row is gone -- and only then be dropped. Filtering deletes out
 * first would resurrect whatever version preceded the delete.
 */
const LIVE_FILTER = (pk) => `
     QUALIFY ROW_NUMBER() OVER (
       PARTITION BY ${pk}
       ORDER BY datastream_metadata.source_timestamp DESC,
                datastream_metadata.change_sequence_number DESC) = 1
        AND datastream_metadata.change_type <> 'DELETE'`;

/**
 * DATASTREAM PREFIXES EVERY TABLE WITH ITS SOURCE SCHEMA. Cloud SQL's `contacts`
 * arrives as `public_contacts`, not `contacts` -- it has to, because two schemas
 * could each hold a table of the same name and BigQuery datasets are flat.
 *
 * Written here once so the views read like the Postgres tables they mirror, and
 * so this fact lives in one place rather than in fourteen string literals.
 */
const raw = (table) => `\`${PROJECT}.amber_raw.public_${table}\``;

/** A subquery giving one current row per primary key. */
const live = (table, pk) => `(SELECT * FROM ${raw(table)}${LIVE_FILTER(pk)})`;

const VIEWS = {
  people: `
    SELECT c.owner_id, c.id AS contact_id, c.full_name, c.company, c.title, c.city,
           s.base_score, s.warmth, s.completeness, s.observation_count,
           st.last_interaction_at, st.count_30d, st.count_90d, st.count_all
      FROM ${live("contacts", "owner_id, id")} c
      LEFT JOIN ${live("contact_scores", "owner_id, contact_id")} s
        ON s.owner_id = c.owner_id AND s.contact_id = c.id
      LEFT JOIN ${live("contact_interaction_stats", "owner_id, contact_id")} st
        ON st.owner_id = c.owner_id AND st.contact_id = c.id
     WHERE c.deleted_at IS NULL`,

  facts: `
    SELECT o.owner_id, o.observation_id, o.contact_id, o.circle_id, o.event_id,
           o.kind, o.modality, o.body, o.observed_at, o.source,
           o.confidence, o.salience, o.temporal_shape,
           d.code AS dimension, od.weight AS dimension_weight,
           od.confidence AS dimension_confidence
      FROM ${live("observations", "observation_id")} o
      LEFT JOIN ${live("observation_dimensions", "observation_id, dimension_id")} od
        ON od.observation_id = o.observation_id AND od.suppressed = false
      LEFT JOIN ${live("dimensions", "dimension_id")} d
        ON d.dimension_id = od.dimension_id
     WHERE o.deleted_at IS NULL AND o.status <> 'pending'`,

  graph: `
    SELECT a_amber_id AS owner_id, b_amber_id AS other_amber_id,
           'connection' AS edge_type, CAST(NULL AS STRING) AS scope_ref,
           status, established_at AS created_at
      FROM ${live("connections", "a_amber_id, b_amber_id")}
    UNION ALL
    SELECT b_amber_id, a_amber_id, 'connection', CAST(NULL AS STRING),
           status, established_at
      FROM ${live("connections", "a_amber_id, b_amber_id")}
    UNION ALL
    SELECT owner_id, CAST(contact_id AS STRING),
           'circle_member', CAST(circle_id AS STRING), 'active', added_at
      FROM ${live("circle_members", "circle_id, contact_id")}`,

  messages: `
    SELECT owner_id, CAST(id AS STRING) AS message_id, 'app_chat' AS channel,
           role, created_at
      FROM ${live("conversation_messages", "id")}
     WHERE deleted_at IS NULL
    UNION ALL
    SELECT sender_amber_id, CAST(id AS STRING), 'dm', 'user', created_at
      FROM ${live("dm_messages", "id")}
     WHERE deleted_at IS NULL`,

  engagement: `
    SELECT owner_id, 'answer' AS action, created_at
      FROM ${live("answers", "id")} WHERE deleted_at IS NULL
    UNION ALL
    SELECT owner_id, 'wall_post', created_at
      FROM ${live("wall_posts", "id")} WHERE deleted_at IS NULL
    UNION ALL
    SELECT owner_id, 'reminder', created_at
      FROM ${live("reminders", "reminder_id")}`,

  /**
   * EVENTS, ONE ROW PER PERSON PER EVENT. events.contact_id is the subject and
   * event_participants is everyone present, so a group dinner appears once for
   * each attendee -- which is what makes it count toward all of their warmth
   * rather than one person's.
   *
   * happened is starts_at <= now, not a stored flag: the same row is a plan
   * before its date and a memory after it, and nothing has to migrate between
   * the two states.
   */
  /**
   * ONE ROW PER PERSON PER EVENT -- AND ONLY ONE.
   *
   * The union used to carry `role`, so the subject arrived twice: once from
   * event_participants (where insertObservation writes everyone as
   * 'participant') and once from events.contact_id as 'subject'. Different role
   * values, so UNION DISTINCT kept both, and the subject of every group evening
   * was double counted. event_participants' CHECK constraint only permits
   * participant | organizer | declined, so 'subject' cannot simply be stored
   * there -- the union dedupes on identity and the role is derived after.
   *
   * `places` is not joined. Nothing in the app writes that table yet, so
   * Datastream has never created it in BigQuery and joining it would make this
   * view unbuildable rather than merely place-less. Add the join back with the
   * place writer.
   */
  events: `
    WITH attendee AS (
      SELECT event_id, owner_id, contact_id
        FROM ${live("event_participants", "event_id, contact_id")}
      UNION DISTINCT
      SELECT event_id, owner_id, contact_id
        FROM ${live("events", "event_id")}
       WHERE contact_id IS NOT NULL AND deleted_at IS NULL
    )
    SELECT ev.owner_id, ev.event_id, a.contact_id,
           IF(a.contact_id = ev.contact_id, 'subject', 'participant') AS role,
           ev.circle_id, ev.kind, ev.title, ev.modality,
           ev.starts_at, ev.ends_at,
           ev.starts_at <= CURRENT_TIMESTAMP() AS happened,
           ev.place_id, ev.created_at
      FROM ${live("events", "event_id")} ev
      LEFT JOIN attendee a
        ON a.event_id = ev.event_id AND a.owner_id = ev.owner_id
     WHERE ev.deleted_at IS NULL`,

  pipeline: `
    SELECT o.owner_id, o.observation_id, o.dimension_status,
           o.embedding_attempts,
           o.contact_id IS NOT NULL AS is_linked,
           COUNT(od.dimension_id) AS dimension_count, o.created_at
      FROM ${live("observations", "observation_id")} o
      LEFT JOIN ${live("observation_dimensions", "observation_id, dimension_id")} od
        ON od.observation_id = o.observation_id AND od.suppressed = false
     WHERE o.deleted_at IS NULL
     GROUP BY 1,2,3,4,5,7`,
};

/**
 * The amber_raw tables each view reads. Datastream creates a BigQuery table on
 * the first row it sees, so an empty Postgres table has no counterpart here --
 * that is not an error, and the view waits rather than failing the run.
 */
const VIEW_DEPS = {
  people: ["contacts", "contact_scores", "contact_interaction_stats"],
  facts: ["observations", "observation_dimensions", "dimensions"],
  graph: ["connections", "circle_members"],
  messages: ["conversation_messages", "dm_messages"],
  engagement: ["answers", "wall_posts", "reminders"],
  events: ["events", "event_participants"],
  pipeline: ["observations", "observation_dimensions"],
};
const MARTS = [
  { id: "fleet_metrics_daily", partition: "captured_at",
    schema: [
      { name: "captured_at", type: "TIMESTAMP", mode: "REQUIRED" },
      { name: "metric", type: "STRING", mode: "REQUIRED" },
      { name: "key", type: "STRING" },
      { name: "value", type: "FLOAT64", mode: "REQUIRED" },
    ] },
  { id: "owner_rollup_daily", partition: "captured_at",
    schema: [
      { name: "captured_at", type: "TIMESTAMP", mode: "REQUIRED" },
      { name: "owner_id", type: "STRING", mode: "REQUIRED" },
      { name: "contacts", type: "INT64" },
      { name: "observations", type: "INT64" },
      { name: "dimension_coverage_pct", type: "FLOAT64" },
      { name: "median_base_score", type: "FLOAT64" },
    ] },
  { id: "peoplerank_training_set", partition: "captured_at",
    schema: [
      { name: "captured_at", type: "TIMESTAMP", mode: "REQUIRED" },
      { name: "owner_id", type: "STRING", mode: "REQUIRED" },
      { name: "contact_id", type: "STRING", mode: "REQUIRED" },
      { name: "query", type: "STRING" },
      { name: "features", type: "JSON" },
      { name: "label", type: "FLOAT64" },
    ] },
];

const say = (s = "") => console.log(s);

say(`\n  AMBER BIGQUERY SETUP   project=${PROJECT}   location=${LOCATION}   ${APPLY ? "APPLY" : "DRY RUN"}`);
say(KMS_KEY ? `  CMEK: ${KMS_KEY}` : `  CMEK: none — Google-managed keys. Pass --kms to set one; it cannot be added later.`);
say("");

for (const d of DATASETS) {
  const ds = bq.dataset(d.id);
  const [exists] = await ds.exists();
  if (exists) { say(`  ${d.id.padEnd(14)} already exists — left alone`); continue; }
  if (!APPLY) { say(`  ${d.id.padEnd(14)} would create`); continue; }
  const options = { location: LOCATION, description: d.description };
  if (KMS_KEY) options.defaultEncryptionConfiguration = { kmsKeyName: KMS_KEY };
  await bq.createDataset(d.id, options);
  say(`  ${d.id.padEnd(14)} created`);
}
say("");

for (const m of MARTS) {
  const t = bq.dataset("amber_marts").table(m.id);
  const [exists] = await t.exists().catch(() => [false]);
  if (exists) { say(`  amber_marts.${m.id.padEnd(24)} already exists`); continue; }
  if (!APPLY) { say(`  amber_marts.${m.id.padEnd(24)} would create`); continue; }
  await bq.dataset("amber_marts").createTable(m.id, {
    schema: m.schema,
    timePartitioning: { type: "DAY", field: m.partition },
  });
  say(`  amber_marts.${m.id.padEnd(24)} created`);
}
say("");

if (WITH_VIEWS) {
  const [rawTables] = await bq.dataset("amber_raw").getTables().catch(() => [[]]);
  const present = new Set(rawTables.map((t) => t.id));
  if (!present.size) throw new Error("could not list amber_raw -- refusing to guess");
  for (const [name, query] of Object.entries(VIEWS)) {
    const missing = (VIEW_DEPS[name] || []).filter((d) => !present.has("public_" + d));
    if (missing.length) {
      say(`  amber_core.${name.padEnd(12)} WAITING — amber_raw has no ${missing.join(", ")}`);
      say(`      (empty in Postgres; Datastream makes the table on the first row)`);
      continue;
    }
    const t = bq.dataset("amber_core").table(name);
    const [exists] = await t.exists().catch(() => [false]);
    if (!APPLY) { say(`  amber_core.${name.padEnd(12)} ${exists ? "would replace" : "would create"}`); continue; }
    if (exists) await t.delete().catch(() => {});
    try {
      await bq.dataset("amber_core").createTable(name, { view: { query, useLegacySql: false } });
      say(`  amber_core.${name.padEnd(12)} created`);
    } catch (e) {
      say(`  amber_core.${name.padEnd(12)} FAILED — ${String(e.message).split("\n")[0]}`);
      say(`      (expected until Datastream has created the underlying amber_raw tables)`);
    }
  }
  say("");
} else {
  say(`  Views skipped. Run again with --views once Datastream has synced amber_raw.\n`);
}

say(`  NEXT — Datastream, which this script deliberately does not create:\n`);
say(`    1. Cloud SQL → your instance → Edit → Flags → set cloudsql.logical_decoding = on, then restart.`);
say(`    2. Datastream → Connection profiles → new PostgreSQL profile for the instance.`);
say(`    3. Datastream → Streams → new stream, source that profile, destination BigQuery.`);
say(`         Destination dataset: ${PROJECT}.amber_raw`);
say(`         Staleness limit: 15 minutes is plenty and costs less than 0.`);
say(`    4. Exclude these from the stream — credentials have no business in a warehouse:`);
say(`         secrets, tenant_secrets_v2, tenant_deks, tenant_secret_audit, user_api_keys,`);
say(`         device_sessions, otp_codes, pending_oauth, user_identities, push_tokens,`);
say(`         permissions, permission_audit, schema_migrations, cutover_map, cutover_review`);
say(`       plus contact_identity_keys and discovery_keys -- their primary key is a`);
say(`       bytea hash, and BigQuery cannot cluster on BYTES, so Datastream cannot`);
say(`       create those tables at all. They are hashed lookup keys; the warehouse`);
say(`       does not need them.`);
say(`    5. Backfill: yes, all tables. Under 500 GiB it is free.`);
say(`    6. Then: railway run node scripts/bq-setup.js --views --apply\n`);

if (!APPLY) say(`  DRY RUN — nothing was created.\n`);
