/**
 * LinkedIn tools — OAuth2 REST API client.
 *
 * Per-tenant secrets:
 *   LINKEDIN_OAUTH_REFRESH  — refresh token
 *   LINKEDIN_OAUTH_ACCESS   — access token (cached)
 *   LINKEDIN_OAUTH_EXPIRES  — epoch-ms expiry
 *
 * Org-level env:
 *   LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET
 *
 * Tools:
 *   linkedin_me              — current user profile
 *   linkedin_share_post      — share a text post (text, visibility?)
 *   linkedin_search_people   — returns unavailable error (LinkedIn REST
 *                              search requires Partner API access)
 *   linkedin_org_analytics   — post cadence, engagement, recurring likers
 *                              for an organization page over a window
 *
 * Endpoint base: https://api.linkedin.com/v2/
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";
import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../constants.js";

const COOKIE_MODE_SENTINEL = "cookie-mode";

function tenantDidOf(tenant) {
  if (!tenant) return null;
  if (typeof tenant === "string") return tenant;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

registerCapability("_tools_LinkedIn", "Post to LinkedIn and read your profile");

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const API_BASE = "https://api.linkedin.com/v2/";
const REFRESH_BUFFER_SEC = 120;

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const LINKEDIN_TOOLS = [
  {
    name: "linkedin_me",
    description:
      "Fetch the authenticated user's LinkedIn profile (name, headline, id).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "linkedin_share_post",
    description: "Share a text post on LinkedIn.",
    input_schema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Post content (plain text)" },
        visibility: {
          type: "string",
          enum: ["PUBLIC", "CONNECTIONS"],
          description: "Audience. Defaults to PUBLIC.",
        },
      },
    },
  },
  {
    name: "linkedin_search_people",
    description:
      "Search LinkedIn for people by keyword. Note: this requires LinkedIn Partner API access which is not generally available.",
    input_schema: {
      type: "object",
      required: ["keywords"],
      properties: {
        keywords: { type: "string" },
      },
    },
  },
  {
    name: "linkedin_org_analytics",
    description:
      "Org-level LinkedIn analytics: post cadence (weekly buckets), engagement totals + averages, best-performing post, and recurring likers across a window. Use for prompts like 'how often are we posting on the BMA LinkedIn', 'what's our engagement', or 'who keeps liking our posts'.",
    input_schema: {
      type: "object",
      required: ["org_handle"],
      properties: {
        org_handle: {
          type: "string",
          description:
            "Organization vanityName (e.g. 'blue-modern-advisory'), numeric id ('12345'), or full URN ('urn:li:organization:12345').",
        },
        window: {
          type: "string",
          enum: ["7d", "30d", "90d"],
          description: "Lookback window. Defaults to 30d.",
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeLinkedInTool(toolName, input, ctx) {
  const tenant = ctx?.tenant ?? ctx;

  if (toolName === "linkedin_search_people") {
    return {
      error: "linkedin-search-unavailable",
      suggestion:
        "LinkedIn People Search requires LinkedIn Partner API access, " +
        "which is not available via the standard OAuth app. " +
        "Use linkedin_me to confirm your profile or share a post with linkedin_share_post.",
    };
  }

  // Cookie-mode shortcut: org analytics has a working path through medha-id
  // that uses the user's Voyager session cookies. Most BMA / Rytual users are
  // currently cookie-only (no Marketing Partner OAuth approval), so the v2-
  // API path below would fail token refresh on the "cookie-mode" sentinel
  // refresh token and return a useless error. Try cookie-mode first when the
  // tool is org_analytics; only fall through to v2 OAuth if cookies aren't
  // configured for this tenant.
  if (toolName === "linkedin_org_analytics") {
    const refresh = await getSecret(tenant, "LINKEDIN_OAUTH_REFRESH").catch(
      () => null,
    );
    const isCookieMode = refresh === COOKIE_MODE_SENTINEL;
    const cookieLiAt = await getSecret(tenant, "LINKEDIN_COOKIE_LI_AT").catch(
      () => null,
    );
    if (isCookieMode || cookieLiAt) {
      return cookieModeOrgAnalytics(tenant, input);
    }
  }

  let accessToken;
  try {
    accessToken = await getLinkedInAccessToken(tenant);
  } catch (e) {
    return { error: e.message, hint: "connect-first" };
  }

  try {
    switch (toolName) {
      case "linkedin_me":
        return fetchProfile(accessToken);
      case "linkedin_share_post":
        return sharePost(accessToken, input);
      case "linkedin_org_analytics":
        return orgAnalytics(accessToken, input);
      default:
        return { error: `Unknown LinkedIn tool: ${toolName}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function getLinkedInAccessToken(tenant) {
  const refreshToken = await getSecret(tenant, "LINKEDIN_OAUTH_REFRESH").catch(
    () => null,
  );
  if (!refreshToken) {
    throw new Error("LINKEDIN_OAUTH_REFRESH not set. Connect LinkedIn first.");
  }

  const [cachedAccess, cachedExpires] = await Promise.all([
    getSecret(tenant, "LINKEDIN_OAUTH_ACCESS").catch(() => null),
    getSecret(tenant, "LINKEDIN_OAUTH_EXPIRES").catch(() => null),
  ]);

  const nowSec = Date.now() / 1000;
  const expSec = cachedExpires ? Number(cachedExpires) / 1000 : 0;
  if (cachedAccess && expSec - nowSec > REFRESH_BUFFER_SEC) {
    return cachedAccess;
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID ?? "";
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET ?? "";

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LinkedIn token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const newAccess = data.access_token;
  const newExpires = Date.now() + (data.expires_in ?? 3600) * 1000;

  cacheLinkedInTokens(tenant, newAccess, newExpires).catch(() => {});
  return newAccess;
}

async function cacheLinkedInTokens(tenant, access, expiresMs) {
  const did = tenant?.did;
  if (!did) return;
  const apiKey = process.env.AMBER_ID_API_KEY ?? "";
  const enc = encodeURIComponent(did);
  const base = `https://amber-id-production.up.railway.app/v1/secrets/${enc}`;
  await Promise.all([
    fetch(`${base}/LINKEDIN_OAUTH_ACCESS`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ value: access }),
    }),
    fetch(`${base}/LINKEDIN_OAUTH_EXPIRES`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ value: String(expiresMs) }),
    }),
  ]);
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function liGet(path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LinkedIn GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function fetchProfile(token) {
  // /v2/userinfo is the OpenID endpoint available to standard apps
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LinkedIn /v2/userinfo failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function sharePost(token, { text, visibility = "PUBLIC" }) {
  // Need the member URN first
  const profile = await fetchProfile(token);
  const sub = profile.sub; // "urn:li:person:<id>" or just the id string

  // Build the member URN
  const authorUrn = sub.startsWith("urn:") ? sub : `urn:li:person:${sub}`;

  const body = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "NONE",
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": visibility,
    },
  };

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LinkedIn share failed (${res.status}): ${errText}`);
  }

  const location =
    res.headers.get("x-restli-id") ?? res.headers.get("location") ?? "";
  return { success: true, postId: location };
}

// ---------------------------------------------------------------------------
// Org analytics
// ---------------------------------------------------------------------------

const WINDOW_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

async function orgAnalytics(token, input) {
  const window = input?.window ?? "30d";
  const days = WINDOW_DAYS[window] ?? 30;
  const now = Date.now();
  const from = now - days * 24 * 60 * 60 * 1000;

  const org = await resolveOrg(token, String(input?.org_handle ?? "").trim());
  if (org.error) return org;

  const orgUrn = `urn:li:organization:${org.id}`;
  const notes = [];

  const posts = await listOrgPosts(token, orgUrn).catch((e) => {
    notes.push(`posts-fetch-failed: ${e.message}`);
    return [];
  });

  const inWindow = posts.filter((p) => p.createdAtMs >= from);
  const shareUrns = inWindow.map((p) => p.shareUrn).filter(Boolean);

  const statsByShare = await fetchShareStatistics(
    token,
    orgUrn,
    shareUrns,
  ).catch((e) => {
    notes.push(`stats-fetch-failed: ${e.message}`);
    return {};
  });

  let totalReactions = 0;
  let totalComments = 0;
  let totalShares = 0;
  let bestPost = null;
  const enrichedPosts = inWindow.map((p) => {
    const s = statsByShare[p.shareUrn]?.totalShareStatistics ?? {};
    const reactions = s.likeCount ?? 0;
    const comments = s.commentCount ?? 0;
    const shares = s.shareCount ?? 0;
    totalReactions += reactions;
    totalComments += comments;
    totalShares += shares;
    const score = reactions + comments * 2 + shares * 3;
    const row = {
      shareUrn: p.shareUrn,
      url: shareUrnToUrl(p.shareUrn),
      posted_at: new Date(p.createdAtMs).toISOString(),
      reactions,
      comments,
      shares,
      snippet: (p.text ?? "").slice(0, 140),
    };
    if (!bestPost || score > bestPost.__score) {
      bestPost = { ...row, __score: score };
    }
    return row;
  });
  if (bestPost) delete bestPost.__score;

  const byWeek = bucketByWeek(enrichedPosts, from, now);

  const likers = await collectRecurringLikers(token, shareUrns).catch((e) => {
    notes.push(`likers-fetch-failed: ${e.message}`);
    return [];
  });

  return {
    org: {
      handle: org.vanityName ?? null,
      name: org.localizedName ?? null,
      id: org.id,
      urn: orgUrn,
    },
    window: {
      label: window,
      from: new Date(from).toISOString(),
      to: new Date(now).toISOString(),
    },
    posts: {
      total: inWindow.length,
      by_week: byWeek,
    },
    engagement: {
      total_reactions: totalReactions,
      total_comments: totalComments,
      total_shares: totalShares,
      avg_per_post: inWindow.length
        ? Math.round(
            ((totalReactions + totalComments + totalShares) / inWindow.length) *
              10,
          ) / 10
        : 0,
      best_post: bestPost,
    },
    recurring_likers: likers,
    notes: notes.length ? notes : undefined,
  };
}

async function resolveOrg(token, handle) {
  if (!handle) return { error: "org_handle is required" };

  let id = null;
  let vanityName = null;
  if (handle.startsWith("urn:li:organization:")) {
    id = handle.slice("urn:li:organization:".length);
  } else if (/^\d+$/.test(handle)) {
    id = handle;
  } else {
    vanityName = handle;
    const search = await liGet(
      `organizations?q=vanityName&vanityName=${encodeURIComponent(handle)}`,
      token,
    ).catch((e) => ({ __error: e.message }));
    if (search?.__error) {
      return {
        error: "linkedin-org-resolve-failed",
        detail: search.__error,
        hint: "Standard OAuth apps need r_organization_admin or r_organization_social scope on a page you manage. Pass the numeric org id directly to bypass vanity lookup.",
      };
    }
    const first = search?.elements?.[0];
    if (!first?.id) {
      return {
        error: "linkedin-org-not-found",
        handle,
        hint: "Pass numeric id or the urn:li:organization:<id> form.",
      };
    }
    id = String(first.id);
    vanityName = first.vanityName ?? handle;
  }

  let localizedName = null;
  try {
    const meta = await liGet(`organizations/${id}`, token);
    localizedName = meta?.localizedName ?? null;
    if (!vanityName) vanityName = meta?.vanityName ?? null;
  } catch {
    // Non-fatal: we have an id.
  }

  return { id, vanityName, localizedName };
}

async function listOrgPosts(token, orgUrn) {
  const encoded = encodeURIComponent(orgUrn);
  const path = `ugcPosts?q=authors&authors=List(${encoded})&count=100&sortBy=LAST_MODIFIED`;
  const res = await liGet(path, token);
  const elements = res?.elements ?? [];
  return elements.map((el) => {
    const text =
      el?.specificContent?.["com.linkedin.ugc.ShareContent"]?.shareCommentary
        ?.text ?? "";
    const createdAtMs = el?.created?.time ?? el?.firstPublishedAt ?? 0;
    return {
      shareUrn: el?.id ?? null,
      createdAtMs,
      text,
    };
  });
}

async function fetchShareStatistics(token, orgUrn, shareUrns) {
  if (!shareUrns.length) return {};
  const orgEncoded = encodeURIComponent(orgUrn);
  const out = {};
  // LinkedIn caps shares list size per request. Chunk to 20 for safety.
  for (let i = 0; i < shareUrns.length; i += 20) {
    const chunk = shareUrns.slice(i, i + 20);
    const sharesParam = chunk
      .map((u, idx) => `shares[${idx}]=${encodeURIComponent(u)}`)
      .join("&");
    const path = `organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${orgEncoded}&${sharesParam}`;
    const res = await liGet(path, token);
    for (const el of res?.elements ?? []) {
      if (el?.share) out[el.share] = el;
    }
  }
  return out;
}

async function collectRecurringLikers(token, shareUrns) {
  if (!shareUrns.length) return [];
  const counts = new Map();
  const lastLiked = new Map();

  for (const shareUrn of shareUrns) {
    const encoded = encodeURIComponent(shareUrn);
    const path = `socialActions/${encoded}/likes?count=100`;
    let page;
    try {
      page = await liGet(path, token);
    } catch {
      continue;
    }
    for (const like of page?.elements ?? []) {
      const actor = like?.actor;
      if (!actor) continue;
      counts.set(actor, (counts.get(actor) ?? 0) + 1);
      const ts = like?.created?.time ?? 0;
      if (ts > (lastLiked.get(actor) ?? 0)) lastLiked.set(actor, ts);
    }
  }

  const rows = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([actor, n]) => ({
      actor_urn: actor,
      like_count: n,
      last_liked_at: lastLiked.get(actor)
        ? new Date(lastLiked.get(actor)).toISOString()
        : null,
    }))
    .sort((a, b) => b.like_count - a.like_count)
    .slice(0, 25);

  return rows;
}

function bucketByWeek(posts, fromMs, toMs) {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const buckets = [];
  for (let start = fromMs; start < toMs; start += weekMs) {
    const end = Math.min(start + weekMs, toMs);
    const count = posts.filter((p) => {
      const t = new Date(p.posted_at).getTime();
      return t >= start && t < end;
    }).length;
    buckets.push({
      week_start: new Date(start).toISOString().slice(0, 10),
      count,
    });
  }
  return buckets;
}

function shareUrnToUrl(shareUrn) {
  if (!shareUrn) return null;
  return `https://www.linkedin.com/feed/update/${shareUrn}/`;
}

// ---------------------------------------------------------------------------
// Cookie-mode (Voyager) org analytics via amber-id
// ---------------------------------------------------------------------------

const COOKIE_MODE_LOOKBACK_DEFAULT = 30;
const COOKIE_MODE_SYNC_WAIT_MS = 1500;

/**
 * Org analytics for tenants connected via the Amber LinkedIn Chrome
 * extension (cookie-mode). LinkedIn's v2 REST API requires Marketing
 * Developer Platform scopes our app doesn't have; amber-id's Voyager
 * scraper pulls the same data using the user's li_at + JSESSIONID
 * cookies. This function kicks off a fresh scrape, gives it a moment to
 * write, then reads the recent posts + top engagers and shapes them
 * into the same response envelope the v2 path returns so the agent
 * doesn't have to branch.
 */
async function cookieModeOrgAnalytics(tenant, input) {
  if (!AMBER_ID_API_URL || !AMBER_ID_API_KEY) {
    return {
      error: "amber-id-not-configured",
      hint: "AMBER_ID_API_URL + AMBER_ID_API_KEY env must be set on amber-agent",
    };
  }
  const did = tenantDidOf(tenant);
  if (!did) {
    return { error: "tenant-has-no-did" };
  }

  const window = input?.window ?? "30d";
  const lookbackDays =
    window === "7d" ? 7 : window === "90d" ? 90 : COOKIE_MODE_LOOKBACK_DEFAULT;
  const vanityName = String(input?.org_handle ?? "").trim() || undefined;

  // Kick off a fresh scrape. We send vanityName explicitly when the agent
  // supplied an org_handle; otherwise amber-id falls back to the stored
  // LINKEDIN_ORG_VANITY_NAME secret. This call returns 200 immediately and
  // the scrape runs in the background on amber-id.
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": AMBER_ID_API_KEY,
  };
  const syncRes = await fetch(
    `${AMBER_ID_API_URL}/v1/oauth/linkedin/org-analytics/sync`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ did, ...(vanityName ? { vanityName } : {}) }),
    },
  );
  if (!syncRes.ok) {
    const text = await syncRes.text().catch(() => "");
    if (syncRes.status === 400 && /missing_vanity/.test(text)) {
      return {
        error: "missing-org-vanity",
        hint: "Pass org_handle (e.g. 'blue-modern-advisory') or call /v1/oauth/linkedin/org-analytics/vanity from the dashboard.",
      };
    }
    if (syncRes.status === 409) {
      return {
        error: "linkedin-cookies-missing",
        hint: "User has not synced LinkedIn cookies via the Amber LinkedIn Chrome extension yet.",
      };
    }
    return {
      error: `amber-id-sync-failed`,
      status: syncRes.status,
      detail: text.slice(0, 280),
    };
  }
  const syncBody = await syncRes.json().catch(() => ({}));
  const orgVanity = syncBody?.org_vanity || vanityName || null;

  // The scrape is fire-and-forget on amber-id; give it a moment to write the
  // first posts before reading. This isn't a correctness wait (next call also
  // returns whatever's already in Firestore from a prior sync), just a
  // small UX optimization for "fresh" runs.
  await new Promise((r) => setTimeout(r, COOKIE_MODE_SYNC_WAIT_MS));

  const qs = new URLSearchParams({
    did,
    lookback_days: String(lookbackDays),
    ...(orgVanity ? { org_vanity: orgVanity } : {}),
  }).toString();

  const [recentRes, engagersRes] = await Promise.all([
    fetch(`${AMBER_ID_API_URL}/v1/oauth/linkedin/org-analytics/recent?${qs}`, {
      method: "GET",
      headers,
    }),
    fetch(
      `${AMBER_ID_API_URL}/v1/oauth/linkedin/org-analytics/top-engagers?${qs}`,
      { method: "GET", headers },
    ),
  ]);
  if (!recentRes.ok) {
    return {
      error: "amber-id-recent-failed",
      status: recentRes.status,
    };
  }
  const recent = await recentRes.json().catch(() => ({}));
  const engagers = engagersRes.ok
    ? await engagersRes.json().catch(() => ({}))
    : { top: [] };

  const posts = Array.isArray(recent?.posts) ? recent.posts : [];
  const totals = recent?.totals || {};
  const bestPost = posts.reduce((best, p) => {
    const score =
      (p.num_likes || 0) + (p.num_comments || 0) * 2 + (p.num_shares || 0) * 3;
    if (!best || score > best.__score) {
      return {
        post_urn: p.post_urn,
        posted_at: p.posted_at,
        snippet: (p.text || "").slice(0, 140),
        reactions: p.num_likes || 0,
        comments: p.num_comments || 0,
        shares: p.num_shares || 0,
        __score: score,
      };
    }
    return best;
  }, null);
  if (bestPost) delete bestPost.__score;

  return {
    source: "voyager-cookie-mode",
    org: {
      handle: orgVanity,
      name: null,
    },
    window: {
      label: window,
      lookback_days: lookbackDays,
    },
    posts: {
      total: totals.posts ?? posts.length,
      posts_per_week: totals.posts_per_week ?? null,
      recent: posts.slice(0, 10).map((p) => ({
        post_urn: p.post_urn,
        posted_at: p.posted_at,
        reactions: p.num_likes || 0,
        comments: p.num_comments || 0,
        shares: p.num_shares || 0,
        snippet: (p.text || "").slice(0, 140),
      })),
    },
    engagement: {
      total_reactions: totals.likes ?? 0,
      total_comments: totals.comments ?? 0,
      total_shares: totals.shares ?? 0,
      avg_per_post: totals.avg_engagement_per_post ?? 0,
      best_post: bestPost,
    },
    recurring_likers: Array.isArray(engagers?.top)
      ? engagers.top.map((e) => ({
          actor_urn: e.actor_urn,
          name: e.name,
          headline: e.headline,
          public_identifier: e.public_identifier,
          like_count: e.like_count,
          last_liked_at: e.last_liked_at,
        }))
      : [],
    last_synced_at: engagers?.last_synced_at || null,
  };
}
