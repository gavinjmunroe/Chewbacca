/**
 * stream-frames.js — structured SSE frame builders for the in-app
 * /api/v1/quick-call/stream path (and any future streamed agent surface).
 *
 * Why this exists (Tab 14, items 191 + 199): the stream route used to emit
 * raw, ad-hoc objects — `{ error: "empty_response", message: "Medha had no
 * reply." }` inline in the handler, with no notion of whether the client
 * should offer a Retry, an Upgrade, or a "finish setup" card. The iOS app
 * (Tab 3) wants to map a failure to the RIGHT friendly UI, not a generic
 * error bubble. This module centralizes:
 *
 *   - the small registry of failure CODES the app knows how to render,
 *   - their default human-facing copy (no em dash, no emoji, house voice),
 *   - whether each is retryable (drives a Retry button vs a dead-end card),
 *   - the friendly "tool is running" labels for progress frames.
 *
 * Pure and dependency-free so it is trivially testable and reusable by both
 * the HTTP handler and the test suite that pins the frame contract.
 */

/**
 * The failure codes the iOS client maps to specific UI. Keep these in sync
 * with the app's stream parser. `retryable` tells the client whether to show
 * a Retry affordance (true) or a terminal card such as mint / upgrade (false).
 */
export const STREAM_ERROR_REGISTRY = Object.freeze({
  empty_response: {
    message: "Medha had no reply. Try asking a different way.",
    retryable: true,
  },
  agent_failed: {
    message: "Medha hit a snag on that one. Tap to try again.",
    retryable: true,
  },
  timeout: {
    message: "That one took too long. Tap to try again.",
    retryable: true,
  },
  rate_limited: {
    message: "A lot is happening at once. Give it a moment and try again.",
    retryable: true,
  },
  upstream_unavailable: {
    message: "A service Medha needs is down right now. Try again shortly.",
    retryable: true,
  },
  identity_not_minted: {
    message: "Finish setting up your account to talk to Medha here.",
    retryable: false,
  },
  entitlement_required: {
    message: "Upgrade to unlock this.",
    retryable: false,
  },
});

/**
 * Build a structured error frame body for an SSE `error` event.
 *
 * @param {string} code   One of STREAM_ERROR_REGISTRY (falls back to a safe
 *                        generic envelope for unknown codes so the client
 *                        still renders something actionable).
 * @param {object} [opts]
 * @param {string} [opts.message]  Override the default human copy.
 * @param {string} [opts.detail]   Optional technical detail (logged client-side,
 *                                  never shown raw to the user).
 * @returns {{ error: string, message: string, retryable: boolean, detail?: string }}
 */
export function buildStreamError(code, opts = {}) {
  const known = STREAM_ERROR_REGISTRY[code];
  const body = {
    error: typeof code === "string" && code ? code : "agent_failed",
    message:
      opts.message ||
      known?.message ||
      "Something went wrong. Tap to try again.",
    // Unknown codes default to retryable so the user is never dead-ended by a
    // failure mode we did not anticipate.
    retryable: known ? known.retryable : true,
  };
  if (opts.detail) body.detail = String(opts.detail).slice(0, 300);
  return body;
}

/**
 * Map an HTTP-style status + error string (as returned by resolveQuickCall
 * identity gating) to the stream error CODE the client renders. Keeps the
 * route handler from re-deriving this mapping inline.
 *
 * @param {number} status
 * @param {string} [error]
 * @returns {string} a key into STREAM_ERROR_REGISTRY
 */
export function statusToStreamErrorCode(status, error = "") {
  const e = String(error || "").toLowerCase();
  if (e.includes("entitlement")) return "entitlement_required";
  if (
    e.includes("not_provisioned") ||
    e.includes("not_minted") ||
    e.includes("identity")
  ) {
    return "identity_not_minted";
  }
  if (status === 402) return "entitlement_required";
  if (status === 401 || status === 403 || status === 424) {
    return "identity_not_minted";
  }
  if (status === 429) return "rate_limited";
  if (status === 504) return "timeout";
  if (status >= 502 && status <= 503) return "upstream_unavailable";
  return "agent_failed";
}

/**
 * Friendly, present-tense status copy for a tool the agent is about to run.
 * Streamed as a `progress` frame so the app can show "Checking your calendar"
 * instead of an idle spinner (item 191). Matching is by the leading segment of
 * the tool name so a whole family of tools collapses to one human phrase.
 *
 * @param {string} toolName
 * @returns {string} a short human label (never empty)
 */
export function toolProgressLabel(toolName) {
  const n = String(toolName || "").toLowerCase();
  // Most specific families first.
  if (/(^|_)(gcal|calendar|cal_|event|schedule)/.test(n)) {
    return "Checking your calendar";
  }
  if (/(^|_)(gmail|email|mail|inbox)/.test(n)) {
    return "Reading your email";
  }
  if (/(^|_)(drive|docs|sheets|workspace_docs|file)/.test(n)) {
    return "Looking through your Drive";
  }
  if (/(^|_)(web_search|deep_research|exa|perplexity|browse|crust)/.test(n)) {
    return "Searching the web";
  }
  if (/(^|_)(people|contact|relationship|peoplerank|graph)/.test(n)) {
    return "Searching your network";
  }
  if (/(^|_)(reminder|todoist|task)/.test(n)) {
    return "Checking your reminders";
  }
  if (/(^|_)(memory|recall|remember)/.test(n)) {
    return "Looking through what I remember";
  }
  if (/(^|_)(image|carousel|pdf|file_gen|generate)/.test(n)) {
    return "Putting that together";
  }
  return "Working on it";
}

/**
 * Build a progress frame body for an SSE `progress` event.
 *
 * @param {string} phase  A short machine phase tag ("thinking" | "tool").
 * @param {string} label  Human-facing status text.
 * @returns {{ phase: string, label: string }}
 */
export function buildProgressFrame(phase, label) {
  return {
    phase: typeof phase === "string" && phase ? phase : "thinking",
    label: typeof label === "string" && label ? label : "Thinking",
  };
}
