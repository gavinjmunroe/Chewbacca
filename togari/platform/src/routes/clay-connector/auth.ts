/**
 * Clay universal connector auth.
 *
 * One shared token, accepted three ways so it drops into any Clay HTTP API
 * column regardless of how the operator prefers to pass credentials:
 *   1. Authorization: Bearer <token>
 *   2. ?token=<token>   (query string)
 *   3. X-Togari-Key: <token>   (header)
 *
 * The token is compared in constant time against CLAY_CONNECTOR_KEY (falling
 * back to CLAY_INGEST_API_KEY so an existing Clay key keeps working). When
 * NEITHER env var is set we allow requests outside production so local tests
 * and staging spikes are frictionless, and deny in production so a missing
 * secret never silently opens the endpoint.
 *
 * Mirrors the timingSafeEqual pattern in src/routes/ingest/clay-lead.ts.
 */

import crypto from "crypto";
import type { Request } from "express";

/**
 * Constant-time compare. Length is checked first because timingSafeEqual throws
 * on unequal-length buffers; for a random key that length check is not itself a
 * meaningful side channel.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Pull the presented token from any of the three accepted transports. */
function extractToken(req: Request): string {
  const bearer = (req.header("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (bearer) return bearer;

  const headerKey = (req.header("x-togari-key") || "").trim();
  if (headerKey) return headerKey;

  const query = (req.query || {}) as Record<string, unknown>;
  const queryToken = typeof query.token === "string" ? query.token.trim() : "";
  return queryToken;
}

export interface ConnectorAuthResult {
  ok: boolean;
}

/**
 * Authorize a connector request. Returns { ok } rather than writing a response
 * so the caller controls the shape (the connector always answers 200 with a
 * flat body, even on auth failure at the sync layer, unless it chooses 401).
 */
export function checkConnectorAuth(req: Request): ConnectorAuthResult {
  const expected =
    process.env.CLAY_CONNECTOR_KEY || process.env.CLAY_INGEST_API_KEY;

  if (!expected) {
    // No key configured: allow outside production, deny in production.
    return { ok: process.env.NODE_ENV !== "production" };
  }

  const provided = extractToken(req);
  if (!provided) return { ok: false };
  return { ok: safeEqual(provided, expected) };
}
