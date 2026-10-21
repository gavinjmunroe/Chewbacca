/**
 * /v1/me/reminders/self — the app's own reminder list.
 *
 *   GET    /v1/me/reminders/self        → { reminders: [...] }
 *   POST   /v1/me/reminders/self        → { reminder }   (manual entry)
 *   PATCH  /v1/me/reminders/self/:id    → { reminder }   ({ done: true|false })
 *
 * WHY THIS EXISTS ALONGSIDE routes/reminders.js. That file is the cross-person
 * surface from Tab 31: "remind Sagar about the deck", addressed to somebody
 * else, authenticated by phone header or service key, and shaped around a
 * recipient you have to resolve. These three routes are the opposite case and
 * the common one — a reminder the user set FOR THEMSELVES — and the app needs
 * three things that surface does not offer:
 *
 *   1. a list scoped to self-origin rows, so the cross-person reminders a
 *      teammate created do not appear in your own Today feed;
 *   2. a way to tick one off, which is not the same as canceling it (cancel
 *      says "don't do this", done says "I did it"), and
 *   3. a way to add one by hand, without inventing a recipient address for a
 *      reminder whose recipient is always you.
 *
 * They read and write the SAME `reminders` table and the SAME row shape as
 * everything else — db/self-reminders.js owns that shape — so the delivery
 * scheduler, the agent's schedule_reminder tool and the existing CRUD keep
 * operating on one source of truth. Nothing here is a second store.
 *
 * Isolation: the owner is resolved from the caller's own verified session
 * (request.privyUser.phone → amber_id), and every query filters on it in the
 * WHERE clause. No route accepts an owner id, and a caller probing another
 * tenant's reminder id gets the same 404 as one probing an id that never
 * existed.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import {
  listSelfRemindersForOwner,
  setSelfReminderDone,
  persistSelfReminder,
} from "../db/self-reminders.js";
import { getNotificationChannels } from "./notification-settings.js";

const REMINDER_ID_RE = /^rem_[a-zA-Z0-9_-]{8,128}$/;

/**
 * The wire shape, deliberately narrower than the stored row. The stored row
 * carries the delivery machinery — transport, address, attempts, last_error,
 * the requester's phone — and none of that is the app's business or safe to
 * hand to a client. Four fields plus the contact link is what a reminder card
 * renders.
 */
function toClient(r) {
  if (!r) return null;
  const dueISO =
    r.due_at instanceof Date
      ? r.due_at.toISOString()
      : typeof r.when?.iso === "string"
        ? r.when.iso
        : typeof r.due_at === "string"
          ? r.due_at
          : null;
  return {
    reminderId: r.reminder_id,
    title: r.title || r.message || "Reminder",
    body: r.message || null,
    dueAt: dueISO,
    done: r.status === "done",
    doneAt: r.done_at ?? null,
    createdAt: r.created_at ?? null,
    // null whenever the reminder is about nobody in the contact graph, which is
    // most of them. Never guessed — see the note in buildSelfReminderRow.
    contact: r.contact?.id
      ? { id: String(r.contact.id), name: r.contact.name ?? null }
      : null,
  };
}

export function registerSelfRemindersMeRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmber = deps.resolveAmberIdByPhone || resolveAmberIdByPhone;
  const listForOwner = deps.listSelfRemindersForOwner || listSelfRemindersForOwner;
  const setDone = deps.setSelfReminderDone || setSelfReminderDone;
  const persist = deps.persistSelfReminder || persistSelfReminder;
  const readChannels = deps.getNotificationChannels || getNotificationChannels;

  // Resolve the caller's own owner id, or answer for them. Returns null when it
  // has already sent a reply.
  async function ownerFor(request, reply) {
    const phone = request.privyUser?.phone;
    if (!phone) {
      reply.code(400).send({
        error: "no_phone_on_session",
        message: "Session carries no phone — cannot resolve reminder owner.",
      });
      return null;
    }
    const amberId = await resolveAmber(phone).catch(() => null);
    if (!amberId) {
      reply.code(500).send({
        error: "could_not_resolve_owner",
        message: "Could not resolve Cloud SQL owner for this session.",
      });
      return null;
    }
    return { amberId, phone };
  }

  // ── GET /v1/me/reminders/self ─────────────────────────────────────────
  app.get(
    "/v1/me/reminders/self",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const who = await ownerFor(request, reply);
      if (!who) return;
      const rows = await listForOwner(who.amberId, { limit: 50 }).catch(() => []);
      return { reminders: rows.map(toClient).filter(Boolean) };
    },
  );

  // ── POST /v1/me/reminders/self ────────────────────────────────────────
  // Manual entry. `dueAt` is required and must be a real ISO instant: a
  // reminder with no time is a note, and this app already has a very good place
  // to put notes.
  app.post(
    "/v1/me/reminders/self",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["title", "dueAt"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 120 },
            body: { type: "string", maxLength: 4000 },
            dueAt: { type: "string", maxLength: 40 },
            contactId: { type: "string", maxLength: 64 },
            contactName: { type: "string", maxLength: 120 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const who = await ownerFor(request, reply);
      if (!who) return;
      const did = request.privyUser?.userId;
      if (!did) return reply.code(401).send({ error: "auth_required" });

      const body = request.body || {};
      const due = new Date(String(body.dueAt));
      if (Number.isNaN(due.getTime())) {
        return reply.code(400).send({
          error: "invalid_due_at",
          message: "dueAt must be an ISO 8601 timestamp.",
        });
      }

      const channels = await readChannels(who.amberId).catch(() => null);
      let row;
      try {
        row = await persist({
          tenantDid: did,
          ownerPhone: who.phone,
          fireAtISO: due.toISOString(),
          title: body.title,
          body: body.body || body.title,
          channels,
          source: "manual",
          contact: body.contactId
            ? { id: body.contactId, name: body.contactName ?? null }
            : null,
        });
      } catch (err) {
        request.log?.error?.(
          `SELF_REMINDER_CREATE_FAILED owner=${who.amberId}: ${err.message}`,
        );
        return reply.code(503).send({
          error: "reminder_store_unavailable",
          message: "Could not save that reminder. Try again.",
        });
      }
      request.log?.info?.(
        `SELF_REMINDER_CREATED owner=${who.amberId} id=${row.reminder_id} source=manual`,
      );
      return reply.code(201).send({ reminder: toClient(row) });
    },
  );

  // ── PATCH /v1/me/reminders/self/:id ───────────────────────────────────
  app.patch(
    "/v1/me/reminders/self/:id",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["done"],
          properties: { done: { type: "boolean" } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const who = await ownerFor(request, reply);
      if (!who) return;
      const id = request.params?.id;
      if (!REMINDER_ID_RE.test(String(id || ""))) {
        return reply.code(400).send({ error: "invalid_reminder_id" });
      }
      const updated = await setDone(id, who.amberId, request.body.done === true);
      if (!updated) {
        // Not found, not yours, not a self-reminder, or already fired /
        // cancelled — one answer for all of them on purpose.
        return reply.code(404).send({
          error: "reminder_not_found",
          message: "No pending reminder of yours with that id.",
        });
      }
      return { reminder: toClient(updated) };
    },
  );
}
