/**
 * Connection research as a Perplexity work queue: connection_items' table, the
 * research task as its message, and its own small budget.
 *
 * Before anything is paid for, each person is looked up in the shared network
 * (src/network/reuse.ts): served from it with no call, topped up with a
 * smaller call, or researched in full as before.
 */

import { createLogger } from "../observability/logger";
import type { PerplexityQueue } from "../perplexity/queue";
import { planResearch, type ResearchPlan } from "../network/reuse";
import { finishConnectionResult } from "./finish";
import {
  connectionQueueStore,
  recordResearchMode,
  researchModeColumns,
  type ConnectionItemRow,
} from "./store";
import {
  buildConnectionTaskMessage,
  buildTopUpTaskMessage,
  connectionSourcesFor,
  connectionTaskMessageFor,
} from "./task-message";
import { loadTargets } from "./targets";
import { ConnectionResultPayload } from "./types";

export type { ConnectionItemRow };

const logger = createLogger("connections/queue");

/**
 * People researched per pass. One by default: each task can run for its whole
 * 15 minutes, and a backfill should trickle through, not arrive as a bill.
 */
export function connectionDispatchPerPass(): number {
  const n = Number(process.env.CONNECTION_DISPATCH_PER_PASS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 1;
}

/** What connection_items.reused_result_json holds. */
export interface ReusedEnvelope {
  /** The stored histories, as a ConnectionResultPayload. */
  result: ConnectionResultPayload;
  /** network_people ids of the colleagues reused, for the top-up's run row. */
  colleague_ids: string[];
}

export function parseReused(json: string | null): ReusedEnvelope | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as { result?: unknown; colleague_ids?: unknown };
    const result = ConnectionResultPayload.safeParse(raw.result);
    if (!result.success) return null;
    const ids = Array.isArray(raw.colleague_ids) ? raw.colleague_ids.map(String) : [];
    return { result: result.data, colleague_ids: ids };
  } catch {
    return null;
  }
}

/**
 * Decide how to research a queued row, and act on a reuse.
 *
 * Reads the sheet first, as buildMessage does, so a sheet that cannot be read
 * still costs nothing and leaves the row queued. A failure reading the network
 * is not that: it falls back to full research.
 */
export async function planConnectionResearch(
  row: ConnectionItemRow,
): Promise<{ served: true } | { served: false; message: string }> {
  const sources = connectionSourcesFor(row.client_id ?? "");
  const targets = await loadTargets(sources.targetsUrl);
  const fullMessage = () => buildConnectionTaskMessage(row, sources, targets.length);

  // Until migration 0050 is applied there is nowhere to keep a top-up's stored
  // half, so reuse waits for it and every row is researched as before.
  if (!(await researchModeColumns())) return { served: false, message: fullMessage() };

  let plan: ResearchPlan;
  try {
    plan = await planResearch(row, targets);
  } catch (err) {
    logger.error(
      "connections.network.lookup_failed",
      err instanceof Error ? err : new Error(String(err)),
      { rowId: row.row_id },
    );
    plan = { mode: "full", reason: "network lookup failed" };
  }

  if (plan.mode === "full") {
    await recordResearchMode(row.row_id, "full", null);
    logger.info("connections.research.full", { rowId: row.row_id, reason: plan.reason });
    return { served: false, message: fullMessage() };
  }

  const envelope = JSON.stringify({ result: plan.stored, colleague_ids: plan.colleagueIds });
  await recordResearchMode(row.row_id, plan.mode, envelope);

  if (plan.mode === "reuse") {
    // Claimed like a dispatch, so a second sweeper cannot also send it.
    if (!(await connectionQueueStore.claimForDispatch(row.row_id))) {
      throw new Error("not queued any more");
    }
    let out;
    try {
      out = await finishConnectionResult(row, {
        raw: plan.stored,
        matched: plan.stored,
        network: null,
      });
    } catch (err) {
      // Nothing was sent, so 'dispatching' would be a false alarm about paid
      // work in flight. Back on the queue for the next pass.
      await connectionQueueStore.requeue(row.row_id);
      throw err;
    }
    logger.info("connections.research.reused", {
      rowId: row.row_id,
      clientId: row.client_id,
      researchedAt: plan.researchedAt,
      people: plan.stored.people?.length ?? 0,
      targetContacts: plan.stored.target_contacts?.length ?? 0,
      connections: out.connectionsFound,
      // One full research task not paid for.
      callsSaved: 1,
    });
    return { served: true };
  }

  logger.info("connections.research.topup", {
    rowId: row.row_id,
    clientId: row.client_id,
    researchedAt: plan.researchedAt,
    reusedPeople: plan.stored.people?.length ?? 0,
    colleaguesWanted: plan.request.colleagues !== null,
    buyerTargets: plan.request.buyerTargets.length,
    // A smaller task in place of the full one: no call saved, but the person
    // and their known colleagues are not researched again.
    callsSaved: 0,
    fullResearchAvoided: true,
  });
  return {
    served: false,
    message: buildTopUpTaskMessage(row, sources, targets.length, plan.request),
  };
}

export const connectionQueue: PerplexityQueue<ConnectionItemRow> = {
  label: "Connection search",
  scope: "connections",
  dispatchPerPass: connectionDispatchPerPass,
  requeueHint:
    "UPDATE togari_data_lake.connection_items SET state = 'queued', attempts = 0, " +
    "pplx_thread_id = NULL, pplx_account = NULL WHERE row_id = '<row_id>'",
  buildMessage: connectionTaskMessageFor,
  plan: planConnectionResearch,
  ...connectionQueueStore,
};
