/**
 * A REMINDER ABOUT SOMEONE IS SOMETHING YOU KNOW ABOUT THEM.
 *
 * "Remind me to call Sagar at 7:30" was, until now, a notification and nothing
 * else: a row in `reminders`, a banner on the lock screen, and no trace of it
 * anywhere in what Amber knows about Sagar. That is the wrong shape. The whole
 * premise of this app is that the things you say out loud about the people in
 * your life accumulate -- and an intention to call someone is one of the
 * strongest signals there is that the relationship is live.
 *
 * So a reminder that NAMES a contact also writes one observation against that
 * contact, and the rollup (db/contact-rollup.js) picks it up on its next pass:
 * observed_at feeds contact_interaction_stats, the lexicon tags it against the
 * six dimensions, and the score moves. That is the whole "nudge PeopleRank"
 * mechanism -- there is no separate score to poke, and inventing one here would
 * put a second writer on numbers that already have an owner.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   - It does not write anything for a reminder about nobody. "Take the bins
 *     out Thursday" is not evidence about a person and there is no person to
 *     file it against.
 *   - It does not guess the person. The contact arrives already resolved from
 *     an exact name match on the owner's own address book; a phonetic guess
 *     would put a call you never planned in a real person's file.
 *   - modality is 'planned', not 'actual'. You have not called Sagar yet. A
 *     reminder is an intention, and recording it as a thing that happened is
 *     how "we talk all the time" gets computed from a list of things you meant
 *     to do. The dimension classifier and the ranker both read modality.
 *   - observed_at is NOW, not the reminder's due time. What is true today is
 *     that today you decided to call him. Post-dating evidence into the future
 *     would make the warmth of every relationship depend on reminders that have
 *     not come due.
 *
 * Best-effort by contract: it logs and returns null on failure, because a
 * reminder must still be set when the observation cannot be written.
 */

import { insertObservation } from "./observations-store.js";

/**
 * Record the intention behind one reminder against the person it is about.
 * Returns the observation id, or null when there was nothing to write.
 */
export async function recordReminderObservation({
  ownerId,
  contactId,
  contactName = null,
  title,
  body = null,
  fireAtISO = null,
  source = "reminder",
  log = null,
}) {
  if (!ownerId || !contactId) return null;

  // The sentence stored is the reminder as the user will see it, plus the time
  // it is for -- because "call him" with no when is not a fact anyone can read
  // back later. The due time is in the TEXT rather than in valid_from: the
  // observation is about a decision made now, and the schema's temporal columns
  // describe how long a fact stays true, not what it refers to.
  const line = String(body || title || "").trim();
  if (!line) return null;
  const when = fireAtISO ? new Date(fireAtISO) : null;
  const whenOk = when && !Number.isNaN(when.getTime());
  const first = (contactName || "").trim().split(/\s+/)[0] || null;
  const text = whenOk
    ? `Reminder${first ? ` about ${first}` : ""}: ${line} (${when.toISOString()})`
    : `Reminder${first ? ` about ${first}` : ""}: ${line}`;

  try {
    const row = await insertObservation({
      ownerId,
      contactId,
      kind: "note",
      modality: "planned",
      body: text.slice(0, 4000),
      source,
      // An intention is not permanent and it is not a fact about who they are.
      // It fades: in six months, "he meant to call in September" is history
      // rather than a live signal, and a half-life is how this schema says so.
      temporalShape: "decay",
      decayHalfLifeDays: 180,
      // Not certain about the WORLD, only about what was said. Below 1.0 so a
      // parsed intention never outweighs something the user stated as fact.
      confidence: 0.8,
      status: "resolved",
      rawName: contactName || null,
      // The subject is also the participant, which is what the interaction
      // rollup counts. Without this row the observation moves the dimensions
      // but not the "when did we last have anything to do with each other"
      // number, and those two disagreeing is what makes a score look wrong.
      participants: [{ contactId, role: "subject" }],
    });
    return row?.observation_id ?? row?.observationId ?? null;
  } catch (err) {
    const msg = err?.message || String(err);
    if (log?.warn) log.warn(`REMINDER_OBSERVATION_FAILED owner=${ownerId} ${msg}`);
    else console.warn(`REMINDER_OBSERVATION_FAILED owner=${ownerId} ${msg}`);
    return null;
  }
}
