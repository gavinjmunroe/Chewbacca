import { Request, Response, NextFunction } from 'express';
import { db } from '../db/database';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Reject pathological client-supplied keys outright instead of hashing
// everything — 128 chars is plenty for any realistic UUID / ULID / nonce.
const MAX_KEY_LENGTH = 128;
// Responses larger than this are not worth caching — a backup-restore
// endpoint could otherwise store a megabyte-sized JSON body per request
// key and, with mass key creation, blow up idempotency_keys.
const MAX_CACHED_BODY_BYTES = 256 * 1024;

interface IdempotencyRow {
  status_code: number;
  response_body: string;
}

/**
 * Called from within `authenticate` after req.user is set.
 *
 * For mutating requests carrying X-Idempotency-Key:
 * - If (key, userId, method, path) already stored: replays the cached response.
 * - Otherwise: wraps res.json to capture and store a successful response.
 *
 * The lookup is scoped by method + path as well as user so the same key
 * replayed against a different endpoint doesn't return the cached body
 * of an unrelated request. Key length is capped and the cached body is
 * skipped when it exceeds `MAX_CACHED_BODY_BYTES`.
 *
 * Storing happens in idempotency_keys (24h TTL, cleaned by scheduler).
 */
export function applyIdempotency(req: Request, res: Response, next: NextFunction, userId: number): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const key = req.headers['x-idempotency-key'] as string | undefined;
  if (!key) {
    next();
    return;
  }
  if (key.length > MAX_KEY_LENGTH) {
    res.status(400).json({ error: 'X-Idempotency-Key exceeds maximum length of 128 characters' });
    return;
  }

  // Return cached response only if the same key was seen for the same
  // user AND the same method+path — avoids a POST's cached body leaking
  // into an unrelated PATCH that reused the idempotency-key string.
  const existing = db.prepare(
    'SELECT status_code, response_body FROM idempotency_keys WHERE key = ? AND user_id = ? AND method = ? AND path = ?'
  ).get(key, userId, req.method, req.path) as IdempotencyRow | undefined;

  if (existing) {
    res.status(existing.status_code).json(JSON.parse(existing.response_body));
    return;
  }

  // Wrap res.json to capture the response on first successful execution
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown): Response {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        const serialized = JSON.stringify(body);
        if (serialized.length <= MAX_CACHED_BODY_BYTES) {
          db.prepare(
            `INSERT OR IGNORE INTO idempotency_keys (key, user_id, method, path, status_code, response_body, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(key, userId, req.method, req.path, res.statusCode, serialized, Math.floor(Date.now() / 1000));
        }
      } catch {
        // Non-fatal: if storage fails, the request still succeeds
      }
    }
    return originalJson(body);
  };

  next();
}
