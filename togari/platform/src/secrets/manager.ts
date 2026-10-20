/**
 * Configuration module with Secret Manager integration
 *
 * Secret resolution order (3-tier):
 * 1. Cloud Run volume mount: readFileSync('/secrets/{name}')
 * 2. Secret Manager SDK with 5-minute in-memory TTL cache
 * 3. Environment variable fallback: name → UPPER_SNAKE_CASE
 *
 * Local dev uses env vars only (tiers 1 & 2 are no-ops without GCP).
 * NEVER log secret values.
 */

import { readFileSync, existsSync } from 'fs';
import { createLogger } from '../observability/logger';

const logger = createLogger('config');

const GCP_PROJECT_ID = 'midyear-glazing-485303-u3';
const SECRET_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// In-memory TTL cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const secretCache = new Map<string, CacheEntry>();

function getCached(name: string): string | undefined {
  const entry = secretCache.get(name);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.value;
  }
  if (entry) {
    secretCache.delete(name);
  }
  return undefined;
}

function setCache(name: string, value: string): void {
  secretCache.set(name, {
    value,
    expiresAt: Date.now() + SECRET_TTL_MS,
  });
}

// ---------------------------------------------------------------------------
// Tier 1: Cloud Run volume mount
// ---------------------------------------------------------------------------

function readVolumeMountSecret(name: string): string | undefined {
  const path = `/secrets/${name}`;
  try {
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8').trim();
    }
  } catch {
    // Volume mount not available — expected in local dev
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tier 2: Secret Manager SDK (lazy-loaded to avoid import cost in local dev)
// ---------------------------------------------------------------------------

let smClient: any = null;
let smInitAttempted = false;

async function readSecretManagerSecret(name: string): Promise<string | undefined> {
  if (smInitAttempted && !smClient) return undefined;

  try {
    if (!smClient) {
      smInitAttempted = true;
      const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
      smClient = new SecretManagerServiceClient();
    }

    const secretName = `projects/${GCP_PROJECT_ID}/secrets/${name}/versions/latest`;
    const [version] = await smClient.accessSecretVersion({ name: secretName });
    const payload = version?.payload?.data;
    if (payload) {
      return typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf-8');
    }
  } catch (error) {
    // Not available (local dev, missing IAM, etc.) — fall through to env var
    logger.debug(`Secret Manager unavailable for "${name}", falling back to env`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tier 3: Environment variable fallback
// ---------------------------------------------------------------------------

function secretNameToEnvVar(name: string): string {
  return name.replace(/-/g, '_').toUpperCase();
}

function readEnvSecret(name: string): string | undefined {
  return process.env[secretNameToEnvVar(name)] || undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a secret value using the 3-tier strategy.
 * Results are cached in memory with a 5-minute TTL.
 *
 * @param name - Secret name in kebab-case (e.g. 'anthropic-api-key')
 * @returns The secret value
 * @throws if the secret cannot be found in any tier
 */
export async function getSecret(name: string): Promise<string> {
  // Check cache first
  const cached = getCached(name);
  if (cached) return cached;

  // Tier 1: Volume mount
  const mounted = readVolumeMountSecret(name);
  if (mounted) {
    setCache(name, mounted);
    return mounted;
  }

  // Tier 2: Secret Manager SDK
  const managed = await readSecretManagerSecret(name);
  if (managed) {
    setCache(name, managed);
    return managed;
  }

  // Tier 3: Environment variable
  const envVal = readEnvSecret(name);
  if (envVal) {
    setCache(name, envVal);
    return envVal;
  }

  throw new Error(`Secret "${name}" not found in volume mount, Secret Manager, or env var ${secretNameToEnvVar(name)}`);
}

/**
 * Resolve a secret value, returning undefined instead of throwing if not found.
 */
export async function getOptionalSecret(name: string): Promise<string | undefined> {
  try {
    return await getSecret(name);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Synchronous config (non-secret values from env vars only)
// ---------------------------------------------------------------------------

export interface StaticConfig {
  env: 'development' | 'production' | 'test';
  port: number;
  gcpProjectId: string;
}

export const staticConfig: StaticConfig = {
  env: (process.env.NODE_ENV as StaticConfig['env']) || 'development',
  port: parseInt(process.env.PORT || '4200', 10),
  gcpProjectId: process.env.GCP_PROJECT_ID || GCP_PROJECT_ID,
};
