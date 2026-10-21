/**
 * THE SIX DIMENSIONS, ON THE READ PATH.
 *
 * Everything upstream of this file was already built: facts are tagged with
 * dimensions on write, embedded into pgvector, and rolled up into
 * contact_dimension_state. And nothing on the main chat surface read any of it.
 * lib/ask.js was the only consumer of retrieveHybrid in the entire codebase, so
 * the dimensions influenced one endpoint that iOS reaches through a proxy, and
 * had no effect at all on /v1/chat.
 *
 * This is the shared piece both surfaces can use: given an owner and a question,
 * return the contacts whose facts best answer it AND those facts, ranked.
 *
 *   retrieveByDimension({ ownerId, question })
 *     -> { contactIds, factsByContact, dimensionWeights, observationCount }
 *     -> null when it cannot help at all
 *
 * WHY IT RETURNS null RATHER THAN AN EMPTY SHAPE. Callers have to be able to
 * tell "retrieval had nothing to say" from "retrieval says nobody is relevant".
 * The first means fall back to whatever you did before; the second would mean
 * show the user nothing. Only the first is ever true here, so the signal is
 * null.
 *
 * THE FACT SHAPE IS DELIBERATELY IDENTICAL to observations-compat.asFactRow, so
 * this is a drop-in for getContactContentForContacts and the ranker cannot tell
 * the difference except that the facts arrive in a useful order. Fields this
 * path genuinely does not know are null rather than invented -- a fabricated
 * `certainty` would be indistinguishable from a measured one downstream.
 */

import { classifyDimensions } from "./dimension-classifier.js";
import { retrieveHybrid } from "../db/retrieval.js";
import { embedQuery } from "../db/embedding-queue.js";
import { recordQueryDimensions } from "../db/self-dimensions.js";

// retrieveHybrid's limit counts OBSERVATIONS, not people. One contact can hold
// many relevant facts, so the observation pool has to be several times the
// number of contacts we hope to surface or the tail gets cut off arbitrarily.
const POOL_MULTIPLIER = 5;
const POOL_MAX = 200; // retrieveHybrid's own ceiling
const DEFAULT_FACTS_PER_CONTACT = 8;

/**
 * Shape one retrieved observation like observations-compat.asFactRow does.
 *
 * `dimensions` and `score` are the two fields this path can supply and the old
 * one could not: which dimensions the fact was tagged with, and how well it
 * matched this particular question.
 */
function toFactRow(o) {
  return {
    id: o.observationId,
    text: o.body,
    fact_text: o.body,
    category: null,
    sentiment: null,
    sentiment_strength: null,
    certainty: null,
    is_past: false,
    weight: null,
    is_conditional: false,
    condition_text: null,
    observed_at: o.observedAt ? new Date(o.observedAt).toISOString() : null,
    kind: o.kind ?? null,
    modality: o.modality ?? null,
    role: null,
    temporal_shape: null,
    temporal_multiplier: null,
    valid_until: null,
    source: o.source ?? null,
    source_conversation_id: o.sourceConversationId ?? null,
    dimensions: Array.isArray(o.dimensions) ? o.dimensions : [],
    // Not part of asFactRow. Additive, so nothing that reads the old shape
    // breaks, and a caller that wants to explain WHY a fact surfaced can.
    retrieval_score: typeof o.score === "number" ? o.score : null,
  };
}

/**
 * Rank an owner's contacts against a question through the six dimensions.
 *
 * `contactIds` comes back in relevance order, best first, deduped. A contact
 * appears once, positioned by its single best-scoring fact -- not by how many
 * facts it has, which would let one chatty contact outrank a precisely relevant
 * one.
 *
 * Injectable deps are for tests only; nothing in production passes them.
 */
export async function retrieveByDimension({
  ownerId,
  question,
  limit = 40,
  factsPerContact = DEFAULT_FACTS_PER_CONTACT,
  classify = classifyDimensions,
  embed = embedQuery,
  retrieve = retrieveHybrid,
  /**
   * WHAT THE OWNER ASKED ABOUT, KEPT RATHER THAN DISCARDED.
   *
   * The distribution below is computed here anyway, to order retrieval, and it
   * used to be thrown away with the request. It is the only signal Amber has
   * about the dimensions somebody is CURIOUS about as opposed to the ones they
   * have stated facts in, and the self coverage score reads it -- weighted well
   * below a stated fact, because a question is not a statement.
   *
   * Injected so tests can observe it, and defaulted so nothing else has to.
   */
  recordQueries = recordQueryDimensions,
} = {}) {
  if (!ownerId) return null;
  if (typeof question !== "string" || !question.trim()) return null;

  // Deterministic and free -- see dimension-classifier.js for why this stayed a
  // heuristic instead of becoming a model call on the read path.
  let dimensionWeights = null;
  try {
    dimensionWeights = await classify(question);
  } catch {
    dimensionWeights = null; // flat weights; retrieval still ranks on similarity
  }

  /**
   * NOT AWAITED, AND ITS FAILURE IS NOT THIS FUNCTION'S PROBLEM.
   *
   * A question that fails to get recorded is a marginally staler coverage
   * score. A question that fails to be ANSWERED because the score-keeping threw
   * is a broken app. So this is fired and forgotten, the store swallows its own
   * errors, and the catch here exists only for a synchronous throw before the
   * promise is created.
   */
  if (dimensionWeights) {
    try {
      Promise.resolve(recordQueries(ownerId, dimensionWeights)).catch(() => {});
    } catch {
      // nothing: retrieval carries on regardless
    }
  }

  // A null vector is NOT a failure. retrieveHybrid falls back to the dimension +
  // recency ranking on its own, so a draining embedding queue or a missing
  // OPENAI_API_KEY degrades to a worse order rather than to no answer.
  let queryVector = null;
  try {
    queryVector = await embed(question);
  } catch {
    queryVector = null;
  }

  const pool = Math.min(
    POOL_MAX,
    Math.max(Number(limit) || 40, 10) * POOL_MULTIPLIER,
  );

  let observations;
  try {
    observations = await retrieve({
      ownerId,
      queryVector,
      dimensionWeights,
      limit: pool,
    });
  } catch (err) {
    console.warn(`[dimension-retrieval] retrieveHybrid failed: ${err?.message || err}`);
    return null;
  }
  if (!Array.isArray(observations) || observations.length === 0) return null;

  const perContactCap = Math.min(Math.max(Number(factsPerContact) || 8, 1), 40);
  const wanted = Math.min(Math.max(Number(limit) || 40, 1), 500);

  const factsByContact = Object.create(null);
  const contactIds = [];
  for (const o of observations) {
    if (!o?.contactId) continue; // a fact with no subject cannot rank a person
    const key = String(o.contactId);
    if (!(key in factsByContact)) {
      // First time we see this contact is, by construction, its best-scoring
      // fact -- observations arrive score-ordered.
      if (contactIds.length >= wanted) continue;
      factsByContact[key] = [];
      contactIds.push(key);
    }
    if (factsByContact[key].length < perContactCap) {
      factsByContact[key].push(toFactRow(o));
    }
  }

  if (contactIds.length === 0) return null;
  return {
    contactIds,
    factsByContact,
    dimensionWeights,
    observationCount: observations.length,
    usedVector: Array.isArray(queryVector),
  };
}

/**
 * Apply a retrieval result to a contact list.
 *
 * ADDITIVE BY DEFAULT, and that is the whole safety argument. `narrow: false`
 * returns the SAME contacts the caller already had -- every one of them, none
 * dropped -- with the relevant ones moved to the front and their facts replaced
 * by the ranked set. Only 53 of 5,249 contacts in production carry any fact at
 * all, so narrowing to retrieval results would make the other 5,196
 * unreachable and quietly break asking about someone by name.
 *
 * `narrow: true` is the opt-in behavior for callers that genuinely want a
 * bounded payload (the PEOPLERANK_VECTOR_PREFILTER path), and even then a result
 * that matched nothing in the list leaves it untouched.
 */
export function applyRetrievalToContacts(contacts, relevance, { narrow = false } = {}) {
  const list = Array.isArray(contacts) ? contacts : [];
  if (!relevance || !Array.isArray(relevance.contactIds) || list.length === 0) {
    return list;
  }
  const order = new Map(relevance.contactIds.map((id, i) => [String(id), i]));
  const enrich = (c) => {
    const ranked = relevance.factsByContact?.[String(c.id)];
    return ranked && ranked.length > 0 ? { ...c, facts: ranked } : c;
  };

  const hits = [];
  const rest = [];
  for (const c of list) {
    if (order.has(String(c.id))) hits.push(c);
    else rest.push(c);
  }
  if (hits.length === 0) return list; // retrieval matched nobody we hold
  hits.sort((a, b) => order.get(String(a.id)) - order.get(String(b.id)));

  return narrow ? hits.map(enrich) : [...hits.map(enrich), ...rest];
}
