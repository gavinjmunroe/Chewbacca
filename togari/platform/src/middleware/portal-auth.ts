/**
 * Portal authentication middleware.
 *
 * Gates the /api/v1/portal/* routes with PER-CLIENT keys instead of the shared
 * internal TOGARI_API_KEY. An external client (e.g. a client on the BMA website login) sends their own
 * "tgc_..." key and only ever acts as their own client_id.
 *
 * Key precedence:
 *   1. A "tgc_" key (via `Authorization: Bearer <key>` or `X-Client-Key`) is
 *      validated against togari_data_lake.client_api_keys. On success we stamp
 *      req.togariClientId with the key's client_id and continue. On failure: 401.
 *   2. The internal TOGARI_API_KEY (via `X-Togari-Key`) is an ADMIN bypass: it
 *      passes through WITHOUT setting a client scope, so an admin can act on any
 *      client (routes fall back to their existing x-togari-client header).
 *   3. No key at all: allowed only when NODE_ENV is "development" or "test";
 *      anything else, including NODE_ENV unset, is 401.
 *
 * Routes should prefer req.togariClientId over the x-togari-client header when
 * it is set, so a scoped client cannot spoof another client's id.
 */

import { createHash, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { BigQueryClient } from "../bigquery/client";
import { resolveClientKey } from "../auth/client-keys";
import { createLogger } from "../observability/logger";

const logger = createLogger("middleware/portal-auth");

// Augment the Express Request with the resolved, key-scoped client id.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      togariClientId?: string;
    }
  }
}

const CLIENT_KEY_PREFIX = "tgc_";

function readClientKey(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token) return token;
  }
  const headerKey = req.header("x-client-key");
  if (headerKey && headerKey.trim()) return headerKey.trim();
  return null;
}

/**
 * Compare two secrets in constant time. `===` stops at the first differing
 * character, which leaks how much of a guessed admin key was right (independent
 * review of the live read API, 2026-10-10). Hashing first makes both sides the
 * same length.
 */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Keyless portal access is a local convenience, opted into by NODE_ENV only. */
export function keylessAllowed(): boolean {
  const envName = process.env.NODE_ENV;
  return envName === "development" || envName === "test";
}

export function portalAuth(): RequestHandler {
  // Build the BigQuery client once at factory time; reused across requests.
  const bq = new BigQueryClient(
    process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3",
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // 1. Per-client "tgc_" key.
    const clientKey = readClientKey(req);
    if (clientKey && clientKey.startsWith(CLIENT_KEY_PREFIX)) {
      try {
        const resolved = await resolveClientKey(bq, clientKey);
        if (!resolved) {
          res.status(401).json({ error: "invalid client key" });
          return;
        }
        req.togariClientId = resolved.clientId;
        next();
        return;
      } catch (err) {
        logger.error(
          "portal-auth client key lookup failed",
          err instanceof Error ? err : new Error(String(err)),
        );
        res.status(401).json({ error: "invalid client key" });
        return;
      }
    }

    // 2. Internal admin bypass via X-Togari-Key. No client scope is set, so the
    //    admin can act on any client (routes fall back to x-togari-client).
    const adminKey = process.env.TOGARI_API_KEY;
    const providedAdmin = req.header("x-togari-key");
    if (adminKey && providedAdmin && sameSecret(providedAdmin, adminKey)) {
      next();
      return;
    }

    // 3. No usable key. Allowed only when NODE_ENV says development or test,
    //    never when it is unset: prod runs on Railway without NODE_ENV, and on
    //    2026-10-10 GET /api/v1/portal/dnc/list answered 200 with no key at all,
    //    falling back to the x-togari-client header for any client.
    if (keylessAllowed()) {
      logger.warn("portal-auth: no key provided, allowing through (dev mode)");
      next();
      return;
    }

    res.status(401).json({ error: "invalid client key" });
  };
}
