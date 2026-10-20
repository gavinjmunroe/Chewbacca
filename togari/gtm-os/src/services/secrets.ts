/**
 * Google Secret Manager client with in-memory caching.
 *
 * Strategy (in order):
 *   1. Return from cache if not expired (5-minute TTL)
 *   2. Fetch from Secret Manager (Cloud Run / GCP environments)
 *   3. Fall back to environment variable (local development)
 *
 * This means local dev works with plain env vars (no GCP auth needed),
 * and production never reads plaintext secrets from the environment.
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const PROJECT_ID = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedSecret {
  value: string;
  expiresAt: number;
}

class SecretStore {
  private client: SecretManagerServiceClient | null = null;
  private cache = new Map<string, CachedSecret>();

  private getClient(): SecretManagerServiceClient {
    if (!this.client) {
      this.client = new SecretManagerServiceClient();
    }
    return this.client;
  }

  async get(secretName: string): Promise<string | undefined> {
    // 1. Cache hit
    const cached = this.cache.get(secretName);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    // 2. Secret Manager
    try {
      const name = `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`;
      const [version] = await this.getClient().accessSecretVersion({ name });
      const value = version.payload?.data?.toString('utf8') ?? '';
      if (value) {
        this.cache.set(secretName, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        return value;
      }
    } catch {
      // Not on GCP, secret doesn't exist, or no permissions — fall through to env var
    }

    // 3. Env var fallback (local development)
    const envValue = process.env[secretName];
    if (envValue) {
      return envValue;
    }

    return undefined;
  }
}

// Module-level singleton — shared across all requests; cache lives here
const store = new SecretStore();

// ─── Secrets loaded at startup ────────────────────────────────────────────────

export interface AppSecrets {
  /** Required — Claude API */
  anthropicApiKey: string;
  /** Optional — only needed when those integrations are wired up */
  exaApiKey?: string;
  clayApiKey?: string;
  structifyApiKey?: string;
}

/**
 * Load all application secrets. Call once at startup; the in-memory cache
 * prevents repeated Secret Manager round-trips within the same process.
 *
 * Throws if ANTHROPIC_API_KEY is unavailable (required for SQL generation).
 */
export async function loadSecrets(): Promise<AppSecrets> {
  const [anthropicApiKey, exaApiKey, clayApiKey, structifyApiKey] = await Promise.all([
    store.get('ANTHROPIC_API_KEY'),
    store.get('EXA_API_KEY'),
    store.get('CLAY_API_KEY'),
    store.get('STRUCTIFY_API_KEY'),
  ]);

  if (!anthropicApiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY not found in Secret Manager or environment.\n' +
      'Local dev: set ANTHROPIC_API_KEY=sk-ant-... in your environment.\n' +
      'Cloud Run: create a secret named ANTHROPIC_API_KEY in Secret Manager.',
    );
  }

  return { anthropicApiKey, exaApiKey, clayApiKey, structifyApiKey };
}
