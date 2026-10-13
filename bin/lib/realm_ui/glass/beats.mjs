// An agent turn told by the screen: the beats of one turn, for Realm on the
// Chewbacca glass.
//
// Realm is Carlton Aikins' agent workspace (github.com/31Carlton7/realm); his
// renderer runs unmodified and this file is part of our layer over it
// (bin/lib/realm_ui/glass). Pure, so node --test holds it: it reads realm's
// session events (packages/contracts/src/session-events.ts) on top of
// model.mjs's stage and answers which beat the turn is on, the one sentence
// that tells it, what proved it, and the one decision waiting on the person.
// The regions that draw this are Story.tsx; the spec is skills/hud/SKILL.md,
// "An agent turn told by the screen".
import { classify, emptyStage, reduce } from "./model.mjs";
import { emptyAgent, match, step } from "./turn.mjs";

export const BEATS = [
  "asked",
  "reading",
  "changing",
  "proving",
  "call",
  "done",
];
export const BEAT_WORDS = {
  asked: "You asked",
  reading: "Reading",
  changing: "Changing",
  proving: "Proving",
  call: "Your call",
  done: "Done",
  failed: "Failed",
};

/** Tools that only look. Claude's names and ACP's `read`/`search` kinds. */
const READ_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "NotebookRead",
  "WebFetch",
  "WebSearch",
]);
// The files a reading beat lists. Five is what fits the figure at 14 px with
// room for the path; guessed, never measured with Caleb.
const MAX_READS = 5;
// A headline is one sentence the eye takes in at once. Lemma's captions run 6
// to 14 words; 120 characters is about 20, the most that holds on two lines
// of 28 px type in the story's left column.
const HEADLINE_MAX = 120;

// How long a settled turn that edited files waits for its diff before it is
// told as Done. The fake agent's diff lands within one tick; a real git
// measurement on a large checkout takes longer. Guessed, never measured live.
export const SETTLE_HOLD_MS = 3000;

// The most of a request the glass shows before it stops offering Allow, the
// same bound the agents card holds (bin/lib/surfaces/agents.py
// PERMISSION_CHARS, 1200).
export const PERMISSION_CHARS = 1200;
// Ported from agents.py hidden() and INVISIBLE: the whole Unicode C category,
// U+2028/9, and the blank-looking letters and selectors that category leaves
// out (combining grapheme joiner, Hangul fillers, Khmer vowels, Mongolian
// selectors, Braille blank, variation selectors). Kept in step by
// tests/test_realm_beats.mjs, which reads INVISIBLE out of agents.py.
export const INVISIBLE = [
  0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x2800, 0x3164, 0xffa0,
  ...range(0x180b, 0x1810),
  ...range(0xfe00, 0xfe10),
  ...range(0xe0100, 0xe01f0),
];
const INVISIBLE_SET = new Set(INVISIBLE);
function range(from, to) {
  return Array.from({ length: to - from }, (_, i) => from + i);
}
const hidden = (ch) => /[\p{C}\p{Zl}\p{Zp}]/u.test(ch) || INVISIBLE_SET.has(ch.codePointAt(0));

/** What the glass shows of a permission request, and whether that is
 *  exactly what would run. agents.py permission_view, ported as is: the
 *  tool's real name and its whole input as JSON, which escapes newlines and
 *  controls so a second line can't hide below the first. Anything hidden
 *  left in it, or anything past PERMISSION_CHARS, means the person can't see
 *  the whole request, so Allow is not offered on the glass. */
export function permissionView(toolName, input) {
  const raw = `${toolName}: ${safeJson(input)}`;
  const shown = [...raw].filter((ch) => !hidden(ch)).join("");
  const exact = shown === raw && shown.length <= PERMISSION_CHARS;
  return {
    shown: shown.length > PERMISSION_CHARS ? `${shown.slice(0, PERMISSION_CHARS - 1)}…` : shown,
    exact,
    // How the figure draws it. Typed only when the whole request passed the
    // exact check above AND the tool's renderer accounts for every field of
    // the input; anything else is the raw view, never a partial one.
    request: exact ? requestOf(toolName, input) : RAW,
  };
}

// The request as the thing it is, one renderer per tool kind (Daniel's
// "one typed renderer per kind, exhaustive"). Story.tsx draws each kind in
// REQUEST_VIEWS, and tests/test_realm_beats.mjs fails if a kind here has no
// view there. The raw kind is the agents.py JSON line above, as is.
export const REQUEST_KINDS = ["command", "edit", "edits", "write", "raw"];
const RAW = Object.freeze({ kind: "raw" });

// A field's text split into the lines it really has. Lines are drawn one
// per row with their number, so a run of blank lines can't push a second
// command out of sight unnoticed. Any other control or invisible character
// (a tab, a carriage return, ESC, a bidi override) has no honest drawing,
// and the JSON line escapes them, so it sends the request to the raw view.
const linesOf = (text) => {
  if (typeof text !== "string") return null;
  const lines = text.split("\n");
  return lines.every((l) => ![...l].some(hidden)) ? lines : null;
};
const isBool = (v) => v === undefined || typeof v === "boolean";
// Every key the input carries must be one this kind draws: an unknown one
// would be run without being shown.
const only = (input, keys) => Object.keys(input).every((k) => keys.includes(k));

function requestOf(toolName, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return RAW;
  // Own names only: a tool called "constructor" or "toString" must not reach
  // what a plain object inherits (review of the typed views, 10/12).
  if (!Object.hasOwn(REQUESTS, toolName)) return RAW;
  const typed = REQUESTS[toolName](input);
  return typed && REQUEST_KINDS.includes(typed.kind) ? typed : RAW;
}

const REQUESTS = {
  Bash(input) {
    if (!only(input, ["command", "description", "timeout", "run_in_background", "dangerouslyDisableSandbox"]))
      return null;
    const lines = linesOf(input.command);
    if (!lines || !input.command.trim()) return null;
    if (input.description !== undefined && !linesOf(input.description)) return null;
    if (input.timeout !== undefined && !Number.isFinite(input.timeout)) return null;
    if (!isBool(input.run_in_background) || !isBool(input.dangerouslyDisableSandbox)) return null;
    // Every field it carries is on the glass: the agent's own note about
    // it is labelled as the agent's, never stands in for the command.
    const notes = [];
    // Whitespace collapsed: a note padded to wrap can't draw a row of its own
    // that reads like one of the flag lines below it.
    if (input.description) notes.push(`Its note: ${input.description.replace(/\s+/g, " ").trim()}`);
    if (input.timeout !== undefined) notes.push(`Stops after ${input.timeout} ms`);
    if (input.run_in_background) notes.push("Runs in the background");
    if (input.dangerouslyDisableSandbox) notes.push("Runs outside the sandbox");
    if (input.run_in_background === false) notes.push("Runs in the foreground");
    if (input.dangerouslyDisableSandbox === false) notes.push("Runs in the sandbox");
    return { kind: "command", lines, notes };
  },
  Edit(input) {
    if (!only(input, ["file_path", "old_string", "new_string", "replace_all"])) return null;
    const path = linesOf(input.file_path);
    const change = changeOf(input);
    if (!path || path.length !== 1 || !path[0] || !change) return null;
    return { kind: "edit", path: path[0], ...change };
  },
  MultiEdit(input) {
    if (!only(input, ["file_path", "edits"]) || !Array.isArray(input.edits) || !input.edits.length) return null;
    const path = linesOf(input.file_path);
    if (!path || path.length !== 1 || !path[0]) return null;
    const edits = input.edits.map((e) =>
      e && typeof e === "object" && only(e, ["old_string", "new_string", "replace_all"]) ? changeOf(e) : null,
    );
    if (edits.some((e) => !e)) return null;
    return { kind: "edits", path: path[0], edits };
  },
  Write(input) {
    if (!only(input, ["file_path", "content"])) return null;
    const path = linesOf(input.file_path);
    const lines = linesOf(input.content);
    if (!path || path.length !== 1 || !path[0] || !lines) return null;
    return { kind: "write", path: path[0], lines };
  },
};

function changeOf(e) {
  const before = linesOf(e.old_string);
  const after = linesOf(e.new_string);
  if (!before || !after || !isBool(e.replace_all)) return null;
  return { before, after, all: e.replace_all === true };
}

const safeJson = (v) => {
  try {
    return JSON.stringify(v ?? {});
  } catch {
    return String(v);
  }
};

const base = (path) =>
  String(path ?? "")
    .split("/")
    .filter(Boolean)
    .pop() ?? "";

// The most of a found line the figure shows: one row of 13 px type in the
// figure's column at 1180 px, about 80 characters. Guessed from the frames.
const FOUND_CHARS = 80;

/** One line of what a look found, from its result, or "" when the result
 *  doesn't say it plainly. A search answers with its own summary ("Found 3
 *  files", "No matches found") or a list, told as its count. A file's text
 *  is not a finding, so a Read gives nothing unless it failed, and then its
 *  error is the finding. Never written by us beyond a count. */
export function foundLine(name, content, isError = false) {
  const text = typeof content === "string" ? content : "";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "";
  const clip = (l) => {
    const shown = [...l].filter((ch) => !hidden(ch)).join("");
    return shown.length > FOUND_CHARS ? `${shown.slice(0, FOUND_CHARS - 1)}…` : shown;
  };
  if (isError) return clip(lines[0]);
  if (name === "Grep" || name === "Glob") {
    // Its own summary line, as it wrote it.
    if (/^(found|no )/i.test(lines[0])) return clip(lines[0]);
    // A bare list of paths: how many.
    // (A content-mode line, path:12: or a -C context row path-12-, is not a
    // file, so it isn't counted as one.)
    if (lines.every((l) => (l.startsWith("/") || /^[\w.-]+\//.test(l)) && !/[:-]\d+[:-]/.test(l)))
      return `${lines.length} ${lines.length === 1 ? "match" : "matches"}`;
    return clip(lines[0]);
  }
  return "";
}

export function emptyStory() {
  return {
    stage: emptyStage(),
    asked: "",
    said: "",
    reads: [],
    // What a look found, one line per target, only where the transcript
    // says it in so many words (foundLine). `looking` maps a read call's id
    // to its target until its result lands.
    found: {},
    looking: {},
    lastKind: null,
    // Every request still open, oldest first: Realm can hold several at once
    // (apps/server/scripts/live-review-check.ts keeps them in a map), and
    // the glass answers the oldest. `permission` is always pending[0].
    pending: [],
    permission: null,
    failure: "",
    edited: [],
    // When the last edit was called, so a check that ran before it doesn't
    // count as proving it.
    lastEditAt: 0,
    checks: [],
    started: false,
    // The turn as one typed value (turn.mjs). The beat and the figure are
    // read from it, so neither can say a thing the turn isn't doing
    // (Daniel pass, 2026-10-11).
    agent: emptyAgent(),
  };
}

const withPending = (story, pending) => ({ ...story, pending, permission: pending[0] ?? null });

/** One event into the story, and into its typed turn. Same object back when
 *  nothing changed. */
export function tell(story, stored) {
  const next = tellStory(story, stored);
  const agent = step(story.agent ?? emptyAgent(), stored);
  if (next === story && agent === story.agent) return story;
  return { ...next, agent };
}

function tellStory(story, stored) {
  const ev = stored?.event;
  if (!ev) return story;
  const stage = reduce(story.stage, stored);
  const p = ev.payload ?? {};
  switch (ev.type) {
    case "user_message":
      return { ...emptyStory(), stage, asked: String(p.text ?? "").trim() };
    case "assistant_text":
      // Words from the agent mean the turn is under way, whatever the
      // adapter reported (one that never says `running` still started).
      return { ...story, stage, said: String(p.text ?? ""), started: true };
    case "tool_call": {
      const what = classify(p);
      const name = String(p.name ?? "");
      const kind = String(p.kind ?? "");
      if (READ_TOOLS.has(name) || kind === "read" || kind === "search") {
        const input = p.input ?? {};
        const target = String(
          input.file_path ??
            input.path ??
            input.pattern ??
            (p.paths ?? [])[0] ??
            "",
        );
        const reads = target
          ? [...story.reads.filter((r) => r !== target), target].slice(
              -MAX_READS,
            )
          : story.reads;
        const looking = target && p.toolUseId ? { ...story.looking, [p.toolUseId]: { target, name } } : story.looking;
        return { ...story, stage, reads, looking, lastKind: "read", started: true };
      }
      if (what.kind === "edit" || what.kind === "write") {
        const edited = story.edited.includes(what.path)
          ? story.edited
          : [...story.edited, what.path];
        return {
          ...story,
          stage,
          edited,
          lastKind: "change",
          lastEditAt: Number(ev.ts ?? 0),
          started: true,
        };
      }
      if (what.kind === "tests" || what.kind === "command")
        return { ...story, stage, lastKind: "prove", started: true };
      return stage === story.stage ? story : { ...story, stage };
    }
    case "tool_result": {
      const look = story.looking[p.toolUseId];
      if (look) {
        const line = foundLine(look.name, p.content, Boolean(p.isError));
        const { [p.toolUseId]: _, ...looking } = story.looking;
        const found = line ? { ...story.found, [look.target]: line } : story.found;
        return { ...story, stage, looking, found };
      }
      const call = stage.calls[p.toolUseId];
      if (call && (call.kind === "tests" || call.kind === "command")) {
        const check = {
          kind: call.kind,
          command: call.command,
          error: call.error,
          counts: call.counts ?? null,
          at: Number(call.at ?? 0),
        };
        return { ...story, stage, checks: [...story.checks, check] };
      }
      return stage === story.stage ? story : { ...story, stage };
    }
    case "permission_request": {
      const request = {
        requestId: String(p.requestId ?? ""),
        toolName: String(p.toolName ?? ""),
        title: String(p.title ?? ""),
        command: String(p.input?.command ?? p.input?.file_path ?? ""),
        question: Boolean(p.ask),
        view: permissionView(String(p.toolName ?? ""), p.input ?? {}),
      };
      const pending = [...story.pending.filter((r) => r.requestId !== request.requestId), request];
      return withPending({ ...story, stage, started: true }, pending);
    }
    case "permission_response":
      return withPending(
        { ...story, stage },
        story.pending.filter((r) => r.requestId !== p.requestId),
      );
    case "status":
      // Realm's engine reports `idle` right after `init`, before the turn
      // goes `running` (seen 2026-10-11 on the scratch engine: user_message,
      // init, status idle, status running, ...). Only a turn that ran can
      // have settled, so `started` marks the first running.
      if ((p.status === "running" || p.status === "waiting_permission") && !story.started)
        return { ...story, stage, started: true };
      // A turn that settled has nothing waiting on the person any more,
      // whatever became of the request (denied, interrupted, timed out).
      if (story.pending.length && !stage.running)
        return withPending({ ...story, stage }, []);
      return stage === story.stage ? story : { ...story, stage };
    case "error":
      return { ...story, stage, failure: String(p.message ?? "") };
    default:
      return stage === story.stage ? story : { ...story, stage };
  }
}

/** Which beat the turn is on, read from the typed turn (turn.mjs) through
 *  match(), one arm per phase: a beat the turn isn't on can't be drawn.
 *  `kept` is true once the person kept the diff; `settledFor` is how long
 *  ago the turn was seen to settle, in ms. */
export function beat(story, { kept = false, settledFor = Infinity } = {}) {
  // A request still open is his call, whatever else the turn says: realm can
  // hold several at once and the story answers the oldest.
  if (story.permission) return "call";
  const agent = story.agent ?? emptyAgent();
  const turn = agent.turn;
  // A session nobody has asked anything yet has no turn to tell. Saying
  // Done with every beat read would be a story that never happened.
  if (!turn) return "quiet";
  const settled = () => {
    if (!kept && agent.changes?.files?.length) return "call";
    // Realm measures the diff with git after the turn settles
    // (apps/server/src/sessions/service.ts, turn_changes), so a turn that
    // edited files is briefly settled with no diff yet. Holding its last beat
    // until the diff lands keeps the line from saying Done and then jumping
    // to Your call.
    if (story.edited.length && !agent.changes && settledFor < SETTLE_HOLD_MS)
      return story.lastKind === "prove" ? "proving" : "changing";
    return "done";
  };
  return match(turn, {
    asked: () => "asked",
    // A shell command after an edit is a check on the work, told as
    // proving. Before any edit it's the agent looking around: the morning
    // rehearsal, 2026-10-11, told a real Claude's opening `ls -R src; cat`
    // as "Proving" and "Checked: ls -R src ran clean".
    reading: (t) => (t.command && story.edited.length ? "proving" : "reading"),
    changing: () => "changing",
    proved: () => "proving",
    "needs-you": () => "call",
    done: settled,
    failed: () => "failed",
  });
}

/** The first sentence of an answer, without its Markdown, for a headline. */
export function firstSentence(text) {
  const plain = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(#+|[-*>]|\d+\.)\s+/gm, "")
    // Emphasis only at word edges: parse_user_id keeps its underscores.
    .replace(/(^|[^\w*])[*_]{1,3}([^*_]+?)[*_]{1,3}(?![\w*])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  const m = /^(.+?[.!?])(\s|$)/.exec(plain);
  const one = (m ? m[1] : plain).trim();
  return one.length > HEADLINE_MAX
    ? `${one.slice(0, HEADLINE_MAX - 1).trimEnd()}…`
    : one;
}

/** What proved the turn, in words, or null before anything could have. */
export function proof(story) {
  // Only what ran after the last edit proves it; a check from before the
  // change says nothing about the change.
  const after = story.checks.filter((c) => !story.edited.length || c.at >= story.lastEditAt);
  const tests = after.filter((c) => c.kind === "tests");
  const lastTest = tests[tests.length - 1];
  if (lastTest) {
    const c = lastTest.counts;
    if (c && c.failed > 0)
      return {
        tone: "bad",
        text: `Not proved: ${c.failed} ${c.failed === 1 ? "test" : "tests"} failed`,
      };
    if (lastTest.error)
      return { tone: "bad", text: "Not proved: the tests failed" };
    if (c)
      return {
        tone: "good",
        text: `Proved: ${c.passed} ${c.passed === 1 ? "test" : "tests"} passed`,
      };
    return { tone: "good", text: "Proved: the tests passed" };
  }
  // A command before any edit checked nothing the agent did.
  const checks = story.edited.length ? after.filter((c) => c.kind === "command") : [];
  const failed = checks.filter((c) => c.error);
  if (failed.length)
    return {
      tone: "bad",
      text: `Failed: ${firstWords(failed[failed.length - 1].command)}`,
    };
  if (checks.length)
    return {
      tone: "good",
      text: `Checked: ${firstWords(checks[checks.length - 1].command)} ran clean`,
    };
  if (story.stage.running) return null;
  if (story.edited.length)
    return { tone: "warn", text: "Not checked: nothing ran after the change" };
  return null;
}

const firstWords = (command) => {
  const words = String(command ?? "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
  return words || "a command";
};

// The programs a command runs, every one of them: `cd repo && rm -rf build`
// is "cd and rm", never "cd". Past three it says how many more, and the
// figure always shows the whole command.
const programsOf = (command) => {
  const names = [];
  for (const part of String(command ?? "").split(/&&|\|\||;|\||\n/)) {
    const words = part.trim().split(/\s+/).filter((w) => !/^\w+=/.test(w));
    const name = base(words[0] ?? "");
    if (name && !names.includes(name)) names.push(name);
  }
  if (!names.length) return "a command";
  if (names.length > 3) return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

const filesWord = (n) => `${n} ${n === 1 ? "file" : "files"}`;

/** Where a failed turn stopped: the beat it was on when the error came.
 *  Read from what the turn got done, since a failed turn keeps no phase of
 *  its own: a check after an edit, an edit, a read or a command, or nothing
 *  at all (the Gemini "Hello" of 10/10 died before it read a thing). */
export function failedAt(story) {
  const checkedAfter = story.edited.length && story.checks.some((c) => c.at >= story.lastEditAt);
  if (checkedAfter) return "proving";
  if (story.edited.length) return "changing";
  if (story.reads.length || story.checks.length) return "reading";
  return "asked";
}

// The most words a provider's own first sentence may have to lead the story
// as its headline. "Usage limit reached." (3) does; Gemini's 17-word "needs
// you to sign in: This client is no longer supported ..." did, and was the
// three-line headline of 10/12. Six is guessed.
const FAILED_HEADLINE_WORDS = 6;
// What a provider's sentence may hold to be shown as our headline.
const PLAIN_WORDS = /^[A-Za-z][A-Za-z ',.!?-]*$/;

const FAILED_WORDS = {
  asked: "Failed before it started",
  reading: "Failed while reading",
  changing: "Failed while changing files",
  proving: "Failed while checking",
};

/** The fault a failed turn carries, or null. */
const failedFault = (story) => {
  const t = story.agent?.turn;
  return t?.phase === "failed" ? t.fault : null;
};

/** The one sentence the glass leads with. `who` is the agent's name
 *  (Claude, Gemini), for a failure that is about the agent itself. */
export function headline(story, b = beat(story), { who = "" } = {}) {
  const st = story.stage;
  const perm = story.permission;
  if (b === "call" && perm) {
    if (perm.question)
      return firstSentence(perm.title) || "It has a question for you";
    // The program's name only: a headline that cuts a command mid-way reads
    // as the whole of it. The figure shows the command in full.
    const req = perm.view?.request ?? { kind: "raw" };
    if (req.kind === "command") return `It wants to run ${programsOf(req.lines.join("\n"))}`;
    if (req.kind === "edit" || req.kind === "edits") return `It wants to change ${base(req.path)}`;
    if (req.kind === "write") return `It wants to write ${base(req.path)}`;
    if (perm.toolName === "Bash" && perm.command) return `It wants to run ${programsOf(perm.command)}`;
    if (perm.toolName) return `It wants to use ${perm.toolName}`;
    return firstSentence(perm.title) || "It wants your OK";
  }
  // Realm says the turn is waiting on him a moment before the request
  // itself lands (the 12:33am rehearsal, frame 09: status
  // waiting_permission, then permission_request). That beat is his call
  // already, with nothing to show yet; it is never "Done".
  if (b === "call" && story.agent?.turn?.phase === "needs-you") return "It's asking for your OK";
  // A named state, never the provider's raw words: on 10/12 the glass led
  // with a three-line "Gemini needs you to sign in: This client is no
  // longer supported ..." The raw words are the call's small print.
  if (b === "failed") {
    if (failedFault(story)?.name === "signed-out") return `${who || "This agent"} can't sign in`;
    // A short first sentence is its own name ("Usage limit reached.");
    // anything longer is small print.
    const first = firstSentence(story.failure);
    // A usage limit is named: the provider's own line came through on the
    // 10/12 evening rehearsal as "Claude AI usage limit reached|1788555903",
    // a reset timestamp glued on with a pipe, in 40 pt type.
    if (/usage limit/i.test(story.failure ?? "")) return `${who || "It"} hit ${who ? "its" : "a"} usage limit`;
    // Only plain words are ever the headline: no pipes, codes, paths or links.
    return first && first.split(/\s+/).length <= FAILED_HEADLINE_WORDS && PLAIN_WORDS.test(first)
      ? first
      : "It stopped with an error";
  }
  if (b === "reading") {
    const last = story.reads[story.reads.length - 1];
    const name = base(last) || last;
    if (name) return `Reading ${name}`;
    const cmd = st.command?.command;
    return cmd ? `Looking around with ${firstWords(cmd)}` : "Reading";
  }
  if (b === "changing") {
    const path = st.file?.path ?? story.edited[story.edited.length - 1];
    return path ? `Changing ${base(path)}` : "Changing files";
  }
  if (b === "proving") {
    if (st.tests && !st.tests.done) return "Running the tests";
    const cmd = st.command?.command ?? st.tests?.command;
    return cmd ? `Checking with ${firstWords(cmd)}` : "Checking its work";
  }
  if (b === "asked") return "Starting on it";
  if (b === "quiet") return "Nothing asked yet";
  const said = firstSentence(story.said);
  if (said) return said;
  const n = st.changes?.files?.length ?? story.edited.length;
  return n ? `Changed ${filesWord(n)}` : "Done";
}

/** The one decision waiting on the person, or null. Every call is one short
 *  line and its presses, each press with the key that does it (`key`, drawn
 *  as a hint on the button; Story.tsx binds them).
 *
 *  A failed turn is one line and ONE press. On 10/12 the call under "Gemini
 *  can't sign in" said it three times (headline, a 14-word line, three lines
 *  of the provider's raw words) and offered two presses; every shipped app
 *  studied says it once with one action (Realm's Sign in, Cursor's Try
 *  again, Linear's Reload, ux-universe-report.md, steal list 9). The raw
 *  words are one press away, in the transcript. */
export function decision(story, { kept = false, who = "" } = {}) {
  const f = failedFault(story);
  if (f && !story.permission) {
    if (f.name === "signed-out")
      // Claude's own login dying can't be answered with "use Claude": his
      // transcript's install card has Sign in.
      return who === "Claude"
        ? { kind: "failed", line: "Claude needs to sign in again.", verbs: [{ id: "answer", text: "Sign Claude in", key: "\u21b5" }] }
        : {
            kind: "failed",
            line: `${who || "Its"}${who ? "'s" : ""} login is dead. Claude can do this.`,
            verbs: [{ id: "new", text: "Use Claude instead", key: "\u21b5" }],
          };
    return {
      kind: "failed",
      line: "The whole error is in the transcript.",
      verbs: [{ id: "answer", text: "Read the error", key: "\u21b5" }],
    };
  }
  const perm = story.permission;
  if (perm) {
    if (perm.question)
      return {
        kind: "question",
        line: "It's waiting on your answer",
        verbs: [{ id: "answer", text: "Answer it", key: "\u21b5" }],
      };
    // Allow is offered only when the whole request is on the glass, and the
    // button never carries a shortened command: what runs is in the figure,
    // in full. Otherwise the press is his own card in the transcript.
    if (!perm.view?.exact) {
      return {
        kind: "permission",
        requestId: perm.requestId,
        line: "This request is too long to show here, or hides characters. Read it in full first.",
        verbs: [
          { id: "answer", text: "Read it in the transcript", key: "\u21b5" },
          { id: "deny", text: "Deny", key: "\u2318\u232b" },
        ],
      };
    }
    return {
      kind: "permission",
      requestId: perm.requestId,
      // Seven words: the needs-you story was 49 words with the ten-word
      // line it had (realm-morning-verify.md, 10/12), over the 45 a block
      // may hold on first view.
      // Never "on the right": below 1000 pt the story is one column and the
      // request sits above the call (10/12 evening frames, 1246 screen).
      line: "Allow runs exactly what's shown.",
      // Three labeled choices, each with its key, as Realm's own card and
      // every app studied draw it (Claude.app, Cursor, Codex, the Claude
      // Code extension; steal list 8). Allow always is his engine's own
      // `allow_always` (contracts rpc.ts, sessions.respondPermission).
      verbs: [
        { id: "allow", text: "Allow", key: "\u21b5" },
        { id: "allow_always", text: "Always allow", key: "\u21e7\u21b5" },
        { id: "deny", text: "Deny", key: "\u2318\u232b" },
      ],
    };
  }
  const n = story.stage.changes?.files?.length ?? 0;
  if (!story.stage.running && n && !kept) {
    return {
      kind: "review",
      line: `${filesWord(n)} changed. Reject any one, or keep them all.`,
      verbs: [{ id: "keep", text: `Keep all ${filesWord(n)}`, key: "\u21b5" }],
    };
  }
  return null;
}

/** Which object the figure shows. One at a time, like Lemma's panels. The
 *  file, the command and the tests are the typed turn's own, so "file" is
 *  only ever said while the turn holds a file to show. */
export function figure(story, b = beat(story)) {
  if (b === "call" && story.permission)
    return story.permission.question ? "none" : "permission";
  // Your call with no request in hand is the diff to review, and only once
  // realm has measured it: a review figure with no changes behind it draws
  // an empty box (frame 09 of the 12:33am rehearsal).
  const agent = story.agent ?? emptyAgent();
  if (b === "call" && agent.changes?.files?.length) return "review";
  // Waiting on him with the request not in hand yet: the figure stays on the
  // object of the beat it paused, so that moment is never an empty screen.
  const turn = agent.turn?.phase === "needs-you" ? agent.turn.resume : agent.turn;
  if (b === "call" && turn?.phase === "asked") return "none";
  if (!turn) return "none";
  const changed = () =>
    agent.changes?.files?.length || story.edited.length ? "changed" : "none";
  return match(turn, {
    asked: () => "none",
    reading: (t) => (t.command ? "command" : story.reads.length ? "reads" : "none"),
    changing: () => "file",
    proved: () => "tests",
    "needs-you": () => "none",
    done: changed,
    failed: changed,
  });
}

/** The beat line's state per word: read, lit or ahead. A failed turn reads
 *  up to the beat it died on, which is drawn as the failure, and nothing
 *  past it: on 10/12 every beat sat grey ahead of a turn that never read a
 *  thing, and a red "Failed" wrapped onto a line of its own as a bare bar. */
export function beatLine(b, story = null) {
  if (b === "quiet") return [];
  if (b === "failed") {
    const where = story ? failedAt(story) : "asked";
    const at = BEATS.indexOf(where);
    return [
      ...BEATS.slice(0, at).map((id) => ({ id, word: BEAT_WORDS[id], state: "read" })),
      { id: "failed", word: FAILED_WORDS[where], state: "failed" },
    ];
  }
  const at = BEATS.indexOf(b);
  return BEATS.map((id, i) => ({
    id,
    word: BEAT_WORDS[id],
    state: i < at ? "read" : i === at ? "lit" : "ahead",
  }));
}

/** A whole turn from history: the last user message on. */
export function fromHistory(list) {
  let start = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.event?.type === "user_message") {
      start = i;
      break;
    }
  }
  let s = emptyStory();
  for (const ev of list.slice(start)) s = tell(s, ev);
  return s;
}

// How long after a call appears its keys do nothing. Claude.app ignores its
// permission keys for 400 ms after the card shows and on key repeat
// (ux-universe-report.md, steal list 8): a Return pressed for the composer a
// beat before the request landed must never become Allow. Their number,
// never measured here.
export const KEY_GUARD_MS = 400;

/** The verb a key answers on the story's call, or null. Return is the
 *  call's first press, Shift+Return its second (Always allow), Cmd+Delete is
 *  Deny, and 1 to 9 are the presses in order, as the hints on the buttons
 *  say. Nothing within KEY_GUARD_MS of the call appearing, nothing on a held
 *  key's repeat, nothing with Ctrl or Alt held. */
export function callKey(call, { key, shift = false, meta = false, ctrl = false, alt = false, repeat = false, sinceShown = Infinity }) {
  if (!call || repeat || ctrl || alt || sinceShown < KEY_GUARD_MS) return null;
  const want =
    key === "Enter" && !meta ? (shift ? "⇧↵" : "↵") : key === "Backspace" && meta && !shift ? "⌘⌫" : null;
  if (want) return call.verbs.find((v) => v.key === want)?.id ?? null;
  if (!meta && !shift && /^[1-9]$/.test(key)) return call.verbs[Number(key) - 1]?.id ?? null;
  return null;
}
