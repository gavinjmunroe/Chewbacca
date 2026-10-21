/**
 * OAuth state machine for the Phase 1 /connect flow.
 *
 * Every platform OAuth init writes a doc into Firestore `pending_oauth`,
 * keyed by a signed HMAC token, with a 10-minute TTL. The matching
 * callback reads + deletes that doc atomically (see
 * src/db/pending-oauth.js) so a stolen state value can't be replayed by
 * a second hit.
 *
 * The state token itself is:
 *
 *   state = HMAC-SHA256(did + ':' + platform + ':' + random32hex)
 *           keyed by OAUTH_STATE_SECRET, hex-encoded
 *
 * The HMAC isn't load-bearing for replay protection (the transactional
 * delete is) — its job is to make the token unforgeable so an outsider
 * can't poke at the callback by guessing the URL space. Including did +
 * platform in the HMAC input also means a token leaked from one user's
 * flow won't accidentally collide with another user's pending state.
 *
 * Each platform OAuth module (google, slack, linkedin, ...) calls into
 * generateState + storePending on the init endpoint and consumePending
 * on the callback. consumePending returns the original {did, platform,
 * returnTo} so the callback can complete the token exchange and know
 * where to send the user back to.
 */

import { createHmac, randomBytes } from "node:crypto";
import { createPendingDoc, consumePendingDoc } from "../db/pending-oauth.js";

const TTL_MS = 10 * 60 * 1000; // 10 minutes

function loadSecret() {
  const raw = process.env.OAUTH_STATE_SECRET;
  if (!raw) {
    throw new Error(
      "OAUTH_STATE_SECRET is required. Generate with: " +
        'node -e \'console.log(require("crypto").randomBytes(32).toString("base64"))\'',
    );
  }
  return raw;
}

/**
 * Generate an opaque, unforgeable state token for an OAuth flow.
 *
 * Always returns a 64-char lowercase hex string. Each call is independent
 * — two calls with the same (did, platform) return different tokens
 * because the random32 input is fresh every time, so two simultaneous
 * Google connects from the same user never collide.
 */
export function generateState(did, platform) {
  if (!did) throw new Error("did is required");
  if (!platform) throw new Error("platform is required");
  const random = randomBytes(32).toString("hex");
  const input = `${did}:${platform}:${random}`;
  return createHmac("sha256", loadSecret()).update(input).digest("hex");
}

/**
 * Persist the state along with the metadata the callback will need to
 * complete the exchange. Doc id is the state token itself, which is
 * unique by construction (HMAC of fresh random per call).
 *
 * `returnTo` is opaque to us — the callback handler passes it back to
 * the frontend redirect. Use it to send the user to /connect,
 * /onboarding, or wherever they started.
 */
export async function storePending(state, did, platform, returnTo, extra) {
  if (!state) throw new Error("state is required");
  if (!did) throw new Error("did is required");
  if (!platform) throw new Error("platform is required");
  const now = Date.now();
  await createPendingDoc(state, {
    did,
    platform,
    return_to: returnTo || null,
    extra: extra && typeof extra === "object" ? extra : null,
    created_at: new Date(now),
    expires_at: new Date(now + TTL_MS),
  });
}

/**
 * Atomically consume a pending OAuth state. Returns the original metadata
 * if the state exists, hasn't expired, and hasn't already been consumed.
 * Returns null otherwise — that null is the signal for callback handlers
 * to render a "state token invalid or expired" failure page and bail out
 * before doing any token exchange.
 *
 * Firestore TTL deletes lazily (within ~24h of expires_at), so we also
 * enforce the expiry here. A doc that's past its expires_at is treated
 * as missing, even if it hasn't been swept yet.
 */
export async function consumePending(state) {
  if (!state) return null;
  const doc = await consumePendingDoc(state);
  if (!doc) return null;
  const expiresAt = toMillis(doc.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return null;
  }
  return {
    did: doc.did,
    platform: doc.platform,
    returnTo: doc.return_to || null,
    extra: doc.extra && typeof doc.extra === "object" ? doc.extra : null,
  };
}

/**
 * Coerce Firestore Timestamp | Date | ISO-string | number into epoch ms.
 * Returns NaN for unrecognized shapes so the caller's Number.isFinite
 * check rejects them.
 */
function toMillis(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") return new Date(v).getTime();
  return NaN;
}
