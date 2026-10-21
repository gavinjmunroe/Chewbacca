/**
 * THE CALENDAR, VISIBLE AT LAST.
 *
 *   GET  /v1/org/calendar        the calendars you have connected, and what is on them
 *   POST /v1/org/calendar/sync   pull them again, and feed the graph
 *
 * WHY THIS WAS MISSING AND WHY THAT MATTERED. A calendar was connected once,
 * during onboarding, and then existed nowhere: the whole network was built
 * out of it and there was no screen that would admit it had happened. People
 * reasonably concluded the sync had failed -- they had no way to tell the
 * difference between "connected and working" and "never connected", and the
 * product kept asking them to connect again.
 *
 * SEVERAL CALENDARS, WHICH IS THE NORMAL CASE. A work Google, a personal
 * Google, an Outlook from the company somebody still advises. The accounts
 * table has always been per-account with its own token and its own sync
 * cursor; what was missing was anywhere to see the rows or add a second one.
 *
 * SYNC IS A POST SOMEBODY ASKS FOR, never something a render does: it is a
 * token refresh and a calendar read per account, against somebody else's
 * rate limit. And it does the SECOND half too -- bridging what it read into
 * the company's graph -- because a sync that updates a private event store
 * and leaves the network unchanged is the exact failure that made people
 * think the calendar had not worked.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { makeResolveActor, requireOrgMember } from "../lib/resolve-actor.js";
import { openTenantScope } from "../db/tenant.js";
import { query } from "../db/sql.js";
import {
  listCalendarAccounts,
  readSyncableAccounts,
  disconnectCalendarAccount,
} from "../db/calendar-accounts.js";
import { syncCalendarAccount } from "../lib/calendar-sync.js";
import { bridgeMember } from "../db/org-memory-bridge.js";

const org = (request) => request.actor.orgId;
const who = (request) => request.actor.amberId;

/**
 * What is on them, around today.
 *
 * BOTH DIRECTIONS FROM NOW, because the two questions people have about a
 * calendar are "what is coming" and "who did I just see", and a list that
 * answers only one of them sends them back to Google for the other.
 */
async function readEvents(ownerId, { days = 30, limit = 200 } = {}) {
  /*
   * ONE ROW PER EVENT, EVEN WHEN TWO CALENDARS CARRY IT.
   *
   * The events table is unique on (calendar_account_id, external_id), which
   * is right -- disconnecting one account has to take its own events and
   * leave the others. But somebody with a work Google and a personal Google
   * that both have the standup gets two rows for one standup, and a list
   * that shows both looks like a sync run too many times.
   *
   * DISTINCT ON the provider's id, falling back to the row's own id for
   * anything typed in by hand, which is genuinely its own event. The copy
   * kept is the one from the account connected first, so the choice is
   * stable between loads rather than flipping with the planner.
   */
  const { rows } = await query(
    `SELECT DISTINCT ON (COALESCE(external_id, event_id::text))
            event_id, title, starts_at, ends_at, all_day, place, kind,
            attendees, organizer, calendar_account_id
       FROM events
      WHERE owner_id = $1::uuid
        AND deleted_at IS NULL
        AND starts_at BETWEEN now() - ($2 || ' days')::interval
                          AND now() + ($2 || ' days')::interval
      ORDER BY COALESCE(external_id, event_id::text), starts_at ASC
      LIMIT $3`,
    [ownerId, String(Math.min(Number(days) || 30, 365)), Math.min(Number(limit) || 200, 500)],
  );
  /* DISTINCT ON forces its own ORDER BY, so the chronological sort the
     screen needs is done here rather than fought with in SQL. */
  return rows.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

export function registerOrgCalendarRoutes(
  app,
  { requireAuth = defaultRequireAuth, resolveActor = makeResolveActor() } = {},
) {
  const asMember = {
    preHandler: [requireAuth, resolveActor, requireOrgMember, openTenantScope],
  };

  app.get("/v1/org/calendar", asMember, async (request) => {
    const amberId = who(request);
    const [accounts, rows] = await Promise.all([
      listCalendarAccounts(amberId).catch(() => null),
      readEvents(amberId, { days: Number(request.query?.days) || 30 }).catch(() => []),
    ]);

    const now = Date.now();
    const upcoming = [];
    const past = [];
    for (const r of rows) {
      (new Date(r.starts_at).getTime() >= now ? upcoming : past).push(r);
    }
    // Most recent first looking backwards; soonest first looking forwards.
    past.reverse();

    return {
      /*
       * null is "we could not read them", which is NOT the same answer as
       * "you have connected none" -- and the screen would offer to connect
       * a calendar somebody already has if the two were merged.
       */
      accounts: accounts ?? null,
      upcoming,
      past,
    };
  });

  app.post("/v1/org/calendar/sync", asMember, async (request) => {
    const orgId = org(request);
    const amberId = who(request);

    const accounts = await readSyncableAccounts(amberId);
    if (accounts.length === 0) return { ok: true, calendars: 0, events: 0, synced: [] };

    const synced = [];
    for (const a of accounts) {
      const out = await syncCalendarAccount(
        a,
        {},
        { pastDays: 1095, futureDays: 120, maxEvents: 20000 },
      ).catch((err) => ({ written: 0, error: String(err?.message ?? err) }));
      synced.push({
        account: a.account_email,
        provider: a.provider,
        events: out.written ?? 0,
        error: out.error ?? null,
      });
    }

    /*
     * AND INTO THE GRAPH. A sync that fills a private event store and
     * leaves the network untouched is indistinguishable, from the outside,
     * from a sync that did nothing -- which is precisely the report this
     * route exists to answer.
     */
    const bridged = await bridgeMember({ orgId, amberId, limit: 20000 }).catch(() => ({
      written: 0,
    }));

    return {
      ok: true,
      calendars: accounts.length,
      events: synced.reduce((n, s) => n + s.events, 0),
      intoTheGraph: bridged.written ?? 0,
      synced,
    };
  });

  app.delete("/v1/org/calendar/:accountId", asMember, async (request, reply) => {
    const ok = await disconnectCalendarAccount(who(request), request.params.accountId);
    /* Yours to disconnect or it does not exist, and from here those are the
       same answer. */
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });
}
