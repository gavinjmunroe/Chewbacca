/**
 * Per-user sync runner.
 *
 * Instead of reading LINKEDIN_LI_AT from env (one global account),
 * this looks up each connected user's tokens from Secret Manager and
 * runs the sync for every user who has connected that platform.
 *
 * This is the key to making it generalizable — any user who connects
 * their LinkedIn/Instagram/Twitter through the UI gets their own sync loop.
 *
 * Flow:
 *   1. List all secrets in Secret Manager matching dnc-tokens-*-{platform}
 *   2. For each user → load their tokens → run incremental sync
 *   3. Write results to togari_dnc.social_connections with owner_account_id
 *      scoped to that user's account
 *
 * The poll loops in orchestrator.ts call runSyncForAllUsers() instead of
 * the old single-account sync functions.
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { DncBigQueryWriter } from "./bq-writer.js";
import { pollLinkedIn, fullSyncLinkedIn } from "./linkedin-sync.js";
import { pollInstagram, fullSyncInstagram } from "./instagram-sync.js";
import { pollTwitter, fullSyncTwitter } from "./twitter-sync.js";
import type { Platform, PlatformCache, CacheMap } from "../types/index.js";
import type { PlatformTokens } from "../auth/token-store.js";

const PROJECT = process.env.GCP_PROJECT_ID ?? "midyear-glazing-485303-u3";

function makeSecretClient(): SecretManagerServiceClient {
  const opts: ConstructorParameters<typeof SecretManagerServiceClient>[0] = {};
  const b64 = process.env.GCP_CREDENTIALS_BASE64;
  if (b64) opts.credentials = JSON.parse(Buffer.from(b64, "base64").toString());
  return new SecretManagerServiceClient(opts);
}

const secretClient = makeSecretClient();

/** List all user token secrets for a given platform */
async function listUserSecretsForPlatform(
  platform: Platform,
): Promise<PlatformTokens[]> {
  const tokens: PlatformTokens[] = [];

  try {
    const [secrets] = await secretClient.listSecrets({
      parent: `projects/${PROJECT}`,
      filter: `name:dnc-tokens- AND name:-${platform}`,
    });

    await Promise.all(
      (secrets ?? []).map(async (secret) => {
        if (!secret.name) return;
        try {
          const [version] = await secretClient.accessSecretVersion({
            name: `${secret.name}/versions/latest`,
          });
          const data = version.payload?.data;
          if (!data) return;
          const raw =
            typeof data === "string" ? data : Buffer.from(data).toString();
          const parsed = JSON.parse(raw) as PlatformTokens;
          if (parsed.platform === platform) tokens.push(parsed);
        } catch {
          /* secret inaccessible — skip */
        }
      }),
    );
  } catch (err: any) {
    console.error(
      `[UserSync] Failed to list secrets for ${platform}:`,
      err.message,
    );
  }

  return tokens;
}

// ─── Inject tokens into env temporarily for sync workers ─────────────────────
// The existing sync workers read env vars — we temporarily set them
// per-user before calling the sync function, then restore.

function withLinkedInTokens<T>(
  tokens: PlatformTokens,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = {
    li_at: process.env.LINKEDIN_LI_AT,
    jsessionid: process.env.LINKEDIN_JSESSIONID,
    access_token: process.env.LINKEDIN_ACCESS_TOKEN,
  };
  if (tokens.li_at) process.env.LINKEDIN_LI_AT = tokens.li_at;
  if (tokens.jsessionid) process.env.LINKEDIN_JSESSIONID = tokens.jsessionid;
  if (tokens.access_token)
    process.env.LINKEDIN_ACCESS_TOKEN = tokens.access_token;
  return fn().finally(() => {
    process.env.LINKEDIN_LI_AT = prev.li_at ?? "";
    process.env.LINKEDIN_JSESSIONID = prev.jsessionid ?? "";
    process.env.LINKEDIN_ACCESS_TOKEN = prev.access_token ?? "";
  });
}

function withInstagramTokens<T>(
  tokens: PlatformTokens,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = {
    token: process.env.INSTAGRAM_ACCESS_TOKEN,
    id: process.env.INSTAGRAM_ACCOUNT_ID,
  };
  if (tokens.access_token)
    process.env.INSTAGRAM_ACCESS_TOKEN = tokens.access_token;
  if (tokens.instagram_account_id)
    process.env.INSTAGRAM_ACCOUNT_ID = tokens.instagram_account_id;
  return fn().finally(() => {
    process.env.INSTAGRAM_ACCESS_TOKEN = prev.token ?? "";
    process.env.INSTAGRAM_ACCOUNT_ID = prev.id ?? "";
  });
}

function withTwitterTokens<T>(
  tokens: PlatformTokens,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = { bearer: process.env.TWITTER_BEARER_TOKEN };
  if (tokens.access_token)
    process.env.TWITTER_BEARER_TOKEN = tokens.access_token;
  return fn().finally(() => {
    process.env.TWITTER_BEARER_TOKEN = prev.bearer ?? "";
  });
}

// ─── Per-user cache (userId → platform → cache) ───────────────────────────────

const userCaches = new Map<string, CacheMap>();

function getUserCache(userId: string): CacheMap {
  if (!userCaches.has(userId)) userCaches.set(userId, new Map());
  return userCaches.get(userId)!;
}

// ─── Run sync for all connected users on a platform ──────────────────────────

export async function runSyncForAllUsers(
  platform: Platform,
  bq: DncBigQueryWriter,
): Promise<void> {
  const userTokens = await listUserSecretsForPlatform(platform);

  if (userTokens.length === 0) {
    // Fall back to env vars (Karthik's own account, local dev)
    const envTokens = getEnvTokens(platform);
    if (envTokens) userTokens.push(envTokens);
  }

  if (userTokens.length === 0) return;

  console.log(
    `[UserSync] Running ${platform} sync for ${userTokens.length} user(s)`,
  );

  for (const tokens of userTokens) {
    const userCache = getUserCache(tokens.userId);
    const cache = userCache.get(platform);

    try {
      if (platform === "linkedin") {
        if (cache) {
          await withLinkedInTokens(tokens, () => pollLinkedIn(cache, bq));
        } else {
          const { cache: newCache } = await withLinkedInTokens(tokens, () =>
            fullSyncLinkedIn(tokens.userId, bq),
          );
          userCache.set("linkedin", newCache);
        }
      } else if (platform === "instagram") {
        if (cache) {
          await withInstagramTokens(tokens, () => pollInstagram(cache, bq));
        } else {
          const { cache: newCache } = await withInstagramTokens(tokens, () =>
            fullSyncInstagram(tokens.userId, bq),
          );
          userCache.set("instagram", newCache);
        }
      } else if (platform === "twitter") {
        if (cache) {
          await withTwitterTokens(tokens, () => pollTwitter(cache, bq));
        } else {
          const { cache: newCache } = await withTwitterTokens(tokens, () =>
            fullSyncTwitter(tokens.userId, bq),
          );
          userCache.set("twitter", newCache);
        }
      }
    } catch (err: any) {
      console.error(
        `[UserSync] ${platform} sync failed for user ${tokens.userId}:`,
        err.message,
      );
    }
  }
}

// ─── Get cache for a specific user (used by orchestrator webhook handlers) ───

export function getUserPlatformCache(
  userId: string,
  platform: Platform,
): PlatformCache | undefined {
  return userCaches.get(userId)?.get(platform);
}

// ─── Env var fallback (for local dev / Karthik's own account) ─────────────────

function getEnvTokens(platform: Platform): PlatformTokens | null {
  const now = new Date().toISOString();
  if (platform === "linkedin" && process.env.LINKEDIN_LI_AT) {
    return {
      platform: "linkedin",
      userId: "env-default",
      li_at: process.env.LINKEDIN_LI_AT,
      jsessionid: process.env.LINKEDIN_JSESSIONID,
      connected_at: now,
    };
  }
  if (platform === "instagram" && process.env.INSTAGRAM_ACCESS_TOKEN) {
    return {
      platform: "instagram",
      userId: "env-default",
      access_token: process.env.INSTAGRAM_ACCESS_TOKEN,
      instagram_account_id: process.env.INSTAGRAM_ACCOUNT_ID,
      connected_at: now,
    };
  }
  if (platform === "twitter" && process.env.TWITTER_BEARER_TOKEN) {
    return {
      platform: "twitter",
      userId: "env-default",
      access_token: process.env.TWITTER_BEARER_TOKEN,
      connected_at: now,
    };
  }
  return null;
}
