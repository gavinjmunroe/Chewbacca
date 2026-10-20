/**
 * Finishing a researched person: match against the client's sheet, save once,
 * add to the shared network, and send the paths to Clay.
 *
 * Shared by POST /connections/result (a full or top-up result from Perplexity)
 * and by the dispatcher when a person is served from the network with no call
 * (src/connections/queue.ts). Both go through the same matching, so a reused
 * path is held to exactly the rules a paid one is.
 */

import { createLogger } from "../observability/logger";
import { recordNetwork } from "../network/store";
import type { RecordOptions } from "../network/records";
import { claimConnectionResult, recordClayPosted, type ConnectionItemRow } from "./store";
import { connectionSourcesFor } from "./task-message";
import { loadTargets, type TargetAccount } from "./targets";
import {
  buildConnections,
  clayRows,
  collectTargetContacts,
  postToClay,
  withTargetContacts,
} from "./results";
import type { ConnectionResultPayload } from "./types";

const logger = createLogger("connections/finish");

export interface FinishInput {
  /** What is stored as result_json: what Perplexity posted, or what was reused. */
  raw: ConnectionResultPayload;
  /** What is matched: raw, or for a top-up raw merged with the stored histories. */
  matched: ConnectionResultPayload;
  /**
   * How raw goes into the shared network. Null for a row served from the
   * network: re-recording it would restart the freshness clock on facts
   * nobody re-checked.
   */
  network: RecordOptions | null;
}

export interface FinishOutcome {
  claimed: boolean;
  connectionsFound: number | null;
  clayPosted: number;
}

export async function finishConnectionResult(
  row: ConnectionItemRow,
  input: FinishInput,
): Promise<FinishOutcome> {
  const rowId = row.row_id;
  const { raw, matched } = input;

  // Match against the sheet before saving, so what is stored is what Clay
  // gets. If the sheet cannot be read at all, the raw answer is still saved —
  // every employer is in result_json — and nothing goes to Clay rather than
  // something unchecked.
  let clayUrl: string | null = null;
  let targets: TargetAccount[] | null = null;
  try {
    const sources = connectionSourcesFor(row.client_id ?? "");
    clayUrl = sources.clayUrl;
    targets = await loadTargets(sources.targetsUrl);
  } catch (err) {
    logger.error(
      "connections.result.targets_unavailable",
      err instanceof Error ? err : new Error(String(err)),
      { rowId },
    );
  }
  const connections = targets ? buildConnections(row, matched, targets) : null;
  const contacts = targets ? collectTargetContacts(matched, targets) : new Map();
  const expected = targets?.length ?? null;

  const claimed = await claimConnectionResult({
    rowId,
    identityConfirmed: matched.identity_confirmed ?? null,
    targetRowsRead: matched.target_rows_read ?? null,
    targetRowsExpected: expected,
    connectionsFound: connections?.length ?? null,
    connectionsJson: connections ? JSON.stringify(withTargetContacts(connections, contacts)) : null,
    resultJson: JSON.stringify(raw),
  });
  if (!claimed) {
    logger.info("connections.result.duplicate", { rowId });
    return { claimed: false, connectionsFound: connections?.length ?? null, clayPosted: 0 };
  }

  // Every result also goes into the shared network (togari_core), for reuse
  // across clients. Not awaited: it never throws, the client's result is
  // already saved, and Perplexity should not wait on it.
  if (input.network) void recordNetwork(row, raw, targets, new Date(), input.network);

  let clayPosted = 0;
  if (connections && clayUrl) {
    clayPosted = await postToClay(clayUrl, clayRows(row, matched, connections, expected, contacts));
    await recordClayPosted(rowId, clayPosted);
  } else if (connections) {
    logger.warn("connections.result.no_clay_table", { rowId, clientId: row.client_id });
  }

  logger.info("connections.result.saved", {
    rowId,
    people: matched.people?.length ?? 0,
    connections: connections?.length ?? null,
    targetContacts: matched.target_contacts?.length ?? 0,
    clayPosted,
  });
  return { claimed: true, connectionsFound: connections?.length ?? null, clayPosted };
}
