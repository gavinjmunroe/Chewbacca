/**
 * EVERYTHING AMBER HOLDS FOR ONE PERSON, IN ONE ROUND TRIP.
 *
 *   "Tell me about my contacts."   "Tell me about my network."
 *   "What is Amber?"               "What can Amber do for me?"
 *
 * These are the first questions a new user asks and the hardest to answer well,
 * because the honest answer is not a description of a product -- it is a
 * description of THEIR account. "You have 966 people, 134 of them with something
 * saved, four circles, one calendar connected and six things on your week" is an
 * answer no generic paragraph can compete with, and it is also the only kind
 * that is true for both a first-day user and a ten-year one.
 *
 * ONE QUERY, NOT TWELVE. Every count here is a subselect in a single statement.
 * Twelve round trips on a question somebody asks in their first minute is a
 * visible pause, and twelve separate helpers is twelve places for a filter to
 * drift from the read path it is supposed to mirror.
 *
 * EVERY FILTER IS COPIED FROM THE READ PATH IT DESCRIBES, and the comments say
 * which. A count that quietly disagrees with the screen it is describing is
 * worse than no count: the user can see the screen.
 */
import { query } from "./sql.js";

/**
 * A snapshot of the account, or null when it cannot be read.
 *
 * Null rather than zeroes, deliberately. Zero contacts is a real and meaningful
 * state -- it is a brand-new user, and Amber says so out loud -- so a failure
 * that returned zeroes would put "you have nobody yet" in front of somebody
 * holding three thousand people.
 */
export async function readAmberInventory(ownerId) {
  if (!ownerId) return null;
  try {
    const { rows } = await query(
      `SELECT
         -- CONTACTS. The same count getNetworkOverview reports, so the two can
         -- never disagree inside one answer.
         (SELECT count(*)::int FROM contacts
           WHERE owner_id = $1 AND deleted_at IS NULL) AS contacts,

         -- HOW MANY OF THEM CARRY ANYTHING. status='resolved' and a non-null
         -- contact_id are what make an observation a fact about a person; see
         -- db/gather.js.
         (SELECT count(DISTINCT contact_id)::int FROM observations
           WHERE owner_id = $1 AND deleted_at IS NULL
             AND status = 'resolved' AND contact_id IS NOT NULL) AS contacts_with_facts,

         -- AND HOW MUCH IS SAVED IN TOTAL, which is a different number and is
         -- the one that answers "how much have I told you".
         (SELECT count(*)::int FROM observations
           WHERE owner_id = $1 AND deleted_at IS NULL
             AND status = 'resolved') AS facts,

         (SELECT count(*)::int FROM circles
           WHERE owner_id = $1 AND deleted_at IS NULL) AS circles,

         -- Members are scoped through their circle and must still be live
         -- contacts: a circle whose people were deleted is an empty circle.
         (SELECT count(DISTINCT cm.contact_id)::int
            FROM circle_members cm
            JOIN circles ci ON ci.id = cm.circle_id
                           AND ci.owner_id = $1 AND ci.deleted_at IS NULL
            JOIN contacts c ON c.id = cm.contact_id AND c.deleted_at IS NULL) AS circle_members,

         -- EVENTS AHEAD OF THEM. scheduled_at IS NOT NULL is what separates a
         -- stated appointment from a note that merely mentioned a person, and
         -- the modality filter is db/agenda.js's ON_THE_DAY. Without the second
         -- one this reports "you have 400 things scheduled" to somebody who
         -- once said they should get coffee sometime.
         --
         -- In THIS subselect the null check is implied by the range comparison
         -- below it, and it is written out anyway so the two event counts read
         -- as the same question asked twice. In the total underneath, where
         -- there is no range, it is the only thing standing between a calendar
         -- and a diary.
         (SELECT count(*)::int FROM events
           WHERE owner_id = $1 AND deleted_at IS NULL
             AND scheduled_at IS NOT NULL
             AND modality IN ('actual','planned')
             AND scheduled_at >= now()
             AND scheduled_at < now() + interval '7 days') AS events_next_7d,

         (SELECT count(*)::int FROM events
           WHERE owner_id = $1 AND deleted_at IS NULL
             AND scheduled_at IS NOT NULL
             AND modality IN ('actual','planned')) AS events_total,

         -- REMINDERS, split the way the app splits them: a due_at is a thing at
         -- a time, no due_at is an open item at the top of Notes & Journal.
         -- DONE_STATUSES in db/schedule-store.js.
         (SELECT count(*)::int FROM reminders
           WHERE owner_id = $1 AND due_at IS NULL
             AND COALESCE(status, '') NOT IN ('done','completed')) AS open_reminders,

         (SELECT count(*)::int FROM reminders
           WHERE owner_id = $1 AND due_at IS NOT NULL
             AND COALESCE(status, '') NOT IN ('done','completed')
             AND due_at >= now()) AS timed_reminders_ahead,

         -- disabled_at, NOT deleted_at. calendar_accounts spells its soft delete
         -- differently and a copied filter would count disconnected accounts.
         (SELECT count(*)::int FROM calendar_accounts
           WHERE owner_id = $1 AND disabled_at IS NULL) AS calendar_accounts,

         -- Voice notes: conversations of kind 'note'. A 'chat' row is an Ask
         -- thread and is not something they recorded.
         (SELECT count(*)::int FROM conversations
           WHERE owner_id = $1 AND deleted_at IS NULL AND kind = 'note') AS voice_notes,

         -- OTHER AMBER USERS THEY ARE CONNECTED TO. status='active' is what
         -- deleted_at means on this table; rows are canonicalized on insert, so
         -- the OR cannot double count.
         (SELECT count(*)::int FROM connections
           WHERE (a_amber_id = $1 OR b_amber_id = $1) AND status = 'active') AS amber_connections,

         -- Waiting on THEM, so it is addressee_amber_id: a request they sent is
         -- not something they can act on.
         (SELECT count(*)::int FROM connection_requests
           WHERE addressee_amber_id = $1 AND status = 'pending'
             AND deleted_at IS NULL) AS pending_requests
      `,
      [ownerId],
    );
    const r = rows[0];
    if (!r) return null;
    const n = (v) => Number(v ?? 0);
    return {
      contacts: n(r.contacts),
      contactsWithFacts: n(r.contacts_with_facts),
      facts: n(r.facts),
      circles: n(r.circles),
      circleMembers: n(r.circle_members),
      eventsNext7d: n(r.events_next_7d),
      eventsTotal: n(r.events_total),
      openReminders: n(r.open_reminders),
      timedRemindersAhead: n(r.timed_reminders_ahead),
      calendarAccounts: n(r.calendar_accounts),
      voiceNotes: n(r.voice_notes),
      amberConnections: n(r.amber_connections),
      pendingRequests: n(r.pending_requests),
    };
  } catch (e) {
    console.error(`READ_AMBER_INVENTORY_ERR ${e?.message || e}`);
    return null;
  }
}
