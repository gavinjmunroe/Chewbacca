/**
 * Clay → Togari campaign events, for the campaign calendar.
 *
 * POST /campaign-events
 *   Authorization: Bearer <CAMPAIGN_EVENTS_TOKEN>
 *   Body: one row of a campaign's Clay Events table (src/campaigns/events.ts)
 *
 * Response:
 *   201 { stored: true }                       — streamed into campaign_events
 *   200 { stored: false, reason }              — an open, a click, Clay's sample rows, another client's campaign
 *   400 { error: 'invalid_payload' | 'unknown_client_id' | 'no_campaign_calendar' }
 *   401 { error: 'unauthorized' }
 *   500 { error: 'CAMPAIGN_EVENTS_TOKEN not configured' | 'internal_error' }
 *
 * Events Togari doesn't count answer 200, not 400: Clay retries what fails,
 * and an open is not worth a retry. Setup: docs/CAMPAIGN_CALENDAR_NEW_CLIENT.md.
 *
 * Own scoped express.json(), so it mounts before the global one, like /replies.
 */
import express, { Router } from "express";
import type { Request, Response } from "express";
import { getReplybotClient } from "../agents/replybot/client-config";
import {
  CampaignEventPayload,
  eventRow,
  insertCampaignEvent,
} from "../campaigns/events";
import { bearerAuth } from "./replies";
import { createLogger } from "../observability/logger";

const logger = createLogger("routes/campaign-events");

export function createCampaignEventsRouter(): Router {
  const router: Router = express.Router();
  // A row may carry a reply's whole quoted thread for sorting.
  router.use(express.json({ limit: "1mb" }));

  router.post(
    "/",
    bearerAuth("CAMPAIGN_EVENTS_TOKEN"),
    async (req: Request, res: Response) => {
      const parsed = CampaignEventPayload.safeParse(req.body);
      if (!parsed.success) {
        logger.warn("campaign_events.invalid_payload", {
          fields: Object.keys(parsed.error.flatten().fieldErrors),
        });
        return res.status(400).json({
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }
      const p = parsed.data;
      const clientId = p.client_id.trim();
      const client = getReplybotClient(clientId);
      if (!client) {
        return res.status(400).json({
          error: "unknown_client_id",
          detail: `No replybot client "${clientId}"`,
        });
      }
      const calendar = client.campaignCalendar;
      if (!calendar) {
        return res.status(400).json({
          error: "no_campaign_calendar",
          detail: `${client.displayName} has no campaignCalendar in its config`,
        });
      }
      // A shared Clay workspace: only this client's campaigns count.
      const prefix = calendar.campaignPrefix;
      if (prefix && !(p.campaign_name || "").startsWith(prefix)) {
        return res.json({ stored: false, reason: "not_this_clients_campaign" });
      }
      // A new Clay events table starts with placeholder rows for
      // alex@example.com in "Example campaign" (Serif's, 2026-10-14). They'd
      // draw a bar on the client's page. example.com is reserved for examples,
      // so no prospect is ever there.
      // Its status-change placeholder has no lead, only campaign 123456.
      if (
        /@example\.com$/i.test((p.lead_email || "").trim()) ||
        (p.campaign_id?.trim() === "123456" &&
          p.campaign_name?.trim() === "Example campaign")
      ) {
        return res.json({ stored: false, reason: "sample_row" });
      }
      const row = eventRow(p);
      if (!row) {
        return res.json({ stored: false, reason: "not_counted" });
      }
      try {
        await insertCampaignEvent(row);
      } catch (err) {
        logger.error(
          "campaign_events.insert_failed",
          err instanceof Error ? err : new Error(String(err)),
          { clientId, eventId: row.event_id },
        );
        return res.status(500).json({ error: "internal_error" });
      }
      return res.status(201).json({ stored: true });
    },
  );

  return router;
}
