/**
 * WHAT AMBER KNOWS IS ON A DAY.
 *
 *   GET /v1/me/agenda?from=<iso>&to=<iso> → { events: [...], reminders: [...] }
 *
 * TWO INSTANTS, NOT A DATE, and the client sends them. A "day" is a timezone
 * question and the server does not know where the person is standing; a server
 * that guesses shows somebody the wrong day the moment they travel. The client
 * knows exactly when its Tuesday starts and ends, so it says so.
 *
 * NOT /v1/me/events. That path is already taken by the agent-facing event
 * memory in routes/events.js, which reads a completely different store, and two
 * unrelated things behind one prefix is how somebody later wires the wrong one.
 *
 * THE DEVICE CALENDAR IS NOT HERE. Real meetings with real locations and real
 * conference links live on the phone, and only the phone can read them. This
 * returns the half Amber itself holds -- events captured from what somebody
 * said, and reminders that have a time -- and the client merges the two. The
 * merge is a pure function in lib/agenda.ts so it can be tested without a
 * calendar or a database.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone as defaultResolveAmberIdByPhone } from "../db/store.js";
import { listAgendaEvents, listScheduledReminders } from "../db/agenda.js";

/** A window wider than this is a mistake, not a request. */
const MAX_DAYS = 62;

export function registerAgendaRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmberIdByPhone = deps.resolveAmberIdByPhone || defaultResolveAmberIdByPhone;
  const events = deps.listAgendaEvents || listAgendaEvents;
  const reminders = deps.listScheduledReminders || listScheduledReminders;

  app.get("/v1/me/agenda", { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.privyUser?.userId) {
      return reply.code(401).send({ error: "no_user", message: "Auth required" });
    }
    const phone = request.privyUser?.phone;
    if (!phone) {
      return reply
        .code(400)
        .send({ error: "no_phone_on_session", message: "Session carries no phone." });
    }
    const ownerId = await resolveAmberIdByPhone(phone).catch(() => null);
    if (!ownerId) {
      return reply
        .code(400)
        .send({ error: "could_not_resolve_owner", message: "Could not resolve owner." });
    }

    const from = new Date(String(request.query?.from ?? ""));
    const to = new Date(String(request.query?.to ?? ""));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      return reply
        .code(400)
        .send({ error: "bad_window", message: "from and to must be ISO instants, from before to." });
    }
    if (to - from > MAX_DAYS * 86400_000) {
      return reply
        .code(400)
        .send({ error: "window_too_wide", message: `At most ${MAX_DAYS} days at a time.` });
    }

    /**
     * OPEN REMINDERS FROM BEFORE TODAY COME WITH THE DAY THAT CONTAINS NOW.
     *
     *   "Reminders that should persist across days are anything with an open tag
     *    that didn't get completed."
     *
     * DECIDED HERE RATHER THAN BY THE CLIENT, and not because the client could
     * not work it out. It could -- but then two places would hold the rule, and
     * the one on the phone would be a flag the server has to trust. A client
     * that sends carryOverdue=1 for every day it renders turns the whole
     * calendar into a to-do list, and nothing on the server would stop it.
     *
     * "The window that contains now" is exactly the day you can still act on.
     * Yesterday is over and the pile does not belong there; tomorrow has not
     * happened and a thing that is already late does not belong on it either.
     */
    const now = Date.now();
    const includeOverdue = from.getTime() <= now && now < to.getTime();

    const window = { from: from.toISOString(), to: to.toISOString() };
    /**
     * DEGRADES PER SOURCE. A day view missing its reminders is worse than a day
     * view; a day view that 500s because one of two queries failed is not a day
     * view at all. Both stores already swallow their own errors and return [];
     * this settles them in parallel so one slow source does not serialize with
     * the other.
     */
    const [evs, rems] = await Promise.all([
      events(ownerId, window).catch(() => []),
      reminders(ownerId, { ...window, includeOverdue }).catch(() => []),
    ]);
    return { events: evs, reminders: rems, window };
  });
}
