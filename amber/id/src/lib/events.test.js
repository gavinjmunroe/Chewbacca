/**
 * Tests for the event-card helpers used by /v1/me/events*.
 *
 * Pure-function unit tests — no Firestore, no Fastify, just the lib.
 * Run with:  node --test src/lib/events.test.js
 *
 * The two highest-stakes behaviors here are:
 *   1. event_id round-tripping (parseEventId must always agree with build),
 *      because the API uses the parsed DID as the cross-tenant boundary.
 *   2. classifySubstanceRisk — the non-negotiable guardrail from the
 *      build brief. Procurement/dosing language must always block;
 *      harm-reduction language must always be allowed but tagged.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEventId,
  parseEventId,
  slugifyTitle,
  assertPrivateVisibility,
  classifySubstanceRisk,
  deriveEventItemKey,
  normalizeCardPatch,
  normalizeTaskPatch,
  validateEventItem,
  validateEventTask,
  buildTaskId,
  parseTaskId,
  textForEvent,
  textForTask,
  EVENT_ITEM_KINDS,
  EVENT_STATUSES,
  EVENT_TASK_STATUSES,
} from "./events.js";

test("slugifyTitle lowercases and kebab-cases", () => {
  assert.equal(slugifyTitle("EDC 2026"), "edc-2026");
  assert.equal(slugifyTitle("  Hello,  World! "), "hello-world");
  assert.equal(slugifyTitle(""), "");
  assert.equal(slugifyTitle(null), "");
});

test("buildEventId composes a stable id and parseEventId reverses it", () => {
  const id = buildEventId({
    ownerDid: "did:privy:sagar",
    title: "EDC 2026",
    year: 2026,
  });
  assert.equal(id, "event:did:privy:sagar:edc-2026:2026");
  assert.deepEqual(parseEventId(id), {
    ownerDid: "did:privy:sagar",
    slug: "edc-2026",
    year: 2026,
  });
});

test("buildEventId defaults year to the current UTC year", () => {
  const id = buildEventId({ ownerDid: "did:privy:sagar", title: "Coachella" });
  const parts = parseEventId(id);
  assert.equal(parts.year, new Date().getUTCFullYear());
});

test("buildEventId throws without ownerDid or slug-able title", () => {
  assert.throws(() => buildEventId({ title: "Hi" }));
  assert.throws(() => buildEventId({ ownerDid: "did:privy:x", title: "" }));
});

test("parseEventId returns null for malformed input", () => {
  assert.equal(parseEventId(""), null);
  assert.equal(parseEventId("not-an-event"), null);
  assert.equal(parseEventId("event:did:privy:x:slug"), null); // no year
  assert.equal(parseEventId("event::slug:2026"), null); // empty did
  assert.equal(parseEventId("event:did:privy:x::2026"), null); // empty slug
  assert.equal(parseEventId("event:did:privy:x:slug:99999"), null); // bad year
});

test("assertPrivateVisibility allows undefined/null and 'private', rejects others", () => {
  assert.equal(assertPrivateVisibility(undefined), "private");
  assert.equal(assertPrivateVisibility(null), "private");
  assert.equal(assertPrivateVisibility("private"), "private");
  assert.throws(() => assertPrivateVisibility("public"), /visibility/);
  assert.throws(() => assertPrivateVisibility("group"), /visibility/);
});

test("classifySubstanceRisk blocks explicit procurement combos", () => {
  for (const text of [
    "can someone buy molly before the set",
    "I need to pick up coke at the hotel",
    "the dealer dropped off ketamine",
    "redose the mdma at 11",
    "score acid for tonight",
  ]) {
    const r = classifySubstanceRisk(text);
    assert.equal(r.decision, "block", `should block: ${text}`);
    assert.equal(r.code, "substance_procurement_blocked");
  }
});

test("classifySubstanceRisk routes harm-reduction to safety_context", () => {
  for (const text of [
    "remember to hydrate and check on each other",
    "we need a ride home plan from Vegas",
    "buddy check at 2am",
    "tell the BnB host and do not answer the door",
    "use a fentanyl test strip first",
  ]) {
    const r = classifySubstanceRisk(text);
    assert.equal(r.decision, "safety_context", `should tag safety: ${text}`);
  }
});

test("classifySubstanceRisk allows non-substance event chatter", () => {
  for (const text of [
    "meet at north brown lot at 9pm",
    "I'll Venmo you for the ticket",
    "Excision then Gryffin at mainstage",
  ]) {
    const r = classifySubstanceRisk(text);
    assert.equal(r.decision, "allow", `should allow: ${text}`);
  }
});

test("classifySubstanceRisk safely handles empty / non-string input", () => {
  assert.equal(classifySubstanceRisk("").decision, "allow");
  assert.equal(classifySubstanceRisk(null).decision, "allow");
  assert.equal(classifySubstanceRisk(undefined).decision, "allow");
  assert.equal(classifySubstanceRisk(42).decision, "allow");
});

test("deriveEventItemKey is deterministic given the same input", () => {
  const a = deriveEventItemKey({
    kind: "scan_extraction",
    text: "yo",
    occurred_at: "2026-05-01",
  });
  const b = deriveEventItemKey({
    kind: "scan_extraction",
    text: "yo",
    occurred_at: "2026-05-01",
  });
  assert.equal(a, b);
});

test("deriveEventItemKey prefers caller-supplied id, then message_id, then content hash", () => {
  assert.equal(deriveEventItemKey({ id: "my-id" }), "my-id");
  const m = deriveEventItemKey({
    message_id: "loop:abc",
    kind: "scan_extraction",
  });
  assert.ok(/^[0-9a-f]{32}$/.test(m));
  const h = deriveEventItemKey({
    kind: "draft_update",
    text: "hello",
    occurred_at: "x",
  });
  assert.ok(/^[0-9a-f]{32}$/.test(h));
});

test("normalizeCardPatch drops unknown keys and forces visibility=private", () => {
  const out = normalizeCardPatch(
    {
      title: "EDC 2026",
      latest_plan: "meet at brown lot",
      visibility: "private",
      malicious_key: "evil",
    },
    { ownerDid: "did:privy:sagar" },
  );
  assert.equal(out.title, "EDC 2026");
  assert.equal(out.latest_plan, "meet at brown lot");
  assert.equal(out.visibility, "private");
  assert.equal(out.owner_did, "did:privy:sagar");
  assert.equal(out.malicious_key, undefined);
  assert.ok(out.updated_at);
});

test("normalizeCardPatch throws when caller asks for non-private visibility", () => {
  assert.throws(
    () => normalizeCardPatch({ visibility: "public" }),
    /visibility/,
  );
});

test("validateEventItem requires a valid kind + non-empty text/summary", () => {
  assert.deepEqual(
    validateEventItem({ kind: "scan_extraction", text: "yo" }),
    [],
  );
  assert.deepEqual(
    validateEventItem({ kind: "draft_update", summary: "hello" }),
    [],
  );
  assert.ok(validateEventItem({}).length > 0);
  assert.ok(
    validateEventItem({ kind: "not-a-real-kind", text: "hi" }).length > 0,
  );
  assert.ok(validateEventItem({ kind: "scan_extraction" }).length > 0);
});

test("EVENT_ITEM_KINDS includes the documented kinds", () => {
  for (const k of [
    "scan_extraction",
    "group_memory",
    "draft_update",
    "approval_request",
    "friend_reply",
    "safety_context",
    "plan_snapshot",
    "task_audit",
  ]) {
    assert.ok(EVENT_ITEM_KINDS.includes(k), `missing kind: ${k}`);
  }
});

test("EVENT_STATUSES and EVENT_TASK_STATUSES expose stable enum values", () => {
  assert.deepEqual(
    [...EVENT_STATUSES],
    ["planning", "confirmed", "completed", "cancelled"],
  );
  assert.deepEqual([...EVENT_TASK_STATUSES], ["open", "done", "blocked"]);
});

test("buildTaskId composes a stable id and parseTaskId reverses it", () => {
  const eventId = "event:did:privy:sagar:rytual-retreat:2026";
  const id = buildTaskId({ eventId, order: 3, title: "Book an Airbnb" });
  assert.equal(id, `task:${eventId}:003:book-an-airbnb`);
  assert.deepEqual(parseTaskId(id), {
    eventId,
    order: 3,
    slug: "book-an-airbnb",
  });
});

test("buildTaskId pads order and caps slug length", () => {
  const eventId = "event:did:privy:x:e:2026";
  const id = buildTaskId({ eventId, order: 0, title: "" });
  assert.ok(id.endsWith(":000:task"));
  const long = buildTaskId({
    eventId,
    order: 999,
    title: "a".repeat(200),
  });
  // slug capped at 32 chars
  const parts = parseTaskId(long);
  assert.equal(parts.order, 999);
  assert.ok(parts.slug.length <= 32);
});

test("buildTaskId rejects malformed inputs", () => {
  assert.throws(() => buildTaskId({ order: 0, title: "hi" }), /eventId/);
  assert.throws(
    () =>
      buildTaskId({
        eventId: "event:did:privy:x:s:2026",
        order: 1000,
        title: "x",
      }),
    /order/,
  );
});

test("parseTaskId returns null for malformed input", () => {
  assert.equal(parseTaskId(""), null);
  assert.equal(parseTaskId("task:nope"), null);
  assert.equal(parseTaskId("event:did:privy:x:s:2026:003:slug"), null);
});

test("validateEventTask requires a non-empty title on create", () => {
  assert.deepEqual(validateEventTask({ title: "Book Airbnb" }), []);
  assert.ok(validateEventTask({}).length > 0);
  assert.ok(validateEventTask({ title: "" }).length > 0);
});

test("validateEventTask rejects unknown status values", () => {
  assert.ok(validateEventTask({ title: "ok", status: "wat" }).length > 0);
  assert.deepEqual(validateEventTask({ title: "ok", status: "done" }), []);
});

test("validateEventTask allows missing title on patch when requireTitle=false", () => {
  assert.deepEqual(
    validateEventTask({ status: "done" }, { requireTitle: false }),
    [],
  );
});

test("normalizeTaskPatch stamps completed_at when status flips to done", () => {
  const out = normalizeTaskPatch({ status: "done" });
  assert.equal(out.status, "done");
  assert.ok(typeof out.completed_at === "string" && out.completed_at.length);
  const reopened = normalizeTaskPatch({ status: "open" });
  assert.equal(reopened.status, "open");
  assert.equal(reopened.completed_at, null);
});

test("normalizeTaskPatch drops unknown keys", () => {
  const out = normalizeTaskPatch({ title: "x", malicious: "evil" });
  assert.equal(out.title, "x");
  assert.equal(out.malicious, undefined);
});

test("textForEvent renders distinctive fields for embedding", () => {
  const text = textForEvent({
    title: "Rytual Retreat",
    status: "planning",
    start_date: "2026-07-17",
    end_date: "2026-07-19",
    location: "Upstate NYC",
    description: "Founder + close friends retreat",
    attendees: [{ name: "Shirley" }, { name: "Sagar" }],
    task_count: 8,
  });
  assert.ok(text.includes("Rytual Retreat"));
  assert.ok(text.includes("2026-07-17"));
  assert.ok(text.includes("Upstate NYC"));
  assert.ok(text.includes("Shirley"));
  assert.ok(text.includes("Tasks: 8"));
});

test("textForTask includes parent event title so semantic recall works", () => {
  const text = textForTask(
    { title: "Book an Airbnb", status: "open", due_date: "2026-07-10" },
    { title: "Rytual Retreat" },
  );
  assert.ok(text.includes("Book an Airbnb"));
  assert.ok(text.includes("Rytual Retreat"));
  assert.ok(text.includes("open"));
});

test("textForEvent / textForTask are safe on empty input", () => {
  assert.equal(textForEvent(null), "");
  assert.equal(textForEvent({}), "");
  assert.equal(textForTask(null, null), "");
});
