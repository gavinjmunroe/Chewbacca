/**
 * THE PORT. Every function the routes already call, with its name, its arguments
 * and its return shape unchanged — reading and writing `observations` instead of
 * contact_facts, contact_notes, contact_experiences, user_facts and
 * app_conversation_messages.
 *
 * WHY A SEPARATE MODULE RATHER THAN EDITS IN PLACE
 * store.js is 3,792 lines and 36 routes import it. Porting inside it would have
 * meant thirty surgical edits in a file where a mistake is invisible; here the
 * old definitions are deleted and store.js re-exports these, so the diff is
 * legible and the two implementations never coexist.
 *
 * THE API CONTRACT IS FROZEN. Every route keeps getting the JSON it gets today.
 * Where the new model carries more than the old one did — dimensions, temporal
 * multiplier, provenance — it is returned as ADDITIONAL fields. Nothing that was
 * there before is missing, renamed, or reordered.
 *
 * IDS ARE NOW OPAQUE STRINGS. factId, noteId, experienceId and contactId were
 * bigints; they are uuids. Callers that pass them through are unaffected.
 * Callers that did Number(id) are the 66-function retype pass and are handled
 * separately — this module never coerces an id to a number.
 */

import { query, withTransaction } from "./sql.js";
import * as Obs from "./observations-store.js";
// The voice dictionary. Imported here rather than called from each route because
// upsertContactNameMemory below is the ONE place every "this spoken name means
// this contact" decision passes through, whichever way it was decided.
import { recordVoiceCorrection } from "../lib/voice-vocab.js";

const { asUuid } = Obs;

/** contact_facts.category is gone; a fact's meaning now lives in dimensions and
 *  tags. The column is still echoed back so existing UI keeps rendering. */
const echoCategory = (o) => o.dimensions?.[0]?.code ?? null;

/** The old row shape, rebuilt from an observation. Extra fields are additive. */
function asFactRow(o) {
  return {
    id: o.id,
    text: o.text,
    fact_text: o.text,
    category: echoCategory(o),
    sentiment: o.sentiment ?? null,
    sentiment_strength: o.sentiment_strength ?? null,
    certainty: o.certainty ?? null,
    is_past: o.temporal_multiplier != null && o.temporal_multiplier < 1,
    weight: o.salience ?? null,
    is_conditional: o.modality === "hypothetical",
    condition_text: o.condition_text ?? null,
    observed_at: o.observed_at,
    // ── additive, new to the model ──
    kind: o.kind,
    modality: o.modality,
    role: o.role,
    temporal_shape: o.temporal_shape,
    temporal_multiplier: o.temporal_multiplier,
    valid_until: o.valid_until,
    source: o.source,
    source_conversation_id: o.source_conversation_id,
    dimensions: o.dimensions ?? [],
  };
}

// ───────────────────────────── facts ─────────────────────────────

/**
 * sourceRef WAS POLYMORPHIC AND I COLLAPSED IT. Every caller's sourceRef used to
 * go into source_conversation_id, which has a foreign key to conversations. A
 * circle id is a valid uuid, so it passed asUuid and then failed the foreign key
 * -- inside a catch that returns null. Circle enrichment would have stopped
 * working silently and nothing would have said so.
 *
 * The reference means different things depending on where the fact came from, so
 * it is routed by `source` to the column that can actually hold it, and anything
 * unrecognised is dropped rather than pointed at the wrong table.
 */
/**
 * WHERE A FACT CAME FROM. AN ALLOWLIST OF SOURCE NAMES WAS THE WRONG SHAPE.
 *
 * This linked a conversation only for source 'voice_note' | 'chat' |
 * 'conversation'. The app's own capture path reports source 'soundboard', which
 * is on none of those lists, so every fact it wrote dropped its
 * source_conversation_id -- 202 of 214 observations in production have none.
 *
 * That column is what joins a fact back to the note you said it in: the
 * "filed to" chips read it, the tagged-people sheet reads it, and reopening a
 * note finds its facts through it. Losing it does not lose the fact, but it
 * severs the fact from its story, which is why old notes look empty.
 *
 * Inverted to a denylist. A sourceRef that is a uuid IS the thing this came
 * from; only a circle means something other than a conversation. New capture
 * paths now link by default instead of silently not linking until someone
 * remembers to add their source name here -- which is exactly what happened.
 * insertContactExperience already worked this way, which is why experiences
 * kept their link and facts from the same note did not.
 */
function provenance(source, sourceRef) {
  const id = asUuid(sourceRef);
  if (!id) return {};
  if (source === "circle") return { sourceCircleId: id };
  return { sourceConversationId: id };
}

export async function insertContactFact({
  ownerId, contactId, factText, category, source, sourceRef, rawName, status,
  sentiment, sentiment_strength, certainty, is_conditional, condition_text, is_past, weight,
}) {
  try {
    const r = await Obs.insertObservation({
      ownerId, contactId: contactId ?? null, kind: "fact",
      // is_conditional was a boolean beside a condition string; modality now
      // carries the distinction the ranker actually needs, and a hypothetical
      // must never be surfaced as a fact.
      modality: is_conditional ? "hypothetical" : "actual",
      body: factText,
      source: source ?? "manual",
      ...provenance(source, sourceRef),
      confidence: certainty ?? 1.0,
      sentiment: sentiment ?? null,
      sentimentStrength: sentiment_strength ?? null,
      salience: weight ?? null,
      // A fact with no contact is one we could not attribute. It stays pending
      // and is invisible to ranking until someone answers "which Maggie?".
      status: status ?? (contactId ? "resolved" : "pending"),
      rawName: rawName ?? null,
      conditionText: condition_text ?? null,
      // is_past said "this already happened" without saying when it stopped
      // mattering. A decay carries the same meaning and keeps decaying.
      temporalShape: is_past ? "decay" : null,
      decayHalfLifeDays: is_past ? Obs.DEFAULT_DECAY_HALF_LIFE_DAYS : null,
    });
    return { id: r.observationId };
  } catch (e) {
    console.error(`PHOTON_FACT_INSERT_ERR ${e?.stack || e?.message || e}`);
    return null;
  }
}

/**
 * The PeopleRank feeder. Same map-of-arrays shape as before, keyed by contact id.
 *
 * Three things it now does that the original could not: it returns observed_at
 * (the old query ordered by created_at and never selected it), it returns the
 * temporal multiplier already computed, and it includes observations the contact
 * merely participates in rather than only ones they are the subject of.
 */
export async function getResolvedFactsForContacts(ownerId, contactIds) {
  const map = await Obs.getObservationsForContacts(ownerId, contactIds);
  const out = {};
  for (const [cid, list] of Object.entries(map)) {
    out[cid] = list.filter((o) => o.kind === "fact").map(asFactRow);
  }
  return out;
}

/**
 * Everything about a set of contacts: facts PLUS the notes and experiences they
 * appear in. One query now — the original UNIONed three tables and had a helper
 * that retried each of them with and without created_at, because two of the
 * three did not reliably have the column.
 */
export async function getContactContentForContacts(ownerId, contactIds) {
  const map = await Obs.getObservationsForContacts(ownerId, contactIds);
  const out = {};
  for (const [cid, list] of Object.entries(map)) out[cid] = list.map(asFactRow);
  return out;
}

/**
 * WHAT THE USER SAID ABOUT SOMEBODY WHO IS NOT IN THEIR CONTACTS.
 *
 * A fact about a name that matched no contact is stored with contact_id NULL and
 * the spoken name in raw_name, awaiting a tap ("add as a new contact" / "skip").
 * That is a deliberate design -- Amber does not manufacture people from a
 * passing mention -- and it had one hole: NOTHING EVER READ THOSE ROWS BACK.
 *
 * So the user would say "I met Wren Halloway, partner at Northlight Capital,
 * does health infrastructure, she said to email her", and two turns later ask
 * "tell me about Wren Halloway" and be told "Nobody in your contacts goes by
 * Wren Halloway, so there is nothing on file to share about them." The sentence
 * they had just dictated was sitting in the database, keyed by that exact name.
 *
 * Told something and denying it is the single worst thing a memory can do, so
 * the read side exists now. It resolves nothing and creates nobody: it returns
 * what was said, and the caller offers to make the card.
 *
 * Matching is on the stored raw_name, case-insensitively, both directions --
 * "Wren" finds the row filed as "Wren Halloway", and asking the full name finds
 * a row filed under just the first name, which is how these mostly arrive.
 */
export async function getPendingFactsByName(ownerId, name, { limit = 12 } = {}) {
  const owner = asUuid(ownerId);
  const n = String(name || "").trim();
  if (!owner || n.length < 2) return [];
  const { rows } = await query(
    `SELECT o.observation_id AS id, o.body, o.raw_name, o.observed_at
       FROM observations o
      WHERE o.owner_id = $1
        AND o.deleted_at IS NULL
        AND o.contact_id IS NULL
        AND o.raw_name IS NOT NULL
        AND (lower(o.raw_name) = lower($2)
             OR lower($2) LIKE '%' || lower(o.raw_name) || '%'
             OR lower(o.raw_name) LIKE '%' || lower($2) || '%')
      ORDER BY o.observed_at DESC
      LIMIT $3`,
    [owner, n, Math.max(1, Math.min(50, limit))],
  );
  return rows.map((r) => ({
    id: String(r.id),
    text: String(r.body || ""),
    rawName: String(r.raw_name || ""),
    at: r.observed_at,
  }));
}

export async function getFactsForContact(ownerId, contactId) {
  const list = await Obs.getObservationsForContact(ownerId, contactId, { includeExpired: true, limitPerContact: Infinity });
  return list.map(asFactRow);
}

export async function getFactById(ownerId, id) {
  const owner = asUuid(ownerId), obs = asUuid(id);
  if (!owner || !obs) return null;
  const { rows } = await query(
    `SELECT observation_id AS id, owner_id, contact_id, body AS fact_text, body AS text,
            status, raw_name, source, confidence AS certainty, sentiment,
            sentiment_strength, salience AS weight, condition_text, observed_at,
            (modality = 'hypothetical') AS is_conditional
       FROM observations
      WHERE observation_id = $2 AND owner_id = $1 AND deleted_at IS NULL`,
    [owner, obs],
  );
  return rows[0] ?? null;
}

/** Attribute a pending fact to a contact. The four-step resolution lives in the
 *  store and runs in one transaction, so a half-resolved row is not reachable. */
export async function updateFactContact({ factId, contactId, status, ownerId }) {
  if (status && status !== "resolved") {
    const owner = asUuid(ownerId), obs = asUuid(factId);
    if (!owner || !obs) return 0;
    const { rowCount } = await query(
      `UPDATE observations SET status = $3, contact_id = $4
        WHERE observation_id = $2 AND owner_id = $1 AND deleted_at IS NULL`,
      [owner, obs, status, asUuid(contactId)],
    );
    return rowCount;
  }
  const okDone = await Obs.resolveObservationSubject({ ownerId, observationId: factId, contactId });
  return okDone ? 1 : 0;
}

/** Append to a fact's text. Kept because the ambiguity flow uses it to fold a
 *  follow-up answer into the fact it was answering. */
export async function appendFactDetail({ factId, extraText, ownerId }) {
  const owner = asUuid(ownerId), obs = asUuid(factId);
  if (!owner || !obs || !extraText) return 0;
  const { rowCount } = await query(
    `UPDATE observations SET body = body || ' ' || $3
      WHERE observation_id = $2 AND owner_id = $1 AND deleted_at IS NULL`,
    [owner, obs, String(extraText).trim()],
  );
  return rowCount;
}

// ───────────────────── facts about the user themselves ─────────────────────
// user_facts was a separate table for "things about me". It is an observation
// with no subject — the case the schema already has — which means the user's own
// facts finally get embeddings, dimensions and shelf life like everything else.

export async function insertUserFact({ ownerId, factText, category, source, sourceRef }) {
  try {
    const r = await Obs.insertObservation({
      ownerId, kind: "fact", body: factText,
      source: source ?? "manual", sourceConversationId: asUuid(sourceRef),
    });
    return { id: r.observationId };
  } catch (e) {
    console.error(`INSERT_USER_FACT_ERR ${e?.message || e}`);
    return null;
  }
}

export async function getUserFacts(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return [];
  const { rows } = await query(
    `SELECT observation_id AS id, body AS fact_text, body AS text, observed_at, source
       FROM observations
      WHERE owner_id = $1 AND contact_id IS NULL AND circle_id IS NULL
        AND status = 'resolved' AND deleted_at IS NULL
      ORDER BY observed_at DESC LIMIT 200`,
    [owner],
  );
  return rows;
}

// ───────────────────── notes and experiences ─────────────────────
// Both were tables whose only real difference from a fact was participant_ids.
// They are observations with a kind and participant rows.

export async function insertContactNote({
  ownerId, noteText, participantIds = [], rawNames = [], category = null,
  sentiment = null, sentimentStrength = null, certainty = null, weight = null,
  isPast = false, status = "resolved", source, sourceRef,
}) {
  try {
    const r = await Obs.insertObservation({
      ownerId, kind: "note", body: noteText,
      // A note about exactly one person keeps that person as the subject so the
      // hot single-contact index still applies. Several people, no subject.
      contactId: participantIds.length === 1 ? participantIds[0] : null,
      participants: participantIds.map((c) => ({ contactId: c, role: "participant" })),
      rawNames,
      source: source ?? "manual", sourceConversationId: asUuid(sourceRef),
      confidence: certainty ?? 1.0, sentiment, sentimentStrength,
      salience: weight ?? null, status,
      temporalShape: isPast ? "decay" : null,
      decayHalfLifeDays: isPast ? Obs.DEFAULT_DECAY_HALF_LIFE_DAYS : null,
    });
    return r.observationId;
  } catch (e) {
    console.error(`INSERT_CONTACT_NOTE_ERR ${e?.stack || e?.message || e}`);
    return null;
  }
}

export async function insertContactExperience({
  ownerId, experienceText, participantIds = [], participantsRoles = null,
  experienceType = null, location = null, occurredAt = null, rawNames = [],
  category = null, sentiment = null, sentimentStrength = null, certainty = null,
  weight = null, isPast = false, status = "resolved", source, sourceRef,
}) {
  try {
    const roles = participantsRoles || {};
    const r = await Obs.insertObservation({
      ownerId, kind: "experience", body: experienceText,
      // THE FIRST PARTICIPANT IS THE SUBJECT, NOT NOBODY.
      //
      // This was `participantIds.length === 1 ? participantIds[0] : null` -- the
      // same "more than one person means no subject" rule that was retired from
      // setParticipants, living on in a second function. Ten of fourteen
      // observations from one real note came out with contact_id null because of
      // it, so every group experience was invisible to anything joining on the
      // subject, and the interaction arm that counts the subject counted nobody.
      //
      // Subject is who the memory is about; participants are everyone present.
      // Two people is not an answer of "neither".
      contactId: participantIds[0] ?? null,
      participants: participantIds.map((c) => ({
        contactId: c, role: roles[c] === "subject" ? "subject" : "participant",
      })),
      rawNames,
      // An experience HAPPENED at a time. occurredAt is when, not when we heard.
      observedAt: occurredAt ?? null,
      source: source ?? "manual", sourceConversationId: asUuid(sourceRef),
      confidence: certainty ?? 1.0, sentiment, sentimentStrength,
      salience: weight ?? null, status,
      temporalShape: isPast ? "decay" : null,
      decayHalfLifeDays: isPast ? Obs.DEFAULT_DECAY_HALF_LIFE_DAYS : null,
    });
    return r.observationId;
  } catch (e) {
    console.error(`INSERT_CONTACT_EXPERIENCE_ERR ${e?.stack || e?.message || e}`);
    return null;
  }
}

// rawName threaded through so the append can close out the spoken name it
// answered -- see addParticipant. Optional, because the older callers that
// re-tag by hand have no raw name to close.
export const appendParticipantToNote = ({ id, ownerId, contactId, rawName = null }) =>
  Obs.addParticipant({ ownerId, observationId: id, contactId, rawName }).then((b) => (b ? 1 : 0));
export const appendParticipantToExperience = appendParticipantToNote;

/**
 * Replace the participant set. RETIRED IN PLACE -- delegates to
 * observations-store.setObservationParticipants.
 *
 * The local implementation set contact_id to null whenever more than one person
 * was on the row, which stripped the subject from every group experience, and it
 * touched neither observation_raw_names nor the event. Deleting the exports was
 * not an option -- routes/chat.js calls both names -- so the names survive and
 * the behavior is gone.
 */
const setParticipants = ({ ownerId, id, participantIds }) =>
  Obs.setObservationParticipants({
    ownerId, observationId: id, contactIds: participantIds,
  }).then((b) => (b ? 1 : 0));
export const setNoteParticipants = setParticipants;
export const setExperienceParticipants = setParticipants;

async function getObservationRow(ownerId, id, kind) {
  const owner = asUuid(ownerId), obs = asUuid(id);
  if (!owner || !obs) return null;
  const { rows } = await query(
    `SELECT o.observation_id AS id, o.body, o.kind, o.status, o.observed_at, o.source,
            COALESCE((SELECT array_agg(p.contact_id) FROM observation_participants p
                       WHERE p.observation_id = o.observation_id), '{}') AS participant_ids,
            COALESCE((SELECT array_agg(n.raw_name) FROM observation_raw_names n
                       WHERE n.observation_id = o.observation_id), '{}') AS raw_names
       FROM observations o
      WHERE o.observation_id = $2 AND o.owner_id = $1 AND o.deleted_at IS NULL`,
    [owner, obs],
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, note_text: r.body, experience_text: r.body, text: r.body };
}
export const getNoteById       = (ownerId, id) => getObservationRow(ownerId, id, "note");
export const getExperienceById = (ownerId, id) => getObservationRow(ownerId, id, "experience");

/** Everyone filed from one conversation — the "we saved these people" receipt
 *  shown after a voice note. One query now; it was a three-table UNION. */
/**
 * WHO A NOTE WAS FILED TO. RETURNS { people, pendingNames } -- WHICH IS WHAT ITS
 * CALLERS HAVE ALWAYS READ.
 *
 * This returned a bare array of { id, name, role }, and both call sites in
 * routes/conversations.js do `filed.people`. On an array that is undefined, so
 * the filed half of the merge was empty on every successful call -- the only
 * time it was ever an object was the .catch() fallback, which returns
 * { people: [], pendingNames: [] }. The failure path had the right shape and the
 * success path did not.
 *
 * The rows were wrong too: `id` where every consumer reads `contactId`, and both
 * the route and the Today card filter on `p.contactId != null`. So even a
 * correctly-shaped wrapper would have dropped all of them.
 *
 * Net effect: the "filed to" chips on a voice-note card could not appear, ever,
 * for any note, no matter how cleanly it was understood -- and the three-dot
 * "who is tagged" sheet always said "No one is tagged in this note yet."
 *
 * pendingNames rides along because the callers destructure it: spoken names not
 * yet linked to a contact, which the confirmation card owns and which must never
 * render as a settled gold chip.
 */
export async function getFiledPeopleForConversation(ownerId, conversationId) {
  const owner = asUuid(ownerId), conv = asUuid(conversationId);
  if (!owner || !conv) return { people: [], pendingNames: [] };
  // ONE ROW PER PERSON, NOT ONE PER ROLE THEY HELD.
  //
  // This was a plain DISTINCT over (contact_id, name, role). A note usually
  // produces several observations -- "Maggie and Sagar are handling BMA",
  // "Sagar and I are on the pitch deck" -- and one person can be the SUBJECT of
  // one and a PARTICIPANT of another. Two different roles, so DISTINCT kept both
  // rows, and the Today card printed "Sagar" twice side by side.
  //
  // DISTINCT ON (c.id) collapses them, and the ORDER BY picks which role
  // survives: subject over participant over mentioned, so the chip reflects the
  // strongest thing this person was in the note rather than whichever row the
  // planner happened to return first.
  const { rows } = await query(
    `SELECT DISTINCT ON (c.id) c.id AS contact_id, c.full_name AS name, p.role
       FROM observations o
       JOIN observation_participants p USING (observation_id)
       JOIN contacts c ON c.id = p.contact_id AND c.owner_id = p.owner_id
      WHERE o.owner_id = $1 AND o.source_conversation_id = $2
        AND o.deleted_at IS NULL AND c.deleted_at IS NULL
      ORDER BY c.id,
               CASE p.role WHEN 'subject' THEN 0 WHEN 'participant' THEN 1 ELSE 2 END`,
    [owner, conv],
  );
  // Alphabetical again once the collapse is done -- DISTINCT ON dictates its own
  // leading ORDER BY, so the display order has to be reapplied here.
  rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const { rows: pending } = await query(
    `SELECT DISTINCT n.raw_name
       FROM observations o
       JOIN observation_raw_names n USING (observation_id)
      WHERE o.owner_id = $1 AND o.source_conversation_id = $2
        AND o.deleted_at IS NULL AND n.resolved_to IS NULL
      ORDER BY n.raw_name`,
    [owner, conv],
  );
  return {
    people: rows.map((r) => ({
      contactId: r.contact_id,
      name: r.name,
      role: r.role,
    })),
    pendingNames: pending.map((r) => r.raw_name),
  };
}

// ───────────────────── the "which Maggie?" workflow ─────────────────────

export async function setPendingFactContext({
  ownerId, awaiting, factId, rawName, questionAsked, candidates,
  reaskCount = 0, contentType = null, contentId = null,
}) {
  const owner = asUuid(ownerId);
  if (!owner) return null;
  const { rows } = await query(
    `INSERT INTO pending_fact_context
       (owner_id, awaiting, observation_id, raw_name, question_asked, candidates, reask_count)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id`,
    [owner, awaiting, asUuid(factId ?? contentId), rawName ?? null, questionAsked ?? null,
     JSON.stringify(candidates ?? []), reaskCount],
  );
  return rows[0]?.id ?? null;
}

export async function updatePendingFactContext({ id, ownerId, awaiting, candidates, reaskCount }) {
  const owner = asUuid(ownerId);
  if (!owner || !id) return 0;
  const { rowCount } = await query(
    `UPDATE pending_fact_context
        SET awaiting = COALESCE($3, awaiting),
            candidates = COALESCE($4::jsonb, candidates),
            reask_count = COALESCE($5, reask_count),
            updated_at = now()
      WHERE id = $2 AND owner_id = $1`,
    [owner, id, awaiting ?? null, candidates ? JSON.stringify(candidates) : null, reaskCount ?? null],
  );
  return rowCount;
}

const PFC_COLS = `id, owner_id, awaiting, observation_id AS fact_id, raw_name,
                  question_asked, candidates, reask_count, created_at, updated_at`;

export async function getPendingFactContext(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return null;
  const { rows } = await query(
    `SELECT ${PFC_COLS} FROM pending_fact_context WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 1`,
    [owner]);
  return rows[0] ?? null;
}

/** Bounded on purpose. This table grew without limit in prod because nothing
 *  swept it, and an unbounded read on a polled endpoint is a slow outage. */
export async function listPendingFactContext(ownerId, { maxAgeDays = 30, limit = 200 } = {}) {
  const owner = asUuid(ownerId);
  if (!owner) return [];
  const { rows } = await query(
    `SELECT * FROM (
       SELECT ${PFC_COLS} FROM pending_fact_context
        WHERE owner_id = $1 AND updated_at > now() - ($2 || ' days')::interval
        ORDER BY updated_at DESC LIMIT $3
     ) t ORDER BY updated_at ASC`,
    [owner, String(maxAgeDays), limit]);
  return rows;
}

export async function getPendingFactContextById(id, ownerId) {
  const owner = asUuid(ownerId);
  if (!owner || !id) return null;
  const { rows } = await query(
    `SELECT ${PFC_COLS} FROM pending_fact_context WHERE id=$2 AND owner_id=$1`, [owner, id]);
  return rows[0] ?? null;
}

export async function clearPendingFactContextById(id, ownerId) {
  const owner = asUuid(ownerId);
  if (!owner || !id) return 0;
  const { rowCount } = await query(
    `DELETE FROM pending_fact_context WHERE id=$2 AND owner_id=$1`, [owner, id]);
  return rowCount;
}

export async function clearPendingFactContext(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return 0;
  const { rowCount } = await query(`DELETE FROM pending_fact_context WHERE owner_id=$1`, [owner]);
  return rowCount;
}

// ───────────────────── name memory ─────────────────────

export const NAME_MEMORY_TRUST_STREAK = 2;

/**
 * RETURNS camelCase, BECAUSE THAT IS WHAT EVERY CALLER READS.
 *
 * This used to return the raw pg row -- stable_streak, current_contact_id --
 * while all eleven call sites in fact-capture.js and chat.js read
 * mem.stableStreak and mem.currentContactId. Those are undefined on a snake_case
 * row, so `mem.stableStreak >= NAME_MEMORY_TRUST_STREAK` was always
 * `undefined >= 2`, always false, and the trusted-pointer branch could never
 * fire. Corrections were written to contact_name_memory correctly by
 * resolve-pending and then never read by anything.
 *
 * The user-visible symptom: telling Amber "AJ means Ajay Sathappan, not AJ
 * Johnson" worked once, for that one note, and the very next mention asked
 * again. Forever. The more times it was corrected, the more obviously broken it
 * looked, because the fix was landing in a column nobody read.
 *
 * The contract is camelCase because that is what the readers already assume;
 * changing eleven call sites to snake_case would fix the symptom and leave the
 * next reader to trip over the same seam.
 */
export async function getContactNameMemory(ownerId, nameKey) {
  const owner = asUuid(ownerId);
  if (!owner || !nameKey) return null;
  const { rows } = await query(
    `SELECT owner_id, name_key, contact_id, stable_streak, last_confirmed_at
       FROM contact_name_memory WHERE owner_id=$1 AND name_key=$2`,
    [owner, String(nameKey).toLowerCase()]);
  const r = rows[0];
  if (!r) return null;
  return {
    ownerId: r.owner_id,
    nameKey: r.name_key,
    contactId: r.contact_id,
    // Same value under the name the resolution paths ask for.
    currentContactId: r.contact_id,
    // pg returns integers as strings for some column types; the comparisons
    // downstream are numeric, and "2" >= 2 is true but "10" >= 2 is false.
    stableStreak: Number(r.stable_streak) || 0,
    lastConfirmedAt: r.last_confirmed_at,
  };
}

/**
 * Remember that this owner means this card by this name.
 *
 * An EXPLICIT confirmation floors the streak at the trust threshold rather than
 * incrementing it by one, so a name the user has just answered is never asked
 * about again. Choosing a different contact resets the streak to 1 — the old
 * association is wrong and should not keep its earned trust.
 */
export async function upsertContactNameMemory({ ownerId, nameKey, chosenContactId, explicit = false }) {
  const owner = asUuid(ownerId), contact = asUuid(chosenContactId);
  if (!owner || !contact || !nameKey) return null;
  const key = String(nameKey).toLowerCase();
  const { rows } = await query(
    `INSERT INTO contact_name_memory (owner_id, name_key, contact_id, stable_streak, last_confirmed_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (owner_id, name_key) DO UPDATE
       SET contact_id = EXCLUDED.contact_id,
           stable_streak = CASE
             WHEN contact_name_memory.contact_id <> EXCLUDED.contact_id THEN 1
             WHEN $5 THEN GREATEST(contact_name_memory.stable_streak, $4)
             ELSE contact_name_memory.stable_streak + 1 END,
           last_confirmed_at = now()
     RETURNING contact_id, stable_streak`,
    [owner, key, contact, explicit ? NAME_MEMORY_TRUST_STREAK : 1, explicit]);
  const memory = rows[0] ?? null;
  // A NAME THAT HAS STUCK IS A SPELLING WORTH LEARNING.
  //
  // The voice dictionary only ever learned from questions the user was ASKED --
  // "you mean Ajay Sathappan?" -> yes -> record the pair. But the better the
  // matcher gets, the less it asks: once "AJ" resolves silently every time, the
  // question stops being asked and the dictionary can never learn the spelling.
  // So the transcript kept saying "AJ" forever precisely BECAUSE Amber had
  // learned who AJ was. That is the loop that could not close.
  //
  // This is the other half, and it is the thing the user actually described:
  // when the same spoken name has landed on the same contact enough times to be
  // trusted, write it into their dictionary so the next transcription spells it
  // out. Every path that decides "this name means this person" comes through
  // here -- a tap, a soft-confirm, a silent match -- so this is the one place
  // that sees them all.
  //
  // Fire-and-forget: a dictionary write must never cost a resolution.
  if (memory && Number(memory.stable_streak) >= NAME_MEMORY_TRUST_STREAK) {
    void learnSpellingFromMemory(owner, key, contact).catch(() => {});
  }
  return memory;
}

/**
 * Write "heard `key`, meant <their full name>" into the owner's dictionary.
 *
 * Only when the two actually differ: a name already transcribed correctly needs
 * no repair, and recordVoiceCorrection rejects a no-op pair anyway. The contact
 * id rides along so the transcript's tagger can find them from either spelling.
 */
async function learnSpellingFromMemory(ownerId, nameKey, contactId) {
  const { rows } = await query(
    `SELECT full_name FROM contacts
      WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [contactId, ownerId],
  );
  const fullName = String(rows[0]?.full_name || "").trim();
  if (!fullName) return;
  const heard = String(nameKey).toLowerCase().trim();
  const full = fullName.toLowerCase();
  const first = full.split(/\s+/)[0];

  // A NAME THE TRANSCRIBER GOT RIGHT IS NOT A CORRECTION.
  //
  // The first version of this learned from every trusted pointer, which would
  // have taught the dictionary victor→Victor Udobong and maggie→Maggie Chen.
  // Those are not repairs: the user said "Victor", the transcriber wrote
  // "Victor", and rewriting it to "Victor Udobong" mid-sentence would make the
  // transcript read like a database record instead of what was said.
  //
  // A repair is a form that is neither the name nor the first name -- "AJ" for
  // Ajay, "Sager" for Sagar, "Shireley" for Shirley. Those are the ones worth
  // fixing, and they are exactly the ones this now keeps.
  if (heard === full || heard === first) return;

  // ONE TOKEN IN, ONE TOKEN OUT. "AJ" becomes "Ajay", not "Ajay Sathappan",
  // because that is how the sentence was spoken -- the same rule
  // correctNameInContent already applies when it rewrites a stored note.
  const intended = heard.includes(" ") ? fullName : fullName.split(/\s+/)[0];
  await recordVoiceCorrection(ownerId, nameKey, intended, contactId);
}

// ───────────────────── conversations ─────────────────────

/**
 * A SPACE ID IS A UUID OR IT IS AN EXTERNAL STRING, and both have to resolve.
 *
 * asUuid() returns null for `spc-8f2a...`, which is the shape Photon uses for
 * every iMessage thread. Both readers and writers ran that null straight through
 * without erroring: this function returned [] before it queried anything, and
 * appendMessage minted a brand-new conversation on every single inbound message.
 * iMessage has therefore never had durable history, and the table has been
 * collecting one orphaned one-message thread per text since the webhook shipped.
 *
 * Resolved in ONE place so the two sides cannot disagree again. That was the
 * whole defect -- not that either call site was wrong on its own, but that they
 * were wrong differently.
 */
export async function resolveConversationId(ownerId, spaceId, client = null) {
  const owner = asUuid(ownerId);
  const key = String(spaceId ?? "").trim();
  if (!owner || !key) return null;
  const direct = asUuid(key);
  if (direct) return direct;
  const run = client ? (t, v) => client.query(t, v) : (t, v) => query(t, v);
  const { rows } = await run(
    `SELECT conversation_id FROM conversations
      WHERE owner_id = $1 AND external_id = $2 AND deleted_at IS NULL`,
    [owner, key],
  );
  return rows[0]?.conversation_id ?? null;
}

export async function loadRecentMessages(ownerId, spaceId, limit = 12) {
  const owner = asUuid(ownerId);
  const conv = await resolveConversationId(owner, spaceId);
  if (!owner || !conv) return [];
  const { rows } = await query(
    `SELECT role, sender, content AS text, content, created_at
       FROM (SELECT m.role, NULL::text AS sender, m.content, m.created_at
               FROM conversation_messages m
              WHERE m.owner_id = $1 AND m.conversation_id = $2 AND m.deleted_at IS NULL
              ORDER BY m.created_at DESC LIMIT $3) t
      ORDER BY created_at ASC`,
    [owner, conv, limit]);
  return rows;
}

/** Creates the conversation on first message, so a caller never has to know
 *  whether the thread already exists. */
export async function appendMessage({ ownerId, spaceId, role, sender = null, text }) {
  const owner = asUuid(ownerId);
  if (!owner || !text) return null;
  const external = asUuid(spaceId) ? null : String(spaceId ?? "").trim() || null;
  return withTransaction(async (client) => {
    let conv = asUuid(spaceId);
    if (conv) {
      const { rows } = await client.query(
        `INSERT INTO conversations (conversation_id, owner_id, kind)
         VALUES ($1,$2,'space') ON CONFLICT (conversation_id) DO NOTHING RETURNING conversation_id`,
        [conv, owner]);
      if (!rows[0]) {
        const chk = await client.query(
          `SELECT 1 FROM conversations WHERE conversation_id=$1 AND owner_id=$2`, [conv, owner]);
        if (!chk.rowCount) return null;   // someone else's thread
      }
    } else if (external) {
      /**
       * THE PHOTON PATH, which until migration 052 fell into the else below and
       * created a new thread per message.
       *
       * ON CONFLICT DO UPDATE rather than DO NOTHING, because DO NOTHING returns
       * no row on conflict and this needs the id back on the SECOND message as
       * much as the first -- which is every message but one. Touching updated_at
       * is a real write, so the RETURNING always has something to return.
       *
       * The unique index it conflicts on is partial (external_id IS NOT NULL),
       * which Postgres matches by the same predicate; that is why the index in
       * 052 is declared exactly this way.
       */
      const { rows } = await client.query(
        `INSERT INTO conversations (owner_id, kind, external_id)
         VALUES ($1,'space',$2)
         ON CONFLICT (owner_id, external_id) WHERE external_id IS NOT NULL
         DO UPDATE SET updated_at = now()
         RETURNING conversation_id`,
        [owner, external]);
      conv = rows[0]?.conversation_id ?? null;
      if (!conv) return null;
    } else {
      const { rows } = await client.query(
        `INSERT INTO conversations (owner_id, kind) VALUES ($1,'chat') RETURNING conversation_id`, [owner]);
      conv = rows[0].conversation_id;
    }
    const { rows } = await client.query(
      `INSERT INTO conversation_messages (conversation_id, owner_id, role, content)
       VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
      [conv, owner, role === "amber" ? "amber" : role === "system" ? "system" : "user", text]);
    await client.query(`UPDATE conversations SET updated_at = now() WHERE conversation_id = $1`, [conv]);
    return { id: rows[0].id, conversationId: conv, created_at: rows[0].created_at };
  });
}
