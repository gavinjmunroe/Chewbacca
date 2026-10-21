// people-rank-score.js
// Tab 34 - Pure scoring helpers for the Medha-side PeopleRank layer.
//
// PeopleRank ranks the user's network by composing first-party signals that
// already live in Pinecone: the Tab 32 weekly warmth time-series, the Tab 33
// contact-edge graph (degree centrality), touchpoint recency, and embedding
// relevance to what the user has been focused on lately. Everything here is
// dependency-free and deterministic so it is unit-testable in isolation and
// reused by both the daily cron (jobs/people-rank.js + jobs/drift-detector.js)
// and the read surface (knowledge/people-rank-index.js). No Pinecone, no
// Firestore, no clock access beyond the Date passed in by the caller.
//
// Reconciliation note: medha-id/CLAUDE.md describes PeopleRank as a Togari
// adapter, but per the locked scope rule (dispatch Part 0.4) Medha never reaches
// into Togari. This is a Medha-only ranking layer over Medha's own vectors. When
// Togari ships its own PeopleRank, the two can dual-write or reconcile by
// contact_id; that merge is out of scope here and intentionally not blocked on.

export const PEOPLE_RANK_KIND = "people_rank_score";
export const DRIFT_ALERT_KIND = "drift_alert";

// People-ranking is a "social" dimension signal per the six-dimension ontology
// (financial/intellectual/social = masculine; spiritual/emotional/physical =
// feminine). Keeps the rows filterable alongside Tab 32 snapshots.
export const PEOPLE_RANK_HEALTH_DIMENSION = "social";

// Drift alert types.
export const DRIFT_COOLING = "cooling_alert";
export const DRIFT_WARMING_SURGE = "warming_surge";
export const DRIFT_GOING_DARK = "going_dark";

// ---- time helpers ------------------------------------------------------------

// UTC calendar-day key like "2026-05-30". Stable for the whole day so a re-run
// within the day is an idempotent upsert.
export function dayKey(date) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  return d.toISOString().slice(0, 10);
}

// Deterministic vector ids so re-running the same day upserts in place.
export function peopleRankId(contactId, key) {
  return `people_rank:${contactId}:${key}`;
}

export function driftAlertId(contactId, key, type) {
  return `drift_alert:${type}:${contactId}:${key}`;
}

// ---- component scores --------------------------------------------------------

// Warmth: recency-weighted mean of the trailing relationship_snapshot composite
// scores for one contact. Rows are {week_start, composite_score}. The most
// recent week is weighted highest (linear ramp by ordinal recency) so a fresh
// warm week outweighs a stale one. Returns 0 when there is no history.
export function warmthScore(rows) {
  const usable = (rows || [])
    .filter((r) => typeof r.composite_score === "number")
    .slice()
    .sort((a, b) => (a.week_start || 0) - (b.week_start || 0));
  if (usable.length === 0) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  usable.forEach((r, i) => {
    const w = i + 1; // oldest=1 .. newest=n
    weightedSum += w * clamp01(r.composite_score);
    weightTotal += w;
  });
  return weightTotal ? round(weightedSum / weightTotal, 4) : 0;
}

// Centrality: degree centrality in the contact-edge graph, min-maxed to 0..1
// across the network. `degreeByContact` is { contactId: edgeCount }. Returns a
// { contactId: 0..1 } map. When every contact has the same degree (or the graph
// is empty, e.g. Tab 33 not shipped yet) every contact gets 0 so the signal is
// neutral rather than misleadingly maxed.
export function normalizeCentrality(degreeByContact) {
  const entries = Object.entries(degreeByContact || {});
  const out = {};
  if (entries.length === 0) return out;
  const degrees = entries.map(([, d]) => Number(d) || 0);
  const max = Math.max(...degrees);
  const min = Math.min(...degrees);
  const span = max - min;
  for (const [id, d] of entries) {
    out[id] = span > 0 ? round(((Number(d) || 0) - min) / span, 4) : 0;
  }
  return out;
}

// Recency: exponential decay on days since the last touchpoint. Half-life
// default 14 days, so a contact touched today scores ~1, two weeks ago ~0.5,
// a month ago ~0.25. No touchpoint -> 0.
export function recencyScore(lastTouchpointMs, nowMs, halfLifeDays = 14) {
  if (!lastTouchpointMs || typeof lastTouchpointMs !== "number") return 0;
  const days = Math.max(0, (nowMs - lastTouchpointMs) / 86400000);
  return round(Math.pow(0.5, days / halfLifeDays), 4);
}

// Cosine similarity of two equal-length numeric vectors. Returns 0 on a
// length/empty mismatch or a zero-magnitude vector rather than NaN.
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Relevance: cosine similarity (which can be slightly negative) mapped into a
// 0..1 score. Negatives clamp to 0 since "anti-aligned with my recent focus"
// is just "not relevant", not a penalty below a contact with no signal.
export function relevanceScore(cosine) {
  return round(clamp01(Number(cosine) || 0), 4);
}

// ---- composite ---------------------------------------------------------------

// Default blend. Warmth (how the relationship feels lately) leads, recency keeps
// fresh contacts up, centrality rewards network hubs, relevance ties ranking to
// what the user is actually working on now.
export const DEFAULT_WEIGHTS = Object.freeze({
  warmth: 0.4,
  centrality: 0.2,
  recency: 0.25,
  relevance: 0.15,
});

const WEIGHT_KEYS = Object.freeze([
  "warmth",
  "centrality",
  "recency",
  "relevance",
]);

// Merge caller weights over the defaults and renormalize to sum 1, dropping
// negative / non-finite entries. A caller can zero out a component (e.g.
// centrality: 0 until Tab 33 ships) and the rest rescale to fill the space.
export function normalizeWeights(weights) {
  const merged = { ...DEFAULT_WEIGHTS };
  if (weights && typeof weights === "object") {
    for (const k of WEIGHT_KEYS) {
      const v = Number(weights[k]);
      if (Number.isFinite(v) && v >= 0) merged[k] = v;
    }
  }
  const total = WEIGHT_KEYS.reduce((s, k) => s + merged[k], 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {};
  for (const k of WEIGHT_KEYS) out[k] = merged[k] / total;
  return out;
}

// Blend the four 0..1 component scores into a single 0..1 composite rank.
export function compositeRank(
  { warmth = 0, centrality = 0, recency = 0, relevance = 0 } = {},
  weights = DEFAULT_WEIGHTS,
) {
  const w = normalizeWeights(weights);
  const score =
    w.warmth * clamp01(warmth) +
    w.centrality * clamp01(centrality) +
    w.recency * clamp01(recency) +
    w.relevance * clamp01(relevance);
  return round(score, 4);
}

// ── SEARCH signal-aware scoring (additive, flag-gated at the route) ───────────
//
// Spec §1b (Sagar's #1 ask): OPTIONALLY add web-derived signal components on
// top of the base composite so the app can show WHY someone ranks ("recent
// activity", "momentum"). This is intentionally ADDITIVE and transparent: the
// base composite is computed EXACTLY as before, then a small bounded boost is
// added from the signal components and the sum is re-clamped to 0..1. With an
// all-zero / empty signal set the boost is 0 and the output is byte-identical
// to compositeRank(...), so the route degrades to today's ranking whenever the
// SEARCH signals flag is off or the Search key is missing.
//
// The boost is a weighted sum of the signal components scaled by SIGNAL_BOOST
// (the maximum fraction the web signals can move a score). Keeping the boost
// bounded and separate from normalizeWeights means the existing warmth/recency/
// relevance/centrality blend is never reweighted by the presence of signals.

// Default per-signal weights WITHIN the boost (they sum to 1 before scaling).
export const DEFAULT_SIGNAL_WEIGHTS = Object.freeze({
  recency: 0.4, // freshness of the newest web result
  momentum: 0.35, // distinct fresh sources (activity)
  engagement: 0.25, // first-party feedback (taps/confirms/opens)
});

// Maximum fraction a perfect signal set can add to the base composite.
export const SIGNAL_BOOST = 0.25;

const SIGNAL_KEYS = Object.freeze(["recency", "momentum", "engagement"]);

// Normalize signal weights to sum 1, dropping negative/non-finite entries.
// Mirrors normalizeWeights but for the signal sub-blend.
export function normalizeSignalWeights(weights) {
  const merged = { ...DEFAULT_SIGNAL_WEIGHTS };
  if (weights && typeof weights === "object") {
    for (const k of SIGNAL_KEYS) {
      const v = Number(weights[k]);
      if (Number.isFinite(v) && v >= 0) merged[k] = v;
    }
  }
  const total = SIGNAL_KEYS.reduce((s, k) => s + merged[k], 0);
  if (total <= 0) return { ...DEFAULT_SIGNAL_WEIGHTS };
  const out = {};
  for (const k of SIGNAL_KEYS) out[k] = merged[k] / total;
  return out;
}

// The 0..1 aggregate signal strength for one contact (the boost before
// scaling). Pure; exported for the breakdown the app renders.
export function signalStrength(
  { recency = 0, momentum = 0, engagement = 0 } = {},
  signalWeights = DEFAULT_SIGNAL_WEIGHTS,
) {
  const w = normalizeSignalWeights(signalWeights);
  const s =
    w.recency * clamp01(recency) +
    w.momentum * clamp01(momentum) +
    w.engagement * clamp01(engagement);
  return round(s, 4);
}

// Composite WITH the additive web-signal boost. Returns a breakdown object so
// the route can expose exactly what moved the score:
//
//   { base, boost, score, signalStrength, signalComponents }
//
// `base` === compositeRank(components, weights) (unchanged). `boost` is
// SIGNAL_BOOST * signalStrength(...). `score` is clamp01(base + boost). When
// signalComponents are all 0 the boost is 0 and score === base, preserving the
// flag-off contract.
export function compositeRankWithSignals(
  components = {},
  weights = DEFAULT_WEIGHTS,
  signalComponents = {},
  signalWeights = DEFAULT_SIGNAL_WEIGHTS,
) {
  const base = compositeRank(components, weights);
  const strength = signalStrength(signalComponents, signalWeights);
  const boost = round(SIGNAL_BOOST * strength, 4);
  const score = round(clamp01(base + boost), 4);
  return {
    base,
    boost,
    score,
    signalStrength: strength,
    signalComponents: {
      recency: round(clamp01(signalComponents.recency || 0), 4),
      momentum: round(clamp01(signalComponents.momentum || 0), 4),
      engagement: round(clamp01(signalComponents.engagement || 0), 4),
    },
  };
}

// Natural-language description embedded as the people_rank_score vector content.
export function rankContent({
  contactName,
  key,
  composite,
  warmth,
  centrality,
  recency,
  relevance,
}) {
  return (
    `PeopleRank for ${contactName || "unknown"} on ${key}: ` +
    `composite ${round(composite, 3)} ` +
    `(warmth ${round(warmth, 2)}, centrality ${round(centrality, 2)}, ` +
    `recency ${round(recency, 2)}, relevance ${round(relevance, 2)}).`
  );
}

// Rank rows (latest people_rank_score per contact) by a chosen component,
// descending. metric: "composite" | "warmth" | "centrality" | ... Returns a
// fresh sorted slice of length <= limit.
export function rankByMetric(rows, { metric = "composite", limit = 10 } = {}) {
  const field = metric === "composite" ? "composite_score" : `${metric}_score`;
  return (rows || [])
    .filter((r) => typeof r[field] === "number")
    .slice()
    .sort((a, b) => b[field] - a[field])
    .slice(0, limit);
}

// ---- drift detection ---------------------------------------------------------

// Decide whether a contact's trailing warmth series + touchpoint ages cross a
// drift threshold. `series` is {week_start, composite_score}[] oldest->newest
// over the lookback window. Returns an array of alert objects (possibly empty);
// a contact can be both surging and freshly touched, but going-dark is mutually
// exclusive with an active series so at most one alert fires in practice.
export function detectDrift({
  series = [],
  lastTouchpointMs = null,
  firstTouchpointMs = null,
  nowMs,
  coolingDropPct = 0.3,
  warmingRisePct = 0.5,
  goingDarkFirstTouchDays = 90,
  goingDarkSilenceDays = 21,
} = {}) {
  const alerts = [];
  const sorted = (series || [])
    .filter((r) => typeof r.composite_score === "number")
    .slice()
    .sort((a, b) => (a.week_start || 0) - (b.week_start || 0));

  if (sorted.length >= 2) {
    const earliest = sorted[0].composite_score;
    const latest = sorted[sorted.length - 1].composite_score;
    if (earliest > 0) {
      const change = (latest - earliest) / earliest;
      if (change <= -coolingDropPct) {
        alerts.push({
          type: DRIFT_COOLING,
          severity: severityFromMagnitude(Math.abs(change), coolingDropPct),
          change_pct: round(change, 4),
          from_score: round(earliest, 4),
          to_score: round(latest, 4),
        });
      } else if (change >= warmingRisePct) {
        alerts.push({
          type: DRIFT_WARMING_SURGE,
          severity: severityFromMagnitude(change, warmingRisePct),
          change_pct: round(change, 4),
          from_score: round(earliest, 4),
          to_score: round(latest, 4),
        });
      }
    }
  }

  if (typeof firstTouchpointMs === "number" && typeof nowMs === "number") {
    const firstAgeDays = (nowMs - firstTouchpointMs) / 86400000;
    const silenceDays =
      typeof lastTouchpointMs === "number"
        ? (nowMs - lastTouchpointMs) / 86400000
        : Infinity;
    if (
      firstAgeDays >= goingDarkFirstTouchDays &&
      silenceDays >= goingDarkSilenceDays
    ) {
      alerts.push({
        type: DRIFT_GOING_DARK,
        severity: silenceDays >= goingDarkSilenceDays * 3 ? "high" : "medium",
        silence_days: Math.round(silenceDays === Infinity ? 9999 : silenceDays),
        first_touch_days: Math.round(firstAgeDays),
      });
    }
  }

  return alerts;
}

// "high" once the change is 2x past the threshold, else "medium".
function severityFromMagnitude(magnitude, threshold) {
  return magnitude >= threshold * 2 ? "high" : "medium";
}

// Natural-language description embedded as a drift_alert vector content.
export function driftContent(contactName, alert) {
  const name = contactName || "unknown";
  if (alert.type === DRIFT_COOLING) {
    return (
      `Cooling alert for ${name}: warmth dropped ${pct(alert.change_pct)} ` +
      `(${round(alert.from_score, 2)} -> ${round(alert.to_score, 2)}) over the window.`
    );
  }
  if (alert.type === DRIFT_WARMING_SURGE) {
    return (
      `Warming surge for ${name}: warmth rose ${pct(alert.change_pct)} ` +
      `(${round(alert.from_score, 2)} -> ${round(alert.to_score, 2)}) over the window.`
    );
  }
  return (
    `Going dark with ${name}: no touchpoint in ${alert.silence_days} days, ` +
    `relationship is ${alert.first_touch_days} days old.`
  );
}

// ---- small utils -------------------------------------------------------------

function pct(fraction) {
  return `${Math.round(Math.abs(Number(fraction) || 0) * 100)}%`;
}

function clamp01(n) {
  const v = Number(n) || 0;
  return Math.max(0, Math.min(1, v));
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round((Number(n) || 0) * f) / f;
}
