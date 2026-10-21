/**
 * HOW OFTEN, ON WHAT, AND WHICH WAY.
 *
 * "How often you meet with people in calendars, how often you communicate over
 *  email... the frequency and all the new stuff that is being tracked, properly
 *  store it."
 *
 * The storing is done -- contact_channel_stats is written by the rollup on
 * every refresh. This is the reading side, and it exists because a table of
 * counts is not an answer. "count_90d = 11" is a number; "you two are in touch
 * about weekly, mostly over email, and it has gone quiet this month" is the
 * thing a person can act on, and it is the same eleven.
 *
 * THREE THINGS A COUNT ALONE CANNOT SAY, all of which come out of rows that are
 * already on disk:
 *
 *   RHYTHM      Eleven touches in ninety days is a fortnightly relationship.
 *               The interval is what people actually carry in their heads --
 *               nobody thinks "I see Priya 0.12 times a day".
 *
 *   TREND       The same eleven could be eleven last week or eleven in June.
 *               Comparing the last 30 days against the 60 before it separates
 *               "warming up" from "we used to be close", and those two want
 *               opposite things from you.
 *
 *   RECIPROCITY Who writes first. An inbox where every message is inbound and
 *               nothing goes back is not a relationship, it is a newsletter,
 *               and the direction column on email_messages already knows.
 *
 * EVERY WINDOW IS COMPUTED IN POSTGRES against now(), never against a
 * JavaScript clock, for the same reason the rollup does it: a request served at
 * a day boundary must not disagree with the row it is reading.
 *
 * The shaping is a pure function taking rows, so the interesting part -- what
 * counts as warming, when a rhythm is too sparse to name -- is testable without
 * a database anywhere near it.
 */

import { query } from "./sql.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/** What each channel is called on a card. */
const CHANNEL_LABEL = Object.freeze({
  email: "email",
  calendar: "meetings",
  message: "messages",
  note: "your notes",
});

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

/**
 * An interval in days, said the way a person would say it.
 *
 * Deliberately coarse. "Every 6.4 days" is precision this data does not have --
 * it is built from whatever happened to sync -- and quoting it would claim an
 * accuracy the underlying counts cannot support.
 */
export function rhythmLabel(everyDays) {
  if (!Number.isFinite(everyDays) || everyDays <= 0) return null;
  if (everyDays <= 1.5) return "most days";
  if (everyDays <= 4) return "a few times a week";
  if (everyDays <= 10) return "about weekly";
  if (everyDays <= 20) return "every couple of weeks";
  if (everyDays <= 45) return "about monthly";
  if (everyDays <= 120) return "every few months";
  return "once or twice a year";
}

/**
 * Warming, cooling, or steady.
 *
 * The last 30 days against the 60 before them, as rates rather than counts, so
 * the shorter window is not automatically the quieter one.
 *
 * BOTH GUARDS MATTER. Without a floor on the recent count, one email after a
 * silent year reads as "warming" -- it is not, it is one email. Without a floor
 * on the older count, a relationship that simply started last month reads as
 * warming against a baseline of nothing, which is true but not news.
 */
export function trendOf({ count30d, count90d }) {
  const recent = num(count30d);
  const older = num(count90d) - recent;
  if (older < 0) return "steady"; // counts disagree; say nothing rather than guess
  const recentRate = recent / 30;
  const olderRate = older / 60;
  if (recent >= 2 && older >= 1 && recentRate >= olderRate * 1.75) return "warming";
  if (older >= 3 && recentRate <= olderRate * 0.4) return "cooling";
  return "steady";
}

/**
 * Who reaches out, from the inbound/outbound split on email.
 *
 * Only email can answer this today -- a calendar event has no direction and a
 * note is always the owner's. Returns null rather than a fabricated 50/50 when
 * there is nothing to go on, because "even" is a claim.
 */
export function reciprocityOf({ inbound = 0, outbound = 0 } = {}) {
  const inn = num(inbound);
  const out = num(outbound);
  const total = inn + out;
  if (total < 4) return null; // three messages is not a pattern
  const share = out / total;
  const lean =
    share >= 0.7 ? "you_reach_out" : share <= 0.3 ? "they_reach_out" : "even";
  return { inbound: inn, outbound: out, outboundShare: Math.round(share * 100) / 100, lean };
}

const LEAN_PHRASE = Object.freeze({
  you_reach_out: "you start most of it",
  they_reach_out: "they start most of it",
  even: "it goes both ways",
});

/**
 * Rows in, a cadence out. Pure.
 *
 * `channelRows` are contact_channel_stats rows for one contact, `totalRow` the
 * contact_interaction_stats row (the channel-blind total, which is NOT the sum
 * of the channels -- a lunch that is both a calendar event and a note counts
 * once there and twice here, and the ranker uses the former).
 */
export function shapeCadence({ channelRows = [], totalRow = null, direction = null, now = Date.now() } = {}) {
  const channels = channelRows
    .map((r) => ({
      channel: String(r.channel),
      label: CHANNEL_LABEL[String(r.channel)] ?? String(r.channel),
      firstAt: iso(r.first_at),
      lastAt: iso(r.last_at),
      count30d: num(r.count_30d),
      count90d: num(r.count_90d),
      countAll: num(r.count_all),
      accounts: Math.max(1, num(r.accounts)),
      trend: trendOf({ count30d: r.count_30d, count90d: r.count_90d }),
    }))
    .sort((a, b) => b.count90d - a.count90d || b.countAll - a.countAll);

  const count30d = num(totalRow?.count_30d);
  const count90d = num(totalRow?.count_90d);
  const countAll = num(totalRow?.count_all);
  const lastAt = iso(totalRow?.last_interaction_at);
  const firstAt = iso(totalRow?.first_interaction_at);

  const daysSinceLast = lastAt
    ? Math.max(0, Math.floor((now - Date.parse(lastAt)) / 86_400_000))
    : null;

  // The rhythm is read off the 90-day window when it has enough in it, and off
  // the whole history otherwise -- a relationship with four touches spread over
  // two years is "once or twice a year", and the 90-day window would have
  // called it nothing at all.
  let everyDays = null;
  if (count90d >= 2) everyDays = 90 / count90d;
  else if (countAll >= 2 && firstAt) {
    const span = (now - Date.parse(firstAt)) / 86_400_000;
    if (span > 0) everyDays = span / countAll;
  }
  const rhythm = {
    everyDays: everyDays ? Math.round(everyDays * 10) / 10 : null,
    label: rhythmLabel(everyDays),
    trend: trendOf({ count30d, count90d }),
  };

  const reciprocity = reciprocityOf(direction ?? {});
  const primary = channels[0] ?? null;
  const accountSpan = channels.reduce((m, c) => Math.max(m, c.accounts), 1);

  return {
    total: { firstAt, lastAt, count30d, count90d, countAll, daysSinceLast },
    channels,
    primaryChannel: primary?.channel ?? null,
    rhythm,
    reciprocity,
    accountSpan,
    summary: summarize({ rhythm, primary, channels, reciprocity, accountSpan, daysSinceLast, countAll }),
  };
}

/**
 * One sentence, or nothing.
 *
 * An empty string is the right answer for a contact with no interactions at
 * all, and saying so out loud ("you have never been in touch") is a sentence
 * nobody needs on a card they just imported.
 */
function summarize({ rhythm, primary, channels, reciprocity, accountSpan, daysSinceLast, countAll }) {
  if (!countAll) return "";
  const parts = [];
  if (rhythm.label) parts.push(`In touch ${rhythm.label}`);
  else if (daysSinceLast != null) parts.push(`Last in touch ${daysSinceLast} days ago`);
  else parts.push("In touch once");

  if (primary) {
    const others = channels.length - 1;
    parts.push(others > 0 ? `mostly over ${primary.label}` : `over ${primary.label}`);
  }
  if (accountSpan > 1) parts.push(`across ${accountSpan} of your accounts`);
  if (reciprocity) parts.push(LEAN_PHRASE[reciprocity.lean]);
  if (rhythm.trend === "warming") parts.push("and picking up");
  else if (rhythm.trend === "cooling") parts.push("and it has gone quiet lately");

  return `${parts.join(", ").replace(/, (and |it has)/, " $1")}.`;
}

/**
 * The cadence for one contact, or null when the contact is not this owner's.
 *
 * Four reads in parallel. The existence check is its own query rather than a
 * join so that "no interactions yet" and "no such contact" stay
 * distinguishable -- the first is a card with an empty cadence, the second is a
 * 404, and a join would collapse them into the same empty result.
 */
export async function getContactCadence(ownerId, contactId) {
  const owner = asUuid(ownerId);
  const contact = asUuid(contactId);
  if (!owner || !contact) return null;

  const [exists, channelRows, totalRows, directionRows] = await Promise.all([
    query(`SELECT 1 FROM contacts WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL`, [owner, contact]),
    query(
      `SELECT channel, first_at, last_at, count_30d, count_90d, count_all, accounts
         FROM contact_channel_stats
        WHERE owner_id = $1 AND contact_id = $2`,
      [owner, contact],
    ),
    query(
      `SELECT first_interaction_at, last_interaction_at, count_30d, count_90d, count_all
         FROM contact_interaction_stats
        WHERE owner_id = $1 AND contact_id = $2`,
      [owner, contact],
    ),
    query(
      `SELECT em.direction, count(*)::int AS n
         FROM email_participants ep
         JOIN email_messages em ON em.owner_id = $1 AND em.message_id = ep.message_id
        WHERE ep.owner_id = $1 AND ep.contact_id = $2
        GROUP BY em.direction`,
      [owner, contact],
    ),
  ]);

  if (!exists.rows.length) return null;

  const direction = { inbound: 0, outbound: 0 };
  for (const r of directionRows.rows) {
    if (r.direction === "inbound") direction.inbound = num(r.n);
    else if (r.direction === "outbound") direction.outbound = num(r.n);
  }

  return {
    contactId: contact,
    ...shapeCadence({ channelRows: channelRows.rows, totalRow: totalRows.rows[0] ?? null, direction }),
  };
}

/**
 * Cadence for many contacts at once, keyed by contact id.
 *
 * The list view needs this -- calling getContactCadence per row would be four
 * queries per contact, which for a 966-contact book is 3,864 round trips to
 * render one screen. Same shaping, three queries total.
 */
export async function getCadenceForContacts(ownerId, contactIds = []) {
  const owner = asUuid(ownerId);
  const ids = [...new Set((contactIds || []).map(asUuid).filter(Boolean))];
  if (!owner || !ids.length) return new Map();

  const [channelRows, totalRows, directionRows] = await Promise.all([
    query(
      `SELECT contact_id, channel, first_at, last_at, count_30d, count_90d, count_all, accounts
         FROM contact_channel_stats WHERE owner_id = $1 AND contact_id = ANY($2::uuid[])`,
      [owner, ids],
    ),
    query(
      `SELECT contact_id, first_interaction_at, last_interaction_at, count_30d, count_90d, count_all
         FROM contact_interaction_stats WHERE owner_id = $1 AND contact_id = ANY($2::uuid[])`,
      [owner, ids],
    ),
    query(
      `SELECT ep.contact_id, em.direction, count(*)::int AS n
         FROM email_participants ep
         JOIN email_messages em ON em.owner_id = $1 AND em.message_id = ep.message_id
        WHERE ep.owner_id = $1 AND ep.contact_id = ANY($2::uuid[])
        GROUP BY ep.contact_id, em.direction`,
      [owner, ids],
    ),
  ]);

  const byChannel = new Map();
  for (const r of channelRows.rows) {
    const list = byChannel.get(r.contact_id) ?? [];
    list.push(r);
    byChannel.set(r.contact_id, list);
  }
  const byTotal = new Map(totalRows.rows.map((r) => [r.contact_id, r]));
  const byDirection = new Map();
  for (const r of directionRows.rows) {
    const d = byDirection.get(r.contact_id) ?? { inbound: 0, outbound: 0 };
    if (r.direction === "inbound") d.inbound = num(r.n);
    else if (r.direction === "outbound") d.outbound = num(r.n);
    byDirection.set(r.contact_id, d);
  }

  const out = new Map();
  for (const id of ids) {
    out.set(id, {
      contactId: id,
      ...shapeCadence({
        channelRows: byChannel.get(id) ?? [],
        totalRow: byTotal.get(id) ?? null,
        direction: byDirection.get(id) ?? null,
      }),
    });
  }
  return out;
}
