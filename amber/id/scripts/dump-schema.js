/**
 * GROUND TRUTH. Dumps what the live database ACTUALLY contains.
 *
 * WHY THIS EXISTS
 * db/migrations cannot build this database. Replaying all 39 files against an
 * empty Postgres 16 leaves 14 tables the code queries with no definition
 * anywhere in the repo -- users, circles, circle_members,
 * app_conversation_messages, contact_experiences, contact_notes,
 * pending_fact_context, contact_name_memory, personality_profiles, user_facts,
 * conversation_messages, onboarding_progress, permission_audit, contact_edges.
 * Somebody created those by hand and never wrote them down. The schema
 * therefore exists in exactly one place: inside the running instance.
 *
 * Before that instance is torn down and redesigned, this reads it back out.
 *
 * USAGE
 *   railway run node scripts/dump-schema.js                 # human report
 *   railway run node scripts/dump-schema.js --json          # machine-readable
 *   railway run node scripts/dump-schema.js --sql           # best-effort DDL
 *   railway run node scripts/dump-schema.js > schema.txt    # keep it
 *
 * Against any other database, set SCHEMA_DUMP_PG_URL and it will use that
 * instead of the app's Cloud SQL pool:
 *   SCHEMA_DUMP_PG_URL=postgres://user@host:5432/db node scripts/dump-schema.js
 *
 * READ-ONLY. Every statement is a SELECT against the catalog. Nothing here
 * writes, locks, or takes more than a shared catalog read.
 *
 * NO DATA IS READ. Only the shape: table names, column names, types,
 * constraints, indexes, and row COUNTS. Not one row of anyone's contacts,
 * facts, notes, or messages is selected, printed, or written to the report,
 * because the report is meant to be pasted around and diffed.
 *
 * --sql IS BEST EFFORT AND SAYS SO. It reconstructs CREATE TABLE from the
 * catalog, which recovers columns, types, defaults, nullability, primary keys,
 * uniques, checks, foreign keys and indexes -- but not comments, triggers,
 * rules, partitioning, storage parameters, collations, or ownership. For an
 * exact copy use pg_dump. This mode exists so the 14 undefined tables can be
 * checked into db/migrations TODAY rather than after a proxy is configured.
 *
 * VERIFIED 2026-08-26 against a Postgres 16 database built from all 39
 * migrations: dumped with --sql, replayed into an empty database, and diffed.
 * 40 tables, 344 columns, 66 constraints, 103 indexes -- and the column types,
 * constraint definitions, index definitions and column defaults came back
 * IDENTICAL, not merely equal in count.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const AS_JSON = has("--json");
const AS_SQL = has("--sql");

// ── connection ───────────────────────────────────────────────────────────────
// Either the app's own Cloud SQL pool (default, matches run-migration.js), or a
// plain URL for any other database.
let query;
if (process.env.SCHEMA_DUMP_PG_URL) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: process.env.SCHEMA_DUMP_PG_URL });
  query = (text, params) => pool.query(text, params);
  process.on("exit", () => pool.end().catch(() => {}));
} else {
  // Materialize the service-account JSON so the Cloud SQL connector's ADC can
  // find it -- mirrors src/db/firestore.js. Must precede the sql.js import.
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credsJson && !(existing && fs.existsSync(existing))) {
    const tmp = path.join(os.tmpdir(), "gcp-sa-schema-dump.json");
    fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
  }
  const sql = await import("../src/db/sql.js");
  query = sql.query;
  process.on("exit", () => sql.closePool().catch(() => {}));
}

const q = async (text, params) => (await query(text, params)).rows;

// ── catalog reads ────────────────────────────────────────────────────────────

async function serverInfo() {
  const [v] = await q(`SELECT version() AS version, current_database() AS db,
                              current_setting('server_version_num')::int AS vnum`);
  const installed = await q(
    `SELECT extname AS name, extversion AS version FROM pg_extension ORDER BY 1`,
  );
  // pgvector specifically: is it installed, and if not, can it be?
  const [vector] = await q(
    `SELECT
       EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')          AS installed,
       EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector')  AS available,
       (SELECT default_version FROM pg_available_extensions WHERE name = 'vector') AS version`,
  );
  return { ...v, extensions: installed, vector };
}

async function tables() {
  return q(`
    SELECT c.relname                                        AS table_name,
           c.reltuples::bigint                              AS est_rows,
           pg_total_relation_size(c.oid)                    AS total_bytes,
           pg_size_pretty(pg_total_relation_size(c.oid))    AS total_pretty,
           obj_description(c.oid, 'pg_class')               AS comment
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY 1`);
}

async function columns() {
  return q(`
    SELECT c.table_name, c.ordinal_position, c.column_name, c.data_type, c.udt_name,
           c.character_maximum_length, c.numeric_precision, c.numeric_scale,
           c.is_nullable, c.column_default, c.is_identity, c.identity_generation,
           -- THE AUTHORITATIVE RENDERING, for extension types. information_schema
           -- reports a halfvec(1536) as data_type 'USER-DEFINED', udt_name
           -- 'halfvec' and nothing else -- the dimension is simply gone, and a
           -- --sql dump that drops it cannot be replayed: an unconstrained
           -- halfvec is rejected by CREATE INDEX ... USING hnsw with "column does
           -- not have dimensions". Found by trying to replay a dump of production
           -- into a scratch database, which is the only way this kind of gap
           -- shows itself.
           format_type(a.atttypid, a.atttypmod) AS full_type
      FROM information_schema.columns c
      JOIN pg_class      pc ON pc.relname = c.table_name
      JOIN pg_namespace  pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
      JOIN pg_attribute  a  ON a.attrelid = pc.oid AND a.attname = c.column_name
     WHERE c.table_schema = 'public' AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.table_name, c.ordinal_position`);
}

/**
 * Constraints straight from pg_constraint rather than the information_schema
 * views: the views flatten multi-column keys into one row per column, which
 * loses the column ORDER, and order is the whole point of a composite key.
 * pg_get_constraintdef gives back the exact text Postgres would print.
 */
async function constraints() {
  return q(`
    SELECT rel.relname                       AS table_name,
           con.conname                       AS name,
           con.contype                       AS type,
           pg_get_constraintdef(con.oid)     AS definition,
           ref.relname                       AS references_table
      FROM pg_constraint con
      JOIN pg_class rel      ON rel.oid = con.conrelid
      JOIN pg_namespace n    ON n.oid = rel.relnamespace
      LEFT JOIN pg_class ref ON ref.oid = con.confrelid
     WHERE n.nspname = 'public'
     ORDER BY rel.relname, con.contype DESC, con.conname`);
}

async function indexes() {
  return q(`
    SELECT tablename AS table_name, indexname AS name, indexdef AS definition
      FROM pg_indexes WHERE schemaname = 'public'
     ORDER BY tablename, indexname`);
}

async function views() {
  return q(`SELECT table_name FROM information_schema.views
             WHERE table_schema='public' ORDER BY 1`);
}

async function trueCounts(names) {
  // reltuples is an ESTIMATE and is -1 on a table that has never been analyzed,
  // which is exactly the case for a table nobody has vacuumed. For a database
  // this small an exact count costs nothing and removes the ambiguity.
  const out = {};
  for (const t of names) {
    try {
      const [r] = await q(`SELECT count(*)::bigint AS n FROM "${t}"`);
      out[t] = Number(r.n);
    } catch {
      out[t] = null;
    }
  }
  return out;
}

// ── analysis ─────────────────────────────────────────────────────────────────

/**
 * THE LINK AUDIT. "Contacts are not properly linking to the information about
 * them" is a testable claim, and this is the test: every column that is NAMED
 * like a foreign key but has no foreign key constraint behind it.
 *
 * A missing constraint means the link is a convention held up by application
 * code. Nothing stops a row from pointing at a contact that was deleted last
 * month, and nothing in the GCP console will draw the relationship, because
 * as far as Postgres is concerned there is no relationship -- only two columns
 * that happen to share a name.
 */
function linkAudit(cols, cons, tableNames) {
  const fkCols = new Set();
  for (const c of cons) {
    if (c.type !== "f") continue;
    // "FOREIGN KEY (a, b) REFERENCES t(x, y) ..." -> pull the local columns
    const m = /FOREIGN KEY \(([^)]+)\)/i.exec(c.definition || "");
    if (!m) continue;
    for (const raw of m[1].split(",")) {
      fkCols.add(`${c.table_name}.${raw.trim().replace(/"/g, "")}`);
    }
  }

  const known = new Set(tableNames);

  /**
   * Columns that are id-SHAPED but are not links to anything in this database.
   * Listed explicitly and reported separately rather than silently dropped: a
   * report that cries wolf on every one of these gets ignored, and a report
   * that hides them lets a real missing link slip through as "external".
   */
  const EXTERNAL = new Set([
    "external_id",     // the id in Google / Apple / a CSV, not ours
    "device_id",       // client-supplied, advisory only
    "subject_id",      // whatever the auth provider calls the person
    "family_id",       // a rotation family, self-referential by convention
    "key_id",          // this row's own public identifier
    "person_id",       // medha's sha256(E.164), not a row id
    "privy_did",
    "pinecone_index_did",
    "tenant_id",
  ]);

  /**
   * Guess the referenced table from the column name.
   *
   * Returns a NAME only when there is real evidence for it -- a table by that
   * name exists, or the column is one of the three entity references this
   * schema is built around (a person, a circle, a contact). Anything else
   * returns null and lands in the "review manually" bucket, because inventing a
   * plural produces lines like "cleared_before_id probably references
   * cleared_befores", and a report that guesses wrong once gets trusted less
   * everywhere else.
   */
  const guessTarget = (col, fromTable) => {
    // The person. Every owning column in this system is a user.
    if (col === "owner_id" || col === "amber_id" ||
        col.endsWith("_amber_id") || col.endsWith("_owner_id")) {
      return "users";
    }
    if (col === "circle_id") return "circles";
    if (col === "contact_id") return "contacts";
    if (!col.endsWith("_id")) return null;

    const stem = col.slice(0, -3);
    // Respect the table's own prefix so dm_reactions.message_id resolves to
    // dm_messages rather than to a nonexistent `messages`.
    const prefix = fromTable.includes("_") ? fromTable.split("_")[0] + "_" : "";
    for (const cand of [`${prefix}${stem}s`, `${prefix}${stem}`, `${stem}s`, stem, `${stem}es`]) {
      // A column that resolves to its OWN table is a self-identifier, not a
      // link (reminders.reminder_id is the external id of that reminder).
      if (cand === fromTable) return null;
      if (known.has(cand)) return cand;
    }
    return null;
  };

  // Columns in the same table, so a polymorphic pair (item_id + item_type) can
  // be recognized as deliberate rather than reported as a broken link.
  const siblings = new Map();
  for (const c of cols) {
    if (!siblings.has(c.table_name)) siblings.set(c.table_name, new Set());
    siblings.get(c.table_name).add(c.column_name);
  }

  const rows = [];
  const external = [];
  const review = [];
  for (const c of cols) {
    const name = c.column_name;
    const isIdish =
      name.endsWith("_id") || name === "amber_id" || name.endsWith("_amber_id");
    if (!isIdish) continue;
    // A table's own surrogate key is not a foreign key.
    if (name === "id") continue;
    const key = `${c.table_name}.${name}`;
    if (fkCols.has(key)) continue;

    if (EXTERNAL.has(name)) {
      external.push({ table: c.table_name, column: name, type: c.udt_name, why: "external id" });
      continue;
    }
    // POLYMORPHIC BY DESIGN: `item_id` alongside `item_type` cannot carry a
    // foreign key, because the target table varies per row. That is a real
    // trade-off (Postgres cannot enforce it) but it is a choice, not a bug.
    const stem = name.endsWith("_id") ? name.slice(0, -3) : name;
    if (siblings.get(c.table_name)?.has(`${stem}_type`)) {
      external.push({
        table: c.table_name, column: name, type: c.udt_name,
        why: `polymorphic — target varies by ${stem}_type`,
      });
      continue;
    }
    // Watermarks and pointers: a high-water mark is a message id, but it is a
    // position in a stream rather than a parent row.
    if (name.startsWith("last_") || /_(before|after|from|to)_id$/.test(name)) {
      review.push({
        table: c.table_name, column: name, type: c.udt_name,
        why: "watermark / pointer",
      });
      continue;
    }

    const target = guessTarget(name, c.table_name);
    if (!target) {
      review.push({ table: c.table_name, column: name, type: c.udt_name, why: "no obvious target" });
      continue;
    }
    rows.push({
      table: c.table_name,
      column: name,
      type: c.udt_name,
      likely_references: target,
      target_exists: known.has(target),
    });
  }
  return { unenforced: rows, external, review };
}

/**
 * THE TYPE-MISMATCH DETECTOR, and the reason it earns its place: this codebase
 * has already shipped this exact bug. contacts.owner_id is uuid while
 * contact_favorites.owner_id is text. Postgres refuses to compare uuid = text
 * and raises "operator does not exist", the join returns nothing, a swallowed
 * catch turns that into an empty array, and the favorites screen renders as
 * "no favorites" instead of as an error. It was invisible for weeks.
 *
 * Any column name that carries two different types across tables is that bug
 * waiting to happen the first time somebody joins on it.
 */
function typeMismatches(cols) {
  const byName = new Map();
  for (const c of cols) {
    const isIdish =
      c.column_name.endsWith("_id") ||
      c.column_name === "amber_id" ||
      c.column_name.endsWith("_at") ||
      c.column_name.endsWith("_key");
    if (!isIdish) continue;
    if (!byName.has(c.column_name)) byName.set(c.column_name, new Map());
    const m = byName.get(c.column_name);
    if (!m.has(c.udt_name)) m.set(c.udt_name, []);
    m.get(c.udt_name).push(c.table_name);
  }
  const out = [];
  for (const [col, types] of byName) {
    if (types.size < 2) continue;
    out.push({
      column: col,
      variants: [...types.entries()].map(([type, tables]) => ({
        type,
        tables: tables.sort(),
      })),
    });
  }
  return out.sort((a, b) => b.variants.length - a.variants.length);
}

function noPrimaryKey(tableNames, cons) {
  const withPk = new Set(cons.filter((c) => c.type === "p").map((c) => c.table_name));
  return tableNames.filter((t) => !withPk.has(t));
}

// ── DDL reconstruction (--sql) ───────────────────────────────────────────────

/**
 * SERIAL COLUMNS DO NOT EXIST as a type. `bigserial` is sugar for "bigint, plus
 * a sequence, plus a DEFAULT nextval() pointing at it", and the catalog only
 * remembers the expansion. Emitting that expansion verbatim produces
 * `DEFAULT nextval('agent_log_id_seq'::regclass)` against a database where no
 * such sequence exists yet, and the whole file dies on the first table.
 * Collapsing it back to bigserial recreates the sequence as a side effect.
 */
function serialType(c) {
  if (!/^nextval\(/i.test(c.column_default || "")) return null;
  return { bigint: "bigserial", integer: "serial", smallint: "smallserial" }[c.data_type] || null;
}

function renderType(c) {
  const t = c.data_type;
  if (t === "character varying") {
    return c.character_maximum_length ? `varchar(${c.character_maximum_length})` : "varchar";
  }
  if (t === "character") {
    return c.character_maximum_length ? `char(${c.character_maximum_length})` : "char";
  }
  if (t === "numeric" && c.numeric_precision != null) {
    return c.numeric_scale ? `numeric(${c.numeric_precision},${c.numeric_scale})`
                           : `numeric(${c.numeric_precision})`;
  }
  if (t === "ARRAY") return `${c.udt_name.replace(/^_/, "")}[]`;
  // An extension type keeps whatever format_type says, typmod included.
  if (t === "USER-DEFINED") return c.full_type || c.udt_name;
  if (t === "timestamp with time zone") return "timestamptz";
  if (t === "timestamp without time zone") return "timestamp";
  return t;
}

function renderDDL({ tbls, cols, cons, idxs }) {
  const colsBy = new Map();
  for (const c of cols) {
    if (!colsBy.has(c.table_name)) colsBy.set(c.table_name, []);
    colsBy.get(c.table_name).push(c);
  }
  const consBy = new Map();
  for (const c of cons) {
    if (!consBy.has(c.table_name)) consBy.set(c.table_name, []);
    consBy.get(c.table_name).push(c);
  }
  const idxBy = new Map();
  for (const i of idxs) {
    if (!idxBy.has(i.table_name)) idxBy.set(i.table_name, []);
    idxBy.get(i.table_name).push(i);
  }

  const out = [
    "-- BEST-EFFORT schema reconstructed from the live database catalog by",
    "-- scripts/dump-schema.js. Columns, types, defaults, nullability, primary",
    "-- keys, uniques, checks, foreign keys and indexes are recovered. Comments,",
    "-- triggers, rules, partitioning, storage parameters, collations and",
    "-- ownership are NOT. For an exact copy use pg_dump --schema-only.",
    "--",
    "-- Foreign keys are emitted as separate ALTER statements AFTER every table,",
    "-- so this file applies in one pass regardless of dependency order.",
    "",
  ];

  const alters = [];
  for (const t of tbls) {
    const name = t.table_name;
    const lines = [];
    for (const c of (colsBy.get(name) || [])) {
      const serial = serialType(c);
      let line = `  ${c.column_name.padEnd(24)} ${serial || renderType(c)}`;
      if (serial) {
        // bigserial already implies NOT NULL and owns its own sequence.
      } else if (c.is_identity === "YES") {
        line += ` GENERATED ${c.identity_generation} AS IDENTITY`;
      } else if (c.column_default != null) {
        line += ` DEFAULT ${c.column_default}`;
      }
      if (c.is_nullable === "NO" && !serial) line += " NOT NULL";
      lines.push(line);
    }
    for (const k of (consBy.get(name) || [])) {
      // FKs go out as ALTERs below; everything else is inline.
      if (k.type === "f") { alters.push(`ALTER TABLE ${name} ADD CONSTRAINT ${k.name} ${k.definition};`); continue; }
      lines.push(`  CONSTRAINT ${k.name} ${k.definition}`);
    }
    out.push(`CREATE TABLE IF NOT EXISTS ${name} (`);
    out.push(lines.join(",\n"));
    out.push(");");
    for (const i of (idxBy.get(name) || [])) {
      // A constraint's backing index is created by the constraint itself.
      if ((consBy.get(name) || []).some((k) => k.name === i.name)) continue;
      out.push(i.definition.replace(/^CREATE (UNIQUE )?INDEX /, "CREATE $1INDEX IF NOT EXISTS ") + ";");
    }
    out.push("");
  }
  if (alters.length) {
    out.push("-- Foreign keys, applied after every table exists.");
    out.push(...alters, "");
  }
  return out.join("\n");
}

// ── report ───────────────────────────────────────────────────────────────────

const pad = (s, n) => String(s ?? "").padEnd(n);
const h1 = (s) => `\n${"=".repeat(78)}\n  ${s}\n${"=".repeat(78)}`;
const h2 = (s) => `\n-- ${s} ${"-".repeat(Math.max(0, 74 - s.length))}`;

function renderReport(d) {
  const L = [];
  L.push(h1("LIVE SCHEMA — " + d.server.db));
  L.push(`  ${d.server.version.split(",")[0]}`);
  L.push(`  ${d.tables.length} tables, ${d.views.length} views`);
  L.push(
    `  extensions: ${d.server.extensions.map((e) => e.name + " " + e.version).join(", ") || "none"}`,
  );
  L.push(
    `  pgvector: ${
      d.server.vector.installed
        ? "INSTALLED"
        : d.server.vector.available
          ? `not installed, but AVAILABLE (v${d.server.vector.version}) — CREATE EXTENSION vector;`
          : "not available on this instance"
    }`,
  );

  L.push(h1("TABLES"));
  L.push(`  ${pad("table", 34)}${pad("rows", 12)}size`);
  L.push(`  ${"-".repeat(70)}`);
  for (const t of d.tables) {
    const n = d.counts[t.table_name];
    L.push(`  ${pad(t.table_name, 34)}${pad(n == null ? "?" : n.toLocaleString(), 12)}${t.total_pretty}`);
  }

  L.push(h1("COLUMNS, CONSTRAINTS, INDEXES"));
  const colsBy = new Map();
  for (const c of d.columns) {
    if (!colsBy.has(c.table_name)) colsBy.set(c.table_name, []);
    colsBy.get(c.table_name).push(c);
  }
  for (const t of d.tables) {
    const name = t.table_name;
    L.push(h2(`${name}   (${d.counts[name] ?? "?"} rows)`));
    for (const c of colsBy.get(name) || []) {
      const bits = [];
      if (c.is_nullable === "NO") bits.push("NOT NULL");
      if (c.column_default) bits.push(`DEFAULT ${c.column_default}`);
      L.push(`   ${pad(c.column_name, 26)}${pad(renderType(c), 18)}${bits.join("  ")}`);
    }
    const ks = d.constraints.filter((k) => k.table_name === name);
    for (const k of ks) {
      const label = { p: "PK", f: "FK", u: "UNIQUE", c: "CHECK" }[k.type] || k.type;
      L.push(`   ${pad("[" + label + "]", 26)}${k.definition}`);
    }
    for (const i of d.indexes.filter((x) => x.table_name === name)) {
      if (ks.some((k) => k.name === i.name)) continue;
      L.push(`   ${pad("[index]", 26)}${i.definition.replace(/^CREATE /, "")}`);
    }
  }

  L.push(h1("LINK AUDIT — columns that LOOK like foreign keys but are not"));
  L.push("  A missing constraint means the link is a convention in application code.");
  L.push("  Nothing stops a row pointing at a deleted parent, and nothing in the GCP");
  L.push("  console will draw the relationship — as far as Postgres is concerned,");
  L.push("  there is no relationship, only two columns that share a name.");
  L.push("");
  if (!d.linkAudit.unenforced.length) {
    L.push("  None. Every id-shaped column has a real foreign key.");
  } else {
    L.push(`  ${pad("table", 30)}${pad("column", 24)}${pad("type", 12)}probably references`);
    L.push(`  ${"-".repeat(92)}`);
    for (const r of d.linkAudit.unenforced) {
      const tgt = r.likely_references
        ? r.likely_references + (r.target_exists ? "" : "  << TARGET MISSING")
        : "(unknown)";
      L.push(`  ${pad(r.table, 30)}${pad(r.column, 24)}${pad(r.type, 12)}${tgt}`);
    }
    L.push("");
    L.push(`  ${d.linkAudit.unenforced.length} unenforced links.`);
  }
  if (d.linkAudit.external.length) {
    L.push("");
    L.push("  Id-shaped but NOT a link to a row in this database — deliberate, and");
    L.push("  listed so nothing is hidden:");
    for (const r of d.linkAudit.external) {
      L.push(`    ${pad(r.table, 30)}${pad(r.column, 22)}${pad(r.type, 10)}${r.why}`);
    }
  }
  if (d.linkAudit.review.length) {
    L.push("");
    L.push("  REVIEW BY HAND — id-shaped, no constraint, and no target this script");
    L.push("  is willing to guess at:");
    for (const r of d.linkAudit.review) {
      L.push(`    ${pad(r.table, 30)}${pad(r.column, 22)}${pad(r.type, 10)}${r.why}`);
    }
  }

  L.push(h1("TYPE MISMATCHES — the same column name, different types"));
  L.push("  This codebase has already shipped this bug: contacts.owner_id is uuid,");
  L.push("  contact_favorites.owner_id is text, Postgres refuses uuid = text, the");
  L.push("  join raised an error, a swallowed catch turned it into [], and the");
  L.push("  favorites screen showed 'no favorites' for weeks instead of failing.");
  L.push("");
  if (!d.typeMismatches.length) {
    L.push("  None. Every shared column name has one consistent type.");
  } else {
    for (const m of d.typeMismatches) {
      L.push(`  ${m.column}`);
      for (const v of m.variants) {
        L.push(`      ${pad(v.type, 14)}${v.tables.join(", ")}`);
      }
      L.push("");
    }
    L.push(`  ${d.typeMismatches.length} column names carry more than one type.`);
  }

  const empty = d.tables.map((t) => t.table_name).filter((t) => d.counts[t] === 0);
  if (empty.length) {
    L.push(h1("EMPTY TABLES — zero rows"));
    L.push("  With a handful of real users, a table at zero is one of three things:");
    L.push("  a feature nobody has used, a feature that is BROKEN and failing its");
    L.push("  writes silently, or a table nothing writes to any more. Worth deciding");
    L.push("  which, one at a time, before carrying any of them into the new schema.");
    L.push("");
    for (const t of empty) L.push(`  ${t}`);
    L.push("");
    L.push(`  ${empty.length} of ${d.tables.length} tables are empty.`);
  }

  if (d.noPrimaryKey.length) {
    L.push(h1("TABLES WITH NO PRIMARY KEY"));
    L.push("  No primary key means no natural dedupe, no safe upsert target, and no");
    L.push("  way for a replica or a CDC stream to identify a row.");
    L.push("");
    for (const t of d.noPrimaryKey) L.push(`  ${t}`);
  }

  L.push(h1("SUMMARY"));
  L.push(`  tables ............... ${d.tables.length}`);
  L.push(`  total rows ........... ${Object.values(d.counts).reduce((a, b) => a + (b || 0), 0).toLocaleString()}`);
  L.push(`  foreign keys ......... ${d.constraints.filter((c) => c.type === "f").length}`);
  L.push(`  UNENFORCED links ..... ${d.linkAudit.unenforced.length}`);
  L.push(`  type mismatches ...... ${d.typeMismatches.length}`);
  L.push(`  tables with no PK .... ${d.noPrimaryKey.length}`);
  L.push("");
  return L.join("\n");
}

// ── main ─────────────────────────────────────────────────────────────────────

const server = await serverInfo();
const tbls = await tables();
const names = tbls.map((t) => t.table_name);
const [cols, cons, idxs, vws] = await Promise.all([columns(), constraints(), indexes(), views()]);
const counts = await trueCounts(names);

const data = {
  generated_at: new Date().toISOString(),
  server,
  tables: tbls,
  views: vws,
  columns: cols,
  constraints: cons,
  indexes: idxs,
  counts,
  linkAudit: linkAudit(cols, cons, names),
  typeMismatches: typeMismatches(cols),
  noPrimaryKey: noPrimaryKey(names, cons),
};

if (AS_JSON) console.log(JSON.stringify(data, null, 2));
else if (AS_SQL) console.log(renderDDL({ tbls, cols, cons, idxs }));
else console.log(renderReport(data));

process.exit(0);
