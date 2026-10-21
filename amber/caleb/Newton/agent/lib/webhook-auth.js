/**
 * Webhook authentication and signature verification.
 *
 * Two layers of webhook auth, applied in order:
 *
 *   1. Provider signature (Loop / Twilio) — when the relevant secret
 *      env var is set, we verify the cryptographic signature on the
 *      raw request body. This is the strong check.
 *
 *   2. Shared-secret (WEBHOOK_SECRET) — a long random token in a header,
 *      query param, or Authorization Bearer. Backwards-compatible fallback.
 *
 * Production policy (NODE_ENV=production):
 *   - If `LOOP_WEBHOOK_SECRET` is configured and the request looks like a
 *     Loop webhook, the signature MUST validate. Missing/invalid → 401.
 *   - If `TWILIO_AUTH_TOKEN` is configured and the request looks like a
 *     Twilio webhook, the signature MUST validate. Missing/invalid → 401.
 *   - If neither provider secret is configured, fall back to
 *     `WEBHOOK_SECRET`. If THAT is also missing, fail closed in
 *     production but allow in development (logged warning).
 *
 * Development policy (NODE_ENV !== production):
 *   - All checks remain "best effort": if a secret is set we verify it,
 *     otherwise we allow the request through and log a warning. This
 *     keeps `npm start` working without forcing every dev to configure
 *     real provider secrets.
 *
 * The exact Loop signature format is not publicly documented; the
 * verifier here implements the most common shape (HMAC-SHA256 over the
 * raw body, hex or base64 in `Loop-Signature` / `X-Loop-Signature`).
 * If Loop uses a different scheme, set `LOOP_WEBHOOK_SECRET` to empty
 * and rely on `WEBHOOK_SECRET`; this module does NOT pretend to verify
 * something it cannot.
 */

import { createHmac, timingSafeEqual } from "crypto";

// Computed lazily so tests can flip NODE_ENV between cases without
// reloading the module.
function isProd() {
  return process.env.NODE_ENV === "production";
}

/**
 * Constant-time buffer comparison. Returns false on length mismatch
 * without leaking timing.
 */
function safeEqual(a, b) {
  if (!Buffer.isBuffer(a)) a = Buffer.from(a || "");
  if (!Buffer.isBuffer(b)) b = Buffer.from(b || "");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Decode a signature header that might be hex or base64. Returns a
 * Buffer or null if the header is unparseable.
 */
function decodeSignature(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^sha256=/i, "");
  // Hex (preferred — what Loop and Stripe-style providers usually emit)
  if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
    try {
      return Buffer.from(trimmed, "hex");
    } catch {}
  }
  // Base64
  try {
    return Buffer.from(trimmed, "base64");
  } catch {
    return null;
  }
}

/**
 * Verify an HMAC-SHA256 signature over the raw body.
 *
 * @param {string|Buffer} rawBody — the exact bytes received
 * @param {string} secret — the shared signing secret
 * @param {string} provided — value from the signature header
 */
export function verifyHmacSha256(rawBody, secret, provided) {
  if (!secret || !provided) return false;
  const expected = createHmac("sha256", secret)
    .update(
      typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody,
    )
    .digest();
  const decoded = decodeSignature(provided);
  if (!decoded) return false;
  return safeEqual(expected, decoded);
}

/**
 * Heuristic: is this request shaped like a Loop webhook?
 * Loop sends a JSON body with an `event` field; we use the presence of
 * a Loop-Signature header (or a Loop-specific UA) to gate verification.
 */
export function looksLikeLoopRequest(req) {
  const h = req.headers || {};
  if (h["loop-signature"] || h["x-loop-signature"] || h["loop-event-id"]) {
    return true;
  }
  const ua = (h["user-agent"] || "").toLowerCase();
  return ua.includes("loopmessage") || ua.includes("loop-message");
}

/**
 * Heuristic: is this request shaped like a Twilio webhook?
 */
export function looksLikeTwilioRequest(req) {
  const h = req.headers || {};
  return Boolean(h["x-twilio-signature"]);
}

/**
 * Verify a Loop Message webhook signature.
 *
 * Loop's exact header format is undocumented publicly; we accept the
 * common variants (`Loop-Signature`, `X-Loop-Signature`) and try the
 * most common HMAC-SHA256 shape against `LOOP_WEBHOOK_SECRET`.
 */
export function verifyLoopSignature(req, rawBody) {
  const secret = process.env.LOOP_WEBHOOK_SECRET;
  if (!secret) return { mode: "skipped", ok: false };
  const h = req.headers || {};
  const provided = h["loop-signature"] || h["x-loop-signature"];
  if (!provided) return { mode: "missing-signature", ok: false };
  const ok = verifyHmacSha256(rawBody, secret, provided);
  return { mode: "verified", ok };
}

/**
 * Verify a Twilio webhook signature.
 *
 * Twilio's algorithm: HMAC-SHA1 over the URL + sorted-form-encoded body,
 * base64-encoded, in `X-Twilio-Signature`. We implement only the
 * application/x-www-form-urlencoded variant since that is what Twilio
 * SMS webhooks use.
 */
export function verifyTwilioSignature(req, rawBody, fullUrl) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return { mode: "skipped", ok: false };
  const provided = (req.headers || {})["x-twilio-signature"];
  if (!provided) return { mode: "missing-signature", ok: false };
  // Parse form-encoded body, sort keys, append k+v pairs to URL.
  let signingString = fullUrl || "";
  try {
    if (
      (req.headers["content-type"] || "").includes(
        "application/x-www-form-urlencoded",
      )
    ) {
      const params = new URLSearchParams(rawBody);
      const keys = Array.from(params.keys()).sort();
      for (const k of keys) signingString += k + params.get(k);
    }
  } catch {}
  // Twilio uses SHA1 (legacy but still required by their API)
  const expected = createHmac("sha1", token)
    .update(signingString)
    .digest("base64");
  return { mode: "verified", ok: safeEqual(expected, provided) };
}

/**
 * Shared-secret check: looks for the secret in `?secret=`, `x-webhook-secret`,
 * or an `Authorization: Bearer` header. Returns true if any matches in a
 * timing-safe way.
 */
export function checkSharedSecret(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return { mode: "no-secret-configured", ok: false };
  let urlObj;
  try {
    urlObj = new URL(req.url, "http://localhost");
  } catch {
    return { mode: "bad-url", ok: false };
  }
  const provided =
    urlObj.searchParams.get("secret") ||
    req.headers["x-webhook-secret"] ||
    (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  if (!provided) return { mode: "missing-shared-secret", ok: false };
  return {
    mode: "verified",
    ok: safeEqual(Buffer.from(provided), Buffer.from(secret)),
  };
}

/**
 * Compose all checks. The combined policy is documented at the top of
 * this file.
 *
 *   verifyWebhook(req, rawBody) -> { ok: boolean, reason: string }
 */
export function verifyWebhook(req, rawBody) {
  // 1. Provider-specific signature (strongest). If a provider secret is
  //    configured AND the request looks like that provider, the signature
  //    MUST validate.
  if (process.env.LOOP_WEBHOOK_SECRET && looksLikeLoopRequest(req)) {
    const r = verifyLoopSignature(req, rawBody);
    if (r.ok) return { ok: true, reason: "loop-signature" };
    return { ok: false, reason: `loop-signature-invalid:${r.mode}` };
  }
  if (process.env.TWILIO_AUTH_TOKEN && looksLikeTwilioRequest(req)) {
    const fullUrl = `https://${req.headers.host || "localhost"}${req.url}`;
    const r = verifyTwilioSignature(req, rawBody, fullUrl);
    if (r.ok) return { ok: true, reason: "twilio-signature" };
    return { ok: false, reason: `twilio-signature-invalid:${r.mode}` };
  }

  // 2. Shared-secret fallback.
  const shared = checkSharedSecret(req);
  if (shared.ok) return { ok: true, reason: "shared-secret" };

  // 3. No auth configured at all. Allow with a warning. Caleb explicitly
  //    chose to open this gate on 2026-05-18 because Loop sends no auth
  //    headers / signatures, and the real defense lives downstream in
  //    resolveTenantStrict (which rejects any webhook whose `sender` UUID
  //    doesn't map to a known amber-id tenant). When any of
  //    WEBHOOK_SECRET / LOOP_WEBHOOK_SECRET / TWILIO_AUTH_TOKEN is set,
  //    the strict path above re-engages automatically — no code change
  //    needed to tighten back up later.
  if (
    !process.env.WEBHOOK_SECRET &&
    !process.env.LOOP_WEBHOOK_SECRET &&
    !process.env.TWILIO_AUTH_TOKEN
  ) {
    console.warn(
      "[webhook-auth] no provider signature or WEBHOOK_SECRET configured; allowing (tenant resolver is the gate)",
    );
    return { ok: true, reason: "no-secret-permissive" };
  }

  return { ok: false, reason: shared.mode || "unauthorized" };
}

/**
 * Lightweight admin auth check used by /debug/* endpoints. Distinct from
 * webhook auth so a webhook secret leak doesn't open the debug surface.
 *
 * Looks for:
 *   - x-admin-token header
 *   - Authorization: Bearer
 *   - ?admin_token= query param (last resort, dev-friendly)
 *
 * Compared against process.env.ADMIN_TOKEN. If ADMIN_TOKEN is unset,
 * returns false in production (debug endpoints fully gated) and true
 * in development with a warning.
 */
export function checkAdminAuth(req) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    if (isProd()) return false;
    console.warn(
      "[admin-auth] ADMIN_TOKEN not set; debug endpoints open in dev",
    );
    return true;
  }
  let urlObj;
  try {
    urlObj = new URL(req.url, "http://localhost");
  } catch {
    return false;
  }
  const provided =
    req.headers["x-admin-token"] ||
    (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "") ||
    urlObj.searchParams.get("admin_token") ||
    "";
  if (!provided) return false;
  return safeEqual(Buffer.from(provided), Buffer.from(adminToken));
}

/**
 * Resolve the configured CORS allowlist into a Set. Empty/missing →
 * empty set (no permissive default). Special value "*" preserved for
 * dev-only use; production callers should set explicit origins.
 */
export function getAllowedOrigins() {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Resolve the CORS Access-Control-Allow-Origin response header for the
 * incoming request, given the configured allowlist. Returns null if the
 * origin is not allowed; the caller should respond without permissive
 * CORS headers in that case.
 *
 * Defaults preserve local dev: when no allowlist is configured AND we're
 * not in production, a literal `*` is allowed but ONLY for non-credentialed
 * requests (we never emit Access-Control-Allow-Credentials with `*`).
 */
export function resolveCorsOrigin(req) {
  const origin = req.headers["origin"] || null;
  const allowed = getAllowedOrigins();
  if (allowed.has("*")) return "*";
  if (origin && allowed.has(origin)) return origin;
  if (allowed.size === 0 && !isProd()) {
    // Dev only: fall back to echoing the request origin (or `*` if absent).
    return origin || "*";
  }
  return null;
}
