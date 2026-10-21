/**
 * Tiny helpers for tiwari-proxy so we don't pull in a framework just to
 * parse JSON + write JSON.
 */

import { randomUUID } from "crypto";
import { resolveCorsOrigin } from "./webhook-auth.js";

const MAX_BODY_BYTES = 1024 * 1024; // 1MB

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        if (size === 0) return resolve({});
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Resolve the correlation ID for a request. Prefers a caller-supplied
 * id (so iOS can stitch its own logs to ours) and falls back to a
 * fresh UUID. Always exposed back via response header.
 */
export function correlationIdOf(req) {
  return (
    req.headers?.["x-correlation-id"] ||
    req.headers?.["x-request-id"] ||
    randomUUID()
  );
}

/**
 * Write a JSON response with stable shape and correlation tracing.
 *
 * `body` is sent as-is for success responses. Error responses (status
 * >= 400) are normalized to { error, message?, correlationId, ...rest }
 * so iOS / Tiwari clients always see the same envelope.
 *
 * The CORS allowlist is consulted instead of hard-coding `*`. Without
 * this, browser callers from disallowed origins would be permitted by
 * the proxy even though the OPTIONS preflight in server.js had refused.
 */
export function writeJson(res, status, body, opts = {}) {
  const correlationId = opts.correlationId || (body && body.correlationId);
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  if (correlationId) headers["x-correlation-id"] = correlationId;
  if (opts.req) {
    const allowOrigin = resolveCorsOrigin(opts.req);
    if (allowOrigin) {
      headers["Access-Control-Allow-Origin"] = allowOrigin;
      headers["Vary"] = "Origin";
      if (allowOrigin !== "*") {
        headers["Access-Control-Allow-Credentials"] = "true";
      }
    }
  }

  let payload = body;
  if (status >= 400 && body && typeof body === "object" && !body.ok) {
    // Normalize to stable error envelope: { ok, error, code, correlationId, message? }
    // The `code` field is a machine-readable constant callers can switch on.
    // If the caller already set `code`, preserve it; otherwise derive from `error`.
    const errorStr = body.error || "internal_error";
    const codeStr =
      body.code || errorStr.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const normalized = {
      ok: false,
      error: errorStr,
      code: codeStr,
      message: body.message || undefined,
      ...(correlationId ? { correlationId } : {}),
      ...body,
    };
    // Re-assert the canonical fields so any stale spread values don't win.
    normalized.ok = false;
    normalized.error = errorStr;
    normalized.code = codeStr;
    payload = normalized;
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
  return true;
}
