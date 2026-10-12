// New agent on the glass: a session his store just made is asked about
// before the glass treats it as gone. On 2026-10-11 the morning rehearsal
// pressed Create in his new space sheet and the glass fell straight back to
// the tiles, because its own list hadn't heard of the new session yet.
import test from "node:test";
import assert from "node:assert/strict";
import { lostFocus } from "../bin/lib/realm_ui/glass/model.mjs";

const base = { mode: "work", focus: "new", known: false, haveSessions: true, morphing: false, asked: null };

test("a focus the list doesn't know is asked about first, not dropped", () => {
  assert.equal(lostFocus(base), "ask");
});

test("asked once and still unknown: it's gone, back to the tiles", () => {
  assert.equal(lostFocus({ ...base, asked: "new" }), "tiles");
});

test("asking about one agent doesn't count for the next", () => {
  assert.equal(lostFocus({ ...base, focus: "newer", asked: "new" }), "ask");
});

test("nothing to decide on the tiles, mid-morph, or when the list knows it", () => {
  assert.equal(lostFocus({ ...base, mode: "tiles" }), "stay");
  assert.equal(lostFocus({ ...base, morphing: true }), "stay");
  assert.equal(lostFocus({ ...base, known: true }), "stay");
  assert.equal(lostFocus({ ...base, focus: null }), "stay");
  assert.equal(lostFocus({ ...base, haveSessions: false }), "stay");
});
