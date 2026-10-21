/**
 * Quick-call: public twin of /admin/say-as-user gated by a Privy JWT
 * instead of the admin token. The iOS Shortcut (Siri / Action Button /
 * Back Tap / Share Sheet) POSTs to /api/v1/quick-call with {text} and a
 * Bearer JWT; we resolve the caller's own phone + Loop sender from
 * medha-id /v1/me, synthesize a Loop-shaped webhook, and dispatch it
 * through the same agent loop an inbound iMessage would hit.
 *
 * This file holds the pure helpers so the route handler in server.js
 * stays a thin shell that's easy to read. Tests exercise the helpers
 * directly without standing up an HTTP listener.
 */

const MIN_TEXT = 1;
const MAX_TEXT = 2000;

export const QUICK_CALL_LIMITS = { MIN_TEXT, MAX_TEXT };

/**
 * Validate and normalize the request body. Returns either a usable
 * { ok: true, text } or { ok: false, status, error } shaped for an
 * HTTP response.
 */
export function validateQuickCallInput(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, error: "invalid_body" };
  }
  const raw = body.text;
  if (typeof raw !== "string") {
    return { ok: false, status: 400, error: "text_required" };
  }
  const text = raw.trim();
  if (text.length < MIN_TEXT) {
    return { ok: false, status: 400, error: "text_required" };
  }
  if (text.length > MAX_TEXT) {
    return {
      ok: false,
      status: 400,
      error: "text_too_long",
      max: MAX_TEXT,
    };
  }
  return { ok: true, text };
}

/**
 * Build the Loop-shaped envelope the agent loop expects. Mirrors the
 * shape /admin/say-as-user uses so dispatchLoopEvent treats the call
 * as an ordinary inbound iMessage from the caller themselves.
 *
 * @param {object} opts
 * @param {string} opts.phoneNumber  E.164 caller phone (becomes `contact`)
 * @param {string} opts.loopSenderId Loop sender UUID owned by the caller
 * @param {string} opts.text         Message body
 * @param {string} [opts.messageId]  Override for testing; otherwise generated
 */
export function buildQuickCallEnvelope({
  phoneNumber,
  loopSenderId,
  text,
  messageId,
}) {
  if (!phoneNumber) throw new Error("phoneNumber required");
  if (!loopSenderId) throw new Error("loopSenderId required");
  const id =
    messageId ||
    `quick-call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    event: "message_inbound",
    contact: phoneNumber,
    text,
    group_id: null,
    sender: loopSenderId,
    message_id: id,
    source: "quick-call",
  };
}

/**
 * Look up the caller's phoneNumber + loopSenderId on medha-id by
 * forwarding the same Bearer token the client sent us. Returns null
 * when the upstream cannot identify the caller; the route handler
 * turns that into a 502/424 — never a 200 with a missing sender,
 * since /admin/say-as-user already proved that path lets a caller's
 * message be attributed to the wrong account.
 *
 * @param {object} opts
 * @param {string} opts.apiUrl          AMBER_ID_API_URL
 * @param {string} opts.authorization   Caller's `Authorization` header value
 * @param {function} [opts.fetchImpl]   Override for testing
 */
export async function fetchCallerIdentity({
  apiUrl,
  authorization,
  fetchImpl,
}) {
  if (!apiUrl) {
    return { ok: false, status: 500, error: "amber_id_url_unset" };
  }
  if (!authorization) {
    return { ok: false, status: 401, error: "missing_bearer" };
  }
  const doFetch = fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await doFetch(`${apiUrl}/v1/me`, {
      method: "GET",
      headers: { Authorization: authorization },
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: "amber_id_unreachable",
      detail: err?.message,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status === 401 ? 401 : 502,
      error: res.status === 401 ? "amber_id_rejected_token" : "amber_id_error",
      upstreamStatus: res.status,
    };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: 502, error: "amber_id_bad_json" };
  }
  const phoneNumber = body?.phoneNumber || null;
  const loopSenderId = body?.loopSenderId || null;
  // M1 identity assertion: surface the DID /v1/me resolved this token to so
  // the caller can verify it matches the locally-verified Privy DID. amber-id
  // exposes it as `did`, `privyDid`, or `id` depending on the route version.
  const did = body?.did || body?.privyDid || body?.id || null;
  if (!phoneNumber || !loopSenderId) {
    return {
      ok: false,
      status: 424,
      error: "caller_not_provisioned",
      hint: "the caller's tenant has no phone or Loop sender on file; finish onboarding before using quick-call",
    };
  }
  return { ok: true, phoneNumber, loopSenderId, did };
}
