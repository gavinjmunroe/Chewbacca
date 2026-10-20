/**
 * Twitter/X Account Activity API — Real Webhooks for Follows
 *
 * Twitter DOES offer real webhooks via the Account Activity API (AAA).
 * When Kevin follows someone or gets followed, Twitter POSTs to our endpoint
 * within seconds — no polling needed.
 *
 * Requirements:
 *   - Twitter Developer Account with Elevated or Pro access
 *   - Account Activity API subscription (requires approval)
 *   - Public HTTPS endpoint registered as a webhook
 *
 * Env vars:
 *   TWITTER_BEARER_TOKEN         — App-only bearer token
 *   TWITTER_API_KEY              — Consumer key
 *   TWITTER_API_SECRET           — Consumer secret
 *   TWITTER_ACCESS_TOKEN         — Kevin's user access token
 *   TWITTER_ACCESS_TOKEN_SECRET  — Kevin's user access token secret
 *   TWITTER_WEBHOOK_SECRET       — Random string for CRC validation
 *   TWITTER_ENV_NAME             — AAA environment name (e.g. "production")
 *
 * Setup (one-time, run via: npx tsx src/dnc/workers/twitter-sync.ts setup):
 *   1. Register webhook URL with Twitter
 *   2. Subscribe Kevin's account to receive events
 *   3. Twitter will POST to /webhooks/twitter with follow events
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { DncBigQueryWriter } from "./bq-writer.js";
import type {
  SocialConnectionRow,
  SyncResult,
  PlatformCache,
} from "../types/index.js";
import { randomUUID } from "crypto";

const API_BASE = "https://api.twitter.com/2";
const AAA_BASE = "https://api.twitter.com/1.1/account_activity";

// ─── OAuth 1.0a signing (required for AAA endpoints) ─────────────────────────

function oauthSign(
  method: string,
  url: string,
  params: Record<string, string>,
): string {
  const apiKey = process.env.TWITTER_API_KEY!;
  const apiSecret = process.env.TWITTER_API_SECRET!;
  const token = process.env.TWITTER_ACCESS_TOKEN!;
  const secret = process.env.TWITTER_ACCESS_TOKEN_SECRET!;

  const nonce = randomUUID().replace(/-/g, "");
  const timestamp = String(Math.floor(Date.now() / 1000));

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: token,
    oauth_version: "1.0",
    ...params,
  };

  const sorted = Object.keys(oauthParams)
    .sort()
    .map(
      (k) => `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`,
    )
    .join("&");
  const base = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`;
  const sigKey = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(secret)}`;
  const sig = createHmac("sha1", sigKey).update(base).digest("base64");

  oauthParams["oauth_signature"] = sig;
  const header =
    "OAuth " +
    Object.keys(oauthParams)
      .filter((k) => k.startsWith("oauth_"))
      .map(
        (k) =>
          `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`,
      )
      .join(", ");

  return header;
}

async function twitterRequest<T>(
  method: string,
  url: string,
  body?: object,
): Promise<T> {
  const authHeader = oauthSign(method, url, {});
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twitter ${res.status} on ${url}: ${text.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// ─── One-time setup: register webhook + subscribe Kevin's account ─────────────

export async function setupTwitterWebhook(publicUrl: string): Promise<void> {
  const envName = process.env.TWITTER_ENV_NAME ?? "production";
  const webhookUrl = `${publicUrl}/webhooks/twitter`;

  console.log(`[Twitter] Registering webhook: ${webhookUrl}`);

  // Register the webhook endpoint
  const registerUrl = `${AAA_BASE}/all/${envName}/webhooks.json`;
  const result = await twitterRequest<{
    id: string;
    url: string;
    valid: boolean;
  }>("POST", registerUrl, { url: webhookUrl });

  console.log(
    `[Twitter] Webhook registered — ID: ${result.id}, valid: ${result.valid}`,
  );

  // Subscribe Kevin's user account to events on this webhook
  const subscribeUrl = `${AAA_BASE}/all/${envName}/subscriptions.json`;
  await twitterRequest("POST", subscribeUrl);
  console.log(
    `[Twitter] ✅ Kevin's account subscribed to Account Activity events`,
  );
}

// ─── CRC challenge handler (Twitter pings this to verify the webhook) ─────────

/**
 * GET /webhooks/twitter?crc_token=...
 * Twitter sends this to verify our endpoint. Must respond with HMAC-SHA256 of crc_token.
 */
export function handleTwitterCRC(req: Request, res: Response): void {
  const crcToken = req.query["crc_token"] as string;
  const secret =
    process.env.TWITTER_WEBHOOK_SECRET ?? process.env.TWITTER_API_SECRET ?? "";
  const signature = createHmac("sha256", secret)
    .update(crcToken)
    .digest("base64");
  res.json({ response_token: `sha256=${signature}` });
}

// ─── Webhook event handler ────────────────────────────────────────────────────

interface TwitterFollowEvent {
  type: "follow";
  created_timestamp: string;
  source: {
    id: string;
    name: string;
    screen_name: string;
    description?: string;
    followers_count?: number;
    friends_count?: number;
    verified?: boolean;
    profile_image_url_https?: string;
  };
  target: { id: string; screen_name: string };
}

interface TwitterAAPayload {
  for_user_id?: string;
  follow_events?: TwitterFollowEvent[];
}

function mapFollowToRow(
  event: TwitterFollowEvent,
  ownerCache: PlatformCache,
): SocialConnectionRow {
  const now = new Date().toISOString();
  const src = event.source;
  return {
    connection_id: randomUUID(),
    platform: "twitter",
    owner_id: ownerCache.ownerId,
    owner_account_id: ownerCache.ownerAccountId,
    owner_username: ownerCache.ownerUsername,
    platform_user_id: src.id,
    username: src.screen_name,
    full_name: src.name,
    first_name: null,
    last_name: null,
    profile_url: `https://twitter.com/${src.screen_name}`,
    avatar_url: src.profile_image_url_https?.replace("_normal", "") ?? null,
    bio: src.description ?? null,
    follower_count: src.followers_count ?? null,
    following_count: src.friends_count ?? null,
    is_verified: src.verified ?? false,
    connection_type: "follower",
    connected_at: new Date(parseInt(event.created_timestamp)).toISOString(),
    connection_degree: 1,
    dnc_contact_id: null,
    work_email: null,
    current_title: null,
    current_company: null,
    company_domain: null,
    is_dnc: false,
    dnc_reason: null,
    dnc_added_at: null,
    raw_platform_data: event as unknown as Record<string, unknown>,
    synced_at: now,
    created_at: now,
    updated_at: now,
  };
}

/**
 * POST /webhooks/twitter
 * Receives real-time follow events from Twitter AAA.
 * This fires within seconds of Kevin being followed or following someone.
 */
export async function handleTwitterWebhookEvent(
  req: Request,
  res: Response,
  bq: DncBigQueryWriter,
  cache: PlatformCache,
): Promise<void> {
  // Verify Twitter signature
  const sig = (req.headers["x-twitter-webhooks-signature"] as string) ?? "";
  const secret =
    process.env.TWITTER_WEBHOOK_SECRET ?? process.env.TWITTER_API_SECRET ?? "";
  if (secret && sig) {
    const expected =
      "sha256=" +
      createHmac("sha256", secret)
        .update(JSON.stringify(req.body))
        .digest("base64");
    try {
      if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        res.sendStatus(403);
        return;
      }
    } catch {
      res.sendStatus(403);
      return;
    }
  }

  // Respond immediately (Twitter requires < 3s)
  res.sendStatus(200);

  const payload = req.body as TwitterAAPayload;
  const followEvents = payload.follow_events ?? [];

  if (followEvents.length === 0) return;

  console.log(
    `[Twitter] 🐦 ${followEvents.length} follow event(s) received via webhook`,
  );

  const newRows = followEvents
    .filter((e) => e.type === "follow" && !cache.knownIds.has(e.source.id))
    .map((e) => mapFollowToRow(e, cache));

  if (newRows.length > 0) {
    const inserted = await bq.insertNewRows(newRows, cache).catch((err) => {
      console.error("[Twitter] Insert failed:", err.message);
      return 0;
    });
    console.log(
      `[Twitter] ✅ ${inserted} new follower(s) inserted instantly via webhook`,
    );
  }
}

// ─── Fallback poll (for non-webhook follows, runs every 5 min) ───────────────

export async function pollTwitter(
  cache: PlatformCache,
  bq: DncBigQueryWriter,
): Promise<SyncResult> {
  const bearer = process.env.TWITTER_BEARER_TOKEN!;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const errors: string[] = [];

  try {
    // Fetch Kevin's followers via v2 API
    const url = new URL(`${API_BASE}/users/${cache.ownerAccountId}/followers`);
    url.searchParams.set("max_results", "1000");
    url.searchParams.set(
      "user.fields",
      "id,name,username,description,public_metrics,verified,profile_image_url",
    );

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${bearer}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Twitter v2 followers ${res.status}: ${body.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        name: string;
        username: string;
        description?: string;
        public_metrics?: { followers_count?: number; following_count?: number };
        verified?: boolean;
        profile_image_url?: string;
      }>;
    };
    const users = data.data ?? [];

    const newRows: SocialConnectionRow[] = users
      .filter((u) => !cache.knownIds.has(u.id))
      .map((u) => {
        const now = new Date().toISOString();
        return {
          connection_id: randomUUID(),
          platform: "twitter" as const,
          owner_id: cache.ownerId,
          owner_account_id: cache.ownerAccountId,
          owner_username: cache.ownerUsername,
          platform_user_id: u.id,
          username: u.username,
          full_name: u.name,
          first_name: null,
          last_name: null,
          profile_url: `https://twitter.com/${u.username}`,
          avatar_url: u.profile_image_url?.replace("_normal", "") ?? null,
          bio: u.description ?? null,
          follower_count: u.public_metrics?.followers_count ?? null,
          following_count: u.public_metrics?.following_count ?? null,
          is_verified: u.verified ?? false,
          connection_type: "follower" as const,
          connected_at: now,
          connection_degree: 1,
          dnc_contact_id: null,
          work_email: null,
          current_title: null,
          current_company: null,
          company_domain: null,
          is_dnc: false,
          dnc_reason: null,
          dnc_added_at: null,
          raw_platform_data: u as Record<string, unknown>,
          synced_at: now,
          created_at: now,
          updated_at: now,
        };
      });

    const inserted = await bq.insertNewRows(newRows, cache);
    cache.lastPollAt = new Date().toISOString();

    if (inserted > 0)
      console.log(`[Twitter] Poll found ${inserted} new follower(s)`);

    return {
      platform: "twitter",
      fetched: users.length,
      inserted,
      updated: 0,
      skipped: users.length - inserted,
      errors,
      durationMs: Date.now() - t0,
      status: "success",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    console.error("[Twitter] Poll error:", msg);
    return {
      platform: "twitter",
      fetched: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors,
      durationMs: Date.now() - t0,
      status: "failed",
    };
  }
}

// ─── Full sync (startup) ──────────────────────────────────────────────────────

export async function fullSyncTwitter(
  ownerId: string,
  bq: DncBigQueryWriter,
): Promise<{ cache: PlatformCache; result: SyncResult }> {
  if (!ownerId) throw new Error("fullSyncTwitter: ownerId is required");

  const bearer = process.env.TWITTER_BEARER_TOKEN!;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // Get Kevin's Twitter user ID
  const meRes = await fetch(
    `${API_BASE}/users/me?user.fields=id,name,username`,
    {
      headers: { Authorization: `Bearer ${bearer}` },
    },
  );
  const me = (await meRes.json()) as { data: { id: string; username: string } };
  const owner = me.data;

  console.log(
    `[Twitter] Full sync — tenant ${ownerId}, @${owner.username} (${owner.id})`,
  );
  const cache = await bq.warmCache(
    "twitter",
    ownerId,
    owner.id,
    owner.username,
  );
  console.log(
    `[Twitter] Cache warmed — ${cache.knownIds.size} known followers`,
  );

  const result = await pollTwitter(cache, bq);
  await bq.writeSyncLog({ ...result, startedAt, syncType: "full" });
  return { cache, result };
}
