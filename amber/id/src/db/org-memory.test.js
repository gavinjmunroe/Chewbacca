/**
 * IDENTITY MATCHING IS THE WHOLE BALLGAME.
 *
 * The relationship ledger is useful exactly as long as two producers
 * discovering the same human attach to the same person. A calendar invite
 * knows an email, Salesforce knows a record id, a transcript knows a name and
 * maybe a phone -- and if those land as three people, the graph is noise by
 * the end of the first week and no amount of UI rescues it.
 *
 * So the normalizer is the thing worth testing without a database. It is
 * pure, it runs on every write, and a regression in it is invisible until a
 * customer has thousands of duplicate contacts and no way back.
 *
 * The structural tests below are the other half: they assert properties of
 * the STORE rather than of a query result, because the invariants that make
 * this safe -- append-only, consent that actually deletes, and content that
 * stays private while aggregates roll up -- are enforced by what the code
 * does and does not contain.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { employerDomain, normalizeIdentity, __test } from "./org-memory-store.js";

const { storable } = __test;

const SRC = readFileSync(fileURLToPath(new URL("./org-memory-store.js", import.meta.url)), "utf8");

test("the same phone in four shapes is one identity", () => {
  /*
   * The exact bug this caught when it was written: the first version kept a
   * leading plus and stripped the rest to digits, so a bare ten-digit number
   * and an E.164 one were different identities. Two producers, two contacts,
   * same human.
   */
  const shapes = ["+1 (555) 010-9999", "5550109999", "15550109999", "+15550109999", "555-010-9999"];
  const seen = new Set(shapes.map((s) => normalizeIdentity("phone", s)?.value));
  assert.equal(
    seen.size,
    1,
    `these should all be one phone, got ${[...seen].join(", ")}`,
  );
});

test("emails match case-insensitively and reject what is not an email", () => {
  assert.equal(normalizeIdentity("email", "  Karthik@Example.COM ").value, "karthik@example.com");
  // A name is not an email. Letting this through would create an identity
  // that nothing can ever match, which is worse than no identity at all.
  assert.equal(normalizeIdentity("email", "Karthik Devarakonda"), null);
});

test("an unknown identity kind is refused rather than stored", () => {
  // The column has a CHECK on it, so a bad kind would throw at the database
  // on insert -- mid-sync, after other rows have been written. Failing here
  // keeps a producer's typo from becoming a half-written batch.
  assert.equal(normalizeIdentity("facebook", "someone"), null);
  assert.equal(normalizeIdentity("", "someone"), null);
});

test("blank and missing values never become identities", () => {
  for (const v of [null, undefined, "", "   "]) {
    assert.equal(normalizeIdentity("email", v), null, `"${v}" should not be an identity`);
  }
});

/* ------------------------------------------------- accounts and privacy */

test("a work address names a firm and a personal one does not", () => {
  /*
   * THIS DECIDES TWO THINGS AT ONCE and both of them matter.
   *
   * An account called gmail.com with four hundred unrelated people under it
   * is worse than no account, so a personal domain must not produce one. And
   * the same signal sets the privacy default: somebody reached at a personal
   * address is far more likely to be a rep's dentist than a prospect, and a
   * company directory that lists a rep's dentist is how a rep learns not to
   * connect their calendar.
   */
  assert.equal(
    employerDomain([{ kind: "email", value: "partner@henderson-cpa.com" }]),
    "henderson-cpa.com",
  );
  assert.equal(employerDomain([{ kind: "email", value: "someone@gmail.com" }]), null);
  assert.equal(employerDomain([{ kind: "email", value: "someone@icloud.com" }]), null);

  // A phone tells us nothing about an employer, and guessing from an area
  // code would be worse than admitting that.
  assert.equal(employerDomain([{ kind: "phone", value: "+15550109999" }]), null);
  assert.equal(employerDomain([]), null);
});

test("the first work address wins when a person has both", () => {
  const found = employerDomain([
    { kind: "email", value: "dana@gmail.com" },
    { kind: "email", value: "dana@henderson-cpa.com" },
  ]);
  assert.equal(found, "henderson-cpa.com", "a personal address should not shadow the employer");
});

/* ------------------------------------------------------- the invariants */

/** Function bodies, keyed by name, for structural assertions. */
function functions() {
  const out = new Map();
  const re = /(?:export\s+)?async\s+function\s+(\w+)/g;
  const starts = [...SRC.matchAll(re)].map((m) => ({ name: m[1], at: m.index }));
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : SRC.length;
    out.set(s.name, SRC.slice(s.at, end));
  });
  return out;
}

test("the ledger is append-only: the store never updates org_interactions", () => {
  /*
   * THE INVARIANT THE AUDIT TRAIL RESTS ON.
   *
   * The moment an interaction can be edited, the history stops being
   * evidence. There is no API for it today, and this test is what keeps
   * somebody from adding one in six months because it seemed convenient --
   * at which point every compliance claim in the product quietly stops being
   * true, with nothing failing.
   *
   * A correction is a new row. Deleting is allowed, and is how revoked
   * consent takes its data back.
   */
  assert.ok(
    !/UPDATE\s+org_interactions/i.test(SRC),
    "something in the memory store updates org_interactions — a correction must be a new row",
  );
});

test("revoking a source deletes what came in under it", () => {
  /*
   * A consent record that stops future writes and leaves everything already
   * collected is not consent, it is a toggle. revokeSource has to delete the
   * interactions keyed to that grant, not merely stamp revoked_at.
   */
  const body = functions().get("revokeSource") ?? "";
  assert.ok(
    /DELETE FROM org_interactions[\s\S]*connection_id/i.test(body),
    "revokeSource marks the grant revoked without deleting the data it collected",
  );
  assert.ok(
    /refreshEdge/.test(body),
    "revokeSource deletes interactions without recomputing the edges derived from them",
  );
});

test("edges are only ever derived, never written from an argument", () => {
  /*
   * org_person_edges is a fold over the ledger and has to stay one: the
   * moment it has authored rows in it, it can no longer be rebuilt, and the
   * rebuild is what lets the scoring rules change without a migration.
   */
  const writes = [...SRC.matchAll(/INSERT INTO org_person_edges/gi)];
  assert.equal(writes.length, 1, "org_person_edges is written in more than one place");

  const body = functions().get("refreshEdge") ?? "";
  assert.ok(
    /FROM org_interactions/i.test(body),
    "refreshEdge writes an edge without reading the interactions it is supposed to be derived from",
  );
});

/**
 * Reads of the ledger that deliberately do not filter by viewer, and why.
 *
 * Each of these is a decision, written down here so that adding a third one
 * is something somebody has to do on purpose and explain, rather than an
 * omission that looks exactly like the other two.
 */
const UNFILTERED = new Map([
  [
    "refreshEdge",
    "Derives one member's edge from that member's OWN interactions, which " +
      "they can all see by definition. The edge carries counts and dates, " +
      "never content, which is what makes it safe to publish company-wide.",
  ],
  [
    "suggestMerges",
    "Counts touches per candidate so a person can tell two nodes apart " +
      "before joining them. Counts and dates, never content -- the same " +
      "shape org_person_edges already publishes company-wide, and a " +
      "de-duplication aid that could not see how busy a node is would be " +
      "asking somebody to merge blind.",
  ],
  [
    "unmergePerson",
    "Finds which members held an edge so both sides can be recomputed. " +
      "Mechanical: member ids in, edge rebuilds out, nothing returned to a " +
      "caller. Filtering by viewer would silently leave a colleague's edge " +
      "stale after an unmerge.",
  ],
  [
    "revokeSource",
    "Deletes by connection_id on a grant already proven to belong to the " +
      "caller. Filtering by visibility here would leave a revoking member's " +
      "own data behind, which is the opposite of what revoke means.",
  ],
]);

test("every read of the ledger is filtered to what the viewer may see", () => {
  /*
   * THE PRIVACY INVARIANT, AND WHY IT IS A TEST RATHER THAN A POLICY.
   *
   * Row-level security is the right tool for tenant isolation: one rule, no
   * exceptions, catches the query nobody remembered to filter. This rule is a
   * different shape. The aggregate rolls up company-wide while the content
   * stays private, which means it has exceptions BY DESIGN, and a policy with
   * designed exceptions is one that every aggregate query has to work around.
   * Working around a policy means SECURITY DEFINER helpers, and a pile of
   * those is how a boundary is actually lost: not through a missing policy,
   * but through the five functions written to get past one.
   *
   * So the rule lives in one predicate in the store, and this test is what
   * stops the next query from quietly skipping it. If this fails, a screen
   * somewhere is about to show one person's private conversations to their
   * whole company.
   */
  const bad = [];
  for (const [name, body] of functions()) {
    if (!/FROM org_interactions/i.test(body)) continue;
    if (UNFILTERED.has(name)) continue;
    if (!/visibleInteractions\(/.test(body)) bad.push(name);
  }

  assert.deepEqual(
    bad,
    [],
    "these read org_interactions without the visibility predicate: " + bad.join(", "),
  );
});

test("the visibility predicate admits your own rows and company-wide ones, and nothing else", () => {
  /*
   * Pinned deliberately. The predicate is short and every token in it is
   * load-bearing: swap the OR for an AND and a member sees only their own
   * company-wide rows; drop the member_id arm and they cannot see their own
   * work; drop the other and everything is private forever. None of those
   * three throws, and all of them are a different product.
   */
  const fn = SRC.slice(SRC.indexOf("function visibleInteractions"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(/visibility = 'org'/.test(body), "the company-wide arm is missing");
  assert.ok(/member_id = /.test(body), "the own-rows arm is missing");
  assert.ok(/org_interaction_shares/.test(body), "the deliberately-shared arm is missing");

  /*
   * The three arms are alternatives. An AND between any two of them silently
   * narrows the predicate to almost nothing, which does not throw and is not
   * visible on any screen until somebody notices their own history is gone.
   * Counted on the TOP level only, since the share lookup has an AND inside
   * its own subquery and always will.
   */
  const topLevel = body.replace(/EXISTS \([\s\S]*?\n    \)/g, "SHARED");
  assert.equal(
    (topLevel.match(/ OR /g) ?? []).length, 2,
    "the three arms must be joined by OR",
  );
  assert.ok(!/ AND /.test(topLevel), "an AND between the arms narrows this to nothing");
});

/* ------------------------------------------------- finding the duplicates */

test("one address being a prefix of another is the signal, and it is narrow", async () => {
  /*
   * WHAT THE DATA ACTUALLY OFFERS. The first version of this keyed on the
   * provider's display name. On a real calendar, 5 of 515 guest entries
   * carried one: Google documents displayName as optional and fills it only
   * when it already knows the person. A name-keyed matcher would have been
   * correct, tested, and silent forever.
   *
   * The address is what is left, and a prefix relationship is the part of it
   * that means something.
   */
  const { sharePrefix } = await import("./org-memory-store.js");

  // The real case, three addresses for one person, digits stripped.
  assert.ok(sharePrefix("sagar", "sagartiw"));
  assert.ok(sharePrefix("sagar", "sagart851"));
  assert.ok(sharePrefix("shirleyp", "shirley"));

  // Two people. An edit-distance matcher pairs these, which is why this is a
  // prefix test and not a similarity score.
  assert.ok(!sharePrefix("ryan", "bryan"));
  assert.ok(!sharePrefix("ryan", "jonah"));
  assert.ok(!sharePrefix("harris", "jonah"));

  // Short prefixes match half an address book.
  assert.ok(!sharePrefix("jo", "jonah"));
  assert.ok(!sharePrefix("", "jonah"));
  assert.ok(!sharePrefix(null, undefined));
});

test("three addresses for one person become one suggestion, not three prompts", async () => {
  /*
   * Pairs come back as (a,b). Showing them raw would ask somebody to fix the
   * same person three times and get it half-right twice.
   */
  const { clusters } = await import("./org-memory-store.js");

  const groups = clusters([
    ["sagar-work", "sagar-stanford"],
    ["sagar-work", "sagar-gmail"],
    ["shirley-usc", "shirley-work"],
  ]);

  assert.equal(groups.length, 2);
  const sagar = groups.find((g) => g.length === 3);
  assert.ok(sagar, "the three Sagar nodes should be one group");
  assert.deepEqual([...sagar].sort(), ["sagar-gmail", "sagar-stanford", "sagar-work"]);

  // A person with no twin is not a group.
  assert.deepEqual(clusters([]), []);
});

test("every list the code validates against matches the constraint in the database", () => {
  /*
   * THE BUG THIS CAUGHT, which had already shipped.
   *
   * Migration 085 added 'ai' to org_interactions_kind_shape so that an
   * imported Copilot or ChatGPT conversation could be filed as what it is.
   * It did not add 'ai' to the KINDS set in the store, and record() coerces
   * an unknown kind to 'other' rather than refusing it.
   *
   * So the import worked. The rows arrived, attached to the right people,
   * with the right text and the right timestamps -- and every one of them
   * said 'other'. The one field that tells the interface where something
   * came from, silently blank, on the exact feature whose whole point is
   * that you can see Copilot's work beside the meetings.
   *
   * NOTHING COULD HAVE FOUND THIS AT RUNTIME. There is no error, no missing
   * row, and the count is right. Only comparing the two lists finds it.
   *
   * THREE LISTS RATHER THAN THE ONE THAT BROKE, because the mechanism is
   * general: any value the store validates in JavaScript is a copy of a
   * CHECK constraint, and a copy drifts. Identity kinds and account kinds
   * are in step today and were one migration away from the same silence.
   *
   * Each reads the LAST constraint declared, because these are dropped and
   * re-added across migrations and the last one is what the database holds.
   */
  const PAIRS = [
    ["KINDS", "org_interactions_kind_shape", "kind"],
    ["IDENTITY_KINDS", "org_person_identities_kind_shape", "kind"],
    ["ACCOUNT_KINDS", "org_accounts_kind_check", "kind"],
  ];

  const dir = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));

  const problems = [];
  for (const [setName, constraint, column] of PAIRS) {
    let declared = null;
    for (const sql of files) {
      /*
       * The constraint is sometimes named and sometimes inline on the column
       * in a CREATE TABLE, so this looks for the name when it is there and
       * falls back to the column's own CHECK inside the table that carries
       * the constraint's name.
       */
      const named = [
        ...sql.matchAll(
          new RegExp(
            `CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`,
            "gi",
          ),
        ),
      ];
      for (const m of named) {
        declared = m[1]
          .split(",")
          .map((x) => x.trim().replace(/^'|'$/g, ""))
          .filter(Boolean);
      }
    }

    if (!declared) {
      problems.push(`${constraint} was not found in any migration — this test is not checking ${setName}`);
      continue;
    }

    /*
     * Read the set out of the source rather than exporting it. A set
     * exported only for a test is a set somebody will import and widen.
     */
    const m = SRC.match(new RegExp(`const ${setName} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
    if (!m) {
      problems.push(`${setName} is no longer declared the way this test reads it`);
      continue;
    }
    const inCode = m[1]
      .split(",")
      .map((x) => x.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);

    for (const k of declared) {
      if (!inCode.includes(k)) {
        problems.push(
          `the database accepts '${k}' and ${setName} does not — the store will quietly file it as something else`,
        );
      }
    }
    for (const k of inCode) {
      if (!declared.includes(k)) {
        problems.push(`${setName} sends '${k}' and ${constraint} will refuse the insert`);
      }
    }
  }

  assert.deepEqual(problems, [], problems.join("\n  "));
});

test("a null byte does not take the rest of the batch down with it", () => {
  /*
   * WHAT THIS COSTS WHEN IT IS WRONG, which is more than one bad row.
   *
   * Postgres text cannot hold U+0000. The driver raises "invalid byte
   * sequence for encoding UTF8: 0x00" and -- this is the expensive part --
   * inside a transaction every statement after it on that connection fails
   * with "current transaction is aborted" until a rollback. So one malformed
   * character in one meeting title does not lose that meeting. It loses
   * every meeting queued behind it, and the error names an encoding rather
   * than a row, so the thing to go and look at is not in the message.
   *
   * These arrive constantly: broken encoders in email bodies, audio tooling
   * in transcripts, a calendar description pasted out of a PDF. Ordinary
   * input that happens to be unstorable, which is the worst combination --
   * too common to be an edge case, too invisible to notice before it eats a
   * sync.
   */
  assert.equal(storable("line one\u0000tail"), "line onetail");
  assert.equal(storable("\u0000\u0000"), null, "a string that is only null bytes has no content left");
  assert.equal(storable("  spaced  "), "spaced");
  assert.equal(storable(null), null);
  assert.equal(storable(""), null);

  /*
   * TRUNCATION IS NOT COSMETIC EITHER. A provider that sends a 40,000
   * character description is not rare, and an unbounded summary is both a
   * row nobody can read and a timeline nobody can scroll.
   */
  assert.equal(storable("x".repeat(50000)).length, 10000);
  assert.equal(storable("x".repeat(500), 200).length, 200);

  // A real name survives unchanged, which is the case that actually matters.
  assert.equal(storable("Sagar Tiwari"), "Sagar Tiwari");
});
