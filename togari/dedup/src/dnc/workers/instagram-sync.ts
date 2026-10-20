/**
 * Instagram Followers Sync — 60-second trip-wire poller
 *
 * Workarounds for Instagram's lack of new-follower webhooks:
 *
 * 1. FOLLOWER COUNT TRIP-WIRE: Poll followers_count every 60s.
 *    If count hasn't changed → skip. If it changed → fetch the delta immediately.
 *    This means we only hit the expensive /followers endpoint when something
 *    actually happened.
 *
 * 2. CURSOR DIFF: Track IDs in memory. Only new IDs get inserted.
 *
 * 3. PUB/SUB FIRE: Instant event on every insert.
 *
 * 4. META WEBHOOKS (DMs / comments): Meta DOES have real webhooks for
 *    Instagram DM events and mentions. We register these at startup so that
 *    if someone messages or tags Kevin, we capture them as a connection signal
 *    even if follower webhook isn't available.
 *    Requires: Meta App Webhook subscription + public HTTPS endpoint.
 *
 * Env vars:
 *   INSTAGRAM_ACCESS_TOKEN
 *   INSTAGRAM_ACCOUNT_ID
 *   META_APP_SECRET        — for webhook signature verification
 *   META_WEBHOOK_VERIFY_TOKEN — random string you set in Meta dashboard
 */

import { randomUUID } from "crypto";
import { createHmac } from "crypto";
import type { Request, Response } from "express";
import { DncBigQueryWriter } from "./bq-writer.js";
import type {
  SocialConnectionRow,
  SyncResult,
  PlatformCache,
} from "../types/index.js";

const GRAPH_BASE = "https://graph.facebook.com/v19.0";

// ─── Graph API client ─────────────────────────────────────────────────────────

async function graphGet<T>(
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  url.searchParams.set("access_token", token);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Meta Graph ${res.status} on ${path}: ${body.slice(0, 300)}`,
    );
  }
  return res.json() as Promise<T>;
}

interface IGUser {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  follows_count?: number;
  is_verified?: boolean;
  profile_picture_url?: string;
  website?: string;
}

interface IGFollowersPage {
  data: IGUser[];
  paging?: { cursors?: { after?: string }; next?: string };
}

// ─── Fetch own profile (for trip-wire check) ──────────────────────────────────

export async function fetchIGOwner(
  token: string,
  accountId: string,
): Promise<IGUser> {
  return graphGet<IGUser>(`/${accountId}`, token, {
    fields:
      "id,username,name,biography,followers_count,follows_count,is_verified,profile_picture_url",
  });
}

// ─── Fetch followers (only called when trip-wire fires) ───────────────────────

async function fetchFollowers(
  token: string,
  accountId: string,
): Promise<IGUser[]> {
  const all: IGUser[] = [];
  let after: string | undefined;

  while (true) {
    try {
      const params: Record<string, string> = {
        fields:
          "id,username,name,biography,followers_count,follows_count,is_verified,profile_picture_url,website",
        limit: "100",
      };
      if (after) params["after"] = after;

      const page = await graphGet<IGFollowersPage>(
        `/${accountId}/followers`,
        token,
        params,
      );
      all.push(...page.data);
      after = page.paging?.cursors?.after;
      if (!after || !page.paging?.next) break;
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // No Advanced Access — can't get followers list, just track count
      if (
        msg.includes("200") ||
        msg.includes("permission") ||
        msg.includes("OAuthException")
      ) {
        console.warn(
          "[Instagram] /followers endpoint unavailable (needs Advanced Access) — count-only mode",
        );
        break;
      }
      throw err;
    }
  }
  return all;
}

// ─── Map to BQ row ────────────────────────────────────────────────────────────

function mapToRow(
  user: IGUser,
  ownerId: string,
  owner: IGUser,
  connectionType: "follower" | "following",
): SocialConnectionRow {
  const now = new Date().toISOString();
  let companyDomain: string | null = null;
  try {
    companyDomain = user.website
      ? new URL(user.website).hostname.replace(/^www\./, "")
      : null;
  } catch {}
  return {
    connection_id: randomUUID(),
    platform: "instagram",
    owner_id: ownerId,
    owner_account_id: owner.id,
    owner_username: owner.username,
    platform_user_id: user.id,
    username: user.username,
    full_name: user.name ?? user.username,
    first_name: null,
    last_name: null,
    profile_url: `https://www.instagram.com/${user.username}`,
    avatar_url: user.profile_picture_url ?? null,
    bio: user.biography ?? null,
    follower_count: user.followers_count ?? null,
    following_count: user.follows_count ?? null,
    is_verified: user.is_verified ?? false,
    connection_type: connectionType,
    connected_at: now,
    connection_degree: 1,
    dnc_contact_id: null,
    work_email: null,
    current_title: null,
    current_company: null,
    company_domain: companyDomain,
    is_dnc: false,
    dnc_reason: null,
    dnc_added_at: null,
    raw_platform_data: user as Record<string, unknown>,
    synced_at: now,
    created_at: now,
    updated_at: now,
  };
}

// ─── Trip-wire poll (called every 60s) ───────────────────────────────────────

export async function pollInstagram(
  cache: PlatformCache,
  bq: DncBigQueryWriter,
): Promise<SyncResult> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN!;
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID!;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const errors: string[] = [];

  try {
    // Fast check — just the follower count
    const profile = await graphGet<IGUser>(`/${accountId}`, token, {
      fields: "id,username,followers_count",
    });

    const currentCount = profile.followers_count ?? 0;
    const previousCount = cache.followerCount;
    cache.followerCount = currentCount;

    // Trip-wire: count unchanged → nothing to do
    if (previousCount !== null && currentCount <= previousCount) {
      return {
        platform: "instagram",
        fetched: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors,
        durationMs: Date.now() - t0,
        status: "success",
      };
    }

    const delta = previousCount !== null ? currentCount - previousCount : null;
    console.log(
      `[Instagram] 📈 Follower count changed: ${previousCount ?? "?"} → ${currentCount}${delta ? ` (+${delta})` : ""} — fetching new followers`,
    );

    // Count changed — fetch followers list and diff
    const followers = await fetchFollowers(token, accountId);
    const newRows = followers
      .filter((u) => !cache.knownIds.has(u.id))
      .map((u) =>
        mapToRow(
          u,
          cache.ownerId,
          { id: cache.ownerAccountId, username: cache.ownerUsername } as IGUser,
          "follower",
        ),
      );

    const inserted = await bq.insertNewRows(newRows, cache);
    cache.lastPollAt = new Date().toISOString();

    if (inserted > 0) {
      console.log(`[Instagram] ✅ ${inserted} new follower(s) synced`);
    }

    const result: SyncResult = {
      platform: "instagram",
      fetched: followers.length,
      inserted,
      updated: 0,
      skipped: followers.length - inserted,
      errors,
      durationMs: Date.now() - t0,
      status: "success",
    };

    if (inserted > 0)
      await bq.writeSyncLog({ ...result, startedAt, syncType: "incremental" });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    console.error("[Instagram] Poll error:", msg);
    return {
      platform: "instagram",
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

export async function fullSyncInstagram(
  ownerId: string,
  bq: DncBigQueryWriter,
): Promise<{ cache: PlatformCache; result: SyncResult }> {
  if (!ownerId) throw new Error("fullSyncInstagram: ownerId is required");

  const token = process.env.INSTAGRAM_ACCESS_TOKEN!;
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID!;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const owner = await fetchIGOwner(token, accountId);
  console.log(
    `[Instagram] Full sync — tenant ${ownerId}, @${owner.username}, ${owner.followers_count} followers`,
  );

  const cache = await bq.warmCache(
    "instagram",
    ownerId,
    owner.id,
    owner.username,
  );
  cache.followerCount = owner.followers_count ?? null;
  console.log(
    `[Instagram] Cache warmed — ${cache.knownIds.size} known followers`,
  );

  const followers = await fetchFollowers(token, accountId);
  const newRows = followers
    .filter((u) => !cache.knownIds.has(u.id))
    .map((u) => mapToRow(u, ownerId, owner, "follower"));

  const inserted = await bq.insertNewRows(newRows, cache);
  cache.lastPollAt = new Date().toISOString();

  const result: SyncResult = {
    platform: "instagram",
    fetched: followers.length,
    inserted,
    updated: 0,
    skipped: followers.length - inserted,
    errors: [],
    durationMs: Date.now() - t0,
    status: "success",
  };
  await bq.writeSyncLog({ ...result, startedAt, syncType: "full" });
  console.log(
    `[Instagram] Full sync done — ${inserted} new, ${cache.knownIds.size} total known`,
  );
  return { cache, result };
}

// ─── Meta Webhook handler (DMs, mentions — real signals, not connection events) ─

/**
 * Verify GET challenge from Meta when registering the webhook.
 * Attach to: GET /webhooks/instagram
 */
export function handleMetaWebhookVerification(
  req: Request,
  res: Response,
): void {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    console.log("[Instagram] Meta webhook verified ✅");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

/**
 * Handle incoming Meta webhook events (DMs, mentions, comments).
 * These aren't follower events, but they ARE real-time signals that
 * someone is engaging with Kevin's account — useful as a connection signal.
 * Attach to: POST /webhooks/instagram
 */
export async function handleMetaWebhookEvent(
  req: Request,
  res: Response,
  bq: DncBigQueryWriter,
  cache: PlatformCache,
): Promise<void> {
  // Verify signature
  const sig = (req.headers["x-hub-signature-256"] as string) ?? "";
  const appSecret = process.env.META_APP_SECRET ?? "";
  if (appSecret) {
    const expected =
      "sha256=" +
      createHmac("sha256", appSecret)
        .update(JSON.stringify(req.body))
        .digest("hex");
    if (sig !== expected) {
      res.sendStatus(403);
      return;
    }
  }

  // Must respond 200 within 5s
  res.sendStatus(200);

  const body = req.body as {
    object?: string;
    entry?: Array<{ messaging?: Array<{ sender: { id: string } }> }>;
  };
  if (body.object !== "instagram") return;

  // Trigger an immediate incremental poll when we get any real-time signal
  // This is the "best effort real-time" approach for Instagram
  console.log(
    "[Instagram] 📨 Meta webhook event received — triggering immediate poll",
  );
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (token && accountId) {
    pollInstagram(cache, bq).catch((err) => {
      console.error("[Instagram] Webhook-triggered poll failed:", err.message);
    });
  }
}
