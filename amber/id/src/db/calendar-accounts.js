import { query } from "./sql.js";

/**
 * CONNECTED CALENDARS, AND THE EVENTS THEY BRING IN.
 *
 * "Allow the ability to connect multiple Google calendars, like your work
 *  Google Calendar, your personal Google Calendar, etc., Outlook calendar,
 *  anything."
 *
 * WHY THIS TABLE EXISTS. Google tokens have lived in the per-user secrets bag
 * under fixed names -- GCAL_OAUTH_REFRESH_TOKEN and friends. One name, one slot:
 * connecting a second Google account overwrote the first with no error, so the
 * work calendar silently replaced the personal one. A bag of named secrets
 * cannot hold a list, so the list needed a table. See migration 046.
 *
 * WHERE THE EVENTS GO IS THE IMPORTANT PART, and it is not here. A synced
 * meeting is written to `events` -- the same table capture writes to -- and NOT
 * to a calendar_events table of its own. That is deliberate and it is the whole
 * reason this is worth building:
 *
 *   contact-rollup.js already reads `events` into contact_interaction_stats.
 *   Those stats feed contact_scores, which is what PeopleRank ranks on, which
 *   is what the dimensions of health and every "who should I reach out to"
 *   answer are computed from.
 *
 * So a lunch with Mina that came off your work Google counts as an interaction
 * with Mina exactly the way "had lunch with Mina" said out loud does. A parallel
 * table would have made connecting a calendar make the graph WORSE -- half of
 * somebody's real life sitting in a store nothing consults, while the model
 * concluded they had drifted from everybody they actually see.
 *
 * THE PRICE OF THAT DECISION is that a synced row has to be tellable apart from
 * a captured one, or a re-sync duplicates Tuesday and a disconnect cannot find
 * what to withdraw. Three columns on `events` do that: `source`, `external_id`
 * and `calendar_account_id`, with a partial unique index on the last two.
 */

const PROVIDERS = new Set(["google", "microsoft"]);

/** Is this a provider Amber can actually talk to? */
export function isCalendarProvider(p) {
  return typeof p === "string" && PROVIDERS.has(p);
}

/**
 * An email, folded so two spellings of one address compare equal.
 *
 * Addresses arrive from three places that disagree about case -- an id token, a
 * calendar attendee list, and whatever somebody typed into their phone -- and
 * `Me@Work.com` connecting a second time must be an UPDATE of `me@work.com`,
 * not a second account with the same inbox behind it.
 */
export function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * Connect an account, or re-connect one that is already there.
 *
 * AN UPSERT, because re-consenting is the common case -- a token expires, a
 * scope is added, somebody taps the button twice -- and every one of those
 * producing a second row would double that calendar's events on the next sync.
 *
 * A RECONNECT CLEARS `disabled_at` and `last_error`. Reconnecting is exactly
 * what somebody does about a broken connection, and leaving it marked failed
 * would show them a red account they had just fixed.
 */
export async function connectCalendarAccount(ownerId, input = {}) {
  const email = normalizeEmail(input.accountEmail);
  if (!ownerId || !isCalendarProvider(input.provider) || !email) return null;
  try {
    const { rows } = await query(
      `INSERT INTO calendar_accounts
         (owner_id, provider, account_email, display_name,
          refresh_token, access_token, expires_at, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (owner_id, provider, account_email) DO UPDATE SET
         display_name  = COALESCE(EXCLUDED.display_name, calendar_accounts.display_name),
         -- A refresh token is only issued on FIRST consent for Google. A
         -- re-consent that returns none must not blank the one we hold, or the
         -- account silently stops refreshing an hour later.
         refresh_token = COALESCE(EXCLUDED.refresh_token, calendar_accounts.refresh_token),
         access_token  = EXCLUDED.access_token,
         expires_at    = EXCLUDED.expires_at,
         scopes        = COALESCE(EXCLUDED.scopes, calendar_accounts.scopes),
         disabled_at   = NULL,
         last_error    = NULL,
         connected_at  = now()
       RETURNING id, provider, account_email, display_name, connected_at, synced_at, last_error`,
      [
        ownerId,
        input.provider,
        email,
        input.displayName ?? null,
        input.refreshToken ?? null,
        input.accessToken ?? null,
        input.expiresAt ?? null,
        input.scopes ?? null,
      ],
    );
    return rows[0] ? shape(rows[0]) : null;
  } catch (e) {
    console.error(`CONNECT_CALENDAR_ACCOUNT_ERR ${e?.message || e}`);
    return null;
  }
}

/**
 * The accounts somebody has connected.
 *
 * NO TOKENS IN THE ANSWER. This is what the settings screen renders, and a
 * refresh token has no business crossing the wire to a phone that has no use
 * for it. The sync reads them through readSyncable below, server-side.
 */
export async function listCalendarAccounts(ownerId) {
  if (!ownerId) return null;
  try {
    const { rows } = await query(
      `SELECT id, provider, account_email, display_name, connected_at, synced_at, last_error
         FROM calendar_accounts
        WHERE owner_id = $1 AND disabled_at IS NULL
        ORDER BY connected_at ASC`,
      [ownerId],
    );
    return rows.map(shape);
  } catch (e) {
    console.error(`LIST_CALENDAR_ACCOUNTS_ERR ${e?.message || e}`);
    return null;
  }
}

/** The same rows WITH tokens, for the sync. Never reachable from a route. */
export async function readSyncableAccounts(ownerId = null) {
  try {
    const { rows } = await query(
      `SELECT id, owner_id, provider, account_email, refresh_token, access_token,
              expires_at, scopes, sync_token
         FROM calendar_accounts
        WHERE disabled_at IS NULL
          AND refresh_token IS NOT NULL
          AND ($1::uuid IS NULL OR owner_id = $1::uuid)
        ORDER BY COALESCE(synced_at, to_timestamp(0)) ASC`,
      [ownerId],
    );
    return rows;
  } catch (e) {
    console.error(`READ_SYNCABLE_ACCOUNTS_ERR ${e?.message || e}`);
    return [];
  }
}

/**
 * Disconnect. A DELETE, not a flag, and the events go with it.
 *
 * `events.calendar_account_id` is ON DELETE CASCADE, so disconnecting your work
 * calendar removes the meetings it brought and leaves everything else --
 * captured events, the other account's events -- exactly where it was. A flag
 * would leave those meetings on somebody's day view forever with no way to
 * explain where they came from.
 */
export async function disconnectCalendarAccount(ownerId, accountId) {
  if (!ownerId || !accountId) return false;
  try {
    const { rowCount } = await query(
      `DELETE FROM calendar_accounts WHERE id = $1 AND owner_id = $2`,
      [accountId, ownerId],
    );
    return rowCount > 0;
  } catch (e) {
    console.error(`DISCONNECT_CALENDAR_ACCOUNT_ERR ${e?.message || e}`);
    return false;
  }
}

/** Record how a sync went, so a dead connection can say it is dead. */
export async function recordSync(
  accountId,
  { syncToken = null, error = null } = {},
) {
  if (!accountId) return;
  try {
    await query(
      `UPDATE calendar_accounts
          SET synced_at  = now(),
              sync_token = COALESCE($2, sync_token),
              last_error = $3
        WHERE id = $1`,
      [accountId, syncToken, error],
    );
  } catch (e) {
    console.error(`RECORD_SYNC_ERR ${e?.message || e}`);
  }
}

/**
 * WHICH OF MY CONTACTS IS THIS MEETING WITH?
 *
 * THE WHOLE POINT OF SYNCING, and the reason it is done here rather than left
 * to the client. An event that is not attached to a contact is a rectangle on a
 * day view; an event attached to Mina is an interaction with Mina, and
 * contact-rollup turns it into her interaction stats, her score, her rank and
 * her place in the dimensions.
 *
 * MATCHED ON EMAIL, which is the only identifier a calendar invite reliably
 * carries. `contacts.emails` is a comma-separated TEXT column -- not an array,
 * which is a mistake this codebase has made before -- so the match is done by
 * splitting it server-side rather than with an array operator that would
 * silently compare a string to a list.
 *
 * THE ORGANIZER AND THE VIEWER THEMSELVES ARE EXCLUDED. Every invite has the
 * owner on it, and matching that to the owner's own contact card (people do have
 * one) would credit somebody with a meeting with themselves every day.
 *
 * ONE CONTACT, NOT MANY, because `events.contact_id` holds one. Everybody else
 * on the invite goes to `event_participants`, which contact-rollup also reads --
 * so a four-person dinner counts for all four.
 */
export async function matchAttendeesToContacts(
  ownerId,
  emails = [],
  { selfEmails = [] } = {},
) {
  const wanted = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  const mine = new Set(selfEmails.map(normalizeEmail).filter(Boolean));
  const candidates = wanted.filter((e) => !mine.has(e));
  if (!ownerId || candidates.length === 0) return [];
  try {
    const { rows } = await query(
      `SELECT c.id, lower(trim(e.email)) AS email
         FROM contacts c
         CROSS JOIN LATERAL unnest(string_to_array(COALESCE(c.emails, ''), ',')) AS e(email)
        WHERE c.owner_id = $1
          AND c.deleted_at IS NULL
          AND lower(trim(e.email)) = ANY($2::text[])`,
      [ownerId, candidates],
    );
    // Deduped by contact: one card carrying two of the invited addresses is one
    // person at the meeting, not two.
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const id = String(r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ contactId: id, email: r.email });
    }
    return out;
  } catch (e) {
    console.error(`MATCH_ATTENDEES_ERR ${e?.message || e}`);
    return [];
  }
}

/**
 * Write one synced event into `events`, and its other attendees into
 * `event_participants`.
 *
 * AN UPSERT ON (calendar_account_id, external_id). A calendar sync runs again
 * and again over the same events; without the upsert a nightly refresh adds a
 * fresh copy of every recurring standup forever.
 *
 * MODALITY IS `planned` OR `actual` BY TIME, not by anything the provider says.
 * The events table has six modalities and only those two mean a real, placed
 * commitment -- which is exactly what a calendar entry is. Past is actual,
 * future is planned, and contact-rollup counts only the ones that have already
 * happened, so a year of future meetings cannot inflate anybody's rank.
 *
 * A CANCELLED EVENT IS A SOFT DELETE, not a skipped write: it may already be in
 * the table from a previous sync, and leaving it there would keep a meeting on
 * somebody's day that they know was called off.
 */
export async function upsertSyncedEvent(ownerId, accountId, ev = {}, run = query) {
  if (
    !ownerId ||
    !accountId ||
    !ev?.externalId ||
    (!ev?.startsAt && !ev.cancelled)
  )
    return null;
  try {
    if (ev.cancelled) {
      await run(
        `UPDATE events SET deleted_at = now()
          WHERE calendar_account_id = $1 AND external_id = $2 AND owner_id = $3 AND deleted_at IS NULL`,
        [accountId, String(ev.externalId), ownerId],
      );
      return { cancelled: true };
    }

    const starts = new Date(ev.startsAt);
    if (Number.isNaN(starts.getTime())) return null;
    const modality = starts.getTime() <= Date.now() ? "actual" : "planned";

    const { rows } = await run(
      /**
       * scheduled_at IS starts_at HERE, ALWAYS, and that is not redundancy.
       *
       * Migration 048 made the day view select on scheduled_at rather than on
       * starts_at, because a captured note falls back to the moment it was
       * spoken and every one of them was landing on today. A row that came out
       * of somebody's Google or Outlook calendar has no such doubt -- it IS an
       * appointment, by construction, and a person put a time on it themselves.
       *
       * Writing it here rather than defaulting the column is what keeps the
       * distinction meaningful: a default would set it on captured events too,
       * and the day view would be back to showing "Shirley and Caleb are working
       * with me" at half past four.
       */
      `INSERT INTO events
         (owner_id, contact_id, title, kind, modality, starts_at, ends_at,
          source, external_id, calendar_account_id, scheduled_at, all_day, place, description,
          attendees, organizer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $6, $11, $12, $13, $14::jsonb, $15)
       ON CONFLICT (calendar_account_id, external_id)
         WHERE calendar_account_id IS NOT NULL AND external_id IS NOT NULL
       DO UPDATE SET
         title        = EXCLUDED.title,
         all_day      = EXCLUDED.all_day,
         place        = EXCLUDED.place,
         description  = EXCLUDED.description,
         kind         = EXCLUDED.kind,
         modality     = EXCLUDED.modality,
         starts_at    = EXCLUDED.starts_at,
         scheduled_at = EXCLUDED.scheduled_at,
         ends_at      = EXCLUDED.ends_at,
         -- A contact match can improve between syncs (they add an email to the
         -- card), so a later match wins -- but a later NON-match must not erase
         -- one we already have.
         contact_id   = COALESCE(EXCLUDED.contact_id, events.contact_id),
         -- Same rule as contact_id, for the same reason: a re-sync that comes
         -- back without the guest list (a permissions change, a provider
         -- hiccup) must not erase the one we already have.
         attendees    = COALESCE(EXCLUDED.attendees, events.attendees),
         organizer    = COALESCE(EXCLUDED.organizer, events.organizer),
         -- Re-appearing after a cancellation is a real thing calendars do.
         deleted_at   = NULL
       RETURNING event_id`,
      [
        ownerId,
        ev.contactId ?? null,
        ev.title ?? null,
        ev.kind ?? null,
        modality,
        starts.toISOString(),
        ev.endsAt ?? null,
        ev.provider ?? "google",
        String(ev.externalId),
        accountId,
        ev.allDay === true,
        ev.place ?? null,
        ev.description ?? null,
        /*
         * THE RAW GUEST LIST, kept precisely because the matcher above could
         * not place it. A consumer that does not exist yet -- the company
         * ledger did not, when this sync was written -- needs the input, not
         * only the conclusions drawn from it at the time.
         */
        Array.isArray(ev.attendees) && ev.attendees.length > 0
          ? JSON.stringify(ev.attendees)
          : null,
        ev.organizer ?? null,
      ],
    );
    const eventId = rows[0]?.event_id ? String(rows[0].event_id) : null;
    if (!eventId) return null;

    /**
     * EVERYBODY ELSE AT THE MEETING. contact-rollup reads event_participants
     * alongside events, so a dinner with four people counts as an interaction
     * with all four rather than only with whoever happened to sort first.
     *
     * Rewritten rather than merged: the attendee list is the provider's, it can
     * shrink, and a participant who was uninvited must not stay on the row.
     */
    // A write-back response may omit attendees entirely; absence is not an empty list.
    if (!Array.isArray(ev.participantContactIds)) return { eventId };
    // Provider refreshes can remove provider attendees, but never reviewed memo associations.
    await run(`DELETE FROM event_participants ep WHERE ep.event_id = $1 AND ep.owner_id = $2
      AND NOT EXISTS (
        SELECT 1 FROM observations o JOIN observation_participants op ON op.observation_id = o.observation_id AND op.owner_id = o.owner_id
        WHERE o.event_id = ep.event_id AND o.owner_id = ep.owner_id AND op.contact_id = ep.contact_id
          AND o.source_conversation_id IS NOT NULL AND o.deleted_at IS NULL
      )`, [eventId, ownerId]);
    const others = (ev.participantContactIds ?? []).filter(
      (id) => id && id !== ev.contactId,
    );
    if (others.length > 0) {
      await run(
        `INSERT INTO event_participants (event_id, owner_id, contact_id)
         SELECT $1, $2, unnest($3::uuid[])
         ON CONFLICT DO NOTHING`,
        [eventId, ownerId, others],
      );
    }
    return { eventId };
  } catch (e) {
    console.error(`UPSERT_SYNCED_EVENT_ERR ${e?.message || e}`);
    return null;
  }
}

function shape(r) {
  return {
    id: String(r.id),
    provider: r.provider,
    accountEmail: r.account_email,
    displayName: r.display_name ?? null,
    connectedAt: r.connected_at,
    syncedAt: r.synced_at ?? null,
    lastError: r.last_error ?? null,
  };
}
