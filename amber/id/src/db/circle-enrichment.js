/**
 * Fact lifecycle for circles — writes / revokes contact_facts derived from circle
 * membership. Imported by circles-store.js; does NOT import from circles-store.js
 * (avoids a circular dependency).
 *
 * SECURITY INVARIANT: every query is scoped by owner_id. No cross-user access.
 *
 * Both exported functions are designed to be called best-effort:
 *   await syncCircleFacts(ownerId, circleId).catch(() => {});
 *   await revokeCircleFacts(ownerId, circleId).catch(() => {});
 */

import { query } from "./sql.js";
import { insertContactFact } from "./store.js";
import { classifyCircle } from "../lib/circle-classifier.js";

// Map the circle's TAG → contact_facts.category (valid values mirror
// _FACT_CATEGORIES in fact-capture.js: who, feeling, activity, identity,
// personality).
//
// The tag is free text the user typed, so this is a match on the ones we offer
// with a sane default for everything else. Work / Family / School are facts
// about WHO someone is to you; everything else is something you do together.
// Case-insensitive because the tag is stored as the user typed it.
const _WHO_TAGS = new Set(["work", "family", "school"]);
function _kindToCategory(tag) {
  return _WHO_TAGS.has(String(tag || "").trim().toLowerCase()) ? "who" : "activity";
}

/**
 * Classify the circle (or use cached classification), then reconcile contact_facts:
 * soft-delete all existing circle-sourced facts and re-insert one per current member.
 *
 * Called after createCircle, updateCircle (name/description changed),
 * addCircleMember, and removeCircleMember.
 */
export async function syncCircleFacts(ownerId, circleId) {
  const ref = String(circleId);

  // 1. Load the circle row.
  const { rows: circleRows } = await query(
    `SELECT id, name, description, kind_tag, classified_fact
     FROM circles
     WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [circleId, ownerId],
  );
  if (circleRows.length === 0) return; // circle gone or not owned

  const circle = circleRows[0];

  // 2. THE KIND IS THE USER'S TAG. THE MODEL ONLY WRITES THE SENTENCE.
  //
  // This used to ask a model for BOTH -- a kind from a fixed four-word
  // vocabulary, and a fact sentence -- and cache them together. The kind is
  // now kind_tag, set by the person who made the circle, so there is nothing
  // to classify and nothing to be wrong about.
  //
  // The fact is a different job and still worth doing: it is the sentence
  // written onto every member's card ("in Karthik's Blue Modern Advisory"),
  // and it reads better generated from the circle's own description than
  // assembled from a template. So the model is still called for it, and ONLY
  // for it -- `cls.kind` is discarded. If it has nothing to work from, or the
  // call fails, a deterministic sentence is better than no fact at all, which
  // is what an empty description used to produce.
  const kind = circle.kind_tag;
  let fact = circle.classified_fact;
  if (!fact) {
    const cls = await classifyCircle({
      name: circle.name,
      description: circle.description,
    }).catch(() => null);
    fact = cls?.fact || `in ${circle.name}`;
    await query(
      `UPDATE circles
       SET classified_fact = $1, classified_at = now()
       WHERE id = $2 AND owner_id = $3`,
      [fact, circleId, ownerId],
    );
  }

  // 3. Soft-delete all existing facts from this circle (full reconcile).
  // Keyed on source_circle_id, the provenance column added in migration 019.
  // contact_facts.source_ref used to hold this; observations routes it to a
  // column with a real foreign key to circles, so a fact cannot claim to come
  // from a circle that does not exist.
  await query(
    `UPDATE observations
        SET deleted_at = now()
      WHERE owner_id = $1 AND source = 'circle' AND source_circle_id = $2::uuid
        AND deleted_at IS NULL`,
    [ownerId, ref],
  );

  // 4. Load current (non-deleted) members.
  const { rows: members } = await query(
    `SELECT cm.contact_id
     FROM circle_members cm
     JOIN contacts c ON c.id = cm.contact_id AND c.deleted_at IS NULL
     WHERE cm.circle_id = $1 AND cm.owner_id = $2`,
    [circleId, ownerId],
  );
  if (members.length === 0) return;

  // 5. Insert a fresh fact for each member.
  //
  // BOUNDED CONCURRENCY, NOT A SERIAL LOOP. Every insertContactFact is its own
  // transaction of about six statements, so a serial loop over a thirty-person
  // circle is roughly two hundred sequential round trips to Cloud SQL -- and
  // this function is a FULL RECONCILE, so it ran again for every member added.
  // That is where the ten minutes went.
  //
  // Eight at a time rather than all at once: the pool is capped at twenty
  // connections and shared with everything else the app is doing, so a
  // thirty-way Promise.all on one circle edit would starve the requests the
  // user is actually waiting on. Eight turns two hundred serial trips into
  // twenty-five parallel batches and leaves most of the pool free.
  const category = _kindToCategory(kind);
  const isPast = kind === "experience";
  const CONCURRENCY = 8;
  let failed = 0;
  for (let i = 0; i < members.length; i += CONCURRENCY) {
    const slice = members.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map((m) =>
        insertContactFact({
          ownerId,
          contactId: m.contact_id,
          factText: fact,
          category,
          source: "circle",
          sourceRef: ref,
          status: "resolved",
          is_past: isPast,
          weight: 0.6,
        }).catch(() => null),
      ),
    );
    failed += results.filter((r) => !r).length;
  }
  if (failed > 0) {
    // insertContactFact already logs its own error; this says how much of the
    // reconcile is missing, which is the part a person can act on.
    console.error(
      `CIRCLE_FACTS_PARTIAL owner=${ownerId} circle=${ref} ` +
        `${failed} of ${members.length} member facts did not write`,
    );
  }
}

/**
 * Soft-delete every observation sourced from a circle (called on circle
 * soft-delete). Hard deletion of the circle cascades instead -- see the foreign
 * key on source_circle_id -- so this is the soft path, where the circle survives
 * and only the facts it produced go away.
 */
export async function revokeCircleFacts(ownerId, circleId) {
  await query(
    `UPDATE observations
        SET deleted_at = now()
      WHERE owner_id = $1 AND source = 'circle' AND source_circle_id = $2::uuid
        AND deleted_at IS NULL`,
    [ownerId, String(circleId)],
  );
}
