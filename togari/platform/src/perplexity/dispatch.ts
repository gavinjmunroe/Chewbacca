/**
 * Sending queued work to Perplexity (plan step 06).
 *
 * Written for replies and now shared with connection research: each queue
 * supplies its table and its message (./queue.ts), and the ordering below
 * applies to both unchanged.
 *
 * The order of the writes is the whole point of this file:
 *
 *   queued -> dispatching   saved BEFORE Perplexity is contacted
 *   (call)
 *   thread_id + account     saved immediately when the call returns
 *   -> dispatched           saved after
 *
 * If Togari dies between the call and the identity save, the row is left on
 * `dispatching`, which means exactly one thing: the AI may have started paid
 * work we have no id for. Such a row must NEVER be retried automatically —
 * retrying might start the same paid task a second time. Step 08 alerts on them
 * and lets a person decide. Merging these writes would make that state
 * invisible and unfixable.
 */

import { createLogger } from "../observability/logger";
import type { ReplyItemRow } from "../replies/store";
import { replyQueue } from "../replies/queue";
import type { PerplexityQueue, QueueRow } from "./queue";
import {
  dispatchBudgetMs,
  perplexityAccountForClient,
  perplexityProjectUuid,
} from "./config";
import {
  getPerplexityAccessToken,
  haltPerplexityAccount,
  isPerplexityHalted,
  sendUrgentAlert,
} from "./tokens";
import { classifyOutcome, outcomeAlert, shouldHalt } from "./outcome";
import { callPerplexityComputer, type ComputerCaller } from "./computer";
import { CALL_KINDS, isOverDailyCap, recordCall } from "./call-log";

const logger = createLogger("perplexity/dispatch");

export interface DispatchOutcome {
  rowId: string;
  /** served: the queue finished the row from data it holds, with no call. */
  status: "dispatched" | "served" | "skipped" | "failed";
  account?: string;
  threadId?: string | null;
  taskState?: string;
  reason?: string;
}

/**
 * Send one queued reply to Perplexity.
 *
 * `call` is injectable so the ordering above can be tested without a live MCP
 * server — that ordering is the part worth testing.
 */
export async function dispatchReply(
  row: ReplyItemRow,
  call: ComputerCaller = callPerplexityComputer,
): Promise<DispatchOutcome> {
  return dispatchRow(replyQueue, row, call);
}

/** Send one queued row from any queue. */
export async function dispatchRow<R extends QueueRow>(
  queue: PerplexityQueue<R>,
  row: R,
  call: ComputerCaller = callPerplexityComputer,
): Promise<DispatchOutcome> {
  const clientId = row.client_id ?? "serif";
  const account = perplexityAccountForClient(clientId);

  // A queue that can answer from what it already holds goes first: serving a
  // row costs nothing, so neither a halt nor the cap should hold it up.
  let planned: string | null = null;
  if (queue.plan) {
    try {
      const plan = await queue.plan(row);
      if (plan?.served) return { rowId: row.row_id, status: "served", account };
      if (plan) planned = plan.message;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn("perplexity.dispatch.message_unavailable", {
        queue: queue.label,
        rowId: row.row_id,
        reason,
      });
      return { rowId: row.row_id, status: "skipped", account, reason };
    }
  }

  // Don't spend against a login we already know is broken, and don't burn the
  // row's one claim doing it.
  if (isPerplexityHalted(account)) {
    return {
      rowId: row.row_id,
      status: "skipped",
      account,
      reason: `account "${account}" is halted`,
    };
  }

  // The cap counts dispatches as well as chase-ups, or the protection only
  // covers half the spend.
  if (await isOverDailyCap(account, queue.scope)) {
    return {
      rowId: row.row_id,
      status: "skipped",
      account,
      reason: `daily ${queue.scope} call cap reached for "${account}"`,
    };
  }

  // Built before the claim, because building can fail — connection research
  // reads the client's target sheet here — and a message that cannot be built
  // must cost nothing. The row stays queued and the next pass tries again.
  let message: string;
  try {
    message = planned ?? (await queue.buildMessage(row));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("perplexity.dispatch.message_unavailable", {
      queue: queue.label,
      rowId: row.row_id,
      reason,
    });
    return { rowId: row.row_id, status: "skipped", account, reason };
  }

  // (b) Claim first. A lost claim means another dispatcher has it.
  const claimed = await queue.claimForDispatch(row.row_id);
  if (!claimed) {
    return { rowId: row.row_id, status: "skipped", reason: "not queued any more" };
  }

  let accessToken: string;
  try {
    accessToken = await getPerplexityAccessToken(account);
  } catch (err) {
    // No token means nothing was sent, so this row is safe to put back.
    // Explicitly NOT left on dispatching: nothing was started, so there is no
    // paid work in flight and no reason to make a person adjudicate it.
    const reason = err instanceof Error ? err.message : String(err);
    await queue.markFailed(row.row_id, `no Perplexity token: ${reason}`);
    return { rowId: row.row_id, status: "failed", account, reason };
  }

  let result;
  try {
    await recordCall({ account, rowId: row.row_id, kind: CALL_KINDS[queue.scope].dispatch });
    // (e) Send the task.
    result = await call({
      accessToken,
      message,
      projectUuid: perplexityProjectUuid(account),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Deliberately left on `dispatching`. The call may have reached Perplexity
    // and started work before failing, so this is exactly the ambiguous case a
    // person must look at rather than a retry loop.
    logger.error(
      "perplexity.dispatch.call_failed",
      err instanceof Error ? err : new Error(reason),
      { queue: queue.label, rowId: row.row_id, account, note: "row left on dispatching for review" },
    );
    return { rowId: row.row_id, status: "failed", account, reason };
  }

  // (f) Read what came back BEFORE treating it as sent.
  //
  // This used to log the result and nothing else, which made two of the
  // outcomes invisible. An account out of credit answers every dispatch with a
  // refusal carrying no thread id; the row was marked 'dispatched' anyway, and
  // the sweeper failed it 15 minutes later for having no thread to chase. The
  // classifier that names this outcome — and the halt that should have stopped
  // the account after the first one — only ran on the chase path, which that
  // same missing thread id makes unreachable. So the detection existed and
  // could never fire: 35 replies in a row were dispatched, refused, and failed
  // in silence over two days.
  const action = classifyOutcome(result);

  if (shouldHalt(action)) {
    // Out of credit, or a broken login. Either way the task did NOT run, so
    // the row goes back on the queue rather than to 'failed' — there is no
    // paid work in flight to duplicate, and a queued row drains by itself once
    // the account is fixed instead of needing a person to re-queue it.
    await queue.requeue(row.row_id);
    haltPerplexityAccount(
      account,
      `dispatch refused: ${action}`,
      outcomeAlert(action, account, row.row_id) ??
        `:octagonal_sign: *Perplexity stopped accepting work for \`${account}\`* (${action}).`,
    );
    return { rowId: row.row_id, status: "skipped", account, reason: action };
  }

  if (action === "access_denied") {
    // Refused on its merits rather than for money, so re-sending it would be
    // refused again. This one really is failed.
    await queue.markFailed(row.row_id, "Perplexity denied the task");
    const alert = outcomeAlert(action, account, row.row_id);
    if (alert) await sendUrgentAlert(alert);
    return { rowId: row.row_id, status: "failed", account, reason: action };
  }

  // (g) Save who and which conversation, immediately, before anything else.
  await queue.saveDispatchIdentity({
    rowId: row.row_id,
    threadId: result.thread_id ?? null,
    account,
  });

  // (h) Only then is it "sent, waiting on the AI".
  await queue.markDispatched(row.row_id);

  // Log the shape as well as the values. Perplexity's real replies do not
  // always carry task_state — a completed one came back as
  // {thread_id, event, text} only — so the plan's documented shape is a
  // superset, and step 07 has to read `event` too rather than assuming
  // task_state is there.
  logger.info("perplexity.dispatch.sent", {
    queue: queue.label,
    rowId: row.row_id,
    account,
    threadId: result.thread_id ?? null,
    event: result.event ?? null,
    taskState: result.task_state ?? null,
    fields: Object.keys(result).sort().join(","),
  });

  return {
    rowId: row.row_id,
    status: "dispatched",
    account,
    threadId: result.thread_id ?? null,
    taskState: result.task_state,
  };
}

/**
 * Take the oldest queued rows and send them. Step 08 schedules this. Replies
 * unless another queue is named.
 *
 * Sequential, and bounded in time as well as in count. Each call can now run
 * for as long as a Computer task takes (up to 15 minutes), so `limit` alone no
 * longer bounds the pass — five slow rows would hold the sweep for over an
 * hour, and everything the sweep does after dispatching would wait on them.
 * The budget is checked before each row rather than during one: a call already
 * in flight has been paid for and is always allowed to finish.
 */
export async function dispatchQueued<R extends QueueRow = ReplyItemRow>(
  limit = 1,
  call: ComputerCaller = callPerplexityComputer,
  queue: PerplexityQueue<R> = replyQueue as unknown as PerplexityQueue<R>,
): Promise<DispatchOutcome[]> {
  const rows = await queue.findQueued(limit);
  const budget = dispatchBudgetMs();
  const startedAt = Date.now();
  const outcomes: DispatchOutcome[] = [];

  for (const row of rows) {
    const spent = Date.now() - startedAt;
    if (outcomes.length > 0 && spent >= budget) {
      // Not an error: the remaining rows stay queued and the next pass takes
      // them. Logged because a pass that keeps ending early is Perplexity
      // telling us it is degraded.
      logger.warn("perplexity.dispatch.budget_spent", {
        queue: queue.label,
        dispatched: outcomes.length,
        leftQueued: rows.length - outcomes.length,
        spentMs: spent,
        budgetMs: budget,
      });
      break;
    }
    outcomes.push(await dispatchRow(queue, row, call));
  }
  return outcomes;
}
