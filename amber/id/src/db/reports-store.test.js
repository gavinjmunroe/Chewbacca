/**
 * REPORTING — the parts that would quietly ruin a review.
 *
 * A report is read once, by a person deciding whether to remove somebody from
 * the product. Almost every way this can be wrong is a way the row still looks
 * fine: the evidence is the reporter's own messages, or there is no evidence
 * because the thread was cleared, or the same complaint is in the queue four
 * times and reads as a pattern. None of those throw.
 *
 * Run with:  node --test src/db/reports-store.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  EVIDENCE_BODY_MAX,
  REPORT_REASONS,
  evidenceFrom,
  fileReport,
  listOpenReports,
} from "./reports-store.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const answering = (rows) => {
  const asked = [];
  return {
    asked,
    query: async (text, values) => {
      asked.push({ text, values });
      return { rows };
    },
  };
};
const throwing = () => ({
  query: async () => {
    throw new Error("ECONNREFUSED");
  },
});

const msg = (over = {}) => ({
  id: 7,
  kind: "text",
  body: "hello",
  createdAt: "2026-09-13T00:00:00Z",
  mine: false,
  ...over,
});

// ── evidence ────────────────────────────────────────────────────────────────

test("EVIDENCE IS ONLY THE REPORTED PERSON'S HALF", async () => {
  /**
   * The whole thread is the obvious thing to attach and it is the wrong thing.
   * A reviewer reading the reporter's own messages as the accused's is how a
   * founded report gets dismissed, and it also means filing a report hands over
   * your own words to be read.
   */
  const out = evidenceFrom([
    msg({ id: 3, body: "theirs", mine: false }),
    msg({ id: 2, body: "mine", mine: true }),
    msg({ id: 1, body: "theirs too", mine: false }),
  ]);
  assert.deepEqual(
    out.map((m) => m.body),
    ["theirs too", "theirs"],
  );
});

test("A MESSAGE OF UNKNOWN AUTHORSHIP IS NOT EVIDENCE", async () => {
  /**
   * `!m.mine` and `m.mine === false` differ on exactly one input: a message
   * with no `mine` field. That happens whenever the shape changes upstream, and
   * the looser check quietly starts attributing the reporter's own words to the
   * person they are reporting.
   */
  assert.deepEqual(evidenceFrom([{ id: 1, body: "who said this" }]), []);
  assert.deepEqual(evidenceFrom([msg({ mine: undefined })]), []);
  assert.deepEqual(evidenceFrom([msg({ mine: null })]), []);
});

test("evidence reads forwards, because a conversation does", async () => {
  // dm-store returns newest first. A reviewer reading a harassment thread
  // backwards is reading a different conversation.
  const out = evidenceFrom([msg({ id: 3, body: "third" }), msg({ id: 1, body: "first" })]);
  assert.deepEqual(
    out.map((m) => m.body),
    ["first", "third"],
  );
});

test("the cap applies to the NEWEST messages, not the oldest", async () => {
  // Slicing after the reverse would keep the beginning of the thread and drop
  // the part being reported, which is always the recent part.
  const many = Array.from({ length: 30 }, (_, i) => msg({ id: 30 - i, body: `m${30 - i}` }));
  const out = evidenceFrom(many, { max: 3 });
  assert.deepEqual(
    out.map((m) => m.body),
    ["m28", "m29", "m30"],
  );
});

test("one enormous message cannot become the whole row", async () => {
  const [only] = evidenceFrom([msg({ body: "x".repeat(50_000) })]);
  assert.equal(only.body.length, EVIDENCE_BODY_MAX);
});

test("junk in does not throw, because this runs on the report path", async () => {
  assert.deepEqual(evidenceFrom(null), []);
  assert.deepEqual(evidenceFrom(undefined), []);
  assert.deepEqual(evidenceFrom([null, undefined, msg()]).length, 1);
  const [voice] = evidenceFrom([msg({ kind: undefined, body: undefined, id: undefined })]);
  assert.deepEqual(voice, { id: null, kind: "text", body: "", createdAt: "2026-09-13T00:00:00Z" });
});

// ── filing ──────────────────────────────────────────────────────────────────

test("a filed report is a warning in the log, not only a row", async () => {
  /**
   * There is no reviewer console. A report that lands only in a table nobody
   * queries is the same as no report, and "we review every report" in the terms
   * becomes untrue the day it ships.
   */
  const seen = [];
  const warn = console.warn;
  console.warn = (m) => seen.push(String(m));
  try {
    await fileReport({ reporterId: A, reportedId: B, reason: "harassment" }, answering([{ id: 5 }]));
  } finally {
    console.warn = warn;
  }
  assert.equal(seen.length, 1);
  assert.match(seen[0], /ABUSE_REPORT_FILED/);
  assert.match(seen[0], /harassment/);
});

test("THE DUPLICATE STILL RETURNS A ROW", async () => {
  /**
   * ON CONFLICT DO NOTHING returns no rows at all on a conflict, so the second
   * tap of Report would read as a failed insert and the user would be told it
   * did not work. DO UPDATE keeps the RETURNING.
   */
  const deps = answering([{ id: 9 }]);
  const res = await fileReport({ reporterId: A, reportedId: B, reason: "spam" }, deps);
  assert.deepEqual(res, { ok: true, id: "9" });
  assert.match(deps.asked[0].text, /ON CONFLICT/);
  assert.match(deps.asked[0].text, /DO UPDATE/);
  assert.ok(!/DO NOTHING/.test(deps.asked[0].text), "a duplicate would return no row");
  assert.match(deps.asked[0].text, /WHERE status = 'open'/, "the partial index is not targeted");
});

test("an insert that returns nothing is a failure, not a success", async () => {
  assert.deepEqual(await fileReport({ reporterId: A, reportedId: B, reason: "spam" }, answering([])), {
    ok: false,
    error: "report_failed",
  });
  assert.deepEqual(await fileReport({ reporterId: A, reportedId: B, reason: "spam" }, throwing()), {
    ok: false,
    error: "report_failed",
  });
});

test("you cannot report yourself, or a party that is not a party", async () => {
  const deps = answering([{ id: 1 }]);
  assert.equal((await fileReport({ reporterId: A, reportedId: A, reason: "spam" }, deps)).error, "bad_party");
  assert.equal((await fileReport({ reporterId: A, reportedId: "x", reason: "spam" }, deps)).error, "bad_party");
  assert.equal((await fileReport({ reporterId: null, reportedId: B, reason: "spam" }, deps)).error, "bad_party");
  assert.deepEqual(deps.asked, [], "spent an insert on a report with no subject");
});

test("A REASON THE DATABASE WOULD REFUSE IS REFUSED HERE", async () => {
  // The CHECK in migration 054 holds the same list. A caller inventing a reason
  // passes every test written against a fake query and fails in production.
  const deps = answering([{ id: 1 }]);
  assert.equal((await fileReport({ reporterId: A, reportedId: B, reason: "vibes" }, deps)).error, "bad_reason");
  assert.equal((await fileReport({ reporterId: A, reportedId: B, reason: "" }, deps)).error, "bad_reason");
  assert.deepEqual(deps.asked, []);
  for (const reason of REPORT_REASONS) {
    assert.equal((await fileReport({ reporterId: A, reportedId: B, reason }, answering([{ id: 1 }]))).ok, true, reason);
  }
});

test("the detail is trimmed and an empty one is null, not an empty string", async () => {
  // A row whose detail is "" reads in a queue as "they typed nothing and sent
  // it", which is different from "they did not type anything".
  const deps = answering([{ id: 1 }]);
  await fileReport({ reporterId: A, reportedId: B, reason: "spam", detail: "   " }, deps);
  assert.equal(deps.asked[0].values[4], null);
  await fileReport({ reporterId: A, reportedId: B, reason: "spam", detail: "  hi  " }, deps);
  assert.equal(deps.asked[1].values[4], "hi");
  await fileReport({ reporterId: A, reportedId: B, reason: "spam", detail: "z".repeat(9000) }, deps);
  assert.equal(deps.asked[2].values[4].length, 1000);
});

test("evidence goes across as json, and an absent one is an empty array", async () => {
  const deps = answering([{ id: 1 }]);
  await fileReport({ reporterId: A, reportedId: B, reason: "spam" }, deps);
  assert.equal(deps.asked[0].values[5], "[]");
  await fileReport(
    { reporterId: A, reportedId: B, reason: "spam", evidence: [{ id: "1", body: "x" }] },
    deps,
  );
  assert.deepEqual(JSON.parse(deps.asked[1].values[5]), [{ id: "1", body: "x" }]);
});

test("the open queue is oldest first, and an outage is an empty queue rather than a crash", async () => {
  const deps = answering([{ id: 1 }]);
  await listOpenReports({}, deps);
  assert.match(deps.asked[0].text, /status = 'open'/);
  assert.match(deps.asked[0].text, /ORDER BY created_at ASC/);
  assert.deepEqual(await listOpenReports({}, throwing()), []);
});
