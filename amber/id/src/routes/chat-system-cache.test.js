/**
 * toSystemParam: the prompt-caching breakpoint.
 *
 * The failure mode being guarded here is expensive and silent. Prompt caching is
 * PREFIX caching, a cache write costs 1.25x normal input, and a hit costs 0.1x.
 * So marking a prefix that changes every turn does not save money -- it adds a
 * permanent 25% surcharge to that call and looks exactly like a saving on the
 * dashboard until the invoice arrives. These tests pin that a plain string is
 * NEVER marked, and that only blocks explicitly flagged `cache: true` carry a
 * breakpoint.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { toSystemParam } from "./chat.js";

test("a plain string passes through unmarked", () => {
  // Several system prompts in chat.js are assembled with per-request lines
  // FIRST and the stable house rules last. Caching those would be a surcharge,
  // so a bare string must never be given a breakpoint automatically.
  assert.equal(toSystemParam("volatile then stable"), "volatile then stable");
});

test("null / undefined -> undefined so the key is omitted", () => {
  assert.equal(toSystemParam(null), undefined);
  assert.equal(toSystemParam(undefined), undefined);
});

test("blocks marked cache:true get an ephemeral breakpoint; others do not", () => {
  const out = toSystemParam([
    { text: "STABLE PREFIX", cache: true },
    { text: "volatile per-user context" },
  ]);
  assert.deepEqual(out, [
    { type: "text", text: "STABLE PREFIX", cache_control: { type: "ephemeral" } },
    { type: "text", text: "volatile per-user context" },
  ]);
});

test("the breakpoint is on the stable block, not the last one", () => {
  // Order matters: the cached prefix must END before the volatile half begins.
  const out = toSystemParam([
    { text: "base", cache: true },
    { text: "recent conversations" },
  ]);
  assert.ok(out[0].cache_control, "stable prefix should carry the breakpoint");
  assert.equal(out[1].cache_control, undefined, "volatile tail must not be cached");
});

test("bare strings inside an array are kept but never cached", () => {
  const out = toSystemParam(["one", "two"]);
  assert.deepEqual(out, [
    { type: "text", text: "one" },
    { type: "text", text: "two" },
  ]);
});

test("empty and non-string blocks are dropped", () => {
  const out = toSystemParam([
    { text: "keep", cache: true },
    { text: "" },
    { text: null },
    null,
    42,
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "keep");
});

test("an array that yields no usable blocks -> undefined", () => {
  assert.equal(toSystemParam([]), undefined);
  assert.equal(toSystemParam([{ text: "" }, null]), undefined);
});
