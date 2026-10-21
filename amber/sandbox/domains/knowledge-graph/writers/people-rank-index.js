/**
 * PeopleRank vector retrieval (Tab 34).
 *
 * jobs/people-rank.js writes one `people_rank_score` vector per (contact, day)
 * and jobs/drift-detector.js writes `drift_alert` vectors, both into the
 * tenant's DID-keyed Pinecone namespace (the same namespace pinecone-client.js
 * serves and Tabs 19/32 use). This module is the READ side: typed helpers the
 * people-rank route + agent tool call to answer "rank my network", "who matters
 * most", "who am I drifting from", and "how strong is my relationship with X".
 *
 * Like the Tab 32 snapshot index, rows are selected by metadata filter (not
 * semantic similarity), so we embed one stable probe string and let topK +
 * filter do the selection, then sort/derive in pure code
 * (src/lib/people-rank-score.js). Every function degrades to [] rather than
 * throwing so the caller keeps serving traffic.
 */

import { query as pineconeQuery } from "../service/lib/pinecone.js";
import { embed } from "../service/lib/embed.js";
import {
  PEOPLE_RANK_KIND,
  DRIFT_ALERT_KIND,
  rankByMetric,
} from "../service/lib/people-rank-score.js";

const PROBE_TEXT =
  "people rank warmth centrality recency relevance drift alert network";

function vectorizationAvailable() {
  return !!(process.env.PINECONE_API_KEY && process.env.PERPLEXITY_API_KEY);
}

let _probePromise = null;
async function probeVector() {
  if (!_probePromise) _probePromise = embed(PROBE_TEXT);
  return _probePromise;
}

function toRankRow(match) {
  const md = match?.metadata || {};
  return {
    id: match?.id,
    contact_id: md.contact_id,
    contact_name: md.contact_name || "",
    day_key: md.day_key || "",
    ranked_at: Number(md.ranked_at) || 0,
    warmth_score: Number(md.warmth_score) || 0,
    centrality_score: Number(md.centrality_score) || 0,
    recency_score: Number(md.recency_score) || 0,
    relevance_score: Number(md.relevance_score) || 0,
    composite_score: Number(md.composite_score) || 0,
    edge_degree: Number(md.edge_degree) || 0,
    text: md.text || "",
  };
}

function toAlertRow(match) {
  const md = match?.metadata || {};
  return {
    id: match?.id,
    contact_id: md.contact_id,
    contact_name: md.contact_name || "",
    day_key: md.day_key || "",
    detected_at: Number(md.detected_at) || 0,
    alert_type: md.alert_type || "",
    severity: md.severity || "",
    change_pct: Number(md.change_pct) || 0,
    from_score: Number(md.from_score) || 0,
    to_score: Number(md.to_score) || 0,
    silence_days: Number(md.silence_days) || 0,
    first_touch_days: Number(md.first_touch_days) || 0,
    text: md.text || "",
  };
}

async function queryVectors(privyDid, filter, topK = 1000) {
  if (!privyDid || !vectorizationAvailable()) return [];
  let vector;
  try {
    vector = await probeVector();
  } catch {
    return [];
  }
  try {
    const matches = await pineconeQuery(privyDid, vector, { topK, filter });
    return Array.isArray(matches) ? matches : [];
  } catch {
    return [];
  }
}

// Keep only the most recent people_rank_score per contact (rows are daily).
function latestRankPerContact(rows) {
  const byContact = new Map();
  for (const r of rows) {
    if (!r.contact_id) continue;
    const prev = byContact.get(r.contact_id);
    if (!prev || (r.ranked_at || 0) > (prev.ranked_at || 0)) {
      byContact.set(r.contact_id, r);
    }
  }
  return [...byContact.values()];
}

/**
 * Top contacts by a ranking metric. metric ∈ "composite" (default), "warmth",
 * "centrality", "recency", "relevance". Uses the latest score per contact.
 */
export async function findTopRanked(
  privyDid,
  { metric = "composite", limit = 10 } = {},
) {
  const matches = await queryVectors(
    privyDid,
    { kind: PEOPLE_RANK_KIND },
    1000,
  );
  const latest = latestRankPerContact(matches.map(toRankRow));
  return rankByMetric(latest, { metric, limit });
}

/**
 * The latest people_rank_score for one contact, or null. An explicit contactId
 * wins; otherwise resolve by case-insensitive name (exact then substring).
 */
export async function findRankForContact(
  privyDid,
  { contactId, contactName } = {},
) {
  const matches = await queryVectors(
    privyDid,
    { kind: PEOPLE_RANK_KIND },
    1000,
  );
  const latest = latestRankPerContact(matches.map(toRankRow));
  if (contactId) {
    return latest.find((r) => r.contact_id === contactId) || null;
  }
  if (!contactName) return null;
  const needle = String(contactName).toLowerCase().trim();
  return (
    latest.find((r) => (r.contact_name || "").toLowerCase() === needle) ||
    latest.find((r) => (r.contact_name || "").toLowerCase().includes(needle)) ||
    null
  );
}

/**
 * Recent drift alerts, newest first, optionally filtered to one alert type and
 * a trailing window. Dedupes to the most recent alert per (contact, type).
 */
export async function findDriftAlerts(
  privyDid,
  { type, windowDays = 30, limit = 20, now = new Date() } = {},
) {
  const sinceMs = now.getTime() - windowDays * 86400000;
  const filter = { kind: DRIFT_ALERT_KIND, detected_at: { $gte: sinceMs } };
  if (type) filter.alert_type = type;
  const matches = await queryVectors(privyDid, filter, 1000);
  const rows = matches.map(toAlertRow);
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.contact_id}:${r.alert_type}`;
    const prev = byKey.get(k);
    if (!prev || (r.detected_at || 0) > (prev.detected_at || 0)) {
      byKey.set(k, r);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => (b.detected_at || 0) - (a.detected_at || 0))
    .slice(0, limit);
}
