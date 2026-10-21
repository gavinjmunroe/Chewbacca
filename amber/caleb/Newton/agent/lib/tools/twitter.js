/**
 * twitter.js — Native X (Twitter) v2 API integration with per-tenant OAuth 2.0.
 *
 * Auth model (mirrors gcal/client.js):
 *   - Refresh token: TWITTER_OAUTH_REFRESH  (set by medha-id callback)
 *   - Access token cache: TWITTER_OAUTH_ACCESS + TWITTER_OAUTH_EXPIRES_AT
 *   - Client creds: TWITTER_OAUTH_CLIENT_ID + _SECRET (env on this service)
 *   - Identity cache: TWITTER_OAUTH_USER_ID + TWITTER_OAUTH_HANDLE
 *
 * X requires HTTP Basic auth on the token endpoint for confidential clients.
 * Refresh tokens may rotate; we persist the new one when X returns it.
 *
 * Tier behavior:
 *   Free/Basic tiers cap reads + DMs. On 403 with X's tier-related error
 *   shape, the helper surfaces a structured { error: "twitter_tier_insufficient" }
 *   so the agent says "Your X API tier doesn't allow this" instead of a
 *   generic failure. OAuth itself succeeds regardless of tier; only the API
 *   call fails at runtime.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";
import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";

registerCapability(
  "_tools_Twitter",
  "Read X profile + timeline, post + reply to tweets, like, follow, bookmark",
);
registerCapability(
  "_tools_Twitter",
  "Send and read X DMs (requires Pro tier on X API)",
);

const X_API_BASE = "https://api.x.com/2";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ── Tenant helpers ────────────────────────────────────────────────────────────

function tenantDid(tenant) {
  if (!tenant) return null;
  if (typeof tenant === "string") return tenant;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

async function setSecret(tenant, key, value) {
  const did = tenantDid(tenant);
  if (!did || !AMBER_ID_API_URL || !AMBER_ID_API_KEY) return;
  try {
    await fetch(
      `${AMBER_ID_API_URL}/v1/secrets/${encodeURIComponent(did)}/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        headers: {
          "x-api-key": AMBER_ID_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value }),
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch (err) {
    console.warn(`[twitter] setSecret ${key} failed:`, err?.message);
  }
}

function frontendBase() {
  const raw =
    process.env.MEDHA_FRONTEND_URL ||
    "https://www.justarock.ai";
  return raw.replace(/\/+$/, "");
}

function notConnected() {
  const url = `${frontendBase()}/connect`;
  return {
    error: "twitter_not_connected",
    suggestConnect: true,
    connect_url: url,
    message: `X / Twitter isn't connected to your medha-id yet. Connect it here and ask me again: ${url}`,
  };
}

function tierInsufficient(detail) {
  return {
    error: "twitter_tier_insufficient",
    message: `Your X API tier doesn't allow this action. Upgrade your X developer account at developer.x.com (detail: ${detail || "tier-gated endpoint"}).`,
  };
}

// ── Token management ──────────────────────────────────────────────────────────

async function resolveAccessToken(tenant) {
  // Read all four in parallel so a refresh failure can fall back to a
  // still-valid cached access token (and a tenant with no refresh at all
  // can still authenticate while their cached access is valid).
  const [refresh, cached, expiresStr] = await Promise.all([
    getSecret(tenant, "TWITTER_OAUTH_REFRESH").catch(() => null),
    getSecret(tenant, "TWITTER_OAUTH_ACCESS").catch(() => null),
    getSecret(tenant, "TWITTER_OAUTH_EXPIRES_AT").catch(() => null),
  ]);

  // Stored as ISO timestamp by medha-id; parse to ms.
  const expiresMs = expiresStr ? Date.parse(expiresStr) : 0;
  const accessStillValid =
    cached &&
    Number.isFinite(expiresMs) &&
    expiresMs > Date.now() + REFRESH_BUFFER_MS;

  if (accessStillValid) return cached;

  if (refresh) {
    const fresh = await refreshAccessToken(tenant, refresh);
    if (fresh) return fresh;
    // Refresh failed (Twitter rejects expired refresh tokens with
    // invalid_request, leaving the bag entry set but unusable). Fall
    // back to the cached access token if it exists — Twitter will
    // return 401 itself if the token is truly dead, which is a clearer
    // error than synthesizing "not connected" from a refresh failure.
  }

  return cached || null;
}

async function refreshAccessToken(tenant, refreshToken) {
  const clientId =
    process.env.TWITTER_OAUTH_CLIENT_ID || process.env.TWITTER_CLIENT_ID;
  const clientSecret =
    process.env.TWITTER_OAUTH_CLIENT_SECRET ||
    process.env.TWITTER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn(
      "[twitter] Missing OAuth client credentials for token refresh",
    );
    return null;
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  let data;
  try {
    const res = await fetch(X_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      console.warn(
        "[twitter] Token refresh failed:",
        res.status,
        bodyText.slice(0, 200),
      );
      // Twitter rejects expired/revoked refresh tokens with HTTP 400 and a
      // JSON body of { error: "invalid_request" | "invalid_grant" }. The
      // bag entry stays set but is unusable, so every subsequent call
      // wastes a round trip trying to refresh against the same dead
      // token. Clear it here so resolveAccessToken stops attempting
      // refreshes and connections-discovery sees the absence on its next
      // probe — which surfaces the reconnect prompt to the user instead
      // of looping silently.
      let errCode = null;
      try {
        const parsed = bodyText ? JSON.parse(bodyText) : null;
        errCode = parsed?.error || null;
      } catch {
        errCode = null;
      }
      const fatalRefresh =
        res.status === 400 &&
        (errCode === "invalid_request" || errCode === "invalid_grant");
      if (fatalRefresh) {
        console.warn(
          `[twitter] Clearing TWITTER_OAUTH_REFRESH after Twitter rejected it (${errCode}). User must reconnect.`,
        );
        setSecret(tenant, "TWITTER_OAUTH_REFRESH", null).catch(() => {});
      }
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.warn("[twitter] Token refresh error:", err?.message);
    return null;
  }

  const accessToken = data.access_token;
  if (!accessToken) return null;

  // Persist rotation + cache.
  const expiresAt = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
    : null;
  setSecret(tenant, "TWITTER_OAUTH_ACCESS", accessToken).catch(() => {});
  if (expiresAt)
    setSecret(tenant, "TWITTER_OAUTH_EXPIRES_AT", expiresAt).catch(() => {});
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    setSecret(tenant, "TWITTER_OAUTH_REFRESH", data.refresh_token).catch(
      () => {},
    );
  }

  return accessToken;
}

async function getUserId(tenant) {
  const cached = await getSecret(tenant, "TWITTER_OAUTH_USER_ID");
  if (cached) return cached;
  // Backfill: hit /2/users/me once, persist, return.
  const res = await twitterRequest({
    tenant,
    method: "GET",
    path: "/users/me",
  });
  if (!res.ok) return null;
  const id = res.data?.data?.id || null;
  const username = res.data?.data?.username || null;
  if (id) setSecret(tenant, "TWITTER_OAUTH_USER_ID", id).catch(() => {});
  if (username)
    setSecret(tenant, "TWITTER_OAUTH_HANDLE", `@${username}`).catch(() => {});
  return id;
}

// ── HTTP client ───────────────────────────────────────────────────────────────

async function twitterRequest({ tenant, method, path, query, body }) {
  const accessToken = await resolveAccessToken(tenant);
  if (!accessToken) {
    return { ok: false, status: 0, data: null, error: "not_connected" };
  }

  let url = `${X_API_BASE}${path}`;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    url += `?${params.toString()}`;
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message };
  }

  let data = null;
  if (res.status !== 204) {
    data = await res.json().catch(() => null);
  }

  if (!res.ok) {
    // X's tier-gated errors come back as 403 with type/title around access.
    const detail =
      data?.detail || data?.title || data?.error || `HTTP ${res.status}`;
    return { ok: false, status: res.status, data, error: detail };
  }

  return { ok: true, status: res.status, data };
}

function mapTierError(reqResult) {
  if (reqResult.ok) return null;
  if (reqResult.status === 401) return notConnected();
  if (reqResult.status === 403) {
    const detail = String(reqResult.data?.detail || reqResult.error || "");
    if (/access|tier|product|enterprise|elevated|level/i.test(detail)) {
      return tierInsufficient(detail);
    }
  }
  return null;
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function getMyProfile(input, ctx) {
  const tenant = ctx?.tenant;
  const res = await twitterRequest({
    tenant,
    method: "GET",
    path: "/users/me",
    query: {
      "user.fields": "id,name,username,verified,description,public_metrics",
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error || "failed" };
  return { profile: res.data?.data || null };
}

async function getUserByUsername(input, ctx) {
  const username = String(input?.username || "")
    .replace(/^@/, "")
    .trim();
  if (!username) return { error: "username is required" };
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: `/users/by/username/${encodeURIComponent(username)}`,
    query: {
      "user.fields": "id,name,username,verified,description,public_metrics",
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { user: res.data?.data || null };
}

async function getMyTimeline(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const maxResults = Math.min(
    Math.max(Number(input?.max_results) || 10, 5),
    100,
  );
  const res = await twitterRequest({
    tenant,
    method: "GET",
    path: `/users/${encodeURIComponent(userId)}/timelines/reverse_chronological`,
    query: {
      max_results: maxResults,
      "tweet.fields": "id,text,created_at,public_metrics,author_id",
      expansions: "author_id",
      "user.fields": "username,name",
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { tweets: res.data?.data || [], includes: res.data?.includes || null };
}

async function postTweet(input, ctx) {
  const text = String(input?.text || "").trim();
  if (!text) return { error: "text is required" };
  if (text.length > 280) {
    return { error: "tweet text exceeds 280 characters" };
  }
  const body = { text };
  if (input?.reply_to_tweet_id) {
    body.reply = { in_reply_to_tweet_id: String(input.reply_to_tweet_id) };
  }
  if (input?.quote_tweet_id) {
    body.quote_tweet_id = String(input.quote_tweet_id);
  }
  if (Array.isArray(input?.poll_options) && input.poll_options.length >= 2) {
    const options = input.poll_options.slice(0, 4).map((s) => String(s));
    const minutes = Math.min(
      Math.max(Number(input?.poll_duration_minutes) || 1440, 5),
      10080,
    );
    body.poll = { options, duration_minutes: minutes };
  }
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "POST",
    path: "/tweets",
    body,
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { tweet: res.data?.data || null };
}

async function deleteTweet(input, ctx) {
  const id = String(input?.tweet_id || "").trim();
  if (!id) return { error: "tweet_id is required" };
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "DELETE",
    path: `/tweets/${encodeURIComponent(id)}`,
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { deleted: !!res.data?.data?.deleted };
}

async function likeTweet(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const id = String(input?.tweet_id || "").trim();
  if (!id) return { error: "tweet_id is required" };
  const res = await twitterRequest({
    tenant,
    method: "POST",
    path: `/users/${encodeURIComponent(userId)}/likes`,
    body: { tweet_id: id },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { liked: !!res.data?.data?.liked };
}

async function followUser(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const targetUsername = String(input?.username || "")
    .replace(/^@/, "")
    .trim();
  if (!targetUsername) return { error: "username is required" };
  const lookup = await twitterRequest({
    tenant,
    method: "GET",
    path: `/users/by/username/${encodeURIComponent(targetUsername)}`,
  });
  const lookupMapped = mapTierError(lookup);
  if (lookupMapped) return lookupMapped;
  const targetId = lookup.data?.data?.id;
  if (!targetId) return { error: `user @${targetUsername} not found` };
  const res = await twitterRequest({
    tenant,
    method: "POST",
    path: `/users/${encodeURIComponent(userId)}/following`,
    body: { target_user_id: targetId },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { following: !!res.data?.data?.following, target_id: targetId };
}

async function bookmarkTweet(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const id = String(input?.tweet_id || "").trim();
  if (!id) return { error: "tweet_id is required" };
  const res = await twitterRequest({
    tenant,
    method: "POST",
    path: `/users/${encodeURIComponent(userId)}/bookmarks`,
    body: { tweet_id: id },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { bookmarked: !!res.data?.data?.bookmarked };
}

async function sendDm(input, ctx) {
  const participant = String(input?.recipient_username || "")
    .replace(/^@/, "")
    .trim();
  const text = String(input?.text || "").trim();
  if (!participant) return { error: "recipient_username is required" };
  if (!text) return { error: "text is required" };
  const lookup = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: `/users/by/username/${encodeURIComponent(participant)}`,
  });
  const lookupMapped = mapTierError(lookup);
  if (lookupMapped) return lookupMapped;
  const targetId = lookup.data?.data?.id;
  if (!targetId) return { error: `user @${participant} not found` };
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "POST",
    path: `/dm_conversations/with/${encodeURIComponent(targetId)}/messages`,
    body: { text },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return {
    dm_conversation_id: res.data?.data?.dm_conversation_id || null,
    dm_event_id: res.data?.data?.dm_event_id || null,
  };
}

async function listDmConversations(input, ctx) {
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: "/dm_conversations",
    query: {
      max_results: Math.min(Math.max(Number(input?.max_results) || 20, 1), 100),
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { conversations: res.data?.data || [] };
}

// ── Lookups, search, metrics ──────────────────────────────────────────────────

async function getTweet(input, ctx) {
  const id = String(input?.tweet_id || "").trim();
  if (!id) return { error: "tweet_id is required" };
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: `/tweets/${encodeURIComponent(id)}`,
    query: {
      "tweet.fields":
        "created_at,public_metrics,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,attachments,entities,lang,note_tweet",
      expansions: "author_id,referenced_tweets.id,attachments.media_keys",
      "user.fields": "name,username,verified,public_metrics",
      "media.fields": "url,preview_image_url,type,width,height,alt_text",
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return {
    tweet: res.data?.data || null,
    includes: res.data?.includes || null,
  };
}

async function searchRecent(input, ctx) {
  const query = String(input?.query || "").trim();
  if (!query) return { error: "query is required" };
  const max = Math.min(Math.max(Number(input?.max_results) || 10, 10), 100);
  const q = {
    query,
    max_results: max,
    "tweet.fields":
      "created_at,public_metrics,author_id,conversation_id,entities,lang,note_tweet",
    expansions: "author_id,attachments.media_keys",
    "user.fields": "name,username,verified",
  };
  if (input?.start_time) q.start_time = String(input.start_time);
  if (input?.end_time) q.end_time = String(input.end_time);
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: "/tweets/search/recent",
    query: q,
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return {
    tweets: res.data?.data || [],
    includes: res.data?.includes || null,
    meta: res.data?.meta || null,
  };
}

async function searchArchive(input, ctx) {
  const query = String(input?.query || "").trim();
  if (!query) return { error: "query is required" };
  const max = Math.min(Math.max(Number(input?.max_results) || 10, 10), 500);
  const q = {
    query,
    max_results: max,
    "tweet.fields":
      "created_at,public_metrics,author_id,conversation_id,entities,lang,note_tweet",
    expansions: "author_id,attachments.media_keys",
    "user.fields": "name,username,verified",
    start_time: String(input?.start_time || "2006-03-21T00:00:00Z"),
  };
  if (input?.end_time) q.end_time = String(input.end_time);
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: "/tweets/search/all",
    query: q,
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return {
    tweets: res.data?.data || [],
    includes: res.data?.includes || null,
    meta: res.data?.meta || null,
  };
}

async function getTweetMetrics(input, ctx) {
  const id = String(input?.tweet_id || "").trim();
  if (!id) return { error: "tweet_id is required" };
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: `/tweets/${encodeURIComponent(id)}`,
    query: {
      "tweet.fields": "public_metrics,non_public_metrics,organic_metrics",
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { tweet: res.data?.data || null };
}

async function getConversationThread(input, ctx) {
  const id = String(input?.tweet_id || "").trim();
  if (!id) return { error: "tweet_id is required" };
  const seed = await getTweet({ tweet_id: id }, ctx);
  if (seed.error) return seed;
  const convId = seed.tweet?.conversation_id || id;
  const max = Math.min(Math.max(Number(input?.max_results) || 50, 10), 100);
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: "/tweets/search/recent",
    query: {
      query: `conversation_id:${convId}`,
      max_results: max,
      "tweet.fields":
        "created_at,public_metrics,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,entities",
      expansions: "author_id,referenced_tweets.id",
      "user.fields": "name,username,verified",
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return {
    seed_tweet: seed.tweet,
    conversation_id: convId,
    replies: res.data?.data || [],
    includes: res.data?.includes || null,
  };
}

// ── User-scoped reads ─────────────────────────────────────────────────────────

async function getUserTimeline(input, ctx) {
  const username = String(input?.username || "")
    .replace(/^@/, "")
    .trim();
  if (!username) return { error: "username is required" };
  const lookup = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: `/users/by/username/${encodeURIComponent(username)}`,
  });
  const lookupMapped = mapTierError(lookup);
  if (lookupMapped) return lookupMapped;
  const targetId = lookup.data?.data?.id;
  if (!targetId) return { error: `user @${username} not found` };
  const max = Math.min(Math.max(Number(input?.max_results) || 10, 5), 100);
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: `/users/${encodeURIComponent(targetId)}/tweets`,
    query: {
      max_results: max,
      "tweet.fields":
        "created_at,public_metrics,author_id,conversation_id,entities,lang,note_tweet",
      expansions: "author_id,attachments.media_keys,referenced_tweets.id",
      "user.fields": "name,username,verified",
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return {
    user_id: targetId,
    tweets: res.data?.data || [],
    includes: res.data?.includes || null,
  };
}

async function listUserFollowers(input, ctx) {
  const username = String(input?.username || "")
    .replace(/^@/, "")
    .trim();
  if (!username) return { error: "username is required" };
  const lookup = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: `/users/by/username/${encodeURIComponent(username)}`,
  });
  const lookupMapped = mapTierError(lookup);
  if (lookupMapped) return lookupMapped;
  const targetId = lookup.data?.data?.id;
  if (!targetId) return { error: `user @${username} not found` };
  const max = Math.min(Math.max(Number(input?.max_results) || 100, 1), 1000);
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: `/users/${encodeURIComponent(targetId)}/followers`,
    query: {
      max_results: max,
      "user.fields": "created_at,description,public_metrics,verified",
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { user_id: targetId, followers: res.data?.data || [] };
}

async function listUserFollowing(input, ctx) {
  const username = String(input?.username || "")
    .replace(/^@/, "")
    .trim();
  if (!username) return { error: "username is required" };
  const lookup = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: `/users/by/username/${encodeURIComponent(username)}`,
  });
  const lookupMapped = mapTierError(lookup);
  if (lookupMapped) return lookupMapped;
  const targetId = lookup.data?.data?.id;
  if (!targetId) return { error: `user @${username} not found` };
  const max = Math.min(Math.max(Number(input?.max_results) || 100, 1), 1000);
  const res = await twitterRequest({
    tenant: ctx?.tenant,
    method: "GET",
    path: `/users/${encodeURIComponent(targetId)}/following`,
    query: {
      max_results: max,
      "user.fields": "created_at,description,public_metrics,verified",
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { user_id: targetId, following: res.data?.data || [] };
}

// ── Me reads ──────────────────────────────────────────────────────────────────

async function getMyMentions(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const max = Math.min(Math.max(Number(input?.max_results) || 10, 5), 100);
  const res = await twitterRequest({
    tenant,
    method: "GET",
    path: `/users/${encodeURIComponent(userId)}/mentions`,
    query: {
      max_results: max,
      "tweet.fields":
        "created_at,public_metrics,author_id,conversation_id,entities,note_tweet",
      expansions: "author_id",
      "user.fields": "name,username,verified",
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return {
    mentions: res.data?.data || [],
    includes: res.data?.includes || null,
  };
}

async function listMyBookmarks(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const max = Math.min(Math.max(Number(input?.max_results) || 10, 1), 100);
  const res = await twitterRequest({
    tenant,
    method: "GET",
    path: `/users/${encodeURIComponent(userId)}/bookmarks`,
    query: {
      max_results: max,
      "tweet.fields":
        "created_at,public_metrics,author_id,conversation_id,entities,lang,note_tweet",
      expansions: "author_id,attachments.media_keys",
      "user.fields": "name,username,verified",
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return {
    bookmarks: res.data?.data || [],
    includes: res.data?.includes || null,
  };
}

async function listMyLikedTweets(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const max = Math.min(Math.max(Number(input?.max_results) || 10, 5), 100);
  const res = await twitterRequest({
    tenant,
    method: "GET",
    path: `/users/${encodeURIComponent(userId)}/liked_tweets`,
    query: {
      max_results: max,
      "tweet.fields":
        "created_at,public_metrics,author_id,conversation_id,entities,lang,note_tweet",
      expansions: "author_id,attachments.media_keys",
      "user.fields": "name,username,verified",
    },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return {
    liked_tweets: res.data?.data || [],
    includes: res.data?.includes || null,
  };
}

// ── Engagement undo + retweets ────────────────────────────────────────────────

async function retweet(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const id = String(input?.tweet_id || "").trim();
  if (!id) return { error: "tweet_id is required" };
  const res = await twitterRequest({
    tenant,
    method: "POST",
    path: `/users/${encodeURIComponent(userId)}/retweets`,
    body: { tweet_id: id },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { retweeted: !!res.data?.data?.retweeted };
}

async function undoRetweet(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const id = String(input?.tweet_id || "").trim();
  if (!id) return { error: "tweet_id is required" };
  const res = await twitterRequest({
    tenant,
    method: "DELETE",
    path: `/users/${encodeURIComponent(userId)}/retweets/${encodeURIComponent(id)}`,
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { retweeted: res.data?.data?.retweeted === true };
}

async function unlikeTweet(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const id = String(input?.tweet_id || "").trim();
  if (!id) return { error: "tweet_id is required" };
  const res = await twitterRequest({
    tenant,
    method: "DELETE",
    path: `/users/${encodeURIComponent(userId)}/likes/${encodeURIComponent(id)}`,
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { liked: res.data?.data?.liked === true };
}

async function unbookmarkTweet(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const id = String(input?.tweet_id || "").trim();
  if (!id) return { error: "tweet_id is required" };
  const res = await twitterRequest({
    tenant,
    method: "DELETE",
    path: `/users/${encodeURIComponent(userId)}/bookmarks/${encodeURIComponent(id)}`,
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { bookmarked: res.data?.data?.bookmarked === true };
}

async function unfollowUser(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const targetUsername = String(input?.username || "")
    .replace(/^@/, "")
    .trim();
  if (!targetUsername) return { error: "username is required" };
  const lookup = await twitterRequest({
    tenant,
    method: "GET",
    path: `/users/by/username/${encodeURIComponent(targetUsername)}`,
  });
  const lookupMapped = mapTierError(lookup);
  if (lookupMapped) return lookupMapped;
  const targetId = lookup.data?.data?.id;
  if (!targetId) return { error: `user @${targetUsername} not found` };
  const res = await twitterRequest({
    tenant,
    method: "DELETE",
    path: `/users/${encodeURIComponent(userId)}/following/${encodeURIComponent(targetId)}`,
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { following: res.data?.data?.following === true };
}

// ── Block + mute ──────────────────────────────────────────────────────────────

async function resolveTargetUserId(tenant, username) {
  const lookup = await twitterRequest({
    tenant,
    method: "GET",
    path: `/users/by/username/${encodeURIComponent(username)}`,
  });
  const mapped = mapTierError(lookup);
  if (mapped) return { error: mapped };
  if (!lookup.ok) return { error: { error: lookup.error } };
  const id = lookup.data?.data?.id;
  if (!id) return { error: { error: `user @${username} not found` } };
  return { id };
}

async function blockUser(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const username = String(input?.username || "")
    .replace(/^@/, "")
    .trim();
  if (!username) return { error: "username is required" };
  const lookup = await resolveTargetUserId(tenant, username);
  if (lookup.error) return lookup.error;
  const res = await twitterRequest({
    tenant,
    method: "POST",
    path: `/users/${encodeURIComponent(userId)}/blocking`,
    body: { target_user_id: lookup.id },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { blocking: !!res.data?.data?.blocking, target_id: lookup.id };
}

async function unblockUser(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const username = String(input?.username || "")
    .replace(/^@/, "")
    .trim();
  if (!username) return { error: "username is required" };
  const lookup = await resolveTargetUserId(tenant, username);
  if (lookup.error) return lookup.error;
  const res = await twitterRequest({
    tenant,
    method: "DELETE",
    path: `/users/${encodeURIComponent(userId)}/blocking/${encodeURIComponent(lookup.id)}`,
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { blocking: res.data?.data?.blocking === true };
}

async function muteUser(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const username = String(input?.username || "")
    .replace(/^@/, "")
    .trim();
  if (!username) return { error: "username is required" };
  const lookup = await resolveTargetUserId(tenant, username);
  if (lookup.error) return lookup.error;
  const res = await twitterRequest({
    tenant,
    method: "POST",
    path: `/users/${encodeURIComponent(userId)}/muting`,
    body: { target_user_id: lookup.id },
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { muting: !!res.data?.data?.muting, target_id: lookup.id };
}

async function unmuteUser(input, ctx) {
  const tenant = ctx?.tenant;
  const userId = await getUserId(tenant);
  if (!userId) return notConnected();
  const username = String(input?.username || "")
    .replace(/^@/, "")
    .trim();
  if (!username) return { error: "username is required" };
  const lookup = await resolveTargetUserId(tenant, username);
  if (lookup.error) return lookup.error;
  const res = await twitterRequest({
    tenant,
    method: "DELETE",
    path: `/users/${encodeURIComponent(userId)}/muting/${encodeURIComponent(lookup.id)}`,
  });
  const mapped = mapTierError(res);
  if (mapped) return mapped;
  if (!res.ok) return { error: res.error };
  return { muting: res.data?.data?.muting === true };
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const TWITTER_TOOLS = [
  {
    name: "twitter_get_my_profile",
    description:
      "Get the connected user's X / Twitter profile (name, @handle, bio, follower counts).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "twitter_get_user_by_username",
    description: "Look up an X user's profile by their @handle.",
    input_schema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description:
            "X handle, with or without leading @ (e.g. 'elonmusk' or '@elonmusk').",
        },
      },
      required: ["username"],
    },
  },
  {
    name: "twitter_get_my_timeline",
    description:
      "Get the connected user's reverse-chronological home timeline. Free tier may return 403.",
    input_schema: {
      type: "object",
      properties: {
        max_results: {
          type: "number",
          description: "How many tweets to fetch (5-100, default 10).",
        },
      },
    },
  },
  {
    name: "twitter_post_tweet",
    description:
      "Post a new tweet on the connected user's account. Supports replies, quote tweets, and polls.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Tweet text, max 280 characters.",
        },
        reply_to_tweet_id: {
          type: "string",
          description:
            "Optional. Tweet ID to reply to. Note: as of Feb 2026, X restricts programmatic replies on self-serve tiers to threads where the original author mentioned or quoted you.",
        },
        quote_tweet_id: {
          type: "string",
          description:
            "Optional. Tweet ID to quote-tweet. Posts the new tweet with the quoted tweet embedded.",
        },
        poll_options: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional. 2-4 poll options. When provided, the tweet is posted as a poll.",
        },
        poll_duration_minutes: {
          type: "number",
          description:
            "Optional. Poll duration in minutes (5-10080, default 1440 = 24h). Ignored unless poll_options is set.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "twitter_delete_tweet",
    description: "Delete a tweet posted by the connected user.",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: { type: "string", description: "ID of the tweet to delete." },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "twitter_like_tweet",
    description: "Like a tweet on behalf of the connected user.",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: { type: "string", description: "ID of the tweet to like." },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "twitter_follow_user",
    description: "Follow an X user by their @handle.",
    input_schema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Handle of the user to follow (with or without @).",
        },
      },
      required: ["username"],
    },
  },
  {
    name: "twitter_bookmark_tweet",
    description: "Bookmark a tweet for the connected user.",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: {
          type: "string",
          description: "ID of the tweet to bookmark.",
        },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "twitter_send_dm",
    description:
      "Send a direct message on X to a user by @handle. Requires Pro tier on the X developer account.",
    input_schema: {
      type: "object",
      properties: {
        recipient_username: {
          type: "string",
          description: "Recipient's @handle.",
        },
        text: { type: "string", description: "DM body text." },
      },
      required: ["recipient_username", "text"],
    },
  },
  {
    name: "twitter_list_dm_conversations",
    description:
      "List recent X DM conversations for the connected user. Requires Pro tier.",
    input_schema: {
      type: "object",
      properties: {
        max_results: {
          type: "number",
          description: "How many conversations to list (1-100, default 20).",
        },
      },
    },
  },
  {
    name: "twitter_get_tweet",
    description:
      "Fetch a single tweet by ID with rich expansion (author, media, referenced tweets).",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: { type: "string", description: "ID of the tweet to fetch." },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "twitter_search_recent",
    description:
      "Search recent tweets (last ~7 days) using X's query syntax (from:user, to:user, lang:en, etc). Basic tier or higher recommended.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "X search query (e.g. 'from:elonmusk', 'machine learning lang:en', '\"open source\" min_faves:50').",
        },
        max_results: {
          type: "number",
          description: "How many tweets to fetch (10-100, default 10).",
        },
        start_time: {
          type: "string",
          description:
            "Optional ISO-8601 lower bound (e.g. 2026-05-20T00:00:00Z).",
        },
        end_time: {
          type: "string",
          description: "Optional ISO-8601 upper bound.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "twitter_search_archive",
    description:
      "Full-archive tweet search back to 2006-03-21. Requires Pro tier or higher (pay-per-use also works).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "X search query." },
        max_results: {
          type: "number",
          description:
            "How many tweets to fetch per call (10-500, default 10).",
        },
        start_time: {
          type: "string",
          description:
            "Optional ISO-8601 lower bound; defaults to 2006-03-21T00:00:00Z.",
        },
        end_time: {
          type: "string",
          description: "Optional ISO-8601 upper bound.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "twitter_get_tweet_metrics",
    description:
      "Fetch public + non-public + organic metrics for a tweet (impressions, profile clicks, link clicks). Only works for tweets the connected user authored.",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: { type: "string", description: "ID of the tweet." },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "twitter_get_conversation_thread",
    description:
      "Fetch the full conversation thread around a tweet by ID. Returns the seed tweet plus replies/branches in the same conversation_id.",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: {
          type: "string",
          description: "Any tweet ID in the thread.",
        },
        max_results: {
          type: "number",
          description: "Max reply tweets to fetch (10-100, default 50).",
        },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "twitter_get_user_timeline",
    description:
      "Fetch any user's recent public tweets by @handle. Different from twitter_get_my_timeline (which is the home feed of the connected user).",
    input_schema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "X handle (with or without @).",
        },
        max_results: {
          type: "number",
          description: "How many tweets to fetch (5-100, default 10).",
        },
      },
      required: ["username"],
    },
  },
  {
    name: "twitter_list_user_followers",
    description: "List the followers of an X user by @handle.",
    input_schema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "X handle (with or without @).",
        },
        max_results: {
          type: "number",
          description: "Max followers to fetch (1-1000, default 100).",
        },
      },
      required: ["username"],
    },
  },
  {
    name: "twitter_list_user_following",
    description: "List the accounts an X user is following.",
    input_schema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "X handle (with or without @).",
        },
        max_results: {
          type: "number",
          description: "Max following to fetch (1-1000, default 100).",
        },
      },
      required: ["username"],
    },
  },
  {
    name: "twitter_get_my_mentions",
    description: "Fetch recent tweets that @mention the connected user.",
    input_schema: {
      type: "object",
      properties: {
        max_results: {
          type: "number",
          description: "How many mentions to fetch (5-100, default 10).",
        },
      },
    },
  },
  {
    name: "twitter_list_my_bookmarks",
    description:
      "List the connected user's bookmarked tweets. Requires Basic tier or higher.",
    input_schema: {
      type: "object",
      properties: {
        max_results: {
          type: "number",
          description: "How many bookmarks to fetch (1-100, default 10).",
        },
      },
    },
  },
  {
    name: "twitter_list_my_liked_tweets",
    description:
      "List tweets the connected user has liked. Requires the like.read scope (granted on reconnect after PR #91).",
    input_schema: {
      type: "object",
      properties: {
        max_results: {
          type: "number",
          description: "How many liked tweets to fetch (5-100, default 10).",
        },
      },
    },
  },
  {
    name: "twitter_retweet",
    description: "Retweet a tweet on the connected user's account.",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: {
          type: "string",
          description: "ID of the tweet to retweet.",
        },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "twitter_undo_retweet",
    description: "Remove a retweet by the connected user.",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: {
          type: "string",
          description: "ID of the tweet whose retweet to remove.",
        },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "twitter_unlike_tweet",
    description: "Remove a like on a tweet by the connected user.",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: { type: "string", description: "ID of the tweet to unlike." },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "twitter_unbookmark_tweet",
    description:
      "Remove a bookmark by the connected user. Requires Basic tier or higher.",
    input_schema: {
      type: "object",
      properties: {
        tweet_id: {
          type: "string",
          description: "ID of the tweet to remove from bookmarks.",
        },
      },
      required: ["tweet_id"],
    },
  },
  {
    name: "twitter_unfollow_user",
    description: "Unfollow an X user by @handle.",
    input_schema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Handle of the user to unfollow (with or without @).",
        },
      },
      required: ["username"],
    },
  },
  {
    name: "twitter_block_user",
    description: "Block an X user by @handle. Requires the block.write scope.",
    input_schema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Handle of the user to block (with or without @).",
        },
      },
      required: ["username"],
    },
  },
  {
    name: "twitter_unblock_user",
    description: "Unblock an X user by @handle.",
    input_schema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Handle of the user to unblock (with or without @).",
        },
      },
      required: ["username"],
    },
  },
  {
    name: "twitter_mute_user",
    description: "Mute an X user by @handle. Requires the mute.write scope.",
    input_schema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Handle of the user to mute (with or without @).",
        },
      },
      required: ["username"],
    },
  },
  {
    name: "twitter_unmute_user",
    description: "Unmute an X user by @handle.",
    input_schema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Handle of the user to unmute (with or without @).",
        },
      },
      required: ["username"],
    },
  },
];

// ── Executor ──────────────────────────────────────────────────────────────────

export async function executeTwitterTool(toolName, input, ctx) {
  console.log(`[twitter] ${toolName}`);
  try {
    switch (toolName) {
      case "twitter_get_my_profile":
        return await getMyProfile(input, ctx);
      case "twitter_get_user_by_username":
        return await getUserByUsername(input, ctx);
      case "twitter_get_my_timeline":
        return await getMyTimeline(input, ctx);
      case "twitter_post_tweet":
        return await postTweet(input, ctx);
      case "twitter_delete_tweet":
        return await deleteTweet(input, ctx);
      case "twitter_like_tweet":
        return await likeTweet(input, ctx);
      case "twitter_follow_user":
        return await followUser(input, ctx);
      case "twitter_bookmark_tweet":
        return await bookmarkTweet(input, ctx);
      case "twitter_send_dm":
        return await sendDm(input, ctx);
      case "twitter_list_dm_conversations":
        return await listDmConversations(input, ctx);
      case "twitter_get_tweet":
        return await getTweet(input, ctx);
      case "twitter_search_recent":
        return await searchRecent(input, ctx);
      case "twitter_search_archive":
        return await searchArchive(input, ctx);
      case "twitter_get_tweet_metrics":
        return await getTweetMetrics(input, ctx);
      case "twitter_get_conversation_thread":
        return await getConversationThread(input, ctx);
      case "twitter_get_user_timeline":
        return await getUserTimeline(input, ctx);
      case "twitter_list_user_followers":
        return await listUserFollowers(input, ctx);
      case "twitter_list_user_following":
        return await listUserFollowing(input, ctx);
      case "twitter_get_my_mentions":
        return await getMyMentions(input, ctx);
      case "twitter_list_my_bookmarks":
        return await listMyBookmarks(input, ctx);
      case "twitter_list_my_liked_tweets":
        return await listMyLikedTweets(input, ctx);
      case "twitter_retweet":
        return await retweet(input, ctx);
      case "twitter_undo_retweet":
        return await undoRetweet(input, ctx);
      case "twitter_unlike_tweet":
        return await unlikeTweet(input, ctx);
      case "twitter_unbookmark_tweet":
        return await unbookmarkTweet(input, ctx);
      case "twitter_unfollow_user":
        return await unfollowUser(input, ctx);
      case "twitter_block_user":
        return await blockUser(input, ctx);
      case "twitter_unblock_user":
        return await unblockUser(input, ctx);
      case "twitter_mute_user":
        return await muteUser(input, ctx);
      case "twitter_unmute_user":
        return await unmuteUser(input, ctx);
      default:
        return { error: `Unknown Twitter tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[twitter] ${toolName} failed:`, err?.message);
    return { error: err?.message || "twitter-tool-error" };
  }
}
