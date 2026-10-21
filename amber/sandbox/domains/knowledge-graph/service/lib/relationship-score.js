// relationship-score.js
// Tab 32 - Pure scoring helpers for time-series relationship state.
//
// Everything here is dependency-free and deterministic so it is unit-testable in
// isolation and reusable from both the snapshot cron (jobs/relationship-snapshot.js)
// and the read surface (knowledge/relationship-snapshot-index.js). No Pinecone, no
// Firestore, no clock access beyond the Date passed in by the caller.

export const RELATIONSHIP_SNAPSHOT_KIND = "relationship_snapshot";

// relationship state is a "social" dimension item per the six-dimension ontology
// (financial/intellectual/social = masculine; spiritual/emotional/physical = feminine).
export const RELATIONSHIP_HEALTH_DIMENSION = "social";

// ---- time helpers ------------------------------------------------------------

// UTC midnight of the Monday that starts the ISO week containing `date`.
export function isoWeekStart(date) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

// ISO week key like "2026-W22". Stable across the whole week.
export function isoWeekKey(date) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// Deterministic vector id so re-running the same week is an idempotent upsert.
export function snapshotId(contactId, weekKey) {
  return `rel_snapshot:${contactId}:${weekKey}`;
}

// Stable contact id derived from a display name, used when a memory item has no
// explicit person_id. The job and the trajectory route MUST agree on this so a
// name-based lookup resolves to the same vectors the job wrote.
export function contactIdFromName(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `name:${slug}` : null;
}

// ---- sentiment ---------------------------------------------------------------

const POSITIVE =
  /\b(love|loved|great|amazing|thank|thanks|excited|grateful|congrats|congratulations|proud|awesome|happy|glad|appreciate|appreciated|win|won|nailed|stoked|good|wonderful|yes|yay|perfect|brilliant)\b/gi;
const NEGATIVE =
  /\b(sorry|frustrated|annoyed|angry|upset|disappointed|sad|worried|stressed|problem|issue|delay|delayed|missed|miss|cant|cannot|hate|bad|wrong|no|never|unfortunately|fail|failed|busy)\b/gi;

// Lexical fallback sentiment in [-1, 1]. Neutral text -> 0.
export function lexicalSentiment(text) {
  if (!text) return 0;
  const pos = (text.match(POSITIVE) || []).length;
  const neg = (text.match(NEGATIVE) || []).length;
  const total = pos + neg;
  if (total === 0) return 0;
  return clamp((pos - neg) / total, -1, 1);
}

// ---- composite ---------------------------------------------------------------

// Soft-normalized blend, all inputs collapse into a single 0..1 warmth score.
// Weights: cadence 0.45, sentiment 0.35, breadth 0.20.
export function compositeScore({
  talk_frequency = 0,
  sentiment_score = 0,
  touchpoint_diversity = 0,
} = {}) {
  const freq = clamp(talk_frequency / 10, 0, 1); // 10+ touches/week saturates
  const breadth = clamp(touchpoint_diversity / 5, 0, 1); // 5 context kinds saturates
  const sent = (clamp(sentiment_score, -1, 1) + 1) / 2; // -1..1 -> 0..1
  return round(0.45 * freq + 0.35 * sent + 0.2 * breadth, 4);
}

export function scoreDelta(current, previous) {
  if (typeof previous !== "number") return 0;
  return round(current - previous, 4);
}

// Natural-language description embedded as the vector content.
export function snapshotContent({
  contactName,
  weekKey,
  talk_frequency,
  sentiment_score,
  touchpoint_diversity,
  delta,
}) {
  const sentStr = `${sentiment_score >= 0 ? "+" : ""}${round(sentiment_score, 2)}`;
  const deltaStr = `${delta >= 0 ? "+" : ""}${round(delta, 2)}`;
  return (
    `Relationship with ${contactName || "unknown"}, week of ${weekKey}: ` +
    `talked ${talk_frequency} time${talk_frequency === 1 ? "" : "s"}, ` +
    `sentiment ${sentStr}, touchpoints across ${touchpoint_diversity} context ` +
    `kind${touchpoint_diversity === 1 ? "" : "s"}, ${deltaStr} vs prior week.`
  );
}

// ---- ranking -----------------------------------------------------------------

// From many snapshot rows, keep only the most recent per contact_id.
export function latestPerContact(rows) {
  const byContact = new Map();
  for (const row of rows || []) {
    const key = row.contact_id;
    if (!key) continue;
    const prev = byContact.get(key);
    if (!prev || (row.week_start || 0) > (prev.week_start || 0)) {
      byContact.set(key, row);
    }
  }
  return [...byContact.values()];
}

// Rank latest-per-contact rows by score_delta. direction: "warming" | "cooling".
export function rankByDelta(rows, { direction = "warming", limit = 10 } = {}) {
  const latest = latestPerContact(rows).filter(
    (r) => typeof r.score_delta === "number",
  );
  const filtered = latest.filter((r) =>
    direction === "warming" ? r.score_delta > 0 : r.score_delta < 0,
  );
  filtered.sort((a, b) =>
    direction === "warming"
      ? b.score_delta - a.score_delta
      : a.score_delta - b.score_delta,
  );
  return filtered.slice(0, limit);
}

// Overall trajectory direction across an ordered (old->new) series.
export function trajectoryDirection(series) {
  if (!series || series.length < 2) return "steady";
  const first = series[0].composite_score ?? 0;
  const last = series[series.length - 1].composite_score ?? 0;
  const diff = last - first;
  if (diff > 0.02) return "warming";
  if (diff < -0.02) return "cooling";
  return "steady";
}

// ---- small utils -------------------------------------------------------------

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round((Number(n) || 0) * f) / f;
}
