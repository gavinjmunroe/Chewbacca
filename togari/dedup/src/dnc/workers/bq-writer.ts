/**
 * BigQuery writer for togari_dnc.social_connections.
 *
 * Streaming inserts for new rows (latency ~1s).
 * In-memory cache (CacheMap) means BQ is only queried once at startup per platform,
 * not on every 60-second poll cycle.
 * Pub/Sub event fires instantly after every successful insert.
 */

import { BigQuery } from "@google-cloud/bigquery";
import { randomUUID } from "crypto";
import type {
  SocialConnectionRow,
  SyncResult,
  Platform,
  PlatformCache,
  CacheMap,
} from "../types/index.js";
import { publishNewConnections } from "./event-publisher.js";

const PROJECT_ID = process.env.GCP_PROJECT_ID ?? "midyear-glazing-485303-u3";
const DATASET = "togari_dnc";
const CONN_TABLE = "social_connections";
const SYNC_TABLE = "sync_log";

function makeBQ(): BigQuery {
  const opts: ConstructorParameters<typeof BigQuery>[0] = {
    projectId: PROJECT_ID,
  };
  const b64 = process.env.GCP_CREDENTIALS_BASE64;
  if (b64) opts.credentials = JSON.parse(Buffer.from(b64, "base64").toString());
  return new BigQuery(opts);
}

export class DncBigQueryWriter {
  private bq = makeBQ();

  /**
   * Warm the in-memory cache for a platform from BQ.
   * Called once at startup — subsequent polls use the cache.
   *
   * `ownerId` is the Togari/Auth0 tenant key — every row read from BQ must
   * belong to this owner. `ownerAccountId` is the platform-side account id
   * (e.g. Kevin's LinkedIn user id) which we keep alongside for diffing.
   */
  async warmCache(
    platform: Platform,
    ownerId: string,
    ownerAccountId: string,
    ownerUsername: string,
  ): Promise<PlatformCache> {
    if (!ownerId) throw new Error("warmCache: ownerId is required");

    const [rows] = await this.bq.query({
      query: `
        SELECT platform_user_id, connected_at
        FROM \`${PROJECT_ID}.${DATASET}.${CONN_TABLE}\`
        WHERE platform = @platform
          AND owner_id = @owner_id
          AND owner_account_id = @owner_account_id
      `,
      params: { platform, owner_id: ownerId, owner_account_id: ownerAccountId },
      types: {
        platform: "STRING",
        owner_id: "STRING",
        owner_account_id: "STRING",
      },
      useLegacySql: false,
    });

    const typedRows = rows as {
      platform_user_id: string;
      connected_at: { value: string } | null;
    }[];
    const knownIds = new Set(typedRows.map((r) => r.platform_user_id));

    // Find the newest connected_at to use as a diff cursor
    let lastConnectedAt: number | null = null;
    for (const row of typedRows) {
      const ts = row.connected_at?.value
        ? new Date(row.connected_at.value).getTime()
        : null;
      if (ts && (!lastConnectedAt || ts > lastConnectedAt))
        lastConnectedAt = ts;
    }

    return {
      ownerId,
      ownerAccountId,
      ownerUsername,
      knownIds,
      lastPollAt: null,
      lastConnectedAt,
      followerCount: null,
    };
  }

  /**
   * Insert new rows into BQ, update the cache, fire Pub/Sub events.
   * Returns count of actually inserted rows.
   */
  async insertNewRows(
    rows: SocialConnectionRow[],
    cache: PlatformCache,
  ): Promise<number> {
    if (rows.length === 0) return 0;

    // Tenant guard: every row's owner_id must match the cache's owner_id.
    // Wiring mistakes would otherwise let a row from owner A land in owner B's
    // cache via insertion path; reject at the boundary.
    const wrongOwner = rows.find((r) => r.owner_id !== cache.ownerId);
    if (wrongOwner) {
      throw new Error(
        `insertNewRows: row owner_id=${wrongOwner.owner_id} does not match cache owner_id=${cache.ownerId}`,
      );
    }

    // Filter out anything already in cache (belt-and-suspenders)
    const truly_new = rows.filter(
      (r) => !cache.knownIds.has(r.platform_user_id),
    );
    if (truly_new.length === 0) return 0;

    const table = this.bq.dataset(DATASET).table(CONN_TABLE);

    // BQ streaming insert in batches of 500
    for (let i = 0; i < truly_new.length; i += 500) {
      await table.insert(truly_new.slice(i, i + 500), {
        skipInvalidRows: false,
        ignoreUnknownValues: false,
      });
    }

    // Update in-memory cache immediately
    for (const row of truly_new) {
      cache.knownIds.add(row.platform_user_id);
      const ts = new Date(row.connected_at).getTime();
      if (!cache.lastConnectedAt || ts > cache.lastConnectedAt) {
        cache.lastConnectedAt = ts;
      }
    }

    // Fire Pub/Sub events — fire-and-forget
    publishNewConnections(truly_new).catch((err) => {
      process.stderr.write(`[DNC BQ] Pub/Sub publish failed: ${err.message}\n`);
    });

    return truly_new.length;
  }

  /** Write a sync run summary to sync_log. */
  async writeSyncLog(
    result: SyncResult & { startedAt: string; syncType?: string },
  ): Promise<void> {
    const table = this.bq.dataset(DATASET).table(SYNC_TABLE);
    await table.insert([
      {
        sync_id: randomUUID(),
        platform: result.platform,
        sync_type: result.syncType ?? "incremental",
        connections_fetched: result.fetched,
        connections_new: result.inserted,
        connections_updated: result.updated,
        errors: result.errors.length,
        error_messages: result.errors,
        duration_ms: result.durationMs,
        status: result.status,
        started_at: result.startedAt,
        completed_at: new Date().toISOString(),
      },
    ]);
  }
}
