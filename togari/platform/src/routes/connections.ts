/**
 * Warm-intro connection research: Clay -> Togari -> Perplexity -> Togari -> Clay.
 *
 * POST /connections
 *   Authorization: Bearer <REPLIES_INGEST_TOKEN>  (the reply intake's token)
 *   Body: ConnectionIngestPayload — one person at a client's existing customer
 *   201 { id, row_id, state: 'queued', duplicate: false }
 *   200 { id, row_id, state, duplicate: true }
 *   400 invalid_payload | unknown_client_id | client_not_set_up
 *
 * POST /connections/result
 *   Authorization: Bearer <REPLY_RESULT_TOKEN>  (the credential already in the
 *   client's Perplexity project vault for this host)
 *   Body: ConnectionResultPayload
 *   200 { row_id, state: 'done', connections_found, clay_posted }
 *
 * Clay gets one row per path: customer contact -> bridge -> target account ->
 * the person in the buyer seat there (src/connections/results.ts).
 *
 * POST /connections/paths
 *   Authorization: Bearer <REPLIES_INGEST_TOKEN>
 *   Body: ConnectionPathPayload — one row of the Clay results table
 *   201 { path_id, state: 'pending' } — waits for the next daily digest
 *
 * Same shape as /replies, and the same rules: a repeat intake is a 200, and
 * the callback answers 2xx for anything it has recorded, because Perplexity
 * retrying a non-2xx re-runs paid work.
 */

import express, { type Request, type Response, type Router } from "express";
import { createLogger } from "../observability/logger";
import { getReplybotClient } from "../agents/replybot/client-config";
import {
  ConnectionIngestPayload,
  ConnectionPathPayload,
  ConnectionResultPayload,
} from "../connections/types";
import { insertPath, isEmail } from "../connections/paths";
import {
  connectionItemId,
  findConnectionItem,
  findPersonEmail,
  getConnectionItem,
  getResearchMode,
  insertQueuedConnection,
} from "../connections/store";
import { finishConnectionResult } from "../connections/finish";
import { parseReused } from "../connections/queue";
import { mergeResults } from "../network/reuse";
import type { RecordOptions } from "../network/records";
import { bearerAuth } from "./replies";

const logger = createLogger("routes/connections");

/**
 * For a top-up row, the result to match (merged with the stored histories)
 * and how to record it in the network: the subject was not researched again,
 * and the colleagues already known stay in the run. Anything else is matched
 * and recorded as it came.
 */
async function withStoredHistories(
  rowId: string,
  result: ConnectionResultPayload,
): Promise<{ matched: ConnectionResultPayload; network: RecordOptions }> {
  let mode: string | null = null;
  let reusedJson: string | null = null;
  try {
    ({ mode, reusedJson } = await getResearchMode(rowId));
  } catch (err) {
    // Never a 500 over this: Perplexity retrying the callback re-runs paid work.
    logger.error(
      "connections.result.research_mode_unreadable",
      err instanceof Error ? err : new Error(String(err)),
      { rowId },
    );
  }
  if (mode !== "topup") return { matched: result, network: {} };
  const reused = parseReused(reusedJson);
  if (!reused) {
    // The stored half is gone or unreadable: the top-up alone is still real
    // research, just fewer paths. Logged so it can be replayed.
    logger.warn("connections.result.topup_without_stored", { rowId });
    return { matched: result, network: { subjectResearched: false } };
  }
  return {
    matched: mergeResults(reused.result, result),
    network: { subjectResearched: false, priorColleagueIds: reused.colleague_ids },
  };
}

export function createConnectionsRouter(): Router {
  const router: Router = express.Router();
  // A result is every employer of up to nine people, with a source per role,
  // plus the buyer seats at up to five target accounts.
  router.use(express.json({ limit: "1mb" }));

  router.post("/", bearerAuth("REPLIES_INGEST_TOKEN"), async (req: Request, res: Response) => {
    const parsed = ConnectionIngestPayload.safeParse(req.body);
    if (!parsed.success) {
      logger.warn("connections.invalid_payload", {
        fields: Object.keys(parsed.error.flatten().fieldErrors),
      });
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const payload = parsed.data;
    const rowId = payload.row_id.trim();
    const clientId = payload.client_id.trim();

    const client = getReplybotClient(clientId);
    if (!client) {
      return res
        .status(400)
        .json({ error: "unknown_client_id", detail: `No client "${clientId}"` });
    }
    if (!client.connections) {
      return res.status(400).json({
        error: "client_not_set_up",
        detail: `"${clientId}" has no connection research configured`,
      });
    }

    try {
      const existing = await findConnectionItem(rowId);
      if (existing) {
        return res.status(200).json({
          id: existing.id,
          row_id: existing.row_id,
          state: existing.state,
          duplicate: true,
        });
      }
      const { id, inserted } = await insertQueuedConnection(payload, clientId);
      if (!inserted) {
        return res.status(200).json({ id, row_id: rowId, state: "queued", duplicate: true });
      }
      logger.info("connections.queued", { rowId, clientId });
      return res.status(201).json({ id, row_id: rowId, state: "queued", duplicate: false });
    } catch (err) {
      logger.error(
        "connections.intake_failed",
        err instanceof Error ? err : new Error(String(err)),
        { rowId, id: connectionItemId(rowId) },
      );
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.post(
    "/result",
    bearerAuth("REPLY_RESULT_TOKEN"),
    async (req: Request, res: Response) => {
      const parsed = ConnectionResultPayload.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      }
      const result = parsed.data;
      const rowId = result.row_id.trim();

      try {
        const row = await getConnectionItem(rowId);
        if (!row) {
          logger.warn("connections.result.unknown_row", { rowId });
          return res.status(404).json({ error: "unknown_row_id" });
        }

        // A top-up answered only what the network was missing. Merge it with
        // the stored histories it started from, so the paths cover both
        // (src/network/reuse.ts).
        const { matched, network } = await withStoredHistories(rowId, result);
        const out = await finishConnectionResult(row, { raw: result, matched, network });
        if (!out.claimed) {
          return res.status(200).json({ row_id: rowId, state: "done", duplicate: true });
        }
        return res.status(200).json({
          row_id: rowId,
          state: "done",
          connections_found: out.connectionsFound,
          clay_posted: out.clayPosted,
        });
      } catch (err) {
        logger.error(
          "connections.result.failed",
          err instanceof Error ? err : new Error(String(err)),
          { rowId },
        );
        return res.status(500).json({ error: "internal_error" });
      }
    },
  );

  /**
   * POST /connections/paths — Clay's results table hands over one path for the
   * daily Slack digest (src/connections/digest.ts).
   *
   * Only paths that end at a named buyer and that Togari matched itself
   * (domain, name, parent_domain) are kept. Anything else answers 200
   * "skipped" with the reason, so Clay's auto-retry leaves it alone; the
   * column's run condition should already have filtered it out.
   *
   * A path already known — same champion, bridge, target and buyer — is a
   * 200 duplicate, which is how a path marked Not a fit stays gone.
   */
  router.post("/paths", bearerAuth("REPLIES_INGEST_TOKEN"), async (req: Request, res: Response) => {
    const parsed = ConnectionPathPayload.safeParse(req.body);
    if (!parsed.success) {
      logger.warn("connections.paths.invalid_payload", {
        fields: Object.keys(parsed.error.flatten().fieldErrors),
      });
      return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const path = parsed.data;
    const client = getReplybotClient(path.client_id);
    if (!client?.connections) {
      return res.status(400).json({
        error: "client_not_set_up",
        detail: `"${path.client_id}" has no connection research configured`,
      });
    }
    if (!PATH_MATCHES.has(path.match ?? "")) {
      return res.status(200).json({
        state: "skipped",
        reason: `match "${path.match ?? "none"}" is not one Togari confirmed`,
      });
    }

    try {
      // The email Clay sent with the path, else the one intake recorded for
      // the person. A row id that is an email is the last resort, applied
      // when the digest renders.
      const email = isEmail(path.person_email)
        ? path.person_email.trim()
        : path.person_row_id
          ? await findPersonEmail(path.person_row_id)
          : null;
      const { pathId, inserted } = await insertPath(path, email);
      if (!inserted) {
        return res.status(200).json({ path_id: pathId, state: "known", duplicate: true });
      }
      logger.info("connections.paths.queued", { pathId, clientId: path.client_id });
      return res.status(201).json({ path_id: pathId, state: "pending", duplicate: false });
    } catch (err) {
      logger.error(
        "connections.paths.failed",
        err instanceof Error ? err : new Error(String(err)),
        { clientId: path.client_id },
      );
      return res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}

/** The matches Togari checked against the sheet itself. model_only is not one. */
const PATH_MATCHES = new Set(["domain", "name", "parent_domain"]);
