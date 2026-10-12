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
  };
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

export function emptyStory() {
  return {
    stage: emptyStage(),
    asked: "",
    said: "",
    reads: [],
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
  };
}

const withPending = (story, pending) => ({ ...story, pending, permission: pending[0] ?? null });

/** One event into the story. Same object back when nothing changed. */
export function tell(story, stored) {
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
        return { ...story, stage, reads, lastKind: "read", started: true };
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

/** Which beat the turn is on. `kept` is true once the person kept the diff;
 *  `settledFor` is how long ago the turn was seen to settle, in ms. */
export function beat(story, { kept = false, settledFor = Infinity } = {}) {
  const st = story.stage;
  if (story.permission) return "call";
  // A session nobody has asked anything yet has no turn to tell. Saying
  // Done with every beat read would be a story that never happened.
  if (!story.asked && !st.running && !story.said && !story.failure) return "quiet";
  if (story.asked && !story.started && !st.running && !story.failure) return "asked";
  if (st.status === "error" || (story.failure && !st.running)) return "failed";
  if (st.running) {
    if (st.status === "waiting_permission") return "call";
    if (story.lastKind === "prove") return "proving";
    if (story.lastKind === "change") return "changing";
    if (story.lastKind === "read") return "reading";
    return "asked";
  }
  if (!kept && st.changes?.files?.length) return "call";
  // Realm measures the diff with git after the turn settles
  // (apps/server/src/sessions/service.ts, turn_changes), so a turn that edited
  // files is briefly settled with no diff yet. Holding its last beat until the
  // diff lands keeps the line from saying Done and then jumping to Your call.
  if (story.edited.length && !st.changes && settledFor < SETTLE_HOLD_MS) {
    return story.lastKind === "prove" ? "proving" : "changing";
  }
  return "done";
}

/** The first sentence of an answer, without its Markdown, for a headline. */
export function firstSentence(text) {
  const plain = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(#+|[-*>]|\d+\.)\s+/gm, "")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
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
  const checks = after.filter((c) => c.kind === "command");
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

/** The one sentence the glass leads with. */
export function headline(story, b = beat(story)) {
  const st = story.stage;
  const perm = story.permission;
  if (b === "call" && perm) {
    if (perm.question)
      return firstSentence(perm.title) || "It has a question for you";
    // The program's name only: a headline that cuts a command mid-way reads
    // as the whole of it. The figure shows the command in full.
    if (perm.toolName === "Bash" && perm.command) return `It wants to run ${programsOf(perm.command)}`;
    if (perm.toolName) return `It wants to use ${perm.toolName}`;
    return firstSentence(perm.title) || `It wants to use ${perm.toolName}`;
  }
  if (b === "failed")
    return firstSentence(story.failure) || "It stopped with an error";
  if (b === "reading") {
    const last = story.reads[story.reads.length - 1];
    const name = base(last) || last;
    return name ? `Reading ${name}` : "Reading";
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

/** The one decision waiting on the person, or null. */
export function decision(story, { kept = false } = {}) {
  const perm = story.permission;
  if (perm) {
    if (perm.question)
      return {
        kind: "question",
        line: "It's waiting on your answer",
        verbs: [{ id: "answer", text: "Answer it" }],
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
          { id: "answer", text: "Read it in the transcript" },
          { id: "deny", text: "Deny" },
        ],
      };
    }
    return {
      kind: "permission",
      requestId: perm.requestId,
      line: `Allow lets ${perm.toolName} run with exactly what's on the right.`,
      verbs: [
        { id: "allow", text: "Allow" },
        { id: "deny", text: "Deny" },
      ],
    };
  }
  const n = story.stage.changes?.files?.length ?? 0;
  if (!story.stage.running && n && !kept) {
    return {
      kind: "review",
      line: `${filesWord(n)} changed. Reject any change on the right, or keep them all.`,
      verbs: [{ id: "keep", text: `Keep all ${filesWord(n)}` }],
    };
  }
  return null;
}

/** Which object the figure shows. One at a time, like Lemma's panels. */
export function figure(story, b = beat(story)) {
  const st = story.stage;
  if (b === "call" && story.permission)
    return story.permission.question ? "none" : "permission";
  if (b === "call") return "review";
  if (b === "reading") return story.reads.length ? "reads" : "none";
  if (b === "changing") return st.file ? "file" : "none";
  if (b === "proving")
    return st.tests && (!st.command || st.tests.at >= st.command.at)
      ? "tests"
      : st.command
        ? "command"
        : "none";
  if (b === "done" || b === "failed")
    return st.changes?.files?.length || story.edited.length
      ? "changed"
      : "none";
  return "none";
}

/** The beat line's state per word: read, lit or ahead. */
export function beatLine(b) {
  if (b === "quiet") return [];
  const at = b === "failed" ? BEATS.length : BEATS.indexOf(b);
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
