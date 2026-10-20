/**
 * Reply drafting as a Perplexity work queue.
 *
 * An adapter, not a rewrite: every operation is the existing reply_items
 * function in ./store, so the reply path runs exactly the SQL it always has.
 */

import type { PerplexityQueue } from "../perplexity/queue";
import { buildTaskMessage } from "../perplexity/task-message";
import {
  claimForDispatch,
  findAncient,
  findQueuedRows,
  findStuckDispatched,
  findStuckDispatching,
  markDispatched,
  markFailed,
  recordChaseAttempt,
  requeueReply,
  saveDispatchIdentity,
  type ReplyItemRow,
} from "./store";

/** Queued replies sent per pass. Bounded so a backlog drains, not detonates. */
export function dispatchPerPass(): number {
  const n = Number(process.env.REPLY_DISPATCH_PER_PASS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 25) : 5;
}

export const replyQueue: PerplexityQueue<ReplyItemRow> = {
  label: "Reply",
  scope: "replies",
  dispatchPerPass,
  requeueHint: "npx tsx scripts/requeue-failed-replies.ts",
  buildMessage: buildTaskMessage,
  findQueued: findQueuedRows,
  claimForDispatch,
  saveDispatchIdentity,
  markDispatched,
  markFailed,
  requeue: requeueReply,
  findStuckDispatching,
  findAncient,
  findStuckDispatched,
  recordChaseAttempt,
};
