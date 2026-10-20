/**
 * Interpreting what Perplexity sends back (plan step 07).
 *
 * Three of these need opposite reactions, so none of them may be collapsed
 * into "an error". The safe default is to change nothing and let the sweeper
 * chase it — never to retry, because a retry can start the same paid work
 * twice.
 *
 * Measured, and why this reads two fields: a completed call came back as
 * {thread_id, event, text} with event "complete" and NO task_state at all. The
 * plan documents task_state as though it is always there. It is not.
 */

import type { ComputerResult } from "./computer";

export type OutcomeAction =
  /** Finished. The result should already have reached /replies/result. */
  | "complete"
  /** Still working. Leave it alone, touch updated_at, let the sweeper chase. */
  | "working"
  /** Out of money. Alert billing. Never retry — that only spends faster. */
  | "insufficient_credits"
  /** Login broken. Urgent alert, stop sending work for this account. */
  | "auth_required"
  /** Refused. Mark the row failed and alert. */
  | "access_denied"
  /** Unknown. Log it, leave the row dispatched, let the sweeper chase. */
  | "unknown";

/** Does this outcome mean the row should stop being worked on entirely? */
export function isTerminalFailure(action: OutcomeAction): boolean {
  return action === "access_denied";
}

/** Should Togari stop sending work for this account? */
export function shouldHalt(action: OutcomeAction): boolean {
  return action === "auth_required" || action === "insufficient_credits";
}

/**
 * Classify a result. Reads `event` and `task_state` interchangeably, because
 * Perplexity populates one, the other, or only one of them depending on the
 * call, and treating a missing task_state as "unrecognised" would send every
 * successful call down the unknown path.
 */
export function classifyOutcome(result: ComputerResult): OutcomeAction {
  const signals = [result.task_state, result.event]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase());

  if (signals.length === 0) return "unknown";

  // Checked in severity order: a result carrying both "complete" and an auth
  // problem is an auth problem.
  if (signals.includes("auth_required") || signals.includes("unauthorized")) {
    return "auth_required";
  }
  if (signals.includes("insufficient_credits") || signals.includes("out_of_credits")) {
    return "insufficient_credits";
  }
  if (signals.includes("access_denied") || signals.includes("forbidden")) {
    return "access_denied";
  }
  if (signals.includes("complete") || signals.includes("completed")) {
    return "complete";
  }
  if (
    signals.includes("waiting") ||
    signals.includes("sleep") ||
    signals.includes("sleeping") ||
    signals.includes("timeout") ||
    signals.includes("running") ||
    signals.includes("in_progress")
  ) {
    return "working";
  }
  return "unknown";
}

/** What to tell a human, for the outcomes that need one. */
export function outcomeAlert(
  action: OutcomeAction,
  account: string,
  rowId: string,
): string | null {
  switch (action) {
    case "insufficient_credits":
      return (
        `:credit_card: *Perplexity account \`${account}\` is out of credit.*\n` +
        `Reply drafting has stopped for it (row ${rowId}). Nothing is being ` +
        `retried — retrying only spends what is left faster. Whoever handles ` +
        `billing needs to top it up.`
      );
    case "auth_required":
      return (
        `:rotating_light: *Perplexity login for \`${account}\` is broken.*\n` +
        `Reply drafting has stopped (row ${rowId}). Re-run: ` +
        `\`npx tsx scripts/perplexity-signin.ts --client=<id>\``
      );
    case "access_denied":
      return (
        `:no_entry: *Perplexity refused the task* for row ${rowId} ` +
        `(account \`${account}\`). The row is marked failed and needs a look.`
      );
    default:
      return null;
  }
}
