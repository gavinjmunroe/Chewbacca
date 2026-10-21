/**
 * Every display claim this app has made that went untested turned out to be
 * wrong -- a ring that asserted colleagues, a label that said "spoke" about a
 * CC, a stub in the closest circle. These assert that a row never says more
 * than the fields behind it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { toRow, reasonFor, subtitleFor, rankPeople } from "./people-rows.js";

const NOW = Date.parse("2026-09-28T00:00:00Z");
const ago = (d) => new Date(NOW - d * 86_400_000).toISOString();

let n = 0;
const person = (over = {}) => ({
  id: `c${++n}`, kind: "contact", name: `Person ${n}`, strength: 0.4, groupKeys: [], ...over,
});
const GROUPS = [
  { key: "pwc", id: "org:pwc", label: "PWC", kind: "organization", memberCount: 6, memberIds: [] },
  { key: "__places", id: "__places", label: "Businesses & places", kind: "category", memberCount: 43, memberIds: [] },
];

// ── the row must justify itself ─────────────────────────────────────────────

test("ALEX GETS A ROW THAT SAYS HE IS NOTHING BUT A NAME", () => {
  // The card that started this: one word, no source, no company, and it sat in
  // the closest circle because a dot cannot say "I have nothing on this one".
  const alex = person({ name: "Alex", strength: 0.35 });
  const row = toRow(alex, GROUPS, NOW);
  assert.equal(row.reason, "no recorded contact — nothing but a name on file");
  assert.equal(row.subtitle, null);
  assert.deepEqual(row.groups, []);
  assert.equal(row.lastContact, null);
  assert.equal(row.initials, "A");
});

test("real exchanges outrank a bare timestamp as the reason", () => {
  const busy = person({ count90d: 12, lastAt: ago(2), lastChannel: "email" });
  assert.equal(reasonFor(busy, GROUPS, NOW), "12 exchanges in the last 90 days");
  const quiet = person({ count90d: 0, lastAt: ago(40), lastChannel: "email" });
  assert.equal(reasonFor(quiet, GROUPS, NOW), "emailed 1 month ago");
});

test("one exchange is singular, because '1 exchanges' reads as a bug", () => {
  assert.equal(reasonFor(person({ count90d: 1 }), GROUPS, NOW), "1 exchange in the last 90 days");
});

test("a cold card falls back to shared context, counted as OTHERS", () => {
  const colleague = person({ count90d: 0, lastAt: null, groupKeys: ["pwc"] });
  assert.equal(
    reasonFor(colleague, GROUPS, NOW),
    "at PWC, with 5 others in your contacts",
    "the owner is asking what this person shares with the rest of the book",
  );
});

test("THE PLACES CATEGORY IS NOT A SHARED WORKPLACE", () => {
  // "at Businesses & places, with 42 others" would be nonsense as a reason.
  const gym = person({ entity: "place", groupKeys: ["__places"], count90d: 0, lastAt: null });
  assert.equal(reasonFor(gym, GROUPS, NOW), "a business or place in your contacts");
});

test("a search hit's own explanation wins over everything", () => {
  const hit = person({ why: "name starts with what you typed", count90d: 30 });
  assert.equal(reasonFor(hit, GROUPS, NOW), "name starts with what you typed");
});

test("a reason is never empty", () => {
  for (const node of [
    person(),
    person({ count90d: 0 }),
    person({ lastAt: null, groupKeys: [] }),
    person({ entity: "place" }),
  ]) {
    assert.ok(reasonFor(node, GROUPS, NOW).trim().length > 0);
  }
});

// ── the rest of the row ─────────────────────────────────────────────────────

test("the subtitle is whatever exists, in a fixed order, and null when nothing does", () => {
  assert.equal(
    subtitleFor(person({ title: "Partner", company: "PWC", city: "Chicago" })),
    "Partner · PWC · Chicago",
  );
  assert.equal(subtitleFor(person({ company: "PWC" })), "PWC");
  assert.equal(subtitleFor(person({ title: "  ", company: null })), null);
});

test("a folded person carries the names the row stands for", () => {
  const row = toRow(person({ name: "Nathan Kaplan", aliases: ["Nate Kaplan"] }), GROUPS, NOW);
  assert.deepEqual(row.aliases, ["Nate Kaplan"]);
});

test("a group key with no matching group is dropped, not rendered raw", () => {
  const row = toRow(person({ groupKeys: ["pwc", "ghost"] }), GROUPS, NOW);
  assert.deepEqual(row.groups, [{ key: "pwc", label: "PWC" }]);
});

// ── ranking ─────────────────────────────────────────────────────────────────

test("BUSINESSES SINK BELOW PEOPLE in the default list", () => {
  const gym = person({ name: "Equinox", strength: 0.9, entity: "place" });
  const friend = person({ name: "Sagar", strength: 0.5 });
  const rows = rankPeople([gym, friend], GROUPS, { now: NOW });
  assert.deepEqual(rows.map((r) => r.name), ["Sagar", "Equinox"]);
});

test("but a business the owner searched for is not demoted", () => {
  const gym = person({ name: "Equinox", strength: 0.9, entity: "place" });
  const friend = person({ name: "Sagar", strength: 0.5 });
  const rows = rankPeople([gym, friend], GROUPS, {
    now: NOW,
    matchedIds: new Set([gym.id, friend.id]),
  });
  assert.deepEqual(rows.map((r) => r.name), ["Equinox", "Sagar"]);
});

test("a search shows only what matched", () => {
  const a = person({ name: "A" });
  const b = person({ name: "B" });
  const rows = rankPeople([a, b], GROUPS, { now: NOW, matchedIds: new Set([b.id]) });
  assert.deepEqual(rows.map((r) => r.name), ["B"]);
});

test("the owner is never a row", () => {
  const me = { id: "me", kind: "owner", name: "You", strength: 1 };
  assert.deepEqual(rankPeople([me, person({ name: "Sagar" })], GROUPS, { now: NOW }).map((r) => r.name), ["Sagar"]);
});

test("ties break on name so the list does not reshuffle between renders", () => {
  const z = person({ name: "Zoe", strength: 0.5 });
  const a = person({ name: "Adam", strength: 0.5 });
  assert.deepEqual(rankPeople([z, a], GROUPS, { now: NOW }).map((r) => r.name), ["Adam", "Zoe"]);
  assert.deepEqual(rankPeople([a, z], GROUPS, { now: NOW }).map((r) => r.name), ["Adam", "Zoe"]);
});

test("an empty book is an empty list, not a crash", () => {
  assert.deepEqual(rankPeople([], GROUPS, { now: NOW }), []);
  assert.deepEqual(rankPeople([], [], { now: NOW, matchedIds: new Set() }), []);
});
