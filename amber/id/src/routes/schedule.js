/**
 * THE OPEN REMINDERS, AND EDITING WHAT A SPOKEN PLAN BECAME.
 *
 *   GET    /v1/me/open-reminders?onDate=YYYY-MM-DD  -> { reminders: [...] }
 *   POST   /v1/me/open-reminders/:id/complete       -> tick off, for one day
 *   PATCH  /v1/me/open-reminders/:id                -> the editor
 *   DELETE /v1/me/open-reminders/:id
 *   PATCH  /v1/me/calendar-events/:id               -> the event editor
 *   DELETE /v1/me/calendar-events/:id
 *
 * WHY open-reminders AND NOT /v1/me/reminders/open. routes/reminders.js already
 * owns /v1/me/reminders/:id, and while Fastify does prefer a static segment over
 * a parametric one, a route whose correctness depends on knowing that is a route
 * somebody breaks by adding a second parametric handler. These are a different
 * list -- the untimed ones, the ones with no due_at -- so they get a name of
 * their own.
 *
 * WHY calendar-events AND NOT /v1/me/events/:id. This cost a production outage:
 * routes/events.js already owns /v1/me/events/:event_id, and Fastify matches on
 * the SHAPE of the path, not the name of the parameter -- so a second
 * `/v1/me/events/:id` is a duplicate route and throws FST_ERR_DUPLICATED_ROUTE
 * at boot. Nothing was shared but the word: those are Rave Master event CARDS in
 * agent-data, keyed `event:did:privy:...`; these are rows in the `events` table
 * keyed by uuid. Two different resources, and now two different names. The gate
 * that would have caught it is src/boot.test.js -- read the note there before
 * adding any route.
 *
 * onDate IS THE CLIENT'S LOCAL DATE, and it is required rather than defaulted.
 * A day is a timezone question and the server is not the one who knows the
 * answer; defaulting to the server's today would put a Sydney user's reminders
 * on the wrong day for most of their waking life. Every store call refuses an
 * unparseable date rather than falling back, for the same reason.
 */
import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import {
  listOpenReminders,
  setReminderDoneOn,
  updateReminderDetail,
  deleteReminder,
  createScheduledEvent,
  updateScheduledEvent,
  deleteScheduledEvent,
  REPEATS,
} from "../db/schedule-store.js";

import { createGoogleCalendarEvent } from "../lib/google-calendar-write.js";

const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };

export function registerScheduleRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmber = deps.resolveAmberIdByPhone || resolveAmberIdByPhone;
  const listOpen = deps.listOpenReminders || listOpenReminders;
  const setDone = deps.setReminderDoneOn || setReminderDoneOn;
  const patchReminder = deps.updateReminderDetail || updateReminderDetail;
  const dropReminder = deps.deleteReminder || deleteReminder;
  const makeEvent = deps.createScheduledEvent || createScheduledEvent;
  const patchEvent = deps.updateScheduledEvent || updateScheduledEvent;
  const dropEvent = deps.deleteScheduledEvent || deleteScheduledEvent;

  /**
   * Every route here needs the same three lines, and getting one of them wrong
   * is how a route ends up reading somebody else's data. One helper, and it
   * returns null having already sent the reply.
   */
  async function ownerFor(request, reply) {
    if (!request.privyUser?.userId) {
      reply.code(401).send({ error: "no_user", message: "Auth required" });
      return null;
    }
    const phone = request.privyUser?.phone;
    if (!phone) {
      reply.code(400).send({ error: "no_phone_on_session", message: "Session carries no phone." });
      return null;
    }
    const ownerId = await resolveAmber(phone).catch(() => null);
    if (!ownerId) {
      reply.code(400).send({ error: "could_not_resolve_owner", message: "Could not resolve owner." });
      return null;
    }
    return ownerId;
  }

  app.post("/v1/me/google-calendar-events", {
    preHandler: [requireAuth],
    schema: { body: {
      type: "object", additionalProperties: false,
      required: ["requestId", "accountId", "title", "startsAt", "endsAt"],
      properties: {
        requestId: { type: "string", format: "uuid" },
        accountId: { type: "string", format: "uuid" },
        title: { type: "string", minLength: 1, maxLength: 200 },
        description: { type: ["string", "null"], maxLength: 4000 },
        place: { type: ["string", "null"], maxLength: 200 },
        startsAt: { type: "string", maxLength: 40 },
        endsAt: { type: "string", maxLength: 40 },
      },
    } },
  }, async (request, reply) => {
    const ownerId = await ownerFor(request, reply);
    if (!ownerId) return;
    try {
      const saved = await (deps.createGoogleCalendarEvent || createGoogleCalendarEvent)({ ...request.body, ownerId });
      return reply.code(saved.replayed ? 200 : 201).send({ ok: true, ...saved, id: saved.eventId });
    } catch (error) {
      return reply.code(error.status || 503).send({ error: error.code || "google_unconfirmed",
        message: error.code ? error.message : "Google has not confirmed the save. Retry this unchanged draft safely." });
    }
  });

  // ── the strip at the top of Notes & Journal ────────────────────────────────

  app.get(
    "/v1/me/open-reminders",
    {
      preHandler: [requireAuth],
      schema: {
        querystring: {
          type: "object",
          required: ["onDate"],
          properties: { onDate: DATE },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await ownerFor(request, reply);
      if (!ownerId) return;
      const reminders = await listOpen(ownerId, { onDate: request.query.onDate }).catch(() => []);
      return { reminders, onDate: request.query.onDate };
    },
  );

  app.post(
    "/v1/me/open-reminders/:id/complete",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["onDate"],
          properties: { onDate: DATE, done: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await ownerFor(request, reply);
      if (!ownerId) return;
      const done = request.body?.done !== false;
      const ok = await setDone(request.params.id, ownerId, {
        onDate: request.body.onDate,
        done,
      }).catch(() => false);
      if (!ok) return reply.code(404).send({ error: "not_found" });
      return { ok: true, id: request.params.id, onDate: request.body.onDate, done };
    },
  );

  // ── the two editors ────────────────────────────────────────────────────────
  //
  // AN EMPTY PATCH IS A 400, AND THAT IS NOT PEDANTRY.
  //
  // Both bodies are additionalProperties:false, and the first draft of this
  // claimed that meant a typo'd field name would be rejected. It does not:
  // Fastify's AJV runs with removeAdditional:true, so an unknown key is STRIPPED
  // and the handler is handed {} -- which would have gone through as a
  // successful no-op. The test that asserted otherwise failed, which is the only
  // reason this note is here rather than a wrong comment.
  //
  // Rejecting an empty patch catches the realistic version of that mistake: a
  // client sending the wrong field name gets a clear error instead of watching
  // an edit fail to happen. A body that misspells ONE field among several is
  // still silently short by that field -- the schema cannot tell us, so the
  // client is where that has to not happen.
  const noFields = (reply) =>
    reply.code(400).send({
      error: "no_fields",
      message: "Nothing to update. Check the field names.",
    });

  app.patch(
    "/v1/me/open-reminders/:id",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 2000 },
            place: { type: ["string", "null"], maxLength: 200 },
            contactId: { type: ["string", "null"], maxLength: 64 },
            repeat: { type: "string", enum: REPEATS },
            repeatUntil: { type: ["string", "null"], maxLength: 10 },
            repeatDays: {
              type: ["array", "null"],
              maxItems: 7,
              items: { type: "integer", minimum: 0, maximum: 6 },
            },
            notifyAtLocal: { type: ["string", "null"], maxLength: 8 },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await ownerFor(request, reply);
      if (!ownerId) return;
      const body = request.body || {};
      if (Object.keys(body).length === 0) return noFields(reply);
      const id = await patchReminder(request.params.id, ownerId, body).catch(() => null);
      if (!id) return reply.code(404).send({ error: "not_found" });
      return { ok: true, id };
    },
  );

  app.delete("/v1/me/open-reminders/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const ownerId = await ownerFor(request, reply);
    if (!ownerId) return;
    const ok = await dropReminder(request.params.id, ownerId).catch(() => false);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  /**
   * PUT SOMETHING ON THE CALENDAR BY HAND.
   *
   *   "there should be an add event manually for calendar button that opens up
   *    that UI for making a calendar event"
   *
   * Every event in this table until now arrived by being SAID -- the capture
   * pipeline heard a time and wrote a row. That is the good path and it stays
   * the good path, but it is the only one, and a parser is a single point of
   * failure for the entire feature: when migrations 049 and 050 were found
   * unapplied, every INSERT threw and there was no second way to get an event
   * onto the calendar at all. A form is the floor under the parser.
   *
   * The editor sheet already exists and already knows all these fields. This is
   * the one verb it was missing.
   *
   * startsAt is the only required field beyond a title, because it is the whole
   * definition of an event: a stated time is what makes something an event
   * rather than a reminder, and createScheduledEvent refuses an unparseable one
   * rather than quietly landing the row on today.
   */
  app.post(
    "/v1/me/calendar-events",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["title", "startsAt"],
          properties: {
            requestId: { type: "string", format: "uuid" },
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 2000 },
            place: { type: ["string", "null"], maxLength: 200 },
            startsAt: { type: "string", minLength: 1, maxLength: 40 },
            endsAt: { type: ["string", "null"], maxLength: 40 },
            allDay: { type: "boolean" },
            repeat: { type: "string", enum: REPEATS },
            repeatUntil: { type: ["string", "null"], maxLength: 10 },
            notifyMinutesBefore: { type: ["integer", "null"], minimum: 0, maximum: 40320 },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await ownerFor(request, reply);
      if (!ownerId) return;
      let created;
      try {
        created = await makeEvent({ ownerId, ...request.body });
      } catch (err) {
        /**
         * THE ERROR IS NAMED, not swallowed into a 500 with no body.
         *
         * createScheduledEvent throws on an unparseable startsAt, and the whole
         * reason this route exists is that a silent write failure went unnoticed
         * for days. A create path that cannot say why it failed would be the
         * same mistake in a new place.
         */
        if (err?.message === "memo_action_conflict")
          return reply.code(409).send({ error: "memo_action_conflict", message: "This action was already saved with different details." });
        request.log?.warn?.(`CREATE_EVENT_ERR owner=${ownerId} ${err?.message || err}`);
        return reply.code(400).send({
          error: "could_not_create",
          message: String(err?.message || "").includes("startsAt")
            ? "That start time could not be read."
            : "Could not save the event.",
        });
      }
      if (!created?.eventId) {
        return reply.code(500).send({ error: "could_not_create", message: "Could not save the event." });
      }
      return reply.code(created.replayed ? 200 : 201).send({ ok: true, id: created.eventId, replayed: !!created.replayed });
    },
  );

  app.patch(
    "/v1/me/calendar-events/:id",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 2000 },
            place: { type: ["string", "null"], maxLength: 200 },
            startsAt: { type: "string", maxLength: 40 },
            endsAt: { type: ["string", "null"], maxLength: 40 },
            allDay: { type: "boolean" },
            repeat: { type: "string", enum: REPEATS },
            repeatUntil: { type: ["string", "null"], maxLength: 10 },
            // null is "silent", which is a real choice and not the same as
            // leaving the field out. See cleanNotifyMinutes.
            notifyMinutesBefore: { type: ["integer", "null"], minimum: 0, maximum: 40320 },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await ownerFor(request, reply);
      if (!ownerId) return;
      const body = request.body || {};
      if (Object.keys(body).length === 0) return noFields(reply);
      const id = await patchEvent(request.params.id, ownerId, body).catch(() => null);
      if (!id) return reply.code(404).send({ error: "not_found" });
      return { ok: true, id };
    },
  );

  app.delete("/v1/me/calendar-events/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const ownerId = await ownerFor(request, reply);
    if (!ownerId) return;
    const ok = await dropEvent(request.params.id, ownerId).catch(() => false);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });
}
