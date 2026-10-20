/**
 * @togari/api — REST API Transport
 *
 * Exposes the Togari core engine via REST endpoints.
 * Any HTTP client (web app, Teams bot, mobile app, cURL) can call these.
 *
 * Auth: simple API key via X-Togari-Key header (temporary — OAuth later).
 * If TOGARI_API_KEY is not set, auth is skipped (dev mode).
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { processMessage } from "../../core/engine";
import {
  searchDeal,
  createDeal,
  updateDeal,
  queryDeals,
  logActivity,
} from "../../core/tools/deal-ops";
import {
  findMeeting,
  searchMeetings,
  analyzeMeeting,
} from "../../core/tools/meeting-intel";
import { generateProposal } from "../../core/tools/proposal-ops";
import { sendEmail, draftReply } from "../../core/tools/email-ops";
import { connectorRegistry } from "../../resilience/connector-registry";
import { createLogger } from "../../observability/logger";
import { tenantStorage, createStdioTenantContext } from "../../tenant/context";

const logger = createLogger("api/router");

// ── Auth middleware ───────────────────────────────────────────────

/** Mounts under /api/v1 that carry their own auth, so the shared org key
 *  must not apply: the client portal (portalAuth, per-client keys) and the
 *  website lead-capture routes (Bearer WEBSITE_INGEST_API_KEY, called by the
 *  bma-website proxy). Without the website exemption every form fill was
 *  401'd here before reaching its route. */
const SELF_AUTHED_PREFIXES = ["/api/v1/portal", "/api/v1/website"];

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (
    SELF_AUTHED_PREFIXES.some(
      (p) => req.originalUrl === p || req.originalUrl.startsWith(`${p}/`),
    )
  ) {
    next();
    return;
  }
  const expectedKey = process.env.TOGARI_API_KEY;
  if (!expectedKey) {
    console.log("[api] TOGARI_API_KEY not set — skipping auth (dev mode)");
    next();
    return;
  }

  const providedKey = req.headers["x-togari-key"] as string;
  if (!providedKey || providedKey !== expectedKey) {
    res.status(401).json({
      success: false,
      error: "Invalid or missing API key. Set X-Togari-Key header.",
    });
    return;
  }

  next();
}

// ── Tenant context for the API-key transport ──────────────────────
// The X-Togari-Key API transport (iMessage, iOS app, cURL) authenticates with
// a shared key but, unlike the Auth0 and MCP transports, never establishes a
// tenant. Without one, processMessage -> getCurrentTenant() throws "No tenant
// context available" and every /api/v1 call 500s. This deployment is a single
// org, so we resolve the tenant from the TENANT_ID env (the same path stdio
// mode uses) and run the request inside it. We ONLY do this when no tenant is
// already set, so the Auth0/Slack/MCP flows are never overridden.
function apiTenantContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (tenantStorage.getStore()) {
    next();
    return;
  }
  try {
    tenantStorage.run(createStdioTenantContext(), () => next());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      error: `API transport tenant not configured (set TENANT_ID): ${msg}`,
    });
  }
}

// ── Response helpers ─────────────────────────────────────────────

function ok(res: Response, data: any): void {
  res.status(200).json({ success: true, data });
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}

// ── Router ───────────────────────────────────────────────────────

export const apiRouter = Router();

// Auth on all /api/v1/* routes
apiRouter.use("/api/v1", apiKeyAuth);
// Give API-key callers a tenant (single-org via TENANT_ID env). Must run after
// apiKeyAuth and before any route handler that calls getCurrentTenant().
apiRouter.use("/api/v1", apiTenantContext);

// ── 1. Universal natural language endpoint ───────────────────────

apiRouter.post("/api/v1/message", async (req: Request, res: Response) => {
  const { message, user_id, context } = req.body || {};
  console.log(
    `[api] POST /api/v1/message from ${user_id || "anonymous"}: "${(message || "").slice(0, 80)}"`,
  );

  if (!message || typeof message !== "string") {
    fail(res, 400, "message is required (string)");
    return;
  }

  try {
    const response = await processMessage({
      text: message,
      userId: user_id || "api_user",
      platform: "api",
      context,
    });
    ok(res, response);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      "POST /api/v1/message failed",
      err instanceof Error ? err : new Error(errMsg),
    );
    fail(res, 500, errMsg);
  }
});

// ── 1b. Streaming natural language endpoint (SSE) ─────────────────
// Same processMessage, same intents, same models, same final reply as
// /api/v1/message above — but delivered over Server-Sent Events. Emits a
// `start` event immediately so callers (the Amber iOS app, via the
// medha-platform proxy) can show live "working..." feedback instead of waiting
// in silence on slow tool-heavy queries, forwards any onProgress updates as
// `progress` events, then sends the final TogariResponse as `done`. Behavior is
// identical to the non-streaming route; nothing about the agent changes. The
// existing /api/v1/message is left untouched for togari-imessage and other
// JSON callers.
apiRouter.post(
  "/api/v1/message/stream",
  async (req: Request, res: Response) => {
    const { message, user_id, context } = req.body || {};
    console.log(
      `[api] POST /api/v1/message/stream from ${user_id || "anonymous"}: "${(message || "").slice(0, 80)}"`,
    );

    if (!message || typeof message !== "string") {
      fail(res, 400, "message is required (string)");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = (event: string, data: unknown): void => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("start", { ok: true });

    try {
      const response = await processMessage(
        {
          text: message,
          userId: user_id || "api_user",
          platform: "api",
          context,
        },
        async (progress) => send("progress", progress),
      );
      send("done", response);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        "POST /api/v1/message/stream failed",
        err instanceof Error ? err : new Error(errMsg),
      );
      send("error", { error: errMsg });
    } finally {
      if (!res.writableEnded) res.end();
    }
  },
);

// ── 2. List/search deals ─────────────────────────────────────────

apiRouter.get("/api/v1/deals", async (req: Request, res: Response) => {
  const { stage, pipeline, company, limit } = req.query;
  console.log(`[api] GET /api/v1/deals`, { stage, pipeline, company, limit });

  try {
    // Build a natural language query from the params
    const parts: string[] = ["show"];
    if (company) parts.push(`deals matching "${company}"`);
    else parts.push("all deals");
    if (stage) parts.push(`in stage ${stage}`);
    if (pipeline) parts.push(`in ${pipeline} pipeline`);
    parts.push(`limit ${limit || 20}`);

    const result = await queryDeals(parts.join(" "));
    ok(res, {
      summary: result.summary,
      sql: result.sql,
      rows: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      "GET /api/v1/deals failed",
      err instanceof Error ? err : new Error(errMsg),
    );
    fail(res, 500, errMsg);
  }
});

// ── 3. Create a deal ─────────────────────────────────────────────

apiRouter.post("/api/v1/deals", async (req: Request, res: Response) => {
  const {
    company,
    contact_name,
    contact_email,
    value,
    stage,
    pipeline,
    client_brand,
    owner,
    notes,
  } = req.body || {};
  console.log(`[api] POST /api/v1/deals: ${company}`);

  if (!company) {
    fail(res, 400, "company is required");
    return;
  }

  try {
    // Don't pre-stamp owner with 'api_user' — createDeal standardizes
    // on Slack user IDs and rejects raw names. Leave undefined so it
    // falls through to the resolver / UNKNOWN_OWNER sentinel.
    const { deal } = await createDeal({
      company,
      contactName: contact_name,
      contactEmail: contact_email,
      value,
      stage,
      pipeline,
      // H — accept `client_brand` in the request body. createDeal
      // validates the brand+pipeline combo; a 500 here surfaces the
      // friendly "Brand X does not have pipeline Y" message.
      clientBrand: client_brand,
      owner,
      notes,
    });
    ok(res, { deal });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      "POST /api/v1/deals failed",
      err instanceof Error ? err : new Error(errMsg),
    );
    fail(res, 500, errMsg);
  }
});

// ── 4. Update a deal by company name ─────────────────────────────

apiRouter.patch(
  "/api/v1/deals/:company",
  async (req: Request, res: Response) => {
    const companyName = req.params.company as string;
    const updates = req.body || {};
    console.log(`[api] PATCH /api/v1/deals/${companyName}`, {
      updateKeys: Object.keys(updates),
    });

    try {
      const existing = await searchDeal(companyName);
      if (!existing) {
        fail(res, 404, `No deal found matching "${companyName}"`);
        return;
      }

      const { deal } = await updateDeal(existing.deal_id, updates);
      ok(res, { deal });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        "PATCH /api/v1/deals failed",
        err instanceof Error ? err : new Error(errMsg),
      );
      fail(res, 500, errMsg);
    }
  },
);

// ── 5. Search Fireflies meetings ─────────────────────────────────

apiRouter.post(
  "/api/v1/meetings/search",
  async (req: Request, res: Response) => {
    const { query, limit } = req.body || {};
    console.log(`[api] POST /api/v1/meetings/search: "${query}"`);

    if (!query) {
      fail(res, 400, "query is required");
      return;
    }

    try {
      const meetings = await searchMeetings(query, limit || 5);
      ok(res, { meetings, count: meetings.length });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        "POST /api/v1/meetings/search failed",
        err instanceof Error ? err : new Error(errMsg),
      );
      fail(res, 500, errMsg);
    }
  },
);

// ── 6. Analyze a meeting ─────────────────────────────────────────

apiRouter.post(
  "/api/v1/meetings/analyze",
  async (req: Request, res: Response) => {
    const { search_term, analysis_type, additional_context } = req.body || {};
    console.log(
      `[api] POST /api/v1/meetings/analyze: "${search_term}" (${analysis_type || "general"})`,
    );

    if (!search_term) {
      fail(res, 400, "search_term is required");
      return;
    }

    try {
      const transcript = await findMeeting(search_term);
      if (!transcript) {
        fail(res, 404, `No Fireflies meeting found matching "${search_term}"`);
        return;
      }

      const analysis = await analyzeMeeting(
        transcript,
        analysis_type || "general",
        additional_context,
      );
      ok(res, {
        meeting: {
          title: transcript.title,
          date: transcript.date,
          participants: transcript.participants,
        },
        analysis_type: analysis_type || "general",
        analysis,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        "POST /api/v1/meetings/analyze failed",
        err instanceof Error ? err : new Error(errMsg),
      );
      fail(res, 500, errMsg);
    }
  },
);

// ── 7. Generate a proposal ───────────────────────────────────────

apiRouter.post(
  "/api/v1/proposals/generate",
  async (req: Request, res: Response) => {
    const {
      client_name,
      client_company,
      pricing_instructions,
      additional_instructions,
    } = req.body || {};
    console.log(`[api] POST /api/v1/proposals/generate: "${client_name}"`);

    if (!client_name) {
      fail(res, 400, "client_name is required");
      return;
    }

    try {
      const transcript = await findMeeting(client_name);
      if (!transcript) {
        fail(
          res,
          404,
          `No Fireflies meeting found matching "${client_name}". A meeting recording is needed to generate a proposal.`,
        );
        return;
      }

      // Get deal context
      let dealContext = "No existing CRM data found.";
      try {
        const deal = await searchDeal(client_company || client_name);
        if (deal) {
          dealContext = `Company: ${deal.company} | Contact: ${deal.contact_full_name} | Stage: ${deal.stage} | Value: $${deal.value} | Pipeline: ${deal.pipeline}`;
        }
      } catch {
        /* non-fatal */
      }

      const transcriptText =
        transcript.fullText ||
        transcript.sentences
          ?.map((s) => `${s.speaker}: ${s.text}`)
          .join("\n") ||
        transcript.summary.overview;

      const result = await generateProposal({
        clientName: client_name,
        clientCompany: client_company || transcript.title,
        meetingTranscript: transcriptText,
        dealContext,
        userInstructions:
          additional_instructions ||
          "Generate a standard proposal based on the meeting.",
        pricing: pricing_instructions,
      });

      ok(res, result);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        "POST /api/v1/proposals/generate failed",
        err instanceof Error ? err : new Error(errMsg),
      );
      fail(res, 500, errMsg);
    }
  },
);

// ── 8. Draft an email ────────────────────────────────────────────

apiRouter.post("/api/v1/emails/draft", async (req: Request, res: Response) => {
  const { to_email, to_name, context, reply_to_message } = req.body || {};
  console.log(`[api] POST /api/v1/emails/draft: to=${to_email}`);

  if (!to_email || !context) {
    fail(res, 400, "to_email and context are required");
    return;
  }

  try {
    const result = await draftReply({
      leadEmail: to_email,
      leadName: to_name || "Unknown",
      replyText: reply_to_message || context,
      originalOutreach: context,
      category: "outreach",
    });
    ok(res, {
      to: to_email,
      to_name,
      subject: result.subject,
      body: result.body,
      urgency: result.urgency,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      "POST /api/v1/emails/draft failed",
      err instanceof Error ? err : new Error(errMsg),
    );
    fail(res, 500, errMsg);
  }
});

// ── 9. Send an email ─────────────────────────────────────────────

apiRouter.post("/api/v1/emails/send", async (req: Request, res: Response) => {
  const { to, subject, body, in_reply_to } = req.body || {};
  console.log(`[api] POST /api/v1/emails/send: to=${to}, subject="${subject}"`);

  if (!to || !subject || !body) {
    fail(res, 400, "to, subject, and body are required");
    return;
  }

  try {
    const result = await sendEmail({
      to,
      subject,
      body,
      inReplyTo: in_reply_to,
    });
    if (result.success) {
      ok(res, { messageId: result.messageId, to, subject });
    } else {
      fail(res, 500, "Failed to send email. Check Gmail API configuration.");
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      "POST /api/v1/emails/send failed",
      err instanceof Error ? err : new Error(errMsg),
    );
    fail(res, 500, errMsg);
  }
});

// ── 10. Health check ─────────────────────────────────────────────

apiRouter.get("/api/v1/health", (_req: Request, res: Response) => {
  const statuses = connectorRegistry.getAllStatuses();
  const allHealthy = statuses.length === 0 || statuses.every((s) => s.healthy);
  ok(res, {
    status: allHealthy ? "healthy" : "degraded",
    uptime: process.uptime(),
    connectors: statuses,
    timestamp: new Date().toISOString(),
  });
});
