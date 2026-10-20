/**
 * @togari/admin — Clay webhook HMAC verification
 *
 * Clay signs every webhook with HMAC-SHA256 against a shared secret.
 * Signature is delivered in the `X-Clay-Signature` header as `sha256=<hex>`.
 *
 * Caller must pass the RAW request body buffer (not the parsed JSON).
 */

import crypto from "crypto";
import type { Request } from "express";

export const CLAY_SIGNATURE_HEADER = "x-clay-signature";

export type HmacResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_secret"
        | "missing_signature"
        | "invalid_signature"
        | "malformed_signature";
    };

/**
 * Verify a Clay webhook signature against the raw request body.
 *
 * Accepts signatures in either `sha256=<hex>` or bare `<hex>` form to tolerate
 * config drift on Clay's side. Uses constant-time comparison.
 */
export function verifyClayHmac(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string | undefined,
): HmacResult {
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!signatureHeader) return { ok: false, reason: "missing_signature" };

  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length).trim()
    : signatureHeader.trim();

  if (!/^[0-9a-f]+$/i.test(provided)) {
    return { ok: false, reason: "malformed_signature" };
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(provided, "hex");
  } catch {
    return { ok: false, reason: "malformed_signature" };
  }

  if (providedBuf.length !== expectedBuf.length) {
    return { ok: false, reason: "invalid_signature" };
  }

  return crypto.timingSafeEqual(providedBuf, expectedBuf)
    ? { ok: true }
    : { ok: false, reason: "invalid_signature" };
}

/**
 * Convenience wrapper that pulls the raw body + header off an Express request.
 * Requires `express.raw({ type: 'application/json' })` to be mounted on the route.
 */
export function verifyClayHmacRequest(
  req: Request,
  secret: string | undefined,
): HmacResult {
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(req.body ?? "");
  const sig = req.headers[CLAY_SIGNATURE_HEADER] as string | undefined;
  return verifyClayHmac(rawBody, sig, secret);
}
