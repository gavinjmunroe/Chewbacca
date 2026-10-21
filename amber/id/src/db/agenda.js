import { query } from "./sql.js";

/**
 * WHAT IS ON SOMEBODY'S DAY, from the things Amber itself knows.
 *
 * The `events` table has existed since migration 008 -- owner, the person it is
 * with, a title, a start, an end and a place -- and it is written whenever
 * capture hears a plan ("coffee with Mina at ten"). Nothing has ever read it
 * back to a screen. There is no route, and `contact-rollup.js` is its only
 * reader. So the app has been quietly recording somebody's plans and then never
 * showing them their day.
 *
 * THIS IS ONE OF TWO SOURCES, AND DELIBERATELY THE SMALLER ONE. The device's
 * own calendar is the other, read on the phone through expo-calendar, and it is
 * where real meetings with real locations and real conference links live. This
 * one carries what Amber was told directly, which the calendar cannot know. The
 * merge happens on the client, in lib/agenda.ts, because only the client can
 * see the device calendar -- and the merge is a pure function there so it can be
 * tested without either.
 *
 * MODALITY MATTERS. The events table records `planned`, `actual`,
 * `hypothetical`, `desired`, `available` and `declined`, and only some of those
 * belong on a day view. "We should get coffee sometime" is a `desired` event
 * with a made-up timestamp; putting it on Tuesday at ten as though it were
 * arranged is worse than not showing it.
 */

/**
 * A `date` column comes back from node-postgres as a Date at LOCAL midnight, so
 * the obvious String(...).slice(0, 10) yields "Sun Sep 13" -- ten characters
 * that look like a date and are not one. Same reader as db/schedule-store.js,
 * and the same bug it was written for.
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

/** The modalities that mean a real, placed commitment. */
const ON_THE_DAY = ["actual", "planned"];

/**
 * AND A MODALITY IS NOT ENOUGH, WHICH IS THE OTHER HALF OF THE FILTER.
 *
 * "The calendar should be for things that are scheduled in my life. Bo and
 *  Emily moving together is definitely not a calendar item. Neither is the fact
 *  that Shirley and Caleb are working with me. Neither is the fact that I'm
 *  going to Bedstuy to see a friend. These are just journals I was giving about
 *  my plans for the day."
 *
 * Every one of those was an `actual` experience with a person in it, so every
 * one passed the modality test above and landed on the day it was spoken --
 * because `events.starts_at` falls back to the moment of capture. Modality says
 * what KIND of claim this is; it has never said whether anybody named a time,
 * and whether anybody named a time is the entire question a day view asks.
 *
 * `scheduled_at` (migration 048) answers it: set when a time was actually
 * stated, or when the row came from a real calendar, and NULL otherwise. The
 * events are untouched and still feed contact-rollup, so an evening with
 * Shirley still counts toward Shirley -- it just stops claiming to be an
 * appointment.
 *
 * ORDERED AND BOUNDED BY scheduled_at TOO, not by starts_at. Two columns, one
 * of them a capture timestamp, is exactly how a row shows up inside the window
 * on one and outside it on the other -- an item that sorts into a day it is not
 * in. The day view uses one clock throughout.
 */

/**
 * Events between two instants, for one owner.
 *
 * Bounds are half-open [from, to): a day is [midnight, next midnight), and a
 * closed upper bound would show midnight twice on consecutive days.
 *
 * THE TIMEZONE IS THE CALLER'S PROBLEM, on purpose. The client knows what "this
 * day" means where the person is standing; the server does not, and a server
 * that guesses shows the wrong day to anybody traveling. The route takes two
 * instants and this takes two instants.
 */
export async function listAgendaEvents(ownerId, { from, to, limit = 200 } = {}) {
  if (!ownerId || !from || !to) return [];
  try {
    const { rows } = await query(
      `SELECT e.event_id, e.title, e.kind, e.modality,
              e.scheduled_at AS starts_at, e.ends_at, e.source AS provider,
              -- THE FIELDS THE EDITOR OPENS ON. Without them the editor has to
              -- draw defaults, so a weekly event opens reading "Does not
              -- repeat" and a described one opens blank -- a wrong fact on the
              -- screen, and one keystroke away from being saved as true.
              e.description, e.all_day, e.repeat, e.repeat_until,
              e.notify_minutes_before, e.place AS place_text,
              e.contact_id,
              (SELECT COALESCE(json_agg(json_build_object('contactId', pc.id, 'name', pc.full_name)), '[]'::json)
                FROM event_participants ep JOIN contacts pc ON pc.id = ep.contact_id AND pc.owner_id = ep.owner_id AND pc.deleted_at IS NULL
                WHERE ep.event_id = e.event_id AND ep.owner_id = e.owner_id) AS people,
              c.full_name        AS contact_name,
              c.avatar_url       AS contact_avatar,
              c.linked_amber_id  AS contact_amber_id,
              e.circle_id,
              ci.name            AS circle_name,
              p.name             AS place_name,
              p.city             AS place_city
         FROM events e
         LEFT JOIN contacts c ON c.id = e.contact_id AND c.deleted_at IS NULL
         LEFT JOIN circles ci ON ci.id = e.circle_id AND ci.deleted_at IS NULL
         LEFT JOIN places p   ON p.place_id = e.place_id
        WHERE e.owner_id = $1
          AND e.deleted_at IS NULL
          AND e.modality = ANY($4::text[])
          AND e.scheduled_at IS NOT NULL
          AND e.scheduled_at >= $2::timestamptz
          AND e.scheduled_at <  $3::timestamptz
        ORDER BY e.scheduled_at ASC
        LIMIT $5`,
      [ownerId, from, to, ON_THE_DAY, Math.min(Math.max(Number(limit) || 200, 1), 500)],
    );
    return rows.map((r) => ({
      id: String(r.event_id),
      source: "amber",
      people: r.people ?? [],
      provider: r.provider ?? "capture",
      title: r.title ?? null,
      kind: r.kind ?? null,
      startsAt: r.starts_at,
      endsAt: r.ends_at ?? null,
      description: r.description ?? null,
      allDay: r.all_day === true,
      repeat: r.repeat ?? "none",
      // A date column comes back as a Date, so it goes through the same reader
      // the schedule store uses. String(...).slice(0, 10) on a Date is "Sun Sep
      // 13", which shipped once already.
      repeatUntil: dateKey(r.repeat_until),
      notifyMinutesBefore:
        r.notify_minutes_before === null || r.notify_minutes_before === undefined
          ? null
          : Number(r.notify_minutes_before),
      /**
       * The place as TEXT, which is not the same as the joined place row below.
       * `place_id` points at a resolved place; `place` is what the user said
       * when nothing resolved. The editor writes the text one, so it has to
       * read the text one or every save would silently move the location.
       */
      placeText: r.place_text ?? null,
      /**
       * WHO IT IS WITH. The contact card, and the account behind it when the
       * two have been reconciled -- so the day view can open the person rather
       * than print a name.
       */
      withPerson: r.contact_id
        ? {
            contactId: String(r.contact_id),
            name: r.contact_name ?? null,
            avatarUrl: r.contact_avatar ?? null,
            amberId: r.contact_amber_id ? String(r.contact_amber_id) : null,
          }
        : null,
      withCircle: r.circle_id ? { circleId: String(r.circle_id), name: r.circle_name ?? null } : null,
      /**
       * WHERE. A place row, when capture resolved one.
       *
       * There is NO virtual/in-person flag on this table and this does not
       * invent one. A `places` row is a physical place, so a place means in
       * person; no place means Amber was not told, which is not the same as
       * virtual. The device calendar carries a real conference link and that is
       * where "virtual" can be said honestly -- see lib/agenda.ts.
       */
      place: r.place_name ? { name: r.place_name, city: r.place_city ?? null } : null,
    }));
  } catch (e) {
    console.error(`LIST_AGENDA_EVENTS_ERR ${e?.message || e}`);
    return [];
  }
}

/**
 * Reminders with a time, in a window.
 *
 * THE SPLIT THAT MATTERS: a reminder with a `due_at` is a thing at a time and
 * belongs on the day; a reminder without one -- "remind me to eventually start
 * studying for the LSAT" -- is a note to self and belongs in Notes & Journal.
 * The column is nullable and has been all along, so the distinction is already
 * in the data and nothing had ever read it that way.
 */
/** The two status values that mean a reminder is finished with. */
const DONE_STATUSES = ["done", "completed"];

/**
 * Reminders with a time on them, for one day.
 *
 * WITH `includeOverdue`, ALSO EVERY OPEN ONE FROM BEFORE THE WINDOW.
 *
 *   "Reminders that should persist across days are anything with an open tag
 *    that didn't get completed. If it's something like 'text mom about the trip'
 *    and that wasn't completed, then that should persist."
 *
 * A reminder was previously visible on exactly the day it was due and nowhere
 * else, so missing it once made it disappear -- which is the opposite of what a
 * reminder is for. An open one now travels forward until it is ticked off.
 *
 * ONLY INTO THE WINDOW THAT CONTAINS NOW, and the route decides that rather than
 * the client (see routes/agenda.js). Scrolling back to last Tuesday has to show
 * last Tuesday; a pile of everything still open, restated on every past day, is
 * a different screen and a worse one. And carrying them into FUTURE days would
 * put a thing that is already late on a day that has not happened yet.
 *
 * Done ones are never carried. That is the whole of "if that's checked, then
 * that goes away".
 */
export async function listScheduledReminders(
  ownerId,
  { from, to, limit = 200, includeOverdue = false } = {},
) {
  if (!ownerId || !from || !to) return [];
  try {
    const { rows } = await query(
      `SELECT reminder_id, due_at, status, data
         FROM reminders
        WHERE owner_id = $1
          AND due_at IS NOT NULL
          -- AN EVENT'S OWN NOTIFICATION IS NOT A REMINDER. It is a delivery row
          -- written beside the event so one scheduler can send both (see
          -- buildSelfReminderRow). Listing it here would put "Meeting" on the
          -- day twice: once as the event and once as the alert about it.
          AND COALESCE(data ->> 'kind', 'reminder') <> 'event_notification'
          AND due_at < $3::timestamptz
          AND (
                due_at >= $2::timestamptz
                OR ($4::boolean AND COALESCE(status, '') <> ALL ($5::text[]))
              )
        /*
         * THE DAY ITSELF FIRST, THEN THE BACKLOG -- because of the LIMIT.
         *
         * Plain due_at ASC is oldest-first, and the moment overdue reminders
         * join the result they are ALL older than everything on the day. Someone
         * carrying two hundred open reminders would get two hundred old ones and
         * none of today's meetings: the cap would silently eat the actual day.
         *
         * This is not the display order -- the client hoists carried-over rows to
         * the top of the day (see sortAgenda in lib/agenda.ts). It is about which
         * rows survive being cut off, and the day you are looking at has to be
         * among them.
         */
        ORDER BY (due_at >= $2::timestamptz) DESC, due_at ASC
        LIMIT $6`,
      [
        ownerId,
        from,
        to,
        includeOverdue === true,
        DONE_STATUSES,
        Math.min(Math.max(Number(limit) || 200, 1), 500),
      ],
    );
    const windowStart = new Date(from).getTime();
    return rows.map((r) => {
      const dueMs = r.due_at instanceof Date ? r.due_at.getTime() : new Date(r.due_at).getTime();
      return {
        id: String(r.reminder_id),
        source: "reminder",
        title: r.data?.text ?? r.data?.title ?? r.data?.body ?? null,
        startsAt: r.due_at,
        endsAt: null,
        status: r.status ?? null,
        done: DONE_STATUSES.includes(r.status),
        /**
         * Due before the window it is being returned for. The client is TOLD
         * rather than left to infer it: inferring means comparing against the
         * same day boundary the server was handed, and a day boundary is a
         * timezone question that only one of the two should be answering.
         */
        carriedOver: Number.isFinite(dueMs) && dueMs < windowStart,
        withPerson: null,
        withCircle: null,
        place: null,
      };
    });
  } catch (e) {
    console.error(`LIST_SCHEDULED_REMINDERS_ERR ${e?.message || e}`);
    return [];
  }
}
