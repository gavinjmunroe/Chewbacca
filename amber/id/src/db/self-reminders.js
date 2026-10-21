/**
 * Self-reminder persistence + delivery-scan helpers (Cloud SQL).
 *
 * These are ADDITIVE helpers over the SAME `reminders` table used by
 * db/reminders.js — they do not modify or replace anything there. They exist
 * so the self-reminder scheduler (jobs/reminder-scheduler.js) can:
 *   1. persist a reminder the user set FOR THEMSELVES, keyed to the owner DID,
 *   2. scan ONLY self-origin iMessage rows that are due, and
 *   3. DELETE the row on successful delivery (owner wants delete-on-complete),
 * without ever touching the teammate's cross-person (Tab 31) reminder rows.
 *
 * Every self-reminder row carries data.origin === "self_reminder" and
 * recipient.kind === "self" with recipient.address == the OWNER'S OWN number.
 * The due scan filters on origin so the two reminder flows never collide.
 *
 * Per-tenant isolation:
 *   - persist writes owner_id (resolved from the caller's own DID) + a self
 *     recipient whose address is the caller's own phone.
 *   - the scan returns owner_id so the scheduler can re-resolve the owner's
 *     OWN destination fresh (never trusting a stored address blindly).
 *   - all SQL is parameterized.
 */

import crypto from "node:crypto";
import { query } from "./sql.js";
import { createReminder } from "./reminders.js";

export const SELF_REMINDER_ORIGIN = "self_reminder";
export const SELF_REMINDER_MAX_ATTEMPTS = 3;

function nowIso() {
  return new Date().toISOString();
}

function newReminderId() {
  return `rem_${crypto.randomUUID()}`;
}

/**
 * Build the canonical reminder row for a self-reminder captured via
 * /v1/reminders/parse. Matches the shape db/reminders.js persists so the
 * existing CRUD / list endpoints keep working over the same rows.
 *
 * The recipient is ALWAYS the owner themselves (kind:"self"), addressed to the
 * owner's own phone. transport:"imessage" because only the iMessage channel is
 * delivered server-side; the Apple channel is handled on-device by the app.
 */
export function buildSelfReminderRow({
  tenantDid,
  ownerPhone,
  fireAtISO,
  title,
  body,
  eventAtISO = null,
  channels,
  contact = null,
  source = "reminders_parse",
  /**
   * WHAT THIS ROW IS FOR, and it is not always "a reminder the user set".
   *
   * "Calendar events get a notification 10 minutes before they occur."
   *
   * An event's notification is delivered by the same scheduler that delivers
   * reminders, because building a second one would be two machines doing one
   * job. So an event writes a row here too -- and that row must never be shown
   * to the user AS a reminder: they set one thing and would see two. This tag is
   * how every reader tells them apart. See listScheduledReminders, which
   * excludes it from the day view.
   */
  kind = "reminder",
  eventId = null,
}) {
  const iso = new Date(fireAtISO);
  const whenIso = Number.isNaN(iso.getTime())
    ? String(fireAtISO)
    : iso.toISOString();
  const message = String(body || title || "Reminder").slice(0, 4000);
  // THE TRANSPORT IS THE DELIVERY SWITCH, and it has to stay honest now that
  // every reminder is stored rather than only the iMessage ones.
  //
  // listDueSelfReminders scans for pending rows with
  // recipient.transport = 'imessage'. This builder used to hardcode 'imessage'
  // because it was only ever called behind an `if (channels.imessage)` gate. That
  // gate is gone -- the app needs a server row for EVERY reminder so it can list
  // them, tick them off and survive a reinstall -- so hardcoding it would have
  // handed the scheduler a pile of Apple-only reminders to text the user about,
  // on top of the lock-screen notification the phone had already delivered.
  // Naming the transport after the channel the user actually chose leaves the
  // scan picking up exactly the rows it picks up today.
  const imessage = Boolean(channels?.imessage);
  return {
    reminder_id: newReminderId(),
    tenant_did: tenantDid,
    requester_phone: ownerPhone || null,
    recipient_input: "self",
    recipient: {
      transport: imessage ? "imessage" : "apple",
      address: ownerPhone || null,
      kind: "self",
      needs_resolution: false,
    },
    when: {
      iso: whenIso,
      source: "parsed",
      input: String(fireAtISO || ""),
      timezone: null,
    },
    message,
    title: String(title || "Reminder").slice(0, 120),
    event_at: eventAtISO || null,
    channels: {
      apple: Boolean(channels?.apple),
      imessage: Boolean(channels?.imessage),
    },
    cc_requester: false,
    status: "pending",
    created_at: nowIso(),
    fired_at: null,
    attempts: 0,
    origin: SELF_REMINDER_ORIGIN,
    source: String(source || "reminders_parse").slice(0, 40),
    kind: kind === "event_notification" ? "event_notification" : "reminder",
    event_id: eventId ? String(eventId).slice(0, 64) : null,
    // WHO the reminder is about, when the caller knows. Optional and never
    // guessed: a reminder parsed out of "call the dentist Tuesday" is about
    // nobody in the contact graph, and inventing a contact for it would put a
    // note in a real person's file that they have nothing to do with. Stored in
    // `data` rather than as a column because nothing queries by it -- the app
    // reads the row it already has.
    contact: contact?.id
      ? {
          id: String(contact.id).slice(0, 64),
          name: contact.name ? String(contact.name).slice(0, 120) : null,
        }
      : null,
  };
}

/**
 * Persist one self-reminder. Reuses createReminder (db/reminders.js) so the
 * owner_id resolution + due_at mirror + jsonb upsert stay in one place.
 * Returns the persisted row. Throws on DB error (caller treats persist as
 * best-effort so a write failure never blocks the parse response).
 */
export async function persistSelfReminder(args, deps = {}) {
  const create = deps.createReminder || createReminder;
  const row = buildSelfReminderRow(args);
  await create(row);
  return row;
}

/**
 * Pull self-origin iMessage reminders whose due_at has elapsed and are still
 * pending, oldest-first. Returns [{ ownerId, reminder }] so the scheduler can
 * re-resolve the owner's OWN destination from owner_id. Fails open to [].
 *
 * NOTE: filtered to origin="self_reminder" so this scan is disjoint from the
 * teammate's global listDueReminders (which the cross-person worker uses).
 */
export async function listDueSelfReminders(now = new Date(), limit = 25) {
  const lim = Math.max(1, Math.min(Number(limit) || 25, 200));
  try {
    const { rows } = await query(
      `SELECT owner_id, data FROM reminders
        WHERE status = 'pending'
          AND due_at IS NOT NULL
          AND due_at <= $1::timestamptz
          AND data->>'origin' = $2
          AND data->'recipient'->>'transport' = 'imessage'
        ORDER BY due_at ASC
        LIMIT $3`,
      [now.toISOString(), SELF_REMINDER_ORIGIN, lim],
    );
    return rows.map((r) => ({ ownerId: r.owner_id, reminder: r.data }));
  } catch {
    return [];
  }
}

/**
 * Hard-delete a reminder row by id (delete-on-complete). Owner-scoping is not
 * needed here because the reminder_id is server-generated and only ever handed
 * to the scheduler for a row it just read; still, callers pass ids that came
 * from the self-origin scan only. Returns the number of rows deleted.
 */
export async function deleteReminderById(reminderId) {
  if (!reminderId) return 0;
  const { rowCount } = await query(
    `DELETE FROM reminders WHERE reminder_id = $1`,
    [reminderId],
  );
  return rowCount ?? 0;
}

/**
 * Record a failed delivery attempt on a self-reminder. Increments attempts in
 * the jsonb; once attempts >= maxAttempts the row is DELETED (owner wants
 * delete-on-complete AND no infinite retry / no spam). Below the cap the row
 * is left pending with the error recorded so the next tick retries.
 * Returns { deleted:boolean, attempts:number }.
 */
export async function recordSelfReminderFailure(
  reminderId,
  { reason, maxAttempts = SELF_REMINDER_MAX_ATTEMPTS } = {},
) {
  if (!reminderId) return { deleted: false, attempts: 0 };
  const { rows } = await query(
    `SELECT data FROM reminders WHERE reminder_id = $1`,
    [reminderId],
  );
  const data = rows[0]?.data;
  if (!data) return { deleted: false, attempts: 0 };
  const attempts = (Number(data.attempts) || 0) + 1;
  if (attempts >= maxAttempts) {
    await query(`DELETE FROM reminders WHERE reminder_id = $1`, [reminderId]);
    return { deleted: true, attempts };
  }
  const merged = {
    ...data,
    attempts,
    last_error: reason ? String(reason).slice(0, 500) : "unknown",
    last_attempt_at: nowIso(),
  };
  await query(
    `UPDATE reminders SET data = $2::jsonb WHERE reminder_id = $1`,
    [reminderId, JSON.stringify(merged)],
  );
  return { deleted: false, attempts };
}

/**
 * The caller's own self-reminders, for the app's list. Pending first (soonest
 * due leading), then whatever they have recently ticked off, so a reminder does
 * not vanish the instant it is done -- an undo has to have something to undo.
 *
 * Owner-scoped by construction: `ownerId` comes from the caller's own verified
 * session, never from a path or body parameter, so this cannot read another
 * tenant's rows. Fails open to [] because an empty reminder list renders
 * correctly and an exception here would take Home's whole personal section down
 * with it.
 */
export async function listSelfRemindersForOwner(
  ownerId,
  { limit = 50, doneWithinHours = 24 } = {},
) {
  if (!ownerId) return [];
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
  const since = new Date(
    Date.now() - Math.max(0, Number(doneWithinHours) || 0) * 3600_000,
  ).toISOString();
  try {
    const { rows } = await query(
      `SELECT reminder_id, status, due_at, data FROM reminders
        WHERE owner_id = $1
          AND data->>'origin' = $2
          AND (
            status = 'pending'
            OR (status = 'done' AND COALESCE(data->>'done_at', '') >= $3)
          )
        ORDER BY (status = 'done'), due_at ASC NULLS LAST
        LIMIT $4`,
      [ownerId, SELF_REMINDER_ORIGIN, since, lim],
    );
    return rows.map((r) => ({
      ...r.data,
      reminder_id: r.reminder_id,
      status: r.status,
      due_at: r.due_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Tick a self-reminder off, or put it back. Returns the updated row, or null
 * when the id does not exist, is not this owner's, or is not a self-reminder.
 *
 * THE OWNER CHECK IS IN THE WHERE CLAUSE, not a read-then-compare, so there is
 * no window between the two in which the row could change hands, and a caller
 * probing someone else's reminder id gets the same null as a caller probing an
 * id that never existed -- no way to tell the two apart, which is the point.
 *
 * Only 'pending' <-> 'done' move. A row the scheduler already fired, cancelled
 * or failed keeps the state the scheduler gave it; overwriting that would lose
 * the delivery outcome, and there is nothing for the user to tick off on a
 * reminder that has already come and found them.
 */
export async function setSelfReminderDone(reminderId, ownerId, done = true) {
  if (!reminderId || !ownerId) return null;
  const next = done ? "done" : "pending";
  const from = done ? "pending" : "done";
  const patch = done
    ? JSON.stringify({ status: "done", done_at: nowIso() })
    : JSON.stringify({ status: "pending", done_at: null });
  try {
    const { rows } = await query(
      `UPDATE reminders
          SET status = $4,
              data = COALESCE(data, '{}'::jsonb) || $5::jsonb
        WHERE reminder_id = $1
          AND owner_id = $2
          AND data->>'origin' = $3
          AND status = $6
        RETURNING reminder_id, status, due_at, data`,
      [reminderId, ownerId, SELF_REMINDER_ORIGIN, next, patch, from],
    );
    const r = rows[0];
    if (!r) return null;
    return { ...r.data, reminder_id: r.reminder_id, status: r.status, due_at: r.due_at };
  } catch {
    return null;
  }
}

/**
 * THE REMINDERS A CORRECTION COULD BE ABOUT.
 *
 * "Remind me to call Sagar at 7:30 pm" ... "no, 7:30 AM". The second sentence
 * is not a new reminder and it is not a chat message to be acknowledged and
 * dropped -- which is exactly what happened: Amber said "got it, 7:30 AM" and
 * the row on the server still said 19:30, so the notification arrived twelve
 * hours late.
 *
 * A correction can only be about something the user set MOMENTS ago, so the
 * window is deliberately narrow (default 30 minutes) and the list deliberately
 * short. Anything older is a reminder you have to open and edit, not something
 * a passing sentence is allowed to move -- widening this is how "call mom at 9"
 * silently reschedules last Tuesday's dentist appointment.
 *
 * Pending only: a fired reminder has already found the user and moving it would
 * be a lie about a notification they have already seen.
 */
export async function listRecentSelfReminders(
  ownerId,
  { withinMinutes = 30, limit = 5 } = {},
) {
  if (!ownerId) return [];
  const lim = Math.max(1, Math.min(Number(limit) || 5, 20));
  const mins = Math.max(1, Math.min(Number(withinMinutes) || 30, 720));
  const since = new Date(Date.now() - mins * 60_000).toISOString();
  try {
    const { rows } = await query(
      `SELECT reminder_id, due_at, data FROM reminders
        WHERE owner_id = $1
          AND data->>'origin' = $2
          AND status = 'pending'
          AND created_at >= $3::timestamptz
        ORDER BY created_at DESC
        LIMIT $4`,
      [ownerId, SELF_REMINDER_ORIGIN, since, lim],
    );
    return rows.map((r) => ({
      ...r.data,
      reminder_id: r.reminder_id,
      due_at: r.due_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Move a reminder the user just corrected: a new time, and optionally a new
 * title, body or subject.
 *
 * WHY THIS IS NOT A SECOND INSERT. The obvious implementation of "he corrected
 * it" is to write the corrected reminder and leave the wrong one alone, and
 * that gives the user two notifications twelve hours apart, one of which is
 * wrong and neither of which they can tell from the other. The row moves.
 *
 * `when` is rebuilt whole rather than merged, because jsonb `||` is a SHALLOW
 * merge: patching { when: { iso } } would drop when.source/input/timezone and
 * leave the row claiming a provenance it no longer has. Same reason `contact`
 * is only touched when the caller has one -- a correction about the time must
 * not blank out who the reminder is about.
 *
 * Owner-scoped in the WHERE clause, pending-only, and it returns null for
 * "not yours" and "no such id" alike.
 */
export async function updateSelfReminder(
  reminderId,
  ownerId,
  { fireAtISO, title = null, body = null, contact = null, eventAtISO = undefined } = {},
) {
  if (!reminderId || !ownerId) return null;
  const iso = new Date(fireAtISO);
  if (Number.isNaN(iso.getTime())) return null;
  const whenIso = iso.toISOString();

  const patch = {
    when: {
      iso: whenIso,
      source: "parsed",
      input: String(fireAtISO || ""),
      timezone: null,
    },
    corrected_at: nowIso(),
  };
  if (title) patch.title = String(title).slice(0, 120);
  if (body) patch.message = String(body).slice(0, 4000);
  if (eventAtISO !== undefined) patch.event_at = eventAtISO || null;
  if (contact?.id) {
    patch.contact = {
      id: String(contact.id).slice(0, 64),
      name: contact.name ? String(contact.name).slice(0, 120) : null,
    };
  }

  try {
    const { rows } = await query(
      `UPDATE reminders
          SET due_at = $4::timestamptz,
              data = COALESCE(data, '{}'::jsonb) || $5::jsonb
        WHERE reminder_id = $1
          AND owner_id = $2
          AND data->>'origin' = $3
          AND status = 'pending'
        RETURNING reminder_id, status, due_at, data`,
      [reminderId, ownerId, SELF_REMINDER_ORIGIN, whenIso, JSON.stringify(patch)],
    );
    const r = rows[0];
    if (!r) return null;
    return { ...r.data, reminder_id: r.reminder_id, status: r.status, due_at: r.due_at };
  } catch {
    return null;
  }
}
