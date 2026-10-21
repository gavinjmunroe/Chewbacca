/**
 * FUNCTION 2 — ENRICH (spec §2): deeper, lazy, per-person web enrichment.
 *
 * This module is DELIBERATELY DECOUPLED from the SEARCH/ranking path. It is
 * NEVER called on the base /v1/me/people-rank request, is NOT required for
 * SEARCH to function, and lives behind its OWN flag (`PEOPLERANK_ENRICHMENT`),
 * independent of `PEOPLERANK_SEARCH_SIGNALS`.
 *
 * What it does, on demand (rabbit-hole profile open or a background job):
 *   1. A FULLER web pull for the person — a broader multi-query Search than the
 *      fast in-path signal fetch (more results, deeper sources).
 *   2. A "what's new in their life" narrative brief (lazy + cached) from
 *      Claude Haiku, grounded in the sources leg 1 already pulled. Used
 *      SPARINGLY.
 *   3. A Pinecone embedding UPSERT of the enriched per-contact context into the
 *      tenant's existing DID-keyed namespace (idempotent stable id), so future
 *      semantic recall is richer. Skipped SILENTLY when Pinecone/embeddings are
 *      unconfigured.
 *
 * Everything is best-effort: any single leg can fail without failing the whole
 * call. The whole module is a strict no-op (returns a flag-off result) when
 * `PEOPLERANK_ENRICHMENT !== "on"` or `EXA_API_KEY` is absent.
 *
 * The result shape (consumed by the enrich route AND, in future, by NOTIFY):
 *   {
 *     status: "ok" | "disabled" | "no_key" | "no_contact" | "error",
 *     contactId, name,
 *     whats_new: string | null,          // Agent narrative brief (null if down)
 *     whats_new_fallback: string | null, // deterministic fallback when the brief
 *                                        // is unavailable but sources exist (§173)
 *     sources: [{ title, url, date }],   // deeper sources (freshest+credible first)
 *     social_links: { linkedin?, twitter?, github?, website? }, // canonical (§170)
 *     signals: { recency, momentum, social_links, top_sources, queried },
 *     embedded: boolean,                 // did we upsert a Pinecone vector?
 *     embed_status: "embedded" | "unchanged" | "skipped" | "off" | "error",
 *     confidence: number,                // 0..1, lowered by negative feedback (§176)
 *     from_cache: boolean,               // served from the in-process TTL cache
 *     enriched_at: ISO string,
 *   }
 *
 * Results are cached in-process with a TTL so repeated profile opens don't
 * re-hit the Agent API.
 */

import { createHash } from "node:crypto";

import { search as defaultSearch } from "../lib/web-search.js";
import { callChat } from "../lib/anthropic-chat.js";
import {
  buildQueryVariants,
  extractSignals,
} from "../lib/people-rank-signals.js";
import { extractSocialLinks, rankSources } from "./social-links.js";

const BRIEF_MODEL = process.env.ENRICH_BRIEF_MODEL || "claude-haiku-4-5";
const BRIEF_MAX_TOKENS = 400;
const AGENT_TIMEOUT_MS = 20000;

const ENRICH_MAX_RESULTS = 10; // deeper than the in-path signal fetch (5)
const ENRICH_TOP_SOURCES = 8;
const DEFAULT_TTL_MS = Number(
  process.env.PEOPLERANK_ENRICHMENT_TTL_MS || 12 * 60 * 60 * 1000,
);

const AGENT_INSTRUCTIONS = [
  "You are Amber's relationship intelligence analyst.",
  "Given a person and recent web sources about them, write a SHORT brief",
  "(2-4 sentences) on what is new or noteworthy in their professional life",
  "right now — a job change, a launch, funding, a talk, big news.",
  "Ground every claim in the supplied sources; if the sources are thin or",
  "ambiguous, say so plainly rather than inventing. Do not speculate about",
  "private life. Write in third person, present tense, no preamble.",
].join(" ");

/** True only when the ENRICH function is explicitly enabled. */
export function enrichmentEnabled() {
  return process.env.PEOPLERANK_ENRICHMENT === "on";
}

/** Build the deeper, broader query fan-out for a fuller per-person pull. */
export function enrichQueryVariants(contact, { year } = {}) {
  return buildQueryVariants(contact, { year });
}

/**
 * Render the Agent `input` prompt from a contact + its freshest sources. Pure.
 * Only fields the model may ground on are included; sources are listed with
 * their dates so the model can reason about recency.
 */
export function buildAgentInput(contact, sources) {
  const name = (contact?.name || "this person").trim();
  const ident = [];
  if (contact?.title) ident.push(contact.title);
  if (contact?.company) ident.push(`at ${contact.company}`);
  const header = ident.length ? `${name} (${ident.join(" ")})` : name;

  const lines = (Array.isArray(sources) ? sources : [])
    .slice(0, ENRICH_TOP_SOURCES)
    .map((s, i) => {
      const date = s?.date ? ` [${s.date}]` : "";
      return `${i + 1}. ${s?.title || "(untitled)"}${date} — ${s?.url || ""}`;
    });

  return [
    `Person: ${header}`,
    "",
    "Recent web sources:",
    lines.length ? lines.join("\n") : "(no recent sources found)",
    "",
    `What's new in ${name}'s professional life?`,
  ].join("\n");
}

/**
 * The "what's new" brief.
 *
 * WAS Perplexity's Agent API (openai/gpt-5.5, tools:[{type:"web_search"}]),
 * which ran its OWN web search on top of the deeper search leg 1 had already
 * done -- paying twice for the same pages, on the most expensive model in the
 * stack, to write two to four sentences.
 *
 * NOW Claude Haiku, grounded strictly in the sources leg 1 already fetched.
 * That is what AGENT_INSTRUCTIONS always asked for ("Ground every claim in the
 * supplied sources") -- the agent's own search tool was never the point, it was
 * how the brief drifted onto pages nobody had ranked or dated.
 *
 * Never throws: returns null on no-key, network error, timeout or bad response,
 * so the caller falls through to fallbackBrief() exactly as before.
 *
 *   agentBrief({ contact, sources, fetchImpl?, apiKey? }) -> string | null
 */
export async function agentBrief({
  contact,
  sources,
  fetchImpl = globalThis.fetch,
  apiKey = process.env.ANTHROPIC_API_KEY,
  log = null,
} = {}) {
  if (!apiKey) return null;
  try {
    const text = await callChat({
      system: AGENT_INSTRUCTIONS,
      messages: [{ role: "user", content: buildAgentInput(contact, sources) }],
      model: BRIEF_MODEL,
      maxTokens: BRIEF_MAX_TOKENS,
      timeoutMs: AGENT_TIMEOUT_MS,
      apiKey,
      fetchImpl,
    });
    return text && text.trim() ? text.trim() : null;
  } catch (err) {
    log?.warn?.(
      { err: err?.message },
      "[enrich] brief generation threw; degraded to null brief",
    );
    return null;
  }
}

// ── deterministic fallback brief (item 173) ───────────────────────────────────

/**
 * When the "what's new" brief is unavailable (rate-limited or down) but the
 * deeper Search still returned sources, synthesize a SHORT,
 * deterministic fallback line from the freshest source. It is clearly derived
 * (no LLM, no invented facts) so the card has graceful content instead of a
 * bare "no update". Returns null when there are no usable sources.
 */
export function fallbackBrief(contact, sources) {
  const list = Array.isArray(sources) ? sources : [];
  const top = list.find((s) => s && (s.title || s.url));
  if (!top) return null;
  const name = (contact?.name || "This contact").trim();
  const title = typeof top.title === "string" ? top.title.trim() : "";
  const when = top.date ? ` (${top.date})` : "";
  if (title) return `Most recent mention of ${name}: "${title}"${when}.`;
  return `Recent web activity found for ${name}${when}.`;
}

/**
 * Compose the human-readable text we embed into Pinecone for this contact.
 * Combines identity, the brief, and the freshest source titles so a future
 * semantic query ("who just changed jobs") can recall the contact.
 */
function embeddingText(contact, whatsNew, sources) {
  const parts = [];
  const name = (contact?.name || "").trim();
  const ident = [name];
  if (contact?.title) ident.push(contact.title);
  if (contact?.company) ident.push(`@ ${contact.company}`);
  parts.push(ident.filter(Boolean).join(" "));
  if (whatsNew) parts.push(`What's new: ${whatsNew}`);
  const titles = (Array.isArray(sources) ? sources : [])
    .slice(0, ENRICH_TOP_SOURCES)
    .map((s) => s?.title)
    .filter((t) => typeof t === "string" && t.trim());
  if (titles.length) parts.push(`Recent: ${titles.join(" | ")}`);
  return parts.filter(Boolean).join("\n").slice(0, 4000);
}

// did:contactId -> sha256 of the last embedded text. Lets a re-enrich SKIP the
// embed + upsert when the composed context is byte-for-byte unchanged, so
// repeated profile opens don't thrash the index with identical vectors (item
// 171). In-process only; a cold start re-embeds once, which is harmless.
const _embedHashes = new Map();

function hashKey(did, contactId) {
  return `${did}::${contactId}`;
}

function contentHash(text) {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Best-effort, IDEMPOTENT Pinecone upsert of the enriched per-contact context.
 * Returns a status object, NEVER throws. A missing PINECONE_API_KEY just skips
 * embedding.
 *
 *   -> { embedded: boolean, status: "embedded"|"unchanged"|"skipped"|"error" }
 *
 * The upsert is skipped ("unchanged") when the composed embedding text hashes
 * to the same value as the last successful embed for this contact, making
 * re-enrichment incremental instead of re-pushing an identical vector. The
 * vector id is deterministic (`enrich:<contactId>`) so a content change upserts
 * in place. Injectable `embed` + `upsert` keep this testable with no network.
 */
async function embedEnrichment(
  did,
  contact,
  whatsNew,
  sources,
  { embed, upsert },
) {
  // NO EXTERNAL INDEX BY DEFAULT. There is no vector service to push to any
  // more; observations carry their own pgvector embedding, filled by
  // src/db/embedding-queue.js. The injected seam is kept because it is how this
  // is tested, and because an in-database indexer will slot straight into it --
  // but with nothing injected, this does nothing rather than reaching out.
  if (typeof embed !== "function" || typeof upsert !== "function") {
    return { embedded: false, status: "external_index_removed" };
  }
  const text = embeddingText(contact, whatsNew, sources);
  if (!text.trim()) return { embedded: false, status: "skipped" };

  const key = hashKey(did, contact.id);
  const hash = contentHash(text);
  if (_embedHashes.get(key) === hash) {
    return { embedded: false, status: "unchanged" };
  }

  try {
    const vector = await embed(text);
    if (!Array.isArray(vector)) return { embedded: false, status: "error" };
    await upsert(did, [
      {
        id: `enrich:${contact.id}`,
        vector,
        text,
        kind: "people_enrichment",
        source: "peoplerank_enrich",
        personId: String(contact.id),
        personName: contact.name || undefined,
        healthDimension: "social",
      },
    ]);
    _embedHashes.set(key, hash);
    return { embedded: true, status: "embedded" };
  } catch {
    return { embedded: false, status: "error" };
  }
}

// ── cache ────────────────────────────────────────────────────────────────────

// did -> Map<contactId, { at, result }>
const _cache = new Map();

function cacheGet(did, contactId, ttlMs, nowMs) {
  const tenant = _cache.get(did);
  const hit = tenant?.get(contactId);
  if (!hit) return null;
  if (nowMs - hit.at > ttlMs) {
    tenant.delete(contactId);
    return null;
  }
  return hit.result;
}

function cacheSet(did, contactId, result, nowMs) {
  let tenant = _cache.get(did);
  if (!tenant) {
    tenant = new Map();
    _cache.set(did, tenant);
  }
  tenant.set(contactId, { at: nowMs, result });
}

// ── enrichment feedback (item 176) ────────────────────────────────────────────

// did:contactId -> { good, bad }. A user marking an enrichment wrong (stale,
// irrelevant, low-quality) down-weights future confidence for that contact and
// busts its cache so the next open re-pulls instead of re-serving the bad brief.
// In-process + DID-scoped, mirroring the signals/feedback pattern elsewhere.
const _feedback = new Map();

/**
 * Record a thumbs up/down on a contact's enrichment quality (item 176).
 *
 *   recordEnrichmentFeedback(did, contactId, "down")  // or "up"
 *
 * Pure bookkeeping; never throws. A "down" also invalidates the cached result
 * for that contact so the correction takes effect on the next enrich.
 */
export function recordEnrichmentFeedback(did, contactId, kind) {
  if (!did || contactId == null) return;
  const key = hashKey(did, contactId);
  const cur = _feedback.get(key) || { good: 0, bad: 0 };
  if (kind === "up" || kind === "good") cur.good += 1;
  else if (kind === "down" || kind === "bad") cur.bad += 1;
  else return;
  _feedback.set(key, cur);
  if (cur.bad > cur.good) {
    // Bust the cached (likely bad) result so the next call re-pulls fresh.
    _cache.get(did)?.delete(contactId);
  }
}

/** Confidence in a contact's enrichment, 0..1, lowered by negative feedback. */
function feedbackConfidence(did, contactId) {
  const fb = _feedback.get(hashKey(did, contactId));
  if (!fb) return 1;
  const total = fb.good + fb.bad;
  if (total === 0) return 1;
  // Wilson-ish shrink toward neutral: a single downvote dents, repeated downs
  // drive it low, while upvotes restore it. Bounded to [0.1, 1].
  const raw = (fb.good + 1) / (total + 2);
  return Math.max(0.1, Math.min(1, raw));
}

/** Test/maintenance hook: clear ALL in-process enrichment state. */
export function _clearEnrichCache() {
  _cache.clear();
  _embedHashes.clear();
  _feedback.clear();
}

/**
 * Enrich ONE contact. The single public entry point for the ENRICH function.
 * Never throws; always resolves to a fully-shaped result object (see module
 * doc). A flag-off / no-key call returns immediately without any network.
 *
 *   enrichPerson(did, contact, {
 *     searchImpl?, agentBriefImpl?, embed?, upsert?, apiKey?, nowMs?, ttlMs?,
 *     force?,
 *   })
 *
 * `force` bypasses the cache (e.g. an explicit refresh from the route).
 */
export async function enrichPerson(did, contact, opts = {}) {
  const {
    searchImpl = defaultSearch,
    agentBriefImpl = agentBrief,
    embed,
    upsert,
    apiKey = process.env.EXA_API_KEY,
    nowMs = Date.now(),
    ttlMs = DEFAULT_TTL_MS,
    force = false,
    log = null,
  } = opts;

  if (!enrichmentEnabled()) {
    return disabledResult("disabled", did, contact, nowMs);
  }
  if (!apiKey) {
    return disabledResult("no_key", did, contact, nowMs);
  }
  if (!contact || !contact.id || !(contact.name || "").trim()) {
    return disabledResult("no_contact", did, contact, nowMs);
  }

  if (!force) {
    const cached = cacheGet(did, contact.id, ttlMs, nowMs);
    if (cached) return { ...cached, from_cache: true };
  }

  try {
    // 1. Deeper web pull (broader than the in-path signal fetch).
    const variants = enrichQueryVariants(contact, {
      year: new Date(nowMs).getUTCFullYear(),
    });
    let results = [];
    try {
      const resp = await searchImpl({
        query: variants,
        apiKey,
        maxResults: ENRICH_MAX_RESULTS,
      });
      if (resp && Array.isArray(resp.results)) results = resp.results;
    } catch {
      results = [];
    }
    const signals = extractSignals(results, {
      nowMs,
      topN: ENRICH_TOP_SOURCES,
    });
    // Order the card's sources freshest + most credible first (item 174).
    const sources = rankSources(signals.top_sources);

    // 2. Agent "what's new" narrative brief (lazy, sparing). On unavailability,
    //    synthesize a deterministic fallback from the freshest source (item 173)
    //    in a SEPARATE field so `whats_new` stays strictly the grounded brief.
    // No apiKey passed: the brief is Anthropic, the search key is Exa's.
    // Handing one vendor's key to the other worked only while a single
    // Perplexity key served both legs.
    const whatsNew = await agentBriefImpl({ contact, sources, log });
    const whatsNewFallback = whatsNew ? null : fallbackBrief(contact, sources);

    // 3. Canonical, deduped, verified social links for the card (item 170).
    const socialLinks = extractSocialLinks(sources, signals.social_links);

    // 4. Pinecone embedding upsert (idempotent, silent skip if unconfigured).
    let embedded = false;
    let embedStatus = "off";
    if (typeof embed === "function" && typeof upsert === "function") {
      const r = await embedEnrichment(did, contact, whatsNew, sources, {
        embed,
        upsert,
      });
      embedded = r.embedded;
      embedStatus = r.status;
    }

    const result = {
      status: "ok",
      contactId: String(contact.id),
      name: contact.name || null,
      whats_new: whatsNew,
      whats_new_fallback: whatsNewFallback,
      sources,
      social_links: socialLinks,
      signals,
      embedded,
      embed_status: embedStatus,
      confidence: feedbackConfidence(did, contact.id),
      from_cache: false,
      enriched_at: new Date(nowMs).toISOString(),
    };
    cacheSet(did, contact.id, result, nowMs);
    return result;
  } catch {
    return disabledResult("error", did, contact, nowMs);
  }
}

/** A fully-shaped no-op result (flag off, no key, no contact, or hard error). */
function disabledResult(status, did, contact, nowMs) {
  return {
    status,
    contactId: contact?.id != null ? String(contact.id) : null,
    name: contact?.name || null,
    whats_new: null,
    whats_new_fallback: null,
    sources: [],
    social_links: {},
    signals: {
      recency: null,
      momentum: 0,
      social_links: {},
      top_sources: [],
      queried: false,
    },
    embedded: false,
    embed_status: "off",
    confidence: 1,
    from_cache: false,
    enriched_at: new Date(nowMs).toISOString(),
  };
}
