/**
 * Magic-link routes — agent-triggered onboarding bounce.
 *
 * Flow (generic — any agent / slack bot / iMessage service can drive it):
 *   1. Some service (the iMessage agent, the Slack bot, a CLI script) calls
 *      `POST /api/v1/magic-link/issue` with header `X-Internal-Secret` and a
 *      JSON body `{ subject, context? }`. The subject identifies the human on
 *      the calling surface (E.164 phone for iMessage, slackUserId for Slack,
 *      etc.). The optional context payload carries flow-specific hints
 *      (e.g., `{ required_service: "google_calendar" }`).
 *   2. We mint a token = `<base64url-payload>.<base64url-hmac>` where:
 *        payload = { jti, subject, context?, exp }   (exp = now + 10 min)
 *        hmac    = HMAC-SHA256(MAGIC_LINK_INTERNAL_SECRET, payload)
 *      and return the URL `${PUBLIC_FRONTEND_URL}/onboarding?token=<token>` to
 *      the caller, who delivers it to the user via Loop / Slack / SMS / etc.
 *   3. The user opens the URL. medha-frontend forwards it to
 *      `GET /api/v1/magic-link/exchange?token=...` on this service.
 *   4. We verify the HMAC, the expiry, and that the `jti` has not been
 *      consumed yet (in-memory set with a TTL sweeper — same single-instance
 *      assumption as the existing OTP store; swap for Firestore when we go
 *      multi-instance). Then we set an HttpOnly session cookie binding the
 *      subject + context to the upcoming session, and 302 to
 *      `${PUBLIC_FRONTEND_URL}/onboarding`.
 *
 * The tokens are stateless wrt issuance (no need to persist unconsumed
 * tokens — they expire naturally), but consumption IS stateful so we can
 * enforce single-use. The consumed-jti set is bounded by the TTL.
 *
 * Service-key gating: only callers who present `X-Internal-Secret:
 * $MAGIC_LINK_INTERNAL_SECRET` can mint. This keeps the public internet from
 * spamming the surface; agents inside our trust boundary set the header.
 */

import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

const TOKEN_TTL_MS = 10 * 60_000;
const SESSION_COOKIE_TTL_MS = 60 * 60_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;
const COOKIE_NAME = "medha_magiclink_session";

interface ConsumedRecord {
  expiresAt: number;
}

const consumedJtis = new Map<string, ConsumedRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [jti, rec] of consumedJtis) {
    if (now > rec.expiresAt) consumedJtis.delete(jti);
  }
}, SWEEP_INTERVAL_MS).unref?.();

interface TokenPayload {
  jti: string;
  subject: string;
  context?: Record<string, unknown>;
  exp: number;
}

function getSecret(): string | null {
  const s = process.env.MAGIC_LINK_INTERNAL_SECRET;
  return typeof s === "string" && s.length > 0 ? s : null;
}

function frontendBaseUrl(): string {
  // MEDHA_FRONTEND_URL is the canonical env var across both medha-id and
  // medha-platform. The older PUBLIC_FRONTEND_URL / PUBLIC_URL names are
  // kept for backward compat but neither is set on Railway, so the old
  // fallback chain landed on http://localhost:3000 for every production
  // magic-link issued. That's the URL onboarding was sending.
  return (
    process.env.MEDHA_FRONTEND_URL ??
    process.env.PUBLIC_FRONTEND_URL ??
    process.env.PUBLIC_URL ??
    "http://localhost:3000"
  );
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}

function base64urlDecode(s: string): Buffer | null {
  try {
    return Buffer.from(s, "base64url");
  } catch {
    return null;
  }
}

function signPayload(payload: TokenPayload, secret: string): string {
  const payloadJson = JSON.stringify(payload);
  const payloadPart = base64urlEncode(Buffer.from(payloadJson, "utf8"));
  const sig = createHmac("sha256", secret).update(payloadPart).digest();
  return `${payloadPart}.${base64urlEncode(sig)}`;
}

function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function verifyToken(
  token: string,
  secret: string,
): { ok: true; payload: TokenPayload } | { ok: false; reason: string } {
  const dot = token.indexOf(".");
  if (dot < 1 || dot === token.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const payloadPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  const expectedSig = createHmac("sha256", secret).update(payloadPart).digest();
  const gotSig = base64urlDecode(sigPart);
  if (!gotSig || !constantTimeEqual(expectedSig, gotSig)) {
    return { ok: false, reason: "bad_signature" };
  }

  const payloadBuf = base64urlDecode(payloadPart);
  if (!payloadBuf) return { ok: false, reason: "malformed" };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(payloadBuf.toString("utf8")) as TokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    typeof payload.jti !== "string" ||
    typeof payload.subject !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (Date.now() > payload.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

function markConsumed(jti: string, exp: number): boolean {
  if (consumedJtis.has(jti)) return false;
  consumedJtis.set(jti, { expiresAt: exp });
  return true;
}

function verifyInternalSecret(request: FastifyRequest): boolean {
  const expected = getSecret();
  if (!expected) return false;
  const got = request.headers["x-internal-secret"];
  if (typeof got !== "string" || got.length === 0) return false;
  const a = Buffer.from(got, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sessionCookieAttributes(): string {
  const secure = (process.env.NODE_ENV ?? "production") !== "development";
  const parts = [
    "Path=/",
    `Max-Age=${Math.floor(SESSION_COOKIE_TTL_MS / 1000)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export interface IssueLinkBody {
  subject?: unknown;
  context?: unknown;
}

export interface IssuedLink {
  url: string;
  token: string;
  expiresAt: string;
}

/**
 * In-process mint helper. Exposed for the Slack bot and any other code path
 * that wants to mint without an HTTP round trip — they still need the secret
 * to be configured in env, of course.
 */
export function mintLink(args: {
  subject: string;
  context?: Record<string, unknown>;
}): IssuedLink {
  const secret = getSecret();
  if (!secret) {
    throw new Error("MAGIC_LINK_INTERNAL_SECRET is not configured");
  }
  const jti = randomUUID();
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload: TokenPayload = {
    jti,
    subject: args.subject,
    context: args.context,
    exp,
  };
  const token = signPayload(payload, secret);
  const url = `${frontendBaseUrl()}/onboarding?token=${encodeURIComponent(token)}`;
  return { url, token, expiresAt: new Date(exp).toISOString() };
}

export async function registerMagicLinkRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/api/v1/magic-link/issue",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!verifyInternalSecret(request)) {
        return reply
          .code(401)
          .send({ error: "unauthorized", code: "unauthorized" });
      }

      const body = (request.body ?? {}) as IssueLinkBody;
      const subject =
        typeof body.subject === "string" && body.subject.trim()
          ? body.subject.trim()
          : null;
      if (!subject) {
        return reply
          .code(400)
          .send({ error: "missing_subject", code: "missing_subject" });
      }

      const context =
        body.context &&
        typeof body.context === "object" &&
        !Array.isArray(body.context)
          ? (body.context as Record<string, unknown>)
          : undefined;

      try {
        const issued = mintLink({ subject, context });
        return reply.code(201).send(issued);
      } catch (err) {
        request.log.error({ err }, "[magic-link] mint failed");
        return reply
          .code(500)
          .send({ error: "mint_failed", code: "mint_failed" });
      }
    },
  );

  app.get<{ Querystring: { token?: string } }>(
    "/api/v1/magic-link/exchange",
    async (request, reply) => {
      const secret = getSecret();
      if (!secret) {
        request.log.error("[magic-link] MAGIC_LINK_INTERNAL_SECRET not set");
        return reply
          .code(500)
          .send({ error: "not_configured", code: "not_configured" });
      }

      const token =
        typeof request.query.token === "string" ? request.query.token : "";
      if (!token) {
        return reply
          .code(400)
          .send({ error: "missing_token", code: "missing_token" });
      }

      const result = verifyToken(token, secret);
      if (!result.ok) {
        return reply
          .code(401)
          .send({ error: "invalid_token", code: result.reason });
      }

      if (!markConsumed(result.payload.jti, result.payload.exp)) {
        return reply
          .code(401)
          .send({ error: "invalid_token", code: "already_consumed" });
      }

      const sessionPayload = signPayload(result.payload, secret);
      reply.header(
        "Set-Cookie",
        `${COOKIE_NAME}=${encodeURIComponent(sessionPayload)}; ${sessionCookieAttributes()}`,
      );

      return reply.redirect(`${frontendBaseUrl()}/onboarding`, 302);
    },
  );
}

// Test seams — only exported for use by future unit tests in this dir.
export const __testing = {
  reset(): void {
    consumedJtis.clear();
  },
  consumedSize(): number {
    return consumedJtis.size;
  },
  signPayload,
  verifyToken,
};
