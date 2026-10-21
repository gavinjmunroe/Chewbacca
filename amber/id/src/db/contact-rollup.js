/**
 * CONTACT ROLLUP — the job that fills contact_interaction_stats and
 * contact_scores.
 *
 * Both tables shipped in migrations 008 and 009 and nothing has ever written to
 * either one. They appear in exactly two places in the codebase: the purge list
 * and the contact-delete list. The schema has been advertising a rollup that
 * does not run, which is worse than not having the tables, because a reader
 * assumes a populated table means a populated pipeline.
 *
 *
 * WHAT COUNTS AS AN INTERACTION
 *
 * There is no interactions table and there is not going to be one. Migration 008
 * says why: an iMessage backfill is tens of thousands of rows per user on day
 * one, the raw stream belongs in BigQuery, and Cloud SQL should scale with
 * CONTACTS rather than with MESSAGES. So the stats are assembled from the dated,
 * contact-attributable evidence that actually lives in Postgres:
 *
 *   observations    observed_at. Both the primary subject (observations.contact_id)
 *                   and everyone else who was there (observation_participants).
 *                   A dinner with three people is an interaction with three
 *                   people, and the participants table is the only thing that
 *                   knows the other two.
 *
 *   events          starts_at, and ONLY once it has happened. A dinner on the
 *                   calendar for next month is not something you have done. This
 *                   is the difference between "when did I last see her" and "when
 *                   am I next seeing her", and conflating them makes a stale
 *                   relationship read as fresh.
 *
 *   direct messages dm_messages.created_at, mapped to a contact through
 *                   dm_threads and contacts.linked_amber_id. Both directions
 *                   count: a thread where they wrote and you did not is still
 *                   contact.
 *
 * CONVERSATION_MESSAGES IS DELIBERATELY NOT IN THAT LIST, and this is a
 * departure from "observations + messages + events" as stated, so it should be
 * argued rather than buried. Two reasons. First, it cannot be attributed:
 * conversations carry owner_id, kind ('chat' | 'note' | 'space') and nothing
 * that points at a contact -- the schema has no join to hang the count on.
 * Second, even if it did, those are the owner talking to Amber. Asking the
 * assistant about someone is not contact with them, and counting it would make
 * warmth go up for people you think about and never call. Anything real that a
 * chat produced is already an observation with a source_conversation_id, so it
 * is counted once, on the observations line, where it belongs.
 *
 *
 * WHAT THE NUMBERS MEAN
 *
 * Every coefficient below is a row in scoring_params, the same table the
 * retrieval blend and the dimension rollup read from, so the shape of the curve
 * is something you change with an UPDATE rather than a deploy.
 *
 * THE FIRST VERSION OF THIS SAID A RELATIONSHIP HALVES IN WARMTH IN 45 DAYS.
 * It does not. Nobody's does. That number was a guess dressed up as a default,
 * and a bigger number in the same shape would still have been wrong, because the
 * shape was the problem in two places:
 *
 *   recency    was exp(-ln2 * days / 45) decaying toward ZERO. A close friend
 *              you have not called in three months is still a close friend, and
 *              somebody you knew a decade ago is dormant rather than a stranger.
 *              Now a year-scale half-life with a FLOOR at window_residual -- the
 *              same residual the temporal function uses to say "it still
 *              happened". You still know them.
 *
 *   cadence    was 1 - exp(-k * count_90d): a raw count of the last quarter,
 *              which rewards whoever you happened to be busy with. Now
 *              interactions per month over the LIFE of the relationship, which
 *              is a measured quantity -- count_all over the months since
 *              first_interaction_at, both of which the stats table holds -- and
 *              which says something durable. You see this person monthly; you
 *              saw that person twice in four years.
 *
 *   warmth     recency * w + cadence * (1 - w),  w = warmth_recency_weight
 *
 *   evidence   1 - exp(-evidence_k * observation_count)
 *              How much we actually know, saturating: the step from one fact to
 *              two matters, thirty to thirty-one does not.
 *
 *   base_score warmth * score_warmth_weight
 *            + evidence * score_evidence_weight
 *            + completeness * (1 - the other two)
 *
 * THE COMPLETENESS WEIGHT IS DERIVED, NOT STORED. Three weights that must sum to
 * 1 stored as three rows is an invitation for them not to, and then no reading of
 * the table tells you which one is wrong.
 *
 * completeness is the cold-start term and it is not decoration. On a fresh
 * address-book import every contact has zero interactions and zero observations,
 * so warmth and evidence are zero for everybody and the ranking is arbitrary.
 * Completeness breaks that tie by how much of a person's record is filled in,
 * which on day one is the only signal there is.
 *
 * NONE OF THESE NUMBERS ARE MEASUREMENTS. There is no real relationship data in
 * this schema yet to calibrate against. What is defensible today is the shape;
 * the values are starting points, and they are in a table precisely so that
 * moving them is an UPDATE and not an argument with a deploy.
 *
 *
 * A JOB, NOT A TRIGGER, AND NOT A VIEW
 *
 * Same argument as refreshContactDimensionState. A trigger fires invisibly and
 * serializes concurrent writes on the contact's row. A view recomputes on every
 * read, which is the cost these tables exist to avoid. This runs for one owner
 * at a time, is safe to run again, and truncating either table is always safe --
 * they hold no truth of their own.
 *
 * IT ADDS NO INDEXES. Every scan below is served by something that already
 * exists: obs_contact_time_idx, op_contact_idx, events_owner_start_idx,
 * contacts_linked_idx, dm_messages_thread_idx.
 */

import { query } from "./sql.js";
import { refreshCohorts } from "./cohorts-store.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/**
 * THE CONTACTS THE OWNER HAS ACTUALLY WRITTEN TO.
 *
 * "How is 'spoke 1 month ago' being calculated? I have not spoken to some of
 * these people that recently, especially by email."
 *
 * He was right. Every address on From, To and Cc got a participant row, and
 * both streams below counted all of them identically -- so being CC'd on a
 * thread, or receiving a cold email and never answering it, was recorded as
 * contact. That number is 60% of the tie strength the graph lays people out
 * by, so strangers were being pulled toward the center of somebody's own
 * network.
 *
 * ANYONE CAN EMAIL YOU. WRITING BACK IS A CHOICE. So an email correspondence
 * only counts once the owner has sent at least one message with that person on
 * it. After that every message in the correspondence counts, in both
 * directions, because at that point it is a correspondence. Before it, it is
 * somebody else's mail landing in your inbox.
 *
 * A CC ON THE OWNER'S OWN MESSAGE STILL COUNTS, because the owner chose to put
 * them there. What does not count is a CC on somebody else's message.
 *
 * Expressed as a join rather than a correlated EXISTS so it is evaluated once
 * per refresh instead of once per participant row. Served by
 * email_participants_contact_idx and the email_messages primary key; no new
 * index. $1 is the owner.
 */
const RECIPROCAL_EMAIL_CONTACTS = `
  SELECT DISTINCT ep_out.contact_id
    FROM email_participants ep_out
    JOIN email_messages em_out
      ON em_out.owner_id = $1 AND em_out.message_id = ep_out.message_id
   WHERE ep_out.owner_id = $1 AND em_out.direction = 'outbound'
`;

/**
 * The contact-attributable interaction stream for one owner, as SQL.
 *
 * Five arms, unioned. Kept in one place because contact_interaction_stats and
 * contact_scores must agree about what an interaction is; two copies of this
 * would drift and the disagreement would be invisible.
 *
 * AN EVENT BORN FROM AN OBSERVATION IS NOT A SECOND INTERACTION. Since
 * migration 030 an experience writes both a memory and an event, joined by
 * observations.event_id. Both would land in this union, and one dinner would
 * count as two -- which inflates cadence, which inflates warmth, silently and
 * for exactly the people somebody talks about most. So the two event arms skip
 * any event an observation already points at: the observation arms carry it.
 * Events with no linked observation -- a calendar import, an event created
 * directly -- are counted here and nowhere else.
 *
 * A DIRECT MESSAGE IS COUNTED ON THE dm_messages ARM AND NOWHERE ELSE. Since
 * db/interaction-observations.js, an exchange in a DM thread also writes an
 * observation per side -- that row exists for its CONTENT (the six dimensions,
 * and something to read on the card), and the messages it was built from are
 * already in the last arm below. Counting both would be the same lunch counted
 * from two places in one database, inflating cadence for exactly the people the
 * owner talks to most, silently. Same argument as the event exclusion above,
 * expressed as `source <> 'dm'` because that is the only marker those rows carry.
 *
 * Circle-sourced observations are NOT excluded: nothing else counts them.
 *
 * $1 is the owner.
 */
const INTERACTION_STREAM = `
  -- the fact's primary subject
  SELECT o.contact_id, o.observed_at AS at
    FROM observations o
   WHERE o.owner_id = $1 AND o.deleted_at IS NULL
     AND o.contact_id IS NOT NULL AND o.status <> 'pending'
     AND o.observed_at IS NOT NULL
     AND o.source <> 'dm'   -- counted on the dm_messages arm; see above
  UNION ALL
  -- and everyone else who was in the room
  SELECT p.contact_id, o.observed_at
    FROM observation_participants p
    JOIN observations o ON o.observation_id = p.observation_id
                       -- REDUNDANT ON PAPER, LOAD-BEARING IN THE PLAN. Filtering
                       -- only p.owner_id makes the planner scan every owner's
                       -- observations and join back; repeating the owner here
                       -- turns that into this owner's rows and nothing else.
                       AND o.owner_id = $1
   WHERE p.owner_id = $1 AND o.deleted_at IS NULL
     AND o.status <> 'pending' AND o.observed_at IS NOT NULL
     AND p.contact_id IS DISTINCT FROM o.contact_id
     AND o.source <> 'dm'   -- counted on the dm_messages arm; see above
  UNION ALL
  -- events that have actually happened, and are not already counted above
  SELECT e.contact_id, e.starts_at
    FROM events e
   WHERE e.owner_id = $1 AND e.deleted_at IS NULL
     AND e.contact_id IS NOT NULL
     AND e.starts_at IS NOT NULL AND e.starts_at <= now()
     AND NOT EXISTS (SELECT 1 FROM observations o2
                      WHERE o2.event_id = e.event_id AND o2.deleted_at IS NULL)
  UNION ALL
  -- everyone else who was at that event, same exclusion
  SELECT ep.contact_id, e.starts_at
    FROM event_participants ep
    JOIN events e ON e.event_id = ep.event_id AND e.owner_id = $1
   WHERE ep.owner_id = $1 AND e.deleted_at IS NULL
     AND e.starts_at IS NOT NULL AND e.starts_at <= now()
     AND ep.contact_id IS DISTINCT FROM e.contact_id
     AND NOT EXISTS (SELECT 1 FROM observations o3
                      WHERE o3.event_id = e.event_id AND o3.deleted_at IS NULL)
  UNION ALL
  -- direct messages, either direction, mapped through the linked account
  SELECT c.id, m.created_at
    FROM dm_threads t
    JOIN dm_messages m ON m.thread_id = t.id AND m.deleted_at IS NULL
    JOIN contacts c
      ON c.owner_id = $1 AND c.deleted_at IS NULL
     AND c.linked_amber_id = CASE WHEN t.a_amber_id = $1
                                  THEN t.b_amber_id ELSE t.a_amber_id END
   WHERE t.a_amber_id = $1 OR t.b_amber_id = $1
  UNION ALL
  -- EMAIL, AND ONLY WHERE THE OWNER HAS WRITTEN BACK. See
  -- RECIPROCAL_EMAIL_CONTACTS above for why the gate exists.
  --
  -- The message itself is already deduped across connected accounts by its
  -- RFC822 Message-ID, so a thread the owner is on in two mailboxes counts once
  -- here -- which is the whole reason that is the primary key rather than a
  -- surrogate.
  SELECT ep.contact_id, em.occurred_at
    FROM email_participants ep
    JOIN email_messages em
      ON em.owner_id = $1 AND em.message_id = ep.message_id
    JOIN (${RECIPROCAL_EMAIL_CONTACTS}) recip ON recip.contact_id = ep.contact_id
   WHERE ep.owner_id = $1
`;

/**
 * THE SAME STREAM, WITH THE CHANNEL KEPT.
 *
 * INTERACTION_STREAM deliberately throws the channel away: the ranker wants one
 * number for how much contact there is, and which surface it happened on does
 * not change that. But "we meet every week and never email" and "we email daily
 * and have never met" are the same number and completely different
 * relationships, and that distinction is what contact_channel_stats exists for.
 *
 * `accounts` counts how many of the owner's own connected mailboxes carry this
 * relationship. Only email can be greater than one today; the other arms report
 * 1 so the column means the same thing everywhere rather than being null in
 * three places out of four.
 */
const CHANNEL_STREAM = `
  SELECT o.contact_id, o.observed_at AS at, 'note'::text AS channel, 1 AS account_n
    FROM observations o
   WHERE o.owner_id = $1 AND o.deleted_at IS NULL
     AND o.contact_id IS NOT NULL AND o.status <> 'pending'
     AND o.observed_at IS NOT NULL AND o.source <> 'dm'
  UNION ALL
  SELECT p.contact_id, o.observed_at, 'note'::text, 1
    FROM observation_participants p
    JOIN observations o ON o.observation_id = p.observation_id AND o.owner_id = $1
   WHERE p.owner_id = $1 AND o.deleted_at IS NULL
     AND o.status <> 'pending' AND o.observed_at IS NOT NULL
     AND p.contact_id IS DISTINCT FROM o.contact_id AND o.source <> 'dm'
  UNION ALL
  SELECT e.contact_id, e.starts_at, 'calendar'::text, 1
    FROM events e
   WHERE e.owner_id = $1 AND e.deleted_at IS NULL AND e.contact_id IS NOT NULL
     AND e.starts_at IS NOT NULL AND e.starts_at <= now()
  UNION ALL
  SELECT ep.contact_id, e.starts_at, 'calendar'::text, 1
    FROM event_participants ep
    JOIN events e ON e.event_id = ep.event_id AND e.owner_id = $1
   WHERE ep.owner_id = $1 AND e.deleted_at IS NULL
     AND e.starts_at IS NOT NULL AND e.starts_at <= now()
     AND ep.contact_id IS DISTINCT FROM e.contact_id
  UNION ALL
  SELECT c.id, m.created_at, 'message'::text, 1
    FROM dm_threads t
    JOIN dm_messages m ON m.thread_id = t.id AND m.deleted_at IS NULL
    JOIN contacts c
      ON c.owner_id = $1 AND c.deleted_at IS NULL
     AND c.linked_amber_id = CASE WHEN t.a_amber_id = $1
                                  THEN t.b_amber_id ELSE t.a_amber_id END
   WHERE t.a_amber_id = $1 OR t.b_amber_id = $1
  UNION ALL
  -- The SAME reciprocity gate as INTERACTION_STREAM. The two tables are read
  -- side by side -- one for how close somebody is, one for what the card says
  -- they last did -- and a card reading "emailed 3 weeks ago" for a
  -- relationship the ranker has decided does not exist is the disagreement
  -- this file was written to prevent.
  SELECT ep.contact_id, em.occurred_at, 'email'::text,
         -- How many of the owner's mailboxes hold this exact message. This is
         -- the number that makes "you two are in touch across your work and
         -- personal accounts" sayable.
         GREATEST(coalesce(array_length(em.seen_accounts, 1), 1), 1)
    FROM email_participants ep
    JOIN email_messages em
      ON em.owner_id = $1 AND em.message_id = ep.message_id
    JOIN (${RECIPROCAL_EMAIL_CONTACTS}) recip ON recip.contact_id = ep.contact_id
   WHERE ep.owner_id = $1
`;

/**
 * Rebuild contact_interaction_stats for one owner. Returns the number of
 * contacts with at least one interaction.
 *
 * The windows are computed against now() inside the database rather than
 * against a timestamp assembled in JavaScript, so a job running at the boundary
 * of a day cannot disagree with itself between the two statements.
 */
export async function refreshInteractionStats(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return 0;

  const { rowCount } = await query(
    `INSERT INTO contact_interaction_stats
       (owner_id, contact_id, last_interaction_at, first_interaction_at,
        count_30d, count_90d, count_all, computed_at)
     SELECT $1, s.contact_id,
            max(s.at), min(s.at),
            count(*) FILTER (WHERE s.at > now() - interval '30 days')::int,
            count(*) FILTER (WHERE s.at > now() - interval '90 days')::int,
            count(*)::int,
            now()
       FROM (${INTERACTION_STREAM}) s
       JOIN contacts c ON c.owner_id = $1 AND c.id = s.contact_id
                      AND c.deleted_at IS NULL
      GROUP BY s.contact_id
     ON CONFLICT (owner_id, contact_id) DO UPDATE
       SET last_interaction_at  = EXCLUDED.last_interaction_at,
           first_interaction_at = EXCLUDED.first_interaction_at,
           count_30d            = EXCLUDED.count_30d,
           count_90d            = EXCLUDED.count_90d,
           count_all            = EXCLUDED.count_all,
           computed_at          = now()`,
    [owner],
  );

  // A contact whose last observation was deleted keeps a stale row otherwise,
  // and a stale "last seen in March" is worse than no row at all: it is
  // confidently wrong, and the recency term will happily decay it forever.
  await query(
    `DELETE FROM contact_interaction_stats s
      WHERE s.owner_id = $1
        AND NOT EXISTS (SELECT 1 FROM (${INTERACTION_STREAM}) x
                         WHERE x.contact_id = s.contact_id)`,
    [owner],
  );

  return rowCount;
}

/**
 * Rebuild contact_channel_stats for one owner. Returns rows written.
 *
 * Same windows as contact_interaction_stats so the two can be read side by side
 * without a conversion, and the same delete-the-stale-rows discipline: a
 * relationship that used to be carried by email and no longer is must lose its
 * email row, not keep a confidently wrong "last emailed in March" forever.
 */
export async function refreshChannelStats(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return 0;

  const { rowCount } = await query(
    `INSERT INTO contact_channel_stats
       (owner_id, contact_id, channel, first_at, last_at,
        count_30d, count_90d, count_all, accounts, computed_at)
     SELECT $1, s.contact_id, s.channel,
            min(s.at), max(s.at),
            count(*) FILTER (WHERE s.at > now() - interval '30 days')::int,
            count(*) FILTER (WHERE s.at > now() - interval '90 days')::int,
            count(*)::int,
            -- The widest this relationship has ever spanned on this channel,
            -- not the average: "we are in touch across two accounts" stays true
            -- after a quiet month on one of them.
            max(s.account_n)::int,
            now()
       FROM (${CHANNEL_STREAM}) s
       JOIN contacts c ON c.owner_id = $1 AND c.id = s.contact_id
                      AND c.deleted_at IS NULL
      GROUP BY s.contact_id, s.channel
     ON CONFLICT (owner_id, contact_id, channel) DO UPDATE
       SET first_at    = EXCLUDED.first_at,
           last_at     = EXCLUDED.last_at,
           count_30d   = EXCLUDED.count_30d,
           count_90d   = EXCLUDED.count_90d,
           count_all   = EXCLUDED.count_all,
           accounts    = EXCLUDED.accounts,
           computed_at = now()`,
    [owner],
  );

  await query(
    `DELETE FROM contact_channel_stats s
      WHERE s.owner_id = $1
        AND NOT EXISTS (SELECT 1 FROM (${CHANNEL_STREAM}) x
                         WHERE x.contact_id = s.contact_id
                           AND x.channel = s.channel)`,
    [owner],
  );

  return rowCount;
}

/**
 * Rebuild contact_scores for one owner. Returns the number of contacts scored.
 *
 * EVERY CONTACT GETS A ROW, including one with no interactions and no facts.
 * That is the cold-start case and it is the common one on the day someone
 * imports their address book: leaving those contacts out of the table would
 * mean the shortlist index cannot see them at all, so a fresh account's ranking
 * would be empty rather than ordered by completeness.
 *
 * Reads contact_interaction_stats, so run refreshInteractionStats first --
 * refreshOwner() does both in the right order.
 */
export async function refreshContactScores(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return 0;

  const { rowCount } = await query(
    `WITH params AS (
       SELECT
         COALESCE((SELECT value FROM scoring_params WHERE key = 'warmth_half_life_days'), 365)::float8  AS half_life,
         COALESCE((SELECT value FROM scoring_params WHERE key = 'warmth_recency_weight'), 0.5)::float8  AS w_recency,
         COALESCE((SELECT value FROM scoring_params WHERE key = 'cadence_k'), 0.7)::float8              AS cadence_k,
         COALESCE((SELECT value FROM scoring_params WHERE key = 'evidence_k'), 0.2)::float8             AS evidence_k,
         COALESCE((SELECT value FROM scoring_params WHERE key = 'score_warmth_weight'), 0.6)::float8    AS w_warmth,
         COALESCE((SELECT value FROM scoring_params WHERE key = 'score_evidence_weight'), 0.25)::float8 AS w_evidence,
         -- THE SAME FLOOR THE TEMPORAL FUNCTION USES. "It still happened" and
         -- "you still know them" are the same statement about the past, so they
         -- get the same number rather than a second one to keep in step.
         COALESCE((SELECT value FROM scoring_params WHERE key = 'window_residual'), 0.15)::float8 AS floor_at
     ),
     -- OBSERVATIONS ONLY, not the whole interaction stream. observation_count
     -- means "how many facts do we hold about this person"; an event on the
     -- calendar and a DM are interactions but they are not facts, and folding
     -- them in here would make the evidence term claim knowledge we do not have.
     -- DISTINCT on the id, because a group observation reaches a contact through
     -- both arms of the union when they are also the primary subject.
     obs AS (
       SELECT x.contact_id, count(DISTINCT x.observation_id)::int AS n
         FROM (
           SELECT o.contact_id, o.observation_id
             FROM observations o
            WHERE o.owner_id = $1 AND o.deleted_at IS NULL
              AND o.contact_id IS NOT NULL AND o.status <> 'pending'
           UNION ALL
           SELECT p.contact_id, p.observation_id
             FROM observation_participants p
             JOIN observations o ON o.observation_id = p.observation_id
                                AND o.owner_id = $1   -- see INTERACTION_STREAM
            WHERE p.owner_id = $1 AND o.deleted_at IS NULL
              AND o.status <> 'pending'
         ) x
        GROUP BY x.contact_id
     ),
     base AS (
       SELECT c.id AS contact_id,
              cis.last_interaction_at,
              COALESCE(oc.n, 0)          AS observation_count,
              -- CADENCE, MEASURED: interactions per month over the life of the
              -- relationship. count_all and first_interaction_at are both in the
              -- stats table, so this is derived from what was counted rather than
              -- from a constant. The one-month floor on the denominator stops a
              -- brand-new contact with two messages today reading as sixty a
              -- month; you do not know the cadence of a relationship a day old.
              -- TWO INTERACTIONS ARE THE MINIMUM A RATE CAN BE MEASURED FROM.
              -- One is an event, not a rhythm: a contact with a single
              -- observation five weeks ago divided out to 0.9 a month, which
              -- reads as "we are in monthly contact" and put a card carrying
              -- nothing but the first name "Alex" in the owner's closest
              -- circle. The month floor below was meant to catch this and does
              -- not -- it bounds the denominator, and with a numerator of 1 the
              -- answer is still ~1 per month. Nothing separates one event from
              -- a habit except having happened twice.
              CASE WHEN cis.count_all IS NULL OR cis.count_all < 2 THEN 0::float8
                   ELSE cis.count_all / GREATEST(
                          extract(epoch FROM now() - COALESCE(cis.first_interaction_at, now()))
                            / 2629746.0, 1.0)
              END AS per_month,
              -- COMPLETENESS: how much of this person's record is filled in.
              -- Eight identity-bearing fields, equally weighted. Deliberately
              -- not "how many columns are non-null" -- most of the table is
              -- provenance and sync bookkeeping, and counting those would score
              -- a well-synced empty contact above a hand-typed real one.
              ((CASE WHEN NULLIF(btrim(COALESCE(c.full_name, '')), '')     IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN NULLIF(btrim(COALESCE(c.phone_primary, '')), '') IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN NULLIF(btrim(COALESCE(c.emails, '')), '')        IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN NULLIF(btrim(COALESCE(c.company, '')), '')       IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN NULLIF(btrim(COALESCE(c.title, '')), '')         IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN NULLIF(btrim(COALESCE(c.city, c.location, '')), '') IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN c.birthday IS NOT NULL                                THEN 1 ELSE 0 END
              + CASE WHEN NULLIF(btrim(COALESCE(c.linkedin_url, '')), '')  IS NOT NULL THEN 1 ELSE 0 END
               )::float8 / 8.0) AS completeness
         FROM contacts c
         LEFT JOIN contact_interaction_stats cis
           ON cis.owner_id = c.owner_id AND cis.contact_id = c.id
         LEFT JOIN obs oc ON oc.contact_id = c.id
        WHERE c.owner_id = $1 AND c.deleted_at IS NULL
     ),
     scored AS (
       SELECT b.contact_id, b.last_interaction_at, b.observation_count, b.completeness,
              -- RECENCY, FLOORED. 1.0 today, halving every half_life days, and
              -- bottoming out at floor_at rather than at zero: somebody you have
              -- not spoken to in five years is dormant, not a stranger.
              --
              -- NO interaction at all is a different case from an old one, and it
              -- gets a hard 0 rather than the floor. The floor means "we used to
              -- be in contact"; a contact you have never interacted with cannot
              -- claim that, and giving them the floor would rank an untouched
              -- address-book import above a friend from four years ago.
              --
              -- TWO GUARDS ON ONE LINE, both found by a test rather than by
              -- reading. COALESCE handles a half_life of 0, which would divide by
              -- zero and NULL out base_score -- a NOT NULL column, so one bad row
              -- in a tuning table would fail the whole job. GREATEST(-700, ...)
              -- handles the other end: Postgres float8 exp() RAISES on underflow
              -- rather than returning 0, so a five-year-old interaction with the
              -- half-life turned down to a day crashed the entire owner's rollup.
              -- exp(-700) is 1e-304, far below any floor anyone would set, so the
              -- clamp changes no answer it does not have to.
              COALESCE(
                CASE WHEN b.last_interaction_at IS NULL THEN 0::float8
                     ELSE GREATEST(prm.floor_at,
                            exp(GREATEST(-700, -ln(2) * GREATEST(
                                  extract(epoch FROM now() - b.last_interaction_at) / 86400.0, 0)
                                / NULLIF(prm.half_life, 0))))
                END, 0::float8) AS recency,
              (1 - exp(GREATEST(-700, -prm.cadence_k * b.per_month)))          AS cadence,
              (1 - exp(GREATEST(-700, -prm.evidence_k * b.observation_count))) AS evidence,
              -- The third weight is derived so the three cannot drift out of sum.
              GREATEST(0, 1 - prm.w_warmth - prm.w_evidence)     AS w_complete,
              prm.*
         FROM base b CROSS JOIN params prm
     )
     INSERT INTO contact_scores
       (owner_id, contact_id, base_score, warmth, last_interaction_at,
        observation_count, completeness, computed_at)
     SELECT $1, s.contact_id,
            LEAST(1, GREATEST(0,
              (s.recency * s.w_recency + s.cadence * (1 - s.w_recency)) * s.w_warmth
              + s.evidence     * s.w_evidence
              + s.completeness * s.w_complete))::real,
            LEAST(1, GREATEST(0,
              s.recency * s.w_recency + s.cadence * (1 - s.w_recency)))::real,
            s.last_interaction_at,
            s.observation_count::int,
            s.completeness::real,
            now()
       FROM scored s
     ON CONFLICT (owner_id, contact_id) DO UPDATE
       SET base_score          = EXCLUDED.base_score,
           warmth              = EXCLUDED.warmth,
           last_interaction_at = EXCLUDED.last_interaction_at,
           observation_count   = EXCLUDED.observation_count,
           completeness        = EXCLUDED.completeness,
           computed_at         = now()`,
    [owner],
  );

  // Contacts are soft-deleted, and the FK is ON DELETE CASCADE, which only fires
  // on a hard delete. Without this a deleted contact keeps its score row and
  // keeps appearing in the shortlist index.
  await query(
    `DELETE FROM contact_scores s
      WHERE s.owner_id = $1
        AND NOT EXISTS (SELECT 1 FROM contacts c
                         WHERE c.owner_id = s.owner_id AND c.id = s.contact_id
                           AND c.deleted_at IS NULL)`,
    [owner],
  );

  return rowCount;
}

/**
 * Both rollups for one owner, in dependency order. contact_scores reads
 * contact_interaction_stats, so the order is not cosmetic.
 */
export async function refreshOwner(ownerId) {
  const interactions = await refreshInteractionStats(ownerId);
  // Best-effort and deliberately not fatal. The channel breakdown is what a
  // card shows; the totals above are what the RANKER reads. A failure here
  // must not cost somebody their ranking, so it is logged and stepped over.
  let channels = 0;
  try {
    channels = await refreshChannelStats(ownerId);
  } catch (err) {
    console.error(`CHANNEL_STATS_FAILED owner=${ownerId} ${err?.code || ""} ${err?.message || err}`);
  }
  const scores = await refreshContactScores(ownerId);

  // DERIVED AUDIENCES, recomputed here because this is the job that already
  // knows the contacts changed. A cohort is a function of the address book --
  // "everyone with a stanford.edu address" -- so it goes stale exactly when a
  // contact is added, merged or given a new email, which is precisely what the
  // rollup runs after.
  //
  // Best-effort like the channel stats above: a cohort that failed to refresh
  // means an audience is a little out of date, and failing the whole rollup
  // over it would cost somebody their ranking to protect a sharing picker.
  let cohorts = 0;
  try {
    const summary = await refreshCohorts(ownerId);
    cohorts = summary?.cohorts ?? 0;
  } catch (err) {
    console.error(`COHORT_REFRESH_FAILED owner=${ownerId} ${err?.code || ""} ${err?.message || err}`);
  }

  // MIRROR THE CADENCE INTO BIGQUERY, if there is one configured.
  //
  // Cloud SQL stays the system of record -- every read the app makes goes
  // there. BigQuery is for the questions a transactional database is the wrong
  // shape for, and it is populated here because this is the moment the numbers
  // are known to be current.
  //
  // Entirely optional and entirely non-fatal: unconfigured (every environment
  // without GCP credentials, including every test run) this is one boolean
  // check. A failure never costs somebody their rollup.
  let mirrored = 0;
  try {
    mirrored = await mirrorCadenceToWarehouse(ownerId);
  } catch (err) {
    console.error(`CADENCE_MIRROR_FAILED owner=${ownerId} ${err?.message || err}`);
  }

  return { interactions, channels, scores, cohorts, mirrored };
}

/**
 * Read back what refreshChannelStats just wrote and hand it to the warehouse.
 *
 * The rows are re-read rather than returned out of the refresh because the
 * refresh's INSERT ... ON CONFLICT reports how many rows it touched, not what
 * they now say, and a mirror of "18 rows changed" is not a mirror.
 */
async function mirrorCadenceToWarehouse(ownerId) {
  const { isReady } = await import("../pdw/bq-client.js");
  if (!isReady()) return 0;
  const { mirrorOwnerCadence } = await import("../pdw/mirror-cadence.js");
  const { rows } = await query(
    `SELECT contact_id, channel, first_at, last_at, count_30d, count_90d, count_all, accounts
       FROM contact_channel_stats WHERE owner_id = $1`,
    [asUuid(ownerId)],
  );
  return await mirrorOwnerCadence(ownerId, rows);
}

/**
 * Owners with any contacts, oldest rollup first, so a fleet-wide pass over a
 * time budget makes progress on the staleset instead of re-doing the same
 * accounts. NULL sorts first: an owner who has never been rolled up outranks
 * one whose numbers are merely old.
 *
 * DRIVEN OFF users, NOT off contacts. The obvious shape is
 * `GROUP BY owner_id FROM contacts`, and it is a hash aggregate over the
 * largest table in the database on every run -- contacts is accounts times
 * address book, users is just accounts. This walks users and does one bounded
 * index lookup per account instead.
 *
 * IT STILL TOUCHES EVERY ACCOUNT, which is the honest limit of this function:
 * it is fine at thousands and it is a lot of small scans at millions. The fix
 * is a staleness watermark -- one timestamp per owner, updated by the job,
 * indexed -- and that is a new column and a new index, so it is Karthik's call
 * rather than something to slip in here.
 */
export async function ownersNeedingRefresh(limit = 100) {
  const n = Math.min(Math.max(Number(limit) || 100, 1), 5000);
  const { rows } = await query(
    `SELECT u.amber_id AS owner_id,
            (SELECT count(*)::int FROM contacts c
              WHERE c.owner_id = u.amber_id AND c.deleted_at IS NULL) AS contacts,
            (SELECT min(cs.computed_at) FROM contact_scores cs
              WHERE cs.owner_id = u.amber_id) AS oldest_score
       FROM users u
      WHERE u.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM contacts c
                     WHERE c.owner_id = u.amber_id AND c.deleted_at IS NULL)
      ORDER BY oldest_score ASC NULLS FIRST
      LIMIT $1`,
    [n],
  );
  return rows.map((r) => ({
    ownerId: r.owner_id,
    contacts: r.contacts,
    oldestScore: r.oldest_score,
  }));
}

/**
 * What the rollup currently holds for one owner. For the status script and for
 * a smoke test to assert against -- not a read path for the app, which should
 * go through the shortlist index.
 */
export async function rollupSummary(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return null;
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM contacts
         WHERE owner_id = $1 AND deleted_at IS NULL)               AS contacts,
       (SELECT count(*)::int FROM contact_interaction_stats
         WHERE owner_id = $1)                                      AS stats_rows,
       (SELECT count(*)::int FROM contact_scores
         WHERE owner_id = $1)                                      AS score_rows,
       (SELECT count(*)::int FROM contact_scores
         WHERE owner_id = $1 AND warmth > 0)                       AS warm_contacts,
       (SELECT max(computed_at) FROM contact_scores
         WHERE owner_id = $1)                                      AS computed_at`,
    [owner],
  );
  return rows[0] ?? null;
}
