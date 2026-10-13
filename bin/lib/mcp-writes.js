// @ts-nocheck
// chewbacca-mcp's writes: kit_write, kit_confirm and kit_undo.
//
// Caleb, 2026-10-11 2:46am, on a server that could only read: "Never read
// only, find a way to write too". The lesson behind it (team memory,
// feedback_never_read_only) says how: make a write safe with a snapshot and an
// undo, never by refusing it. So there are two kinds, set per entry in
// config/data/mcp-writes.json:
//
//   reversible  runs at once. What it touches is snapshotted first, and the
//               answer carries an undo id; kit_undo puts it back, but only if
//               nothing else changed it since (ten-plus tabs share the ledger
//               on a busy night, and a blind restore would wipe theirs).
//   outward     a text, an email, a Slack post, any Clay write, anything that
//               spends money. One call never sends: kit_write returns a draft
//               naming what goes out and to whom, and only kit_confirm with
//               that draft's id AND its approval code sends it, through the
//               tool's own gates.
//
// The approval code is the press. It goes to the person on their own screen
// (a toast on the HUD, or a macOS notification when the HUD is down) and is
// never in anything the agent reads, so an agent, or text injected into one,
// cannot draft and confirm by itself. The 2026-10-11 security review found
// exactly that: kit_confirm only checked a draft id the agent already had,
// while Caleb's rule is that only a press sends and a sentence never does.
//
// Every write, draft, confirm and undo is appended to log.jsonl with who asked.
// All state is owner-only under ~/.chewbacca/mcp-writes: snapshots hold note
// bodies and file contents, drafts hold message text.

"use strict";

const { execFile, spawn } = require("node:child_process");
// The verdict log, loaded up front and guarded so a missing file can never
// throw after a send has gone out (review, 2026-10-12).
let verdicts;
try {
  verdicts = require("./verdicts");
} catch {
  verdicts = { sendRow() {} };
}
const crypto = require("node:crypto");
const approvals = require("./send-approval");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOME = os.homedir();
const STATE =
  process.env.CHEWBACCA_MCP_STATE ||
  path.join(HOME, ".chewbacca", "mcp-writes");

// A draft lives in this process's memory only, so a draft from yesterday's
// server, or one another client made in a different process, can never be
// confirmed. Fifteen minutes is guessed, never measured: long enough to read
// a draft aloud and say send, short enough that a forgotten one dies.
// CHEWBACCA_MCP_DRAFT_TTL_MS can only shorten it (the tests use that).
const DRAFT_TTL_MS = Math.min(
  15 * 60 * 1000,
  Number(process.env.CHEWBACCA_MCP_DRAFT_TTL_MS) || Infinity,
);
const drafts = new Map();

// ── state ────────────────────────────────────────────────────────────────────
function stateDir(...parts) {
  const dir = path.join(STATE, ...parts);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function writePrivate(file, data) {
  fs.writeFileSync(file, data, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

const newId = (prefix) =>
  `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
const ID_SHAPE = /^[ud]_[A-Za-z0-9_-]{16}$/;
// Three wrong codes burn the draft: a six-digit code against unlimited
// guesses is no gate. Guessed, never measured.
const MAX_CODE_TRIES = 3;

// Puts the approval code in front of the person and nowhere else. Returns
// true when some surface took it. CHEWBACCA_MCP_APPROVAL_OUT is the tests'
// stand-in for the screen; the server's environment is set by whoever
// configured the client, never by the agent talking to it.
//
// A process nobody is watching (a no-send run, the suite, node --test,
// pytest, a job-queue job) shows nothing and notes the refused draft in the
// fake sink, the same rule and file as tools/send_approval.py unwatched(). 2026-10-13
// 1:52pm: a test drew a real order code on Caleb's live HUD.
const UNWATCHED_ENV = ["CHEWBACCA_NO_SEND", "CHEWBACCA_SUITE", "PYTEST_CURRENT_TEST", "NODE_TEST_CONTEXT", "CHEWBACCA_JOB"];
function unwatched(env = process.env) {
  return UNWATCHED_ENV.find((name) => env[name]) || null;
}
function codeSink(env = process.env) {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return env.CHEWBACCA_SEND_CODE_SINK || path.join(require("node:os").tmpdir(), `chewbacca-send-codes-${uid}.jsonl`);
}
function showCode(bin, code, what) {
  const out = process.env.CHEWBACCA_MCP_APPROVAL_OUT;
  if (out) {
    try {
      fs.writeFileSync(out, `${code}\n`, { mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }
  // Never the code itself: every marker unwatched() reads is one an agent can
  // set, so a code in a file would be a code it could read and redeem
  // (security review, 10/13). The draft is refused with nothing to redeem.
  const why = unwatched();
  if (why) {
    try {
      const row = { at: Date.now() / 1000, what: String(what || "").slice(0, 140), why };
      fs.appendFileSync(codeSink(), JSON.stringify(row) + "\n", { mode: 0o600 });
    } catch {
      // the note is a courtesy; the refusal below is the rule
    }
    return false;
  }
  const q = (v) => JSON.stringify(String(v));
  const short = String(what || "").slice(0, 140);
  const lines = [
    "@ send-code at=top w=440 life=120",
    'c s Screen title="SEND CODE"',
    "r s",
    `c code Text value=${q(code)} tone=accent`,
    `c what Text value=${q(short)} tone=muted`,
    `c how Text value=${q("Read this code to the assistant only if you want it sent.")} tone=muted`,
    "> s code what how",
  ];
  const { spawnSync } = require("node:child_process");
  const drawn = spawnSync(path.join(bin, "hud"), ["draw"], {
    input: lines.join("\n") + "\n",
    env: { ...process.env, KYBER_LIVE_OK: "1" },
    timeout: 10000,
  });
  if (drawn.status === 0) return true;
  const note = spawnSync("/usr/bin/osascript", [
    "-e",
    `display notification ${q(short)} with title ${q("Chewbacca send code " + code)}`,
  ], { timeout: 10000 });
  return note.status === 0;
}
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Who asked: the client that connected (from initialize), the transport, the
// session when Claude Code launched us, and the agent's own account of who
// asked it, which is a claim, not proof, and is logged as one.
function logEvent(event, who) {
  const line = {
    at: new Date().toISOString(),
    ...event,
    asked_by: String(who.asked_by || "").slice(0, 200) || "(not said)",
    client: who.client || "(unknown client)",
    transport: who.transport || "stdio",
    session: process.env.CLAUDE_CODE_SESSION_ID || undefined,
    pid: process.pid,
  };
  try {
    const file = path.join(stateDir(), "log.jsonl");
    fs.appendFileSync(file, JSON.stringify(line) + "\n", { mode: 0o600 });
  } catch {
    // A write whose log line can't land still ran; the reply says so.
    return false;
  }
  return true;
}

// ── running a tool ───────────────────────────────────────────────────────────
// execFile, never a shell: these values came from a model, which means from
// whatever page it last read.
function run(exe, args, { timeout = 30000, detached = false } = {}) {
  return new Promise((resolve) => {
    if (detached) {
      // A new session has no controlling terminal, so a tool that asks a
      // person at /dev/tty (the Clay front door) falls through to its chat
      // approval rule instead of hanging this server on a prompt nobody sees.
      const child = spawn(exe, args, {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ code: 127, out, err: err + e.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, out: clean(out), err: clean(err) });
      });
      return;
    }
    execFile(
      exe,
      args,
      { timeout, maxBuffer: 8 * 1024 * 1024 },
      (e, out, err) =>
        resolve({
          code: e ? (typeof e.code === "number" ? e.code : 1) : 0,
          out: clean(out),
          err: clean(err),
        }),
    );
  });
}
const clean = (s) =>
  String(s || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trim();
const said = (r) =>
  (r.out || r.err || `exit ${r.code}`).split("\n").slice(0, 6).join("\n");

function json(r) {
  try {
    return JSON.parse(r.out);
  } catch {
    return null;
  }
}

// ── values ───────────────────────────────────────────────────────────────────
// Lengths are guessed, never measured, except `long`: 8,000 fits the longest
// email Caleb sent Jonah (about 3,100 characters, 2026-10-08) twice over.
const LIMITS = { text: 200, long: 8000, file: 500000, path: 400 };

function valueFor(name, spec, value, choicesFor) {
  if (spec.type === "kv") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`${name} must be an object of strings`);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!/^[A-Za-z_]{1,40}$/.test(k))
        throw new Error(
          `${name}: "${String(k).slice(0, 40)}" is not an arg name`,
        );
      const s = typeof v === "string" ? v : JSON.stringify(v);
      if (s.length > 20000 || /[\x00-\x08\x0b-\x1f]/.test(s))
        throw new Error(`${name}.${k} is too long or holds control characters`);
      out[k] = s;
    }
    return out;
  }
  const s = String(value);
  if (spec.type === "choice") {
    const list = spec.choices || choicesFor(spec.choices_from);
    if (!list.includes(s))
      throw new Error(`${name} must be one of ${list.join(", ")}`);
    return s;
  }
  const max = LIMITS[spec.type] || LIMITS.text;
  if (!s.trim() || s.length > max)
    throw new Error(`${name} must be non-empty and under ${max} characters`);
  if (spec.type === "file") {
    if (s.includes("\x00")) throw new Error(`${name} holds a NUL byte`);
    return s;
  }
  // Tabs and newlines are fine in a long value; nothing else below 0x20.
  const ctl = spec.type === "long" ? /[\x00-\x08\x0b-\x1f]/ : /[\x00-\x1f]/;
  if (ctl.test(s)) throw new Error(`${name} holds control characters`);
  // Every CLI here would read a leading dash as a flag.
  if (s.startsWith("-")) throw new Error(`${name} can't start with a dash`);
  return s;
}

function params(entry, given, choicesFor) {
  const out = {};
  for (const [name, spec] of Object.entries(entry.params || {})) {
    const v = given ? given[name] : undefined;
    if (v === undefined || v === null || v === "") {
      if (spec.required) throw new Error(`${name} is required`);
      continue;
    }
    out[name] = valueFor(name, spec, v, choicesFor);
  }
  const stray = Object.keys(given || {}).filter(
    (k) => !(k in (entry.params || {})),
  );
  if (stray.length)
    throw new Error(
      `unknown param ${stray.join(", ")}; ${entry.id} takes ${Object.keys(entry.params || {}).join(", ")}`,
    );
  return out;
}

// ── files ────────────────────────────────────────────────────────────────────
// Where file.write and file.edit may land. Never a dotfile or dot directory
// (.zshrc, .claude/settings.json and .git/hooks all run code), never an
// executable, never Caleb's handwritten Obsidian notes ("04 Notes", which he
// writes by hand on purpose), never through a symlink out of the root.
function fileRoots() {
  const raw = process.env.CHEWBACCA_MCP_FILE_ROOTS
    ? process.env.CHEWBACCA_MCP_FILE_ROOTS.split(":")
    : ["second-brain", "Downloads", "Documents"].map((d) => path.join(HOME, d));
  return raw.filter(Boolean).flatMap((r) => {
    try {
      return [fs.realpathSync.native(r)];
    } catch {
      return [];
    }
  });
}

function placeFile(raw) {
  const asked = raw.startsWith("~/") ? path.join(HOME, raw.slice(2)) : raw;
  if (!path.isAbsolute(asked))
    throw new Error("path must be absolute or start with ~/");
  let parent;
  try {
    // .native returns the on-disk case. APFS is case-insensitive, so
    // "04 notes" opens "04 Notes" and must be caught as it.
    parent = fs.realpathSync.native(path.dirname(asked));
  } catch {
    throw new Error("the folder it goes in doesn't exist");
  }
  const target = path.join(parent, path.basename(asked));
  const root = fileRoots().find((r) => target.startsWith(r + path.sep));
  if (!root)
    throw new Error(
      `files can only be written inside ${fileRoots().join(", ")}`,
    );
  const parts = path.relative(root, target).split(path.sep);
  if (parts.some((p) => p.startsWith(".")))
    throw new Error("no dotfiles or dot folders");
  if (parts.some((p) => p.normalize("NFC").toLowerCase() === "04 notes"))
    throw new Error("04 Notes is written by hand, never by an agent");
  let st = null;
  try {
    st = fs.lstatSync(target);
  } catch {}
  if (st) {
    if (st.isSymbolicLink() || !st.isFile())
      throw new Error("that path is not a plain file");
    if (st.mode & 0o111) throw new Error("that file is executable");
    if (st.size > LIMITS.file)
      throw new Error("that file is too big to snapshot here");
    const head = fs.readFileSync(target).subarray(0, 8192);
    if (head.includes(0)) throw new Error("that file is not text");
  }
  return { target, existed: Boolean(st), mode: st ? st.mode & 0o777 : 0o644 };
}

function fileWrite(place, content, undoId) {
  const before = place.existed ? fs.readFileSync(place.target) : null;
  let backup = null;
  if (before) {
    backup = path.join(stateDir("files"), `${undoId}.bak`);
    writePrivate(backup, before);
  }
  fs.writeFileSync(place.target, content, { mode: place.mode });
  return {
    type: "file",
    path: place.target,
    backup,
    created: !place.existed,
    after: sha(fs.readFileSync(place.target)),
  };
}

// ── apps ─────────────────────────────────────────────────────────────────────
// osascript with the values as argv, never spliced into the script text.
function osa(lines, argv) {
  const args = [
    "-e",
    "on run argv",
    ...lines.flatMap((l) => ["-e", l]),
    "-e",
    "end run",
    ...argv,
  ];
  return run("osascript", args);
}

// The `mac` CLI hands out EventKit ids (a bare UUID) and Reminders'
// AppleScript only finds "x-apple-reminder://<UUID>": on the 2026-10-11 live
// probe the bare id failed with -1728 and the prefixed one worked.
const asScriptReminder = (id) =>
  String(id).includes("://") ? String(id) : `x-apple-reminder://${id}`;

async function noteHtml(id) {
  const r = await run("mac", ["notes", "read", id, "--html", "--json"]);
  const n = json(r);
  if (r.code !== 0 || !n || typeof n.body !== "string")
    throw new Error(`could not read note ${id}: ${said(r)}`);
  return n.body;
}

async function noteAttachments(id) {
  const r = await osa(
    [
      'tell application "Notes" to return count of attachments of note id (item 1 of argv)',
    ],
    [id],
  );
  return r.code === 0 ? Number(r.out) || 0 : null;
}

// ── the writes ───────────────────────────────────────────────────────────────
// Each returns { text, undo } where undo is what kit_undo needs, or null when
// there is nothing to put back.
function reversible(bin) {
  const B = (name) => path.join(bin, name);
  const py = (args) =>
    run("python3", [path.join(bin, "lib", "mcp_undo.py"), ...args]);

  return {
    "ledger.add": async (p) => {
      const argv = [
        "add",
        "--scope",
        p.workspace || "~",
        "--title",
        p.title,
        "--source-key",
        `mcp-${crypto.randomBytes(6).toString("hex")}`,
      ];
      if (p.next_action) argv.push("--next-action", p.next_action);
      const r = await run(B("work-ledger"), argv);
      const got = json(r);
      if (!got || !got.task) throw new Error(`work-ledger refused: ${said(r)}`);
      return {
        text: `Added to the ledger: ${got.task.title} (${got.task.id})`,
        undo: {
          type: "ledger-delete",
          task_id: got.task.id,
          updated_at: got.task.updated_at,
        },
      };
    },
    "ledger.update": async (p) => {
      const prior = json(await py(["ledger-get", p.task_id]));
      if (!prior || !prior.task) throw new Error(`no ledger task ${p.task_id}`);
      const argv = ["update", "--scope", prior.task.scope, "--id", p.task_id];
      for (const k of ["status", "next_action", "evidence", "reason", "owner"])
        if (p[k] !== undefined) argv.push(`--${k.replace("_", "-")}`, p[k]);
      const r = await run(B("work-ledger"), argv);
      const got = json(r);
      if (!got || got.error || !got.updated_at)
        throw new Error(`work-ledger refused: ${got?.error || said(r)}`);
      const keep = Object.fromEntries(
        [
          "status",
          "owner",
          "next_action",
          "evidence",
          "reason",
          "updated_at",
        ].map((k) => [k, prior.task[k]]),
      );
      return {
        text: `Updated ${got.title}: ${got.status}${p.next_action ? `, next: ${got.next_action}` : ""}`,
        undo: {
          type: "ledger-restore",
          task_id: p.task_id,
          updated_at: got.updated_at,
          prior: keep,
        },
      };
    },
    "notes.add": async (p) => {
      const argv = ["notes", "add", p.title];
      if (p.body) argv.push("--body", p.body);
      if (p.folder) argv.push("--folder", p.folder);
      const r = await run(B("mac-db"), [...argv, "--json"]);
      const n = json(r);
      if (r.code !== 0 || !n || !n.id)
        throw new Error(`Notes refused: ${said(r)}`);
      return {
        text: `Created note "${n.title}" in ${n.folder || "Notes"} (${n.id})`,
        undo: { type: "note-delete", note_id: n.id },
      };
    },
    "notes.append": async (p) =>
      noteChange(p, ["notes", "append", p.note_id, p.text]),
    "notes.edit": async (p) => {
      if (!p.title && !p.body)
        throw new Error("give a title or a body to change");
      const argv = ["notes", "edit", p.note_id];
      if (p.title) argv.push("--title", p.title);
      if (p.body) argv.push("--body", p.body);
      return noteChange(p, argv);
    },
    "reminders.add": async (p) => {
      const argv = ["reminders", "add", p.title];
      for (const k of ["due", "notes", "list", "priority"])
        if (p[k]) argv.push(`--${k}`, p[k]);
      const r = await run(B("mac-db"), [...argv, "--json"]);
      const n = json(r);
      if (r.code !== 0 || !n || !n.id)
        throw new Error(`Reminders refused: ${said(r)}`);
      return {
        text: `Reminder set: ${n.title}${n.due ? `, due ${n.due}` : ""} (${n.id})`,
        undo: { type: "reminder-delete", reminder_id: n.id },
      };
    },
    "reminders.complete": async (p) => {
      const was = await osa(
        [
          'tell application "Reminders" to return completed of reminder id (item 1 of argv)',
        ],
        [asScriptReminder(p.reminder_id)],
      );
      if (was.code !== 0)
        throw new Error(`no reminder ${p.reminder_id}: ${said(was)}`);
      // Already done before: there is nothing to undo, and an undo that
      // unticked it would invent a change nobody made.
      if (was.out === "true")
        return { text: "That reminder was already done.", undo: null };
      // Ticked through AppleScript, the same door the undo unticks through.
      // On the 2026-10-11 live run the tick went through `mac` (EventKit) and
      // the untick through AppleScript; the two views lagged each other and
      // the reminder ended up done after its undo. One API both ways held.
      const r = await osa(
        [
          'tell application "Reminders" to set completed of reminder id (item 1 of argv) to true',
        ],
        [asScriptReminder(p.reminder_id)],
      );
      if (r.code !== 0) throw new Error(`Reminders refused: ${said(r)}`);
      return {
        text: `Ticked off reminder ${p.reminder_id}`,
        undo: { type: "reminder-uncomplete", reminder_id: p.reminder_id },
      };
    },
    "calendar.hold": async (p) => {
      const notes = ["Tentative hold set through Chewbacca.", p.notes]
        .filter(Boolean)
        .join("\n");
      const argv = [
        "calendar",
        "add",
        `Hold: ${p.title}`,
        "--at",
        p.at,
        "--notes",
        notes,
      ];
      if (p.duration) argv.push("--duration", p.duration);
      if (p.calendar) argv.push("--calendar", p.calendar);
      const r = await run(B("mac-db"), [...argv, "--json"]);
      const n = json(r);
      if (r.code !== 0 || !n || !n.id)
        throw new Error(`Calendar refused: ${said(r)}`);
      return {
        text: `Held "${n.title}" from ${n.start} to ${n.end} on ${n.calendar} (${n.id})`,
        undo: { type: "event-delete", event_id: n.id },
      };
    },
    "people.note": async (p) => {
      const mark = json(await py(["obs-mark"]));
      if (!mark) throw new Error("the people store can't be read");
      const r = await run(B("people"), ["note", p.name, p.text]);
      if (r.code !== 0) throw new Error(`people refused: ${said(r)}`);
      const made = json(await py(["obs-since", String(mark.rowid), p.text]));
      if (!made || !made.ids.length) return { text: said(r), undo: null };
      return { text: said(r), undo: { type: "obs-forget", ids: made.ids } };
    },
    "file.write": async (p, undoId) => {
      const place = placeFile(p.path);
      const undo = fileWrite(place, p.content, undoId);
      return {
        text: `${place.existed ? "Replaced" : "Created"} ${place.target} (${Buffer.byteLength(p.content)} bytes)`,
        undo,
      };
    },
    "file.edit": async (p, undoId) => {
      const place = placeFile(p.path);
      if (!place.existed)
        throw new Error("no file there to edit; file.write creates one");
      const text = fs.readFileSync(place.target, "utf8");
      const n = text.split(p.old).length - 1;
      if (n !== 1)
        throw new Error(
          n
            ? `that passage appears ${n} times; give more of it so it's unique`
            : "that passage isn't in the file",
        );
      const undo = fileWrite(
        place,
        text.replace(p.old, () => p.new),
        undoId,
      );
      return { text: `Edited ${place.target}`, undo };
    },
  };

  async function noteChange(p, argv) {
    const before = await noteHtml(p.note_id);
    const attachments = await noteAttachments(p.note_id);
    const r = await run(B("mac-db"), [...argv, "--json"]);
    if (r.code !== 0) throw new Error(`Notes refused: ${said(r)}`);
    const after = await noteHtml(p.note_id);
    return {
      text: `Changed note ${p.note_id}`,
      undo: {
        type: "note-restore",
        note_id: p.note_id,
        before,
        after: sha(after),
        attachments,
      },
    };
  }
}

async function undoOne(rec, bin) {
  const B = (name) => path.join(bin, name);
  const py = (args) =>
    run("python3", [path.join(bin, "lib", "mcp_undo.py"), ...args]);
  const u = rec.undo;
  const ok = (r, what) => {
    if (r.code !== 0) throw new Error(`${what}: ${said(r)}`);
    return what;
  };
  switch (u.type) {
    case "ledger-delete": {
      const r = await py(["ledger-delete", u.task_id, u.updated_at]);
      if (r.code === 3) throw new Error(json(r)?.refused || said(r));
      return ok(r, `removed ledger task ${u.task_id}`);
    }
    case "ledger-restore": {
      const r = await py([
        "ledger-restore",
        u.task_id,
        u.updated_at,
        JSON.stringify(u.prior),
      ]);
      if (r.code === 3) throw new Error(json(r)?.refused || said(r));
      return ok(r, `put ledger task ${u.task_id} back to ${u.prior.status}`);
    }
    case "note-delete":
      return ok(
        await run(B("mac-db"), ["notes", "delete", u.note_id, "--json"]),
        `moved note ${u.note_id} to Recently Deleted`,
      );
    case "note-restore": {
      if (sha(await noteHtml(u.note_id)) !== u.after)
        throw new Error(
          "the note changed after this write; left as is so that change isn't lost",
        );
      // Setting a body rewrites the note; with pictures or files in it that
      // could drop them, so those notes are left for a person. Notes also
      // normalizes HTML on every write: on the 2026-10-11 live run the
      // restored note had its text and formatting back, plus a <br> Notes
      // adds after the title, so this restores content, not bytes.
      if (u.attachments)
        throw new Error(
          `the note holds ${u.attachments} attachments, which a body restore could drop; its earlier text is saved in ${STATE}/undo/${rec.id}.json`,
        );
      const r = await osa(
        [
          'tell application "Notes" to set body of note id (item 1 of argv) to (item 2 of argv)',
        ],
        [u.note_id, u.before],
      );
      return ok(r, `put note ${u.note_id} back as it was`);
    }
    case "reminder-delete":
      return ok(
        await run(B("mac-db"), [
          "reminders",
          "delete",
          u.reminder_id,
          "--json",
        ]),
        `deleted reminder ${u.reminder_id}`,
      );
    case "reminder-uncomplete": {
      const r = await osa(
        [
          'tell application "Reminders" to set completed of reminder id (item 1 of argv) to false',
        ],
        [asScriptReminder(u.reminder_id)],
      );
      return ok(r, `marked reminder ${u.reminder_id} not done`);
    }
    case "event-delete":
      return ok(
        await run(B("mac-db"), ["calendar", "delete", u.event_id, "--json"]),
        `deleted the hold ${u.event_id}`,
      );
    case "obs-forget":
      return ok(
        await py(["obs-forget", ...u.ids]),
        `forgot ${u.ids.length} note${u.ids.length === 1 ? "" : "s"}`,
      );
    case "file": {
      let now = null;
      try {
        now = sha(fs.readFileSync(u.path));
      } catch {}
      if (now !== u.after)
        throw new Error(
          "the file changed after this write; left as is so that change isn't lost",
        );
      if (u.created) {
        fs.unlinkSync(u.path);
        return `removed ${u.path}, which this write created`;
      }
      fs.writeFileSync(u.path, fs.readFileSync(u.backup));
      return `put ${u.path} back as it was`;
    }
    default:
      throw new Error(`no undo for ${u.type}`);
  }
}

// ── outward: drafts ──────────────────────────────────────────────────────────
function outward(bin) {
  const B = (name) => path.join(bin, name);
  return {
    "text.send": {
      async draft(p) {
        const argv = ["send", p.to, p.text];
        if (p.via) argv.push("--via", p.via);
        if (p.subject) argv.push("--subject", p.subject);
        const r = await run(B("people"), [
          ...argv,
          "--approval-binding",
          "--dry-run",
        ]);
        if (r.code !== 0 || !/would send to/.test(r.out))
          throw new Error(`can't address that: ${said(r)}`);
        // The exact channel and address people send will hand the message to,
        // which is what confirm's approval is minted for.
        const bound = /^approval-binding (\{.*\})$/m.exec(r.out);
        let approval = null;
        try {
          approval = bound ? JSON.parse(bound[1]) : null;
        } catch {
          approval = null;
        }
        if (!approval || approval.text !== String(p.text).trim())
          throw new Error("people send didn't say where this would go");
        // An address the store can't tie to the person (on WhatsApp or Slack
        // the sender picks their own name) sends only with --to repeating it.
        // That is never filled in here: kit_confirm has to be handed the same
        // address as to_address, the way `people send` makes a person type it.
        const unsaved = /to send: add --to (.+)$/m.exec(r.out);
        return {
          argv,
          dry: [...argv, "--dry-run"],
          preview: r.out.replace(/^approval-binding .*\n?/m, ""),
          bind: recipientLine(r.out),
          needsTo: unsaved ? unsaved[1].trim() : null,
          approval,
        };
      },
      async recheck(d) {
        return recipientLine((await run(B("people"), d.dry)).out);
      },
      // The confirmed code is the person's press; this is the one place it
      // becomes an approval, for the exact channel, address and text drafted.
      send: (d) => {
        approvals.mintPressed(
          d.approval.channel,
          d.approval.to,
          d.approval.text,
          "kit_confirm",
          d.approval.subject || "",
        );
        return run(B("people"), d.argv, { timeout: 60000 });
      },
    },
    "gtm.clay_write": {
      async draft(p) {
        const argv = [
          p.op,
          ...Object.entries(p.args || {}).map(([k, v]) => `${k}=${v}`),
        ];
        const r = await run(B("chewbacca-clay"), [...argv, "--dry-run"]);
        const got = json(r);
        if (!got || !got.ok || !got.request)
          throw new Error(`Clay refused the draft: ${got?.reason || said(r)}`);
        const preview = `${p.op} (${got.gate}) via ${got.surface}\n${JSON.stringify(got.request, null, 2)}`;
        return {
          argv,
          dry: [...argv, "--dry-run"],
          preview,
          bind: JSON.stringify(got.request),
        };
      },
      async recheck(d) {
        const got = json(await run(B("chewbacca-clay"), d.dry));
        return got && got.request ? JSON.stringify(got.request) : null;
      },
      // --allow-writes still needs Caleb: the front door checks for his ok
      // in chat within 2 hours, the grade gate, and refuses a campaign start.
      send: (d) =>
        run(B("chewbacca-clay"), [...d.argv, "--allow-writes"], {
          timeout: 180000,
          detached: true,
        }),
    },
  };
}

function recipientLine(out) {
  const line = String(out || "")
    .split("\n")
    .find((l) => /would send to/.test(l));
  return line ? line.trim() : null;
}

// ── the three tools ──────────────────────────────────────────────────────────
function createWrites({ bin, registryFile, choicesFor }) {
  const R = reversible(bin);
  const O = outward(bin);
  const entries = () => {
    try {
      const got = JSON.parse(fs.readFileSync(registryFile, "utf8"));
      return Array.isArray(got.writes) ? got.writes : [];
    } catch {
      return [];
    }
  };

  async function write(a, who) {
    const entry = entries().find((e) => e.id === String(a.id));
    if (!entry)
      return `No write ${String(a.id).slice(0, 60)}. Call find_capability first.`;
    let p;
    try {
      p = params(entry, a.params || {}, choicesFor);
    } catch (e) {
      return `${entry.id}: ${e.message}`;
    }
    if (entry.kind === "outward") {
      const kind = O[entry.id];
      if (!kind) return `${entry.id} has no sender here`;
      let d;
      try {
        d = await kind.draft(p);
      } catch (e) {
        logEvent(
          { op: "draft-refused", write: entry.id, reason: e.message },
          who,
        );
        return `${entry.id}: ${e.message}. Nothing was sent.`;
      }
      // An HTTP server can run for days; dead drafts don't pile up in it.
      for (const [k, old] of drafts)
        if (old.used || Date.now() - old.at > DRAFT_TTL_MS) drafts.delete(k);
      const id = newId("d");
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      if (!showCode(bin, code, d.bind || d.preview)) {
        logEvent({ op: "draft-refused", write: entry.id, reason: "no screen for the code" }, who);
        return `${entry.id}: there's no way to show the person the send code on this Mac right now (no HUD, no notifications), so this can't be sent from here. Nothing was sent.`;
      }
      drafts.set(id, {
        codeHash: sha(code),
        tries: 0,
        id,
        entry: entry.id,
        argv: d.argv,
        dry: d.dry,
        bind: d.bind,
        needsTo: d.needsTo || null,
        approval: d.approval || null,
        at: Date.now(),
        used: false,
      });
      logEvent(
        {
          op: "draft",
          write: entry.id,
          draft: id,
          preview_sha: sha(d.preview),
        },
        who,
      );
      return [
        `DRAFT ${id}. Nothing has been sent.`,
        d.preview,
        "",
        "A six-digit send code is on the person's screen now, and only there. Show them this draft; if they want it sent they'll read you the code. Never guess it or ask for it before they've seen the draft.",
        d.needsTo
          ? `${d.needsTo} is not a saved contact. Ask the person whether that address is right; only if they say so, call kit_confirm with draft_id ${id}, approval_code, and to_address set to it.`
          : `Then call kit_confirm with draft_id ${id} and approval_code.`,
        `It expires in ${Math.round(DRAFT_TTL_MS / 60000)} minutes and works once.`,
      ].join("\n");
    }
    const fn = R[entry.id];
    if (!fn) return `${entry.id} has no writer here`;
    const id = newId("u");
    let done;
    try {
      done = await fn(p, id);
    } catch (e) {
      logEvent({ op: "write-failed", write: entry.id, reason: e.message }, who);
      return `${entry.id} failed: ${e.message}`;
    }
    const logged = logEvent(
      { op: "write", write: entry.id, undo: done.undo ? id : null },
      who,
    );
    if (!done.undo)
      return (
        done.text + (logged ? "" : "\n(The write log could not be written.)")
      );
    writePrivate(
      path.join(stateDir("undo"), `${id}.json`),
      JSON.stringify({
        id,
        write: entry.id,
        at: new Date().toISOString(),
        undo: done.undo,
        undone: false,
      }),
    );
    return `${done.text}\nUndo id: ${id} (kit_undo puts it back).${logged ? "" : "\n(The write log could not be written.)"}`;
  }

  async function confirm(a, who) {
    const id = String(a.draft_id || "");
    const d = ID_SHAPE.test(id) ? drafts.get(id) : null;
    const refuse = (why) => {
      logEvent(
        { op: "confirm-refused", draft: id.slice(0, 40), reason: why },
        who,
      );
      return `Refused: ${why}. Nothing was sent.`;
    };
    if (!d)
      return refuse(
        "no draft with that id in this server (a draft from a restarted server or another client never sends)",
      );
    if (d.used)
      return refuse("that draft was already confirmed once; make a new one");
    if (Date.now() - d.at > DRAFT_TTL_MS) {
      drafts.delete(id);
      return refuse("that draft expired; make a new one");
    }
    const given = String(a.approval_code || "").trim();
    const ok =
      /^\d{6}$/.test(given) &&
      crypto.timingSafeEqual(Buffer.from(sha(given)), Buffer.from(d.codeHash));
    if (!ok) {
      d.tries += 1;
      if (d.tries >= MAX_CODE_TRIES) {
        drafts.delete(id);
        return refuse("wrong send code three times, so the draft is gone; make a new one");
      }
      return refuse(
        "that isn't the send code on the person's screen. Only they can read it to you",
      );
    }
    if (d.needsTo && String(a.to_address || "").trim() !== d.needsTo)
      return refuse(
        `the address isn't a saved contact; confirming needs to_address ${d.needsTo}, as the draft showed it`,
      );
    // Spent on the first confirm that gets this far, whatever happens next.
    d.used = true;
    const kind = O[d.entry];
    const argv = d.needsTo ? [...d.argv, "--to", d.needsTo] : d.argv;
    // Who and where are resolved again; if a new thread or a changed table
    // means it would go somewhere else now, the person never saw that.
    const now = await kind.recheck(d);
    if (!now || now !== d.bind)
      return refuse("where it would go has changed since the draft");
    if (process.env.CHEWBACCA_NO_SEND) {
      verdicts.sendRow(`mcp ${d.entry}`, "held", d.bind.slice(0, 120), "CHEWBACCA_NO_SEND");
      logEvent({ op: "confirm-no-send", write: d.entry, draft: id }, who);
      return `CHEWBACCA_NO_SEND is set, so nothing was sent. The draft checked out: ${d.bind.slice(0, 200)}`;
    }
    const r = await kind.send({ ...d, argv });
    verdicts.sendRow(`mcp ${d.entry}`, r.code === 0 ? "sent" : "failed", d.bind.slice(0, 120),
      r.code === 0 ? "" : `exit ${r.code}`);
    logEvent({ op: "confirm", write: d.entry, draft: id, exit: r.code }, who);
    return r.code === 0 ? `Sent. ${said(r)}` : `Not sent: ${said(r)}`;
  }

  async function undo(a, who) {
    const id = String(a.undo_id || "");
    if (!ID_SHAPE.test(id) || !id.startsWith("u_"))
      return "No undo with that id.";
    const file = path.join(stateDir("undo"), `${id}.json`);
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return "No undo with that id.";
    }
    if (rec.undone) return `Already undone at ${rec.undone}.`;
    try {
      const what = await undoOne(rec, bin);
      rec.undone = new Date().toISOString();
      writePrivate(file, JSON.stringify(rec));
      logEvent({ op: "undo", write: rec.write, undo: id }, who);
      return `Undone: ${what}.`;
    } catch (e) {
      logEvent(
        { op: "undo-refused", write: rec.write, undo: id, reason: e.message },
        who,
      );
      return `Not undone: ${e.message}`;
    }
  }

  return { entries, write, confirm, undo };
}

module.exports = { createWrites, STATE, showCode, unwatched };
