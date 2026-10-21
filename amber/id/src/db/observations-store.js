/**
 * OBSERVATIONS — the single store for everything the user knows.
 *
 * Replaces contact_facts, contact_notes, contact_experiences, user_facts and
 * contact_embedding. Those were five tables with the same shape, the same
 * authorization, the same lifecycle and five different sets of bugs; the only
 * thing that actually differed between them was a label and how many people
 * each row could be about.
 *
 * WHAT A ROW IS
 *   one thing the owner knows, about one contact / one circle / themselves,
 *   with when it was learned, how long it stays true, where it came from, how
 *   sure we are, and which of the six dimensions of health it is evidence for.
 *
 * THE THREE SUBJECTS, and the CHECK in the schema enforces exactly one:
 *   contact_id set   about one of your people
 *   circle_id  set   belongs to a circle
 *   both null        about you
 *
 * MULTI-PERSON CONTENT. "Had dinner with Maggie and Sagar" is ONE row with two
 * participant rows, not two rows with the same text. contact_id carries the
 * primary subject when there is one; observation_participants carries everyone.
 *
 * SECURITY INVARIANT: every statement here filters on owner_id, and the
 * composite foreign key means a row whose owner disagrees with its contact's
 * owner cannot be written at all. There is no "load then check" path.
 *
 * FAILURE POLICY, AND IT IS DELIBERATELY NOT THE OLD ONE. The tables this
 * replaces wrapped every read in a bare `catch { return [] }`, which is how the
 * favorites join returned "no favorites" for weeks instead of reporting that
 * uuid = text had raised. Reads here let the error out. Only the two write paths
 * that are genuinely best-effort swallow anything, and they log first.
 */

import { query, withTransaction } from "./sql.js";
import { noteObservationSource } from "./source-trust.js";
import { classifyByLexicon } from "../lib/observation-dimensions.js";

export const OBSERVATION_KINDS = Object.freeze([
  "fact", "note", "experience", "memory", "transcript",
]);
export const MODALITIES = Object.freeze([
  "actual", "planned", "hypothetical", "desired", "available", "declined",
]);
export const TEMPORAL_SHAPES = Object.freeze([
  "permanent", "window", "decay", "window_then_decay",
]);

/**
 * The fallback half-life for a fact recorded as decaying without saying how fast.
 * Five years. Exported because observations-compat.js needs the same number, and
 * two copies of a default is how they stop agreeing.
 */
export const DEFAULT_DECAY_HALF_LIFE_DAYS = 1825;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Null unless it is genuinely a uuid. Guards every id that reaches SQL. */
/**
 * The only statuses observations.status accepts, mirroring
 * db/migrations/20260828_015_observation_detail.sql:
 *
 *   CHECK (status IN ('resolved','pending','soft'))
 *
 * Kept here, beside the insert, because the capture pipeline has its OWN
 * vocabulary of outcome words -- captured, ambiguous, soft_confirm,
 * pending_contact -- and passing one of those through as a column value is
 * exactly the bug this set exists to catch.
 */
export const OBSERVATION_STATUSES = new Set(["resolved", "pending", "soft"]);

export function asUuid(v) {
  return typeof v === "string" && UUID_RE.test(v.trim())
    ? v.trim().toLowerCase()
    : null;
}

function clamp01(v) {
  if (v == null || Number.isNaN(Number(v))) return null;
  return Math.min(1, Math.max(0, Number(v)));
}

/**
 * Derive the temporal shape from what the caller actually knows.
 *
 * Callers hand us "this expires in 90 days" or "this fades" or nothing at all;
 * the schema wants a shape plus the columns that shape requires, and it REFUSES
 * a window with no valid_until or a decay with no half-life. Working that out
 * here means no caller has to remember the rule, and no caller can violate it.
 *
 * SILENCE MEANS PERMANENT, and that is the important line in this function.
 * "Has two kids", "moved to SF", "her sister is called Anna" carry no shape and
 * therefore never decay. Nothing in this system expires because of what
 * dimension it belongs to; a fact decays only when whoever recorded it said it
 * decays.
 *
 * THE DEFAULT HALF-LIFE IS FIVE YEARS, not the four months it used to be.
 * The facts that arrive marked 'decay' are life events -- a divorce, a
 * redundancy, a death -- and 120 days put a divorce at 1.6% of its weight after
 * two years. It should still be one of the most important things you know about
 * someone two years on. Erring long is also the cheaper mistake: too slow
 * surfaces something stale, too fast forgets something that mattered, and in a
 * relationship app the second is much worse. A caller that knows better -- "just
 * bought a car" -- passes its own half-life and overrides this.
 */
export function deriveTemporal({ temporalShape, validFrom, validUntil, decayHalfLifeDays }) {
  const from = validFrom ?? null;
  const until = validUntil ?? null;
  // Number(null) IS 0, AND 0 IS FINITE. That one coercion meant an explicit
  // `decayHalfLifeDays: null` became Math.max(1, 0) = a ONE DAY half-life, and
  // then the "a half-life implies decay" rule below turned the observation into
  // shape 'decay'. insertObservation's own signature defaults this parameter to
  // null, and a JS default only fires on undefined -- so EVERY caller that simply
  // did not mention a half-life got one.
  //
  // The effect was total and silent. Every observation this codebase has written
  // halves in weight every day and is pinned at the 0.15 residual floor within
  // about three days; nothing failed and nothing logged, the six dimensions just
  // scored everything older than a weekend at 15% of its worth. The documented
  // default, and the only sane one, is that a fact stays true until something
  // says otherwise.
  //
  // Absent means absent: only an actual number is a half-life.
  const hl =
    decayHalfLifeDays == null ||
    decayHalfLifeDays === "" ||
    !Number.isFinite(Number(decayHalfLifeDays))
      ? null
      : Math.max(1, Math.round(Number(decayHalfLifeDays)));

  if (temporalShape && TEMPORAL_SHAPES.includes(temporalShape)) {
    // Trust the caller, but supply whatever the CHECK constraint demands so a
    // deliberate shape never fails on a missing companion column.
    if (temporalShape === "window" && !until) {
      return { shape: "permanent", from, until: null, hl: null };
    }
    if (temporalShape === "decay") {
      return { shape: "decay", from, until, hl: hl ?? DEFAULT_DECAY_HALF_LIFE_DAYS };
    }
    if (temporalShape === "window_then_decay") {
      if (!until) return { shape: "permanent", from, until: null, hl: null };
      // A window that has closed has already told us the pressure is off, so it
      // fades faster than a bare point event -- but in years, not months.
      return { shape: "window_then_decay", from, until, hl: hl ?? 730 };
    }
    return { shape: temporalShape, from, until, hl };
  }
  // No shape given: an end date implies a window, a half-life implies decay,
  // and silence implies the fact simply stays true.
  if (until) return { shape: "window", from, until, hl: null };
  if (hl) return { shape: "decay", from, until: null, hl };
  return { shape: "permanent", from, until: null, hl: null };
}

/**
 * Write one observation, its participants, its unresolved names and its
 * dimension tags, in ONE transaction.
 *
 * All four or none. A half-written observation — text stored, dimensions lost —
 * is worse than a failed write, because nothing downstream can tell it happened:
 * the fact would rank as if it were evidence for nothing at all.
 */
/**
 * MAKE THE EVENT THIS OBSERVATION DESCRIBES, IF IT DESCRIBES ONE. IDEMPOTENT.
 *
 * An experience is two things: a memory, which carries the six dimensions and
 * the searchable text, and an interaction, which is what recency and cadence are
 * computed from. The events row is the second one.
 *
 * THIS USED TO RUN ONLY AT INSERT, WHICH IS THE ONE MOMENT IT CANNOT SUCCEED FOR
 * SPEECH. "Spencer, Eli and I went to Red Hook" is written the instant it is
 * transcribed, and the names resolve to contacts seconds later when the user
 * taps an answer. At insert there is nobody attached, the "somebody must be
 * involved" gate fails correctly, and nothing ever asked again -- so no
 * voice-captured experience has ever produced an event, and group evenings
 * counted toward nobody's warmth.
 *
 * So it is a function, called from insertObservation, resolveObservationSubject
 * and addParticipant. Being idempotent, calling it on every one of those is
 * free: it creates the event once, and every later call only syncs newly
 * resolved people onto it. A dinner whose guests are identified one at a time
 * over an afternoon ends with one event and all of them on it.
 *
 * ONLY WHEN SOMEBODY IS INVOLVED. An experience with no contact and no
 * participants is a fact about the owner's own day, and an interaction with
 * nobody is not an interaction.
 *
 * Takes a client rather than opening its own transaction, so the event and the
 * participant rows commit with whatever caused them.
 */
export async function ensureEventForObservation(
  client,
  { ownerId, observationId, eventTitle = null, eventEndsAt = null, placeId = null, createEvent = null } = {},
) {
  const owner = asUuid(ownerId);
  const obs = asUuid(observationId);
  if (!owner || !obs) return null;

  const { rows: oRows } = await client.query(
    `SELECT kind, modality, body, observed_at, scheduled_at, contact_id, circle_id, event_id
       FROM observations
      WHERE observation_id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [obs, owner],
  );
  const o = oRows[0];
  if (!o) return null;

  const wants = createEvent === null ? o.kind === "experience" : createEvent === true;
  if (!wants) return null;

  // observation_participants is the source of truth for who was there; the
  // subject is folded in because contact_id is a participant that happens to be
  // the one the memory is about.
  const { rows: pRows } = await client.query(
    `SELECT contact_id FROM observation_participants
      WHERE observation_id = $1 AND owner_id = $2`,
    [obs, owner],
  );
  const contactIds = new Set(pRows.map((r) => String(r.contact_id)));
  if (o.contact_id) contactIds.add(String(o.contact_id));
  if (contactIds.size === 0) return null;

  let eventId = o.event_id;
  if (!eventId) {
    const { rows: ev } = await client.query(
      `INSERT INTO events
         (owner_id, contact_id, circle_id, modality, kind, title,
          starts_at, ends_at, place_id, scheduled_at)
       VALUES ($1,$2,$3,$4,'experience',$5,$6,$7,$8,$9)
       RETURNING event_id`,
      [
        owner, o.contact_id, o.circle_id, o.modality,
        // The body is the title until something better exists. Truncated
        // because events.title is displayed and a paragraph is not a title.
        eventTitle ?? String(o.body || "").trim().slice(0, 200),
        // modality carries over, which is what makes a plan and a memory the
        // same row: a 'planned' experience with a future starts_at is ignored by
        // the rollup until its date passes. Nothing migrates when the day comes.
        o.observed_at, eventEndsAt, asUuid(placeId),
        /**
         * AND THIS IS WHAT DECIDES IF IT IS ON THE CALENDAR.
         *
         * starts_at above is unchanged and still falls back to when the note was
         * spoken -- contact-rollup.js reads it to work out when you last saw
         * somebody, and "when you told Amber about it" is a perfectly good
         * approximation of that. It is a terrible appointment time, which is the
         * bug: every note with a person in it appeared on today's day view.
         *
         * scheduled_at is NULL unless a time was actually stated, and the day
         * view selects on it. Same row, same rollup, two questions answered
         * separately instead of one column being asked to answer both.
         */
        o.scheduled_at ?? null,
      ],
    );
    eventId = ev[0].event_id;
    await client.query(
      `UPDATE observations SET event_id = $1 WHERE observation_id = $2`,
      [eventId, obs],
    );
  }

  // Sync, not insert-once: this runs again every time a name resolves, and the
  // conflict clause makes the repeats free.
  for (const cid of contactIds) {
    await client.query(
      `INSERT INTO event_participants (event_id, owner_id, contact_id, role)
       VALUES ($1,$2,$3,'participant')
       ON CONFLICT (event_id, contact_id) DO NOTHING`,
      [eventId, owner, cid],
    );
  }
  return eventId;
}

export async function insertObservation({
  ownerId,
  observationId = null, // optional, server-derived stable ID for reviewed memo actions
  contactId = null,
  circleId = null,
  kind = "fact",
  modality = "actual",
  body,
  observedAt = null,
  temporalShape = null,
  validFrom = null,
  validUntil = null,
  decayHalfLifeDays = null,
  source = "manual",
  sourceConversationId = null,
  // Provenance, not subject. A fact ABOUT a contact that we learned FROM a
  // circle carries both; the contact_id/circle_id XOR governs the subject only.
  sourceCircleId = null,
  confidence = 1.0,
  sentiment = null,
  sentimentStrength = null,
  salience = null,
  status = "resolved",
  rawName = null,
  conditionText = null,
  eventId = null,         // link to an existing events row, if the caller has one
  // AN EXPERIENCE CREATES THE EVENT IT DESCRIBES. Default on for kind
  // 'experience'; pass false to record the narrative without a calendar entry.
  createEvent = null,     // null = decide from kind, true/false = force
  eventTitle = null,
  eventEndsAt = null,
  placeId = null,
  embedding = null,
  participants = [],      // [{ contactId, role }]
  rawNames = [],          // ['Mags', ...] names not yet matched to a card
  dimensions = null,      // [{ dimensionId, confidence, weight, assignedBy }]
                          // null (the default) means CLASSIFY IT HERE. Pass []
                          // to mean "deliberately none" and skip the lexicon.
}) {
  const owner = asUuid(ownerId);
  if (!owner) throw new Error("insertObservation: ownerId must be a uuid");
  if (typeof body !== "string" || !body.trim()) {
    throw new Error("insertObservation: body is required");
  }
  const contact = asUuid(contactId);
  const circle = asUuid(circleId);
  if (contact && circle) {
    throw new Error("insertObservation: an observation is about a contact OR a circle, not both");
  }

  // THE STATUS IS CHECKED HERE, LOUDLY.
  //
  // observations.status carries CHECK (status IN ('resolved','pending','soft')),
  // and callers were passing "pending_contact" — a value from the capture
  // pipeline's own vocabulary of outcomes, which is a different vocabulary from
  // the column's. Postgres rejected the row, insertContactFact caught and logged
  // PHOTON_FACT_INSERT_ERR, and the note the user had just recorded existed
  // nowhere. Every unattributed fact was lost this way.
  //
  // Failing here rather than at the database gives the error a name and a place.
  // Not coerced to a legal value: silently rewriting a caller's status is how a
  // "pending" row ends up indistinguishable from a "resolved" one, and this
  // column decides what the ranker is allowed to surface.
  if (status != null && !OBSERVATION_STATUSES.has(status)) {
    throw new Error(
      `insertObservation: status "${status}" is not one of ` +
        `${[...OBSERVATION_STATUSES].join(", ")}`,
    );
  }

  // A SOURCE WITH NO TRUST WEIGHT SCORES 0.5 AND SAYS NOTHING. Say something.
  //
  // Not a validation -- the observation is the valuable thing and the weight is
  // a tuning parameter, so this warns and the write proceeds. Fire and forget,
  // once per source per process; see db/source-trust.js for why the check lives
  // here rather than in a test.
  noteObservationSource(source);

  const t = deriveTemporal({ temporalShape, validFrom, validUntil, decayHalfLifeDays });

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO observations
         (owner_id, contact_id, circle_id, kind, modality, body, observed_at,
          temporal_shape, valid_from, valid_until, decay_half_life_days,
          source, source_conversation_id, confidence, sentiment, sentiment_strength,
          salience, status, raw_name, condition_text, embedding, source_circle_id,
          event_id, scheduled_at, observation_id)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, now()),
               $8,$9,$10,$11,
               $12,$13,$14,$15,$16,
               $17,$18,$19,$20,$21,$22,
               $23,
               -- SCHEDULED_AT IS $7 WITHOUT THE COALESCE, and that one
               -- difference is the whole point of the column.
               --
               -- observed_at falls back to now(), so once it is written there is
               -- no way to tell a time somebody NAMED from a time nobody did --
               -- and every note that mentioned a person was landing on today's
               -- calendar because of it. This keeps the caller's answer verbatim,
               -- nulls included. See migration 048.
               $7, COALESCE($24::uuid, gen_random_uuid()))
       ON CONFLICT (observation_id) DO NOTHING
       RETURNING observation_id, observed_at, scheduled_at`,
      [
        owner, contact, circle, kind, modality, body.trim(), observedAt,
        t.shape, t.from, t.until, t.hl,
        source, asUuid(sourceConversationId), clamp01(confidence) ?? 1.0,
        sentiment, clamp01(sentimentStrength),
        clamp01(salience), status, rawName, conditionText, embedding,
        asUuid(sourceCircleId),
        asUuid(eventId),
        asUuid(observationId),
      ],
    );
    if (!rows.length && observationId) {
      const replay = await client.query(
        `SELECT observation_id, observed_at, event_id FROM observations
          WHERE observation_id = $1 AND owner_id = $2 AND contact_id IS NOT DISTINCT FROM $3
            AND kind = $4 AND body = $5 AND source = $6 AND deleted_at IS NULL`,
        [asUuid(observationId), owner, contact, kind, body.trim(), source],
      );
      if (!replay.rows.length) throw Error('memo_action_conflict');
      return { observationId: replay.rows[0].observation_id, observedAt: replay.rows[0].observed_at,
        eventId: replay.rows[0].event_id, replayed: true };
    }
    const id = rows[0].observation_id;
    const observedAtActual = rows[0].observed_at;

    // The primary subject is also a participant, so "everything this person
    // appears in" is one query against one index instead of a UNION.
    const seen = new Set();
    const rowsToAdd = [];
    if (contact) { seen.add(contact); rowsToAdd.push([id, owner, contact, "subject"]); }
    for (const p of participants) {
      const c = asUuid(p?.contactId ?? p);
      if (!c || seen.has(c)) continue;
      seen.add(c);
      rowsToAdd.push([id, owner, c, p?.role ?? "participant"]);
    }
    for (const r of rowsToAdd) {
      await client.query(
        `INSERT INTO observation_participants (observation_id, owner_id, contact_id, role)
         VALUES ($1,$2,$3,$4) ON CONFLICT (observation_id, contact_id) DO NOTHING`,
        r,
      );
    }

    /**
     * AN EXPERIENCE CREATES THE EVENT IT DESCRIBES.
     *
     * "Got dinner with Maya and John last night" is two things at once: a
     * memory, which carries the six dimensions and the searchable text, and an
     * interaction, which is what recency and cadence are computed from. Before
     * this, only the memory was written -- the Cloud SQL events table has never
     * had a writer, so the events arm of INTERACTION_STREAM read zero rows and
     * nobody's calendar ever reached their warmth score.
     *
     * The event carries WHEN and WHO; the observation carries WHAT IT MEANT;
     * observations.event_id joins them. Every person on the observation is a
     * participant on the event, so a group dinner counts for all of them
     * instead of whichever one happened to be the subject.
     *
     * modality carries straight over, which is what makes a plan and a memory
     * the same row: a 'planned' experience with a future observed_at becomes an
     * event that has not happened yet, and the rollup ignores it until its date
     * passes. Nothing has to migrate when the day arrives.
     *
     * ONLY WHEN SOMEBODY IS INVOLVED. An experience with no contact and no
     * participants is a fact about the owner's own day, and an interaction with
     * nobody is not an interaction.
     */
    // The event is created by ensureEventForObservation, not inline, because the
    // same question has to be re-asked every time the observation gains a person.
    // Voice capture resolves names ASYNCHRONOUSLY -- the row is written seconds
    // before the user answers "which Eli?" -- so at this moment `seen` is very
    // often empty and the answer is "not yet". That is not a failure; it is the
    // normal path, and the resolution handlers ask again once somebody is
    // actually attached.
    const linkedEventId =
      asUuid(eventId) ??
      (await ensureEventForObservation(client, {
        ownerId: owner,
        observationId: id,
        eventTitle,
        eventEndsAt,
        placeId,
        createEvent,
      }));

    for (const n of rawNames) {
      const name = String(n ?? "").trim();
      if (!name) continue;
      await client.query(
        `INSERT INTO observation_raw_names (observation_id, raw_name)
         VALUES ($1,$2) ON CONFLICT (observation_id, raw_name) DO NOTHING`,
        [id, name],
      );
    }

    // CLOSE THE LEDGER FOR THE NAMES THAT ALREADY LANDED.
    //
    // observation_raw_names records which spoken name became which card, and
    // resolved_to was only ever written by the three RESOLUTION paths -- the
    // ones that run when the user is asked. A name the matcher got right on its
    // own was inserted here as unresolved and stayed that way forever, even with
    // the person sitting on the observation as a participant.
    //
    // That is why the ledger showed Sagar unmatched thirteen times while every
    // one of those notes had Sagar correctly tagged: the tagging was right and
    // the bookkeeping was blank. It matters because that same null is what the
    // Today card reads to decide a name is still waiting on an answer.
    //
    // Matched on the contact's own name, first or full, because that is the only
    // claim this can honestly make. A genuine mishearing ("AJ" for Ajay) matches
    // neither and is deliberately left open for the resolution paths to close.
    if (rawNames.length > 0 && seen.size > 0) {
      const { rows: named } = await client.query(
        `SELECT id, full_name FROM contacts
          WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [owner, [...seen]],
      );
      const byForm = new Map();
      for (const c of named) {
        const full = String(c.full_name || "").trim().toLowerCase();
        if (!full) continue;
        if (!byForm.has(full)) byForm.set(full, c.id);
        const first = full.split(/\s+/)[0];
        if (first && !byForm.has(first)) byForm.set(first, c.id);
      }
      for (const n of rawNames) {
        const name = String(n ?? "").trim();
        const hit = byForm.get(name.toLowerCase());
        if (!hit) continue;
        await client.query(
          `UPDATE observation_raw_names SET resolved_to = $3
            WHERE observation_id = $1 AND raw_name = $2 AND resolved_to IS NULL`,
          [id, name, hit],
        );
      }
    }

    // THE SIX DIMENSIONS ARE APPLIED HERE, NOT BY THE CALLER.
    //
    // Every write path in the service funnels through this function, so this is
    // the only place that can promise every fact is classified. A caller that
    // supplies its own dimensions is believed; a caller that supplies nothing --
    // which is all of them today -- gets the lexicon, synchronously, in this
    // same transaction. A fact is therefore never visible in an unclassified
    // state, and there is no window where a reader sees a fact with no
    // dimensions and concludes it has none.
    //
    // The lexicon is deterministic and does no I/O, so this costs microseconds
    // and cannot fail the insert. When it is unsure the row stays 'pending' with
    // its best guess written, and the worker upgrades it later -- see
    // scripts/dimension-worker.mjs. The model is deliberately NOT called here:
    // somebody is holding a phone waiting for this transaction to commit.
    let dimensionRows = dimensions;
    let dimensionStatus = "human";
    if (dimensionRows === null) {
      const lex = classifyByLexicon(body);
      dimensionRows = lex.dimensions;
      dimensionStatus = lex.uncertain
        ? "pending"
        : lex.dimensions.length
          ? "lexicon"
          : "none";
    } else if (!Array.isArray(dimensionRows)) {
      dimensionRows = [];
      dimensionStatus = "none";
    } else {
      // An explicit list from a caller is treated as settled, but it is only
      // 'human' if the caller actually said so; a machine caller that passes
      // dimensions is still a model.
      dimensionStatus = dimensionRows.some((d) => d?.assignedBy === "human")
        ? "human"
        : dimensionRows.length
          ? "llm"
          : "none";
    }

    for (const d of dimensionRows) {
      const dim = Number(d?.dimensionId);
      if (!Number.isInteger(dim)) continue;
      await client.query(
        `INSERT INTO observation_dimensions
           (observation_id, dimension_id, confidence, weight, assigned_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (observation_id, dimension_id) DO UPDATE
           SET confidence  = EXCLUDED.confidence,
               weight      = EXCLUDED.weight,
               assigned_by = EXCLUDED.assigned_by
         -- A HUMAN CORRECTION IS NEVER OVERWRITTEN BY THE MODEL. Reprocessing a
         -- transcript must not undo what someone told us was wrong.
         WHERE observation_dimensions.assigned_by <> 'human'`,
        [id, dim, clamp01(d.confidence) ?? 0.5, clamp01(d.weight) ?? 0.5,
         d.assignedBy === "human" ? "human" : "model"],
      );
    }

    await client.query(
      `UPDATE observations SET dimension_status = $2 WHERE observation_id = $1`,
      [id, dimensionStatus],
    );

    return { observationId: id, observedAt: rows[0].observed_at, eventId: linkedEventId };
  });
}

/**
 * Everything known about a set of contacts, keyed by contact id.
 *
 * This is what PeopleRank reads, and it is the direct replacement for
 * getResolvedFactsForContacts. Three things it does that the old one did not:
 *
 *   1. It returns observed_at. The old query ORDER BY'd created_at and then
 *      did not SELECT it, so every fact reached the ranker undated -- it could
 *      not tell "visiting San Francisco" said yesterday from the same sentence
 *      said eight months ago.
 *   2. It returns the temporal multiplier, computed in SQL by
 *      amber_temporal_multiplier, so a finished window arrives already
 *      discounted rather than needing the ranker to re-derive it.
 *   3. It includes observations the contact merely PARTICIPATES in, not only
 *      ones they are the subject of -- so a dinner story reaches everyone who
 *      was at the dinner.
 */
export async function getObservationsForContacts(ownerId, contactIds, {
  at = null,
  includeExpired = false,
  minMultiplier = 0.05,
  limitPerContact = 200,
} = {}) {
  const owner = asUuid(ownerId);
  const ids = (Array.isArray(contactIds) ? contactIds : []).map(asUuid).filter(Boolean);
  if (!owner || ids.length === 0) return {};

  const { rows } = await query(
    `WITH params AS (SELECT COALESCE($3::timestamptz, now()) AS at,
                            COALESCE((SELECT value FROM scoring_params WHERE key='window_residual'), 0.15) AS residual)
     SELECT p.contact_id,
            o.observation_id, o.kind, o.modality, o.body, o.observed_at,
            o.temporal_shape, o.valid_from, o.valid_until,
            o.source, o.source_conversation_id, o.confidence,
            o.sentiment, o.sentiment_strength, o.salience, o.condition_text,
            p.role,
            amber_temporal_multiplier(o.temporal_shape, o.observed_at, o.valid_from,
                                      o.valid_until, o.decay_half_life_days,
                                      params.at, params.residual::real) AS temporal_multiplier,
            COALESCE(
              (SELECT jsonb_agg(jsonb_build_object(
                        'code', d.code, 'confidence', od.confidence, 'weight', od.weight,
                        'assignedBy', od.assigned_by))
                 FROM observation_dimensions od
                 JOIN dimensions d USING (dimension_id)
                WHERE od.observation_id = o.observation_id AND od.suppressed = false),
              '[]'::jsonb) AS dimensions
       FROM observation_participants p
       JOIN observations o USING (observation_id)
       CROSS JOIN params
      WHERE p.owner_id = $1
        AND p.contact_id = ANY($2::uuid[])
        AND o.deleted_at IS NULL
        -- A PENDING observation is one we do not yet know the subject of. It
        -- must never reach ranking: surfacing "Maggie is moving" when we have
        -- not established which Maggie is worse than saying nothing.
        AND o.status <> 'pending'
      ORDER BY p.contact_id, o.observed_at DESC`,
    [owner, ids, at],
  );

  const out = {};
  for (const r of rows) {
    const mult = Number(r.temporal_multiplier ?? 1);
    if (!includeExpired && mult < minMultiplier) continue;
    const key = String(r.contact_id);
    if (!out[key]) out[key] = [];
    if (out[key].length >= limitPerContact) continue;
    out[key].push({
      id: r.observation_id,
      text: r.body,
      kind: r.kind,
      modality: r.modality,
      role: r.role,
      observed_at: r.observed_at ? new Date(r.observed_at).toISOString() : null,
      valid_from: r.valid_from ? new Date(r.valid_from).toISOString() : null,
      valid_until: r.valid_until ? new Date(r.valid_until).toISOString() : null,
      temporal_shape: r.temporal_shape,
      temporal_multiplier: mult,
      source: r.source,
      source_conversation_id: r.source_conversation_id,
      certainty: r.confidence,
      sentiment: r.sentiment,
      sentiment_strength: r.sentiment_strength,
      salience: r.salience,
      condition_text: r.condition_text,
      dimensions: r.dimensions ?? [],
    });
  }
  return out;
}

/** One contact's timeline, newest first. Subject rows and participation both. */
export async function getObservationsForContact(ownerId, contactId, opts = {}) {
  const map = await getObservationsForContacts(ownerId, [contactId], opts);
  return map[String(asUuid(contactId))] ?? [];
}

/**
 * Resolve a pending observation onto a real contact.
 *
 * Flips status, sets the subject, adds the participant row and clears the raw
 * name — the four things that must happen together when someone finally answers
 * "which Maggie?". Doing them in one transaction is what stops a half-resolved
 * row that is neither pending nor findable.
 */
export async function resolveObservationSubject({ ownerId, observationId, contactId, rawName = null }) {
  const owner = asUuid(ownerId);
  const obs = asUuid(observationId);
  const contact = asUuid(contactId);
  if (!owner || !obs || !contact) return false;

  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE observations
          SET contact_id = $3, status = 'resolved'
        WHERE observation_id = $2 AND owner_id = $1 AND deleted_at IS NULL`,
      [owner, obs, contact],
    );
    if (!rowCount) return false;
    await client.query(
      `INSERT INTO observation_participants (observation_id, owner_id, contact_id, role)
       VALUES ($1,$2,$3,'subject')
       ON CONFLICT (observation_id, contact_id) DO UPDATE SET role = 'subject'`,
      [obs, owner, contact],
    );
    if (rawName) {
      await client.query(
        `UPDATE observation_raw_names SET resolved_to = $3
          WHERE observation_id = $1 AND raw_name = $2`,
        [obs, rawName, contact],
      );
    }
    // The observation now has somebody on it, which may be the first time it has.
    // Ask the event question again -- at insert the answer was almost certainly
    // "nobody is attached yet".
    await ensureEventForObservation(client, { ownerId: owner, observationId: obs });
    return true;
  });
}

/**
 * Add someone to an existing observation. Idempotent, and truthful about it.
 *
 * Returns true when the person IS on the observation afterwards, not when this
 * particular call was the one that put them there. The old version returned
 * rowCount > 0, so answering "which Eli?" a second time -- or two surfaces
 * resolving the same name at once -- reported failure for a row that was
 * present and correct, and callers treat false as "the answer went nowhere".
 *
 * Also closes out the raw name and re-asks the event question, so one call does
 * the whole job of attaching a person rather than leaving two follow-ups to
 * whichever caller remembers them.
 */
export async function addParticipant({
  ownerId, observationId, contactId, role = "participant", rawName = null,
}) {
  const owner = asUuid(ownerId), obs = asUuid(observationId), contact = asUuid(contactId);
  if (!owner || !obs || !contact) return false;
  return withTransaction(async (client) => {
    const { rowCount: exists } = await client.query(
      `SELECT 1 FROM observations
        WHERE observation_id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [obs, owner],
    );
    if (!exists) return false;

    await client.query(
      `INSERT INTO observation_participants (observation_id, owner_id, contact_id, role)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (observation_id, contact_id) DO NOTHING`,
      [obs, owner, contact, role],
    );

    // WHICH SPOKEN NAME THIS ANSWERED. observation_raw_names.resolved_to was null
    // on every row in production -- including names that HAD been resolved --
    // because only resolveObservationSubject wrote it and its one caller never
    // passed rawName. Without it there is no way to tell an outstanding mention
    // from a handled one, which is what the pending queue is supposed to know.
    if (rawName) {
      await client.query(
        `UPDATE observation_raw_names SET resolved_to = $3
          WHERE observation_id = $1 AND raw_name = $2`,
        [obs, String(rawName), contact],
      );
    }

    await ensureEventForObservation(client, { ownerId: owner, observationId: obs });
    return true;
  });
}

/**
 * REPLACE THE PARTICIPANT SET, WITHOUT THROWING THE SUBJECT AWAY.
 *
 * This is the real implementation of what observations-compat called
 * setParticipants. That version did:
 *
 *     contact_id = ids.length === 1 ? ids[0] : null
 *
 * so the moment an experience had two people on it, it had no subject. A
 * two-person dinner dropped out of every view that joins on
 * observations.contact_id, and the interaction arm that counts the subject
 * counted nobody. It also never touched observation_raw_names and never created
 * or updated the event, so a correction made through it looked half-applied for
 * exactly the reasons the other resolution paths were fixed.
 *
 * Subject is who the memory is ABOUT; participants are everyone present. Those
 * are different questions and more than one person is not an answer to neither.
 * The existing subject is kept when they are still in the set, so re-tagging one
 * guest does not silently rewrite whose memory it is; otherwise the first of the
 * new ids takes it, and only an empty set clears it.
 *
 * event_participants is reconciled in the same transaction, so removing someone
 * from a note also removes the interaction credit they were getting for it.
 */
export async function setObservationParticipants({ ownerId, observationId, contactIds = [] }) {
  const owner = asUuid(ownerId);
  const obs = asUuid(observationId);
  if (!owner || !obs) return false;
  const ids = [...new Set((contactIds || []).map(asUuid).filter(Boolean))];

  return withTransaction(async (client) => {
    const { rows: oRows } = await client.query(
      `SELECT contact_id, event_id FROM observations
        WHERE observation_id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [obs, owner],
    );
    const o = oRows[0];
    if (!o) return false;

    await client.query(
      `DELETE FROM observation_participants
        WHERE observation_id = $1 AND owner_id = $2
          AND NOT (contact_id = ANY($3::uuid[]))`,
      [obs, owner, ids],
    );
    for (const cid of ids) {
      await client.query(
        `INSERT INTO observation_participants (observation_id, owner_id, contact_id, role)
         VALUES ($1,$2,$3,'participant')
         ON CONFLICT (observation_id, contact_id) DO NOTHING`,
        [obs, owner, cid],
      );
    }

    const keptSubject = o.contact_id && ids.includes(String(o.contact_id))
      ? String(o.contact_id)
      : (ids[0] ?? null);
    await client.query(
      `UPDATE observations SET contact_id = $3 WHERE observation_id = $1 AND owner_id = $2`,
      [obs, owner, keptSubject],
    );
    if (keptSubject) {
      await client.query(
        `INSERT INTO observation_participants (observation_id, owner_id, contact_id, role)
         VALUES ($1,$2,$3,'subject')
         ON CONFLICT (observation_id, contact_id) DO UPDATE SET role = 'subject'`,
        [obs, owner, keptSubject],
      );
    }

    if (o.event_id) {
      await client.query(
        `DELETE FROM event_participants
          WHERE event_id = $1 AND owner_id = $2 AND NOT (contact_id = ANY($3::uuid[]))`,
        [o.event_id, owner, keptSubject ? [...new Set([...ids, keptSubject])] : ids],
      );
      await client.query(
        `UPDATE events SET contact_id = $3 WHERE event_id = $1 AND owner_id = $2`,
        [o.event_id, owner, keptSubject],
      );
    }
    await ensureEventForObservation(client, { ownerId: owner, observationId: obs });
    return true;
  });
}

/**
 * ATTACH A CONTACT THE USER JUST NAMED, DOING WHATEVER THAT MEANS FOR THIS ROW.
 *
 * The resolution paths used to branch on pending_fact_context.content_type to
 * decide between "set the subject" and "add a participant". That column does not
 * exist. The table has ONE id column, observation_id, and setPendingFactContext
 * writes `factId ?? contentId` into it while silently discarding contentType and
 * contentId -- so every read produced content_type: undefined, the
 * which_participant branch matched neither arm, and the answer attached to
 * nothing. soft_confirm only appeared to work because it fell through to the
 * fact path by accident.
 *
 * The row itself knows what it is. A fact is ABOUT one person, so the contact is
 * its subject. A note or an experience has a cast, so the contact is a
 * participant -- and becomes the subject only if nobody holds that yet, because
 * confirming the third guest at a dinner must not rewrite whose memory it is.
 */
export async function attachResolvedContact({ ownerId, observationId, contactId, rawName = null }) {
  const owner = asUuid(ownerId);
  const obs = asUuid(observationId);
  const contact = asUuid(contactId);
  if (!owner || !obs || !contact) return false;

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT kind, contact_id FROM observations
        WHERE observation_id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [obs, owner],
    );
    const o = rows[0];
    if (!o) return false;

    const isCast = o.kind === "note" || o.kind === "experience";
    const role = isCast && o.contact_id ? "participant" : "subject";

    await client.query(
      `INSERT INTO observation_participants (observation_id, owner_id, contact_id, role)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (observation_id, contact_id) DO UPDATE
         SET role = CASE WHEN EXCLUDED.role = 'subject' THEN 'subject'
                         ELSE observation_participants.role END`,
      [obs, owner, contact, role],
    );

    if (role === "subject") {
      await client.query(
        `UPDATE observations SET contact_id = $3, status = 'resolved'
          WHERE observation_id = $1 AND owner_id = $2`,
        [obs, owner, contact],
      );
    } else {
      // A note whose cast is still being filled in is resolved once somebody is
      // on it; leaving it 'pending' hides it from the rollup's interaction arms.
      await client.query(
        `UPDATE observations SET status = 'resolved'
          WHERE observation_id = $1 AND owner_id = $2 AND status <> 'resolved'`,
        [obs, owner],
      );
    }

    if (rawName) {
      await client.query(
        `UPDATE observation_raw_names SET resolved_to = $3
          WHERE observation_id = $1 AND raw_name = $2`,
        [obs, String(rawName), contact],
      );
    }

    await ensureEventForObservation(client, { ownerId: owner, observationId: obs });
    return true;
  });
}

/** Soft delete. The row stays so a shared copy or an audit trail can resolve it. */
export async function deleteObservation({ ownerId, observationId }) {
  const owner = asUuid(ownerId), obs = asUuid(observationId);
  if (!owner || !obs) return false;
  const { rowCount } = await query(
    `UPDATE observations SET deleted_at = now()
      WHERE observation_id = $2 AND owner_id = $1 AND deleted_at IS NULL`,
    [owner, obs],
  );
  return rowCount > 0;
}

/**
 * Set or correct the dimension tags on an observation.
 *
 * assignedBy 'human' pins the row and, per the ON CONFLICT above, the model can
 * never overwrite it afterwards. A human REMOVAL is a suppressed row rather than
 * a delete: delete it and the next reprocess of the same transcript puts it
 * straight back.
 */
export async function setObservationDimensions({ observationId, dimensions, assignedBy = "model" }) {
  const obs = asUuid(observationId);
  if (!obs || !Array.isArray(dimensions)) return 0;
  const human = assignedBy === "human";
  return withTransaction(async (client) => {
    let n = 0;
    for (const d of dimensions) {
      const dim = Number(d?.dimensionId);
      if (!Number.isInteger(dim)) continue;
      const { rowCount } = await client.query(
        `INSERT INTO observation_dimensions
           (observation_id, dimension_id, confidence, weight, assigned_by, suppressed)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (observation_id, dimension_id) DO UPDATE
           SET confidence = EXCLUDED.confidence, weight = EXCLUDED.weight,
               assigned_by = EXCLUDED.assigned_by, suppressed = EXCLUDED.suppressed
         WHERE observation_dimensions.assigned_by <> 'human' OR EXCLUDED.assigned_by = 'human'`,
        [obs, dim, human ? 1.0 : (clamp01(d.confidence) ?? 0.5),
         clamp01(d.weight) ?? 0.5, human ? "human" : "model", d.suppressed === true],
      );
      n += rowCount;
    }
    return n;
  });
}
