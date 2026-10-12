// One agent turn as a typed state machine, for Realm on the Chewbacca glass.
//
// Realm is Carlton Aikins' agent workspace (github.com/31Carlton7/realm); his
// renderer runs unmodified and this file is part of our layer over it
// (bin/lib/realm_ui/glass). Pure, so node --test holds it.
//
// Daniel Thomas on Chewbacca, 2026-10-11: "oddly similar to rust's design
// philosophy", and "how does it mitigate context rot especially related to
// the sheer number of tasks". Caleb, the same night: "Make this how daniel
// thomas would". So the glass draws from one value per agent, and the states
// it must never show can't be built:
//
//   - every phase carries exactly the data it draws: a "changing" turn with
//     no file, or a review with no hunk, throws at construction;
//   - "done" is only reached from the engine saying the turn settled, so a
//     tab whose turn is still running can't read Done;
//   - every move between phases is listed in NEXT; a move that isn't is
//     refused as a value (step returns `refused`), never applied;
//   - match() makes a caller name every phase. A new phase with no arm
//     throws on the first call instead of falling into a default branch.
//
// Failures are values too (FAULTS): a name, what happened, and the one thing
// to do. And only the current turn is ever held whole. A finished turn folds
// into one line, and only the newest FOLD_KEEP lines are kept, so twenty
// agents with two hundred turns each cost what one agent with six does.
import { classify, testCounts } from "./model.mjs";

export const PHASES = Object.freeze([
  "asked",
  "reading",
  "changing",
  "proved",
  "needs-you",
  "done",
  "failed",
]);

const WORKING = Object.freeze(["reading", "changing", "proved"]);
const LIVE = Object.freeze([...WORKING, "needs-you", "done", "failed"]);

/** Every move a turn may make. A settled turn (done, failed) moves nowhere:
 *  the next message starts a new turn at asked. */
export const NEXT = Object.freeze({
  asked: LIVE,
  reading: LIVE,
  changing: LIVE,
  proved: LIVE,
  "needs-you": LIVE,
  done: Object.freeze([]),
  failed: Object.freeze([]),
});

/** Run the arm for `turn.phase`. Every phase needs an arm and no arm may name
 *  a phase that doesn't exist, so adding a phase breaks every caller loudly
 *  instead of drawing whatever a default branch happened to draw. */
export function match(turn, arms) {
  for (const p of PHASES)
    if (typeof arms?.[p] !== "function")
      throw new TypeError(`match: no arm for "${p}"`);
  for (const k of Object.keys(arms))
    if (!PHASES.includes(k))
      throw new TypeError(`match: "${k}" is not a phase`);
  const arm = arms[turn?.phase];
  if (!arm) throw new TypeError(`match: "${turn?.phase}" is not a phase`);
  return arm(turn);
}

// ---------------------------------------------------------------- faults

/** Every way the glass can fail: what happened, and the one thing to do.
 *  A fault with no entry here can't be built, so none is ever wordless. */
export const FAULTS = Object.freeze({
  "engine-down": Object.freeze({
    what: "Realm's engine isn't answering.",
    fix: "Press Retry. If it stays down, say restart realm.",
    retry: true,
  }),
  "timed-out": Object.freeze({
    what: "The engine took too long to answer.",
    fix: "Press Retry.",
    retry: true,
  }),
  "file-unreadable": Object.freeze({
    what: "That file couldn't be read.",
    fix: "Open it in the workspace to see why.",
    retry: true,
  }),
  "diff-unreadable": Object.freeze({
    what: "This turn's changes couldn't be read.",
    fix: "Press Retry, or open Changes in the workspace.",
    retry: true,
  }),
  "git-refused": Object.freeze({
    what: "Git refused that.",
    fix: "Open Changes in the workspace and settle it there.",
    retry: false,
  }),
  "tab-unreadable": Object.freeze({
    what: "Its tab couldn't be read, so where it is isn't known.",
    fix: "Open it to see.",
    retry: true,
  }),
  stalled: Object.freeze({
    what: "Its turn hasn't written anything for 15 minutes.",
    fix: "Open it and stop it or nudge it.",
    retry: false,
  }),
  "agent-error": Object.freeze({
    what: "The agent stopped with an error.",
    fix: "Open it, read the error, and ask again.",
    retry: false,
  }),
  "voice-dropped": Object.freeze({
    what: "The talk key lost its line to this page.",
    fix: "It reconnects by itself. Say it again in a few seconds.",
    retry: false,
  }),
});

/** A named failure. `detail` is what the system itself said, kept short;
 *  `fix` overrides the stock one when the engine names a better one
 *  (realm's error event carries `fix` for an auth failure it verified). */
export function fault(name, detail = "", fix = "") {
  const f = FAULTS[name];
  if (!f) throw new TypeError(`fault: "${name}" has no words in FAULTS`);
  return Object.freeze({
    name,
    what: f.what,
    fix: String(fix || f.fix),
    retry: f.retry,
    detail: String(detail ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200),
  });
}

/** A Result, Rust's: `{ ok: true, value }` or `{ ok: false, fault }`. */
export const ok = (value) => Object.freeze({ ok: true, value });
export const err = (name, detail, fix) =>
  Object.freeze({ ok: false, fault: fault(name, detail, fix) });

/** Settle a promise into a Result within `ms`. A call that never answers
 *  becomes a timed-out fault, never a spinner that runs forever; a rejection
 *  becomes the fault `name`. */
export function settle(promise, name, ms, timer = globalThis) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      timer.clearTimeout(t);
      resolve(r);
    };
    const t = timer.setTimeout(
      () => finish(err("timed-out", `${name}: no answer in ${ms} ms`)),
      ms,
    );
    Promise.resolve(promise).then(
      (value) => finish(ok(value)),
      (e) => finish(err(name, e?.message ?? String(e))),
    );
  });
}

// ---------------------------------------------------------------- the turn

const words = (v) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
const need = (cond, what) => {
  if (!cond) throw new TypeError(what);
};
const base = (p) =>
  String(p ?? "")
    .split("/")
    .filter(Boolean)
    .pop() ?? "";

/** The constructors, one per phase. Each refuses the data its phase can't be
 *  drawn without, so the invalid turn never exists to be drawn. */
export const Turn = Object.freeze({
  asked: (ask, at = 0) =>
    Object.freeze({ phase: "asked", ask: words(ask), at }),
  // `command` is the shell command it is running, or null for a plain read.
  reading: (ask, what, at = 0, command = null) => {
    need(words(what), "reading: needs what it is reading");
    need(command === null || words(command.command), "reading: a command needs its text");
    return Object.freeze({
      phase: "reading",
      ask: words(ask),
      what: words(what),
      command: command && Object.freeze({ ...command }),
      at,
    });
  },
  changing: (ask, file, at = 0) => {
    need(file && words(file.path), "changing: needs the file it changes");
    return Object.freeze({
      phase: "changing",
      ask: words(ask),
      file: Object.freeze({ ...file, path: words(file.path) }),
      at,
    });
  },
  proved: (ask, tests, at = 0) => {
    need(tests && words(tests.command), "proved: needs the tests it ran");
    return Object.freeze({
      phase: "proved",
      ask: words(ask),
      tests: Object.freeze({ ...tests }),
      at,
    });
  },
  needsYou: (ask, question, resume, at = 0) => {
    need(words(question), "needs-you: needs the question");
    need(
      resume && ["asked", ...WORKING].includes(resume.phase),
      "needs-you: needs the working turn it pauses",
    );
    return Object.freeze({
      phase: "needs-you",
      ask: words(ask),
      question: words(question),
      resume,
      at,
    });
  },
  done: (
    ask,
    { said = "", tests = null, review = null, stopped = false } = {},
    at = 0,
  ) => {
    need(
      review === null ||
        (Array.isArray(review.files) &&
          review.files.length > 0 &&
          review.files.every((f) => f.hunks?.length > 0)),
      "done: a review needs a file with a hunk",
    );
    return Object.freeze({
      phase: "done",
      ask: words(ask),
      said: words(said),
      tests,
      review,
      stopped,
      at,
    });
  },
  failed: (ask, f, at = 0) => {
    need(f && FAULTS[f.name], "failed: needs a named fault");
    return Object.freeze({ phase: "failed", ask: words(ask), fault: f, at });
  },
});

/** A review: the settled turn's diff, holding only files with a hunk and
 *  only hunks with a changed line. null when nothing is left, so a Keep has
 *  nothing to hang on and is never drawn. */
export function reviewOf(root, files) {
  const kept = (files ?? [])
    .map((f) => ({
      path: words(f?.path),
      hunks: (f?.hunks ?? []).filter((h) =>
        (h?.lines ?? []).some((l) => l?.kind === "add" || l?.kind === "del"),
      ),
    }))
    .filter((f) => f.path && f.hunks.length);
  return kept.length ? Object.freeze({ root: words(root), files: kept }) : null;
}

/** Still going? Only done and failed are settled. */
export const isRunning = (turn) =>
  match(turn, {
    asked: () => true,
    reading: () => true,
    changing: () => true,
    proved: () => true,
    "needs-you": () => true,
    done: () => false,
    failed: () => false,
  });

/** The word a tile and the beat line say for a phase. */
export const word = (turn) =>
  match(turn, {
    asked: () => "Starting",
    reading: () => "Reading",
    changing: () => "Changing",
    proved: (t) =>
      t.tests.done
        ? t.tests.error || t.tests.counts?.failed
          ? "Tests failed"
          : "Proved"
        : "Testing",
    "needs-you": () => "Needs you",
    done: (t) => (t.stopped ? "Stopped" : "Done"),
    failed: () => "Failed",
  });

/** The tone a tile is painted in. */
export const tone = (turn) =>
  match(turn, {
    asked: () => "running",
    reading: () => "running",
    changing: () => "running",
    proved: () => "running",
    "needs-you": () => "needs",
    done: () => "done",
    failed: () => "failed",
  });

/** The one line a turn is, once it's no longer the current one. */
export const foldLine = (turn) => {
  const ask = clip(turn.ask || "(no message)", FOLD_CHARS - 12);
  return match(turn, {
    asked: () => `${ask}: started`,
    reading: () => `${ask}: reading`,
    changing: (t) => `${ask}: changing ${base(t.file.path)}`,
    proved: () => `${ask}: testing`,
    "needs-you": () => `${ask}: needed you`,
    done: (t) =>
      `${ask}: ${t.stopped ? "stopped" : t.review ? `${t.review.files.length} changed` : "done"}`,
    failed: (t) => `${ask}: failed, ${t.fault.name}`,
  });
};

// One folded line is one glance: Lemma's captions run 6 to 14 words, and 90
// characters is about 15 at the tile's 13 px (the same cut nowLine uses in
// model.mjs). Guessed against that, never measured with Caleb.
export const FOLD_CHARS = 90;
// How many folded turns a focused agent keeps, newest first. Five is what the
// story column holds under its headline at 14 px without scrolling on the
// 1180 point realm surface; older ones are a count, "N earlier".
export const FOLD_KEEP = 5;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------------------------------------------------------------- stepping

/** One agent's state: its current turn, the calls in flight, and its older
 *  turns folded to one line each (newest first, at most FOLD_KEEP) with a
 *  count of the rest. Nothing in here grows with the number of turns. */
export function emptyAgent() {
  return Object.freeze({
    turn: null,
    inflight: Object.freeze({}),
    said: "",
    changes: null,
    lastTests: null,
    folded: Object.freeze([]),
    earlier: 0,
    trail: Object.freeze([]),
    trailEarlier: 0,
    // Whether this turn has begun. Realm writes `status: idle` between the
    // message and the first `running` (user_message, init, idle, running on
    // the fake agent, 2026-10-11), and that idle is not the turn settling.
    started: false,
    refused: null,
  });
}

// What a finished command or test run keeps of its output: the last ten
// lines (the stage's command card showed ten before, GlassLayer.tsx), each
// cut at 200 characters, and the first six failing lines of a test run.
// Bounded so a 40 MB log costs the same as a one-line one. The counts are
// the old stage's (GlassLayer.tsx before 2026-10-11); guessed, never
// measured with Caleb.
const TAIL_LINES = 10;
const FAILING_KEEP = 6;
const LINE_CHARS = 200;
const FAILED_LINE = /FAIL|not ok|Error|\bfailed\b/;
const lastLines = (text, n) =>
  text
    .slice(-64 * 1024)
    .split("\n")
    .filter((l) => l.trim())
    .slice(-n)
    .map((l) => clip(l, LINE_CHARS));

/** The one line a beat is once the turn has moved past it, or null for a
 *  beat that says nothing on its own (asked) or never gets passed (done). */
export const beatLine = (t) =>
  match(t, {
    asked: () => null,
    reading: (x) =>
      clip(x.command ? `${x.command.error ? "Failed" : "Ran"} ${x.what}` : `Read ${x.what}`, FOLD_CHARS),
    changing: (x) => clip(`${x.file.error ? "Edit failed in" : "Changed"} ${base(x.file.path)}`, FOLD_CHARS),
    proved: (x) => {
      const c = x.tests.counts;
      return c
        ? `Tests: ${c.passed} passed${c.failed ? `, ${c.failed} failed` : ""}`
        : x.tests.error
          ? "Tests failed"
          : "Tests ran";
    },
    "needs-you": (x) => clip(`Asked you: ${x.question}`, FOLD_CHARS),
    done: () => null,
    failed: () => null,
  });

/** The beat the turn is on, as a key: a new key is a new beat. */
const beatKey = (t) =>
  match(t, {
    asked: () => "asked",
    reading: (x) => `reading:${x.what}`,
    changing: (x) => `changing:${x.file.path}`,
    proved: (x) => `proved:${x.tests.id ?? x.tests.command}`,
    "needs-you": () => "needs-you",
    done: () => "done",
    failed: () => "failed",
  });

const STARTS = new Set(["status", "tool_call", "assistant_text", "permission_request", "error"]);
const READ_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "NotebookRead",
  "WebFetch",
  "WebSearch",
]);

/** Move to `next` if NEXT allows it; otherwise keep the turn and say so. */
function go(agent, next, extra = {}) {
  const from = agent.turn;
  if (!NEXT[from.phase].includes(next.phase))
    return Object.freeze({
      ...agent,
      ...extra,
      refused: `${from.phase} -> ${next.phase}`,
    });
  const moved = beatKey(from) !== beatKey(next) ? beatLine(from) : null;
  if (!moved) return Object.freeze({ ...agent, ...extra, turn: next, refused: null });
  // The beat it left folds to one line; only the newest FOLD_KEEP are kept.
  const trail = [moved, ...agent.trail];
  return Object.freeze({
    ...agent,
    ...extra,
    turn: next,
    refused: null,
    trail: Object.freeze(trail.slice(0, FOLD_KEEP)),
    trailEarlier: agent.trailEarlier + Math.max(0, trail.length - FOLD_KEEP),
  });
}
const same = (agent) =>
  agent.refused === null ? agent : Object.freeze({ ...agent, refused: null });

/** One realm session event (`{seq, event: {type, ts, payload}}`) into the
 *  agent. The same object back when nothing changed. A move NEXT doesn't
 *  allow comes back as `refused` with the turn untouched. */
export function step(agent, stored) {
  const ev = stored?.event;
  if (!ev) return agent;
  const p = ev.payload ?? {};
  const at = Number(ev.ts ?? 0);

  if (ev.type === "user_message") {
    const prev = agent.turn;
    const folded = prev ? [foldLine(prev), ...agent.folded] : [...agent.folded];
    const over = Math.max(0, folded.length - FOLD_KEEP);
    return Object.freeze({
      ...emptyAgent(),
      turn: Turn.asked(p.text, at),
      folded: Object.freeze(folded.slice(0, FOLD_KEEP)),
      earlier: agent.earlier + over,
    });
  }
  const turn = agent.turn;
  if (!turn) return agent;
  if (!agent.started && STARTS.has(ev.type) && (ev.type !== "status" || p.status === "running" || p.status === "waiting_permission"))
    agent = Object.freeze({ ...agent, started: true });

  switch (ev.type) {
    case "tool_call": {
      const what = classify(p);
      const id = String(p.toolUseId ?? "");
      const name = String(p.name ?? "");
      const track = (k) =>
        id ? Object.freeze({ ...agent.inflight, [id]: k }) : agent.inflight;
      if ((what.kind === "edit" || what.kind === "write") && words(what.path))
        return go(
          agent,
          Turn.changing(
            turn.ask,
            {
              id,
              path: what.path,
              kind: what.kind,
              edits: what.edits ?? [],
              text: what.text ?? null,
              done: false,
              error: false,
            },
            at,
          ),
          { inflight: track("file") },
        );
      if (what.kind === "tests")
        return go(
          agent,
          Turn.proved(
            turn.ask,
            {
              id,
              command: what.command,
              done: false,
              error: false,
              counts: null,
            },
            at,
          ),
          { inflight: track("tests") },
        );
      if (what.kind === "command" && words(what.command))
        return go(
          agent,
          Turn.reading(turn.ask, what.label || what.command, at, {
            id,
            command: what.command,
            label: what.label,
            done: false,
            error: false,
            tail: [],
          }),
          { inflight: track("command") },
        );
      if (READ_TOOLS.has(name) || p.kind === "read" || p.kind === "search") {
        const target = words(
          p.input?.file_path ?? p.input?.path ?? p.input?.pattern ?? "",
        );
        return go(
          agent,
          Turn.reading(turn.ask, base(target) || target || name, at),
          { inflight: track("read") },
        );
      }
      return same(agent);
    }
    case "tool_result": {
      const id = String(p.toolUseId ?? "");
      if (!(id in agent.inflight)) return same(agent);
      const { [id]: _gone, ...rest } = agent.inflight;
      const inflight = Object.freeze(rest);
      const error = Boolean(p.isError);
      if (turn.phase === "changing" && turn.file.id === id)
        return Object.freeze({
          ...agent,
          inflight,
          refused: null,
          turn: Turn.changing(
            turn.ask,
            { ...turn.file, done: true, error },
            turn.at,
          ),
        });
      const output = String(p.content ?? "");
      if (turn.phase === "reading" && turn.command?.id === id)
        return Object.freeze({
          ...agent,
          inflight,
          refused: null,
          turn: Turn.reading(turn.ask, turn.what, turn.at, {
            ...turn.command,
            done: true,
            error,
            tail: lastLines(output, TAIL_LINES),
          }),
        });
      if (turn.phase === "proved" && turn.tests.id === id) {
        const tests = {
          ...turn.tests,
          done: true,
          error,
          counts: testCounts(output),
          failing: output
            .split("\n")
            .filter((l) => FAILED_LINE.test(l))
            .slice(0, FAILING_KEEP)
            .map((l) => clip(l, LINE_CHARS)),
        };
        return Object.freeze({
          ...agent,
          inflight,
          refused: null,
          lastTests: tests,
          turn: Turn.proved(turn.ask, tests, turn.at),
        });
      }
      return Object.freeze({ ...agent, inflight, refused: null });
    }
    case "permission_request": {
      if (turn.phase === "needs-you") return same(agent);
      const q =
        words(p.title) ||
        (p.toolName ? `It wants to use ${p.toolName}` : "It's waiting on you");
      return go(agent, Turn.needsYou(turn.ask, q, turn, at));
    }
    case "permission_response":
      return turn.phase === "needs-you" ? go(agent, turn.resume) : same(agent);
    case "assistant_text":
      return Object.freeze({
        ...agent,
        said: String(p.text ?? ""),
        refused: null,
      });
    case "error":
      return go(
        agent,
        Turn.failed(turn.ask, fault("agent-error", p.message, p.fix?.hint), at),
        { inflight: Object.freeze({}) },
      );
    case "status": {
      const s = p.status;
      if (s === "running")
        return turn.phase === "needs-you"
          ? go(agent, turn.resume)
          : same(agent);
      if (s === "waiting_permission")
        return turn.phase === "needs-you"
          ? same(agent)
          : go(agent, Turn.needsYou(turn.ask, "It's waiting on you", turn, at));
      if (s === "error")
        return turn.phase === "failed"
          ? same(agent)
          : go(
              agent,
              Turn.failed(turn.ask, fault("agent-error", p.message), at),
              { inflight: Object.freeze({}) },
            );
      // idle or ended: the engine says the turn settled, once it has begun.
      if (!isRunning(turn) || !agent.started) return same(agent);
      return go(
        agent,
        Turn.done(
          turn.ask,
          {
            said: agent.said,
            tests: agent.lastTests,
            stopped: Boolean(p.interrupted),
          },
          at,
        ),
        { inflight: Object.freeze({}) },
      );
    }
    case "turn_changes":
      // Paths only. The review is attached once its hunks are read
      // (withReview), since a path is not yet a hunk anyone can Keep.
      return Object.freeze({
        ...agent,
        refused: null,
        changes: Object.freeze({
          root: String(p.root ?? ""),
          files: (p.files ?? []).map((f) =>
            Object.freeze({
              path: String(f?.path ?? ""),
              additions: f?.additions ?? null,
              deletions: f?.deletions ?? null,
            }),
          ),
          checkpointId: String(p.checkpointId ?? ""),
          afterTree: String(p.afterTree ?? ""),
        }),
      });
    default:
      return same(agent);
  }
}

/** Attach a review to a settled turn. A review with no hunk left (all kept,
 *  committed or put back) is null, and the turn is plain done. */
export function withReview(agent, review) {
  const t = agent.turn;
  if (!t || t.phase !== "done") return agent;
  return Object.freeze({
    ...agent,
    turn: Turn.done(
      t.ask,
      { said: t.said, tests: t.tests, stopped: t.stopped, review },
      t.at,
    ),
  });
}

/** A turn the glass knows only from its Claude Code tab's transcript
 *  (tab_truth.mjs): a tab realm imported but doesn't run. A tab that couldn't
 *  be read is a fault, never Done. */
export function turnFromTruth(truth, title = "") {
  const at = truth?.lastAt ?? 0;
  if (truth?.state === "running") return Turn.asked(title, at);
  if (truth?.state === "stopped") return Turn.failed(title, fault("stalled"), at);
  if (truth?.state === "done") return Turn.done(title, {}, at);
  if (truth?.state === "unreadable") return Turn.failed(title, fault("tab-unreadable", truth.detail), at);
  throw new TypeError(`turnFromTruth: "${truth?.state}" is not a tab state`);
}

/** The turn a tile draws for a session. Realm's own live turn when it ran
 *  the session; otherwise its tab's transcript, when it has one; otherwise
 *  realm's stored status. Never Done for a turn anything says is running.
 *  null for an imported tab whose transcript hasn't been asked yet: realm's
 *  row says idle for a tab mid-turn in another window (the "Done 5m" on all
 *  nine tiles, 2026-10-11 8:25pm), so the tile waits for the first answer
 *  (49 ms for twelve tabs cold, realm-tiles-truth-report.md) instead. */
export function tileTurn(session, agent, truth, truthAsked) {
  if (agent?.turn) return agent.turn;
  const title = session?.title ?? "";
  const s = session?.status;
  if (s === "waiting_permission") return Turn.needsYou(title, "It's waiting on you", Turn.asked(title));
  if (s === "running") return Turn.asked(title, session.updatedAt ?? 0);
  if (s === "error") return Turn.failed(title, fault("agent-error"));
  if (session?.providerSessionId) {
    if (!truthAsked) return null;
    // null: no transcript on this Mac (a Codex session), so realm's own
    // stored status is the only word there is.
    if (truth) return turnFromTruth(truth, title);
  }
  return Turn.done(title, {}, session?.updatedAt ?? 0);
}

// ---------------------------------------------------------------- at rest

// The most tiles drawn at once: a 3 x 3 field fits the realm surface's 1180
// points with Carlton's card padding (GlassLayer.tsx, MAX_TILES, guessed).
export const MAX_TILES = 9;
// What's waiting on him, listed above the field: three is what fits one line
// of the 1180 point surface at the tile's 13 px; the rest are a count. Guessed.
export const WAIT_KEEP = 3;

const rank = (t) => {
  const k = tone(t);
  return k === "needs" ? 0 : k === "failed" ? 1 : k === "running" ? 2 : 3;
};
const lineOf = (t) =>
  clip(
    match(t, {
      asked: (x) => x.ask,
      reading: (x) => `Reading ${x.what}`,
      changing: (x) => `${x.file.done ? "Changed" : "Changing"} ${base(x.file.path)}`,
      proved: (x) => x.tests.command,
      "needs-you": (x) => x.question,
      done: (x) => x.said.split(/(?<=[.!?])\s/)[0] || x.ask,
      failed: (x) => x.fault.what,
    }),
    FOLD_CHARS,
  );

/** What the glass holds at rest, for any number of agents and turns: at most
 *  MAX_TILES tiles of one line each, at most WAIT_KEEP things waiting on him,
 *  and counts for the rest. `agents` maps session id to step()'s state. */
export function restingView(sessions, agents = {}, truths = {}, asked = false) {
  const drawn = [];
  for (const s of sessions) {
    const pid = s.providerSessionId;
    const truth = pid ? truths[pid] : undefined;
    // Asked means asked about this tab: a tab that appeared since the last
    // answer waits for its own, rather than reading realm's stale "idle".
    const t = tileTurn(s, agents[s.id], truth, asked && Boolean(pid) && pid in truths);
    if (t) drawn.push({ s, t });
  }
  drawn.sort((a, b) => rank(a.t) - rank(b.t) || (b.t.at || b.s.updatedAt || 0) - (a.t.at || a.s.updatedAt || 0));
  const waiting = drawn.filter((d) => d.t.phase === "needs-you");
  return Object.freeze({
    tiles: drawn.slice(0, MAX_TILES).map(({ s, t }) =>
      Object.freeze({ id: s.id, title: clip(words(s.title) || "Untitled", FOLD_CHARS), word: word(t), tone: tone(t), line: lineOf(t), turn: t }),
    ),
    moreAgents: Math.max(0, drawn.length - MAX_TILES),
    waiting: waiting.slice(0, WAIT_KEEP).map(({ s, t }) => Object.freeze({ id: s.id, title: clip(words(s.title) || "Untitled", 40), question: lineOf(t) })),
    moreWaiting: Math.max(0, waiting.length - WAIT_KEEP),
  });
}

/** What a focused agent shows: its current turn whole, its older turns one
 *  line each (newest first, at most FOLD_KEEP), and how many are folded past
 *  that. The transcript itself is one press away in Carlton's workspace. */
export function focusView(agent) {
  return Object.freeze({
    turn: agent?.turn ?? null,
    folded: agent?.folded ?? [],
    earlier: agent?.earlier ?? 0,
    trail: agent?.trail ?? [],
    trailEarlier: agent?.trailEarlier ?? 0,
  });
}

/** What the stage beside his transcript draws for a turn: the one live
 *  object his transcript only lists as a row (the command running, the file
 *  being written, the check that ran), or the fault that stopped it. Every
 *  other phase draws nothing there, because his transcript already says it:
 *  needs-you is his own permission card with its Allow and Deny, done is his
 *  own "Edited N files" card with Review, asked is his own message. Floating
 *  audit, headless WebKit, 2026-10-12: the stage drew "Needs you / It's
 *  waiting on you" beside his permission card, a second diff of the whole
 *  turn that ran 157 px off the bottom of the glass beside his Review card,
 *  and the trail of earlier beats as bare text on the desktop with no
 *  surface under it. */
export const stageObject = (turn) =>
  turn
    ? match(turn, {
        asked: () => null,
        reading: (t) => (t.command ? "command" : null),
        changing: () => "file",
        proved: () => "tests",
        "needs-you": () => null,
        done: () => null,
        failed: () => "fault",
      })
    : null;

/** True when nothing on the resting view is working or waiting on him: the
 *  glass then has no reason to move or to ask often (GlassLayer.tsx polls
 *  at TRUTH_REST_MS instead of TRUTH_BEAT_MS). */
export const atRest = (resting) =>
  !resting.tiles.some((t) => t.tone === "running" || t.tone === "needs");

/** Run the newest `fn` handed to `push` at most once per `gapMs`, the first
 *  at once and the newest of a burst after the gap: a report of who has the
 *  glass stays current without a request per reordering of the tiles. */
export function pace(gapMs, timer = globalThis, now = () => Date.now()) {
  let last = -Infinity;
  let pending = null;
  let handle = null;
  const fire = () => {
    handle = null;
    const fn = pending;
    pending = null;
    if (!fn) return;
    last = now();
    fn();
  };
  return {
    push(fn) {
      pending = fn;
      if (handle !== null) return;
      const wait = last + gapMs - now();
      if (wait <= 0) fire();
      else handle = timer.setTimeout(fire, wait);
    },
    cancel() {
      if (handle !== null) timer.clearTimeout(handle);
      handle = null;
      pending = null;
    },
  };
}
