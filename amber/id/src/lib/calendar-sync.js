import { readGoogleCalendars } from "./google-calendar-read.js";
import { noteNames } from "../db/observed-names.js";
/**
 * PULLING A CONNECTED CALENDAR INTO `events`.
 *
 * Two providers, one shape. Google Calendar and Microsoft Graph disagree about
 * every field name and agree about every concept, so each has a reader that
 * turns its own JSON into the same small object and everything after that is
 * shared.
 *
 * WHAT THIS IS FOR, restated because it is easy to lose: the point is not a
 * prettier day view. `events` is what contact-rollup reads into
 * contact_interaction_stats, which is what contact_scores is built from, which
 * is what PeopleRank ranks and what the dimensions of health are computed
 * against. A meeting with Mina that came off somebody's work Google has to
 * count as an interaction with Mina exactly the way "had lunch with Mina" said
 * out loud does -- otherwise connecting a calendar makes the graph WORSE, by
 * putting half of somebody's real life in a place nothing consults.
 *
 * That is why the attendee matching in db/calendar-accounts.js matters more
 * than anything in this file. A synced event with no contact on it is a
 * rectangle; a synced event attached to a contact is a relationship.
 *
 * NOTHING HERE THROWS. A calendar is somebody else's server: tokens expire, an
 * admin revokes an app, Graph rate-limits, a tenant blocks the scope. Every one
 * of those is a stale day, not a crashed job, so failures are recorded on the
 * account (`last_error`) and the next account is attempted.
 */
import {
  matchAttendeesToContacts,
  recordSync,
  upsertSyncedEvent,
} from "../db/calendar-accounts.js";

/** How far back and forward a sync reaches. */
const PAST_DAYS = 60;
const FUTURE_DAYS = 120;
/** Never write more than this from one account in one pass. */
const MAX_EVENTS = 2500;

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MICROSOFT_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/**
 * A fresh access token for one account.
 *
 * ALWAYS REFRESHED rather than trusting `expires_at`. The stored expiry is
 * whatever the provider said an hour ago and the clock here is not theirs; a
 * refresh costs one request and removes a whole class of "it worked yesterday".
 */
/**
 * The app's OAuth credentials for a provider.
 *
 * READ THROUGH A FUNCTION, and the function is injectable, because the first
 * version of this read process.env directly -- which made every test in
 * calendar-sync.test.js pass or fail depending on whether the shell that ran it
 * happened to have GOOGLE_OAUTH_CLIENT_ID set. They passed for me and failed in
 * the suite, which is the definition of a test that is not testing the code.
 *
 * THE MICROSOFT NAMES ARE MS_OAUTH_*, not MICROSOFT_OAUTH_*: written out rather
 * than guessed, because src/oauth/microsoft/callback.js mirrors exactly those
 * two names, and a sync reading a different one would refresh nothing and
 * report "could not refresh access token" on a perfectly healthy account.
 */
export function credentialsFromEnv(provider, env = process.env) {
  return provider === "google"
    ? {
        clientId: env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      }
    : {
        clientId: env.MS_OAUTH_CLIENT_ID,
        clientSecret: env.MS_OAUTH_CLIENT_SECRET,
      };
}

/** Shared Google token refresh for calendar and Gmail sync. */
export async function accessTokenFor(
  account,
  fetchImpl = fetch,
  credentials = credentialsFromEnv,
) {
  const google = account.provider === "google";
  const url = google ? GOOGLE_TOKEN_URL : MICROSOFT_TOKEN_URL;
  const { clientId, clientSecret } = credentials(account.provider) ?? {};
  if (!clientId || !clientSecret || !account.refresh_token) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: account.refresh_token,
    grant_type: "refresh_token",
  });
  // Graph rejects a refresh that does not restate the scope it was granted.
  if (!google && account.scopes) body.set("scope", account.scopes);

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return json?.access_token ?? null;
}

/**
 * The window a sync asks for, as two instants.
 *
 * SIXTY DAYS BACK IS RIGHT FOR A DAY VIEW AND WRONG FOR MEMORY, which is why
 * it is a parameter now. A calendar screen needs recent and upcoming and
 * should not pay to fetch 2019. A relationship ledger needs everything: the
 * whole point is a contact you have not spoken to in eight months, and a
 * sixty-day window cannot see one by construction.
 *
 * So the routine sync keeps its cheap window and the backfill asks for years,
 * once.
 */
function window(now = Date.now(), pastDays = PAST_DAYS, futureDays = FUTURE_DAYS) {
  return {
    from: new Date(now - pastDays * 86400_000).toISOString(),
    to: new Date(now + futureDays * 86400_000).toISOString(),
  };
}

/**
 * GOOGLE'S SHAPE.
 *
 * `singleEvents=true` is not optional: without it a weekly standup arrives as
 * ONE row with a recurrence rule, and every Tuesday of it would be missing from
 * the day view. With it, each occurrence is its own event with its own id --
 * which is also what makes the upsert key stable.
 */
async function readGoogle(token, fetchImpl = fetch, opts = {}) {
  return readGoogleCalendars(
    token,
    window(Date.now(), opts.pastDays, opts.futureDays),
    fetchImpl,
    opts.maxEvents ?? 2500,
  );
}

/** MICROSOFT'S SHAPE. calendarView expands recurrences, as singleEvents does. */
async function readMicrosoft(token, fetchImpl = fetch, opts = {}) {
  const { from, to } = window(Date.now(), opts.pastDays, opts.futureDays);
  const url =
    "https://graph.microsoft.com/v1.0/me/calendarView" +
    `?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}` +
    `&$top=250&$orderby=start/dateTime`;
  const res = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${token}`,
      prefer: 'outlook.timezone="UTC"',
    },
  });
  if (!res.ok) throw new Error(`microsoft ${res.status}`);
  const json = await res.json().catch(() => ({}));
  return (json.value ?? []).map((e) => ({
    externalId: String(e.id ?? ""),
    title: (e.subject ?? "").trim() || null,
    // Graph returns a naive local string plus a separate timeZone; the `prefer`
    // header above pins that to UTC, so the Z can be appended safely. Without
    // the header this would be an hours-wrong day view for anybody not in UTC.
    startsAt: e.start?.dateTime
      ? `${e.start.dateTime}Z`.replace("ZZ", "Z")
      : null,
    endsAt: e.end?.dateTime ? `${e.end.dateTime}Z`.replace("ZZ", "Z") : null,
    cancelled: e.isCancelled === true,
    organizer: e.organizer?.emailAddress?.address ?? null,
    attendees: (e.attendees ?? [])
      .filter((a) => a?.emailAddress?.address)
      .map((a) => ({
        email: a.emailAddress.address,
        name: a.emailAddress.name ?? null,
      })),
  }));
}

/**
 * Sync one account. Returns { written, matched, error }.
 *
 * `deps` exists so the whole thing can be tested without a network or a
 * database: every external edge is a parameter.
 */
export async function syncCalendarAccount(account, deps = {}, options = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const match = deps.matchAttendeesToContacts ?? matchAttendeesToContacts;
  const upsert = deps.upsertSyncedEvent ?? upsertSyncedEvent;
  const done = deps.recordSync ?? recordSync;
  const credentials = deps.credentials ?? credentialsFromEnv;

  if (!account?.id || !account?.owner_id)
    return { written: 0, matched: 0, error: "bad_account" };

  try {
    const token = await accessTokenFor(account, fetchImpl, credentials);
    if (!token) {
      await done(account.id, { error: "could not refresh access token" });
      return { written: 0, matched: 0, error: "no_token" };
    }

    const read = account.provider === "google" ? readGoogle : readMicrosoft;
    const cap = options.maxEvents ?? MAX_EVENTS;
    const events = (await read(token, fetchImpl, options)).slice(0, cap);

    let written = 0;
    let matched = 0;
    for (let offset = 0; offset < events.length; offset += 4) {
      await Promise.all(
        events.slice(offset, offset + 4).map(async (e) => {
          if (!e.externalId || (!e.startsAt && !e.cancelled)) return;

          /**
           * THE OWNER IS NOT A GUEST AT THEIR OWN MEETING. Every invite carries the
           * connected account's own address, and people do have a contact card for
           * themselves -- matching it would credit somebody with a meeting with
           * themselves every single day, and the rollup would rank them their own
           * closest relationship.
           */
          // The matcher takes addresses; the guest list is now objects.
          const people = await match(
            account.owner_id,
            (e.attendees ?? []).map((a) => a.email),
            { selfEmails: [account.account_email] },
          );
          const contactIds = people.map((p) => p.contactId);
          if (contactIds.length > 0) matched += 1;

          /*
           * And whatever the invite called them. Google fills displayName
           * only when the organizer had the person saved, so this is sparse
           * -- but a sparse source of real names is still a source, and it
           * costs one upsert on a sync that is already writing the event.
           */
          await noteNames(account.owner_id, e.attendees ?? [], { source: "calendar" }).catch(
            () => 0,
          );

          const res = await upsert(account.owner_id, account.id, {
            externalId: e.externalId,
            title: e.title,
            allDay: e.allDay,
            place: e.place,
            description: e.description,
            startsAt: e.startsAt,
            endsAt: e.endsAt,
            cancelled: e.cancelled,
            provider: account.provider,
            // The FIRST match is the event's contact and the rest are participants.
            // events.contact_id holds one; event_participants holds the others, and
            // contact-rollup reads both, so a four-person dinner counts for four.
            contactId: contactIds[0] ?? null,
            participantContactIds: contactIds.slice(1),
            /*
             * And the addresses themselves, matched or not. Everything above
             * is the conclusion; this is the evidence, and the company-side
             * producer resolves it against org_people rather than against a
             * personal contact card that a work account will never have.
             */
            attendees: e.attendees,
            organizer: e.organizer,
          });
          if (!res) throw Error("calendar_event_save_failed");
          written += 1;
        }),
      );
    }

    await done(account.id, { error: null });
    return { written, matched, error: null };
  } catch (e) {
    const message = String(e?.message || e).slice(0, 300);
    await done(account.id, { error: message });
    return { written: 0, matched: 0, error: message };
  }
}

/**
 * Sync every account for one owner, or every account there is.
 *
 * SEQUENTIALLY, ON PURPOSE. Both providers rate-limit per app, not per user, and
 * a hundred accounts refreshed at once is how an integration gets throttled for
 * everybody at the same time.
 */
export async function syncAllCalendars(accounts, deps = {}) {
  const out = [];
  for (const account of accounts ?? []) {
    out.push({
      accountId: account.id,
      ...(await syncCalendarAccount(account, deps)),
    });
  }
  return out;
}
