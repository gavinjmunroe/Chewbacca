/**
 * ranking.js — in-process PeopleRank query-ranker. This is the JS mirror of
 * Newton/agent/peoplerank/ranking.py (the faithful Python port of the CTO's
 * togari-search scoring/rationale logic). The two MUST stay in sync — the
 * Python test suite (tests/test_ranking.py) pins the algorithm; this file is
 * what actually runs on the /v1/peoplerank/search request path so we avoid a
 * Python process on the hot path (same posture as /v1/network/search, which
 * runs search_contacts in-process).
 *
 * Ported pure logic: the CTO's confidence weights/bands, the
 * extract_signals shape, and the rationale validators/scrubber (verbatim).
 */

// Confidence model — ported from togari-search src/peoplerank/score.py.
export const CONFIDENCE_WEIGHTS = {
  text_completeness: 0.5,
  structured_coverage: 0.3,
  graph_signal: 0.2,
};

const CONFIDENCE_BANDS = [
  [0.7, "high"],
  [0.4, "medium"],
  [0.0, "low"],
];

const DENSITY_WORD_CAP = 100; // ported saturation point
const RELEVANCE_WEIGHT = 0.7; // mirrors COMPATIBILITY_MIX["vec_sim"]
const QUALITY_WEIGHT = 0.3;
const GRAPH_SOURCES = ["linkedin", "github", "twitter", "x"];

function clamp01(n) {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, v));
}

function wordCount(text) {
  if (!text) return 0;
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function textCompleteness(profileText) {
  return Math.min(wordCount(profileText) / DENSITY_WORD_CAP, 1.0);
}

function structuredCoverage(c) {
  const fields = ["name", "source", "handle", "external_id"];
  const present = fields.filter((f) => String(c?.[f] || "").trim()).length;
  return present / fields.length;
}

function graphSignal(c) {
  const source = String(c?.source || "").toLowerCase();
  const fromGraph = GRAPH_SOURCES.some((s) => source.includes(s));
  const hasHandle = !!String(c?.handle || "").trim();
  if (fromGraph && hasHandle) return 1.0;
  if (fromGraph || hasHandle) return 0.5;
  return 0.0;
}

export function computeConfidence(tc, sc, gs) {
  return (
    CONFIDENCE_WEIGHTS.text_completeness * tc +
    CONFIDENCE_WEIGHTS.structured_coverage * sc +
    CONFIDENCE_WEIGHTS.graph_signal * gs
  );
}

export function confidenceLabel(conf, tc, sc, gs) {
  let band = "low";
  for (const [threshold, name] of CONFIDENCE_BANDS) {
    if (conf >= threshold) {
      band = name;
      break;
    }
  }
  if (band === "high") return { band, reason: "" };
  const components = { text: tc, "structured data": sc, graph: gs };
  let weakest = "text";
  for (const k of Object.keys(components)) {
    if (components[k] < components[weakest]) weakest = k;
  }
  return {
    band,
    reason: `${weakest} coverage weak (${components[weakest].toFixed(2)})`,
  };
}

function computeScore(relevance, c) {
  const rel = clamp01(relevance);
  const quality = 0.5 * structuredCoverage(c) + 0.5 * graphSignal(c);
  const combined = RELEVANCE_WEIGHT * rel + QUALITY_WEIGHT * quality;
  return Math.round(combined * 100 * 100) / 100;
}

function extractSignals(relevance, profileText, c, band) {
  const signals = [];
  if (relevance >= 0.35) signals.push(`relevance:${relevance.toFixed(2)}`);
  const tc = textCompleteness(profileText);
  if (tc >= 0.35) signals.push(`profile_depth:${tc.toFixed(2)}`);
  const gs = graphSignal(c);
  if (gs >= 0.5) signals.push(`graph:${gs.toFixed(2)}`);
  const source = String(c?.source || "").trim();
  if (source) {
    const short = source.includes("/") ? source.split("/").pop() : source;
    signals.push(`source:${short}`);
  }
  if (band) signals.push(`confidence:${band}`);
  return signals.slice(0, 6);
}

// ── Rationale validators + scrubber — ported verbatim from rationale.py ──

const BANNED_SUBSTRINGS = [
  "in a world where", "dynamic blend", "perfect match",
  "rich tapestry", "here is why", "this match stands out",
  "what makes this special", "could be potentially", "seems to likely",
];

const BANNED_PATTERNS = [
  [/\bnot just\b[^.!?]*\bbut\b/, "not_just_but"],
  [/\bmight be\b/, "might_be"],
  [/\bcould be\b/, "could_be"],
  [/\bpotentially\b/, "potentially"],
  [/\bseems to\b/, "seems_to"],
  [/\bleverage\b/, "leverage"],
  [/\bleveraging\b/, "leveraging"],
  [/\balign with\b/, "align_with"],
  [/\baligned with\b/, "aligned_with"],
  [/\balignment with\b/, "alignment_with"],
  [/\bembrace\b/, "embrace"],
  [/\bembraces\b/, "embraces"],
  [/\bembracing\b/, "embracing"],
  [/\bshared passion for\b/, "shared_passion_for"],
  [/\bunique opportunity\b/, "unique_opportunity"],
];

function splitSentences(text) {
  return text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((p) => p.trim());
}

export function validateRationale(text) {
  if (!text || !text.trim()) return { ok: false, reason: "empty" };
  if (text.length > 800) return { ok: false, reason: `too_long:${text.length}` };
  if (text.includes("—")) return { ok: false, reason: "em_dash" };
  if (/\S\s*–\s*\S/.test(text)) {
    return { ok: false, reason: "en_dash_between_words" };
  }
  if (text.includes(" -- ")) return { ok: false, reason: "double_dash" };
  const sentences = splitSentences(text);
  if (!(sentences.length >= 1 && sentences.length <= 7)) {
    return { ok: false, reason: `sentence_count:${sentences.length}` };
  }
  const lower = text.toLowerCase();
  for (const sub of BANNED_SUBSTRINGS) {
    if (lower.includes(sub)) return { ok: false, reason: `banned_sub:${sub}` };
  }
  for (const [pattern, reason] of BANNED_PATTERNS) {
    if (pattern.test(lower)) return { ok: false, reason: `banned_pat:${reason}` };
  }
  return { ok: true, reason: "ok" };
}

export function scrubAiTells(text) {
  if (!text) return text;
  let out = text
    .replace(/“/g, '"').replace(/”/g, '"')
    .replace(/‘/g, "'").replace(/’/g, "'")
    .replace(/—/g, ", ").replace(/–/g, ", ")
    .replace(/\s--\s/g, ", ")
    .replace(/(\w)--(\w)/g, "$1, $2");
  const aiPhrases = [
    /\bIt's worth noting that\s*/gi,
    /\bThat said,?\s*/gi,
    /\bMoreover,?\s*/gi,
    /\bFurthermore,?\s*/gi,
    /\bIn essence,?\s*/gi,
    /\bUltimately,?\s*/gi,
    /\bAt the end of the day,?\s*/gi,
  ];
  for (const pat of aiPhrases) out = out.replace(pat, "");
  out = out
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (out && out[0] === out[0].toLowerCase() && out[0] !== out[0].toUpperCase()) {
    out = out[0].toUpperCase() + out.slice(1);
  }
  return out;
}

function generateRationale(query, name, relevance, c, profileText, band) {
  const display = name || "This contact";
  const source = String(c?.source || "").split("/").pop();
  const relPct = Math.round(clamp01(relevance) * 100);

  const parts = [];
  parts.push(`${display} surfaced from your ${source || "network"} for "${query}".`);
  if (relPct >= 60) parts.push(`Strong semantic match (${relPct}% relevance).`);
  else if (relPct >= 30) parts.push(`Moderate match (${relPct}% relevance).`);
  else parts.push(`Weak match (${relPct}% relevance).`);

  const blurb = String(profileText || "").trim();
  if (blurb) {
    const snippet = blurb.split(/\s+/).slice(0, 18).join(" ");
    parts.push(`Profile: ${snippet}.`);
  }
  if (band && band !== "high") parts.push(`Confidence ${band}.`);

  let text = scrubAiTells(parts.join(" "));
  const { ok } = validateRationale(text);
  if (!ok) {
    text = scrubAiTells(`${display} matched "${query}" at ${relPct}% relevance.`);
  }
  return text;
}

/**
 * Rank caller-network candidates against the query.
 * candidates: [{ score, name, source, handle, external_id, text }]
 * returns ordered [{ id, name, score, confidence, confidence_band,
 *                    rationale, signals, source }]
 */
export function rankCandidates(query, candidates) {
  const ranked = (candidates || []).map((c) => {
    const relevance = clamp01(c?.score);
    const profileText = c?.text || "";
    const name = c?.name || "Unknown";

    const tc = textCompleteness(profileText);
    const sc = structuredCoverage(c);
    const gs = graphSignal(c);
    const conf = computeConfidence(tc, sc, gs);
    const { band } = confidenceLabel(conf, tc, sc, gs);

    return {
      id: c?.external_id || c?.handle || name,
      name,
      score: computeScore(c?.score, c),
      confidence: Math.round(conf * 10000) / 10000,
      confidence_band: band,
      rationale: generateRationale(query, name, c?.score, c, profileText, band),
      signals: extractSignals(relevance, profileText, c, band),
      source: c?.source ?? null,
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
