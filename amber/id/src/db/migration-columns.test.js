/**
 * A MIGRATION THAT NAMES A COLUMN THE TABLE DOES NOT HAVE.
 *
 * THE BUG THIS EXISTS TO CATCH, which cost a failed deploy: a partial index
 * on org_pages filtered `WHERE ... deleted_at IS NULL`, and org_pages retires
 * a page with `archived_at`. The attachments and posts declared a few lines
 * away in the same original migration DO use deleted_at, so the wrong name
 * was the familiar one — which is exactly how this mistake gets made and why
 * reading carefully is not a defense against it.
 *
 * Postgres caught it, correctly, at the only moment it could: halfway through
 * `railway run npm run migrate`, against the production database, with the
 * transaction rolling back and the deploy stopped. That is the right behavior
 * and the wrong time. The schema is sitting in these files; the answer is
 * knowable on a laptop in a tenth of a second.
 *
 * WHAT THIS CHECKS AND WHAT IT DELIBERATELY DOES NOT. It reads every
 * CREATE TABLE in the migration directory to learn each table's columns,
 * follows ALTER TABLE ... ADD COLUMN so a column added later counts, and then
 * verifies the one construct where a typo is both easy and fatal: the WHERE
 * clause of a partial index, which names bare columns of exactly one table.
 *
 * It does not try to validate arbitrary SQL. A general column checker would
 * need to resolve aliases, CTEs, joins and function bodies, and would spend
 * its life being wrong about correct files — and a test people learn to
 * ignore is worse than no test. Partial indexes are the narrow case where the
 * table is unambiguous, so the check can be exact and silent.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

/** Columns Postgres provides that no migration declares. */
const IMPLICIT = new Set(["ctid", "xmin", "oid", "tableoid"]);

function allSql() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(DIR, f), "utf8") }));
}

/**
 * Strip comments, so a column named only in prose never counts as declared.
 *
 * String literals go too, and that one matters more than it looks: a partial
 * index reading `WHERE status = 'pending'` has no column called `pending`,
 * and the first version of this test reported eighteen of those before it
 * found the one real bug. A check with that much noise is a check nobody
 * runs twice.
 */
/**
 * Comments only, leaving string literals intact.
 *
 * stripComments() below also blanks every quoted string, which is right for
 * the index check -- a column name inside a string is not a declaration --
 * and wrong for anything that looks FOR a string. It silently turned
 * set_config('amber.bootstrap', ...) into set_config('', ...), so the
 * definer check below searched for text the stripper had already removed and
 * reported four functions as broken that were not.
 */
function stripCommentsOnly(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * table -> Set(columns), built from every CREATE TABLE and ADD COLUMN.
 *
 * Deliberately generous: anything that looks like a column declaration counts.
 * A false POSITIVE here (thinking a column exists when it does not) makes the
 * test miss a bug; a false NEGATIVE makes it fail on correct code, which is
 * far more expensive in trust. Generosity errs toward the first.
 */
function schema() {
  const cols = new Map();
  const add = (table, col) => {
    const t = table.toLowerCase();
    if (!cols.has(t)) cols.set(t, new Set());
    cols.get(t).add(col.toLowerCase());
  };

  for (const { sql } of allSql()) {
    const clean = stripComments(sql);

    for (const m of clean.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?\s*\(([\s\S]*?)\n\s*\);/gi,
    )) {
      const [, table, body] = m;
      for (const line of body.split("\n")) {
        const t = line.trim();
        // A constraint line is not a column. Everything else that starts with
        // an identifier followed by another word is read as one, rather than
        // matching against a list of type names that a future migration will
        // eventually fall outside of.
        if (/^(primary|foreign|unique|constraint|check|exclude|like|,)\b/i.test(t)) continue;
        const d = t.match(/^["']?([a-z_][a-z0-9_]*)["']?\s+[a-z]/i);
        if (d) add(table, d[1]);
      }
    }

    /*
     * ONE ALTER STATEMENT CAN ADD SEVERAL COLUMNS, and the obvious regex
     * pairs the table with only the first of them. observations gains six
     * columns in one statement; matching just the first made the other five
     * invisible and reported a perfectly good index as broken.
     *
     * So: find the statement, then find every ADD COLUMN inside it.
     */
    for (const m of clean.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?["']?(\w+)["']?([^;]*);/gi,
    )) {
      const [, table, rest] = m;
      for (const c of rest.matchAll(
        /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([a-z_][a-z0-9_]*)["']?/gi,
      )) {
        add(table, c[1]);
      }
    }
  }
  return cols;
}

test("every partial index filters on a column its table actually has", () => {
  const cols = schema();
  assert.ok(cols.size > 30, `only parsed ${cols.size} tables — the parser has stopped parsing`);

  const bad = [];
  for (const { file, sql } of allSql()) {
    const clean = stripComments(sql);
    for (const m of clean.matchAll(
      /*
       * [^;]*? between the table and the WHERE, never [\s\S]*?.
       *
       * The greedy version walked past the end of its own statement and
       * paired an index on `places` with a WHERE belonging to some later
       * CREATE INDEX, then reported `places` as missing a column it was
       * never asked about. A statement terminator is the one boundary this
       * matcher must respect.
       */
      /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?["']?\w+["']?\s+ON\s+["']?(\w+)["']?[^;]*?\bWHERE\b([^;]*);/gi,
    )) {
      const [, table, where] = m;
      const known = cols.get(table.toLowerCase());
      // A table we never saw declared is out of scope rather than a failure:
      // it may predate this directory entirely.
      if (!known) continue;

      for (const ref of where.matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)) {
        const word = ref[1].toLowerCase();
        if (SQL_WORDS.has(word) || IMPLICIT.has(word)) continue;
        // Anything quoted or cast is a value, not a column.
        if (/^\d/.test(word)) continue;
        if (!known.has(word)) {
          bad.push(`${file}: index on ${table} filters on "${word}", which ${table} does not have`);
        }
      }
    }
  }

  assert.deepEqual(
    bad,
    [],
    "a migration would fail against the real database:\n  " + bad.join("\n  "),
  );
});

test("no ALTER COLUMN ... USING opens a subquery", () => {
  /*
   * THE BUG THIS EXISTS TO CATCH, which cost a second failed deploy on the
   * same day as the first.
   *
   * Converting events.attendees from text[] to jsonb wanted a transform that
   * built an object per element, and the only way to iterate an array in
   * Postgres is unnest, which is a subquery. A USING clause is evaluated per
   * row as a SCALAR expression and flatly refuses one:
   *
   *     cannot use subquery in transform expression
   *
   * It is rejected at execution, not at parse, so the file looks fine until
   * it is running against the production database inside a transaction that
   * is about to roll back. The shape is recognizable from the text, which is
   * the whole reason this test can exist: a USING with a SELECT inside it is
   * always wrong, and the fix is always the same -- add a column, populate
   * it, drop the old one, rename.
   */
  const bad = [];
  for (const { file, sql } of allSql()) {
    const clean = stripComments(sql);
    for (const m of clean.matchAll(/ALTER\s+COLUMN[\s\S]*?\bUSING\b([\s\S]*?);/gi)) {
      if (/\bSELECT\b/i.test(m[1])) {
        bad.push(`${file}: an ALTER COLUMN ... USING contains a SELECT`);
      }
    }
  }

  assert.deepEqual(
    bad,
    [],
    "Postgres refuses a subquery in a transform expression. Add a new column, " +
      "populate it, drop the old one and rename:\n  " + bad.join("\n  "),
  );
});

test("every definer function that reads a tenant table can survive FORCE", () => {
  /*
   * THE OUTAGE THIS EXISTS TO PREVENT, which happened.
   *
   * FORCE ROW LEVEL SECURITY applies policies to the table's OWNER. A
   * SECURITY DEFINER function runs as the FUNCTION's owner, and here those
   * are the same role. So the moment enforcement was finally switched on,
   * amber_membership_bootstrap became subject to the very policy it exists
   * to precede: it reads org_members to discover which tenant to set, no
   * tenant is set yet, and the policy correctly denied every row.
   *
   * THERE WAS NO ERROR. The function returned zero rows, so everybody who
   * signed in looked like they belonged to no workspace. A security control
   * doing exactly what it was told, producing an outage that reads like data
   * loss, with nothing in any log pointing back at the change.
   *
   * The repair is a second permissive policy admitting a transaction-local
   * flag that only these functions set. This test is what stops a fifth
   * bootstrap function being added in a year without it -- which would fail
   * the same way, silently, the next time somebody enforced isolation.
   */
  const TENANT_TABLES = ["org_members", "organizations", "org_invites", "org_api_keys"];

  // Last definition wins: these functions are replaced across migrations.
  const latest = new Map();
  for (const { file, sql } of allSql()) {
    // Strings kept: the thing being looked for IS a string literal.
    const clean = stripCommentsOnly(sql);
    for (const m of clean.matchAll(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(\w+)\s*\(([\s\S]*?)\$\$;/gi,
    )) {
      latest.set(m[1], { file, body: m[0] });
    }
  }

  const bad = [];
  for (const [name, { file, body }] of latest) {
    if (!/SECURITY\s+DEFINER/i.test(body)) continue;
    const touches = TENANT_TABLES.filter((t) =>
      new RegExp(`\\b(?:public\\.)?${t}\\b`).test(body),
    );
    if (touches.length === 0) continue;
    if (/amber\.bootstrap/.test(body)) continue;
    bad.push(`${file}: ${name}() reads ${touches.join(", ")} without raising amber.bootstrap`);
  }

  assert.deepEqual(
    bad,
    [],
    "these return zero rows the moment tenant isolation is enforced:\n  " + bad.join("\n  "),
  );
});

/** Keywords, operators and type names that appear in a WHERE and are not columns. */
const SQL_WORDS = new Set([
  "and", "or", "not", "is", "null", "true", "false", "in", "between", "like",
  "ilike", "exists", "any", "all", "coalesce", "now", "current_timestamp",
  "text", "uuid", "int", "integer", "bigint", "boolean", "timestamptz",
  "timestamp", "jsonb", "json", "numeric", "date", "interval", "array",
  "cast", "as", "on", "where", "case", "when", "then", "else", "end",
  "length", "btrim", "lower", "upper", "distinct", "from", "infinity",
]);

test("the bootstrap flag names one row rather than opening a table", () => {
  /*
   * WHAT 090 LEFT BEHIND, AND WHY IT WAS WORTH NARROWING.
   *
   * 090 made the pre-tenant reads survive FORCE by admitting a boolean flag:
   * while amber.bootstrap was 'on', org_members, organizations and
   * org_api_keys were ENTIRELY readable and org_invites entirely writable.
   * The migration argued, correctly, that anything able to run arbitrary SQL
   * as the application could raise that flag exactly as it could already set
   * amber.org_id -- so the flag moved nothing.
   *
   * That argument was true and smaller than it looked. Setting amber.org_id
   * gives you ONE company at a time and leaves you guessing at ids. Raising
   * a boolean flag hands over every company's membership and every customer
   * name in a single select. The blast radius differs by the size of the
   * customer list.
   *
   * 091 makes the flag carry the answer it is asking about: a person's uuid,
   * a token hash, a key hash -- the value the function was called with. The
   * policy then admits exactly the row that matches, so raising the flag
   * reads one row, and only if you already knew its primary identifier.
   *
   * THIS TEST IS WHAT STOPS IT WIDENING AGAIN. A future migration that
   * re-creates one of these policies with a bare boolean would restore the
   * old blast radius, pass every other test in this directory, and look
   * entirely reasonable in review -- because it IS the code that used to be
   * here.
   */
  const TABLES = ["org_members", "organizations", "org_invites", "org_api_keys"];

  // Replay the migrations in order; the last policy to be created wins,
  // exactly as it does in the database.
  const final = new Map();
  for (const { file, sql } of allSql()) {
    const clean = stripCommentsOnly(sql);

    /*
     * 090 creates three of these inside a DO ... FOREACH over an ARRAY of
     * table names, so the table is a loop variable rather than a literal.
     * Reading the array is how the replay stays faithful to what actually
     * ran; skipping the block would let that version look absent and the
     * test pass for the wrong reason.
     */
    for (const block of clean.matchAll(/DO\s+\$\$([\s\S]*?)\$\$\s*;/gi)) {
      const body = block[1];
      if (!/CREATE\s+POLICY\s+amber_bootstrap/i.test(body)) continue;
      const arr = body.match(/ARRAY\s*\[([^\]]*)\]/i);
      if (!arr) continue;
      for (const t of arr[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""))) {
        if (TABLES.includes(t)) final.set(t, { file, predicate: body });
      }
    }

    for (const m of clean.matchAll(
      /CREATE\s+POLICY\s+amber_bootstrap\s+ON\s+(\w+)([\s\S]*?);/gi,
    )) {
      if (TABLES.includes(m[1])) final.set(m[1], { file, predicate: m[2] });
    }
  }

  const bad = [];
  for (const t of TABLES) {
    const got = final.get(t);
    if (!got) {
      bad.push(`${t} has no amber_bootstrap policy — the bootstrap reads will return nothing under FORCE`);
      continue;
    }
    if (!/amber_bootstrap_subject\s*\(|amber_bootstrap_org\s*\(/.test(got.predicate)) {
      bad.push(
        `${got.file}: the amber_bootstrap policy on ${t} admits rows without comparing them ` +
          `to the subject — while the flag is up, the whole table is open`,
      );
    }
  }

  assert.deepEqual(
    bad,
    [],
    "a bootstrap policy must name the one row its function asked for:\n  " + bad.join("\n  "),
  );
});

test("the operator flag can only read, and only the estate tables", () => {
  /*
   * WHAT THIS GUARDS. 092 added a cross-tenant SELECT so that an admin
   * script could stop reporting its own blindness as a finding. The whole
   * reason that is acceptable is its narrowness: SELECT only, and only on
   * the two tables that answer "which workspaces exist and who is in one".
   *
   * A later migration adding org_people or org_interactions to that list
   * would turn a reporting flag into a way to read every customer's
   * relationships and the content of their meetings. It would look exactly
   * like the lines above it, which is why this is a test rather than a
   * comment.
   */
  const ALLOWED = new Set(["organizations", "org_members"]);

  const bad = [];
  for (const { file, sql } of allSql()) {
    const clean = stripCommentsOnly(sql);

    for (const block of clean.matchAll(/DO\s+\$\$([\s\S]*?)\$\$\s*;/gi)) {
      const body = block[1];
      if (!/CREATE\s+POLICY\s+amber_operator/i.test(body)) continue;

      if (!/FOR\s+SELECT/i.test(body)) {
        bad.push(`${file}: an amber_operator policy that is not FOR SELECT`);
      }
      const arr = body.match(/ARRAY\s*\[([^\]]*)\]/i);
      for (const t of (arr?.[1] ?? "").split(",").map((x) => x.trim().replace(/^'|'$/g, ""))) {
        if (t && !ALLOWED.has(t)) {
          bad.push(`${file}: amber_operator on ${t} — a reporting flag must not reach customer content`);
        }
      }
    }

    for (const m of clean.matchAll(/CREATE\s+POLICY\s+amber_operator\s+ON\s+(\w+)([\s\S]*?);/gi)) {
      if (!ALLOWED.has(m[1])) {
        bad.push(`${file}: amber_operator on ${m[1]} — a reporting flag must not reach customer content`);
      }
      if (!/FOR\s+SELECT/i.test(m[2])) {
        bad.push(`${file}: the amber_operator policy on ${m[1]} is not FOR SELECT`);
      }
    }
  }

  assert.deepEqual(
    bad,
    [],
    "this flag exists so a diagnostic can count workspaces, not so support can read mail:\n  " +
      bad.join("\n  "),
  );
});
