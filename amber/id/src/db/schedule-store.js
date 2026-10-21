/**
 * EVENTS AND REMINDERS: THE TWO THINGS A SPOKEN PLAN CAN BECOME.
 *
 *   "Anything with a stated time becomes an event on the calendar. Anything
 *    that's a reminder ... should just be a notification and a reminder that
 *    sits at the top of your notes and journals until it's checked off. It
 *    doesn't need to go in the calendar."
 *
 * ONE FILE FOR BOTH, because they are one decision with two outcomes and the
 * fields they carry are almost identical -- title, description, place, who it is
 * with, how it repeats, when the repeat stops, when to be notified. Only the
 * time is different, and the time IS the distinction. Splitting them across two
 * stores would put that rule in two places, and it is the rule most likely to
 * be got wrong twice.
 *
 * WHAT WAS THERE BEFORE. The reminders table and its self-reminder scheduler are
 * untouched by this file for anything that already worked: db/self-reminders.js
 * still owns timed iMessage reminders end to end. What is new is the UNTIMED
 * reminder -- a row with due_at NULL, which that scheduler's scan skips by
 * construction -- and the event path, which is what a stated time should always
 * have produced.
 */
import { query, withTransaction } from "./sql.js";
import { asUuid } from "./observations-store.js";
import { memoActionResourceId } from "./memo-action-store.js";

/** Frequencies the app understands. Mirrors the CHECK in migration 049. */
export const REPEATS = ["none", "daily", "weekdays", "weekends", "weekly", "monthly"];

/** Google's default, and what was asked for. Minutes before an event starts. */
export const DEFAULT_NOTIFY_MINUTES = 10;

const DONE_STATUSES = ["done", "completed"];

function cleanRepeat(v) {
  return REPEATS.includes(v) ? v : "none";
}

/** An ISO date (YYYY-MM-DD) or null. Anything unparseable is null, never today. */
function cleanDate(v) {
  const t = typeof v === "string" ? v.trim().slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return Number.isNaN(new Date(`${t}T00:00:00Z`).getTime()) ? null : t;
}

/**
 * A `date` COLUMN COMES BACK AS A Date OBJECT, NOT A STRING.
 *
 * node-postgres parses `date` into a JS Date at LOCAL midnight, so the obvious
 * `String(row.repeat_until).slice(0, 10)` returns "Sun Sep 13" -- the first ten
 * characters of a Date's toString(). It reads like a date, it is not one, and
 * the editor would send it straight back to a schema that requires
 * ^\d{4}-\d{2}-\d{2}$. This shipped that way; the test below it is the reason
 * it did not stay that way.
 *
 * Read off the LOCAL parts, never toISOString(): the Date is local midnight, so
 * anywhere east of Greenwich the UTC date is the day before.
 */
function dateKey(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const t = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

function cleanText(v, max) {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

/**
 * Minutes before, or null for silent.
 *
 * `undefined` means "the caller did not say" and takes the default; `null` means
 * "the user turned it off" and is kept. Those are different answers and folding
 * them together is how clearing a notification silently re-enables it.
 */
function cleanNotifyMinutes(v, fallback = DEFAULT_NOTIFY_MINUTES) {
  if (v === undefined) return fallback;
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(Math.round(n), 40320)); // 0 .. four weeks
}

/** 0=Sunday .. 6=Saturday, matching Date#getDay(). Only meaningful weekly. */
function cleanRepeatDays(v, repeat) {
  if (repeat !== "weekly" || !Array.isArray(v)) return null;
  const days = [...new Set(v.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  return days.length > 0 ? days.sort((a, b) => a - b) : null;
}

// ── events ───────────────────────────────────────────────────────────────────

/**
 * Put a stated time on the calendar.
 *
 * `scheduled_at` IS WHAT THE DAY VIEW SELECTS ON, and it is set to the stated
 * time rather than left to fall back to now(). See migration 048: starts_at has
 * always doubled as "when you told Amber about it" for the relationship rollup,
 * so it cannot also mean "when this happens" -- which is why every note that
 * mentioned a person used to land on today's calendar.
 */
export async function createScheduledEvent({
  ownerId,
  requestId = null,
  contactId = null,
  title,
  description = null,
  place = null,
  startsAt,
  endsAt = null,
  allDay = false,
  repeat = "none",
  repeatUntil = null,
  notifyMinutesBefore = undefined,
  /**
   * WHERE THE EVENT CAME FROM, and the allowed values are not ours to invent:
   * events_source_chk (migration 046) permits capture | google | microsoft, and
   * "capture" is what something the user said out loud is. The first draft of
   * this wrote "amber" and the constraint refused every insert -- which is the
   * constraint doing its job, and the reason this default is not a guess.
   */
  source = "capture",
}) {
  const owner = asUuid(ownerId);
  if (!owner) throw new Error("createScheduledEvent: ownerId must be a uuid");
  const startISO = startsAt instanceof Date ? startsAt.toISOString() : String(startsAt || "");
  if (!startISO || Number.isNaN(new Date(startISO).getTime())) {
    throw new Error("createScheduledEvent: startsAt must be a valid instant");
  }
  const rep = cleanRepeat(repeat);
  const endISO =
    endsAt && !Number.isNaN(new Date(endsAt).getTime()) && new Date(endsAt) >= new Date(startISO)
      ? new Date(endsAt).toISOString()
      : null;

  const stableId = requestId ? memoActionResourceId(owner, "calendar", requestId) : null;
  const { rows } = await query(
    `INSERT INTO events
       (owner_id, contact_id, modality, kind, title, description, place,
        starts_at, ends_at, scheduled_at, all_day,
        repeat, repeat_until, notify_minutes_before, source, event_id)
     VALUES ($1,$2,'planned','experience',$3,$4,$5,
             $6::timestamptz,$7::timestamptz,$6::timestamptz,$8,
             $9,$10::date,$11,$12,COALESCE($13::uuid,gen_random_uuid()))
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [
      owner,
      asUuid(contactId),
      cleanText(title, 200) || "Event",
      cleanText(description, 2000),
      cleanText(place, 200),
      startISO,
      endISO,
      allDay === true,
      rep,
      rep === "none" ? null : cleanDate(repeatUntil),
      cleanNotifyMinutes(notifyMinutesBefore),
      source,
      stableId,
    ],
  );
  if (!rows.length && stableId) {
    const existing = await query(
      `SELECT event_id FROM events WHERE event_id = $1 AND owner_id = $2
        AND contact_id IS NOT DISTINCT FROM $3::uuid AND title = $4
        AND description IS NOT DISTINCT FROM $5 AND place IS NOT DISTINCT FROM $6
        AND scheduled_at = $7::timestamptz AND ends_at IS NOT DISTINCT FROM $8::timestamptz
        AND all_day = $9 AND repeat = $10 AND repeat_until IS NOT DISTINCT FROM $11::date
        AND notify_minutes_before IS NOT DISTINCT FROM $12 AND source = $13 AND deleted_at IS NULL`,
      [stableId, owner, asUuid(contactId), cleanText(title, 200) || "Event",
        cleanText(description, 2000), cleanText(place, 200), startISO, endISO, allDay === true,
        rep, rep === "none" ? null : cleanDate(repeatUntil), cleanNotifyMinutes(notifyMinutesBefore), source],
    );
    if (!existing.rows.length) throw Error("memo_action_conflict");
    return { eventId: existing.rows[0].event_id, replayed: true };
  }
  return { eventId: rows[0].event_id };
}

/** Everything a person can change from the event editor. */
export async function updateScheduledEvent(eventId, ownerId, patch = {}) {
  const owner = asUuid(ownerId);
  const id = asUuid(eventId);
  if (!owner || !id) return null;

  const sets = [];
  const vals = [id, owner];
  const put = (col, v) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };

  if ("title" in patch) put("title", cleanText(patch.title, 200) || "Event");
  if ("description" in patch) put("description", cleanText(patch.description, 2000));
  if ("place" in patch) put("place", cleanText(patch.place, 200));
  if ("allDay" in patch) put("all_day", patch.allDay === true);
  if ("notifyMinutesBefore" in patch) {
    put("notify_minutes_before", cleanNotifyMinutes(patch.notifyMinutesBefore, null));
  }
  if ("startsAt" in patch && patch.startsAt) {
    const iso = new Date(patch.startsAt);
    if (!Number.isNaN(iso.getTime())) {
      // BOTH COLUMNS MOVE TOGETHER. scheduled_at is what the day view reads and
      // starts_at is what the rollup reads; leaving one behind would put the
      // event on one day and count it on another.
      put("starts_at", iso.toISOString());
      put("scheduled_at", iso.toISOString());
    }
  }
  if ("endsAt" in patch) {
    const e = patch.endsAt ? new Date(patch.endsAt) : null;
    put("ends_at", e && !Number.isNaN(e.getTime()) ? e.toISOString() : null);
  }
  if ("repeat" in patch) {
    const rep = cleanRepeat(patch.repeat);
    put("repeat", rep);
    // Clearing the repeat has to clear its end date in the same statement, or
    // the CHECK rejects the whole update and the user's edit silently fails.
    if (rep === "none") put("repeat_until", null);
    else if ("repeatUntil" in patch) put("repeat_until", cleanDate(patch.repeatUntil));
  } else if ("repeatUntil" in patch) {
    put("repeat_until", cleanDate(patch.repeatUntil));
  }

  if (sets.length === 0) return null;

  const { rows } = await query(
    `UPDATE events SET ${sets.join(", ")}
      WHERE event_id = $1 AND owner_id = $2 AND deleted_at IS NULL AND source = 'capture'
      RETURNING event_id`,
    vals,
  );
  return rows[0]?.event_id ?? null;
}

/** Soft-delete, so a mis-tap is recoverable and the rollup's history stays put. */
export async function deleteScheduledEvent(eventId, ownerId) {
  const { rowCount } = await query(
    `UPDATE events SET deleted_at = now()
      WHERE event_id = $1 AND owner_id = $2 AND deleted_at IS NULL AND source = 'capture'`,
    [asUuid(eventId), asUuid(ownerId)],
  );
  return rowCount > 0;
}

// ── reminders ────────────────────────────────────────────────────────────────

/**
 * An open reminder: no time, sits at the top of Notes & Journal until ticked.
 *
 * due_at IS DELIBERATELY NULL. db/self-reminders.js's scan requires a due_at, so
 * a NULL keeps these out of the timed iMessage path entirely -- which is right,
 * because there is no time to fire at. Their notification is notify_at_local, a
 * wall-clock time of day.
 */
export async function createOpenReminder({
  ownerId,
  reminderId,
  title,
  body = null,
  description = null,
  place = null,
  contactId = null,
  repeat = "none",
  repeatUntil = null,
  repeatDays = null,
  /**
   * The first LOCAL date it should appear on, or null for "from now on".
   * "Remind me tomorrow to call the bank" is not a reminder for today, and
   * before this existed it was: an untimed reminder had no lower bound at all.
   */
  startsOn = null,
  notifyAtLocal = null,
  data = {},
}) {
  const owner = asUuid(ownerId);
  if (!owner) throw new Error("createOpenReminder: ownerId must be a uuid");
  const id = String(reminderId || "").trim();
  if (!id) throw new Error("createOpenReminder: reminderId is required");
  const rep = cleanRepeat(repeat);
  const cleanTitle = cleanText(title, 200) || "Reminder";

  const { rows } = await query(
    `INSERT INTO reminders
       (reminder_id, owner_id, status, due_at, data,
        title, description, place, contact_id,
        repeat, repeat_until, repeat_days, starts_on, notify_at_local)
     VALUES ($1,$2,'pending',NULL,$3::jsonb,
             $4,$5,$6,$7,
             $8,$9::date,$10::smallint[],$11::date,$12::time)
     RETURNING reminder_id`,
    [
      id,
      owner,
      JSON.stringify({ ...data, title: cleanTitle, body: cleanText(body, 500) || cleanTitle }),
      cleanTitle,
      cleanText(description, 2000),
      cleanText(place, 200),
      asUuid(contactId),
      rep,
      rep === "none" ? null : cleanDate(repeatUntil),
      cleanRepeatDays(repeatDays, rep),
      cleanDate(startsOn),
      typeof notifyAtLocal === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(notifyAtLocal)
        ? notifyAtLocal
        : null,
    ],
  );
  return rows[0]?.reminder_id ?? null;
}

/**
 * The reminders to show at the top of Notes & Journal for ONE local day.
 *
 * `onDate` is the user's own local date (YYYY-MM-DD), sent by the client,
 * because a day is a timezone question and the server is not the one who knows
 * the answer.
 *
 * WHAT IS OPEN, EXACTLY:
 *   - a one-off whose status is not done -- it stays until ticked, however many
 *     days that takes, which is the whole point of "it should persist";
 *   - a repeating one that has not been ticked FOR THIS DATE, and whose repeat
 *     has not run past its end date, and which falls on this day of the week.
 *
 * The completion is looked up per date rather than read off the row: ticking
 * Tuesday must not end a daily reminder. See migration 049.
 */
export async function listOpenReminders(ownerId, { onDate, limit = 50 } = {}) {
  const owner = asUuid(ownerId);
  const date = cleanDate(onDate);
  if (!owner || !date) return [];

  const { rows } = await query(
    `SELECT r.reminder_id, r.title, r.description, r.place, r.contact_id,
            r.repeat, r.repeat_until, r.repeat_days, r.starts_on, r.notify_at_local,
            r.created_at, r.data,
            (c.reminder_id IS NOT NULL) AS done_today
       FROM reminders r
       LEFT JOIN reminder_completions c
              ON c.reminder_id = r.reminder_id AND c.on_date = $2::date
      WHERE r.owner_id = $1
        AND r.due_at IS NULL
        AND COALESCE(r.status, '') <> ALL ($3::text[])
        AND (r.repeat_until IS NULL OR r.repeat_until >= $2::date)
        -- THE LOWER BOUND, and it is the half that was missing. Without it a
        -- reminder set for "tomorrow and Sunday" also sat on today, and on every
        -- past day the user scrolled back to. See migration 050 for why this is
        -- a local date the client sends rather than created_at::date.
        AND (r.starts_on IS NULL OR r.starts_on <= $2::date)
        AND (
              -- a one-off: open until its status says otherwise
              r.repeat = 'none'
              -- every day
              OR r.repeat = 'daily'
              -- Mon-Fri / Sat-Sun, read off the date itself so no calendar
              -- arithmetic happens in two places
              OR (r.repeat = 'weekdays' AND EXTRACT(ISODOW FROM $2::date) <= 5)
              OR (r.repeat = 'weekends' AND EXTRACT(ISODOW FROM $2::date) >= 6)
              -- the chosen weekdays; DOW is 0=Sunday, matching repeat_days
              OR (r.repeat = 'weekly'
                  AND r.repeat_days IS NOT NULL
                  AND EXTRACT(DOW FROM $2::date)::smallint = ANY (r.repeat_days))
              -- the same date each month, and the last day of a short month
              -- stands in for a 31st that does not exist
              OR (r.repeat = 'monthly'
                  AND EXTRACT(DAY FROM $2::date)
                      = LEAST(EXTRACT(DAY FROM COALESCE(r.starts_on, r.created_at::date)),
                              EXTRACT(DAY FROM (date_trunc('month', $2::date)
                                                + interval '1 month - 1 day'))))
            )
      ORDER BY r.created_at ASC
      LIMIT $4`,
    [owner, date, DONE_STATUSES, Math.max(1, Math.min(Number(limit) || 50, 200))],
  );

  return rows.map((r) => ({
    id: String(r.reminder_id),
    title: r.title ?? r.data?.title ?? r.data?.text ?? "Reminder",
    description: r.description ?? null,
    place: r.place ?? null,
    contactId: r.contact_id ? String(r.contact_id) : null,
    repeat: r.repeat ?? "none",
    repeatUntil: dateKey(r.repeat_until),
    repeatDays: Array.isArray(r.repeat_days) ? r.repeat_days.map(Number) : null,
    startsOn: dateKey(r.starts_on),
    notifyAtLocal: r.notify_at_local ? String(r.notify_at_local).slice(0, 5) : null,
    doneToday: r.done_today === true,
    createdAt: r.created_at,
  }));
}

/**
 * Tick a reminder off for one local day, or un-tick it.
 *
 * A REPEATING ONE IS NEVER MARKED DONE ON THE ROW. Writing status='done' would
 * end the series the first time the user actually drank the water, which is the
 * exact opposite of a daily reminder. The completion is a row keyed by date; the
 * one-off case also sets the status, because a one-off really is finished.
 */
export async function setReminderDoneOn(reminderId, ownerId, { onDate, done = true } = {}) {
  const owner = asUuid(ownerId);
  const date = cleanDate(onDate);
  const id = String(reminderId || "").trim();
  if (!owner || !date || !id) return false;

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT repeat FROM reminders WHERE reminder_id = $1 AND owner_id = $2`,
      [id, owner],
    );
    if (rows.length === 0) return false;
    const repeating = (rows[0].repeat ?? "none") !== "none";

    if (done) {
      await client.query(
        `INSERT INTO reminder_completions (reminder_id, owner_id, on_date)
         VALUES ($1,$2,$3::date)
         ON CONFLICT (reminder_id, on_date) DO NOTHING`,
        [id, owner, date],
      );
      if (!repeating) {
        await client.query(
          `UPDATE reminders SET status = 'done' WHERE reminder_id = $1 AND owner_id = $2`,
          [id, owner],
        );
      }
    } else {
      await client.query(
        `DELETE FROM reminder_completions WHERE reminder_id = $1 AND on_date = $2::date`,
        [id, date],
      );
      if (!repeating) {
        await client.query(
          `UPDATE reminders SET status = 'pending' WHERE reminder_id = $1 AND owner_id = $2`,
          [id, owner],
        );
      }
    }
    return true;
  });
}

/** Everything a person can change from the reminder editor. */
export async function updateReminderDetail(reminderId, ownerId, patch = {}) {
  const owner = asUuid(ownerId);
  const id = String(reminderId || "").trim();
  if (!owner || !id) return null;

  const sets = [];
  const vals = [id, owner];
  const put = (col, v, cast = "") => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}${cast}`);
  };

  if ("title" in patch) put("title", cleanText(patch.title, 200) || "Reminder");
  if ("description" in patch) put("description", cleanText(patch.description, 2000));
  if ("place" in patch) put("place", cleanText(patch.place, 200));
  if ("contactId" in patch) put("contact_id", asUuid(patch.contactId));
  // The lower bound moves on its own: unlike the three repeat columns below,
  // no CHECK binds it to anything, and "start it on Monday instead" is an edit
  // that has nothing to do with how often it repeats.
  if ("startsOn" in patch) put("starts_on", cleanDate(patch.startsOn), "::date");
  if ("notifyAtLocal" in patch) {
    const t = patch.notifyAtLocal;
    put("notify_at_local", typeof t === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(t) ? t : null, "::time");
  }

  // THE THREE REPEAT COLUMNS MOVE AS ONE. Two CHECKs bind them together --
  // repeat_until needs a repeat, repeat_days needs a weekly one -- so setting
  // the frequency without resetting the other two makes the database refuse the
  // whole update, and the user's edit fails with nothing to show for it.
  if ("repeat" in patch) {
    const rep = cleanRepeat(patch.repeat);
    put("repeat", rep);
    put("repeat_until", rep === "none" ? null : cleanDate(patch.repeatUntil), "::date");
    put("repeat_days", cleanRepeatDays(patch.repeatDays, rep), "::smallint[]");
  }

  if (sets.length === 0) return null;

  const { rows } = await query(
    `UPDATE reminders SET ${sets.join(", ")}
      WHERE reminder_id = $1 AND owner_id = $2
      RETURNING reminder_id`,
    vals,
  );
  return rows[0]?.reminder_id ?? null;
}

/** Remove a reminder outright, and its completion history with it. */
export async function deleteReminder(reminderId, ownerId) {
  const { rowCount } = await query(
    `DELETE FROM reminders WHERE reminder_id = $1 AND owner_id = $2`,
    [String(reminderId || "").trim(), asUuid(ownerId)],
  );
  return rowCount > 0;
}

/**
 * THE THINGS A "no, 7:30 in the morning" COULD BE TALKING ABOUT.
 *
 * Corrections used to be a reminder-only idea, because everything with a time
 * WAS a reminder. Now a stated time makes an event, so the thing the user is
 * most likely to be correcting is an event -- and without this, "no, make it
 * 7:30" produces a SECOND event rather than moving the first. A duplicate
 * appointment is a worse failure than the one the correction feature was built
 * to prevent, so the two lists are read together.
 *
 * IDS ARE PREFIXED so the route can tell them apart without a second lookup:
 * `rem_...` is a reminder row and `evt_<uuid>` is an event. The reminder ids
 * already carry their own prefix; the events borrow the shape.
 *
 * The window is deliberately narrow. A correction is something said seconds
 * after the thing it corrects; offering an hour of history invites the model to
 * "correct" an unrelated appointment that happens to share an hour.
 */
export async function listRecentCorrectableEvents(ownerId, { withinMinutes = 30, limit = 5 } = {}) {
  const owner = asUuid(ownerId);
  if (!owner) return [];
  const mins = Math.max(1, Math.min(Number(withinMinutes) || 30, 720));
  const lim = Math.max(1, Math.min(Number(limit) || 5, 20));
  try {
    const { rows } = await query(
      `SELECT event_id, title, scheduled_at
         FROM events
        WHERE owner_id = $1
          AND deleted_at IS NULL
          AND source = 'capture'
          AND scheduled_at IS NOT NULL
          AND created_at >= (now() - ($2 || ' minutes')::interval)
        ORDER BY created_at DESC
        LIMIT $3`,
      [owner, String(mins), lim],
    );
    return rows.map((r) => ({
      id: `evt_${r.event_id}`,
      title: r.title,
      fireAt: r.scheduled_at instanceof Date ? r.scheduled_at.toISOString() : r.scheduled_at,
    }));
  } catch {
    return [];
  }
}

/** `evt_<uuid>` -> the uuid, or null for anything else. */
export function eventIdFromCorrectsId(correctsId) {
  const t = String(correctsId || "").trim();
  if (!t.startsWith("evt_")) return null;
  return asUuid(t.slice(4));
}
