/**
 * A NEW SOURCE STRING MUST NOT SCORE 0.5 IN SILENCE.
 *
 * This is the detector for the class of bug migrations 027 and 038 both cleaned
 * up after the fact: a writer invents a `source`, nothing fails, and every
 * observation from it is scored "quietly average" until somebody happens to
 * read a query plan. What is asserted here is that it warns, that it warns once,
 * that it never throws, and that it never blocks a write.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { noteObservationSource, _resetSourceTrust } from "./source-trust.js";

/** The check is fire-and-forget, so give its promise a turn to settle. */
const settle = () => new Promise((r) => setTimeout(r, 5));

function spyConsole() {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  return { lines, restore: () => (console.error = original) };
}

test("a source with no weight is named, once", async () => {
  _resetSourceTrust();
  const asked = [];
  const queryImpl = async (sql, params) => {
    asked.push(params[0]);
    return { rows: [], rowCount: 0 };
  };
  const spy = spyConsole();
  try {
    noteObservationSource("dm", { queryImpl });
    await settle();
    noteObservationSource("dm", { queryImpl });
    noteObservationSource("dm", { queryImpl });
    await settle();
  } finally {
    spy.restore();
  }
  assert.deepEqual(asked, ["source_dm"], "one query per source per process");
  assert.equal(spy.lines.length, 1, "one line, not one per write");
  assert.match(spy.lines[0], /SOURCE_TRUST_MISSING source='dm'/);
  assert.match(spy.lines[0], /source_dm/, "the line names the row to add");
});

test("a source that has a weight says nothing at all", async () => {
  _resetSourceTrust();
  const queryImpl = async () => ({ rows: [{ "?column?": 1 }], rowCount: 1 });
  const spy = spyConsole();
  try {
    noteObservationSource("app_chat", { queryImpl });
    await settle();
  } finally {
    spy.restore();
  }
  assert.equal(spy.lines.length, 0);
});

test("a failed check is silent, and is retried later rather than remembered", async () => {
  _resetSourceTrust();
  let calls = 0;
  const queryImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error("connection lost");
    return { rows: [], rowCount: 0 };
  };
  const spy = spyConsole();
  try {
    noteObservationSource("reminder", { queryImpl });
    await settle();
    assert.equal(spy.lines.length, 0, "a diagnostic that failed must not shout");
    noteObservationSource("reminder", { queryImpl });
    await settle();
  } finally {
    spy.restore();
  }
  assert.equal(calls, 2, "the first failure did not poison the source");
  assert.equal(spy.lines.length, 1);
});

test("it never throws, whatever it is handed", () => {
  _resetSourceTrust();
  const queryImpl = async () => {
    throw new Error("nope");
  };
  for (const v of [null, undefined, "", "   ", 42, {}, []]) {
    assert.doesNotThrow(() => noteObservationSource(v, { queryImpl }));
  }
});
