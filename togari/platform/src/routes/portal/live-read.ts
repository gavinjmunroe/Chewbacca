/**
 * Read-only API for Chewbacca Live, the hosted "ask it, see it" page a client
 * like Jonah talks to (Caleb, 2026-10-10). Chewbacca owns the page; Togari is
 * one of its data sources, for what only Togari holds: the replies it read and
 * what it did with each, follow ups, decks, and the client's own config.
 *
 * Mounted at /api/v1/portal behind portalAuth(), so:
 *   GET /api/v1/portal/live/clients              clients with a live page
 *   GET /api/v1/portal/live/:clientId/:tool      one read tool, one client
 *
 * A per-client tgc_ key only ever reads its own client. The admin key reads
 * any client by naming it in the path. Nothing here writes: the tools are the
 * Slack assistant's read tools (runReadTool), each bound to the client id.
 */
import { createHash, timingSafeEqual } from "crypto";
import { Router } from "express";
import type { Request, Response } from "express";
import {
  READ_TOOL_NAMES,
  clientBrief,
  runReadTool,
} from "../../agents/client-assistant";
import { liveClients } from "../../agents/replybot/client-config";
import { createLogger } from "../../observability/logger";

const logger = createLogger("routes/portal/live-read");

// The longest window a page asks for is a quarter; the Slack tools clamp the
// same way (list_replies 90 days, summary 365).
const MAX_DAYS = 365;
const MAX_TEXT = 120;

function scopeOf(req: Request): string | undefined {
  const id = (req as { togariClientId?: string }).togariClientId;
  return id && id.trim() ? id.trim() : undefined;
}

function liveView(clientId: string) {
  const c = liveClients().find((x) => x.clientId === clientId);
  if (!c || !c.live) return null;
  return {
    clientId: c.clientId,
    displayName: c.displayName,
    brief: clientBrief(c.clientId),
    clayWorkspaceId: c.live.clayWorkspaceId,
    campaignPrefix: c.live.campaignPrefix,
  };
}

/** Only the inputs the read tools take, each bounded. */
export function readInput(q: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const days = Number(q.days);
  if (Number.isFinite(days) && days > 0)
    out.days = Math.min(Math.floor(days), MAX_DAYS);
  for (const k of ["company", "search", "who"]) {
    const v = q[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, MAX_TEXT);
  }
  return out;
}

/**
 * Every live read needs a key, whatever NODE_ENV says. portalAuth lets a
 * request with no key through outside production, and this service runs
 * without NODE_ENV set: on 2026-10-10 GET /api/v1/portal/live/clients and
 * /dnc/list both answered 200 to a request carrying no key at all. So this
 * router checks for itself: a tgc_ key that portalAuth resolved to a client,
 * or the admin key compared in constant time.
 */
export function liveReadAllowed(req: Request): boolean {
  if (scopeOf(req)) return true;
  const admin = process.env.TOGARI_API_KEY || "";
  const given = req.header("x-togari-key") || "";
  if (!admin || !given) return false;
  const a = createHash("sha256").update(admin).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

export function createLiveReadPortalRouter(): Router {
  const router = Router();

  router.use("/live", (req: Request, res: Response, next) => {
    if (liveReadAllowed(req)) return next();
    res.status(401).json({ error: "a key is required" });
  });

  router.get("/live/clients", (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const all = liveClients()
      .map((c) => liveView(c.clientId))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    res.json({
      clients: scope ? all.filter((c) => c.clientId === scope) : all,
    });
  });

  router.get("/live/:clientId/:tool", async (req: Request, res: Response) => {
    const clientId = String(req.params.clientId || "");
    const tool = String(req.params.tool || "");
    const scope = scopeOf(req);
    if (scope && scope !== clientId) {
      res.status(403).json({ error: "this key reads only its own client" });
      return;
    }
    if (!liveView(clientId)) {
      res.status(404).json({ error: "no live page for that client" });
      return;
    }
    if (!READ_TOOL_NAMES.includes(tool)) {
      res.status(404).json({ error: "unknown read", reads: READ_TOOL_NAMES });
      return;
    }
    const input = readInput(req.query as Record<string, unknown>);
    if (tool === "get_investor" && !input.who) {
      res.status(400).json({ error: "who is required" });
      return;
    }
    try {
      const raw = await runReadTool(clientId, tool, input);
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        // The tools answer "No decks on file yet." style sentences when empty.
        data = { note: raw };
      }
      res.json({ clientId, tool, as_of: new Date().toISOString(), data });
    } catch (err) {
      logger.error(
        "live read failed",
        err instanceof Error ? err : new Error(String(err)),
        { clientId, tool },
      );
      res.status(502).json({ error: "read failed" });
    }
  });

  return router;
}
