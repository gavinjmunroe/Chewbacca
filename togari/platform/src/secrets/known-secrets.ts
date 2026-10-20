/**
 * @togari/admin — Known secrets catalog
 *
 * Typed references to all secrets in the ecosystem. Avoids magic strings.
 * Resolves via the 3-tier system in manager.ts.
 */

import { getSecret, getOptionalSecret } from "./manager";

export const SECRET_NAMES = {
  anthropicApiKey: "anthropic-api-key",
  exaApiKey: "exa-api-key",
  clayApiKey: "clay-api-key",
  structifyApiKey: "structify-api-key",
  gcpServiceAccount: "gcp-service-account",
  gcpCredentialsBase64: "gcp-credentials-base64",
  googleOAuthClientId: "google-oauth-client-id",
  googleOAuthClientSecret: "google-oauth-client-secret",
  firefliesApiKey: "fireflies-api-key",
  loomApiKey: "loom-api-key",
  redisUrl: "redis-url",
  sentryDsn: "sentry-dsn",
  // ZoomInfo PKI triple. Per-tenant long-term (Tab 7 tenant_secrets); for now
  // resolves via the platform 3-tier and is treated as a single-tenant default.
  zoominfoUsername: "zoominfo-username",
  zoominfoClientId: "zoominfo-client-id",
  zoominfoPrivateKey: "zoominfo-private-key",
} as const;

export type SecretName = keyof typeof SECRET_NAMES;

/** Get a required secret by typed name */
export async function getTypedSecret(name: SecretName): Promise<string> {
  return getSecret(SECRET_NAMES[name]);
}

/** Get an optional secret by typed name */
export async function getOptionalTypedSecret(
  name: SecretName,
): Promise<string | undefined> {
  return getOptionalSecret(SECRET_NAMES[name]);
}
