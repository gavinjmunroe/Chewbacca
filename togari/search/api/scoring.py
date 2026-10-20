"""Scoring wrapper: run PeopleRank pipeline with OpenAI embeddings."""
from __future__ import annotations

import dataclasses
import json
import sys
from itertools import combinations
from pathlib import Path
from typing import Dict, List

# Make src/ importable
_ROOT = Path(__file__).resolve().parent.parent
_SRC = str(_ROOT / "src")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from . import persist_cache  # noqa: E402
from peoplerank.ingestion import Person  # noqa: E402
from peoplerank.embeddings import OpenAIBackend  # noqa: E402

_SCORE_MODEL = "text-embedding-3-large"

# Reuse one large-model backend across requests so its in-memory embedding
# cache survives. The backend persists vectors to disk by text content, so the
# shared instance mainly skips repeat disk reads within a warm process. None
# until first construction; rebuilt lazily if it ever fails.
_backend = None


def _get_backend() -> OpenAIBackend:
    global _backend
    if _backend is None:
        _backend = OpenAIBackend(model=_SCORE_MODEL)
    return _backend


# Bumped when the scoring pipeline changes so cached pair scores from an older
# algorithm are not served after a deploy.
_SCORE_CACHE_VERSION = "v1"


def _score_cache_key(people: List[Person]) -> str:
    """Content hash over the full input person set, order-independent."""
    blobs = []
    for p in sorted(people, key=lambda x: x.id):
        try:
            blobs.append(json.dumps(dataclasses.asdict(p), sort_keys=True, default=str))
        except (TypeError, ValueError):
            blobs.append(repr(p))
    return persist_cache.make_key(_SCORE_CACHE_VERSION, _SCORE_MODEL, *blobs)
from peoplerank.score import (  # noqa: E402
    compute_readiness,
    compute_tfidf_similarity,
    compute_vec_sim,
    compute_struct_sim,
    compute_trust,
    compute_final_score,
    _text_completeness,
    _structured_coverage,
    _graph_signal,
    compute_confidence,
    confidence_label,
)


def score_people_openai(people: List[Person]) -> List[Dict]:
    """
    Run the full peoplerank scoring pipeline using OpenAI embeddings.
    Returns a list of pair dicts compatible with score_event_json output.
    Each pair has: person_a/person_b ids, final_score, confidence, etc.
    """
    if len(people) < 2:
        return []

    # Persistent cache: a retried event match (same roster after a client
    # timeout) returns the identical scored pairs instantly with no OpenAI
    # spend. Keyed by the exact input person set.
    cache_key = _score_cache_key(people)
    cached = persist_cache.get("scores", cache_key)
    if isinstance(cached, list):
        return cached

    for p in people:
        p.readiness_score = compute_readiness(p)

    person_ids = sorted(p.id for p in people)
    id_to_idx = {pid: i for i, pid in enumerate(person_ids)}
    people_by_id = {p.id: p for p in people}

    backend = _get_backend()
    sim_matrices = compute_tfidf_similarity(people, person_ids, backend=backend)

    pairs: List[Dict] = []
    for pid_a, pid_b in combinations(person_ids, 2):
        pa = people_by_id[pid_a]
        pb = people_by_id[pid_b]
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
            "struct_scores": {k: round(v, 4) for k, v in struct_scores.items()},
            "struct_coverage": {k: bool(v) for k, v in struct_coverage.items()},
            "compatibility": compat,
            "trust": trust,
            "trust_reason": trust_reason,
            "readiness_modifier": readiness_mod,
            "final_score": final,
            "confidence": round(conf, 4),
            "confidence_band": band,
            "confidence_reason": reason,
        })

    pairs.sort(key=lambda p: p["final_score"], reverse=True)
    persist_cache.set("scores", cache_key, pairs)
    return pairs


def extract_signals(pair: Dict) -> List[str]:
    """Produce a short human-readable signals list from a pair dict."""
    signals: List[str] = []
    per_dim = pair.get("per_dim", {}) or {}
    for dim in ("identity", "personality", "experience", "interest"):
        v = per_dim.get(dim, 0.0)
        if v >= 0.35:
            signals.append(f"{dim}:{v:.2f}")
    struct = pair.get("struct_scores", {}) or {}
    for k, v in struct.items():
        if v >= 0.6:
            signals.append(f"{k}:{v:.2f}")
    band = pair.get("confidence_band")
    if band:
        signals.append(f"confidence:{band}")
    return signals[:6]
