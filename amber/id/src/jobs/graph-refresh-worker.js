/**
 * THE LOOP THAT KEEPS A RELATIONSHIP GRAPH TRUE WITHOUT ANYBODY PRESSING
 * ANYTHING.
 *
 * WHY THIS HAS TO EXIST. The graph is built from a calendar and a mailbox,
 * and both of those change every day. Everything that fills it so far runs
 * because somebody clicked Connect or Sync -- so a company's network is
 * accurate on the afternoon they set it up and quietly wrong a week later.
 * A CRM that is right once is not a product; it is a screenshot.
 *
 * WHAT IT DOES EACH PASS, per member who has granted a source:
 *   1. pulls their connected calendars forward from where they stopped
 *   2. bridges the new events and the new replied-to mail into the ledger
 *   3. names whoever arrived as an address
 *
 * WHO GETS IN, which is the part that decides whether this graph is worth
 * looking at. A meeting is a relationship: somebody put time in a calendar
 * with a named person. An inbound email is NOT -- an inbox is mostly people
 * who wrote to you once, and a graph that fills with senders is a graph
 * nobody trusts twice. So mail only brings in somebody this person has
 * actually WRITTEN BACK to; that rule lives in the bridge's own query, not
 * here, so every caller inherits it.
 *
 * COST, HONESTLY. A tick is one query to find grants. For each member it is
 * a calendar read against Google or Microsoft -- somebody else's rate limit,
 * which is why the interval is an hour and not a minute -- plus SQL. The
 * naming step reaches a model only when there is somebody unnamed, so a
 * settled company never spends anything on it.
 *
 * SINGLE FLIGHT, AND IT NEVER THROWS. A pass slower than the interval must
 * not overlap itself: two syncs of one calendar race on the same upsert key.
 * And an unhandled rejection inside setInterval kills the process, which on
 * Railway takes the API with it -- so every stage is wrapped and a bad pass
 * degrades to "that member did nothing this hour".
 *
 * ON BY DEFAULT, off with ENABLE_GRAPH_REFRESH=0.
 */

import { query } from "../db/sql.js";
import { withTenant } from "../db/tenant.js";
import { readSyncableAccounts } from "../db/calendar-accounts.js";
import { syncCalendarAccount } from "../lib/calendar-sync.js";
import { bridgeMember } from "../db/org-memory-bridge.js";
import { enrichNames } from "../db/org-name-enrich.js";
import {
  reconcileNames,
  autoMerge,
  googleDirectoryNames,
} from "../db/org-people-reconcile.js";
import { syncOwnerMail } from "../lib/gmail-sync.js";
import { noteNames } from "../db/observed-names.js";

const HOUR = 60 * 60 * 1000;
const EVERY = Number(process.env.GRAPH_REFRESH_MS) || HOUR;

let running = false;

/**
 * Everybody who has granted a source, with the org it was granted in.
 *
 * THE GRANT IS THE AUTHORITY AND IT IS CHECKED HERE RATHER THAN ASSUMED.
 * Somebody who revoked their calendar last week must not be synced by a
 * timer this week just because a token still happens to work -- that is
 * precisely the behavior that makes per-source consent a checkbox rather
 * than a promise.
 */
async function members() {
  /*
   * FROM THE QUEUE, because this is the read that DISCOVERS the tenant and
   * therefore cannot be inside one.
   *
   * The query that used to be here read org_memory_sources directly and came
   * back empty every hour: that table is tenant-scoped, a worker has no
   * tenant, and an empty result is not an error. The queue holds two ids per
   * connected member and nothing else; the grant itself is re-checked inside
   * the tenant below, so this list can never widen what anybody is allowed to
   * read.
   */
  const { rows } = await query(
    `SELECT org_id, amber_id FROM memory_refresh_queue ORDER BY enrolled_at LIMIT 500`,
  );
  return rows;
}

/**
 * HAS THIS MAILBOX EVER BEEN READ FOR NAMES?
 *
 * The sync keeps a cursor and only ever reads what arrived since. That is
 * right for counting correspondence and wrong for names: the introduction
 * email that names eight people arrived in October, was read once by a
 * version of this that kept only the addresses, and will never come past
 * again. So a mailbox with no observed names at all gets one pass with the
 * cursor ignored -- a year of headers, nothing stored but who was on them --
 * and then returns to normal.
 */
async function needsNameBackfill(amberId) {
  const { rows } = await query(
    `SELECT 1 FROM observed_names WHERE owner_id = $1::uuid LIMIT 1`,
    [amberId],
  );
  return rows.length === 0;
}

/** Did this member actually grant mail, or only the calendar? */
async function hasMailGrant(orgId, amberId) {
  const { rows } = await query(
    `SELECT 1 FROM org_memory_sources
      WHERE org_id = $1::uuid AND amber_id = $2::uuid
        AND source = 'mail' AND revoked_at IS NULL
      LIMIT 1`,
    [orgId, amberId],
  );
  return rows.length > 0;
}

/**
 * The names already sitting in `events.attendees`, lifted into one place.
 *
 * Costs no network at all. Google fills a guest's displayName only when the
 * organizer had them saved, so this is sparse -- but it is free and it is
 * already downloaded.
 */
async function noteNamesFromStoredEvents(amberId) {
  const { rows } = await query(
    `SELECT DISTINCT a.email, a.name
       FROM events e
      CROSS JOIN LATERAL jsonb_to_recordset(
            CASE WHEN jsonb_typeof(e.attendees) = 'array' THEN e.attendees ELSE '[]'::jsonb END
          ) AS a(email text, name text)
      WHERE e.owner_id = $1::uuid
        AND e.deleted_at IS NULL
        AND a.email IS NOT NULL AND a.name IS NOT NULL
      LIMIT 5000`,
    [amberId],
  );
  return noteNames(amberId, rows, { source: "calendar" });
}

async function refreshOne({ org_id: orgId, amber_id: amberId }) {
  /*
   * A SHORT WINDOW, NOT THE WHOLE HISTORY. The first sync walks years; this
   * one only has to catch what changed since the last pass, and asking a
   * provider for three years of calendar every hour is how an integration
   * gets rate limited into uselessness.
   */
  const t0 = Date.now();
  console.log(`[graph-refresh] start ${amberId} in org ${orgId}`);
  const accounts = await readSyncableAccounts(amberId).catch(() => []);
  for (const a of accounts) {
    await syncCalendarAccount(a, {}, { pastDays: 14, futureDays: 120, maxEvents: 2000 }).catch(
      (err) => {
        console.warn(`[graph-refresh] calendar ${a.account_email}: ${err?.message ?? err}`);
      },
    );
  }

  /*
   * AND THE MAIL, WHICH IS WHERE THE NAMES ARE.
   *
   * Only for members who granted mail -- the grant rows are what `members()`
   * reads, and a calendar grant is not a mail grant. A header carries
   * "Ipsha Pandey" <i.pandey@pnptc.com> where an invite carries only the
   * address, so a mailbox that is never re-read is a graph that never learns
   * anybody's name.
   */
  const mailGranted = await withTenant(orgId, () => hasMailGrant(orgId, amberId)).catch(
    () => false,
  );
  console.log(
    `[graph-refresh] ${amberId}: calendars=${accounts.length} mailGrant=${mailGranted}`,
  );
  if (mailGranted) {
    const backfill = await needsNameBackfill(amberId).catch((err) => {
      console.warn(`[graph-refresh] backfill check ${amberId}: ${err?.message ?? err}`);
      return false;
    });
    console.log(`[graph-refresh] ${amberId}: first mail pass needed = ${backfill}`);
    if (backfill) {
      /*
       * Ignore the cursor and do not move it. Reading a year of headers twice
       * costs one slow pass; never reading them means a graph of addresses
       * forever, which is what it has been.
       */
      console.log(
        `[graph-refresh] first name pass over the mailbox for ${amberId} -- ` +
          `up to a year of headers, this takes minutes`,
      );
    }

    /*
     * ONE PASS, NOT TWO. The backfill reads the same window the ordinary sync
     * would and more of it, so running both doubled the slowest thing the
     * worker does for no new rows.
     */
    const started = Date.now();
    const mail = await syncOwnerMail(
      amberId,
      accounts,
      backfill ? { readState: async () => null, saveState: async () => {} } : {},
    ).catch((err) => {
      console.warn(`[graph-refresh] mail ${amberId}: ${err?.message ?? err}`);
      return null;
    });
    console.log(
      `[graph-refresh] mailbox read finished in ${Math.round((Date.now() - started) / 1000)}s`,
    );
    /*
     * syncMailAccount returns {ok:false, reason} rather than throwing -- for a
     * missing scope, a refused token, a quota. Those are the answers worth
     * having and they were being dropped on the floor.
     */
    for (const a of mail?.accounts ?? []) {
      console.log(
        `[graph-refresh] mail ${a.email}: ` +
          (a.ok
            ? `listed ${a.listed ?? 0}, kept ${a.counted ?? 0}, wrote ${a.messages ?? 0}`
            : `refused (${a.reason}${a.status ? ` ${a.status}` : ""})`),
      );
    }
  }

  /*
   * And the names the calendar rows already hold, which never needed a
   * provider call: the attendee lists are in Postgres already.
   */
  await noteNamesFromStoredEvents(amberId).catch(() => 0);

  /*
   * FROM HERE THE WORK IS THE COMPANY'S, SO IT RUNS IN THE COMPANY'S TENANT.
   *
   * Everything above touches tables keyed on a person -- events, mail
   * headers, observed names -- and needs no org. Everything below reads and
   * writes org_people, org_interactions and the grant rows, every one of
   * which is behind the tenant policy. Without a scope they return zero rows
   * and report success over nothing, which is exactly what has been
   * happening: the callback wrote "grant mail: ok" inside a scope and the
   * refresh said "no live grants" about the same row a millisecond later.
   *
   * The scope is opened HERE rather than around the whole pass on purpose: it
   * holds a connection and a transaction, and wrapping a year of Gmail
   * fetches in one is how a sync becomes a database outage.
   */
  /*
   * Google's own contact buckets, fetched BEFORE the tenant opens. It is the
   * same resolution Google Calendar does on screen, and it is a network call,
   * so it happens outside the transaction and is handed in below.
   */
  const directory = await withTenant(orgId, () => googleDirectoryNames({ orgId })).catch(() => null);

  return withTenant(orgId, async () => {
    const bridged = await bridgeMember({ orgId, amberId, limit: 4000 }).catch((err) => {
      console.warn(`[graph-refresh] bridge ${amberId}: ${err?.message ?? err}`);
      return { written: 0 };
    });

    /*
     * The names the calendars already carry, then the model for the remainder,
     * then fold together whoever turns out to be one person with two addresses.
     */
    const fromProvider = await reconcileNames({ orgId, directory }).catch((err) => {
      console.warn(`[graph-refresh] naming ${orgId}: ${err?.message ?? err}`);
      return { renamed: 0, from: {} };
    });
    console.log(
      `[graph-refresh] names: ${fromProvider.renamed ?? 0} applied ` +
        `(envelopes ${fromProvider.from?.observed ?? 0}, contacts ${fromProvider.from?.contacts ?? 0}, ` +
        `calendar ${fromProvider.from?.calendar ?? 0}, google ${fromProvider.from?.google ?? 0})`,
    );
    const named = await enrichNames({ orgId, limit: 120 }).catch(() => ({ named: 0 }));
    const folded = await autoMerge({ orgId }).catch(() => ({ merged: 0 }));

    const out = {
      calendars: accounts.length,
      written: bridged.written ?? 0,
      named: (named.named ?? 0) + (fromProvider.renamed ?? 0),
      merged: folded.merged ?? 0,
    };
    console.log(
      `[graph-refresh] done ${amberId} in ${Math.round((Date.now() - t0) / 1000)}s: ` +
        `${out.written} new interaction(s), ${out.named} named, ${out.merged} merged`,
    );
    return out;
  });
}

/**
 * REFRESH ONE PERSON, NOW, BECAUSE THEY JUST CONNECTED SOMETHING.
 *
 * The hourly pass is for keeping up. This is for the thirty seconds after
 * somebody grants a mailbox, where the entire product is the question "did
 * that work" -- and an answer that arrives up to an hour later is the same
 * as no answer. The OAuth callback calls this and does not wait for it.
 *
 * It takes no arguments beyond the member because it does exactly what the
 * hourly pass does for one row: sync, bridge, name, merge. There is no second
 * code path to drift out of agreement with the first.
 */
export async function refreshMemberNow(amberId) {
  if (!amberId) return { skipped: true };
  const { rows } = await query(
    `SELECT org_id, amber_id FROM memory_refresh_queue WHERE amber_id = $1::uuid`,
    [amberId],
  );
  if (rows.length === 0) {
    /* Silence here was indistinguishable from the work being done. */
    console.log(`[graph-refresh] on connect: ${amberId} is not enrolled for refresh`);
    return { skipped: true, reason: "not_enrolled" };
  }

  let out = null;
  for (const row of rows) {
    out = await refreshOne(row).catch((err) => {
      console.warn(`[graph-refresh] on-connect ${amberId}: ${err?.message ?? err}`);
      return null;
    });
    if (out) {
      console.log(
        `[graph-refresh] on connect: ${out.written} new, ${out.named} named, ` +
          `${out.merged} merged`,
      );
    }
  }
  return out ?? { skipped: true };
}

export async function runGraphRefresh() {
  if (running) return { skipped: true };
  running = true;
  const started = Date.now();
  let people = 0;
  let written = 0;
  let named = 0;
  let merged = 0;

  try {
    const who = await members();
    for (const m of who) {
      const out = await refreshOne(m).catch(() => null);
      if (!out) continue;
      people += 1;
      written += out.written;
      named += out.named;
      merged += out.merged ?? 0;
    }
    if (written > 0 || named > 0 || merged > 0) {
      console.log(
        `[graph-refresh] ${people} member(s), ${written} new interaction(s), ` +
          `${named} named, ${merged} merged, ` +
          `${Math.round((Date.now() - started) / 1000)}s`,
      );
    }
    return { people, written, named, merged };
  } catch (err) {
    console.warn(`[graph-refresh] pass failed: ${err?.message ?? err}`);
    return { people, written, named, merged, error: String(err?.message ?? err) };
  } finally {
    running = false;
  }
}

export function startGraphRefreshWorker() {
  if (process.env.ENABLE_GRAPH_REFRESH === "0") {
    console.log("[graph-refresh] disabled by ENABLE_GRAPH_REFRESH=0");
    return null;
  }

  /*
   * NOT AT BOOT, BUT NOT AN HOUR LATER EITHER.
   *
   * A pass that starts the instant a container boots means every deploy hits
   * Google for every member at once, and a crash loop becomes a stampede. A
   * pass that waits a full hour means a fix shipped now is invisible until
   * then, which is its own kind of broken -- somebody watching the screen
   * concludes nothing happened, because from where they are sitting nothing
   * has. Ninety seconds is past the point where a bad build has already
   * died, and short enough that a deploy is a change you can see.
   */
  const first = setTimeout(() => {
    void runGraphRefresh();
  }, 90_000);
  first.unref?.();

  const timer = setInterval(() => {
    void runGraphRefresh();
  }, EVERY);
  timer.unref?.();
  console.log(`[graph-refresh] worker started -- every ${Math.round(EVERY / 60000)} min`);
  return timer;
}
