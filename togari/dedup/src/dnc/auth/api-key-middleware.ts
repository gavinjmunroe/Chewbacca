/**
 * API key middleware — validates `Authorization: Bearer tgi_live_...` headers.
 *
 * Looks up the SHA-256 hash of the presented key against togari_dnc.api_keys.
 * On hit (and not revoked), sets res.locals.apiKey = { ownerId, keyId, keyPrefix }
 * and async-bumps last_used_at. On miss, returns 401.
 */

import type { Request, Response, NextFunction } from "express";
import { verifyKey } from "./api-keys.js";

export async function validateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.header("authorization") ?? req.header("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({
      error: "Missing or malformed Authorization header (expected Bearer)",
    });
    return;
  }

  const token = auth.slice(7).trim();
  if (!token.startsWith("tgi_live_")) {
    res
      .status(401)
      .json({ error: "Invalid API key format (expected tgi_live_*)" });
    return;
  }

  try {
    const ctx = await verifyKey(token);
    if (!ctx) {
      res.status(401).json({ error: "Invalid or revoked API key" });
      return;
    }
    res.locals.apiKey = ctx;
    next();
  } catch (err) {
    process.stderr.write(
      `[api-keys] verify failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    res.status(500).json({ error: "Key verification failed" });
  }
}
