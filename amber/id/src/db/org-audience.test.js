/**
 * WHO CAN SEE WHAT, as structure rather than as hope.
 *
 * There is no database here. These check the two things that go wrong with a
 * permission model and go wrong silently: a read path that forgot to apply the
 * predicate, and a predicate that is wrong in a way no screenshot shows.
 *
 * The first is the one that matters. A listing with no audience clause does
 * not error, does not look odd, and returns every private file in the company
 * to whoever asked. Nobody notices until somebody does.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  ITEM_TYPES,
  filedUnderClause,
  normalizeAudience,
  visibleClause,
} from "./org-audience-store.js";

const storeSrc = readFileSync(new URL("./org-knowledge-store.js", import.meta.url), "utf8");
const audienceSrc = readFileSync(new URL("./org-audience-store.js", import.meta.url), "utf8");
const purgeSrc = readFileSync(new URL("./purge.js", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../db/migrations/20261016_074_audiences.sql", import.meta.url),
  "utf8",
);

/* -------------------------------------------------- the predicate's shape */

test("the predicate lets company-wide items through without a viewer", () => {
  const sql = visibleClause({ alias: "a", itemType: "file", viewer: "$3" });
  assert.match(sql, /a\.visibility = 'org'/);
});

test("THE PREDICATE FAILS CLOSED: no viewer sees nothing restricted", () => {
  const sql = visibleClause({ alias: "a", itemType: "file", viewer: "$3" });
  // Every branch past the company-wide one is behind a non-null viewer. If
  // this inverts, a store function that forgets to pass viewerId stops being
  // a bug that returns too little and becomes one that returns everything.
  assert.match(sql, /\$3::uuid IS NOT NULL/);
  assert.doesNotMatch(sql, /\$3::uuid IS NULL/);
});

test("each item type checks its own author column", () => {
  assert.match(visibleClause({ alias: "a", itemType: "file", viewer: "$2" }), /a\.uploaded_by/);
  assert.match(visibleClause({ alias: "p", itemType: "page", viewer: "$2" }), /p\.created_by/);
  assert.match(visibleClause({ alias: "p", itemType: "post", viewer: "$2" }), /p\.author_id/);
});

test("a group grant is resolved through live membership, not through the row", () => {
  const sql = visibleClause({ alias: "a", itemType: "file", viewer: "$2" });
  // The audience row names a group; it must not be readable by anybody until
  // org_group_members says they are in it. A row that granted on its own would
  // keep granting after somebody leaves the group.
  assert.match(sql, /FROM org_group_members gm/);
  assert.match(sql, /gm\.amber_id = \$2::uuid/);
});

test("THERE IS NO ADMIN OVERRIDE anywhere in the predicate", () => {
  for (const itemType of ITEM_TYPES) {
    const sql = visibleClause({ alias: "x", itemType, viewer: "$1" });
    assert.doesNotMatch(sql, /admin|owner_role|org_role/i,
      `${itemType}'s predicate mentions a role; a role that reads every private share is not a permission model`);
  }
});

test("item type is never interpolated from anything but the frozen set", () => {
  assert.throws(() => visibleClause({ alias: "a", itemType: "file'; DROP", viewer: "$1" }));
  assert.throws(() => filedUnderClause({ alias: "a", itemType: "nope", group: "$1" }));
});

test("filing and reading are separate clauses", () => {
  const filed = filedUnderClause({ alias: "a", itemType: "file", group: "$2" });
  assert.match(filed, /f\.kind = 'group'/);
  // Being filed under a group says nothing about who may read it, so this
  // clause must not contain a membership check -- the listing applies both.
  assert.doesNotMatch(filed, /org_group_members/);
});

/* ------------------------------------------------------- the normalization */

test("an absent audience means the whole company", () => {
  assert.deepEqual(normalizeAudience(undefined), { ok: true, everyone: true, groups: [], people: [] });
  assert.equal(normalizeAudience({}).everyone, true);
});

test("sharing with nobody is refused", () => {
  assert.deepEqual(normalizeAudience({ everyone: false }), { ok: false, reason: "empty_audience" });
  assert.deepEqual(
    normalizeAudience({ everyone: false, groups: [], people: ["", "  "] }),
    { ok: false, reason: "empty_audience" },
  );
});

test("an item can be company-wide AND filed under a group", () => {
  const a = normalizeAudience({ everyone: true, groups: ["g1"] });
  assert.equal(a.everyone, true);
  assert.deepEqual(a.groups, ["g1"]);
});

test("duplicates and blanks are dropped rather than written twice", () => {
  const a = normalizeAudience({ everyone: false, groups: ["g1", "g1", " ", null], people: ["p1"] });
  assert.deepEqual(a.groups, ["g1"]);
  assert.deepEqual(a.people, ["p1"]);
});

/* ------------------------------------------- every read path applies it */

/**
 * THE TEST THIS FILE EXISTS FOR.
 *
 * Every function in the knowledge store that returns rows of an item type has
 * to carry the predicate. Checking it by name rather than by behavior is
 * deliberate: the failure mode is a NEW listing added later by somebody who
 * did not know this existed, and only a structural test fails on the day that
 * function is written.
 */
test("EVERY LISTING OF A FILE, PAGE OR POST APPLIES THE AUDIENCE PREDICATE", () => {
  const READ_PATHS = [
    "listPages",
    "getPage",
    "searchPages",
    "listAttachments",
    "listFeed",
    "listAnswers",
    "listFiles",
    "getAttachment",
    "driveStats",
  ];
  const missing = [];
  for (const name of READ_PATHS) {
    const start = storeSrc.indexOf(`export async function ${name}(`);
    assert.notEqual(start, -1, `${name} is gone; this list is stale`);
    const next = storeSrc.indexOf("\nexport async function ", start + 1);
    const body = storeSrc.slice(start, next === -1 ? undefined : next);
    if (!body.includes("visibleClause(")) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    `these return items to a caller without checking the audience:\n  ${missing.join("\n  ")}`,
  );
});

test("every read path that applies the predicate also takes a viewer", () => {
  for (const name of ["listFiles", "listFeed", "listPages", "getPage", "getAttachment"]) {
    const start = storeSrc.indexOf(`export async function ${name}(`);
    const head = storeSrc.slice(start, storeSrc.indexOf("{\n", storeSrc.indexOf(") {", start)));
    assert.match(head, /viewerId/, `${name} applies the predicate with no way to pass a viewer`);
  }
});

/* ------------------------------------------------------- the schema itself */

test('"everybody" has exactly one spelling', () => {
  // kind is ('group','person'). An 'org' kind would be a second way to say
  // what the visibility column already says, and two spellings of one audience
  // is how a read path ends up agreeing with itself and disagreeing with the UI.
  assert.match(migration, /CHECK \(kind IN \('group', 'person'\)\)/);
});

test("the audience table is inside the tenant policy", () => {
  // It is the table that decides who sees what. A tenant table with no policy
  // on it is the one place cross-company reads would come from.
  assert.match(migration, /ALTER TABLE org_audiences ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE POLICY amber_tenant ON org_audiences/);
});

test("the backfill does not hide anything that was visible yesterday", () => {
  // Existing group_ids were filing, not permission: everybody could already
  // see those files. The backfill records the filing and must not set
  // visibility to 'restricted' on anything.
  assert.doesNotMatch(migration, /UPDATE[\s\S]{0,200}SET visibility = 'restricted'/);
});

test("deleting an account removes the shares addressed to it by name", () => {
  assert.match(purgeSrc, /DELETE FROM org_audiences WHERE kind = 'person' AND ref = \$1/);
  // And must NOT take group rows with it: those name a group, not a person.
  assert.doesNotMatch(purgeSrc, /DELETE FROM org_audiences WHERE kind = 'group'/);
});

test("the audience writer is a transaction", () => {
  const start = audienceSrc.indexOf("export async function setAudience(");
  const body = audienceSrc.slice(start, audienceSrc.indexOf("\n/* ---", start));
  assert.match(body, /withTransaction\(/);
  // The column and the rows are one fact. A window between them is a window in
  // which the item is readable by people it was just taken from.
  assert.ok(
    body.indexOf("UPDATE") < body.indexOf("DELETE FROM org_audiences"),
    "the visibility flip must be inside the same transaction as the rows",
  );
});

/**
 * EVERY ORG TABLE HAS A PRIMARY KEY, AND THIS IS NOT A STYLE RULE.
 *
 * This database is in a publication that replicates deletes. Postgres refuses
 * a DELETE or UPDATE on a published table that has no replica identity, and a
 * bare UNIQUE INDEX does not count:
 *
 *   55000 cannot delete from table "x" because it does not have a replica
 *         identity and publishes deletes
 *
 * org_audiences shipped that way for exactly one deploy. Nothing failed at
 * boot, nothing failed on insert, and every attempt to change who could see a
 * file died on the DELETE inside setAudience -- surfacing as "Something went
 * wrong on our end" on a Save button. A test is the only thing that catches
 * this before a person does.
 */
test("EVERY org_* TABLE HAS A PRIMARY KEY (published deletes need one)", () => {
  const dir = new URL("../../db/migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const sql = files.map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");

  const missing = [];
  for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?["']?(org_\w+)["']?\s*\(([\s\S]*?)\n\);/g)) {
    const [, table, body] = m;
    const declaredInline = /PRIMARY KEY/.test(body);
    // Or added later by its own ALTER, which is how org_audiences got one.
    const addedLater = new RegExp(
      `ALTER TABLE ${table}[\\s\\S]{0,200}?ADD CONSTRAINT \\w+ PRIMARY KEY`,
    ).test(sql);
    if (!declaredInline && !addedLater) missing.push(table);
  }

  assert.deepEqual(
    missing,
    [],
    `these tables publish deletes with no replica identity, so every DELETE on them fails at runtime:\n  ${missing.join("\n  ")}`,
  );
});
