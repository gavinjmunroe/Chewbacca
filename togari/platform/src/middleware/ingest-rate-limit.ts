/**
 * @togari/admin — dependency-free fixed-window rate limiter for ingest webhooks
 *
 * Bounds BigQuery insert cost if an ingest key ever leaks. Per-instance
 * (in-memory), so it's a cost backstop rather than a distributed guarantee.
 * Each call site gets its own window map via the factory.
 */

import type { Request, Response, NextFunction } from "express";

export function createFixedWindowRateLimit(perMinute: number) {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return function rateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let win = windows.get(key);
    if (!win || now >= win.resetAt) {
      // Opportunistic sweep so the map can't grow unbounded.
      if (windows.size > 5000) {
        for (const [k, v] of windows) {
          if (now >= v.resetAt) windows.delete(k);
        }
      }
      win = { count: 0, resetAt: now + 60_000 };
      windows.set(key, win);
    }
    win.count += 1;
    if (win.count > perMinute) {
      const retryAfter = Math.ceil((win.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res
        .status(429)
        .json({ error: "rate_limited", retry_after_seconds: retryAfter });
      return;
    }
    next();
  };
}
