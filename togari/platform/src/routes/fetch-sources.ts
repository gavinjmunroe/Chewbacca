/**
 * Read-only source-retrieval REST routes.
 *
 * Mounted at /api/v1, so the full paths are:
 *   GET /api/v1/fetch/gmail
 *   GET /api/v1/fetch/fireflies
 *
 * Both endpoints FETCH and RETURN raw source data as JSON for reporting. They
 * are strictly READ ONLY: neither writes to BigQuery or the CRM.
 *
 * Gmail query params:  user, since_days, max, query
 * Fireflies query params:  since_days, max
 */

import { Router } from "express";
import { fetchGmailMessages } from "../sources/gmail-fetch";
import { fetchFirefliesMeetings } from "../sources/fireflies-fetch";
import { createLogger } from "../observability/logger";

const logger = createLogger("routes/fetch-sources");

function queryString(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}

/** Parse a positive integer query param, or undefined when absent/invalid. */
function queryInt(v: unknown): number | undefined {
  const s = queryString(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function createFetchRouter(): Router {
  const router = Router();

  // GET /fetch/gmail — read-only Gmail message list.
  router.get("/fetch/gmail", async (req, res) => {
    try {
      const result = await fetchGmailMessages({
        user: queryString(req.query.user),
        sinceDays: queryInt(req.query.since_days),
        max: queryInt(req.query.max),
        query: queryString(req.query.query),
      });
      logger.info("fetch.gmail", {
        user: result.user,
        fetched: result.fetched,
        configured: result.configured,
      });
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "fetch.gmail.failed",
        err instanceof Error ? err : new Error(message),
      );
      res.status(500).json({ error: "gmail_fetch_failed", message });
    }
  });

  // GET /fetch/fireflies — read-only Fireflies meeting list.
  router.get("/fetch/fireflies", async (req, res) => {
    try {
      const result = await fetchFirefliesMeetings({
        sinceDays: queryInt(req.query.since_days),
        max: queryInt(req.query.max),
      });
      logger.info("fetch.fireflies", {
        fetched: result.fetched,
        configured: result.configured,
      });
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "fetch.fireflies.failed",
        err instanceof Error ? err : new Error(message),
      );
      res.status(500).json({ error: "fireflies_fetch_failed", message });
    }
  });

  return router;
}
