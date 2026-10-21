/**
 * Read-only tool retry middleware (Tab 14, item 193).
 *
 * Calendar, email, and drive reads fail transiently far more often than they
 * fail for real: an OAuth token refresh races a request, Google returns a 503,
 * a socket hangs up. Today a single transient blip surfaces to the model as a
 * tool error and the turn degrades to "I couldn't reach your calendar" — a
 * silent-empty-reply class of bug — when a second attempt 300ms later would
 * have succeeded.
 *
 * This wraps an ALLOWLIST of strictly READ-ONLY tools with a bounded retry on
 * transient failures only. Writes (create / update / delete an event, send an
 * email, write a file) are deliberately NOT in the allowlist: retrying a write
 * that actually succeeded but whose response was lost would double-book a
 * meeting or send a duplicate email. Reads are idempotent, so retrying them is
 * safe.
 *
 * Transient is detected two ways:
 *   1. a THROWN error whose name/message matches the network/5xx/timeout set, or
 *   2. a RETURNED `{ error }` envelope whose code reads as transient (upstream
 *      5xx, timeout, rate-limited). Hard failures (auth, not-found, validation)
 *      are returned immediately — retrying them just wastes the turn.
 *
 * After exhausting attempts it returns a structured `{ error: 'tool_unavailable' }`
 * envelope (never throws, never an empty reply) so the model can tell the user
 * something actionable.
 */

// Strictly read-only calendar / email / drive tools. Source of truth for what
// is safe to retry. Add a tool here ONLY if calling it twice has no side effect.
export const RETRYABLE_READ_TOOLS = new Set([
  // calendar reads
  "list_events",
  "get_availability",
  "find_free_block",
  "summarize_week",
  // email reads
  "gmail_search",
  "gmail_list",
  "gmail_get_message",
  "gmail_get_thread",
  // drive / docs reads
  "drive_search",
  "drive_list",
  "drive_read_file",
  "read_file_content",
  "workspace_docs_search",
]);

// Error codes (from a returned envelope) that are worth a retry. Everything
// else — auth_required, not_found, invalid_input — is returned as-is.
const TRANSIENT_ERROR_CODES = new Set([
  "timeout",
  "upstream_unavailable",
  "upstream_error",
  "rate_limited",
  "network_error",
  "unavailable",
]);

const TRANSIENT_MESSAGE_RE =
  /\b(timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed|temporarily|try again|503|502|504|overloaded|unavailable)\b/i;

// Backoff schedule (ms) between attempts. Length defines the retry count.
// Short by design: a read that needs a refresh usually recovers on the first
// retry, and we never want to add seconds of latency to a turn. Settable to
// [0,0] in tests via __internals so the suite runs instantly.
let BACKOFF_MS = [250, 600];

function isTransientThrow(err) {
  if (!err) return false;
  const name = err.name || "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  const msg = err.message || String(err);
  return TRANSIENT_MESSAGE_RE.test(msg);
}

function isTransientResult(result) {
  if (!result || typeof result !== "object") return false;
  const code = result.error;
  if (!code || typeof code !== "string") return false;
  if (TRANSIENT_ERROR_CODES.has(code)) return true;
  // Some tools fold the detail into the message; sniff it too.
  return TRANSIENT_MESSAGE_RE.test(`${code} ${result.message || ""}`);
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap a tool handler with a bounded transient-failure retry. A no-op
 * pass-through for any tool not in RETRYABLE_READ_TOOLS, so it is safe to apply
 * to the whole dispatcher.
 *
 * @param {string} toolName
 * @param {(toolUse: any, ctx?: any) => Promise<any>} handlerFn
 * @returns {(toolUse: any, ctx?: any) => Promise<any>}
 */
export function withToolRetry(toolName, handlerFn) {
  if (typeof handlerFn !== "function") {
    throw new TypeError(
      `withToolRetry: handler for "${toolName}" must be a function`,
    );
  }
  if (!RETRYABLE_READ_TOOLS.has(toolName)) return handlerFn;

  return async function retryingHandler(toolUse, ctx) {
    const maxAttempts = BACKOFF_MS.length + 1;
    let lastErr = null;
    let lastTransientResult = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await handlerFn(toolUse, ctx);
        if (attempt < maxAttempts && isTransientResult(result)) {
          lastTransientResult = result;
          console.warn(
            `[tool-retry] ${toolName} transient result (attempt ${attempt}/${maxAttempts}): ${result.error}`,
          );
          await sleep(BACKOFF_MS[attempt - 1]);
          continue;
        }
        return result;
      } catch (err) {
        lastErr = err;
        // Non-transient throw: surface it unchanged so existing handling
        // (auth-bounce, the model's own recovery) still applies.
        if (!isTransientThrow(err)) throw err;
        if (attempt < maxAttempts) {
          console.warn(
            `[tool-retry] ${toolName} transient throw (attempt ${attempt}/${maxAttempts}): ${err.message || err}`,
          );
          await sleep(BACKOFF_MS[attempt - 1]);
          continue;
        }
        // Transient throw on the final attempt: fall through to the structured
        // tool_unavailable envelope below instead of throwing an empty failure.
      }
    }
    // Exhausted retries on a transient failure. Return a structured, actionable
    // envelope rather than throwing or replying empty.
    if (lastTransientResult) return lastTransientResult;
    console.warn(
      `[tool-retry] ${toolName} exhausted retries: ${lastErr?.message || lastErr}`,
    );
    return {
      error: "tool_unavailable",
      tool: toolName,
      message:
        "I could not reach that service after a couple of tries. Give it a moment and ask again.",
    };
  };
}

// Test-only helpers. Don't import in production code.
export const __internals = {
  isTransientThrow,
  isTransientResult,
  setBackoff(arr) {
    BACKOFF_MS = arr;
  },
  resetBackoff() {
    BACKOFF_MS = [250, 600];
  },
};
