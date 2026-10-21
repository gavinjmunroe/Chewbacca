import { restoreGoogleCalendar } from "../lib/calendar-repair.js";
/**
 * CONNECTED CALENDARS.
 *
 *   GET    /v1/me/calendars            → { accounts }
 *   POST   /v1/me/calendars/sync       → { results }
 *   DELETE /v1/me/calendars/:id        → { disconnected: true }
 *
 * CONNECTING IS NOT HERE. It is an OAuth round trip and it already exists:
 * /v1/oauth/google/init and /v1/oauth/microsoft/init, both of which already ask
 * for the calendar scope (GOOGLE_SCOPES has the full calendar scope, and
 * MICROSOFT_SCOPES has Calendars.ReadWrite). Their callbacks now also write a
 * calendar_accounts row, which is what turns one grant into one of several
 * accounts rather than the single slot the secrets bag could hold.
 *
 * NO TOKENS EVER LEAVE HERE. The list is what a settings screen renders --
 * provider, address, when it last synced, and whether it is broken. A refresh
 * token has no business on a phone that has no use for it.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone as defaultResolveAmberIdByPhone } from "../db/store.js";
import {
  disconnectCalendarAccount,
  listCalendarAccounts,
  readSyncableAccounts,
} from "../db/calendar-accounts.js";
import { syncAllCalendars } from "../lib/calendar-sync.js";

export function registerCalendarRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmberIdByPhone =
    deps.resolveAmberIdByPhone || defaultResolveAmberIdByPhone;
  const list = deps.listCalendarAccounts || listCalendarAccounts;
  const readSyncable = deps.readSyncableAccounts || readSyncableAccounts;
  const disconnect =
    deps.disconnectCalendarAccount || disconnectCalendarAccount;
  const syncAll = deps.syncAllCalendars || syncAllCalendars;
  const repair = deps.restoreGoogleCalendar || restoreGoogleCalendar;

  async function resolveOwner(request, reply) {
    if (!request.privyUser?.userId) {
      reply.code(401).send({ error: "no_user", message: "Auth required" });
      return null;
    }
    const phone = request.privyUser?.phone;
    if (!phone) {
      reply
        .code(400)
        .send({
          error: "no_phone_on_session",
          message: "Session carries no phone.",
        });
      return null;
    }
    const amberId = await resolveAmberIdByPhone(phone).catch(() => null);
    if (!amberId) {
      reply
        .code(400)
        .send({
          error: "could_not_resolve_owner",
          message: "Could not resolve owner.",
        });
      return null;
    }
    return amberId;
  }

  app.get(
    "/v1/me/calendars",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveOwner(request, reply);
      if (!me) return;
      const accounts = await list(me);
      if (accounts === null) {
        // An empty list is a real answer ("you have connected none") and a failed
        // read must not be mistaken for one -- the app would offer to connect a
        // calendar somebody already connected.
        return reply
          .code(503)
          .send({
            error: "calendars_unavailable",
            message: "Could not read your calendars.",
          });
      }
      return { accounts };
    },
  );

  /**
   * Sync now.
   *
   * WHAT THIS COSTS is why it is a POST somebody has to ask for rather than
   * something the list does on every open: it is one token refresh and one
   * calendar read per connected account, against somebody else's rate limit.
   * The app calls it on connect and on pull-to-refresh, not on render.
   */
  // Recovery is explicit, never part of refresh: disconnected accounts stay disconnected.
  app.post(
    "/v1/me/calendars/restore-google",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveOwner(request, reply);
      if (!me) return;
      try {
        return { restored: await repair(me) };
      } catch {
        return reply.code(503).send({ error: "calendar_setup_failed" });
      }
    },
  );

  app.post(
    "/v1/me/calendars/sync",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveOwner(request, reply);
      if (!me) return;
      const accounts = await readSyncable(me);
      if (accounts.length === 0) return { results: [], synced: 0 };
      const results = await syncAll(accounts);
      return {
        results,
        // What actually landed, so the client can say "42 events" rather than
        // "done" after a sync that silently wrote nothing.
        synced: results.reduce((n, r) => n + (r.written || 0), 0),
      };
    },
  );

  app.delete(
    "/v1/me/calendars/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveOwner(request, reply);
      if (!me) return;
      const ok = await disconnect(me, request.params?.id);
      if (!ok) {
        // Yours to disconnect or it does not exist, and from here those are the
        // same answer.
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such calendar." });
      }
      /**
       * THE EVENTS WENT WITH IT. events.calendar_account_id is ON DELETE CASCADE,
       * so the meetings that calendar brought are gone from the day view and from
       * the interaction stats they were feeding. Said in the response because
       * "disconnected" alone does not convey that somebody's history just changed.
       */
      return { disconnected: true, eventsRemoved: true };
    },
  );
}
