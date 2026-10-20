/**
 * Read-only Google Calendar REST route.
 *
 * Mounted at /api/v1, so the full path is:
 *   GET /api/v1/calendar
 *
 * Query params:
 *   user        BMA user to read (default GMAIL_INGEST_USER or sagar@bluemodernadvisory.com).
 *   since_days  how many days back to look for events (default 90).
 *   max         maximum number of events to return (default 100, max 250).
 *
 * Returns the fetched events as JSON. This route is strictly READ ONLY:
 * fetchCalendarEvents never writes to the calendar, BigQuery, or the CRM.
 * Missing creds / unauthorized scope resolve to a 200 with configured=false
 * and a note (never a 500 for the expected not-configured case).
 */

import { Router } from "express";
import { fetchCalendarEvents } from "../sources/calendar-fetch";
import { createLogger } from "../observability/logger";

const logger = createLogger("routes/calendar");

function queryValue(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}

/** Parse a positive integer query param, or undefined when absent/invalid. */
function intParam(v: unknown): number | undefined {
  const raw = queryValue(v);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function createCalendarRouter(): Router {
  const router = Router();

  // GET /calendar — read-only list of recent calendar events.
  router.get("/calendar", async (req, res) => {
    try {
      const user = queryValue(req.query.user);
      const sinceDays = intParam(req.query.since_days);
      const maxEvents = intParam(req.query.max);

      const result = await fetchCalendarEvents({
        user,
        sinceDays,
        maxEvents,
      });

      logger.info("calendar.request", {
        user: result.user,
        configured: result.configured,
        fetched: result.fetched,
      });

      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "calendar.request.failed",
        err instanceof Error ? err : new Error(message),
      );
      res.status(500).json({ error: "calendar_failed", message });
    }
  });

  return router;
}
