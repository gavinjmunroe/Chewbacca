/**
 * LinkedIn Connections Sync — 60-second adaptive poller
 *
 * Workarounds for LinkedIn's lack of connection webhooks:
 *
 * 1. CURSOR DIFF: Track `lastConnectedAt` epoch ms. On each poll, only fetch
 *    the first page(s) of connections sorted by connectedAt DESC. If the newest
 *    connection on the first page matches our cursor, stop — no new connections.
 *    Avoid re-fetching all 500+ connections every minute.
 *
 * 2. IN-MEMORY CACHE: Known IDs stored in RAM. BQ queried only at startup.
 *    60-second polls are pure Voyager API → memory diff → insert new rows only.
 *
 * 3. PUB/SUB FIRE: Every new insert immediately publishes a
 *    `social_connection_added` event so downstream systems react in real time.
 *
 * 4. ORG WEBHOOK SIGNAL (if org creds set): LinkedIn DOES have real webhooks
 *    for org page followers. When someone follows the BMA org page after
 *    connecting with Kevin, we catch that signal and immediately sync.
 *    Configured via LINKEDIN_ORG_ID env var.
 *
 * Auth: li_at + JSESSIONID cookies (same as @bcharleson/linkedincli)
 */

import { randomUUID } from "crypto";
import { DncBigQueryWriter } from "./bq-writer.js";
import type {
  SocialConnectionRow,
  SyncResult,
  PlatformCache,
} from "../types/index.js";

const VOYAGER_BASE = "https://www.linkedin.com/voyager/api";
const MIN_GAP_MS = 2000;
let lastRequestTime = 0;

// ─── Voyager client ───────────────────────────────────────────────────────────

function makeHeaders(liAt: string, jsessionid: string): Record<string, string> {
  const csrf = jsessionid.replace(/"/g, "");
  return {
    "csrf-token": csrf,
    cookie: `JSESSIONID="${csrf}"; li_at=${liAt}`,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    accept: "application/vnd.linkedin.normalized+json+2.1",
    "accept-language": "en-US,en;q=0.9",
    "x-li-lang": "en_US",
    "x-restli-protocol-version": "2.0.0",
    "x-li-track": JSON.stringify({
      clientVersion: "1.13.21",
      osName: "web",
      timezoneOffset: new Date().getTimezoneOffset() / -60,
      deviceFormFactor: "DESKTOP",
      mpName: "voyager-web",
    }),
  };
}

async function voyagerGet<T>(
  path: string,
  params: Record<string, string | number>,
  headers: Record<string, string>,
): Promise<T> {
  const gap = Date.now() - lastRequestTime;
  if (gap < MIN_GAP_MS)
    await new Promise((r) => setTimeout(r, MIN_GAP_MS - gap));

  const url = new URL(`${VOYAGER_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) =>
    url.searchParams.set(k, String(v)),
  );

  const res = await fetch(url.toString(), { headers });
  lastRequestTime = Date.now();

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `LinkedIn Voyager ${res.status} on ${path}: ${body.slice(0, 200)}`,
    );
  }
  return res.json() as Promise<T>;
}

// ─── API types ────────────────────────────────────────────────────────────────

interface VoyagerProfile {
  entityUrn?: string;
  objectUrn?: string;
  publicIdentifier?: string;
  firstName?: string;
  lastName?: string;
  occupation?: string;
  picture?: {
    "com.linkedin.common.VectorImage"?: {
      rootUrl?: string;
      artifacts?: { fileIdentifyingUrlPathSegment?: string }[];
    };
  };
}

interface VoyagerConnectionsResponse {
  elements?: Array<{ "*miniProfile"?: string; connectedAt?: number }>;
  paging?: { total?: number };
  included?: VoyagerProfile[];
}

// ─── Fetch own profile ────────────────────────────────────────────────────────

export async function fetchLinkedInOwner(
  liAt: string,
  jsessionid: string,
): Promise<{ id: string; username: string }> {
  const headers = makeHeaders(liAt, jsessionid);
  const data = await voyagerGet<{ miniProfile?: VoyagerProfile }>(
    "/me",
    {},
    headers,
  );
  return {
    id: data.miniProfile?.objectUrn?.split(":").pop() ?? "unknown",
    username: data.miniProfile?.publicIdentifier ?? "unknown",
  };
}

// ─── Fetch ONE page of connections sorted newest-first ───────────────────────
// Key workaround: LinkedIn returns connections sorted by connectedAt DESC
// We only fetch the first page(s) and stop when we hit our cursor.

async function fetchRecentConnections(
  headers: Record<string, string>,
  since: number | null, // epoch ms — stop fetching older than this
  maxPages = 10,
): Promise<{
  connections: Array<{ profile: VoyagerProfile; connectedAt: number }>;
  hitCursor: boolean;
}> {
  const results: Array<{ profile: VoyagerProfile; connectedAt: number }> = [];
  let hitCursor = false;

  for (let page = 0; page < maxPages; page++) {
    const start = page * 40;
    const data = await voyagerGet<VoyagerConnectionsResponse>(
      "/relationships/connectionsList",
      { start, count: 40, sortType: "RECENTLY_ADDED" },
      headers,
    );

    const profileMap = new Map<string, VoyagerProfile>();
    for (const p of data.included ?? []) {
      if (p.entityUrn) profileMap.set(p.entityUrn, p);
      if (p.objectUrn) profileMap.set(p.objectUrn, p);
    }

    for (const el of data.elements ?? []) {
      const profile = el["*miniProfile"]
        ? profileMap.get(el["*miniProfile"])
        : null;
      if (!profile) continue;

      const connectedAt = el.connectedAt ?? 0;

      // If this connection is older than our cursor, we're done
      if (since && connectedAt <= since) {
        hitCursor = true;
        break;
      }

      results.push({ profile, connectedAt });
    }

    if (hitCursor) break;

    // If this page had fewer than 40 results, we've seen everything
    if ((data.elements?.length ?? 0) < 40) break;

    // Random human-like delay between pages
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
  }

  return { connections: results, hitCursor };
}

// ─── Map to BQ row ────────────────────────────────────────────────────────────

function mapToRow(
  profile: VoyagerProfile,
  connectedAt: number,
  owner: { ownerId: string; id: string; username: string },
): SocialConnectionRow {
  const now = new Date().toISOString();
  const slug = profile.publicIdentifier ?? "";
  const imgVec = profile.picture?.["com.linkedin.common.VectorImage"];
  const avatar = imgVec
    ? `${imgVec.rootUrl ?? ""}${imgVec.artifacts?.at(-1)?.fileIdentifyingUrlPathSegment ?? ""}`
    : null;
  const occupation = profile.occupation ?? "";
  let title: string | null = occupation || null;
  let company: string | null = null;
  const atIdx = occupation.lastIndexOf(" at ");
  if (atIdx !== -1) {
    title = occupation.slice(0, atIdx).trim() || null;
    company = occupation.slice(atIdx + 4).trim() || null;
  }

  return {
    connection_id: randomUUID(),
    platform: "linkedin",
    owner_id: owner.ownerId,
    owner_account_id: owner.id,
    owner_username: owner.username,
    platform_user_id: profile.objectUrn ?? profile.entityUrn ?? slug,
    username: slug,
    full_name: `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim(),
    first_name: profile.firstName ?? null,
    last_name: profile.lastName ?? null,
    profile_url: slug ? `https://www.linkedin.com/in/${slug}` : "",
    avatar_url: avatar,
    bio: null,
    follower_count: null,
    following_count: null,
    is_verified: false,
    connection_type: "connection",
    connected_at: new Date(connectedAt).toISOString(),
    connection_degree: 1,
    dnc_contact_id: null,
    work_email: null,
    current_title: title,
    current_company: company,
    company_domain: null,
    is_dnc: false,
    dnc_reason: null,
    dnc_added_at: null,
    raw_platform_data: { profile } as Record<string, unknown>,
    synced_at: now,
    created_at: now,
    updated_at: now,
  };
}

// ─── Incremental poll (called every 60s) ─────────────────────────────────────

export async function pollLinkedIn(
  cache: PlatformCache,
  bq: DncBigQueryWriter,
): Promise<SyncResult> {
  const liAt = process.env.LINKEDIN_LI_AT!;
  const jsession = process.env.LINKEDIN_JSESSIONID!;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const errors: string[] = [];

  try {
    const headers = makeHeaders(liAt, jsession);

    // Only fetch connections newer than our cursor — stops at the first page
    // that's all older, so we're not re-scraping all 500+ connections every minute
    const { connections } = await fetchRecentConnections(
      headers,
      cache.lastConnectedAt,
    );

    const newRows = connections
      .filter(
        (c) =>
          !cache.knownIds.has(c.profile.objectUrn ?? c.profile.entityUrn ?? ""),
      )
      .map((c) =>
        mapToRow(c.profile, c.connectedAt, {
          ownerId: cache.ownerId,
          id: cache.ownerAccountId,
          username: cache.ownerUsername,
        }),
      );

    const inserted = await bq.insertNewRows(newRows, cache);
    cache.lastPollAt = new Date().toISOString();

    const result: SyncResult = {
      platform: "linkedin",
      fetched: connections.length,
      inserted,
      updated: 0,
      skipped: connections.length - inserted,
      errors,
      durationMs: Date.now() - t0,
      status: "success",
    };

    if (inserted > 0) {
      console.log(
        `[LinkedIn] 🔗 ${inserted} new connection(s) — ${newRows.map((r) => r.full_name).join(", ")}`,
      );
      await bq.writeSyncLog({ ...result, startedAt, syncType: "incremental" });
    }

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    console.error("[LinkedIn] Poll error:", msg);
    const result: SyncResult = {
      platform: "linkedin",
      fetched: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors,
      durationMs: Date.now() - t0,
      status: "failed",
    };
    await bq
      .writeSyncLog({ ...result, startedAt, syncType: "incremental" })
      .catch(() => {});
    return result;
  }
}

// ─── Full sync (called once at startup to warm the cache) ────────────────────

export async function fullSyncLinkedIn(
  ownerId: string,
  bq: DncBigQueryWriter,
): Promise<{ cache: PlatformCache; result: SyncResult }> {
  if (!ownerId) throw new Error("fullSyncLinkedIn: ownerId is required");

  const liAt = process.env.LINKEDIN_LI_AT!;
  const jsession = process.env.LINKEDIN_JSESSIONID!;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const platformOwner = await fetchLinkedInOwner(liAt, jsession);
  console.log(
    `[LinkedIn] Full sync — tenant ${ownerId}, owner: ${platformOwner.username} (${platformOwner.id})`,
  );

  // Warm cache from BQ — scoped to this tenant
  const cache = await bq.warmCache(
    "linkedin",
    ownerId,
    platformOwner.id,
    platformOwner.username,
  );
  console.log(
    `[LinkedIn] Cache warmed — ${cache.knownIds.size} known connections`,
  );

  const headers = makeHeaders(liAt, jsession);
  // Full scan — no cursor, fetch everything
  const { connections } = await fetchRecentConnections(headers, null, 999);
  console.log(`[LinkedIn] Full scan fetched ${connections.length} connections`);

  const newRows = connections
    .filter(
      (c) =>
        !cache.knownIds.has(c.profile.objectUrn ?? c.profile.entityUrn ?? ""),
    )
    .map((c) =>
      mapToRow(c.profile, c.connectedAt, {
        ownerId,
        id: platformOwner.id,
        username: platformOwner.username,
      }),
    );

  const inserted = await bq.insertNewRows(newRows, cache);
  cache.lastPollAt = new Date().toISOString();

  const result: SyncResult = {
    platform: "linkedin",
    fetched: connections.length,
    inserted,
    updated: 0,
    skipped: connections.length - inserted,
    errors: [],
    durationMs: Date.now() - t0,
    status: "success",
  };

  await bq.writeSyncLog({ ...result, startedAt, syncType: "full" });
  console.log(
    `[LinkedIn] Full sync done — ${inserted} new, ${cache.knownIds.size} total known`,
  );
  return { cache, result };
}
