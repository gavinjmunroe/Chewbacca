// The agent-following model for Realm on the Chewbacca glass.
//
// Realm is Carlton Aikins' agent workspace (github.com/31Carlton7/realm). On
// the glass his renderer runs unmodified; this file is part of the layer we
// put on top of it (bin/lib/realm_ui/glass), and it is pure: it reads realm's
// session events (packages/contracts/src/session-events.ts, `{seq, event:
// {type, ts, payload}}`) and answers what the glass should show beside the
// conversation right now. No DOM, no socket, so node --test can hold it.
//
// What the stage shows, per the brief (Caleb, 2026-10-11 4:53pm): a file the
// agent is editing, with the changed lines lit; a command while it runs,
// folded away after; tests only when they run; and when the turn settles,
// its diff as hunks to Keep or Reject. Nothing is shown with nothing on it.

/** Claude's own tool names, and ACP's `kind` (`edit`, `execute`) for the rest. */
const EDIT_TOOLS = new Set([
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "str_replace_based_edit_tool",
]);
const COMMAND_TOOLS = new Set([
  "Bash",
  "BashOutput",
  "shell",
  "exec_command",
  "run_terminal_cmd",
]);

/** A command that runs a test suite. Read from the runners this kit and
 *  Realm actually use (pytest, unittest, node --test, vitest, jest, swift
 *  test, go test, cargo test, npm/pnpm/yarn test, tests/run.sh, bats). */
const TEST_COMMAND =
  /(^|[\s;&|(])(pytest|py\.test|vitest|jest|bats|mocha|ava|rspec|phpunit)\b|python3? -m (pytest|unittest)\b|\bnode --test\b|\b(swift|go|cargo|dotnet|mix|deno|bun) test\b|\b(npm|pnpm|yarn)( run)? test\b|tests?\/[\w./-]*\.(sh|py|mjs)\b|\btest_[\w-]+\.(py|sh)\b/;

export function isTestCommand(command) {
  return typeof command === "string" && TEST_COMMAND.test(command);
}

/** What a tool call is, for the stage. */
export function classify(payload) {
  const name = String(payload?.name ?? "");
  const input = payload?.input ?? {};
  const kind = String(payload?.kind ?? "");
  const path = String(
    input.file_path ??
      input.path ??
      input.notebook_path ??
      (payload?.paths ?? [])[0] ??
      "",
  );
  if (EDIT_TOOLS.has(name) || kind === "edit") {
    if (
      name === "Write" ||
      (typeof input.content === "string" && input.old_string === undefined)
    ) {
      return { kind: "write", path, text: String(input.content ?? "") };
    }
    const edits = Array.isArray(input.edits)
      ? input.edits
      : [{ old_string: input.old_string, new_string: input.new_string }];
    return {
      kind: "edit",
      path,
      edits: edits.map((e) => ({
        before: String(e?.old_string ?? ""),
        after: String(e?.new_string ?? ""),
      })),
    };
  }
  if (COMMAND_TOOLS.has(name) || kind === "execute") {
    const command = String(input.command ?? input.cmd ?? payload?.title ?? "");
    return {
      kind: isTestCommand(command) ? "tests" : "command",
      command,
      label: String(input.description ?? ""),
    };
  }
  return { kind: "other", name };
}

// pytest "3 passed, 1 failed", vitest/jest "Tests  4 passed (4)", node --test
// "# pass 12 / # fail 0", go "ok"/"FAIL", unittest "Ran 9 tests ... OK".
export function testCounts(output) {
  const text = String(output ?? "");
  const take = (re) => {
    let total = 0,
      seen = false;
    for (const m of text.matchAll(re)) {
      total += Number(m[1]);
      seen = true;
    }
    return seen ? total : null;
  };
  let passed = take(/(\d+) (?:passed|passing)\b/g);
  let failed = take(/(\d+) (?:failed|failing)\b/g);
  const nodePass = take(/^# pass (\d+)/gm),
    nodeFail = take(/^# fail (\d+)/gm);
  if (passed === null && nodePass !== null) passed = nodePass;
  if (failed === null && nodeFail !== null) failed = nodeFail;
  const ran = /^Ran (\d+) tests?/m.exec(text);
  if (passed === null && ran) {
    const f = /FAILED \((?:failures|errors)=(\d+)/.exec(text);
    failed = f ? Number(f[1]) : 0;
    passed = Number(ran[1]) - failed;
  }
  if (passed === null && failed === null) return null;
  return { passed: passed ?? 0, failed: failed ?? 0 };
}

/** The 1-based lines of `needle` inside `text`, or null when it isn't there. */
export function litRange(text, needle) {
  if (!needle) return null;
  const at = String(text).indexOf(needle);
  if (at < 0) return null;
  const start = String(text).slice(0, at).split("\n").length;
  const span = needle.replace(/\n$/, "").split("\n").length;
  return { start, end: start + span - 1 };
}

/** Where one edit sits in the file as read, and whether it has landed.
 *  The file can be read before or after the edit is applied (an agent
 *  writes the file and reports the call in either order, and the glass reads
 *  it over the network), so the text it is looked for in is whichever is
 *  there: the written lines first once the call is done, the lines it
 *  replaces before that, then the other. */
export function editRange(text, edit, done) {
  const before = edit?.before ?? "";
  const after = edit?.after ?? "";
  const order = done ? [[after, true], [before, false]] : [[before, false], [after, true]];
  for (const [needle, landed] of order) {
    const range = litRange(text, needle);
    if (range) return { range, landed };
  }
  return { range: null, landed: Boolean(done) };
}

/** The lines a viewer shows around a lit range: the change with `context`
 *  lines either side, never more than `max` in all. */
export function excerpt(text, range, { context = 6, max = 28 } = {}) {
  const lines = String(text).split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (!range) return { first: 1, lines: lines.slice(0, max) };
  let first = Math.max(1, range.start - context);
  let last = Math.min(lines.length, range.end + context);
  if (last - first + 1 > max) last = first + max - 1;
  return { first, lines: lines.slice(first - 1, last) };
}

export function emptyStage() {
  return {
    running: false,
    status: "idle",
    calls: {},
    order: [],
    file: null,
    command: null,
    tests: null,
    changes: null,
    settledAt: 0,
  };
}

/** One event into the stage. Returns a new object when anything changed,
 *  the same one when nothing did, so a React consumer re-renders only for a
 *  change (motion rule: still when nothing changed). */
export function reduce(stage, stored) {
  const ev = stored?.event;
  if (!ev) return stage;
  const p = ev.payload ?? {};
  const ts = Number(ev.ts ?? 0);
  switch (ev.type) {
    case "user_message":
      // A new turn: last turn's stage goes, this one starts empty.
      return { ...emptyStage(), running: true, status: "running" };
    case "status": {
      const status = p.status;
      const running = status === "running" || status === "waiting_permission";
      if (status === stage.status && running === stage.running) return stage;
      return { ...stage, status, running, settledAt: running ? 0 : ts };
    }
    case "tool_call": {
      const what = classify(p);
      if (what.kind === "other") return stage;
      const call = {
        id: p.toolUseId,
        ...what,
        done: false,
        error: false,
        output: "",
        at: ts,
      };
      const next = {
        ...stage,
        running: true,
        calls: { ...stage.calls, [p.toolUseId]: call },
        order: [...stage.order, p.toolUseId],
      };
      if (what.kind === "edit" || what.kind === "write") next.file = call;
      else if (what.kind === "tests") next.tests = call;
      else next.command = call;
      return next;
    }
    case "tool_result": {
      const call = stage.calls[p.toolUseId];
      if (!call) return stage;
      const done = {
        ...call,
        done: true,
        error: Boolean(p.isError),
        output: String(p.content ?? ""),
        endedAt: ts,
      };
      if (done.kind === "tests") done.counts = testCounts(done.output);
      const next = { ...stage, calls: { ...stage.calls, [p.toolUseId]: done } };
      if (stage.file?.id === p.toolUseId) next.file = done;
      if (stage.command?.id === p.toolUseId) next.command = done;
      if (stage.tests?.id === p.toolUseId) next.tests = done;
      return next;
    }
    case "turn_changes":
      return {
        ...stage,
        changes: {
          checkpointId: p.checkpointId,
          afterTree: p.afterTree,
          root: p.root,
          files: p.files ?? [],
        },
      };
    default:
      return stage;
  }
}

/** How long a finished command stays before it folds away. Long enough to
 *  read a one-line result; guessed, never measured with Caleb. */
export const COMMAND_LINGER_MS = 2400;

/** What the stage draws at `now`: each part present only while it has
 *  something on it. */
export function visible(stage, now) {
  const out = [];
  // Settled: the file and the command it ran give way to the turn's diff.
  // Tests that ran this turn stay beside it, since they are the verdict.
  if (!stage.running) {
    if (stage.tests) out.push("tests");
    if (stage.changes && stage.changes.files.length) out.push("review");
    return out;
  }
  if (stage.file) out.push("file");
  const cmd = stage.command;
  if (cmd && (!cmd.done || now - (cmd.endedAt ?? 0) < COMMAND_LINGER_MS))
    out.push("command");
  if (stage.tests) out.push("tests");
  return out;
}

/** The tile's words for one session. `truth` is what its Claude Code tab is
 *  really doing (GET /glass/tabs, tab_truth.mjs): realm's imported row says
 *  "idle" for a tab that is mid-turn in another window, so the transcript
 *  wins over it, except where realm itself is running the session. */
export function tileState(session, needsYou, truth) {
  const s = session?.status;
  if (needsYou || s === "waiting_permission")
    return { word: "Needs you", tone: "needs" };
  if (s === "running" || truth?.state === "running")
    return { word: "Working", tone: "running" };
  if (s === "error") return { word: "Failed", tone: "failed" };
  if (truth?.state === "stopped") return { word: "Stopped", tone: "done" };
  return { word: "Done", tone: "done" };
}

/** When a tile's session last did something: its last message, when the
 *  transcript says so, else realm's own `updatedAt` (for a session realm ran,
 *  that is real; for an imported one it is only the import time). */
export function tileTime(session, truth) {
  return truth?.lastAt ?? session?.updatedAt ?? 0;
}

/** The tiles in the order the glass draws them: needing you, then working,
 *  then the rest, newest first, at most `max`. */
export function tileOrder(sessions, truths = {}, max = 9) {
  const rank = (s) => {
    const tone = tileState(s, false, truths[s.providerSessionId]).tone;
    return tone === "needs" ? 0 : tone === "running" ? 1 : 2;
  };
  const when = (s) => tileTime(s, truths[s.providerSessionId]);
  return [...sessions]
    .sort((a, b) => rank(a) - rank(b) || when(b) - when(a))
    .slice(0, max);
}

/** The tile's "doing now" line from its newest event. */
export function nowLine(stored) {
  const ev = stored?.event;
  if (!ev) return "";
  const p = ev.payload ?? {};
  if (ev.type === "tool_call") {
    const what = classify(p);
    const base = (path) => path.split("/").filter(Boolean).pop() ?? path;
    if (what.kind === "edit") return `Editing ${base(what.path)}`;
    if (what.kind === "write") return `Writing ${base(what.path)}`;
    if (what.kind === "tests") return `Testing: ${what.command}`;
    if (what.kind === "command") return what.label || `Running ${what.command}`;
    if (p.name === "Read")
      return `Reading ${base(String(p.input?.file_path ?? ""))}`;
    return String(p.name ?? "");
  }
  if (ev.type === "assistant_text" || ev.type === "user_message") {
    const text = String(p.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 90 ? `${text.slice(0, 89)}…` : text;
  }
  if (ev.type === "permission_request")
    return String(p.title ?? "Waiting for a press");
  if (ev.type === "error") return String(p.message ?? "");
  return "";
}

/** What a sentence said to the glass means, while an agent has the glass.
 *  Every one only fills or opens something; sending is still a press. */
export function voiceIntent(said) {
  const text = String(said ?? "").trim().replace(/[.!?]+$/, "");
  const lower = text.toLowerCase();
  const tail = (m) => text.slice(text.length - m.length).trim();
  let m;
  if ((m = /^(?:open |show )?(?:the )?(?:command )?palette(?:\s+(?:for\s+)?(.*))?$/.exec(lower))) {
    return { kind: "palette", query: m[1] ? tail(m[1]) : "" };
  }
  if ((m = /^(?:find|search(?: for)?|grep(?: for)?)\s+(.+)$/.exec(lower))) return { kind: "find", query: tail(m[1]) };
  if ((m = /^(?:open|go to)\s+(?:the\s+)?(?:file\s+)?(.+)$/.exec(lower))) return { kind: "palette", query: tail(m[1]) };
  if ((m = /^(?:at|mention|attach)\s+(?:the\s+)?(?:file\s+)?(\S+)$/.exec(lower))) return { kind: "mention", name: tail(m[1]) };
  return { kind: "draft", text: String(said ?? "").trim() };
}

/** What to do when the focused agent isn't in the glass's session list:
 *  "stay" (nothing to decide), "ask" (reload the list once: his store may
 *  have just made it, as New agent does) or "tiles" (asked, still gone).
 *  The morning rehearsal, 2026-10-11, fell back to the tiles the moment
 *  Create opened a new agent, because the list hadn't heard of it yet. */
export function lostFocus({ mode, focus, known, haveSessions, morphing, asked }) {
  if (mode === "tiles" || !focus || !haveSessions || known || morphing) return "stay";
  return asked === focus ? "tiles" : "ask";
}

/** Whether a review has nothing left to decide: every file's hunks are put
 *  back, or all kept and the file staged, and none failed to read. In the
 *  morning rehearsal, 2026-10-11, one file rejected and the other kept and
 *  staged still read "2 files changed... Keep all 2 files", a call about a
 *  decision already made. `past` is files beyond the ones read. */
export function reviewDecided(files, past = 0) {
  if (!Array.isArray(files) || past > 0) return false;
  return files.every((f) => {
    if (f.fault) return false;
    const n = f.hunks?.length ?? 0;
    if (!n) return true;
    const kept = f.kept instanceof Set ? f.kept : new Set(f.kept ?? []);
    return f.staged === true && Array.from({ length: n }, (_, i) => i).every((i) => kept.has(i));
  });
}
