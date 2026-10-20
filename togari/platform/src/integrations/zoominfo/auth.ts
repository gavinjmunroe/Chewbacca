/**
 * ZoomInfo PKI JWT authentication.
 *
 * ZoomInfo's enterprise API ships with a short-lived JWT auth flow:
 *
 *   1. Client mints an RS256 client_jwt locally using
 *      `(username, client_id, private_key)`.
 *      Payload: { aud: "enterprise_api", iss, username, client_id, iat, exp }
 *   2. POST that client_jwt as `Authorization: Bearer ...` to
 *      `https://api.zoominfo.com/authenticate`.
 *   3. ZoomInfo returns a server JWT, typically ~60 minutes long.
 *      We cache it per tenant until 60 s before expiry, then refresh.
 *
 * Credentials are per-tenant. The triple lives in either:
 *   (a) Tab 7's `tenant_secrets` BQ table — preferred long-term
 *   (b) GCP Secret Manager / env vars — used until Tab 7 lands
 *
 * `getZoomInfoCredentials` is the single lookup point. Once Tab 7 merges,
 * swap the implementation to `getTenantSecret(tenantId, 'ZOOMINFO_*')` and
 * everything else keeps working.
 */

import { createSign } from "node:crypto";
import { getOptionalSecret } from "../../secrets/manager";
import { createLogger } from "../../observability/logger";
import type { ZoomInfoCredentials } from "./types";

const logger = createLogger("integrations/zoominfo/auth");

const ZOOMINFO_AUTH_URL = "https://api.zoominfo.com/authenticate";
const AUTH_429_MAX_RETRIES = 2;
const AUTH_429_BASE_DELAY_MS = 2000;
const TOKEN_SAFETY_MARGIN_SEC = 60;

// ─── Credential lookup ───────────────────────────────────────────────────────

/**
 * Resolve the ZoomInfo PKI credential triple for a tenant.
 *
 * Resolution order:
 *   1. `tenant_secrets` (Tab 7) — when the helper is available.
 *      The keys are `ZOOMINFO_USERNAME`, `ZOOMINFO_CLIENT_ID`,
 *      `ZOOMINFO_PRIVATE_KEY`.
 *   2. GCP Secret Manager → env fallback via the existing 3-tier
 *      `getOptionalSecret(name)`. Secret names follow the catalog
 *      convention: `zoominfo-username`, `zoominfo-client-id`,
 *      `zoominfo-private-key`. Treats them as platform-wide for dev.
 *   3. Direct env vars `ZOOMINFO_USERNAME`, `ZOOMINFO_CLIENT_ID`,
 *      `ZOOMINFO_PRIVATE_KEY` (already handled inside `getOptionalSecret`).
 *
 * Returns `null` if any of the three components is missing — callers
 * surface a clear "ZoomInfo not configured for this tenant" message.
 */
export async function getZoomInfoCredentials(
  tenantId: string,
): Promise<ZoomInfoCredentials | null> {
  // Once Tab 7 ships `getTenantSecret`, prepend the lookup here:
  //   const tenantUsername = await getTenantSecret(tenantId, 'ZOOMINFO_USERNAME');
  //   ...
  // For now we resolve via the existing platform secret manager. The
  // `tenantId` parameter is kept in the signature so the call sites don't
  // change when the swap happens.
  void tenantId;

  const [username, clientId, privateKeyRaw] = await Promise.all([
    getOptionalSecret("zoominfo-username"),
    getOptionalSecret("zoominfo-client-id"),
    getOptionalSecret("zoominfo-private-key"),
  ]);

  if (!username || !clientId || !privateKeyRaw) return null;

  // Private keys provisioned via env vars frequently have literal `\n` between
  // header/body/footer — normalize so the signer sees real newlines.
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n").trim();

  return { username, clientId, privateKey };
}

// ─── Per-tenant token cache ──────────────────────────────────────────────────

interface CacheEntry {
  token: string;
  /** Epoch seconds at which the token expires. */
  expEpochSec: number;
}

const tokenCache = new Map<string, CacheEntry>();
const pendingAuth = new Map<string, Promise<string>>();

function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payloadPart = parts[1];
    if (!payloadPart) return null;
    const payloadJson = Buffer.from(payloadPart, "base64").toString("utf8");
    const payload = JSON.parse(payloadJson) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/**
 * Build the short-lived (5 minute) client JWT ZoomInfo's /authenticate
 * endpoint exchanges for a real session token. Signed RS256 with the
 * tenant's private key.
 */
export function buildClientJwt(creds: ZoomInfoCredentials): string {
  const nowMs = Date.now();
  const iat = Math.floor(nowMs / 1000) - 60;
  const exp = Math.floor(nowMs / 1000) + 5 * 60 - 60;

  const header = { typ: "JWT", alg: "RS256" };
  const payload = {
    aud: "enterprise_api",
    iss: "togari-zoominfo-auth-client",
    username: creds.username,
    client_id: creds.clientId,
    iat,
    exp,
  };

  const unsigned = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(
    JSON.stringify(payload),
  )}`;

  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(creds.privateKey).toString("base64url");

  return `${unsigned}.${signature}`;
}

async function fetchAccessToken(
  tenantId: string,
  creds: ZoomInfoCredentials,
): Promise<string> {
  const clientJwt = buildClientJwt(creds);

  for (let attempt = 0; attempt <= AUTH_429_MAX_RETRIES; attempt++) {
    const response = await fetch(ZOOMINFO_AUTH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${clientJwt}` },
    });

    if (response.status === 429 && attempt < AUTH_429_MAX_RETRIES) {
      const waitMs = (attempt + 1) * AUTH_429_BASE_DELAY_MS;
      logger.warn("zoominfo auth rate-limited", { tenantId, attempt, waitMs });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `ZoomInfo auth failed for tenant ${tenantId}: ${response.status} ${response.statusText} ${errorText}`.trim(),
      );
    }

    const json = (await response.json()) as { jwt?: string };
    if (!json?.jwt || typeof json.jwt !== "string") {
      throw new Error("ZoomInfo authenticate did not return jwt");
    }

    const expEpochSec =
      decodeJwtExp(json.jwt) ?? Math.floor(Date.now() / 1000) + 50 * 60;
    tokenCache.set(tenantId, { token: json.jwt, expEpochSec });
    return json.jwt;
  }

  throw new Error(
    `ZoomInfo auth failed for tenant ${tenantId} after ${AUTH_429_MAX_RETRIES} retries`,
  );
}

/**
 * Get a valid ZoomInfo access token for a tenant. Uses an in-memory cache
 * keyed by `tenantId` with a 60 s safety margin before expiry. Parallel
 * callers for the same tenant share a single in-flight auth request
 * (ZoomInfo's auth endpoint allows ~1 req/s per credential).
 */
export async function getZoomInfoAccessToken(
  tenantId: string,
): Promise<string> {
  const cached = tokenCache.get(tenantId);
  const nowSec = Math.floor(Date.now() / 1000);
  if (cached && nowSec < cached.expEpochSec - TOKEN_SAFETY_MARGIN_SEC) {
    return cached.token;
  }

  const inflight = pendingAuth.get(tenantId);
  if (inflight) return inflight;

  // Register the in-flight promise BEFORE awaiting credentials so concurrent
  // callers for the same tenant share a single auth pass — the credential
  // lookup itself can be slow when it hits Secret Manager.
  const promise = (async () => {
    const creds = await getZoomInfoCredentials(tenantId);
    if (!creds) {
      throw new Error(
        `ZoomInfo credentials not configured for tenant ${tenantId}. Set ZOOMINFO_USERNAME, ZOOMINFO_CLIENT_ID, and ZOOMINFO_PRIVATE_KEY (env or tenant_secrets).`,
      );
    }
    return fetchAccessToken(tenantId, creds);
  })().finally(() => {
    pendingAuth.delete(tenantId);
  });
  pendingAuth.set(tenantId, promise);
  return promise;
}

/**
 * Force-evict the cached token for a tenant. Called after a 401 in the
 * client so the next call mints a fresh one.
 */
export function invalidateZoomInfoToken(tenantId: string): void {
  tokenCache.delete(tenantId);
}

/**
 * Reset the per-tenant token + in-flight caches. Test only.
 */
export function _resetZoomInfoAuthCacheForTests(): void {
  tokenCache.clear();
  pendingAuth.clear();
}
