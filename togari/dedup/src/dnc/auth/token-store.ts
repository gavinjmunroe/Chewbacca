/**
 * Per-user platform token store.
 *
 * Stores each user's OAuth tokens in GCP Secret Manager under:
 *   dnc-tokens-{userId}-{platform}
 *
 * This means ANY user who connects their LinkedIn/Instagram/Twitter
 * through the UI gets their own isolated token, and the sync workers
 * dynamically look up tokens per user — no env vars, no manual setup.
 *
 * Secret Manager is the right store because:
 *   - Already wired into the project (secret-manager.ts)
 *   - Encrypted at rest, IAM-controlled
 *   - Works across Cloud Run restarts (unlike memory)
 *   - Cheaper than a dedicated token DB for this use case
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { Platform } from '../types/index.js';

const PROJECT = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';

export interface PlatformTokens {
  platform: Platform;
  userId: string;                    // Auth0 sub — e.g. "auth0|abc123"

  // LinkedIn (Voyager cookie auth)
  li_at?: string;
  jsessionid?: string;

  // Instagram / Meta (OAuth 2.0)
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;               // epoch ms
  instagram_account_id?: string;     // IG Business account ID

  // Twitter/X (OAuth 1.0a + AAA)
  oauth_token?: string;
  oauth_token_secret?: string;
  twitter_user_id?: string;
  twitter_username?: string;

  // Metadata
  connected_at: string;              // ISO timestamp
  last_refreshed_at?: string;
}

let _client: SecretManagerServiceClient | null = null;

function getClient(): SecretManagerServiceClient {
  if (!_client) _client = new SecretManagerServiceClient();
  return _client;
}

function secretName(userId: string, platform: Platform): string {
  // Secret Manager names: alphanumeric + hyphens only, max 255 chars
  const safeId = userId.replace(/[^a-zA-Z0-9]/g, '-');
  return `dnc-tokens-${safeId}-${platform}`;
}

function secretPath(name: string): string {
  return `projects/${PROJECT}/secrets/${name}`;
}

/** Store a user's platform tokens in Secret Manager. Creates or updates. */
export async function saveTokens(tokens: PlatformTokens): Promise<void> {
  const client  = getClient();
  const name    = secretName(tokens.userId, tokens.platform);
  const path    = secretPath(name);
  const payload = Buffer.from(JSON.stringify(tokens));

  // Try to add a new version (secret already exists)
  try {
    await client.addSecretVersion({
      parent: path,
      payload: { data: payload },
    });
    console.log(`[TokenStore] Updated tokens for ${tokens.platform}:${tokens.userId}`);
    return;
  } catch (err: any) {
    // NOT_FOUND (5) means secret doesn't exist yet — create it
    if (err?.code !== 5) throw err;
  }

  // Create the secret, then add the first version
  await client.createSecret({
    parent: `projects/${PROJECT}`,
    secretId: name,
    secret: {
      replication: { automatic: {} },
      labels: {
        platform:   tokens.platform,
        managed_by: 'togari-dnc',
      },
    },
  });

  await client.addSecretVersion({
    parent: path,
    payload: { data: payload },
  });

  console.log(`[TokenStore] Created tokens for ${tokens.platform}:${tokens.userId}`);
}

/** Retrieve a user's platform tokens. Returns null if not connected. */
export async function getTokens(userId: string, platform: Platform): Promise<PlatformTokens | null> {
  const client = getClient();
  const name   = secretName(userId, platform);

  try {
    const [version] = await client.accessSecretVersion({
      name: `${secretPath(name)}/versions/latest`,
    });
    const data = version.payload?.data;
    if (!data) return null;
    const raw = typeof data === 'string' ? data : Buffer.from(data).toString();
    return JSON.parse(raw) as PlatformTokens;
  } catch {
    return null; // Secret doesn't exist = not connected
  }
}

/** Delete a user's platform tokens (disconnect). */
export async function deleteTokens(userId: string, platform: Platform): Promise<void> {
  const client = getClient();
  const name   = secretName(userId, platform);

  try {
    await client.deleteSecret({ name: secretPath(name) });
    console.log(`[TokenStore] Deleted tokens for ${platform}:${userId}`);
  } catch {
    // Already gone — fine
  }
}

/** List all platforms a user has connected. */
export async function getConnectedPlatforms(userId: string): Promise<Platform[]> {
  const platforms: Platform[] = ['linkedin', 'instagram', 'twitter', 'facebook'];
  const results = await Promise.all(
    platforms.map(async p => ({ platform: p, tokens: await getTokens(userId, p) }))
  );
  return results.filter(r => r.tokens !== null).map(r => r.platform);
}

/** Check if a token is expired (Instagram/Twitter OAuth tokens expire). */
export function isExpired(tokens: PlatformTokens): boolean {
  if (!tokens.expires_at) return false;
  return Date.now() > tokens.expires_at - 5 * 60 * 1000; // 5min buffer
}
