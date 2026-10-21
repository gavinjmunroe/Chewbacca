/**
 * Structured audit logging for tool calls.
 *
 * Lifted from togari-platform/src/middleware/audit.ts. Emits one JSON line
 * per tool invocation via console.log so a Railway log drain can later
 * sink the stream into BigQuery (or any structured-log backend) without
 * any agent-side change.
 *
 * Shape (one JSON object per line):
 *   {
 *     audit: true,
 *     ts: "2026-05-22T17:04:11.812Z",
 *     tool_name: "schedule_event",
 *     tenant_id: "did:privy:..." | null,
 *     duration_ms: 412,
 *     status: "ok" | "error",
 *     error_code: "GCAL_AUTH_FAILED" | null,
 *     error_message: "string" | null
 *   }
 *
 * Why HOF (higher-order function) instead of inline instrumentation:
 *   - Single audit emission point per tool — no risk of half-instrumented
 *     branches.
 *   - Error path always logs (catch + re-throw), even when callers swallow
 *     the exception further up.
 *   - Wrapped handlers stay drop-in compatible with existing
 *     (input, ctx) signatures.
 *
 * NOTE: No PHI redaction here. That's a separate concern; when Sentry
 * (or any structured sink) gets wired up, redaction belongs at that
 * layer with a single allowlist of safe fields. Keeping this module
 * plain console.log on purpose.
 */

import { recordToolError } from "./refresh-failure-alarm.js";

/**
 * Extract a tenant id from an arbitrary ctx object. We tolerate either
 * shape because the dispatcher passes `{ tenant: { ... } }` and some
 * callers may eventually want to log without a full tenant object.
 *
 * @param {object | null | undefined} ctx
 * @returns {string | null}
 */
function extractTenantId(ctx) {
  if (!ctx) return null;
  const t = ctx.tenant || ctx;
  if (!t || typeof t !== "object") return null;
  return t.privyDid || t.id || null;
}

/**
 * Pull a stable error_code off a thrown value. Mirrors the Togari
 * pattern (err.code, fall back to INTERNAL_ERROR).
 *
 * @param {unknown} err
 * @returns {string}
 */
function extractErrorCode(err) {
  if (err && typeof err === "object") {
    const code = /** @type {any} */ (err).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "INTERNAL_ERROR";
}

/**
 * Pull a human-readable error_message off a thrown value.
 *
 * @param {unknown} err
 * @returns {string}
 */
function extractErrorMessage(err) {
  if (err && typeof err === "object") {
    const msg = /** @type {any} */ (err).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return String(err);
}

/**
 * Emit a single audit event as a JSON line on stdout.
 *
 * Exposed for ad-hoc logging from code paths that aren't a tool wrap
 * (e.g. a scheduled job emitting "started" / "finished" markers). For
 * tool calls, prefer withAuditLog().
 *
 * @param {object} event
 */
export function logAuditEvent(event) {
  const out = {
    audit: true,
    ts: new Date().toISOString(),
    ...event,
  };
  // console.log: same stream Railway already captures; one line per call
  // so a downstream parser can split on newline.
  console.log(JSON.stringify(out));
}

/**
 * Higher-order function: wrap a tool handler so every invocation emits
 * a structured audit line.
 *
 * Wrapped handler keeps the (input, ctx) signature used across the
 * Medha tool surface, so it's a drop-in replacement at registration
 * time.
 *
 * @template T, R
 * @param {string} toolName
 * @param {(input: T, ctx?: any) => Promise<R> | R} handlerFn
 * @returns {(input: T, ctx?: any) => Promise<R>}
 */
export function withAuditLog(toolName, handlerFn) {
  if (typeof handlerFn !== "function") {
    throw new TypeError(
      `withAuditLog: handler for "${toolName}" must be a function`,
    );
  }
  return async function auditedHandler(input, ctx) {
    const start = Date.now();
    const tenantId = extractTenantId(ctx);
    try {
      const result = await handlerFn(input, ctx);
      logAuditEvent({
        tool_name: toolName,
        tenant_id: tenantId,
        duration_ms: Date.now() - start,
        status: "ok",
        error_code: null,
        error_message: null,
      });
      return result;
    } catch (err) {
      const errorMessage = extractErrorMessage(err);
      logAuditEvent({
        tool_name: toolName,
        tenant_id: tenantId,
        duration_ms: Date.now() - start,
        status: "error",
        error_code: extractErrorCode(err),
        error_message: errorMessage,
      });
      // Refresh-failure alarm hook — emits an iMessage to Caleb when a
      // tenant's OAuth refresh tool starts failing repeatedly. Skips
      // silently when toolName isn't refresh-flavor, when alarming is
      // disabled, or when the cooldown is still in effect. Never throws.
      try {
        recordToolError(toolName, tenantId, errorMessage);
      } catch {
        // belt and suspenders — alarm logic shouldn't ever propagate
      }
      // Re-throw so existing error-handling chains (retries,
      // user-facing fallbacks, Sentry capture) stay intact.
      throw err;
    }
  };
}
