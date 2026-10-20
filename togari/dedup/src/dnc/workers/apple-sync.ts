/**
 * Apple Contacts sync — CardDAV poller.
 *
 * Apple does not give us webhooks for contact changes, so we poll. The default
 * cadence is 5 minutes (contacts change rarely compared to LinkedIn connections,
 * and iCloud is rate-sensitive).
 *
 * On each poll:
 *   1. Load creds from Secret Manager (by userId)
 *   2. PROPFIND/REPORT the user's default addressbook
 *   3. For each vCard, parse it and diff against the in-memory cache
 *   4. Insert new rows into togari_dnc.social_connections (platform='apple')
 *   5. Update the cache and fire Pub/Sub events
 *
 * The platform_user_id is the vCard UID — that's Apple's stable identifier for
 * a contact across edits and devices. ETag changes when the contact is updated
 * server-side, which lets a future refinement detect updates vs. new rows.
 */

import { randomUUID } from "crypto";
import { DncBigQueryWriter } from "./bq-writer.js";
import {
  listContacts,
  findDefaultAddressBook,
} from "../integrations/carddav.js";
import { parseVCard } from "../integrations/vcard.js";
import { getAppleCredentials } from "../auth/apple-credentials.js";
import type {
  SocialConnectionRow,
  SyncResult,
  PlatformCache,
} from "../types/index.js";

const POLL_INTERVAL_MS = Number(
  process.env.APPLE_SYNC_INTERVAL_MS ?? 5 * 60_000,
);

// ─── Row mapping ─────────────────────────────────────────────────────────────

function vcardToRow(
  uid: string,
  parsed: ReturnType<typeof parseVCard>,
  ownerAccountId: string,
  ownerUsername: string,
  rawVcard: string,
): SocialConnectionRow {
  const now = new Date().toISOString();
  const email = parsed.emails[0] ?? null;
  const phone = parsed.phones[0] ?? null;
  const companyDomain =
    email && email.includes("@") ? email.split("@")[1] : null;

  return {
    connection_id: randomUUID(),
    platform: "apple",
    owner_account_id: ownerAccountId,
    owner_username: ownerUsername,
    platform_user_id: uid,
    username: email ?? phone ?? uid,
    full_name: parsed.fullName ?? "",
    first_name: parsed.firstName,
    last_name: parsed.lastName,
    profile_url: "",
    avatar_url: null,
    bio: null,
    follower_count: null,
    following_count: null,
    is_verified: false,
    connection_type: "connection",
    connected_at: now,
    connection_degree: 1,
    dnc_contact_id: null,
    work_email: email,
    current_title: parsed.title,
    current_company: parsed.org,
    company_domain: companyDomain,
    is_dnc: false,
    dnc_reason: null,
    dnc_added_at: null,
    raw_platform_data: {
      uid,
      emails: parsed.emails,
      phones: parsed.phones,
      urls: parsed.urls,
      vcard: rawVcard,
    },
    synced_at: now,
    created_at: now,
    updated_at: now,
  };
}

// ─── One-shot sync ───────────────────────────────────────────────────────────

/**
 * Pull every contact from a user's default iCloud addressbook and insert any
 * rows we have not seen before into BQ.
 *
 * Caller is responsible for cache lifecycle. Pass the cache from a prior call
 * (or a freshly warmed one from `bq.warmCache('apple', userId, username)`).
 *
 * Realness classification is NOT applied here. social_connections is the raw
 * platform firehose; classifyRealness runs at the dedup tier (matcher.create
 * and engine.run) so each canonical contact is scored exactly once instead of
 * on every per-platform row.
 */
export async function syncAppleContacts(
  userId: string,
  bq: DncBigQueryWriter,
  cache: PlatformCache,
): Promise<SyncResult> {
  const start = Date.now();
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  const creds = await getAppleCredentials(userId);
  if (!creds) {
    return {
      platform: "apple",
      fetched: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: [`No Apple credentials for ${userId}`],
      durationMs: Date.now() - start,
      status: "failed",
    };
  }

  let fetched = 0;
  let inserted = 0;
  let skipped = 0;

  try {
    const book = creds.default_addressbook_href
      ? { href: creds.default_addressbook_href, displayName: null }
      : await findDefaultAddressBook({
          username: creds.username,
          password: creds.password,
        });

    const contacts = await listContacts(
      { username: creds.username, password: creds.password },
      book.href,
    );
    fetched = contacts.length;

    const newRows: SocialConnectionRow[] = [];
    for (const c of contacts) {
      const parsed = parseVCard(c.vcard);
      const uid = parsed.uid ?? c.href;
      if (cache.knownIds.has(uid)) {
        skipped++;
        continue;
      }
      newRows.push(vcardToRow(uid, parsed, userId, creds.username, c.vcard));
    }

    if (newRows.length > 0) {
      inserted = await bq.insertNewRows(newRows, cache);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    process.stderr.write(`[AppleSync] ${userId}: ${msg}\n`);
  }

  const result: SyncResult = {
    platform: "apple",
    fetched,
    inserted,
    updated: 0,
    skipped,
    errors,
    durationMs: Date.now() - start,
    status:
      errors.length === 0 ? "success" : inserted > 0 ? "partial" : "failed",
  };

  try {
    await bq.writeSyncLog({ ...result, startedAt, syncType: "apple-poll" });
  } catch (err) {
    process.stderr.write(
      `[AppleSync] sync_log write failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return result;
}

// ─── Long-running poller ─────────────────────────────────────────────────────

const activePollers = new Map<string, NodeJS.Timeout>();

/**
 * Start a recurring poller for one user. Idempotent: calling twice for the
 * same userId is a no-op the second time.
 */
export async function startApplePoller(userId: string): Promise<void> {
  if (activePollers.has(userId)) return;

  const creds = await getAppleCredentials(userId);
  if (!creds) {
    console.warn(`[AppleSync] Cannot start poller — no creds for ${userId}`);
    return;
  }

  const bq = new DncBigQueryWriter();
  const cache = await bq.warmCache("apple", userId, creds.username);

  const tick = async () => {
    try {
      const result = await syncAppleContacts(userId, bq, cache);
      console.log(
        `[AppleSync] ${userId}: fetched=${result.fetched} inserted=${result.inserted} skipped=${result.skipped} errors=${result.errors.length}`,
      );
    } catch (err) {
      process.stderr.write(
        `[AppleSync] poll error for ${userId}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  };

  tick();
  const handle = setInterval(tick, POLL_INTERVAL_MS);
  activePollers.set(userId, handle);
  console.log(
    `[AppleSync] Started poller for ${userId} (interval ${POLL_INTERVAL_MS}ms)`,
  );
}

/** Stop the recurring poller for one user. */
export function stopApplePoller(userId: string): void {
  const handle = activePollers.get(userId);
  if (handle) {
    clearInterval(handle);
    activePollers.delete(userId);
    console.log(`[AppleSync] Stopped poller for ${userId}`);
  }
}
