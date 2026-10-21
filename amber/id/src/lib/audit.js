/**
 * Audit log: structured JSON logging for admin (API-key-auth'd) actions.
 *
 * Emits one line of JSON per event to stdout so Railway log parsers can ingest it.
 * Never logs raw secrets. Body/query summaries are truncated and sensitive fields redacted.
 */

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "authorization",
  "x-api-key",
  "privy_app_secret",
]);

function redact(obj, depth = 0) {
  if (obj == null) return obj;
  if (depth > 3) return "[truncated]";
  if (typeof obj === "string") {
    return obj.length > 200 ? `${obj.slice(0, 200)}...` : obj;
  }
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.slice(0, 10).map((v) => redact(v, depth + 1));
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

/**
 * Emit a single structured audit event.
 */
export function auditLog(event) {
  const line = {
    type: "audit",
    timestamp: new Date().toISOString(),
    ...event,
  };
  // One line per event, parseable by Railway log drains.
  console.log(JSON.stringify(line));
}

/**
 * Fastify preHandler + onResponse helper that wraps a route and logs an audit event
 * after the response completes. Call this from routes to add auditing after requireApiKey.
 *
 * Usage: register with onResponse hook at app level, keyed by routes marked audit=true.
 * Simpler: call auditAdminRequest(request, reply) at end of each admin handler.
 */
export function auditAdminRequest(request, reply, extra = {}) {
  try {
    const params =
      request.params && Object.keys(request.params).length
        ? redact(request.params)
        : undefined;
    const query =
      request.query && Object.keys(request.query).length
        ? redact(request.query)
        : undefined;
    const body =
      request.body && typeof request.body === "object"
        ? redact(request.body)
        : undefined;

    auditLog({
      route: request.routeOptions?.url || request.url,
      method: request.method,
      statusCode: reply.statusCode,
      result: reply.statusCode < 400 ? "success" : "failure",
      params,
      query,
      body,
      ip: request.ip,
      ...extra,
    });
  } catch (err) {
    // Never let audit logging break the request path.
    console.error("[audit] failed to emit event:", err.message);
  }
}
