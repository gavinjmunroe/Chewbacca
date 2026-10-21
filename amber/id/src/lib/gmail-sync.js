/**
 * READING WHO YOU WRITE TO, AND NOTHING ELSE.
 *
 * Amber has always known who you meet: calendar attendees resolve through the
 * identity resolver and land on contacts. This is the other half of the same
 * signal, and the reason the Google consent screen has asked for gmail scope
 * since it was built.
 *
 * NO BODY IS EVER FETCHED. Every read here is `format=metadata` with an
 * explicit `metadataHeaders` list. That is a different API response shape from
 * the one carrying content, so a bug in this file cannot persist an email body:
 * the bytes never came over the wire. Content analysis, when somebody switches
 * it on per mailbox, is a separate path that writes facts into observations.
 *
 * WHY messages.list AND NOT users.history. The history API is the efficient
 * incremental read and it is also the one that fails: a historyId older than
 * roughly a week is rejected outright, and the only recovery is a full re-list.
 * That makes it a cursor that silently expires whenever a sync is paused, a
 * deploy takes an hour, or somebody's token goes stale over a holiday. A date
 * query is a few more requests and cannot expire, and the message-level dedupe
 * on Message-ID makes re-reading an overlapping window free.
 *
 * A FIRST SYNC IS BOUNDED. Somebody with a decade of Gmail has hundreds of
 * thousands of messages, and reading all of them on connect would take hours
 * and blow through the API quota. The first run reaches back BACKFILL_DAYS and
 * stops after MAX_MESSAGES_PER_RUN, recording how far it got, so the next run
 * resumes rather than starting again.
 */

import { accessTokenFor } from "./calendar-sync.js";
import { messageFromHeaders } from "./gmail-headers.js";
import {
  recordEmailMessages,
  getMailSyncState,
  saveMailSyncState,
} from "../db/email-interactions.js";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Headers worth asking for. Everything else is content or routing noise. */
const HEADERS = ["From", "To", "Cc", "Date", "Message-ID", "List-Unsubscribe", "List-Id", "Precedence", "Auto-Submitted"];

/** How far back a first sync reaches. A year covers the relationships that are live. */
export const BACKFILL_DAYS = 365;

/**
 * The ceiling on one run. Gmail allows 250 quota units per second per user and
 * a metadata get costs 5, so this is minutes of work, not hours, and it leaves
 * headroom for everything else the account does.
 */
export const MAX_MESSAGES_PER_RUN = 2000;

/** Gmail's list endpoint caps at 500 and defaults to 100. */
const PAGE_SIZE = 250;

/** Concurrent metadata gets. Enough to be quick, low enough not to be throttled. */
const FETCH_CONCURRENCY = 8;

const day = (d) =>
  `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;

/**
 * Sync one connected Google account.
 *
 * `deps` exists so this is testable without Gmail: inject fetchImpl and the two
 * store functions and the whole thing runs against fixtures.
 */
export async function syncMailAccount(account, deps = {}) {
  const {
    fetchImpl = fetch,
    record = recordEmailMessages,
    readState = getMailSyncState,
    saveState = saveMailSyncState,
    ownAddresses = [],
    now = () => Date.now(),
    maxMessages = MAX_MESSAGES_PER_RUN,
  } = deps;

  if (!account?.id || !account?.owner_id) {
    return { ok: false, reason: "invalid_account" };
  }
  if (account.provider !== "google") {
    // Outlook mail is the same idea against Graph, and is not built yet. Saying
    // so is better than a silent no-op that looks like an empty mailbox.
    return { ok: false, reason: "provider_unsupported", provider: account.provider };
  }

  const token = await accessTokenFor(account, fetchImpl).catch(() => null);
  if (!token) {
    await saveState(account.owner_id, account.id, { error: "token_refresh_failed" }).catch(() => {});
    return { ok: false, reason: "token_refresh_failed" };
  }

  const state = await readState(account.owner_id, account.id).catch(() => null);

  // Where to start. A first run reaches back a year. A later run re-reads from
  // slightly before the last sync, because a message can arrive with a Date
  // header a little behind the clock, and re-reading is free.
  const OVERLAP_MS = 2 * 86400_000;
  const since = state?.last_synced_at
    ? new Date(new Date(state.last_synced_at).getTime() - OVERLAP_MS)
    : new Date(now() - BACKFILL_DAYS * 86400_000);

  // -in:chats keeps Google Chat transcripts out; they are not email and they
  // arrive with participant headers that would inflate everything.
  const q = `after:${day(since)} -in:chats`;

  const ids = [];
  let pageToken = null;
  try {
    do {
      const url =
        `${GMAIL}/messages?maxResults=${PAGE_SIZE}&q=${encodeURIComponent(q)}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
      const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const reason = res.status === 403 ? "scope_or_quota" : `list_http_${res.status}`;
        await saveState(account.owner_id, account.id, { error: reason }).catch(() => {});
        return { ok: false, reason, status: res.status };
      }
      const json = await res.json().catch(() => null);
      for (const m of json?.messages ?? []) {
        if (m?.id) ids.push(m.id);
      }
      pageToken = json?.nextPageToken ?? null;
    } while (pageToken && ids.length < maxMessages);
  } catch (err) {
    await saveState(account.owner_id, account.id, { error: String(err?.message || err) }).catch(() => {});
    return { ok: false, reason: "list_failed", error: String(err?.message || err) };
  }

  const wanted = ids.slice(0, maxMessages);
  const parsed = [];
  let failed = 0;

  // Bounded concurrency rather than Promise.all over two thousand ids, which
  // would open two thousand sockets and earn a 429 for it.
  for (let i = 0; i < wanted.length; i += FETCH_CONCURRENCY) {
    const batch = wanted.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (id) => {
        const url =
          `${GMAIL}/messages/${encodeURIComponent(id)}?format=metadata&` +
          HEADERS.map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join("&");
        try {
          const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      }),
    );
    for (const raw of results) {
      if (!raw) {
        failed += 1;
        continue;
      }
      const headers = {};
      for (const h of raw?.payload?.headers ?? []) {
        if (h?.name) headers[h.name] = h.value;
      }
      // Gmail's own thread id, which groups a conversation better than the
      // References chain and costs nothing since it is on the message already.
      if (raw?.threadId) headers["X-GM-THRID"] = raw.threadId;
      const message = messageFromHeaders(headers, {
        ownAddresses,
        accountId: account.id,
      });
      if (message) parsed.push(message);
    }
  }

  const written = await record(account.owner_id, parsed, { accountId: account.id }).catch((err) => {
    console.error(`GMAIL_RECORD_FAILED owner=${account.owner_id} ${err?.message || err}`);
    return null;
  });
  if (!written) {
    await saveState(account.owner_id, account.id, { error: "write_failed" }).catch(() => {});
    return { ok: false, reason: "write_failed" };
  }

  await saveState(account.owner_id, account.id, {
    backfilledTo: since.toISOString(),
    error: null,
  }).catch(() => {});

  return {
    ok: true,
    listed: ids.length,
    read: wanted.length,
    // Listed but not counted: newsletters, robots, mass CCs, notes to self.
    // Worth reporting rather than hiding, because "we read 2000 and kept 300"
    // is the number that tells somebody the filters are working.
    counted: parsed.length,
    fetchFailed: failed,
    ...written,
    // True when the run hit its ceiling, so a scheduler knows to come straight
    // back rather than waiting for the next interval.
    more: ids.length >= maxMessages,
  };
}

/**
 * Sync every connected Google account for one owner, in sequence.
 *
 * SEQUENCE, NOT PARALLEL, and for the same reason the bulk contact import is
 * sequential: two mailboxes routinely hold the same thread, and resolving both
 * at once means both see an address as unknown and both create a card for it.
 * In order, the second finds the first.
 *
 * Every account's own address is passed as an owner address to all of them, so
 * mail between the person's own two mailboxes is recognized as a note to self
 * rather than as a relationship with themselves.
 */
export async function syncOwnerMail(ownerId, accounts, deps = {}) {
  const google = (accounts ?? []).filter((a) => a?.provider === "google" && a?.refresh_token);
  const ownAddresses = google.map((a) => a.account_email).filter(Boolean);

  const results = [];
  for (const account of google) {
    // One bad mailbox must not stop the others: a revoked token on a work
    // account is not a reason to stop reading the personal one.
    const r = await syncMailAccount(account, { ...deps, ownAddresses }).catch((err) => ({
      ok: false,
      reason: "threw",
      error: String(err?.message || err),
    }));
    results.push({ accountId: account.id, email: account.account_email, ...r });
  }
  return { owner: ownerId, accounts: results };
}
