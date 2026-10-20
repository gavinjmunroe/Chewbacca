#!/usr/bin/env python3
"""
PeopleRank v2 — Schema-Agnostic Compatibility Scorer

Scores compatibility between people from any source. The algorithm operates
on normalized Person objects produced by the ingestion layer.

Usage:
    python score.py <event_export.json>                      # full scoring
    python score.py <event_export.json> --blind              # profile-only
    python score.py <event_export.json> --blind --validate   # profile + truth check
    python score.py data/                                    # score all JSONs in dir
    python score.py <event_export.json> --top 5              # top N connections
    python score.py <event_export.json> --json               # machine-readable JSON
    python score.py <event_export.json> --out results.txt    # write to file

Dependencies: pip install scikit-learn numpy

Algorithm:
    1. Readiness Score S(A) per person (0-100)
    2. Pairwise text similarity via TF-IDF + cosine on 4 vectors
    3. Structured similarity (age, city, type, connections, etc.)
    4. Final = readiness_modifier * compatibility * trust * boost * 100
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
from typing import List, Optional

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .ingestion import Person, ingest, blind8_adapter, _strip_post_event
from .embeddings import TFIDFBackend, OpenAIBackend
from .complementarity import complementarity, DEFAULT_COMPLEMENTARITY

# ---------------------------------------------------------------------------
# Constants  (algorithm unchanged)
# ---------------------------------------------------------------------------

BRAVERY_KEYWORDS = [
    "strangers", "spontaneous", "random", "new people", "mission",
    "yes man", "walked up", "brave", "unknown", "adventure",
    "uncomfortable", "outside my comfort", "out of my comfort",
    "never done", "first time", "leap of faith",
]

READINESS_WEIGHTS = {
    "bravery": 0.20,
    "attendance": 0.25,
    "feedback_engagement": 0.25,
    "qualification": 0.20,
    "hangout_flag": 0.10,
}

TEXT_VECTOR_WEIGHTS = {
    "identity": 0.25,
    "personality": 0.25,
    "experience": 0.25,
    "interest": 0.25,
}

STRUCT_WEIGHTS = {
    "age_proximity": 0.10,
    "same_city": 0.15,
    "complementary_type": 0.10,
    "shared_event_count": 0.20,
    "connection_exists": 0.15,
    "referral_chain": 0.10,
    "qualification_proximity": 0.10,
    "readiness_harmony": 0.10,
}

COMPATIBILITY_MIX = {"vec_sim": 0.70, "struct_sim": 0.30}

SAME_EVENT_BOOST = 1.30

TRUST_LEVELS = {
    "mutual_pick": 0.95,
    "unidirectional_pick": 0.50,
    "friends": 0.90,
    "referred_by": 0.80,
    "knows": 0.40,
    "co_attended": 0.35,
    "floor": 0.15,
}

# Stop words for theme extraction (augments sklearn's set)
_EXTRA_STOPS = frozenset(
    "about them joined style notes assessment answers application "
    "observer best moments one word improvements passions next big event "
    "occupation city age guest type gender screener social why "
    "also really like just people person someone something things "
    "want would could going know think feel lot got get new".split()
)

W = 62  # report column width


# ---------------------------------------------------------------------------
# Data Structures
# ---------------------------------------------------------------------------


@dataclass
class PairResult:
    person_a: Person
    person_b: Person
    vec_sim: float = 0.0
    struct_sim: float = 0.0
    compatibility: float = 0.0
    trust: float = 0.0
    readiness_modifier: float = 0.0
    final_score: float = 0.0
    trust_reason: str = ""
    sim_identity: float = 0.0
    sim_personality: float = 0.0
    sim_experience: float = 0.0
    sim_interest: float = 0.0
    struct_scores: dict = field(default_factory=dict)
    # V3 additions — density-weighting and confidence
    per_dim_density: dict = field(default_factory=dict)   # {vector: density_0_to_1}
    struct_coverage: dict = field(default_factory=dict)   # {feature: fired_bool}
    text_completeness: float = 0.0
    structured_coverage: float = 0.0
    graph_signal: float = 0.0
    confidence: float = 0.0
    confidence_band: str = ""        # "high" | "medium" | "low"
    confidence_reason: str = ""      # short annotation (empty for high)


# ---------------------------------------------------------------------------
# Step 1 — Readiness Score  (operates on Person)
# ---------------------------------------------------------------------------


def compute_bravery(person: Person) -> float:
    # Prefer the isolated bravery_text (ONLY the socialBravery field).
    # Falls back to personality_text for adapters that don't populate it.
    source = getattr(person, "bravery_text", "") or person.personality_text
    text = (source or "").lower().strip()
    if not text:
        return 0.0
    word_count = len(text.split())
    richness = min(word_count / 80.0, 1.0)
    keyword_hits = sum(1 for kw in BRAVERY_KEYWORDS if kw in text)
    density = min(keyword_hits / 4.0, 1.0)
    return 0.5 * richness + 0.5 * density


def compute_readiness(person: Person) -> float:
    bravery = compute_bravery(person)
    attendance = person.attendance_ratio
    feedback_engagement = person.feedback_ratio
    if person.qualification_score is not None:
        qual = max(0.0, min(1.0, (person.qualification_score - 50.0) / 50.0))
    else:
        qual = 0.5
    hangout = 1.0 if person.hangout_flag else 0.0
    raw = (
        READINESS_WEIGHTS["bravery"] * bravery
        + READINESS_WEIGHTS["attendance"] * attendance
        + READINESS_WEIGHTS["feedback_engagement"] * feedback_engagement
        + READINESS_WEIGHTS["qualification"] * qual
        + READINESS_WEIGHTS["hangout_flag"] * hangout
    )
    return round(raw * 100.0, 2)


# ---------------------------------------------------------------------------
# Step 2 — TF-IDF  (operates on Person)
# ---------------------------------------------------------------------------


def _clean(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"\b(None|null|N/A|n/a|undefined)\b", "", text)
    return re.sub(r"\s+", " ", cleaned).strip()


def build_text_vectors(person: Person) -> dict[str, str]:
    return {
        "identity": _clean(person.identity_text),
        "personality": _clean(person.personality_text),
        "experience": _clean(person.experience_text),
        "interest": _clean(person.interest_text),
    }


def compute_tfidf_similarity(
    people: List[Person],
    person_ids: list[str],
    backend=None,
) -> dict[str, np.ndarray]:
    """
    Compute per-vector cosine similarity matrices using the given backend.

    Kept name 'compute_tfidf_similarity' for backward compatibility; accepts
    any backend exposing embed_batch(texts) -> (n, dim) matrix.
    """
    if backend is None:
        backend = TFIDFBackend()

    people_by_id = {p.id: p for p in people}
    text_map = {pid: build_text_vectors(people_by_id[pid]) for pid in person_ids}
    sim_matrices: dict[str, np.ndarray] = {}
    n = len(person_ids)

    for tt in ["identity", "personality", "experience", "interest"]:
        docs = [text_map[pid][tt] for pid in person_ids]
        non_empty = [d for d in docs if d.strip()]
        if len(non_empty) < 2:
            sim_matrices[tt] = np.zeros((n, n))
            continue
        try:
            emb = backend.embed_batch(docs)
            sim_matrices[tt] = cosine_similarity(emb)
        except ValueError:
            sim_matrices[tt] = np.zeros((n, n))

    return sim_matrices


# ---------------------------------------------------------------------------
# IMPROVEMENT 1 — Density-weighted vector contribution
# ---------------------------------------------------------------------------
#
# Rationale: a cosine similarity of 0.6 computed between two 8-word blurbs is
# nowhere near as trustworthy as a 0.6 between two 80-word descriptions. The
# previous algorithm applied full TEXT_VECTOR_WEIGHTS regardless of how much
# text each person had written, which let sparse pairs inflate/deflate the
# score based on what was effectively noise.
#
# Fix: for each vector V and each pair (A, B), compute
#     density_V = min(words_A_V, words_B_V) / 100,  capped at 1.0
# The "min" is the bottleneck — the pair is only as dense as the thinner side.
# Then rescale:
#     effective_weight_V = base_weight_V * density_V
#     weight_V            = effective_weight_V / sum(effective_weights)
# This subsumes the old "experience_missing" special case: a vector where
# either person wrote nothing has density 0, so its weight vanishes and the
# remaining weights renormalise automatically.
#
# The per-vector density is stored on the pair record so the confidence and
# Why-explanation modules can both consume it.

_DENSITY_WORD_CAP = 100  # words at which density saturates to 1.0


def _word_count(text: str) -> int:
    if not text:
        return 0
    return len(text.strip().split())


def compute_pair_density(person_a: Person, person_b: Person) -> dict[str, float]:
    """
    Per-vector density for this pair. density_V = min(words_A, words_B)/100,
    capped at 1.0. Density 0 = at least one side wrote nothing for that vector.
    """
    texts_a = build_text_vectors(person_a)
    texts_b = build_text_vectors(person_b)
    out: dict[str, float] = {}
    for tt in TEXT_VECTOR_WEIGHTS:
        wa = _word_count(texts_a.get(tt, ""))
        wb = _word_count(texts_b.get(tt, ""))
        out[tt] = min(min(wa, wb) / float(_DENSITY_WORD_CAP), 1.0)
    return out


def compute_vec_sim(
    sim_matrices,
    i,
    j,
    person_a: Person,
    person_b: Person,
) -> tuple[float, dict[str, float], dict[str, float]]:
    """
    Density-weighted vector compatibility.

    Returns (total, per_dim_sim, per_dim_density).
    """
    per_dim_density = compute_pair_density(person_a, person_b)

    per_dim: dict[str, float] = {}
    eff_weights: dict[str, float] = {}
    for tt, base_w in TEXT_VECTOR_WEIGHTS.items():
        if tt in sim_matrices:
            sv = max(0.0, float(sim_matrices[tt][i, j]))
        else:
            sv = 0.0
        per_dim[tt] = sv
        eff_weights[tt] = base_w * per_dim_density[tt]

    total_eff = sum(eff_weights.values())
    if total_eff <= 0.0:
        # No vector has signal on both sides — honest zero.
        return 0.0, per_dim, per_dim_density

    total = 0.0
    for tt in TEXT_VECTOR_WEIGHTS:
        w = eff_weights[tt] / total_eff
        total += w * per_dim[tt]
    return total, per_dim, per_dim_density


# ---------------------------------------------------------------------------
# Step 3 — Structured Similarity  (operates on Person)
# ---------------------------------------------------------------------------


def _has_connection(person_a: Person, person_b: Person) -> bool:
    """Check if there's any connection between two people."""
    for c in person_a.connections:
        if c["to_id"] == person_b.id and c["type"] in ("friends", "referred_by", "knows"):
            return True
    return False


def _get_connection_type(person_a: Person, person_b: Person) -> str:
    """Get the strongest connection type between two people."""
    priority = {"friends": 4, "referred_by": 3, "knows": 2}
    best_type = ""
    best_priority = 0
    for c in person_a.connections:
        if c["to_id"] == person_b.id:
            p = priority.get(c["type"], 0)
            if p > best_priority:
                best_priority = p
                best_type = c["type"]
    for c in person_b.connections:
        if c["to_id"] == person_a.id:
            p = priority.get(c["type"], 0)
            if p > best_priority:
                best_priority = p
                best_type = c["type"]
    return best_type


def compute_struct_sim(
    person_a: Person,
    person_b: Person,
) -> tuple[float, dict[str, float], dict[str, bool]]:
    """
    Structured similarity + coverage flags.

    Returns (total, scores, coverage) where coverage[k] is True iff feature k
    was computed from real data (not a default fallback). `complementary_type`
    now uses the 3x3 learned matrix in complementarity.py instead of a binary
    same/different check.
    """
    scores: dict[str, float] = {}
    coverage: dict[str, bool] = {}

    if person_a.age is not None and person_b.age is not None:
        scores["age_proximity"] = max(0.0, 1.0 - abs(person_a.age - person_b.age) / 40.0)
        coverage["age_proximity"] = True
    else:
        scores["age_proximity"] = 0.5
        coverage["age_proximity"] = False

    if person_a.city and person_b.city:
        scores["same_city"] = 1.0 if person_a.city.strip().lower() == person_b.city.strip().lower() else 0.0
        coverage["same_city"] = True
    else:
        scores["same_city"] = 0.0
        coverage["same_city"] = False

    # IMPROVEMENT 3 — guest-type complementarity matrix.
    # Instead of a binary same/different check, look up a 3x3 score grounded in
    # dinner-seat conversation dynamics (see complementarity.py).
    if person_a.role_type and person_b.role_type:
        scores["complementary_type"] = complementarity(person_a.role_type, person_b.role_type)
        coverage["complementary_type"] = True
    else:
        scores["complementary_type"] = DEFAULT_COMPLEMENTARITY
        coverage["complementary_type"] = False

    # Both attended = shared event
    both_attended = person_a.attendance_ratio >= 1.0 and person_b.attendance_ratio >= 1.0
    shared_events = 1 if both_attended else 0
    scores["shared_event_count"] = min(shared_events / 3.0, 1.0)
    coverage["shared_event_count"] = True

    scores["connection_exists"] = 1.0 if _has_connection(person_a, person_b) else 0.0
    coverage["connection_exists"] = True

    ctype = _get_connection_type(person_a, person_b)
    scores["referral_chain"] = 1.0 if ctype == "referred_by" else 0.0
    coverage["referral_chain"] = True

    qa = person_a.qualification_score if person_a.qualification_score is not None else 50.0
    qb = person_b.qualification_score if person_b.qualification_score is not None else 50.0
    scores["qualification_proximity"] = 1.0 - abs(qa - qb) / 100.0
    coverage["qualification_proximity"] = (
        person_a.qualification_score is not None
        and person_b.qualification_score is not None
    )

    scores["readiness_harmony"] = 1.0 - abs(person_a.readiness_score - person_b.readiness_score) / 100.0
    coverage["readiness_harmony"] = True

    total = sum(STRUCT_WEIGHTS[k] * scores[k] for k in STRUCT_WEIGHTS)
    return total, scores, coverage


# ---------------------------------------------------------------------------
# IMPROVEMENT 2 — Per-prediction confidence
# ---------------------------------------------------------------------------
#
# Every score is really two claims: a point estimate AND how much we trust it.
# A pair with dense text, full structured data, and graph connections is a
# qualitatively different prediction from a pair where one person barely wrote
# anything and there is no social graph signal. The previous algorithm exposed
# only the point estimate.
#
# We report confidence as a number in [0, 1] and a band (high/medium/low). The
# three components reflect the three input sources the algorithm leans on:
#
#   text_completeness   — fraction of text vectors with real content (>20 words)
#                         averaged across both people.
#   structured_coverage — fraction of 8 struct features that used real data
#                         (not a default fallback).
#   graph_signal        — 1.0 if both have pre-event connections, 0.5 if one,
#                         0.0 if neither. (Affinity picks are post-event and
#                         don't count.)
#
# Weights 0.50 / 0.30 / 0.20 reflect that free-text is the richest but noisiest
# signal; structured fields are cleaner but carry less information; graph is
# binary and rarely discriminating on a 9-person dinner.

TEXT_COMPLETENESS_WORD_THRESHOLD = 20

CONFIDENCE_WEIGHTS = {
    "text_completeness":   0.50,
    "structured_coverage": 0.30,
    "graph_signal":        0.20,
}

CONFIDENCE_BANDS = (
    (0.70, "high"),
    (0.40, "medium"),
    (0.00, "low"),
)

_PRE_EVENT_CONN_TYPES = frozenset({"friends", "referred_by", "knows"})


def _text_completeness(person_a: Person, person_b: Person) -> float:
    def person_frac(p: Person) -> float:
        texts = build_text_vectors(p)
        hits = sum(
            1 for t in texts.values()
            if _word_count(t) > TEXT_COMPLETENESS_WORD_THRESHOLD
        )
        return hits / float(len(TEXT_VECTOR_WEIGHTS))
    return (person_frac(person_a) + person_frac(person_b)) / 2.0


def _structured_coverage(coverage: dict[str, bool]) -> float:
    if not coverage:
        return 0.0
    return sum(1 for v in coverage.values() if v) / float(len(coverage))


def _graph_signal(person_a: Person, person_b: Person) -> float:
    def has_external(p: Person) -> bool:
        return any(c.get("type") in _PRE_EVENT_CONN_TYPES for c in p.connections)
    a, b = has_external(person_a), has_external(person_b)
    if a and b:
        return 1.0
    if a or b:
        return 0.5
    return 0.0


def compute_confidence(
    text_completeness: float,
    structured_coverage: float,
    graph_signal: float,
) -> float:
    return (
        CONFIDENCE_WEIGHTS["text_completeness"]   * text_completeness
        + CONFIDENCE_WEIGHTS["structured_coverage"] * structured_coverage
        + CONFIDENCE_WEIGHTS["graph_signal"]        * graph_signal
    )


def confidence_label(
    conf: float,
    text_completeness: float,
    structured_coverage: float,
    graph_signal: float,
) -> tuple[str, str]:
    """Return (band, reason). Reason is empty string for high-confidence."""
    band = "low"
    for threshold, name in CONFIDENCE_BANDS:
        if conf >= threshold:
            band = name
            break

    if band == "high":
        return band, ""

    # For medium/low, name the weakest component.
    components = {
        "text": text_completeness,
        "structured data": structured_coverage,
        "graph": graph_signal,
    }
    weakest_name = min(components, key=components.get)
    reason = f"{weakest_name} coverage weak ({components[weakest_name]:.2f})"
    return band, reason


# ---------------------------------------------------------------------------
# Step 4 — Trust & Final Score  (operates on Person connections)
# ---------------------------------------------------------------------------


def _has_affinity_pick(person_from: Person, person_to: Person) -> bool:
    """Check if person_from picked person_to (via affinity or spendTime)."""
    for c in person_from.connections:
        if c["to_id"] == person_to.id and c["type"] in ("affinity", "spend_time_pick"):
            return True
    return False


def compute_trust(person_a: Person, person_b: Person) -> tuple[float, str]:
    a_picked_b = _has_affinity_pick(person_a, person_b)
    b_picked_a = _has_affinity_pick(person_b, person_a)

    if a_picked_b and b_picked_a:
        return TRUST_LEVELS["mutual_pick"], "Mutual pick from this dinner"

    ctype = _get_connection_type(person_a, person_b)
    if ctype == "friends":
        return TRUST_LEVELS["friends"], "Already friends"
    if ctype == "referred_by":
        return TRUST_LEVELS["referred_by"], "Referral connection"

    if a_picked_b or b_picked_a:
        picker = person_a.display_name if a_picked_b else person_b.display_name
        return TRUST_LEVELS["unidirectional_pick"], f"One-way pick (by {picker})"

    if ctype == "knows":
        return TRUST_LEVELS["knows"], "Know each other"

    both_attended = person_a.attendance_ratio >= 1.0 and person_b.attendance_ratio >= 1.0
    if both_attended:
        return TRUST_LEVELS["co_attended"], "Co-attended this dinner"

    if _has_connection(person_a, person_b):
        return TRUST_LEVELS["knows"], "Connected"

    return TRUST_LEVELS["floor"], "Both passed screening"


def compute_final_score(vec_sim, struct_sim, trust, readiness_a, readiness_b) -> tuple[float, float, float]:
    compatibility = COMPATIBILITY_MIX["vec_sim"] * vec_sim + COMPATIBILITY_MIX["struct_sim"] * struct_sim
    readiness_modifier = min(readiness_a, readiness_b) / 100.0
    final = readiness_modifier * compatibility * trust * SAME_EVENT_BOOST * 100.0
    return round(final, 2), round(compatibility, 4), round(readiness_modifier, 4)


# ---------------------------------------------------------------------------
# CHANGE 3 — Better "Why" Explanations
# ---------------------------------------------------------------------------


def _tokenize_meaningful(text: str) -> set[str]:
    """Extract meaningful lowercase tokens, stripping stop words."""
    tokens = set(re.findall(r"[a-z]{3,}", text.lower()))
    return tokens - _EXTRA_STOPS


def _tfidf_rank_shared_words(
    text_a: str, text_b: str, all_texts: list[str], max_words: int = 5,
) -> list[str]:
    """
    Find overlapping words between text_a and text_b, ranked by TF-IDF
    importance in the full corpus.
    """
    tokens_a = _tokenize_meaningful(text_a)
    tokens_b = _tokenize_meaningful(text_b)
    shared = tokens_a & tokens_b
    # Remove very generic words
    shared -= {"the", "and", "for", "that", "this", "with", "are", "was", "has",
               "had", "from", "been", "have", "they", "their", "them", "what",
               "when", "where", "which", "will", "more", "some", "very", "much",
               "than", "into", "over", "such", "only", "other", "been", "most",
               "same", "make", "made", "many", "time", "each", "way", "did",
               "love", "great", "good", "really", "being", "doing", "bring",
               "looking", "excited", "enjoy", "dinner"}

    if not shared:
        return []

    # Use TF-IDF to rank importance
    combined_corpus = [t for t in all_texts if t.strip()] + [text_a, text_b]
    if len(combined_corpus) < 2:
        return sorted(shared, key=len, reverse=True)[:max_words]

    try:
        vectorizer = TfidfVectorizer(
            stop_words="english", max_features=5000, min_df=1, sublinear_tf=True,
        )
        vectorizer.fit(combined_corpus)
        vocab = vectorizer.vocabulary_

        scored = []
        for word in shared:
            if word in vocab:
                idx = vocab[word]
                # Average IDF-like importance
                scored.append((word, vectorizer.idf_[idx]))
            else:
                scored.append((word, 0.0))

        scored.sort(key=lambda x: x[1], reverse=True)
        return [w for w, _ in scored[:max_words]]
    except (ValueError, Exception):
        return sorted(shared, key=len, reverse=True)[:max_words]


def generate_why_box(pair: PairResult, all_people: List[Person]) -> list[str]:
    """
    Generate multi-line explanation with improved word overlap analysis.

    1. Find the dominant dimension (highest cosine sim)
    2. Extract top 5 overlapping words from that dimension, ranked by TF-IDF
    3. Generate explanation based on dominant + second dimension
    4. Add trust basis
    """
    a, b = pair.person_a, pair.person_b
    lines: list[str] = []

    # All texts for TF-IDF corpus
    all_texts_by_dim = {
        "identity": [p.identity_text for p in all_people],
        "personality": [p.personality_text for p in all_people],
        "experience": [p.experience_text for p in all_people],
        "interest": [p.interest_text for p in all_people],
    }

    # Determine which vector dimension drove the score most
    dims = {
        "personality": pair.sim_personality,
        "interest": pair.sim_interest,
        "identity": pair.sim_identity,
        "experience": pair.sim_experience,
    }
    sorted_dims = sorted(dims.items(), key=lambda x: x[1], reverse=True)
    top_dim, top_score = sorted_dims[0]
    second_dim, second_score = sorted_dims[1] if len(sorted_dims) > 1 else (None, 0)

    # Get the text for dominant dimension
    dim_text = {
        "identity": (a.identity_text, b.identity_text),
        "personality": (a.personality_text, b.personality_text),
        "experience": (a.experience_text, b.experience_text),
        "interest": (a.interest_text, b.interest_text),
    }

    text_a, text_b = dim_text[top_dim]
    top_words = _tfidf_rank_shared_words(text_a, text_b, all_texts_by_dim[top_dim])

    # Line 1: dominant dimension explanation
    if top_dim == "personality":
        if top_words:
            lines.append(f"Both describe themselves around {', '.join(top_words[:3])}.")
        else:
            lines.append("Similar social energy and openness.")
    elif top_dim == "interest":
        if top_words:
            lines.append(f"Shared interests in {', '.join(top_words[:3])}.")
        else:
            lines.append("Overlapping passions and curiosities.")
    elif top_dim == "experience":
        if top_words:
            lines.append(f"Hosts observed both as {', '.join(top_words[:2])}.")
        else:
            lines.append("Similar event experience patterns.")
    elif top_dim == "identity":
        if top_words:
            lines.append(f"Strong overlap in structured profile data ({', '.join(top_words[:3])}).")
        else:
            lines.append("Strong overlap in structured profile data (age, city, type).")

    # Line 2: secondary signal
    if second_dim and second_score > 0.01:
        sec_text_a, sec_text_b = dim_text[second_dim]
        sec_words = _tfidf_rank_shared_words(sec_text_a, sec_text_b, all_texts_by_dim[second_dim])
        if second_dim == "personality" and sec_words:
            lines.append(f"Also both mention {', '.join(sec_words[:2])}.")
        elif second_dim == "interest" and sec_words:
            lines.append(f"Also shared interest in {', '.join(sec_words[:2])}.")
        elif second_dim == "experience" and sec_words:
            lines.append(f"Hosts noted both as {', '.join(sec_words[:2])}.")

    # Complementary types or structural signal
    ss = pair.struct_scores
    if ss.get("complementary_type", 0) > 0.7 and a.role_type and b.role_type:
        lines.append(f"Complementary types ({a.role_type.capitalize()} + {b.role_type.capitalize()}).")
    elif a.age is not None and b.age is not None and abs(a.age - b.age) <= 3:
        lines.append(f"Similar age ({a.age} and {b.age}).")
    elif _has_connection(a, b):
        lines.append("Already connected through the community.")

    # Trust basis (always last)
    lines.append(f"Trust: {pair.trust_reason}.")

    return lines


def generate_why_oneliner(pair: PairResult, all_people: List[Person]) -> str:
    """Single-line <=60-char Why for the per-person top-3 section."""
    a, b = pair.person_a, pair.person_b
    parts = []

    all_texts_by_dim = {
        "identity": [p.identity_text for p in all_people],
        "personality": [p.personality_text for p in all_people],
        "experience": [p.experience_text for p in all_people],
        "interest": [p.interest_text for p in all_people],
    }

    dims = {
        "personality": pair.sim_personality,
        "interest": pair.sim_interest,
        "identity": pair.sim_identity,
        "experience": pair.sim_experience,
    }
    top_dim = max(dims, key=dims.get)

    dim_text = {
        "identity": (a.identity_text, b.identity_text),
        "personality": (a.personality_text, b.personality_text),
        "experience": (a.experience_text, b.experience_text),
        "interest": (a.interest_text, b.interest_text),
    }

    text_a, text_b = dim_text[top_dim]
    top_words = _tfidf_rank_shared_words(text_a, text_b, all_texts_by_dim[top_dim], max_words=3)

    if top_dim == "personality":
        if top_words:
            parts.append(f"shared {', '.join(top_words[:2])}")
        else:
            parts.append("similar social energy")
    elif top_dim == "interest":
        if top_words:
            parts.append(f"shared interest in {', '.join(top_words[:2])}")
        else:
            parts.append("overlapping interests")
    elif top_dim == "identity":
        if a.city and b.city and a.city.strip().lower() == b.city.strip().lower():
            parts.append(f"both in {a.city}")
        elif top_words:
            parts.append(f"similar {', '.join(top_words[:2])}")
        else:
            parts.append("similar background")
    elif top_dim == "experience":
        if top_words:
            parts.append(f"both noted as {', '.join(top_words[:2])}")
        else:
            parts.append("shared event experience")

    ss = pair.struct_scores
    if ss.get("complementary_type", 0) > 0.7 and a.role_type and b.role_type:
        parts.append(f"{a.role_type} + {b.role_type}")
    elif a.age is not None and b.age is not None and abs(a.age - b.age) <= 3:
        parts.append("similar age")

    result = ", ".join(parts).capitalize()
    if len(result) > 60:
        result = result[:59].rstrip("., ") + "\u2026"
    return result


# ---------------------------------------------------------------------------
# Adaptive score legend
# ---------------------------------------------------------------------------


def compute_score_thresholds(scores: list[float]) -> dict[str, tuple[float, str]]:
    if not scores:
        return {"Strong": (25, "high confidence"), "Good": (15, "shared interests"),
                "Moderate": (8, "some overlap"), "Weak": (0, "limited signal")}
    arr = sorted(scores)
    p75 = float(np.percentile(arr, 75))
    p50 = float(np.percentile(arr, 50))
    p25 = float(np.percentile(arr, 25))
    return {
        "Strong": (p75, "high confidence these two would connect"),
        "Good": (p50, "shared interests or complementary profiles"),
        "Moderate": (p25, "some overlap but not a standout pairing"),
        "Weak": (0, "limited signal for connection"),
    }


# ---------------------------------------------------------------------------
# Output Formatting
# ---------------------------------------------------------------------------


def _pad(text: str, width: int) -> str:
    return text + " " * max(0, width - len(text))


def _center(text: str, width: int) -> str:
    return text.center(width)


def format_report(
    event_info: dict,
    people: List[Person],
    results: list[PairResult],
    *,
    top_n: Optional[int] = None,
    blind: bool = False,
    backend_label: str = "tfidf (local, no API)",
) -> str:
    """Produce the full human-readable report."""
    L: list[str] = []
    event_name = event_info.get("name", "Compatibility Report")
    event_date = event_info.get("date", "")
    event_city = event_info.get("city", "")
    venue = event_info.get("venue", "")
    location_line = " \u00b7 ".join(p for p in [event_date, venue, event_city] if p)

    total_people = len(people)
    total_pairs = len(results)
    mode_str = "BLIND (profile data only \u2014 no post-event feedback)" if blind else "FULL (includes post-event data)"

    inner = W - 4
    L.append("\u2554" + "\u2550" * (W - 2) + "\u2557")
    L.append("\u2551  " + _pad(f"PEOPLERANK v2 \u2014 {event_name}", inner) + "\u2551")
    if location_line:
        L.append("\u2551  " + _pad(location_line, inner) + "\u2551")
    L.append("\u2551  " + _pad(f"{total_people} people \u00b7 {total_pairs} pairs scored", inner) + "\u2551")
    L.append("\u2551  " + _pad(f"Mode: {mode_str}", inner) + "\u2551")
    backend_line = f"Embedding: {backend_label}"
    L.append("\u2551  " + _pad(backend_line, inner) + "\u2551")
    L.append("\u255a" + "\u2550" * (W - 2) + "\u255d")
    L.append("")

    all_scores = [r.final_score for r in results]
    thresholds = compute_score_thresholds(all_scores)
    t_list = sorted(thresholds.items(), key=lambda x: x[1][0], reverse=True)

    L.append("HOW TO READ THIS REPORT")
    L.append("\u2500" * 24)
    L.append("Compatibility score (0\u2013100):")
    for label, (min_val, desc) in t_list:
        if label == "Weak":
            L.append(f"  <{t_list[-2][1][0]:.0f}   {label} \u2014 {desc}")
        else:
            L.append(f"  {min_val:.0f}+{'':<4}{label} match \u2014 {desc}")
    L.append("")
    L.append("Readiness score (0\u2013100):")
    L.append("  How socially active and engaged this person is, based on their")
    L.append("  social bravery, event participation, feedback, and host observations.")
    L.append("  Higher = more likely to follow through on a connection.")
    L.append("")
    L.append("")

    # Guest Profiles
    sorted_people = sorted(people, key=lambda p: p.readiness_score, reverse=True)

    L.append("GUEST PROFILES")
    L.append("\u2500" * W)
    L.append(f" {'Name':<26}{'Type':<16}{'Age':>3}  {'Readiness':>9}")
    L.append(" " + "\u2500" * (W - 2))

    for p in sorted_people:
        dn = p.display_name[:25]
        gt = p.role_type[:14] if p.role_type else ""
        age_str = str(p.age) if p.age is not None else ""
        L.append(f" {dn:<26}{gt:<16}{age_str:>3}  {p.readiness_score:>8.0f}")
        if p.one_liner:
            L.append(f'   "{p.one_liner}"')

    L.append("")
    L.append("")

    # Strongest Predicted Connections
    all_sorted = sorted(results, key=lambda r: r.final_score, reverse=True)
    show_n = top_n or 15
    top_results = all_sorted[:show_n]

    L.append("STRONGEST PREDICTED CONNECTIONS")
    L.append("\u2500" * W)
    L.append("")

    for rank, r in enumerate(top_results, 1):
        an = r.person_a.display_name[:25]
        bn = r.person_b.display_name[:25]
        header = f" #{rank}  {an} \u2194 {bn}"
        if r.confidence_band == "high":
            conf_str = "confidence: high"
        else:
            conf_str = f"confidence: {r.confidence_band} \u2014 {r.confidence_reason}"
        score_str = f"Score: {r.final_score:.0f}  ({conf_str})"
        gap = max(1, W - len(header) - len(score_str) - 1)
        L.append(header + " " * gap + score_str)

        why_lines = generate_why_box(r, people)
        box_inner = W - 8
        L.append("     \u250c" + "\u2500" * (box_inner + 2) + "\u2500")
        for wl in why_lines:
            while len(wl) > box_inner:
                split_at = wl[:box_inner].rfind(" ")
                if split_at < box_inner // 2:
                    split_at = box_inner
                L.append("     \u2502 " + wl[:split_at])
                wl = "  " + wl[split_at:].lstrip()
            L.append("     \u2502 " + wl)
        L.append("     \u2514" + "\u2500" * (box_inner + 2) + "\u2500")
        L.append("")

    L.append("")

    # Each Person's Top 3
    person_pairs: dict[str, list[tuple[Person, float, PairResult]]] = defaultdict(list)
    for r in results:
        person_pairs[r.person_a.id].append((r.person_b, r.final_score, r))
        person_pairs[r.person_b.id].append((r.person_a, r.final_score, r))

    mutual_pairs: set[tuple[str, str]] = set()
    for r in results:
        if r.trust_reason == "Mutual pick from this dinner":
            mutual_pairs.add(tuple(sorted([r.person_a.id, r.person_b.id])))

    L.append("EACH GUEST'S TOP 3 MATCHES")
    L.append("\u2500" * W)
    L.append("")

    for p in sorted_people:
        matches = sorted(person_pairs.get(p.id, []), key=lambda x: x[1], reverse=True)[:3]
        age = f", {p.age}" if p.age is not None else ""
        L.append(f" {p.display_name} ({p.role_type}{age}) \u2014 Readiness: {p.readiness_score:.0f}")
        for i, (other, score, pr) in enumerate(matches, 1):
            pair_key = tuple(sorted([p.id, other.id]))
            check = " \u2713" if pair_key in mutual_pairs else ""
            why = generate_why_oneliner(pr, people)
            L.append(f"   {i}. {other.display_name[:25]} ({score:.0f}){check}")
            L.append(f"      {why}")
        L.append("")

    L.append("")

    # METHODOLOGY NOTES — always included so every report documents its own math.
    L.append("METHODOLOGY NOTES")
    L.append("\u2500" * W)
    L.append("This report uses three principled refinements beyond a plain cosine")
    L.append("similarity pipeline. Each is a modeling decision, not a tuned knob.")
    L.append("")
    L.append(" 1. Density-weighted text vectors.  For each pair and each text")
    L.append("    vector V (identity/personality/experience/interest) we multiply")
    L.append("    the base weight by density_V = min(words_A, words_B) / 100")
    L.append("    (capped at 1.0), then renormalise. A 0.6 cosine between two")
    L.append("    8-word blurbs is treated as a weaker signal than a 0.6 between")
    L.append("    two 80-word descriptions. Vectors where either side wrote")
    L.append("    nothing contribute zero weight automatically.")
    L.append("")
    L.append(" 2. Per-prediction confidence.  Alongside every score we report")
    L.append("    confidence = 0.50*text_completeness + 0.30*structured_coverage")
    L.append("                  + 0.20*graph_signal.")
    L.append("    Bands: >0.70 high, 0.40\u20130.70 medium, <0.40 low. A low-")
    L.append("    confidence score is not wrong \u2014 it is under-informed, and")
    L.append("    should be weighted accordingly when acting on it.")
    L.append("")
    L.append(" 3. Guest-type complementarity matrix.  complementary_type now")
    L.append("    uses a 3x3 lookup (storyteller/investigator/listener) grounded")
    L.append("    in dinner conversation dynamics: storyteller+listener = 1.00,")
    L.append("    investigator pairings in [0.65, 0.85], two storytellers 0.45,")
    L.append("    two listeners 0.35. Unknown taxonomies fall back to 0.50, so")
    L.append("    non-Blind8 partner data does not regress.")
    L.append("")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    L.append("\u2550" * W)
    L.append("PeopleRank v2 \u00b7 Togari \u00b7 Confidential")
    L.append(f"Scored at: {now}")
    L.append("\u2550" * W)

    return "\n".join(L)


# ---------------------------------------------------------------------------
# Ground Truth Validation
# ---------------------------------------------------------------------------


def format_validation(
    blind_results: list[PairResult],
    original_data: dict,
    people: List[Person],
) -> str:
    """
    Compare blind predictions against actual post-event ground truth.
    """
    L: list[str] = []

    # Load truth from original (unstripped) data using the ingestion layer
    truth_people = blind8_adapter(original_data, blind=False)
    truth_by_id = {p.id: p for p in truth_people}
    valid_ids = set(p.id for p in people)

    # Build affinity/spendTime pick sets from truth people's connections
    def _is_pick(from_id: str, to_id: str) -> bool:
        tp = truth_by_id.get(from_id)
        if not tp:
            return False
        return any(
            c["to_id"] == to_id and c["type"] in ("affinity", "spend_time_pick")
            for c in tp.connections
        )

    def _is_mutual(a_id: str, b_id: str) -> bool:
        return _is_pick(a_id, b_id) and _is_pick(b_id, a_id)

    def _is_any_pick(a_id: str, b_id: str) -> bool:
        return _is_pick(a_id, b_id) or _is_pick(b_id, a_id)

    # Get all actual mutual picks
    all_mutual: list[tuple[str, str]] = []
    checked = set()
    for tp in truth_people:
        for c in tp.connections:
            if c["type"] in ("affinity", "spend_time_pick"):
                pair = tuple(sorted([tp.id, c["to_id"]]))
                if pair not in checked and tp.id in valid_ids and c["to_id"] in valid_ids:
                    checked.add(pair)
                    if _is_mutual(tp.id, c["to_id"]):
                        all_mutual.append(pair)

    # Rank lookup
    sorted_results = sorted(blind_results, key=lambda r: r.final_score, reverse=True)
    pair_to_rank: dict[tuple[str, str], int] = {}
    for rank, r in enumerate(sorted_results, 1):
        pair_to_rank[tuple(sorted([r.person_a.id, r.person_b.id]))] = rank

    people_by_id = {p.id: p for p in people}
    top10 = sorted_results[:10]

    L.append("")
    L.append("")
    L.append("GROUND TRUTH VALIDATION")
    L.append("\u2500" * W)
    L.append("The algorithm scored all pairs using ONLY profile data \u2014 no")
    L.append("knowledge of who actually enjoyed spending time together.")
    L.append("Here's how the predictions mapped to reality:")
    L.append("")

    L.append(" Algorithm's Top 10 vs. Actual Picks:")
    confirmed = 0
    correct_bands: list[str] = []
    for rank, r in enumerate(top10, 1):
        a_id, b_id = r.person_a.id, r.person_b.id
        an = r.person_a.display_name[:25]
        bn = r.person_b.display_name[:25]
        pair_str = f"#{rank}  {an} \u2194 {bn} ({r.final_score:.0f})"

        if _is_mutual(a_id, b_id):
            L.append(f"   {pair_str:<50}\u2713 MUTUAL PICK  [{r.confidence_band}]")
            confirmed += 1
            correct_bands.append(r.confidence_band)
        elif _is_any_pick(a_id, b_id):
            L.append(f"   {pair_str:<50}\u2713 one-way pick  [{r.confidence_band}]")
            confirmed += 1
            correct_bands.append(r.confidence_band)
        else:
            L.append(f"   {pair_str:<50}\u00b7 not picked     [{r.confidence_band}]")
    L.append("")
    L.append(f" Accuracy: {confirmed} of top 10 predictions confirmed by actual picks")

    # Confidence distribution on correct top-10 predictions
    if correct_bands:
        hi = sum(1 for b in correct_bands if b == "high")
        md = sum(1 for b in correct_bands if b == "medium")
        lo = sum(1 for b in correct_bands if b == "low")
        parts = []
        if hi: parts.append(f"{hi} high")
        if md: parts.append(f"{md} medium")
        if lo: parts.append(f"{lo} low")
        L.append(
            f" Of the {confirmed} correct predictions: "
            + ", ".join(parts)
            + " confidence."
        )
    L.append("")

    # Lookup pair -> PairResult for confidence bands on missed mutuals
    pair_to_result: dict[tuple[str, str], PairResult] = {}
    for r in blind_results:
        pair_to_result[tuple(sorted([r.person_a.id, r.person_b.id]))] = r

    caught = []
    missed = []
    for pair in all_mutual:
        rank = pair_to_rank.get(pair)
        a_name = people_by_id[pair[0]].display_name[:25] if pair[0] in people_by_id else pair[0][:8]
        b_name = people_by_id[pair[1]].display_name[:25] if pair[1] in people_by_id else pair[1][:8]
        band = pair_to_result[pair].confidence_band if pair in pair_to_result else "?"
        if rank is not None and rank <= 10:
            caught.append((a_name, b_name, rank, band))
        else:
            missed.append((a_name, b_name, rank, band))

    if caught:
        L.append(" Mutual picks the algorithm caught:")
        for a_name, b_name, rank, band in sorted(caught, key=lambda x: x[2]):
            L.append(f"   \u2713 {a_name} \u2194 {b_name} \u2014 ranked #{rank} [{band}]")
    L.append("")

    if missed:
        L.append(" Mutual picks the algorithm missed:")
        for a_name, b_name, rank, band in sorted(missed, key=lambda x: x[2] or 999):
            rank_str = f"ranked #{rank}" if rank else "unranked"
            L.append(f"   \u2717 {a_name} \u2194 {b_name} \u2014 {rank_str} [{band}]")
        # Breakdown of missed mutuals by confidence band
        hi = sum(1 for m in missed if m[3] == "high")
        md = sum(1 for m in missed if m[3] == "medium")
        lo = sum(1 for m in missed if m[3] == "low")
        parts = []
        if hi: parts.append(f"{hi} high")
        if md: parts.append(f"{md} medium")
        if lo: parts.append(f"{lo} low")
        if parts:
            L.append(
                f" Of the {len(missed)} missed mutual picks: "
                + ", ".join(parts)
                + " confidence. (Low confidence on a miss is a sign the algorithm"
            )
            L.append("  couldn't see enough signal, not that it got it wrong.)")
    else:
        L.append(" Mutual picks the algorithm missed:")
        L.append("   (none \u2014 all mutual picks ranked in top 10)")
    L.append("")

    # Most popular
    pick_counts: dict[str, int] = defaultdict(int)
    for tp in truth_people:
        for c in tp.connections:
            if c["type"] in ("affinity", "spend_time_pick") and c["to_id"] in valid_ids:
                pick_counts[c["to_id"]] += 1

    if pick_counts:
        top_popular = sorted(pick_counts.items(), key=lambda x: x[1], reverse=True)[:3]
        readiness_rank = {p.id: rank for rank, p in enumerate(
            sorted(people, key=lambda x: x.readiness_score, reverse=True), 1
        )}
        L.append(" Most popular guest (picked by most people):")
        for gid, count in top_popular:
            if gid in people_by_id:
                p = people_by_id[gid]
                rr = readiness_rank.get(gid, "?")
                L.append(
                    f"   {p.display_name} \u2014 picked by {count} "
                    f"{'person' if count == 1 else 'people'} "
                    f"(algorithm ranked them #{rr} in readiness)"
                )
    L.append("")

    return "\n".join(L)


# ---------------------------------------------------------------------------
# Core Pipeline
# ---------------------------------------------------------------------------


def load_event(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data


def score_event(
    data: dict,
    *,
    blind: bool = False,
    validate: bool = False,
    top_n: Optional[int] = None,
    backend=None,
) -> str:
    """Run full PeopleRank v2 pipeline on one event. Returns report string."""
    original_data = data

    if backend is None:
        backend = TFIDFBackend()

    # Ingest → List[Person]
    people = ingest(data, blind=blind)
    if len(people) < 2:
        return "Error: Need at least 2 people to compute compatibility."

    # Compute readiness
    for p in people:
        p.readiness_score = compute_readiness(p)

    person_ids = sorted(p.id for p in people)
    id_to_idx = {pid: i for i, pid in enumerate(person_ids)}
    people_by_id = {p.id: p for p in people}

    sim_matrices = compute_tfidf_similarity(people, person_ids, backend=backend)

    results: list[PairResult] = []
    for pid_a, pid_b in combinations(person_ids, 2):
        pa, pb = people_by_id[pid_a], people_by_id[pid_b]
        i, j = id_to_idx[pid_a], id_to_idx[pid_b]

        vec_sim, per_dim, per_dim_density = compute_vec_sim(sim_matrices, i, j, pa, pb)
        struct_sim, struct_scores, struct_coverage = compute_struct_sim(pa, pb)
        trust, trust_reason = compute_trust(pa, pb)
        final, compat, readiness_mod = compute_final_score(
            vec_sim, struct_sim, trust, pa.readiness_score, pb.readiness_score
        )

        # IMPROVEMENT 2 — per-prediction confidence
        tc = _text_completeness(pa, pb)
        sc = _structured_coverage(struct_coverage)
        gs = _graph_signal(pa, pb)
        conf = compute_confidence(tc, sc, gs)
        band, reason = confidence_label(conf, tc, sc, gs)

        results.append(PairResult(
            person_a=pa, person_b=pb,
            vec_sim=vec_sim, struct_sim=struct_sim,
            compatibility=compat, trust=trust,
            readiness_modifier=readiness_mod, final_score=final,
            trust_reason=trust_reason,
            sim_identity=per_dim.get("identity", 0),
            sim_personality=per_dim.get("personality", 0),
            sim_experience=per_dim.get("experience", 0),
            sim_interest=per_dim.get("interest", 0),
            struct_scores=struct_scores,
            per_dim_density=per_dim_density,
            struct_coverage=struct_coverage,
            text_completeness=tc,
            structured_coverage=sc,
            graph_signal=gs,
            confidence=conf,
            confidence_band=band,
            confidence_reason=reason,
        ))

    event_info = data.get("event", {})
    report = format_report(
        event_info, people, results,
        top_n=top_n, blind=blind, backend_label=backend.display,
    )

    if blind and validate:
        report += format_validation(results, original_data, people)
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        report += "\n"
        report += "\u2550" * W + "\n"
        report += "PeopleRank v2 \u00b7 Togari \u00b7 Confidential\n"
        report += f"Scored at: {now}\n"
        report += "\u2550" * W

    # OpenAI usage summary
    if isinstance(backend, OpenAIBackend):
        report += "\n\n" + backend.usage_summary() + "\n"

    return report


def score_event_json(
    data: dict,
    *,
    blind: bool = False,
    top_n: Optional[int] = None,
) -> str:
    """Run pipeline, return machine-readable JSON string."""
    people = ingest(data, blind=blind)
    if len(people) < 2:
        return json.dumps({"error": "Need at least 2 people"})

    for p in people:
        p.readiness_score = compute_readiness(p)

    person_ids = sorted(p.id for p in people)
    id_to_idx = {pid: i for i, pid in enumerate(person_ids)}
    people_by_id = {p.id: p for p in people}

    sim_matrices = compute_tfidf_similarity(people, person_ids)

    pairs = []
    for pid_a, pid_b in combinations(person_ids, 2):
        pa, pb = people_by_id[pid_a], people_by_id[pid_b]
        i, j = id_to_idx[pid_a], id_to_idx[pid_b]
        vec_sim, per_dim, per_dim_density = compute_vec_sim(sim_matrices, i, j, pa, pb)
        struct_sim, struct_scores, struct_coverage = compute_struct_sim(pa, pb)
        trust, trust_reason = compute_trust(pa, pb)
        final, compat, readiness_mod = compute_final_score(
            vec_sim, struct_sim, trust, pa.readiness_score, pb.readiness_score
        )
        tc = _text_completeness(pa, pb)
        sc = _structured_coverage(struct_coverage)
        gs = _graph_signal(pa, pb)
        conf = compute_confidence(tc, sc, gs)
        band, reason = confidence_label(conf, tc, sc, gs)
        pairs.append({
            "person_a": {"id": pa.id, "name": pa.display_name, "readiness": pa.readiness_score},
            "person_b": {"id": pb.id, "name": pb.display_name, "readiness": pb.readiness_score},
            "vec_sim": round(vec_sim, 4),
            "struct_sim": round(struct_sim, 4),
            "per_dim": {k: round(v, 4) for k, v in per_dim.items()},
            "per_dim_density": {k: round(v, 4) for k, v in per_dim_density.items()},
            "struct_scores": {k: round(v, 4) for k, v in struct_scores.items()},
            "struct_coverage": {k: bool(v) for k, v in struct_coverage.items()},
            "compatibility": compat, "trust": trust, "trust_reason": trust_reason,
            "readiness_modifier": readiness_mod, "final_score": final,
            "confidence": round(conf, 4),
            "confidence_band": band,
            "confidence_reason": reason,
        })

    pairs.sort(key=lambda p: p["final_score"], reverse=True)
    if top_n:
        pairs = pairs[:top_n]

    return json.dumps({
        "event": data.get("event", {}),
        "mode": "blind" if blind else "full",
        "person_readiness": {
            p.id: {"name": p.display_name, "readiness_score": p.readiness_score}
            for p in people
        },
        "pairs": pairs,
    }, indent=2)


# ---------------------------------------------------------------------------
# Directory mode
# ---------------------------------------------------------------------------


def score_directory(
    dir_path: str,
    *,
    blind: bool = False,
    validate: bool = False,
    top_n: Optional[int] = None,
    as_json: bool = False,
    backend=None,
) -> str:
    """Score all .json files in a directory, concatenate reports."""
    p = Path(dir_path)
    json_files = sorted(p.glob("*.json"))
    if not json_files:
        return f"No .json files found in {dir_path}"

    outputs: list[str] = []
    summaries: list[dict] = []

    for jf in json_files:
        data = load_event(str(jf))
        event_name = data.get("event", {}).get("name", jf.stem)

        if as_json:
            out = score_event_json(data, blind=blind, top_n=top_n)
        else:
            out = score_event(data, blind=blind, validate=validate, top_n=top_n, backend=backend)

        outputs.append(out)

        if blind and validate and not as_json:
            match = re.search(r"Accuracy: (\d+) of top 10", out)
            accuracy = int(match.group(1)) if match else 0
            summaries.append({"name": event_name, "file": jf.name, "accuracy": accuracy})

    separator = "\n\n" + ("=" * W) + "\n" + ("=" * W) + "\n\n"
    combined = separator.join(outputs)

    if summaries and not as_json:
        combined += "\n\n"
        combined += "=" * W + "\n"
        combined += "MULTI-EVENT SUMMARY\n"
        combined += "\u2500" * W + "\n"
        best = max(summaries, key=lambda s: s["accuracy"])
        for s in summaries:
            marker = " \u2190 best" if s == best else ""
            combined += f" {s['name']:<35} {s['accuracy']}/10 confirmed{marker}\n"
        combined += "=" * W + "\n"

    return combined


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="PeopleRank v2 \u2014 Schema-agnostic compatibility scorer",
    )
    parser.add_argument("input", help="Path to event JSON export or directory of JSON files")
    parser.add_argument("--out", "-o", help="Output file path (default: stdout)")
    parser.add_argument("--top", "-t", type=int, default=None, help="Show only top N connections")
    parser.add_argument("--json", action="store_true", help="Output raw JSON instead of formatted report")
    parser.add_argument("--blind", action="store_true",
                        help="Strip post-event data (affinities, feedback, hostNotes) before scoring")
    parser.add_argument("--validate", action="store_true",
                        help="With --blind, compare predictions against actual picks")
    parser.add_argument("--openai", action="store_true",
                        help="Use OpenAI embeddings instead of TF-IDF (requires OPENAI_API_KEY)")
    parser.add_argument("--openai-model", default="text-embedding-3-large",
                        help="OpenAI embedding model (default: text-embedding-3-large)")

    args = parser.parse_args()

    if args.validate and not args.blind:
        print("Warning: --validate only works with --blind. Adding --blind automatically.", file=sys.stderr)
        args.blind = True

    backend = OpenAIBackend(model=args.openai_model) if args.openai else TFIDFBackend()

    input_path = Path(args.input)

    if input_path.is_dir():
        output = score_directory(
            str(input_path), blind=args.blind, validate=args.validate,
            top_n=args.top, as_json=args.json, backend=backend,
        )
    elif input_path.is_file():
        data = load_event(str(input_path))
        if args.json:
            output = score_event_json(data, blind=args.blind, top_n=args.top)
        else:
            output = score_event(data, blind=args.blind, validate=args.validate,
                                 top_n=args.top, backend=backend)
    else:
        print(f"Error: {args.input} is not a file or directory", file=sys.stderr)
        sys.exit(1)

    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"Results written to {args.out}")
    else:
        print(output)


if __name__ == "__main__":
    main()
