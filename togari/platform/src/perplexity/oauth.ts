/**
 * Perplexity Computer MCP — OAuth client (plan step 05 b–e).
 *
 * Dynamic client registration, PKCE, and the token calls. Storage goes through
 * the existing encrypted tenant-secret store (AES-256-GCM in BigQuery, master
 * key in env) so tokens never land in a file in the repo.
 */

import crypto from "crypto";
import { getTenantSecret, setTenantSecret } from "../secrets/tenantSecrets";
import { createLogger } from "../observability/logger";
import {
  PPLX_AUTHORIZE_URL,
  PPLX_TOKEN_URL,
  PPLX_REGISTRATION_URL,
  PPLX_RESOURCE,
  PPLX_SCOPE,
  PPLX_CLIENT_SECRET_KEY,
  PPLX_TOKENS_SECRET_KEY,
  perplexityRedirectUri,
} from "./config";

const logger = createLogger("perplexity/oauth");

export interface RegisteredClient {
  client_id: string;
  client_secret?: string;
}

export interface StoredTokens {
  access_token: string;
  /**
   * Absent when Perplexity does not issue one. Discovery advertises
   * refresh_token in grant_types_supported and registration accepts it, but a
   * real exchange has come back without one — and `offline_access` is rejected
   * outright as an invalid scope. When this is missing Togari cannot renew, so
   * the access token simply expires and a person re-runs the sign-in.
   */
  refresh_token?: string;
  /** Epoch ms when the access token expires. */
  expires_at: number;
  /** Epoch ms when it was issued — needed to compute the 20% refresh window. */
  issued_at: number;
}

// ── PKCE ──────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

// ── (b) Dynamic client registration ───────────────────────────────

/**
 * Register Togari as an app, once per Perplexity account.
 *
 * grant_types carries BOTH authorization_code and refresh_token. Sending only
 * authorization_code is rejected with a 400 — and without refresh_token the
 * whole keep-itself-signed-in half of step 05 is impossible.
 */
export async function registerClient(account: string): Promise<RegisteredClient> {
  const res = await fetch(PPLX_REGISTRATION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Togari",
      redirect_uris: [perplexityRedirectUri()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: PPLX_SCOPE,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Perplexity client registration failed: ${res.status} ${text}`);
  }
  const client = JSON.parse(text) as RegisteredClient;
  if (!client.client_id) {
    throw new Error(`Registration returned no client_id: ${text}`);
  }

  await setTenantSecret(account, PPLX_CLIENT_SECRET_KEY, JSON.stringify(client));
  logger.info("perplexity.client.registered", {
    account,
    clientId: client.client_id,
  });
  return client;
}

/**
 * The registered client for one account, registering on first use.
 *
 * Registered per account, not once globally: the client_secret is what the
 * token calls authenticate with, and sharing one across accounts would tie
 * every client's drafting to a single registration.
 */
export async function getOrRegisterClient(account: string): Promise<RegisteredClient> {
  const raw = await getTenantSecret(account, PPLX_CLIENT_SECRET_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as RegisteredClient;
      if (parsed.client_id) return parsed;
    } catch {
      logger.warn("perplexity.client.unparseable — re-registering", { account });
    }
  }
  return registerClient(account);
}

// ── (c) + (d) Authorization URL ───────────────────────────────────

/**
 * The URL a person opens once and clicks "allow" on.
 *
 * `resource` is required on both this and the token call even though it is in
 * none of Perplexity's documentation or discovery output. Without it the flow
 * fails in a way that does not name the missing parameter.
 */
export async function buildAuthorizeUrl(
  account: string,
  state: string,
  challenge: string,
): Promise<string> {
  const client = await getOrRegisterClient(account);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: perplexityRedirectUri(),
    scope: PPLX_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: PPLX_RESOURCE,
  });
  return `${PPLX_AUTHORIZE_URL}?${params.toString()}`;
}

// ── Token calls ───────────────────────────────────────────────────

function toStoredTokens(body: Record<string, any>, fallbackRefresh?: string): StoredTokens {
  const accessToken = body.access_token;
  if (!accessToken) throw new Error("token response carried no access_token");

  // expires_in is seconds. Default to an hour when absent so the refresh window
  // still has something to work from rather than treating it as immortal.
  const expiresIn = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
  const refresh = body.refresh_token || fallbackRefresh;

  // Field names only — never the values. This is how we learn what Perplexity
  // actually returns, since its discovery document and its behaviour disagree
  // about refresh tokens.
  logger.info("perplexity.token_response", {
    fields: Object.keys(body).sort().join(","),
    expires_in: expiresIn,
    has_refresh_token: !!refresh,
  });

  if (!refresh) {
    // Deliberately not fatal. A token that works for now is worth having, and
    // refusing to store it leaves the account signed out entirely. The renewal
    // path alerts when it runs out instead.
    logger.warn("perplexity.no_refresh_token", {
      detail:
        "Perplexity issued no refresh_token; Togari cannot renew this login on " +
        "its own and someone must re-run the sign-in before it expires",
      expires_in: expiresIn,
    });
  }

  const now = Date.now();
  return {
    access_token: String(accessToken),
    ...(refresh ? { refresh_token: String(refresh) } : {}),
    issued_at: now,
    expires_at: now + expiresIn * 1000,
  };
}

async function postToken(form: Record<string, string>): Promise<Record<string, any>> {
  const res = await fetch(PPLX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Perplexity token endpoint ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

/** (c) Exchange the one-time code for the first pair of tokens. */
export async function exchangeCodeForTokens(
  account: string,
  code: string,
  verifier: string,
): Promise<StoredTokens> {
  const client = await getOrRegisterClient(account);
  const body = await postToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: perplexityRedirectUri(),
    client_id: client.client_id,
    ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    code_verifier: verifier,
    resource: PPLX_RESOURCE,
  });
  const tokens = toStoredTokens(body);
  await saveTokens(account, tokens);
  logger.info("perplexity.tokens.issued", { account });
  return tokens;
}

/** Renew using the stored refresh token. Throws on any failure — see tokens.ts. */
export async function refreshTokens(
  account: string,
  current: StoredTokens,
): Promise<StoredTokens> {
  if (!current.refresh_token) {
    throw new Error(
      "no refresh_token was ever issued for this account — Perplexity does not " +
        "appear to grant them here, so the sign-in has to be re-run by hand: " +
        "npx tsx scripts/perplexity-signin.ts --client=<id>",
    );
  }
  const client = await getOrRegisterClient(account);
  const body = await postToken({
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
    client_id: client.client_id,
    ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    resource: PPLX_RESOURCE,
  });
  // Some servers omit refresh_token on renewal, meaning "keep the one you have".
  const tokens = toStoredTokens(body, current.refresh_token);
  await saveTokens(account, tokens);
  logger.info("perplexity.tokens.refreshed", { account });
  return tokens;
}

// ── (e) Storage ───────────────────────────────────────────────────

export async function saveTokens(account: string, tokens: StoredTokens): Promise<void> {
  await setTenantSecret(account, PPLX_TOKENS_SECRET_KEY, JSON.stringify(tokens));
}

export async function loadTokens(account: string): Promise<StoredTokens | null> {
  const raw = await getTenantSecret(account, PPLX_TOKENS_SECRET_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredTokens;
    if (!parsed.access_token) return null;
    return parsed;
  } catch {
    return null;
  }
}
