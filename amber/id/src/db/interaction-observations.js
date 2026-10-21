/**
 * USING THE APP WITH SOMEBODY IS EVIDENCE ABOUT THEM.
 *
 * "If me and Maggie are talking in a direct chat, then that information should
 * feed our Amber instances of each other. Same with circles for every member of
 * the circle."
 *
 * Until now the only thing that reached PeopleRank was what the owner said to
 * Amber ABOUT someone. Talking TO them in the app produced dm_messages rows and
 * nothing else -- so a relationship that lived entirely inside Amber scored the
 * same as one with no evidence at all, and none of what was actually said moved
 * the six dimensions.
 *
 * BOTH SIDES, WHICH IS THE WHOLE POINT AND THE THING TO BE CAREFUL ABOUT.
 * A message between two accounts is one event in two people's histories, so it
 * is written twice: once for each owner, each against their OWN contact card for
 * the other person. Both writes go through insertObservation, whose composite
 * foreign key makes a row whose owner disagrees with its contact's owner
 * impossible to write -- so "write into the other person's data" can only ever
 * mean "against their own card for the person they are talking to". Nobody who
 * is not in the conversation is touched, and a side with no contact card for the
 * other person simply gets nothing.
 *
 * ONE OBSERVATION PER HOUR OF CONVERSATION, NOT ONE PER MESSAGE. Fifty messages
 * over lunch is one exchange, and fifty rows would be fifty interactions in the
 * cadence numbers, fifty trips through the dimension classifier, and a contact
 * card that is mostly chat log. So the first message in a window writes the row
 * and the rest APPEND to it -- and appending resets dimension_status to
 * 'pending', so the classifier reads the accumulated exchange rather than
 * whichever three words opened it. ("Hey" classifies as nothing; "hey" plus the
 * next twenty lines is the conversation.)
 *
 * AND IT IS DELIBERATELY NOT COUNTED TWICE IN CADENCE. contact-rollup's
 * INTERACTION_STREAM already has a dm_messages arm, so a DM-sourced observation
 * would be the same lunch counted from both sides of the same database. The
 * observation arms there exclude source = 'dm' for exactly the reason the event
 * arms exclude events an observation points at. What these rows add is CONTENT
 * -- the dimensions, and something to read -- not another tally mark.
 *
 * Every function here is best-effort: it logs and returns a count. A message
 * must send, and a note must share, whether or not this succeeds.
 */

import { query } from "./sql.js";
import { insertObservation } from "./observations-store.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/** How long one exchange is. Longer than a conversation gap, shorter than a day. */
const WINDOW_MINUTES = 60;
/** The body cap. An exchange that runs past this keeps its opening, not its tail. */
const MAX_BODY = 3500;

const warn = (log, line) => (log?.warn ? log.warn(line) : console.warn(line));

/**
 * One owner's own contact card for another Amber account, or null.
 *
 * linked_amber_id is the only honest join: it is written exclusively by
 * db/identity-link.js, which requires a phone or email that the account itself
 * proved. A name match would be a guess, and a guess here files somebody's
 * conversation on the wrong person's card.
 */
async function contactCardFor(ownerId, subjectAmberId) {
  const owner = asUuid(ownerId);
  const subject = asUuid(subjectAmberId);
  if (!owner || !subject || owner === subject) return null;
  const { rows } = await query(
    `SELECT id, full_name FROM contacts
      WHERE owner_id = $1 AND linked_amber_id = $2 AND deleted_at IS NULL
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
    [owner, subject],
  );
  return rows[0] ? { id: String(rows[0].id), name: rows[0].full_name ?? null } : null;
}

/** The open row for this owner/contact/source, if the window has not closed. */
async function openWindowRow(ownerId, contactId, source) {
  const { rows } = await query(
    `SELECT observation_id, body FROM observations
      WHERE owner_id = $1 AND contact_id = $2 AND source = $3
        AND deleted_at IS NULL
        AND observed_at >= now() - ($4 || ' minutes')::interval
      ORDER BY observed_at DESC
      LIMIT 1`,
    [ownerId, contactId, source, String(WINDOW_MINUTES)],
  );
  return rows[0] ?? null;
}

/**
 * Add a line to an open exchange and send it back to the classifier.
 *
 * dimension_attempts is reset with the status: the row may already have been
 * classified and retired, and without the reset a re-queued row is dropped by
 * the worker's `dimension_attempts < MAX_ATTEMPTS` guard on the third append.
 */
async function appendLine(observationId, line) {
  await query(
    `UPDATE observations
        SET body = left(body || E'\\n' || $2, $3),
            dimension_status = 'pending',
            dimension_attempts = 0
      WHERE observation_id = $1`,
    [observationId, line, MAX_BODY],
  );
}

/**
 * THE THREE DATABASE CALLS, IN ONE INDIRECTION, so the decisions above can be
 * tested without a database.
 *
 * Which side gets a row, when an exchange is one row rather than two, and what
 * happens when somebody is not in the other's address book are all POLICY, and
 * they are the part that was wrong the last three times something like this
 * shipped. The SQL is not what needs the test. Same shape as the
 * `__injectPoolForSmokeTests` hook the backfill scripts use.
 */
const impl = { contactCardFor, openWindowRow, appendLine, insertObservation };

/** TEST ONLY. Replace one or more of the database calls above. */
export function __setImplForTests(patch = {}) {
  const before = { ...impl };
  Object.assign(impl, patch);
  return () => Object.assign(impl, before);
}

/**
 * Record one side of an interaction: owner learns something by talking with
 * subject. Returns 'appended' | 'inserted' | null.
 */
async function observeOneSide({
  ownerId,
  subjectAmberId,
  line,
  source,
  kind = "note",
  log = null,
}) {
  const card = await impl.contactCardFor(ownerId, subjectAmberId).catch(() => null);
  if (!card) return null; // they are not in this owner's address book
  const open = await impl.openWindowRow(ownerId, card.id, source).catch(() => null);
  if (open) {
    await impl.appendLine(open.observation_id, line);
    return "appended";
  }
  await impl.insertObservation({
    ownerId,
    contactId: card.id,
    kind,
    // It happened. Not a plan and not a hypothetical -- this is the one thing
    // in the system we know for certain took place, because the app did it.
    modality: "actual",
    body: line.slice(0, MAX_BODY),
    source,
    // A conversation is not a permanent fact about a person and it is not a
    // one-day wonder either. Two years, so last month's exchange still counts
    // for most of its worth and 2019's barely counts at all.
    temporalShape: "decay",
    decayHalfLifeDays: 730,
    // We are certain it was said; we are not certain what it means. Below the
    // 1.0 of something the owner stated to Amber as a fact.
    confidence: 0.7,
    // Deliberately quiet. Chat is the highest-VOLUME evidence in the app and
    // the lowest-density, and salience is what stops it crowding out the
    // sentence somebody sat down to say.
    salience: 0.3,
    status: "resolved",
  });
  return "inserted";
}

/**
 * A direct message, filed for both people in it.
 *
 * TEXT ONLY, for now. A voice DM has no transcript yet (that is the DM Info
 * work), and "sent a voice message" as a body would give the classifier nothing
 * to read while still spending a row -- so voice messages keep feeding cadence
 * through the dm_messages arm and nothing else, which is what they did before.
 */
export async function observeDmMessage({
  senderAmberId,
  recipientAmberId,
  text,
  senderName = null,
  recipientName = null,
  log = null,
} = {}) {
  const sender = asUuid(senderAmberId);
  const recipient = asUuid(recipientAmberId);
  const body = typeof text === "string" ? text.trim() : "";
  if (!sender || !recipient || sender === recipient || !body) return 0;

  // WHO SAID IT IS PART OF WHAT WAS SAID. "I'm moving to Denver" means
  // something entirely different depending on which side of the thread it came
  // from, and the classifier only ever sees this text.
  const line = body.slice(0, 1200);
  const sides = [
    {
      ownerId: sender,
      subjectAmberId: recipient,
      line: `Message I sent${recipientName ? ` to ${recipientName}` : ""}: ${line}`,
    },
    {
      ownerId: recipient,
      subjectAmberId: sender,
      line: `Message they sent me${senderName ? ` (${senderName})` : ""}: ${line}`,
    },
  ];

  let written = 0;
  for (const side of sides) {
    try {
      const r = await observeOneSide({ ...side, source: "dm", log });
      if (r) written += 1;
    } catch (err) {
      warn(log, `DM_OBSERVATION_FAILED owner=${side.ownerId} ${err?.message || err}`);
    }
  }
  return written;
}

/**
 * A note shared into a circle, filed for everyone it reached.
 *
 * The audience is the circle's OWNER plus every member with a linked account,
 * which is the same set note-shares.js notifies -- computed here rather than
 * passed in so the two cannot silently disagree about who is in a circle (they
 * already did once: circle_members rows belong to the circle's owner, and a
 * predicate that assumed they belonged to the SHARER notified nobody whenever a
 * member posted).
 *
 * Two different writes, because the two sides know different things:
 *   - each recipient learns something from the SHARER, filed on their card;
 *   - the sharer had contact with everyone at once, which is the group-dinner
 *     shape: one row, everybody a participant.
 */
export async function observeCircleShare({
  sharerAmberId,
  circleId,
  excerpt = null,
  log = null,
} = {}) {
  const sharer = asUuid(sharerAmberId);
  const circle = asUuid(circleId);
  if (!sharer || !circle) return 0;

  let circleRow;
  try {
    const { rows } = await query(
      `SELECT id, name, owner_id FROM circles WHERE id = $1 AND deleted_at IS NULL`,
      [circle],
    );
    circleRow = rows[0];
  } catch (err) {
    warn(log, `CIRCLE_OBSERVATION_LOOKUP_FAILED circle=${circleId} ${err?.message || err}`);
    return 0;
  }
  if (!circleRow) return 0;
  const circleName = circleRow.name || "a circle";

  let audience = [];
  try {
    const { rows } = await query(
      `WITH circ AS (
         SELECT id, owner_id FROM circles WHERE id = $1 AND deleted_at IS NULL
       )
       SELECT DISTINCT r.member FROM circ CROSS JOIN LATERAL (
         SELECT circ.owner_id AS member
         UNION
         SELECT c.linked_amber_id
           FROM circle_members cm
           JOIN contacts c ON c.id = cm.contact_id AND c.deleted_at IS NULL
          WHERE cm.circle_id = circ.id AND cm.owner_id = circ.owner_id
            AND c.linked_amber_id IS NOT NULL
       ) r
       WHERE r.member IS NOT NULL AND r.member <> $2`,
      [circle, sharer],
    );
    audience = rows.map((r) => String(r.member));
  } catch (err) {
    warn(log, `CIRCLE_OBSERVATION_AUDIENCE_FAILED circle=${circleId} ${err?.message || err}`);
    return 0;
  }
  if (audience.length === 0) return 0;

  const tail = excerpt ? `: ${String(excerpt).trim().slice(0, 800)}` : "";
  let written = 0;

  for (const member of audience) {
    try {
      const r = await observeOneSide({
        ownerId: member,
        subjectAmberId: sharer,
        line: `Shared a note in ${circleName}${tail}`,
        source: "circle",
        log,
      });
      if (r) written += 1;
    } catch (err) {
      warn(log, `CIRCLE_OBSERVATION_FAILED owner=${member} ${err?.message || err}`);
    }
  }

  // ── And the sharer's own side ────────────────────────────────────────────
  //
  // One row with everyone on it. contact_id is left null and the subject is the
  // CIRCLE when the sharer owns it: a note posted to a group is about the group,
  // and pinning it to whichever member sorted first would be a lie the ranker
  // would then act on. The participants are what reach each person's numbers --
  // see the participants arm of INTERACTION_STREAM.
  try {
    const { rows } = await query(
      `SELECT id FROM contacts
        WHERE owner_id = $1 AND deleted_at IS NULL
          AND linked_amber_id = ANY($2::uuid[])`,
      [sharer, audience],
    );
    const participants = rows.map((r) => ({ contactId: String(r.id), role: "participant" }));
    if (participants.length > 0) {
      const ownsCircle = String(circleRow.owner_id) === sharer;
      await insertObservation({
        ownerId: sharer,
        // Only when it is theirs: observations.circle_id points at the owner's
        // own circles, and a member posting into someone else's circle has no
        // row there to point at.
        circleId: ownsCircle ? circle : null,
        kind: "note",
        modality: "actual",
        body: `Shared a note in ${circleName}${tail}`,
        source: "circle",
        sourceCircleId: circle,
        temporalShape: "decay",
        decayHalfLifeDays: 730,
        confidence: 0.7,
        salience: 0.3,
        status: "resolved",
        participants,
        // An experience creates an event; a note shared to a circle is not an
        // occasion, and one calendar entry per post would fill the timeline.
        createEvent: false,
      });
      written += 1;
    }
  } catch (err) {
    warn(log, `CIRCLE_OBSERVATION_SELF_FAILED owner=${sharer} ${err?.message || err}`);
  }

  return written;
}
