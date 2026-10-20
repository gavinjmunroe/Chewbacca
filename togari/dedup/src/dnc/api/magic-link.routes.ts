/**
 * Magic-link routes (WS-7).
 *
 * Flow:
 *   1. Slack bot calls `issueMagicLink({ slackUserId, slackTeamId })` (in-process
 *      from `src/dnc/integrations/slack-bot.ts`). The bot DMs the user the URL.
 *   2. User clicks the link → GET /dashboard/auth?token=<token>
 *   3. This route validates the token (single-use, 10-min TTL), sets a
 *      short-lived HttpOnly cookie binding the upcoming Auth0 login to the
 *      Slack identity, then redirects to /dashboard/connect. Auth0 takes over
 *      from there. After the user authenticates, the dashboard can read
 *      `tgi_slack_link` from the cookie and offer to associate the two.
 *
 * Token storage:
 *   In-memory map, same pattern as `src/dnc/auth/oauth-routes.ts`. A 10-minute
 *   TTL with a 5-minute sweeper keeps the map bounded; single-instance deploys
 *   are fine. When Togari moves to multi-instance, swap this for Firestore.
 *
 * POST /api/v1/magic-link/issue is also exposed for tests / future non-Slack
 * surfaces. It requires an internal shared-secret header so the public
 * internet cannot mint links.
 */

import { randomBytes, timingSafeEqual } from "crypto";
import type { Application, Request, Response } from "express";

const TOKEN_TTL_MS = 10 * 60_000;
const COOKIE_TTL_MS = 60 * 60_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;

interface MagicLinkRecord {
  slackUserId: string;
  slackTeamId: string;
  expiresAt: number;
  consumedAt: number | null;
}

const linkStore = new Map<string, MagicLinkRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [token, rec] of linkStore) {
    if (now > rec.expiresAt) linkStore.delete(token);
  }
}, SWEEP_INTERVAL_MS).unref?.();

export interface IssuedLink {
  token: string;
  url: string;
  expiresAt: string;
}

function publicBaseUrl(): string {
  return process.env.PUBLIC_URL ?? "http://localhost:3000";
}

/**
 * Mint a single-use magic link for a Slack user. Called in-process by the
 * Slack bot's `/togari connect` handler. The returned URL is what gets DM'd.
 */
export function issueMagicLink(args: {
  slackUserId: string;
  slackTeamId: string;
}): IssuedLink {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  linkStore.set(token, {
    slackUserId: args.slackUserId,
    slackTeamId: args.slackTeamId,
    expiresAt,
    consumedAt: null,
  });
  return {
    token,
    url: `${publicBaseUrl()}/dashboard/auth?token=${encodeURIComponent(token)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function verifyInternalSecret(req: Request): boolean {
  const expected = process.env.MAGIC_LINK_INTERNAL_SECRET;
  if (!expected) return false;
  const got = req.header("x-internal-secret");
  if (!got) return false;
  return constantTimeEqual(got, expected);
}

function cookieAttributes(): string {
  const secure = (process.env.NODE_ENV ?? "production") !== "development";
  const parts = [
    "Path=/",
    `Max-Age=${Math.floor(COOKIE_TTL_MS / 1000)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function registerMagicLinkRoutes(app: Application): void {
  // POST /api/v1/magic-link/issue — internal-only mint endpoint.
  // The Slack bot calls `issueMagicLink()` directly; this HTTP surface is for
  // tests and future non-Slack surfaces. Gated by a shared secret so the
  // public internet cannot mint links.
  app.post("/api/v1/magic-link/issue", (req: Request, res: Response): void => {
    if (!verifyInternalSecret(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = (req.body ?? {}) as {
      slackUserId?: unknown;
      slackTeamId?: unknown;
    };
    const slackUserId =
      typeof body.slackUserId === "string" ? body.slackUserId : "";
    const slackTeamId =
      typeof body.slackTeamId === "string" ? body.slackTeamId : "";
    if (!slackUserId || !slackTeamId) {
      res
        .status(400)
        .json({ error: "slackUserId and slackTeamId are required strings" });
      return;
    }

    const link = issueMagicLink({ slackUserId, slackTeamId });
    res.status(201).json({ url: link.url, expiresAt: link.expiresAt });
  });

  // GET /dashboard/auth?token=... — consume the link, bind cookie, redirect.
  app.get("/dashboard/auth", (req: Request, res: Response): void => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      res.status(400).type("text/plain").send("Missing token");
      return;
    }

    const rec = linkStore.get(token);
    if (!rec) {
      res
        .status(401)
        .type("text/plain")
        .send("Link is invalid or has already been used.");
      return;
    }
    if (rec.consumedAt !== null) {
      res
        .status(401)
        .type("text/plain")
        .send("This link has already been used.");
      return;
    }
    if (Date.now() > rec.expiresAt) {
      linkStore.delete(token);
      res
        .status(401)
        .type("text/plain")
        .send(
          "This link has expired. Run /togari connect in Slack to get a new one.",
        );
      return;
    }

    rec.consumedAt = Date.now();
    linkStore.delete(token);

    const cookieValue = `${encodeURIComponent(rec.slackUserId)}:${encodeURIComponent(rec.slackTeamId)}`;
    res.setHeader(
      "Set-Cookie",
      `tgi_slack_link=${cookieValue}; ${cookieAttributes()}`,
    );
    res.redirect(302, "/dashboard/connect");
  });
}

// Test seams — only exported for use by `src/__tests__/magic-link.test.ts`.
// Not part of the public surface; production callers should never touch these.
export const __testing = {
  reset(): void {
    linkStore.clear();
  },
  size(): number {
    return linkStore.size;
  },
  get(token: string): MagicLinkRecord | undefined {
    return linkStore.get(token);
  },
};
