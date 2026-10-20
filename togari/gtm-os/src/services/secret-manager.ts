/**
 * GCP Secret Manager integration.
 * Pulls secrets from Secret Manager, falls back to env vars for local dev.
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

let client: SecretManagerServiceClient | null = null;

function getClient(): SecretManagerServiceClient {
  if (!client) {
    client = new SecretManagerServiceClient();
  }
  return client;
}

/**
 * Fetch a secret from GCP Secret Manager.
 * Returns null if Secret Manager is unavailable or the secret doesn't exist.
 */
export async function getSecret(secretName: string, projectId: string): Promise<string | null> {
  try {
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    const [version] = await getClient().accessSecretVersion({ name });
    const payload = version.payload?.data;
    if (!payload) return null;
    return typeof payload === 'string' ? payload : payload.toString();
  } catch {
    // Secret Manager unavailable or secret doesn't exist — caller should fall back to env var
    return null;
  }
}
