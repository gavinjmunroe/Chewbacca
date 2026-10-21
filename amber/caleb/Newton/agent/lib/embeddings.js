/**
 * embeddings.js — thin HTTP proxy to medha-id /v1/embeddings/*.
 *
 * Flaws #33 + #34: the agent USED to call OpenAI for vectors and write
 * to BigQuery directly. That left us with two services competing for
 * the same writes and divergent retry/fallback logic. The new contract:
 *
 *   medha-id OWNS embeddings.
 *   medha-imessage POSTS messages and walks away.
 *
 * Public function signatures (recordInbound, recordOutbound,
 * recordContactFact, embedText, isAvailable) are preserved so callers
 * don't have to change. embedText is now a remote call too — used by
 * the inline fact-extractor in flaw #31.
 *
 * Auth:
 *   MEDHA_ID_URL       (e.g. https://medha-id-production.up.railway.app)
 *   MEDHA_ID_API_KEY   (X-API-Key header for /v1/embeddings/*)
 *
 * Both fall back to AMBER_ID_API_URL / AMBER_ID_API_KEY during the
 * cutover (see constants.js).
 *
 * Failures are warned + swallowed: the reply path never blocks on this.
 */

import { MEDHA_ID_URL, MEDHA_ID_API_KEY } from "./constants.js";

const REQUEST_TIMEOUT_MS = 5_000;

export function isAvailable() {
  return !!(MEDHA_ID_URL && MEDHA_ID_API_KEY);
}

async function postJson(path, body) {
  if (!isAvailable()) return null;
  try {
    const res = await fetch(`${MEDHA_ID_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": MEDHA_ID_API_KEY,
      },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // /v1/embeddings/* return 202 with {accepted:true} — anything in
    // the 2xx range is fine.
    if (res.status >= 200 && res.status < 300) return true;
    const text = await res.text().catch(() => "");
    console.warn(`[embeddings] ${path} ${res.status}: ${text.slice(0, 200)}`);
    return false;
  } catch (err) {
    console.warn(`[embeddings] ${path} failed: ${err.message}`);
    return false;
  }
}

/**
 * Embed a string of text via medha-id /v1/embeddings/embed. Returns
 * { vector, model } on success, null on failure or when no text.
 *
 * Used by the local fact-extractor (flaw #31) when it needs an
 * embedding without writing a row. If medha-id doesn't expose /embed
 * (it currently doesn't), this returns null gracefully — the caller
 * treats that as "no vector available" and lets medha-id's
 * recordContactFact compute one on its own.
 */
export async function embedText(text) {
  if (!text || typeof text !== "string") return null;
  if (!isAvailable()) return null;
  try {
    const res = await fetch(`${MEDHA_ID_URL}/v1/embeddings/embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": MEDHA_ID_API_KEY,
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data?.vector) return null;
    return { vector: data.vector, model: data.model || null };
  } catch {
    return null;
  }
}

/**
 * Record an inbound message — proxied to medha-id which embeds + writes
 * to medha_conversations.inbound_messages.
 */
export async function recordInbound(params) {
  if (!params?.tenantDid || !params?.contact || !params?.messageId) return;
  return postJson("/v1/embeddings/inbound", params);
}

/**
 * Record an outbound (Medha) reply — proxied to medha-id.
 */
export async function recordOutbound(params) {
  if (!params?.tenantDid || !params?.contact) return;
  return postJson("/v1/embeddings/outbound", params);
}

/**
 * Record a fact about a contact — proxied to medha-id.
 * Used by the fact-extractor in lib/auto-memory.js + the proactive
 * runner's contact_facts job (flaws #31 and #52).
 */
export async function recordContactFact(params) {
  if (!params?.tenantDid || !params?.contact || !params?.fact) return;
  return postJson("/v1/embeddings/contact-fact", params);
}
