/**
 * Slack request signature verification.
 *
 * Mirrors Togari's verifier (togari-platform/src/transports/slack/index.ts):
 * HMAC SHA256 over `v0:${timestamp}:${rawBody}`, constant-time compared
 * to the `x-slack-signature` header. Rejects requests with timestamps
 * more than 5 minutes from now as replay protection.
 *
 * Required env var:
 *   SLACK_SIGNING_SECRET — from the Slack app's "Basic Information" page.
 *
 * @param {string} rawBody — the exact request body bytes (utf8 string)
 * @param {Object} headers — node http request.headers (lowercased)
 * @param {string} signingSecret — process.env.SLACK_SIGNING_SECRET
 * @returns {{ok: boolean, reason?: string}}
 */
import { createHmac, timingSafeEqual } from "crypto";

const REPLAY_WINDOW_SECONDS = 300; // 5 minutes, same as Togari

export function verifySlackSignature(rawBody, headers, signingSecret) {
  if (!signingSecret) {
    return { ok: false, reason: "no-signing-secret-configured" };
  }
  const timestamp = headers["x-slack-request-timestamp"] || "";
  const signature = headers["x-slack-signature"] || "";

  if (!timestamp || !signature) {
    return { ok: false, reason: "missing-signature-headers" };
  }

  const requestTime = parseInt(timestamp, 10);
  if (Number.isNaN(requestTime)) {
    return { ok: false, reason: "bad-timestamp" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - requestTime) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "timestamp-too-old" };
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = createHmac("sha256", signingSecret)
    .update(baseString)
    .digest("hex");
  const expected = `v0=${hmac}`;

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) {
      return { ok: false, reason: "signature-length-mismatch" };
    }
    if (timingSafeEqual(a, b)) {
      return { ok: true };
    }
    return { ok: false, reason: "signature-mismatch" };
  } catch (err) {
    return { ok: false, reason: `signature-compare-error:${err.message}` };
  }
}
