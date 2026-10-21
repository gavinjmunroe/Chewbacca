/**
 * CORRECTING WHO A NOTE IS ABOUT.
 *
 * The chips under a note ("FILED TO  Drew · Mei") come from
 * observation_participants: every observation whose source_conversation_id is
 * this note, joined to the contact each one names. That is the authoritative
 * source — conversations.js merges it over the people frozen into the assistant
 * message precisely so that a correction wins.
 *
 * WHAT THERE WAS NO WAY TO DO. Amber heard "Mee", guessed Mei Lin, asked, and
 * was told no — and then nothing. The guess stayed on the note, the chip stayed
 * wrong, and there was no gesture anywhere that could change it. Worse, the
 * observation the correction would have edited was often never written at all,
 * because it went in with status "pending_contact" and the column's CHECK
 * rejected it (fixed separately).
 *
 * So: repoint a participant, or drop it. Both are surgical — this touches only
 * the rows belonging to ONE conversation and ONE contact, and never the note's
 * text.
 *
 * IT REPOINTS observations.contact_id TOO. A note produces two kinds of row: a
 * participant link per person mentioned, and, for facts about a specific person,
 * an observation whose own contact_id is that person. Moving only the
 * participants would leave the fact filed under the wrong contact's card while
 * the chip on the feed read correctly — the two would disagree, and the card is
 * the one that matters.
 */

import { query, withTransaction } from "./sql.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/**
 * Move a note's tag from one contact to another, or remove it.
 *
 *   retagNote(owner, conv, from, to)    — it was Mei, it is actually Mee
 *   retagNote(owner, conv, from, null)  — it is not about this person at all
 *
 * Returns { ok, participants, observations, reason? } with the row counts
 * touched, so a correction is auditable rather than a boolean.
 */
export async function retagNote(ownerId, conversationId, fromContactId, toContactId = null) {
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  const from = asUuid(fromContactId);
  const to = toContactId == null ? null : asUuid(toContactId);
  if (!owner || !conv || !from) return { ok: false, reason: "invalid" };
  if (toContactId != null && !to) return { ok: false, reason: "invalid" };
  if (to && to === from) return { ok: false, reason: "same_contact" };

  try {
    return await withTransaction(async (client) => {
      // The destination must be this owner's and live. Without this check a
      // correction could file a note against a contact id the caller does not
      // own -- the one thing this endpoint must not allow.
      if (to) {
        const { rows } = await client.query(
          `SELECT 1 FROM contacts
            WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
          [to, owner],
        );
        if (rows.length === 0) return { ok: false, reason: "target_not_found" };
      }

      // The observations this note produced. Scoped to the conversation, so a
      // correction on one note cannot touch what the same person said in
      // another.
      const { rows: obsRows } = await client.query(
        `SELECT observation_id FROM observations
          WHERE owner_id = $1 AND source_conversation_id = $2 AND deleted_at IS NULL`,
        [owner, conv],
      );
      if (obsRows.length === 0) return { ok: false, reason: "note_not_found" };
      const obsIds = obsRows.map((r) => r.observation_id);

      let participants = 0;
      if (to) {
        // ALREADY A PARTICIPANT? Then the correction is a MERGE of two chips,
        // not a move: "Mei and Mee" where both were actually Mee. Delete the
        // wrong link rather than repointing it into a duplicate -- the table is
        // PRIMARY KEY (observation_id, contact_id), so the update would collide
        // on exactly the rows where both are already present. Role is not part
        // of that key, so it plays no part in the check either.
        const dupe = await client.query(
          `DELETE FROM observation_participants
            WHERE owner_id = $1 AND contact_id = $2
              AND observation_id = ANY($3::uuid[])
              AND EXISTS (
                SELECT 1 FROM observation_participants p2
                 WHERE p2.owner_id = $1
                   AND p2.contact_id = $4
                   AND p2.observation_id = observation_participants.observation_id
              )`,
          [owner, from, obsIds, to],
        );
        participants += dupe.rowCount ?? 0;

        const moved = await client.query(
          `UPDATE observation_participants
              SET contact_id = $4
            WHERE owner_id = $1 AND contact_id = $2
              AND observation_id = ANY($3::uuid[])`,
          [owner, from, obsIds, to],
        );
        participants += moved.rowCount ?? 0;
      } else {
        const removed = await client.query(
          `DELETE FROM observation_participants
            WHERE owner_id = $1 AND contact_id = $2
              AND observation_id = ANY($3::uuid[])`,
          [owner, from, obsIds],
        );
        participants += removed.rowCount ?? 0;
      }

      // AND THE FACTS FILED ON THEIR CARD.
      //
      // With no destination the observation becomes unattributed rather than
      // deleted: the sentence was still said, we just no longer claim to know
      // who it was about. "pending" is the column's word for that, and it is
      // invisible to ranking until someone answers -- which is the correct
      // state for a fact whose subject was just denied.
      const obs = await client.query(
        to
          ? `UPDATE observations SET contact_id = $4, status = 'resolved'
              WHERE owner_id = $1 AND contact_id = $2
                AND observation_id = ANY($3::uuid[])`
          : `UPDATE observations SET contact_id = NULL, status = 'pending'
              WHERE owner_id = $1 AND contact_id = $2
                AND observation_id = ANY($3::uuid[])`,
        to ? [owner, from, obsIds, to] : [owner, from, obsIds],
      );

      return { ok: true, participants, observations: obs.rowCount ?? 0 };
    });
  } catch (e) {
    console.error(`RETAG_NOTE_ERR owner=${ownerId} conv=${conversationId} ${e?.stack || e?.message || e}`);
    return { ok: false, reason: "error" };
  }
}

/**
 * WHO AMBER GUESSED AND NOBODY CONFIRMED — the unanswered "which Maggie?"s.
 *
 * An observation with status 'pending' has a raw_name and no contact: Amber
 * heard a name it could not attribute, or attributed one that was rejected.
 * Until now those rows were written and then never surfaced anywhere, so the
 * question was asked once, in a chat, and lost the moment it scrolled.
 *
 * Returned per conversation so the note itself can show "Amber wasn't sure who
 * Mee is" with the candidates to choose from, which is where the user actually
 * has the context to answer.
 */
export async function pendingTagsForNote(ownerId, conversationId) {
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  if (!owner || !conv) return [];
  try {
    const { rows } = await query(
      `SELECT DISTINCT ON (lower(o.raw_name))
              o.observation_id, o.raw_name, o.body
         FROM observations o
        WHERE o.owner_id = $1
          AND o.source_conversation_id = $2
          AND o.deleted_at IS NULL
          AND o.status = 'pending'
          AND o.contact_id IS NULL
          AND COALESCE(TRIM(o.raw_name), '') <> ''
        ORDER BY lower(o.raw_name), o.observed_at DESC`,
      [owner, conv],
    );
    return rows.map((r) => ({
      observationId: String(r.observation_id),
      rawName: r.raw_name,
      body: r.body ?? null,
    }));
  } catch (e) {
    console.error(`PENDING_TAGS_ERR owner=${ownerId} ${e?.message || e}`);
    return [];
  }
}

/**
 * Answer one of those questions: "the Mee in this note is THIS contact".
 *
 * Attributes every pending observation in the note that carries the same raw
 * name — one answer settles all of them, because they are all the same person
 * being mentioned more than once.
 */
export async function resolvePendingTag(ownerId, conversationId, rawName, contactId) {
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  const contact = asUuid(contactId);
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!owner || !conv || !contact || !name) return { ok: false, reason: "invalid" };
  try {
    return await withTransaction(async (client) => {
      const { rows: own } = await client.query(
        `SELECT 1 FROM contacts WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [contact, owner],
      );
      if (own.length === 0) return { ok: false, reason: "target_not_found" };

      const { rows: obsRows } = await client.query(
        `SELECT observation_id FROM observations
          WHERE owner_id = $1 AND source_conversation_id = $2 AND deleted_at IS NULL
            AND status = 'pending' AND contact_id IS NULL
            AND lower(TRIM(raw_name)) = lower($3)`,
        [owner, conv, name],
      );
      if (obsRows.length === 0) return { ok: false, reason: "nothing_pending" };
      const obsIds = obsRows.map((r) => r.observation_id);

      await client.query(
        `UPDATE observations
            SET contact_id = $3, status = 'resolved'
          WHERE owner_id = $1 AND observation_id = ANY($2::uuid[])`,
        [owner, obsIds, contact],
      );

      // A participant link too, so the chip appears on the note. 'subject',
      // because a pending row exists precisely because the note was ABOUT this
      // person and we could not say who they were.
      await client.query(
        `INSERT INTO observation_participants (owner_id, observation_id, contact_id, role)
         SELECT $1, x, $2, 'subject' FROM unnest($3::uuid[]) AS x
         ON CONFLICT DO NOTHING`,
        [owner, contact, obsIds],
      );

      return { ok: true, resolved: obsIds.length };
    });
  } catch (e) {
    console.error(`RESOLVE_PENDING_TAG_ERR owner=${ownerId} ${e?.stack || e?.message || e}`);
    return { ok: false, reason: "error" };
  }
}
