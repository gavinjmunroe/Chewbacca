/**
 * Chasing up work that never came back (plan step 08). Ticks every 5 minutes.
 *
 * Four jobs, and three of them are about not spending money by accident:
 *   - chase rows sent but silent for 15 minutes, up to 3 attempts;
 *   - give up on anything older than an hour, whatever attempts says;
 *   - alert on rows stuck mid-dispatch, and NEVER retry those;
 *   - stop everything if the day's call count goes over the cap.
 *
 * A tick is not a pass. One Computer call can run for 15 minutes and dispatch
 * is sequential, so a pass may outlast its interval; sweepRepliesGuarded() is
 * the entry point the timer calls, and it drops a tick rather than running two
 * passes at once.
 *
 * The same pass runs over connection research (sweepConnections), on its own
 * timer and its own guard, so a slow research task never delays a reply.
 */

import { createLogger } from "../observability/logger";
import { dispatchPerPass, replyQueue } from "../replies/queue";
import { connectionQueue } from "../connections/queue";
import type { PerplexityQueue, QueueRow } from "./queue";
import {
  perplexityAccountForClient,
  perplexityCallTimeoutMs,
  perplexityProjectUuid,
} from "./config";
import { getPerplexityAccessToken, isPerplexityHalted, sendUrgentAlert } from "./tokens";
import { callPerplexityComputer, type ComputerCaller } from "./computer";
import { classifyOutcome, outcomeAlert, shouldHalt } from "./outcome";
import {
  CALL_KINDS,
  dailyCallCap,
  dailyCapEnvVar,
  isOverDailyCap,
  recordCall,
} from "./call-log";
import { dispatchQueued } from "./dispatch";

const logger = createLogger("perplexity/sweeper");

export interface SweepConfig {
  staleMinutes: number;
  maxAttempts: number;
  giveUpAfterMinutes: number;
  dispatchingAlertMinutes: number;
}

export { dispatchPerPass };

export function sweepConfig(): SweepConfig {
  const num = (v: string | undefined, d: number) =>
    Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d;
  return {
    staleMinutes: num(process.env.REPLY_SWEEP_STALE_MINUTES, 15),
    maxAttempts: num(process.env.REPLY_SWEEP_MAX_ATTEMPTS, 3),
    giveUpAfterMinutes: num(process.env.REPLY_SWEEP_GIVE_UP_MINUTES, 60),
    // 15, not 5. A healthy reply takes 3-6 minutes end to end, so a 5-minute
    // window alerted on work that was merely slow: on 2026-09-17 Perplexity
    // took 12 minutes, the MCP call timed out, the row sat on 'dispatching'
    // with no thread id, and the alert asked a person to adjudicate a reply
    // that then finished by itself and posted its card normally. An alert that
    // fires on healthy rows is one people learn to close. This still leaves 45
    // minutes of margin before giveUpAfterMinutes gives up on the row.
    //
    // Floored above the call timeout, because a row sits on 'dispatching' for
    // exactly as long as its call runs. Alerting inside that window would
    // report every slow-but-working task as stranded — the bug above, brought
    // back by raising the timeout instead of by lowering this. Deriving it
    // means the two cannot drift into contradiction, including when a deploy
    // overrides one of them.
    dispatchingAlertMinutes: Math.max(
      num(process.env.REPLY_SWEEP_DISPATCHING_MINUTES, 15),
      Math.ceil(perplexityCallTimeoutMs() / 60_000) + 2,
    ),
  };
}

export interface SweepSummary {
  dispatched: number;
  /** Finished from data Togari already held, with no call (connection reuse). */
  served: number;
  chased: number;
  failed: number;
  alerted: number;
  skipped: number;
}

function accountFor(row: QueueRow): string {
  // The row's own account when it has one: a conversation can only be
  // continued by the account that started it, so this is not interchangeable
  // with whatever the client currently resolves to.
  return row.pplx_account?.trim() || perplexityAccountForClient(row.client_id ?? "serif");
}

/** One pass over the reply queue. Safe to call on a timer. */
export async function sweepReplies(
  call: ComputerCaller = callPerplexityComputer,
  config: SweepConfig = sweepConfig(),
): Promise<SweepSummary> {
  return sweepQueue(replyQueue, call, config);
}

/** One pass over connection research. */
export async function sweepConnections(
  call: ComputerCaller = callPerplexityComputer,
  config: SweepConfig = sweepConfig(),
): Promise<SweepSummary> {
  return sweepQueue(connectionQueue, call, config);
}

/** One pass over any queue. Every branch is idempotent-ish. */
export async function sweepQueue<R extends QueueRow>(
  queue: PerplexityQueue<R>,
  call: ComputerCaller = callPerplexityComputer,
  config: SweepConfig = sweepConfig(),
): Promise<SweepSummary> {
  const label = queue.label;
  const summary: SweepSummary = {
    dispatched: 0,
    served: 0,
    chased: 0,
    failed: 0,
    alerted: 0,
    skipped: 0,
  };

  // ── New work first (plan step 06) ────────────────────────────────
  // Without this nothing ever leaves the queue on its own: the chase-up below
  // only touches rows already sent, so a queued reply would sit untouched
  // until a person ran the dispatch script. Bounded per pass so a backlog
  // drains steadily rather than firing dozens of paid tasks at once.
  try {
    const outcomes = await dispatchQueued(queue.dispatchPerPass(), call, queue);
    for (const o of outcomes) {
      if (o.status === "dispatched") summary.dispatched++;
      else if (o.status === "served") summary.served++;
      else if (o.status === "failed") summary.failed++;
      else summary.skipped++;
    }
  } catch (err) {
    logger.error(
      "perplexity.sweep.dispatch_failed",
      err instanceof Error ? err : new Error(String(err)),
      { queue: label },
    );
  }

  // ── Rows stuck mid-dispatch. Alert, never retry. ─────────────────
  for (const row of await queue.findStuckDispatching(config.dispatchingAlertMinutes)) {
    summary.alerted++;
    logger.error(
      "perplexity.sweep.stuck_dispatching",
      new Error(`row ${row.row_id} stuck on dispatching`),
      { queue: label, rowId: row.row_id },
    );
    await sendUrgentAlert(
      `:warning: *${label} ${row.row_id} is stuck mid-dispatch.*\n` +
        `Perplexity may have started paid work Togari has no id for, so it is ` +
        `deliberately NOT being retried — retrying could pay for the same task ` +
        `twice. A person needs to decide: mark it failed, or re-queue it.`,
    );
  }

  // ── Too old to be worth anything. Give up. ───────────────────────
  for (const row of await queue.findAncient(config.giveUpAfterMinutes)) {
    summary.failed++;
    await queue.markFailed(row.row_id, `no result after ${config.giveUpAfterMinutes} minutes`);
    await sendUrgentAlert(
      `:hourglass: *${label} ${row.row_id} gave up* after ` +
        `${config.giveUpAfterMinutes} minutes with no result. Marked failed.`,
    );
  }

  // ── Sent but silent. Chase, within the attempts limit. ───────────
  const stuck = await queue.findStuckDispatched({
    staleMinutes: config.staleMinutes,
    maxAttempts: config.maxAttempts,
  });

  for (const row of stuck) {
    const account = accountFor(row);

    if (isPerplexityHalted(account)) {
      summary.skipped++;
      continue;
    }
    // The cap is checked per row, not per pass: a long sweep must not sail
    // past it partway through.
    if (await isOverDailyCap(account, queue.scope)) {
      summary.skipped++;
      await sendUrgentAlert(
        `:octagonal_sign: *Perplexity daily ${queue.scope} call cap reached for \`${account}\`.*\n` +
          `Sending has stopped for the rest of the day. New work keeps queueing ` +
          `and nothing is lost. Raise ${dailyCapEnvVar(queue.scope)} if this is wrong.`,
      );
      break;
    }

    const attempts = await queue.recordChaseAttempt(row.row_id);

    if (!row.pplx_thread_id) {
      // Nothing to continue — a dispatched row with no thread id cannot be
      // chased, only given up on.
      //
      // This was the one markFailed of the four that said nothing. It is also
      // the one that fires when Perplexity accepts a call and returns no
      // thread, so the most common failure was the only silent one: 35 replies
      // died here over two days with no card, no alert, and no sign anything
      // was wrong. Whatever else is true, a reply nobody answers has to be
      // something a person hears about.
      summary.failed++;
      summary.alerted++;
      await queue.markFailed(row.row_id, "dispatched with no thread id");
      await sendUrgentAlert(
        `:warning: *${label} ${row.row_id} failed with no ${queue.scope === "replies" ? "draft" : "result"}* — Perplexity ` +
          `(\`${account}\`) took the task but returned no thread to follow up, ` +
          `so there was nothing to chase.\n` +
          `The row itself is safe in BigQuery and can be re-queued once the ` +
          `cause is fixed: \`${queue.requeueHint}\`. ` +
          `If this repeats, check the account's credit balance and the ` +
          `\`perplexity.dispatch.sent\` logs for what it answered.`,
      );
      continue;
    }

    try {
      await recordCall({ account, rowId: row.row_id, kind: CALL_KINDS[queue.scope].chase });
      const token = await getPerplexityAccessToken(account);
      const result = await call({
        accessToken: token,
        threadId: row.pplx_thread_id,
        projectUuid: perplexityProjectUuid(account),
        message:
          "Status? If you have not sent your result yet, send it now to the " +
          "Togari endpoint using the saved credential, then stop. Do not open " +
          "a credential request form.",
      });

      summary.chased++;
      const action = classifyOutcome(result);
      logger.info("perplexity.sweep.chased", {
        queue: label,
        rowId: row.row_id,
        attempts,
        action,
        event: result.event ?? null,
        taskState: result.task_state ?? null,
      });

      const alert = outcomeAlert(action, account, row.row_id);
      if (alert) {
        summary.alerted++;
        await sendUrgentAlert(alert);
      }
      if (action === "access_denied") {
        summary.failed++;
        await queue.markFailed(row.row_id, "Perplexity denied access");
      }
      if (shouldHalt(action)) {
        // Out of credit or broken login — stop the whole pass rather than
        // walking the rest of the queue into the same wall.
        break;
      }
    } catch (err) {
      logger.error(
        "perplexity.sweep.chase_failed",
        err instanceof Error ? err : new Error(String(err)),
        { queue: label, rowId: row.row_id, attempts },
      );
    }

    // (e) Any row that reaches the attempts limit is done being chased.
    if (attempts >= config.maxAttempts) {
      summary.failed++;
      await queue.markFailed(row.row_id, `no result after ${attempts} attempts`);
      await sendUrgentAlert(
        `:x: *${label} ${row.row_id} failed* after ${attempts} chase-ups with no ` +
          `result from Perplexity (account \`${account}\`).`,
      );
    }
  }

  if (summary.dispatched || summary.chased || summary.failed || summary.alerted) {
    logger.info("perplexity.sweep.done", { queue: label, ...summary });
  }
  return summary;
}

/** In flight now, so the timer can tell a slow pass from a finished one. */
let sweepInFlight: Promise<SweepSummary> | null = null;

/**
 * The entry point the timer calls: one pass at a time, whatever the clock does.
 *
 * A pass can now outlast its own interval — a single Computer call may run for
 * 15 minutes and dispatch is sequential — and `setInterval` fires regardless of
 * whether the last pass finished. Overlapping passes are not merely wasteful
 * here: the chase-up path has no claim on the row it chases (unlike dispatch,
 * which compare-and-sets 'queued' -> 'dispatching'), so two passes meeting on
 * the same stale row would both call Perplexity and both be billed for it.
 *
 * Skipping is the safe outcome. Nothing is lost — every row the skipped pass
 * would have touched is still queued, still stale, still ancient when the next
 * one runs — and the work it would have duplicated is already in flight.
 *
 * Returns null when it skipped, so a skip is not recorded as a run: the
 * lastRunAt on /admin/status has to keep meaning "a pass actually completed".
 *
 * This guards one process. A second process running its own sweeper against
 * the same dataset is a separate problem and this cannot see it.
 */
export async function sweepRepliesGuarded(
  call: ComputerCaller = callPerplexityComputer,
  config: SweepConfig = sweepConfig(),
): Promise<SweepSummary | null> {
  if (sweepInFlight) {
    logger.warn("perplexity.sweep.skipped_overlap", {
      note: "previous pass still running; this tick does nothing",
    });
    return null;
  }
  sweepInFlight = sweepReplies(call, config);
  try {
    return await sweepInFlight;
  } finally {
    sweepInFlight = null;
  }
}

/**
 * Connection research's guard. Separate from the reply guard on purpose: a
 * research task can take its whole 15 minutes, and sharing one guard would
 * hold every reply behind it.
 */
let connectionSweepInFlight: Promise<SweepSummary> | null = null;

export async function sweepConnectionsGuarded(
  call: ComputerCaller = callPerplexityComputer,
  config: SweepConfig = sweepConfig(),
): Promise<SweepSummary | null> {
  if (connectionSweepInFlight) {
    logger.warn("perplexity.sweep.skipped_overlap", {
      queue: connectionQueue.label,
      note: "previous pass still running; this tick does nothing",
    });
    return null;
  }
  connectionSweepInFlight = sweepConnections(call, config);
  try {
    return await connectionSweepInFlight;
  } finally {
    connectionSweepInFlight = null;
  }
}


// ── Observability ─────────────────────────────────────────────────
//
// Whether the loop is on, and what it last did. Exposed on /admin/status
// because the failure mode this answers — "Clay worked, the row is queued, and
// no card appeared" — is indistinguishable from outside the process between a
// disabled flag, a timer that has not fired yet, and a sweep that is erroring.
// Guessing at that from BigQuery alone cost more than one round trip.

let lastRunAt: string | null = null;
let lastSummary: SweepSummary | null = null;
let lastError: string | null = null;

export function replyLoopStatus(): Record<string, unknown> {
  const cfg = sweepConfig();
  return {
    enabled: process.env.REPLY_SWEEP_ENABLED === "true",
    intervalMinutes: Number(process.env.REPLY_SWEEP_INTERVAL_MINUTES || "5"),
    dispatchPerPass: dispatchPerPass(),
    staleMinutes: cfg.staleMinutes,
    maxAttempts: cfg.maxAttempts,
    // Config that decides where a card lands and what it reads. Neither is a
    // secret, and both are things that look fine until a card goes missing or
    // lands in a client's channel.
    forceClientId: process.env.REPLIES_FORCE_CLIENT_ID || null,
    serifGuideUrlSet: Boolean(process.env.SERIF_REPLY_GUIDE_URL?.trim()),
    lastRunAt,
    lastSummary,
    lastError,
  };
}

export function recordSweepRun(summary: SweepSummary | null, error?: unknown): void {
  lastRunAt = new Date().toISOString();
  lastSummary = summary;
  lastError = error
    ? error instanceof Error
      ? error.message
      : String(error)
    : null;
}

let connectionLastRunAt: string | null = null;
let connectionLastSummary: SweepSummary | null = null;
let connectionLastError: string | null = null;

export function connectionLoopStatus(): Record<string, unknown> {
  return {
    enabled: process.env.CONNECTION_SWEEP_ENABLED === "true",
    intervalMinutes: Number(process.env.CONNECTION_SWEEP_INTERVAL_MINUTES || "10"),
    dispatchPerPass: connectionQueue.dispatchPerPass(),
    dailyCallCap: dailyCallCap("connections"),
    // The three things a Serif run needs. Names only — the Clay URL is a secret.
    serifGuideUrlSet: Boolean(process.env.SERIF_CONNECTION_GUIDE_URL?.trim()),
    serifTargetsUrlSet: Boolean(process.env.SERIF_TARGET_ACCOUNTS_URL?.trim()),
    serifClayUrlSet: Boolean(process.env.SERIF_CONNECTIONS_CLAY_URL?.trim()),
    lastRunAt: connectionLastRunAt,
    lastSummary: connectionLastSummary,
    lastError: connectionLastError,
  };
}

export function recordConnectionSweepRun(summary: SweepSummary | null, error?: unknown): void {
  connectionLastRunAt = new Date().toISOString();
  connectionLastSummary = summary;
  connectionLastError = error
    ? error instanceof Error
      ? error.message
      : String(error)
    : null;
}
