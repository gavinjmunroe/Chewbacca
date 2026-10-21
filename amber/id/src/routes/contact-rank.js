/**
 * GET /v1/me/contacts/:id/rank — one person's standing, as the app shows it.
 *
 * WHY IT EXISTS. Everything the rollup computes -- warmth, cadence, the six
 * dimensions of health -- has been written to contact_scores,
 * contact_interaction_stats and contact_dimension_state for a while now, and
 * the app could not read ANY of it for a single person. PeopleRank's ordering
 * was visible (it is what sorts the People list) but the numbers behind it were
 * not, so "why is Amber ranking her above him" had no answer anywhere in the
 * product. The DM Info tab is the first surface that asks the question
 * directly.
 *
 * IT COMPUTES NOTHING. Three reads of three derived tables, which the rollup
 * job owns. A route that recomputed a score on demand would be a second
 * implementation of the ranker, disagreeing with the first as soon as either
 * changed -- and it would do it inside a request the user is waiting on.
 *
 * A CONTACT WITH NO ROWS IS NOT AN ERROR. Every contact gets a contact_scores
 * row from the rollup, but only once it has RUN: a contact added five minutes
 * ago legitimately has nothing yet, and the honest answer is zeroes with
 * computedAt: null so the app can say "not enough yet" rather than "0% warm",
 * which reads as a judgment rather than an absence.
 *
 * Isolation: the owner comes from the caller's own verified session and every
 * statement filters on it. A caller asking about a contact id they do not own
 * gets the same 404 as one asking about an id that never existed.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import { query } from "../db/sql.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v) => (v === null || v === undefined ? null : Number(v));

export function registerContactRankRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmber = deps.resolveAmberIdByPhone || resolveAmberIdByPhone;

  app.get(
    "/v1/me/contacts/:id/rank",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const phone = request.privyUser?.phone;
      if (!phone) return reply.code(400).send({ error: "no_phone_on_session" });
      const ownerId = await resolveAmber(phone).catch(() => null);
      if (!ownerId) return reply.code(500).send({ error: "could_not_resolve_owner" });

      const contactId = String(request.params?.id || "").trim();
      if (!UUID_RE.test(contactId)) {
        return reply.code(400).send({ error: "invalid_contact_id" });
      }

      try {
        // The contact first, and on its own, so "not yours" is a 404 rather
        // than an empty score card for somebody else's person.
        const { rows: own } = await query(
          `SELECT id, full_name FROM contacts
            WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
          [contactId, ownerId],
        );
        if (own.length === 0) {
          return reply.code(404).send({ error: "contact_not_found" });
        }

        const { rows: scoreRows } = await query(
          `SELECT s.base_score, s.warmth, s.completeness, s.observation_count,
                  s.last_interaction_at, s.computed_at,
                  st.count_30d, st.count_90d, st.count_all, st.first_interaction_at
             FROM contacts c
             LEFT JOIN contact_scores s
                    ON s.owner_id = c.owner_id AND s.contact_id = c.id
             LEFT JOIN contact_interaction_stats st
                    ON st.owner_id = c.owner_id AND st.contact_id = c.id
            WHERE c.id = $1 AND c.owner_id = $2`,
          [contactId, ownerId],
        );
        const s = scoreRows[0] ?? {};

        // Every dimension, in the ontology's own order, including the ones this
        // person has no evidence for. A card that renders only the dimensions
        // with a score would silently change shape per person and read as if
        // the missing ones did not exist.
        const { rows: dims } = await query(
          `SELECT d.code, d.label, d.sort_order,
                  COALESCE(cds.score, 0)::float8      AS score,
                  COALESCE(cds.observation_count, 0)  AS observations,
                  cds.last_signal_at
             FROM dimensions d
             LEFT JOIN contact_dimension_state cds
                    ON cds.dimension_id = d.dimension_id
                   AND cds.owner_id = $2 AND cds.contact_id = $1
            ORDER BY d.sort_order`,
          [contactId, ownerId],
        );

        return {
          contactId,
          name: own[0].full_name ?? null,
          score: num(s.base_score) ?? 0,
          warmth: num(s.warmth) ?? 0,
          completeness: num(s.completeness) ?? 0,
          observations: num(s.observation_count) ?? 0,
          lastInteractionAt: s.last_interaction_at ?? null,
          firstInteractionAt: s.first_interaction_at ?? null,
          interactions: {
            d30: num(s.count_30d) ?? 0,
            d90: num(s.count_90d) ?? 0,
            all: num(s.count_all) ?? 0,
          },
          dimensions: dims.map((d) => ({
            code: d.code,
            label: d.label ?? d.code,
            score: num(d.score) ?? 0,
            observations: num(d.observations) ?? 0,
            lastSignalAt: d.last_signal_at ?? null,
          })),
          // null until the rollup has ever run for this owner. The app shows
          // "not enough yet" on null rather than a confident zero.
          computedAt: s.computed_at ?? null,
        };
      } catch (err) {
        request.log?.error?.(
          `CONTACT_RANK_ERR owner=${ownerId} contact=${contactId} ${err?.message || err}`,
        );
        return reply.code(503).send({ error: "rank_unavailable" });
      }
    },
  );
}
