/**
 * HMAC-signed request middleware for the KG service.
 *
 * Every request from amber-id (or any other trusted caller) carries:
 *
 *   X-KG-Timestamp: <unix seconds>
 *   X-KG-Signature: sha256=<hex(hmac(KG_SERVICE_SECRET, timestamp + method + path + body))>
 *
 * The service verifies the signature and rejects timestamps older than
 * `MAX_AGE_SECONDS` (5 min) so a leaked signature can't be replayed
 * indefinitely.
 *
 * `KG_SERVICE_SECRET` must be set in production. In dev, requests can
 * skip the signature by omitting the headers *only* if
 * `KG_SERVICE_AUTH_MODE=disabled` — otherwise the service returns 401.
 */

import crypto from "node:crypto";

const MAX_AGE_SECONDS = 5 * 60;

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Compute the canonical signature for a request. Exported so amber-id's
 * kg-client can produce the exact same bytes.
 */
export function signRequest({ secret, timestamp, method, path, body }) {
  const payload = `${timestamp}\n${method.toUpperCase()}\n${path}\n${body || ""}`;
  const mac = crypto.createHmac("sha256", secret);
  mac.update(payload);
  return `sha256=${mac.digest("hex")}`;
}

/**
 * Fastify onRequest hook. Attach with `app.addHook("preHandler", verifyHmac)`.
 * Rejects with 401 on missing headers, invalid signature, or stale timestamp.
 * Skips verification only when `KG_SERVICE_AUTH_MODE=disabled` — never
 * flip that in production.
 */
export function verifyHmac(req, reply, done) {
  if (process.env.KG_SERVICE_AUTH_MODE === "disabled") {
    return done();
  }
  const secret = process.env.KG_SERVICE_SECRET;
  if (!secret) {
    reply.code(500).send({
      error: "kg_service_secret_missing",
      message: "KG_SERVICE_SECRET is not configured on the service",
    });
    return;
  }

  const sig = req.headers["x-kg-signature"];
  const ts = req.headers["x-kg-timestamp"];
  if (!sig || !ts) {
    reply
      .code(401)
      .send({ error: "unauthorized", message: "missing HMAC headers" });
    return;
  }

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    reply
      .code(401)
      .send({ error: "unauthorized", message: "invalid timestamp header" });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > MAX_AGE_SECONDS) {
    reply
      .code(401)
      .send({ error: "unauthorized", message: "timestamp outside 5-min window" });
    return;
  }

  // Fastify parses JSON bodies before preHandler; re-serialize with the
  // same key order the client used by requiring the client to send the
  // raw body string in a request-scope buffer. Fastify's rawBody plugin
  // would give us this — until it's wired in, we re-stringify. Callers
  // MUST use the SAME stringify (no spaces) or signatures will mismatch.
  const body =
    req.body === undefined || req.body === null
      ? ""
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);
  const expected = signRequest({
    secret,
    timestamp: ts,
    method: req.method,
    path: req.url,
    body,
  });

  if (!timingSafeEqual(expected, String(sig))) {
    reply
      .code(401)
      .send({ error: "unauthorized", message: "signature mismatch" });
    return;
  }
  done();
}
