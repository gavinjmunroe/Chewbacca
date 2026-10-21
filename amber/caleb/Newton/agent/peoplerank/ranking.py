"""
ranking.py — PeopleRank query-ranking scorer (ported from the CTO's
togari-search PeopleRank engine, adapted from PAIRWISE event-matching to
single-candidate QUERY relevance).

This is the PeopleRank consumer feature for Medha: rank the authenticated
caller's unified network (the Medha+Pinecone "Connection Graph") against a
natural-language query. The live request path is the in-process Node ranker
(consumer/peoplerank-proxy.js); THIS module is the faithful Python reference
implementation of the pure scoring logic, with a test suite, so the algorithm
the JS mirrors is verified independently.

What was ported faithfully from togari-search (READ-ONLY source repo
amber-organization/togari-search, api/scoring.py + src/peoplerank/score.py):

  • The per-prediction CONFIDENCE model — compute_confidence /
    confidence_label / CONFIDENCE_WEIGHTS / CONFIDENCE_BANDS — byte-for-byte
    in its math. In the original each component was computed for a PAIR;
    here the three components are derived for a single candidate against the
    query (text completeness of the candidate, structured coverage of the
    candidate's fields, graph signal from the candidate's source/handle).

  • extract_signals — same "dimension:value" / "confidence:band" shape and
    the same 6-signal cap, fed from the query-relevance dimensions.

What is deliberately NOT ported (out of scope per the task):

  • The pairwise pipeline (score_people_openai, score_event*, combinations
    over attendees) — that is the event-matching path.
  • sklearn TF-IDF / OpenAI embeddings — relevance comes from Pinecone's
    own semantic score, so no second embedding backend is needed.
  • The /v1/match/community-event grouping/event endpoint.

The CTO's original confidence weights and band thresholds are preserved as
the single source of truth for both this module and the JS ranker.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Confidence model — ported verbatim from togari-search src/peoplerank/score.py
# (CONFIDENCE_WEIGHTS, CONFIDENCE_BANDS, compute_confidence, confidence_label).
# The weights/thresholds are the CTO's; do not retune without sign-off.
# ---------------------------------------------------------------------------

CONFIDENCE_WEIGHTS = {
    "text_completeness": 0.50,
    "structured_coverage": 0.30,
    "graph_signal": 0.20,
}

CONFIDENCE_BANDS = (
    (0.70, "high"),
    (0.40, "medium"),
    (0.00, "low"),
)


def compute_confidence(
    text_completeness: float,
    structured_coverage: float,
    graph_signal: float,
) -> float:
    return (
        CONFIDENCE_WEIGHTS["text_completeness"] * text_completeness
        + CONFIDENCE_WEIGHTS["structured_coverage"] * structured_coverage
        + CONFIDENCE_WEIGHTS["graph_signal"] * graph_signal
    )


def confidence_label(
    conf: float,
    text_completeness: float,
    structured_coverage: float,
    graph_signal: float,
) -> Tuple[str, str]:
    """Return (band, reason). Reason is empty string for high-confidence.

    Ported from score.py.confidence_label — same band logic, same
    "name the weakest component" reason.
    """
    band = "low"
    for threshold, name in CONFIDENCE_BANDS:
        if conf >= threshold:
            band = name
            break

    if band == "high":
        return band, ""

    components = {
        "text": text_completeness,
        "structured data": structured_coverage,
        "graph": graph_signal,
    }
    weakest_name = min(components, key=components.get)
    reason = f"{weakest_name} coverage weak ({components[weakest_name]:.2f})"
    return band, reason


# ---------------------------------------------------------------------------
# Candidate signals — adapted from togari-search src/peoplerank/score.py.
# Original used a 100-word saturation for density and a 20-word completeness
# threshold; both preserved here, applied to the candidate's profile blob.
# ---------------------------------------------------------------------------

_DENSITY_WORD_CAP = 100  # words at which text density saturates to 1.0 (ported)
TEXT_COMPLETENESS_WORD_THRESHOLD = 20  # ported from score.py


def _word_count(text: str) -> int:
    if not text:
        return 0
    return len(text.strip().split())


def text_completeness(profile_text: str) -> float:
    """Density of the candidate's profile blob, in [0, 1].

    Adapted from score._text_completeness: the original averaged the fraction
    of populated text vectors across a PAIR. For a single candidate we use the
    word-count density of the one profile blob Medha embeds at ingest, capped
    at the same 100-word saturation the CTO used.
    """
    return min(_word_count(profile_text) / float(_DENSITY_WORD_CAP), 1.0)


# Sources that carry a real social graph edge (vs. a flat address book).
# LinkedIn / GitHub / Twitter are network sources; apple/google contacts are
# address books. Mirrors the spirit of score._graph_signal (pre-event
# connection => stronger signal).
_GRAPH_SOURCES = ("linkedin", "github", "twitter", "x")


def structured_coverage(candidate: Dict) -> float:
    """Fraction of the candidate's structured fields that are populated.

    Adapted from score._structured_coverage (which counted struct features
    that used real data). Our structured fields for a network person are:
    name, source, handle, external_id.
    """
    fields = ("name", "source", "handle", "external_id")
    present = sum(1 for f in fields if (candidate.get(f) or "").strip())
    return present / float(len(fields))


def graph_signal(candidate: Dict) -> float:
    """1.0 if the person comes from a true graph source AND has a handle,
    0.5 if one of those holds, 0.0 otherwise.

    Adapted from score._graph_signal (1.0 both / 0.5 one / 0.0 neither).
    """
    source = (candidate.get("source") or "").lower()
    from_graph = any(s in source for s in _GRAPH_SOURCES)
    has_handle = bool((candidate.get("handle") or "").strip())
    if from_graph and has_handle:
        return 1.0
    if from_graph or has_handle:
        return 0.5
    return 0.0


def extract_signals(
    relevance: float,
    profile_text: str,
    candidate: Dict,
    confidence_band: str,
) -> List[str]:
    """Short human-readable signals list. Ported shape from
    scoring.extract_signals: "dimension:value" entries plus a confidence
    band, capped at 6.
    """
    signals: List[str] = []
    if relevance >= 0.35:
        signals.append(f"relevance:{relevance:.2f}")
    tc = text_completeness(profile_text)
    if tc >= 0.35:
        signals.append(f"profile_depth:{tc:.2f}")
    gs = graph_signal(candidate)
    if gs >= 0.5:
        signals.append(f"graph:{gs:.2f}")
    source = (candidate.get("source") or "").strip()
    if source:
        short = source.split("/")[-1] if "/" in source else source
        signals.append(f"source:{short}")
    if confidence_band:
        signals.append(f"confidence:{confidence_band}")
    return signals[:6]


# ---------------------------------------------------------------------------
# Final ranking score.
#
# The original final score was readiness * compatibility * trust * boost. For
# query relevance there is no second person, so "compatibility" becomes the
# Pinecone relevance and "readiness/trust" become how well-formed and
# graph-anchored the candidate is. We keep the original's multiplicative
# structure (a candidate that is irrelevant OR has no profile signal scores
# near zero) and the original's 0-100 output scale.
# ---------------------------------------------------------------------------

RELEVANCE_WEIGHT = 0.70   # mirrors COMPATIBILITY_MIX["vec_sim"] emphasis
QUALITY_WEIGHT = 0.30     # the structured/graph quality of the record


def compute_score(relevance: float, candidate: Dict, profile_text: str) -> float:
    """Combine Pinecone relevance with record quality into a 0-100 score.

    relevance: Pinecone semantic score in [0, 1] (clamped).
    """
    rel = max(0.0, min(1.0, float(relevance) if relevance is not None else 0.0))
    quality = 0.5 * structured_coverage(candidate) + 0.5 * graph_signal(candidate)
    combined = RELEVANCE_WEIGHT * rel + QUALITY_WEIGHT * quality
    return round(combined * 100.0, 2)


# ---------------------------------------------------------------------------
# Rationale validators + scrubber — ported VERBATIM from togari-search
# api/rationale.py. These are pure (no LLM) and are applied to every rationale
# we surface, whether produced deterministically or by an LLM later.
# ---------------------------------------------------------------------------

BANNED_SUBSTRINGS = [
    "in a world where", "dynamic blend", "perfect match",
    "rich tapestry", "here is why", "this match stands out",
    "what makes this special", "could be potentially", "seems to likely",
]

BANNED_PATTERNS = [
    (r"\bnot just\b[^.!?]*\bbut\b", "not_just_but"),
    (r"\bmight be\b", "might_be"),
    (r"\bcould be\b", "could_be"),
    (r"\bpotentially\b", "potentially"),
    (r"\bseems to\b", "seems_to"),
    (r"\bleverage\b", "leverage"),
    (r"\bleveraging\b", "leveraging"),
    (r"\balign with\b", "align_with"),
    (r"\baligned with\b", "aligned_with"),
    (r"\balignment with\b", "alignment_with"),
    (r"\bembrace\b", "embrace"),
    (r"\bembraces\b", "embraces"),
    (r"\bembracing\b", "embracing"),
    (r"\bshared passion for\b", "shared_passion_for"),
    (r"\bunique opportunity\b", "unique_opportunity"),
]


def _split_sentences(text: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p for p in parts if p.strip()]


def validate_rationale(text: str) -> Tuple[bool, str]:
    """Return (ok, reason). Ported from rationale.validate_rationale, minus
    the person-name check (query-ranking rationales DO name the person, since
    the result row already exposes the name — naming them is not a leak)."""
    if not text or not text.strip():
        return False, "empty"
    if len(text) > 800:
        return False, f"too_long:{len(text)}"
    if "—" in text:
        return False, "em_dash"
    if re.search(r"\S\s*–\s*\S", text):
        return False, "en_dash_between_words"
    if " -- " in text:
        return False, "double_dash"
    sentences = _split_sentences(text)
    if not (1 <= len(sentences) <= 7):
        return False, f"sentence_count:{len(sentences)}"
    lower = text.lower()
    for sub in BANNED_SUBSTRINGS:
        if sub in lower:
            return False, f"banned_sub:{sub}"
    for pattern, reason in BANNED_PATTERNS:
        if re.search(pattern, lower):
            return False, f"banned_pat:{reason}"
    return True, "ok"


def scrub_ai_tells(text: str) -> str:
    """Strip em-dashes, smart quotes, and common AI writing tells.
    Ported verbatim from rationale.scrub_ai_tells."""
    if not text:
        return text
    text = text.replace("“", '"').replace("”", '"')
    text = text.replace("‘", "'").replace("’", "'")
    text = text.replace("—", ", ").replace("–", ", ")
    text = re.sub(r"\s--\s", ", ", text)
    text = re.sub(r"(?<=\w)--(?=\w)", ", ", text)
    ai_phrases = [
        r"\bIt's worth noting that\s*",
        r"\bThat said,?\s*",
        r"\bMoreover,?\s*",
        r"\bFurthermore,?\s*",
        r"\bIn essence,?\s*",
        r"\bUltimately,?\s*",
        r"\bAt the end of the day,?\s*",
    ]
    for pat in ai_phrases:
        text = re.sub(pat, "", text, flags=re.IGNORECASE)
    text = re.sub(r",\s*,", ",", text)
    text = re.sub(r"\s+,", ",", text)
    text = re.sub(r"\s+\.", ".", text)
    text = re.sub(r"\s{2,}", " ", text)
    text = text.strip()
    if text and text[0].islower():
        text = text[0].upper() + text[1:]
    return text


# ---------------------------------------------------------------------------
# Deterministic rationale — built from the signals + score, then run through
# the ported validators/scrubber. No per-request LLM call: fast, cheap, and
# always populated. (An LLM rationale could be slotted in later behind the
# same validate_rationale gate.)
# ---------------------------------------------------------------------------

def generate_rationale(
    query: str,
    name: str,
    relevance: float,
    candidate: Dict,
    profile_text: str,
    confidence_band: str,
) -> str:
    """Compose a short, validator-clean rationale for why this person ranks
    for the query."""
    display = name or "This contact"
    source = (candidate.get("source") or "").split("/")[-1]
    rel_pct = int(round(max(0.0, min(1.0, relevance or 0.0)) * 100))

    parts: List[str] = []
    parts.append(
        f"{display} surfaced from your {source or 'network'} for \"{query}\"."
    )
    if rel_pct >= 60:
        parts.append(f"Strong semantic match ({rel_pct}% relevance).")
    elif rel_pct >= 30:
        parts.append(f"Moderate match ({rel_pct}% relevance).")
    else:
        parts.append(f"Weak match ({rel_pct}% relevance).")

    blurb = (profile_text or "").strip()
    if blurb:
        snippet = " ".join(blurb.split()[:18])
        parts.append(f"Profile: {snippet}.")

    if confidence_band and confidence_band != "high":
        parts.append(f"Confidence {confidence_band}.")

    text = scrub_ai_tells(" ".join(parts))
    ok, _reason = validate_rationale(text)
    if not ok:
        # Fall back to a minimal, guaranteed-clean line.
        text = scrub_ai_tells(
            f"{display} matched \"{query}\" at {rel_pct}% relevance."
        )
    return text


# ---------------------------------------------------------------------------
# Top-level ranker.
# ---------------------------------------------------------------------------

def rank_candidates(query: str, candidates: List[Dict]) -> List[Dict]:
    """Rank caller-network candidates against the query.

    candidates: list of dicts shaped like the JS search_contacts matches:
        { score, name, source, handle, external_id, text }
    Returns an ordered list of:
        { id, name, score, confidence, rationale, signals, source }
    """
    ranked: List[Dict] = []
    for c in candidates:
        relevance = c.get("score")
        profile_text = c.get("text") or ""
        name = c.get("name") or "Unknown"

        tc = text_completeness(profile_text)
        sc = structured_coverage(c)
        gs = graph_signal(c)
        conf = compute_confidence(tc, sc, gs)
        band, _reason = confidence_label(conf, tc, sc, gs)

        score = compute_score(relevance, c, profile_text)
        signals = extract_signals(
            max(0.0, min(1.0, float(relevance) if relevance is not None else 0.0)),
            profile_text,
            c,
            band,
        )
        rationale = generate_rationale(
            query, name, relevance, c, profile_text, band
        )

        ident = c.get("external_id") or c.get("handle") or name
        ranked.append({
            "id": ident,
            "name": name,
            "score": score,
            "confidence": round(conf, 4),
            "confidence_band": band,
            "rationale": rationale,
            "signals": signals,
            "source": c.get("source"),
        })

    ranked.sort(key=lambda r: r["score"], reverse=True)
    return ranked
