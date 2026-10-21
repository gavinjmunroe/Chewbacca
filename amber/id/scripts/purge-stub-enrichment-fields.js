/**
 * TAKE THE FIXTURE'S ANSWERS OFF REAL PEOPLE'S CARDS.
 *
 *   railway run node scripts/purge-stub-enrichment-fields.js            REPORT ONLY
 *   railway run node scripts/purge-stub-enrichment-fields.js --confirm  actually clear
 *
 * "A lot of people in my database are listed as product managers in New York at
 *  Globex. I don't have any product manager info in my entire contact base."
 *
 * He is right, and the source is not a bad vendor -- it is our own test double.
 * src/enrichment/providers/stub-provider.js returns three deterministic
 * candidates for any name, and the second one is titled "Product Manager" at
 * "Globex" in "New York". It exists so the ranker has something to rank while
 * CLAY_API_KEY is unset. It was never meant to reach a card, and it did.
 *
 * DESTRUCTIVE, AND GATED. Without --confirm it reads and prints and changes
 * nothing. The gate is not ceremony: the argument for clearing these values is
 * that they are FALSE, which is a judgment a person makes and a script must not.
 *
 * IT DECIDES ON PROVENANCE, NOT ON THE VALUE. Clearing every contact whose city
 * says "New York" would delete the truth about the people who actually live
 * there, and he said so explicitly in the same breath. contacts.field_sources is
 * a {column: source_label} map written beside the value it describes, so the
 * question this asks is "who wrote this field", never "what does it say".
 *
 * The literal fixture values are used only as a CORROBORATOR, for rows written
 * before per-field provenance existed and which therefore have no field_sources
 * entry to go on. On those, a field is cleared only when the value is one the
 * stub is known to emit AND the row's own source is one of the enrichment
 * labels. A row whose source is apple or google is never touched on any path.
 *
 * WHAT IT DOES NOT TOUCH: names, phones, emails, identity keys, circles, notes,
 * observations (scripts/purge-seed-enrichment.js is the one for those), or any
 * field whose provenance names a source the owner actually synced.
 *
 * AFTER RUNNING, re-roll the scores, since completeness is computed from these
 * very columns and a cleared field should lower it:
 *   railway run node scripts/contact-rollup.js
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existing && fs.existsSync(existing))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-purge-stub.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query, closePool } = await import("../src/db/sql.js");

const argv = process.argv.slice(2);
const CONFIRM = argv.includes("--confirm");
const argOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};

/** The columns a fabricated candidate lands in. Nothing identity-bearing. */
const FIELDS = ["title", "company", "city", "linkedin_url"];

/**
 * Source labels that mean "a machine guessed this".
 *
 * Overridable with --sources so the report can be read first and the list
 * narrowed or widened to match what is actually in there, rather than this
 * file's guess about it.
 */
const DEFAULT_SOURCES = ["stub", "enrichment", "peoplerank_enrich", "clay", "vendor", "smoke", "clay-smoke-test"];
const SOURCES = (argOf("sources") ?? DEFAULT_SOURCES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);

/** One value on this many contacts is not something a sync produced. */
const SUSPICIOUS_AT = Number(argOf("suspicious-at") ?? 20);

/**
 * EXPLICIT TARGETS: --clear 'title=Product Manager' (repeatable).
 *
 * The provenance rule cannot see a fixture that wrote itself into the row's
 * own `source` label, and on this book it did -- 67 contacts carry one title,
 * one company and two cities, all stamped "google". Nothing automatic should
 * clear those: "every contact google gave the same job title is wrong" is a
 * judgment about his address book, and he is the one who can make it. So the
 * report names them and this flag is how he says yes to a specific one.
 */
const CLEAR_TARGETS = argv
  .map((a, i) => (a === "--clear" ? argv[i + 1] : null))
  .filter(Boolean)
  .map((pair) => {
    const eq = String(pair).indexOf("=");
    if (eq <= 0) throw new Error(`--clear expects field=value, got "${pair}"`);
    const field = pair.slice(0, eq).trim();
    if (!FIELDS.includes(field)) {
      throw new Error(`--clear field must be one of ${FIELDS.join(", ")}, got "${field}"`);
    }
    return { field, value: pair.slice(eq + 1) };
  });

/** Exactly what src/enrichment/providers/stub-provider.js emits. */
const STUB_VALUES = {
  title: ["Software Engineer", "Product Manager", "Analyst"],
  company: ["Acme Corp", "Globex", "Kowalski LLC"],
  city: ["Chicago", "New York", "Warsaw"],
  linkedin_url: [],
};

const n = (v) => Number(v ?? 0).toLocaleString();

async function main() {
  console.log(`\n  fields:  ${FIELDS.join(", ")}`);
  console.log(`  sources: ${SOURCES.join(", ")}\n`);

  // ── STEP 1: WHO WROTE WHAT, AND WHAT THEY WROTE. ──────────────────────────
  //
  // The first version of this printed only the source and a distinct COUNT,
  // and that was not enough to see the problem: "67 rows, 1 distinct value,
  // from google" is the whole story and it reads as unremarkable until the
  // value itself is on screen next to it. A report that makes you go and query
  // the thing it was supposed to tell you is not a report.
  //
  // A REAL SYNC DOES NOT GIVE SIXTY-SEVEN PEOPLE THE SAME JOB TITLE. That is
  // the test below: any single value covering more than SUSPICIOUS_AT contacts
  // is called out whatever source label it carries, because a fixture that
  // wrote itself into the row's own `source` is exactly the case the provenance
  // check cannot catch.
  const suspicious = [];
  for (const field of FIELDS) {
    const { rows } = await query(
      `SELECT COALESCE(field_sources->>$1, source, '(none)') AS wrote,
              ${field} AS value,
              count(*)::int AS n
         FROM contacts
        WHERE deleted_at IS NULL AND NULLIF(btrim(COALESCE(${field}, '')), '') IS NOT NULL
        GROUP BY 1, 2 ORDER BY 3 DESC`,
      [field],
    );

    const bySource = new Map();
    for (const r of rows) {
      if (!bySource.has(r.wrote)) bySource.set(r.wrote, []);
      bySource.get(r.wrote).push(r);
      if (r.n >= SUSPICIOUS_AT) suspicious.push({ field, ...r });
    }

    console.log(`  ${field}`);
    if (rows.length === 0) console.log("      (nothing set anywhere)");
    for (const [wrote, list] of [...bySource.entries()].sort(
      (a, b) => b[1].reduce((t, r) => t + r.n, 0) - a[1].reduce((t, r) => t + r.n, 0),
    )) {
      const total = list.reduce((t, r) => t + r.n, 0);
      const flagged = SOURCES.includes(wrote) ? "  <- on the purge list" : "";
      console.log(`      from "${wrote}": ${n(total)} rows, ${n(list.length)} distinct${flagged}`);
      for (const r of list.slice(0, 5)) {
        const mark = r.n >= SUSPICIOUS_AT ? "  <<< SUSPICIOUS" : "";
        console.log(`          ${String(r.n).padStart(5)}  "${String(r.value).slice(0, 56)}"${mark}`);
      }
      if (list.length > 5) console.log(`          ... and ${n(list.length - 5)} more value(s)`);
    }
    console.log("");
  }

  if (suspicious.length > 0) {
    console.log(`  ${suspicious.length} value(s) shared by ${SUSPICIOUS_AT}+ contacts:\n`);
    for (const x of suspicious) {
      console.log(`      ${String(x.n).padStart(5)} contacts  ${x.field} = "${x.value}"  (labeled "${x.wrote}")`);
    }
    console.log("\n  A sync does not give that many people the same answer. If one of these");
    console.log("  is the fixture, clear it by value rather than by source:");
    const e = suspicious[0];
    console.log(`      --clear '${e.field}=${e.value}'\n`);
  }

  // ── STEP 2: the exact rows this would clear. ──────────────────────────────
  //
  // Two arms, matching the two cases in the header: named provenance, and the
  // value corroborator for rows that predate per-field provenance.
  const plan = new Map(); // field -> rows
  let total = 0;

  for (const t of CLEAR_TARGETS) {
    const { rows } = await query(
      `SELECT id, full_name, ${t.field} AS value,
              COALESCE(field_sources->>$1, source, '(none)') AS wrote
         FROM contacts
        WHERE deleted_at IS NULL AND ${t.field} = $2
        ORDER BY full_name`,
      [t.field, t.value],
    );
    console.log(`  --clear ${t.field}="${t.value}" matches ${n(rows.length)} contact(s)`);
    for (const r of rows.slice(0, 5)) {
      console.log(`         e.g. ${String(r.full_name ?? "Unnamed").padEnd(26)} written by "${r.wrote}"`);
    }
    if (rows.length > 5) console.log(`         ... and ${n(rows.length - 5)} more`);
    console.log("");
    const existing = plan.get(t.field) ?? [];
    const seen = new Set(existing.map((r) => r.id));
    plan.set(t.field, [...existing, ...rows.filter((r) => !seen.has(r.id))]);
    total += rows.filter((r) => !seen.has(r.id)).length;
  }

  for (const field of FIELDS) {
    const { rows } = await query(
      `SELECT id, full_name, ${field} AS value,
              COALESCE(field_sources->>$1, source, '(none)') AS wrote,
              (field_sources ? $1) AS has_field_provenance
         FROM contacts
        WHERE deleted_at IS NULL
          AND NULLIF(btrim(COALESCE(${field}, '')), '') IS NOT NULL
          AND (
                -- the field itself says who wrote it
                (field_sources ? $1 AND field_sources->>$1 = ANY($2::text[]))
                -- or it does not, and the row's own source plus a fixture
                -- value together are enough
             OR (NOT (field_sources ? $1) AND source = ANY($2::text[])
                 AND ${field} = ANY($3::text[]))
              )
        ORDER BY full_name`,
      [field, SOURCES, STUB_VALUES[field] ?? []],
    );
    const existing = plan.get(field) ?? [];
    const seen = new Set(existing.map((r) => r.id));
    const added = rows.filter((r) => !seen.has(r.id));
    plan.set(field, [...existing, ...added]);
    total += added.length;

    console.log(`  would clear ${field} on ${n(plan.get(field).length)} contact(s)`);
    const byValue = new Map();
    for (const r of plan.get(field)) byValue.set(r.value, (byValue.get(r.value) ?? 0) + 1);
    for (const [value, count] of [...byValue.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`      ${String(count).padStart(5)}  "${String(value).slice(0, 60)}"`);
    }
    for (const r of plan.get(field).slice(0, 5)) {
      console.log(`         e.g. ${String(r.full_name ?? "Unnamed").padEnd(26)} ${field}="${r.value}"  written by "${r.wrote}"`);
    }
    console.log("");
  }

  console.log(`  ${n(total)} field value(s) across ${FIELDS.length} column(s).`);
  console.log("  NOT touched: names, phones, emails, identity keys, circles, notes, observations.\n");

  if (!CONFIRM) {
    console.log("  REPORT ONLY. Re-run with --confirm to clear them.\n");
    return;
  }

  // ── STEP 3: clear, one column at a time, on exactly the ids listed above. ──
  //
  // By id rather than by re-running the predicate, so what is changed is what
  // was printed. A predicate evaluated twice can match different rows the
  // second time, and then the report was not a report.
  for (const field of FIELDS) {
    const ids = (plan.get(field) ?? []).map((r) => r.id);
    if (ids.length === 0) continue;
    const { rowCount } = await query(
      `UPDATE contacts
          SET ${field} = NULL,
              field_sources = COALESCE(field_sources, '{}'::jsonb) - $2,
              updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [ids, field],
    );
    console.log(`  cleared ${field} on ${n(rowCount)} contact(s)`);
  }

  console.log("\n  Re-roll the scores so completeness reflects the cleared fields:");
  console.log("    railway run node scripts/contact-rollup.js\n");
}

main()
  .catch((err) => {
    console.error(`\n  ${err?.message || err}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool?.().catch(() => {});
  });
