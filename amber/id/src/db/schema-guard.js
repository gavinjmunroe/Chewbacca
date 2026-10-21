/**
 * CODE THAT IS AHEAD OF ITS DATABASE MUST NOT BOOT QUIETLY.
 *
 * WHAT HAPPENED. Migration 049 added events.description, reminders.description
 * and reminders.repeat_days; 050 added reminders.starts_on. The code that writes
 * those columns shipped. The migrations were never run against production --
 * railway.toml is `startCommand = "node src/index.js"` and nothing anywhere calls
 * the runner. So for days:
 *
 *   INSERT INTO events   (... description ... )      -> threw, every time
 *   INSERT INTO reminders (... starts_on ... )       -> threw, every time
 *   SELECT e.description  (listAgendaEvents)         -> threw, every time
 *
 * Nothing could be scheduled. The agenda errored on a loop. And none of it was
 * visible: the client swallowed the write failure, and chat -- which is never
 * told whether a write succeeded -- narrated a tidy confirmation of work that had
 * not happened. The service reported itself healthy throughout.
 *
 * THE FIX IS NOT A BETTER LOG LINE. A log line is what we already had, thousands
 * of times, and nobody was reading it. The only version of this that holds is one
 * where a deploy whose schema is behind cannot become the live deploy.
 *
 * WHY EXITING IS SAFE HERE, and is not "taking production down". Railway gates a
 * rollout on healthcheckPath: traffic moves to the new deployment only once it
 * answers. A process that exits before listen never answers, so the PREVIOUS
 * deployment keeps serving. Refusing to boot converts a silent, days-long, total
 * write outage into a failed deploy with the exact command to fix it in the log.
 * The old code keeps running against the schema it was built for, which is the
 * definition of the safe state.
 *
 * WHAT IT WILL NOT DO IS GUESS. Three states, and only one of them stops a boot:
 *
 *   behind      files on disk that the ledger has never seen   -> refuse
 *   current     ledger covers every file                        -> boot
 *   unknown     no database configured, ledger unreadable, no
 *               ledger table, query timed out                   -> WARN and boot
 *
 * The last one matters more than it looks. A transient connection blip at boot
 * must not turn into a crash loop that keeps the old deploy from restarting
 * either, and a laptop with no DATABASE_URL must still be able to start the
 * server. Not knowing is not the same as knowing something is wrong, and a guard
 * that conflates the two is a guard somebody disables within a week.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** db/migrations, resolved from this file rather than from cwd. */
export const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "db",
  "migrations",
);

/** The *.sql files that make up the schema, in the order the runner applies them. */
export function migrationFilenames(dir = MIGRATIONS_DIR) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    // No migrations directory is not "behind" -- it is a checkout this guard
    // cannot reason about, and pretending otherwise blocks a boot for a reason
    // nobody can act on.
    return null;
  }
}

/** How long the ledger read gets before we give up and call it unknown. */
export const LEDGER_TIMEOUT_MS = 5000;

/**
 * Compare what is on disk to what the ledger says was applied.
 *
 * `loadApplied` returns an iterable of filenames. Injected so the decision can be
 * tested without a database, which is the only way the interesting cases -- a
 * timeout, a missing ledger table, a file the ledger has never seen -- get
 * exercised at all.
 *
 * @returns {Promise<{state:'behind'|'current'|'unknown', pending:string[], reason:string}>}
 */
export async function schemaState({ dir, loadApplied, timeoutMs = LEDGER_TIMEOUT_MS } = {}) {
  const files = migrationFilenames(dir);
  if (!files) return { state: "unknown", pending: [], reason: "no_migrations_dir" };
  if (typeof loadApplied !== "function") {
    return { state: "unknown", pending: [], reason: "no_database" };
  }

  let applied;
  let timer = null;
  try {
    // A boot must not hang on a database that is refusing connections. Racing a
    // timer is the difference between a slow deploy and a deploy that never
    // finishes and never says why.
    //
    // THE TIMER IS CLEARED, NOT UNREF'D. unref looks like the tidy version and is
    // wrong: the timer then cannot fire when nothing else is holding the loop
    // open, so a ledger read that never settles never times out either -- the
    // exact hang this race exists to prevent.
    //
    // The clear in `finally` is hygiene rather than correctness, and no test can
    // tell the difference: the race has already resolved, so leaving the timer
    // dangling delays nothing except process EXIT, by up to timeoutMs. That is
    // invisible in a long-lived server and adds five seconds to anything short.
    applied = await Promise.race([
      loadApplied(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("ledger_timeout")), timeoutMs);
      }),
    ]);
  } catch (err) {
    const message = String(err?.message || err);
    // "relation schema_migrations does not exist" is a database that predates the
    // runner and has never been baselined. It is not behind; it is unmeasured,
    // and `npm run migrate:baseline` is the answer rather than a blocked boot.
    const reason = /schema_migrations/i.test(message)
      ? "no_ledger_table"
      : message === "ledger_timeout"
        ? "ledger_timeout"
        : "ledger_unreadable";
    return { state: "unknown", pending: [], reason };
  } finally {
    if (timer) clearTimeout(timer);
  }

  const seen = new Set(applied || []);
  const pending = files.filter((f) => !seen.has(f));
  return pending.length > 0
    ? { state: "behind", pending, reason: "pending_migrations" }
    : { state: "current", pending: [], reason: "up_to_date" };
}

/**
 * The banner. Written out in full because the person reading it is looking at a
 * failed deploy at an unknown hour and should not have to go and find the
 * command anywhere else.
 */
export function schemaBanner(state) {
  const lines = [
    "",
    "  ============================================================",
    "  REFUSING TO START: the database is behind this code.",
    "",
    `  ${state.pending.length} migration${state.pending.length === 1 ? "" : "s"} on disk ` +
      "have never been applied:",
    ...state.pending.map((f) => `      ${f}`),
    "",
    "  Every write that touches a column these add will throw, and the",
    "  failures do not surface to anyone. That is why this is fatal and",
    "  not a warning.",
    "",
    "  Apply them:",
    "      railway run npm run migrate",
    "",
    "  Traffic stays on the previous deployment until this passes.",
    "  To boot anyway (you will get the outage described above):",
    "      ALLOW_PENDING_MIGRATIONS=true",
    "  ============================================================",
    "",
  ];
  return lines.join("\n");
}

/** The one-liner for an unknown result, which boots. */
export function unknownBanner(state) {
  return (
    `[startup] Schema freshness UNKNOWN (${state.reason}). Booting anyway. ` +
    "If writes start failing on missing columns, run: railway run npm run migrate"
  );
}

/**
 * Boot gate. Returns the state so /status can report it; exits the process when
 * the schema is behind and the escape hatch is not set.
 *
 * `exit` and `log` are injected so a test can assert that it exits rather than
 * killing the test runner.
 */
export async function enforceSchemaFreshness({
  loadApplied,
  dir,
  timeoutMs,
  allowPending = process.env.ALLOW_PENDING_MIGRATIONS === "true",
  exit = (code) => process.exit(code),
  log = console,
} = {}) {
  const state = await schemaState({ dir, loadApplied, timeoutMs });

  if (state.state === "behind") {
    log.error(schemaBanner(state));
    if (!allowPending) {
      exit(1);
      return state;
    }
    log.error("[startup] ALLOW_PENDING_MIGRATIONS=true -- booting against a schema that is behind.");
    return state;
  }

  if (state.state === "unknown") log.warn(unknownBanner(state));
  return state;
}
