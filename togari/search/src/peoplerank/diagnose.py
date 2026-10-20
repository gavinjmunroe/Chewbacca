#!/usr/bin/env python3
"""
PeopleRank v2 Regression Diagnostic
====================================

Compares V1 (pre-refactor) vs V2 (current, via ingestion.py + score.py) scoring
on the same Blind8 event JSON.

V1 is reconstructed INLINE by parsing raw JSON field names directly:
  guests[].screeningNotes / whyJoin / socialBravery / passion
  applications[].qualificationScore
  eventGuests[].hostNotes
  guestConnections[], guestAffinities[], feedback[].spendTimeWithGuestIds

Algorithm constants (weights, trust levels, boost) are imported from score.py
so both engines agree on math — only field routing differs.

Usage:
    python3 src/peoplerank/diagnose.py data/austin-18.json
"""

from __future__ import annotations

import copy
import json
import re
import sys
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Make `peoplerank` importable whether run as a script or a module.
_THIS = Path(__file__).resolve()
_SRC = _THIS.parent.parent
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from .score import (  # noqa: E402
    BRAVERY_KEYWORDS,
    READINESS_WEIGHTS,
    TEXT_VECTOR_WEIGHTS,
    STRUCT_WEIGHTS,
    COMPATIBILITY_MIX,
    SAME_EVENT_BOOST,
    TRUST_LEVELS,
    compute_readiness as v2_compute_readiness,
    compute_tfidf_similarity as v2_compute_tfidf,
    compute_vec_sim as v2_compute_vec_sim,
    compute_struct_sim as v2_compute_struct,
    compute_trust as v2_compute_trust,
    compute_final_score as v2_compute_final,
)
from .ingestion import ingest  # noqa: E402


# ---------------------------------------------------------------------------
# V1 scoring (field-name literal, reconstructed inline)
# ---------------------------------------------------------------------------


@dataclass
class V1Person:
    id: str
    display_name: str
    age: Optional[int] = None
    gender: str = ""
    city: str = ""
    occupation: str = ""
    role_type: str = ""

    # Raw field slots (V1 keeps fields isolated)
    social_bravery: str = ""
    screening_notes: str = ""
    why_join: str = ""
    passion: str = ""
    qualification_notes: str = ""
    host_notes_parsed: dict = field(default_factory=dict)
    feedback_highlight: str = ""
    feedback_one_word: str = ""
    feedback_improvement: str = ""
    feedback_next_big_event: str = ""

    # Text vectors (assembled from raw fields)
    identity_text: str = ""
    personality_text: str = ""
    experience_text: str = ""
    interest_text: str = ""

    # Behavioral
    attendance_ratio: float = 0.5
    feedback_ratio: float = 0.0
    qualification_score: Optional[float] = None
    readiness_score: float = 0.0
    hangout_flag: bool = False

    # Connections (same shape as V2)
    connections: List[Dict] = field(default_factory=list)


def _clean(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"\b(None|null|N/A|n/a|undefined)\b", "", text)
    return re.sub(r"\s+", " ", cleaned).strip()


def _parse_host_notes(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if not raw or not isinstance(raw, str):
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _v1_strip_post_event(data: dict) -> dict:
    stripped = copy.deepcopy(data)
    stripped["guestAffinities"] = []
    stripped["feedback"] = []
    for key in ("eventGuests", "event_guests"):
        for eg in stripped.get(key, []):
            eg["hostNotes"] = None
    return stripped


def _short_name(occupation: str, gid: str) -> str:
    occ = (occupation or "").strip()
    if not occ:
        return gid[:8]
    if len(occ) <= 25:
        return occ.rstrip(".")
    # Keep first clause before a comma/and
    first = re.split(r"[,;/&]+|\band\b", occ)[0].strip()
    if len(first) <= 25:
        return first
    return first[:24].rstrip() + "\u2026"


def build_v1_people(data: dict, blind: bool) -> List[V1Person]:
    """Reconstruct V1 inline: read fields literally, isolate bravery source."""
    if blind:
        data = _v1_strip_post_event(data)

    people: Dict[str, V1Person] = {}

    # Phase 1: guests
    for g in data.get("guests", []):
        gid = g.get("id", "")
        if not gid:
            continue
        age = g.get("age")
        try:
            age = int(age) if age is not None else None
        except (ValueError, TypeError):
            age = None

        occ = str(g.get("occupation") or "")
        p = V1Person(
            id=gid,
            display_name=_short_name(occ, gid),
            age=age,
            gender=str(g.get("gender") or ""),
            city=str(g.get("city") or ""),
            occupation=occ,
            role_type=str(g.get("guestType") or ""),
            social_bravery=str(g.get("socialBravery") or ""),
            screening_notes=str(g.get("screeningNotes") or ""),
            why_join=str(g.get("whyJoin") or ""),
            passion=str(g.get("passion") or ""),
        )
        people[gid] = p

    # Phase 2: applications
    for app in data.get("applications", []):
        gid = app.get("guestId", "")
        if gid not in people:
            continue
        qs = app.get("qualificationScore")
        if qs is not None:
            try:
                people[gid].qualification_score = float(qs)
            except (ValueError, TypeError):
                pass
        people[gid].qualification_notes = str(app.get("qualificationNotes") or "")

    # Phase 3: eventGuests (attendance + host_notes + hangout flag)
    for eg in data.get("eventGuests", []):
        gid = eg.get("guestId", "")
        if gid not in people:
            continue
        people[gid].attendance_ratio = 1.0
        parsed = _parse_host_notes(eg.get("hostNotes"))
        people[gid].host_notes_parsed = parsed
        for key, obs in parsed.items():
            if isinstance(key, str) and key.endswith("_hangout"):
                if obs is True or obs == "true":
                    people[gid].hangout_flag = True
                    break
            if isinstance(obs, dict) and obs.get("hangout") is True:
                people[gid].hangout_flag = True
                break

    # Phase 4: feedback
    spend_time_edges: Dict[str, List[str]] = {}
    for fb in data.get("feedback", []):
        gid = fb.get("guestId", "")
        if gid not in people:
            continue
        people[gid].feedback_ratio = 1.0
        people[gid].feedback_highlight = str(fb.get("highlight") or "")
        people[gid].feedback_one_word = str(fb.get("oneWord") or "")
        people[gid].feedback_improvement = str(fb.get("improvement") or "")
        people[gid].feedback_next_big_event = str(fb.get("nextBigEvent") or "")
        spend = fb.get("spendTimeWithGuestIds") or []
        if isinstance(spend, list):
            spend_time_edges[gid] = list(spend)

    # Phase 5: assemble text buckets (V1 style — fields isolated, not all-in-one)
    for p in people.values():
        pi = []
        if p.occupation: pi.append(f"Occupation: {p.occupation}.")
        if p.city:       pi.append(f"City: {p.city}.")
        if p.age is not None: pi.append(f"Age: {p.age}.")
        if p.role_type:  pi.append(f"Guest type: {p.role_type}.")
        if p.gender:     pi.append(f"Gender: {p.gender}.")
        p.identity_text = _clean(" ".join(pi))

        pp = []
        if p.screening_notes:     pp.append(f"About them: {p.screening_notes}.")
        if p.why_join:            pp.append(f"Why they joined: {p.why_join}.")
        if p.social_bravery:      pp.append(f"Social style: {p.social_bravery}.")
        if p.qualification_notes: pp.append(f"Screener assessment: {p.qualification_notes}.")
        p.personality_text = _clean(" ".join(pp))

        pe = []
        if p.host_notes_parsed:
            obs_texts = []
            for key, obs in p.host_notes_parsed.items():
                if isinstance(key, str) and key.endswith("_hangout"):
                    continue
                if isinstance(obs, dict):
                    parts = [f"{k}: {v}" for k, v in obs.items()
                             if v and k != "hangout"
                             and str(v).lower() not in ("none", "null", "false", "true", "")]
                    if parts:
                        obs_texts.append(". ".join(parts))
                elif isinstance(obs, str) and obs.strip():
                    obs_texts.append(obs)
            if obs_texts:
                pe.append(f"Observer notes: {'; '.join(obs_texts)}.")
        if p.feedback_highlight:   pe.append(f"Best moments: {p.feedback_highlight}.")
        if p.feedback_one_word:    pe.append(f"One word: {p.feedback_one_word}.")
        if p.feedback_improvement: pe.append(f"Improvements: {p.feedback_improvement}.")
        p.experience_text = _clean(" ".join(pe))

        pn = []
        if p.passion:                  pn.append(f"Passions: {p.passion}.")
        if p.feedback_next_big_event:  pn.append(f"Next big event: {p.feedback_next_big_event}.")
        p.interest_text = _clean(" ".join(pn))

    # Phase 6: connections
    valid = set(people.keys())
    for conn in data.get("guestConnections", []):
        a = conn.get("guestIdA", "")
        b = conn.get("guestIdB", "")
        ctype = str(conn.get("connectionType") or "")
        if a in valid and b in valid:
            w = {"friends": 0.90, "referred_by": 0.80, "knows": 0.40}.get(ctype, 0.30)
            people[a].connections.append({"to_id": b, "type": ctype, "weight": w})
            people[b].connections.append({"to_id": a, "type": ctype, "weight": w})

    for aff in data.get("guestAffinities", []):
        fr = aff.get("fromGuestId", "")
        to = aff.get("toGuestId", "")
        if fr in valid and to in valid:
            people[fr].connections.append({"to_id": to, "type": "affinity", "weight": 1.0})

    for gid, targets in spend_time_edges.items():
        for tid in targets:
            if tid in valid:
                people[gid].connections.append({"to_id": tid, "type": "spend_time_pick", "weight": 1.0})

    return list(people.values())


# --- V1 scoring primitives (bravery reads socialBravery field only) ---

def v1_compute_bravery(p: V1Person) -> float:
    """Bravery computed against the ISOLATED socialBravery field."""
    text = (p.social_bravery or "").lower().strip()
    if not text:
        return 0.0
    word_count = len(text.split())
    richness = min(word_count / 80.0, 1.0)
    keyword_hits = sum(1 for kw in BRAVERY_KEYWORDS if kw in text)
    density = min(keyword_hits / 4.0, 1.0)
    return 0.5 * richness + 0.5 * density


def v1_compute_readiness(p: V1Person) -> float:
    bravery = v1_compute_bravery(p)
    attendance = p.attendance_ratio
    feedback_engagement = p.feedback_ratio
    if p.qualification_score is not None:
        qual = max(0.0, min(1.0, (p.qualification_score - 50.0) / 50.0))
    else:
        qual = 0.5
    hangout = 1.0 if p.hangout_flag else 0.0
    raw = (
        READINESS_WEIGHTS["bravery"] * bravery
        + READINESS_WEIGHTS["attendance"] * attendance
        + READINESS_WEIGHTS["feedback_engagement"] * feedback_engagement
        + READINESS_WEIGHTS["qualification"] * qual
        + READINESS_WEIGHTS["hangout_flag"] * hangout
    )
    return round(raw * 100.0, 2)


def v1_build_vectors(p: V1Person) -> dict:
    return {
        "identity":    _clean(p.identity_text),
        "personality": _clean(p.personality_text),
        "experience":  _clean(p.experience_text),
        "interest":    _clean(p.interest_text),
    }


def v1_tfidf_matrices(people: List[V1Person], ids: List[str]) -> dict:
    by_id = {p.id: p for p in people}
    text_map = {pid: v1_build_vectors(by_id[pid]) for pid in ids}
    n = len(ids)
    out = {}
    for tt in ("identity", "personality", "experience", "interest"):
        docs = [text_map[pid][tt] for pid in ids]
        non_empty = [d for d in docs if d.strip()]
        if len(non_empty) < 2:
            out[tt] = np.zeros((n, n))
            continue
        vec = TfidfVectorizer(stop_words="english", max_features=5000, min_df=1, sublinear_tf=True)
        try:
            m = vec.fit_transform(docs)
            out[tt] = cosine_similarity(m)
        except ValueError:
            out[tt] = np.zeros((n, n))
    return out


def v1_vec_sim(sim, i, j, a: V1Person, b: V1Person) -> tuple[float, dict]:
    ta, tb = v1_build_vectors(a), v1_build_vectors(b)
    experience_missing = not ta["experience"].strip() or not tb["experience"].strip()
    weights = dict(TEXT_VECTOR_WEIGHTS)
    if experience_missing:
        removed = weights.pop("experience")
        rem = sum(weights.values())
        if rem > 0:
            for k in weights:
                weights[k] += removed * (weights[k] / rem)
    per_dim = {}
    total = 0.0
    for tt, w in weights.items():
        sv = max(0.0, sim[tt][i, j]) if tt in sim else 0.0
        per_dim[tt] = sv
        total += w * sv
    if experience_missing:
        per_dim["experience"] = 0.0
    return total, per_dim


def v1_has_connection(a: V1Person, b: V1Person) -> bool:
    for c in a.connections:
        if c["to_id"] == b.id and c["type"] in ("friends", "referred_by", "knows"):
            return True
    return False


def v1_get_ctype(a: V1Person, b: V1Person) -> str:
    prio = {"friends": 4, "referred_by": 3, "knows": 2}
    best, best_p = "", 0
    for c in a.connections:
        if c["to_id"] == b.id:
            p = prio.get(c["type"], 0)
            if p > best_p:
                best_p, best = p, c["type"]
    for c in b.connections:
        if c["to_id"] == a.id:
            p = prio.get(c["type"], 0)
            if p > best_p:
                best_p, best = p, c["type"]
    return best


def v1_struct_sim(a: V1Person, b: V1Person) -> tuple[float, dict]:
    s = {}
    if a.age is not None and b.age is not None:
        s["age_proximity"] = max(0.0, 1.0 - abs(a.age - b.age) / 40.0)
    else:
        s["age_proximity"] = 0.5

    if a.city and b.city:
        s["same_city"] = 1.0 if a.city.strip().lower() == b.city.strip().lower() else 0.0
    else:
        s["same_city"] = 0.0

    if a.role_type and b.role_type:
        s["complementary_type"] = 1.0 if a.role_type.lower() != b.role_type.lower() else 0.5
    else:
        s["complementary_type"] = 0.5

    both = a.attendance_ratio >= 1.0 and b.attendance_ratio >= 1.0
    s["shared_event_count"] = min((1 if both else 0) / 3.0, 1.0)
    s["connection_exists"] = 1.0 if v1_has_connection(a, b) else 0.0

    ctype = v1_get_ctype(a, b)
    s["referral_chain"] = 1.0 if ctype == "referred_by" else 0.0

    qa = a.qualification_score if a.qualification_score is not None else 50.0
    qb = b.qualification_score if b.qualification_score is not None else 50.0
    s["qualification_proximity"] = 1.0 - abs(qa - qb) / 100.0
    s["readiness_harmony"] = 1.0 - abs(a.readiness_score - b.readiness_score) / 100.0

    total = sum(STRUCT_WEIGHTS[k] * s[k] for k in STRUCT_WEIGHTS)
    return total, s


def _v1_has_pick(a: V1Person, b: V1Person) -> bool:
    for c in a.connections:
        if c["to_id"] == b.id and c["type"] in ("affinity", "spend_time_pick"):
            return True
    return False


def v1_trust(a: V1Person, b: V1Person) -> tuple[float, str]:
    ap = _v1_has_pick(a, b)
    bp = _v1_has_pick(b, a)
    if ap and bp:
        return TRUST_LEVELS["mutual_pick"], "Mutual pick from this dinner"
    ctype = v1_get_ctype(a, b)
    if ctype == "friends":
        return TRUST_LEVELS["friends"], "Already friends"
    if ctype == "referred_by":
        return TRUST_LEVELS["referred_by"], "Referral connection"
    if ap or bp:
        return TRUST_LEVELS["unidirectional_pick"], "One-way pick"
    if ctype == "knows":
        return TRUST_LEVELS["knows"], "Know each other"
    if a.attendance_ratio >= 1.0 and b.attendance_ratio >= 1.0:
        return TRUST_LEVELS["co_attended"], "Co-attended this dinner"
    if v1_has_connection(a, b):
        return TRUST_LEVELS["knows"], "Connected"
    return TRUST_LEVELS["floor"], "Both passed screening"


def v1_final(vec_sim, struct_sim, trust, ra, rb) -> tuple[float, float, float]:
    compatibility = COMPATIBILITY_MIX["vec_sim"] * vec_sim + COMPATIBILITY_MIX["struct_sim"] * struct_sim
    readiness_mod = min(ra, rb) / 100.0
    final = readiness_mod * compatibility * trust * SAME_EVENT_BOOST * 100.0
    return round(final, 2), round(compatibility, 4), round(readiness_mod, 4)


# ---------------------------------------------------------------------------
# Comparison harness
# ---------------------------------------------------------------------------


@dataclass
class PairRow:
    a_id: str
    b_id: str
    a_name: str
    b_name: str
    v1_score: float
    v2_score: float
    v1_rank: int
    v2_rank: int
    # components
    v1_readiness_mod: float
    v2_readiness_mod: float
    v1_compat: float
    v2_compat: float
    v1_vec: float
    v2_vec: float
    v1_struct: float
    v2_struct: float
    v1_trust: float
    v2_trust: float
    v1_trust_reason: str
    v2_trust_reason: str
    v1_readiness_a: float
    v1_readiness_b: float
    v2_readiness_a: float
    v2_readiness_b: float


def run_v1(data: dict, blind: bool):
    people = build_v1_people(data, blind=blind)
    for p in people:
        p.readiness_score = v1_compute_readiness(p)
    ids = sorted(p.id for p in people)
    idx = {pid: i for i, pid in enumerate(ids)}
    by_id = {p.id: p for p in people}
    sims = v1_tfidf_matrices(people, ids)

    results = []
    for ia, ib in combinations(ids, 2):
        pa, pb = by_id[ia], by_id[ib]
        i, j = idx[ia], idx[ib]
        vec, per_dim = v1_vec_sim(sims, i, j, pa, pb)
        struct, _ = v1_struct_sim(pa, pb)
        trust, treason = v1_trust(pa, pb)
        final, compat, rmod = v1_final(vec, struct, trust, pa.readiness_score, pb.readiness_score)
        results.append({
            "a_id": pa.id, "b_id": pb.id,
            "a_name": pa.display_name, "b_name": pb.display_name,
            "final": final, "compat": compat, "vec": vec, "struct": struct,
            "trust": trust, "trust_reason": treason, "rmod": rmod,
            "ra": pa.readiness_score, "rb": pb.readiness_score,
        })
    return people, results


def run_v2(data: dict, blind: bool):
    people = ingest(data, blind=blind)
    for p in people:
        p.readiness_score = v2_compute_readiness(p)
    ids = sorted(p.id for p in people)
    idx = {pid: i for i, pid in enumerate(ids)}
    by_id = {p.id: p for p in people}
    sims = v2_compute_tfidf(people, ids)

    results = []
    for ia, ib in combinations(ids, 2):
        pa, pb = by_id[ia], by_id[ib]
        i, j = idx[ia], idx[ib]
        # V2 signatures grew to 3-tuples (v3): vec adds per_dim_density,
        # struct adds coverage flags.
        vec, per_dim, _density = v2_compute_vec_sim(sims, i, j, pa, pb)
        struct, _scores, _coverage = v2_compute_struct(pa, pb)
        trust, treason = v2_compute_trust(pa, pb)
        final, compat, rmod = v2_compute_final(vec, struct, trust, pa.readiness_score, pb.readiness_score)
        results.append({
            "a_id": pa.id, "b_id": pb.id,
            "a_name": pa.display_name, "b_name": pb.display_name,
            "final": final, "compat": compat, "vec": vec, "struct": struct,
            "trust": trust, "trust_reason": treason, "rmod": rmod,
            "ra": pa.readiness_score, "rb": pb.readiness_score,
        })
    return people, results


def build_rank_map(results):
    sorted_r = sorted(results, key=lambda r: r["final"], reverse=True)
    rank = {}
    for i, r in enumerate(sorted_r, 1):
        key = tuple(sorted([r["a_id"], r["b_id"]]))
        rank[key] = i
    return rank


def diff_rows(v1_results, v2_results) -> List[PairRow]:
    v1_by = {tuple(sorted([r["a_id"], r["b_id"]])): r for r in v1_results}
    v2_by = {tuple(sorted([r["a_id"], r["b_id"]])): r for r in v2_results}
    v1_rank = build_rank_map(v1_results)
    v2_rank = build_rank_map(v2_results)

    rows: List[PairRow] = []
    for key in v1_by:
        if key not in v2_by:
            continue
        r1, r2 = v1_by[key], v2_by[key]
        # Use V2 names for display (current canonical)
        rows.append(PairRow(
            a_id=key[0], b_id=key[1],
            a_name=r2["a_name"], b_name=r2["b_name"],
            v1_score=r1["final"], v2_score=r2["final"],
            v1_rank=v1_rank[key], v2_rank=v2_rank[key],
            v1_readiness_mod=r1["rmod"], v2_readiness_mod=r2["rmod"],
            v1_compat=r1["compat"], v2_compat=r2["compat"],
            v1_vec=r1["vec"], v2_vec=r2["vec"],
            v1_struct=r1["struct"], v2_struct=r2["struct"],
            v1_trust=r1["trust"], v2_trust=r2["trust"],
            v1_trust_reason=r1["trust_reason"], v2_trust_reason=r2["trust_reason"],
            v1_readiness_a=r1["ra"], v1_readiness_b=r1["rb"],
            v2_readiness_a=r2["ra"], v2_readiness_b=r2["rb"],
        ))
    rows.sort(key=lambda r: r.v1_rank)
    return rows


def load_truth(data: dict):
    """Return mutual-pick pairs and one-way-pick pairs from raw data."""
    picks_by_guest: dict[str, set] = {}
    for aff in data.get("guestAffinities", []):
        fr = aff.get("fromGuestId")
        to = aff.get("toGuestId")
        if fr and to:
            picks_by_guest.setdefault(fr, set()).add(to)
    for fb in data.get("feedback", []):
        gid = fb.get("guestId")
        if not gid:
            continue
        for tid in (fb.get("spendTimeWithGuestIds") or []):
            picks_by_guest.setdefault(gid, set()).add(tid)

    mutual = set()
    oneway = set()
    all_ids = set(picks_by_guest.keys()) | {t for s in picks_by_guest.values() for t in s}
    for a in all_ids:
        for b in all_ids:
            if a >= b:
                continue
            a_b = b in picks_by_guest.get(a, set())
            b_a = a in picks_by_guest.get(b, set())
            pair = (a, b)
            if a_b and b_a:
                mutual.add(pair)
            elif a_b or b_a:
                oneway.add(pair)
    return mutual, oneway


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def format_diff_table(rows: List[PairRow]) -> str:
    L = []
    L.append("")
    L.append("V1 vs V2 SCORE DIFF  (sorted by V1 rank)")
    L.append("=" * 100)
    header = f"{'PAIR':<48}{'V1_SCORE':>10}{'V2_SCORE':>10}{'DELTA':>8}{'V1_RANK':>9}{'V2_RANK':>9}"
    L.append(header)
    L.append("-" * 100)
    for r in rows:
        pair = f"{r.a_name[:22]} <-> {r.b_name[:22]}"
        delta = r.v2_score - r.v1_score
        L.append(
            f"{pair:<48}{r.v1_score:>10.2f}{r.v2_score:>10.2f}{delta:>+8.2f}"
            f"{'#'+str(r.v1_rank):>9}{'#'+str(r.v2_rank):>9}"
        )
    return "\n".join(L)


def format_component_breakdown(rows: List[PairRow], v1_people, v2_people) -> str:
    L = []
    L.append("")
    L.append("COMPONENT BREAKDOWNS  (pairs where |score delta| > 2 OR |rank delta| > 3)")
    L.append("=" * 100)

    v1_by_id = {p.id: p for p in v1_people}
    v2_by_id = {p.id: p for p in v2_people}

    flagged = [r for r in rows
               if abs(r.v2_score - r.v1_score) > 2.0 or abs(r.v2_rank - r.v1_rank) > 3]

    for r in flagged:
        L.append("")
        L.append(f"{r.a_name[:30]} <-> {r.b_name[:30]}  (V1 #{r.v1_rank} / V2 #{r.v2_rank})")
        L.append("-" * 100)
        L.append(
            f"  V1: R={r.v1_readiness_mod:.3f} x C={r.v1_compat:.3f} x T={r.v1_trust:.3f} "
            f"x B={SAME_EVENT_BOOST:.2f} = score {r.v1_score:.2f}"
        )
        L.append(
            f"  V2: R={r.v2_readiness_mod:.3f} x C={r.v2_compat:.3f} x T={r.v2_trust:.3f} "
            f"x B={SAME_EVENT_BOOST:.2f} = score {r.v2_score:.2f}"
        )
        L.append(f"  (readiness A: V1={r.v1_readiness_a:.1f}  V2={r.v2_readiness_a:.1f})")
        L.append(f"  (readiness B: V1={r.v1_readiness_b:.1f}  V2={r.v2_readiness_b:.1f})")
        L.append(f"  (vec_sim:  V1={r.v1_vec:.4f}  V2={r.v2_vec:.4f})")
        L.append(f"  (struct:   V1={r.v1_struct:.4f}  V2={r.v2_struct:.4f})")
        L.append(f"  (trust:    V1={r.v1_trust:.2f} [{r.v1_trust_reason}]  V2={r.v2_trust:.2f} [{r.v2_trust_reason}])")

        # biggest component delta
        deltas = {
            "R": r.v2_readiness_mod - r.v1_readiness_mod,
            "C": r.v2_compat - r.v1_compat,
            "T": r.v2_trust - r.v1_trust,
        }
        biggest = max(deltas.items(), key=lambda kv: abs(kv[1]))
        L.append(f"  Biggest delta: {biggest[0]} changed by {biggest[1]:+.3f}")

    if not flagged:
        L.append("  (no pairs exceeded thresholds)")
    return "\n".join(L)


def format_person_readiness(v1_people, v2_people) -> str:
    L = []
    L.append("")
    L.append("READINESS PER PERSON  (V1 vs V2)")
    L.append("=" * 100)
    L.append(f"{'Name':<35}{'V1_read':>10}{'V2_read':>10}{'DELTA':>10}"
             f"{'V1_brav_src':>14}{'V2_brav_src':>14}")
    L.append("-" * 100)

    v2_by_id = {p.id: p for p in v2_people}
    v1_people_sorted = sorted(v1_people, key=lambda p: p.readiness_score, reverse=True)
    for v1p in v1_people_sorted:
        v2p = v2_by_id.get(v1p.id)
        if not v2p:
            continue
        v1b = v1_compute_bravery(v1p)
        # V2 bravery is computed against full personality_text blob
        from .score import compute_bravery as v2_bravery_fn
        v2b = v2_bravery_fn(v2p)
        delta = v2p.readiness_score - v1p.readiness_score
        L.append(
            f"{v1p.display_name[:34]:<35}"
            f"{v1p.readiness_score:>10.2f}{v2p.readiness_score:>10.2f}{delta:>+10.2f}"
            f"{v1b:>14.3f}{v2b:>14.3f}"
        )
    L.append("")
    L.append("  V1_brav_src = bravery computed from socialBravery field ONLY")
    L.append("  V2_brav_src = bravery computed from full personality_text blob")
    return "\n".join(L)


def format_accuracy(rows: List[PairRow], data: dict) -> str:
    L = []
    mutual, oneway = load_truth(data)

    def top10_accuracy(sort_key: str):
        ranked = sorted(rows, key=lambda r: getattr(r, sort_key), reverse=True)[:10]
        confirmed = 0
        mutual_caught = []
        for r in ranked:
            pair = (r.a_id, r.b_id) if r.a_id < r.b_id else (r.b_id, r.a_id)
            if pair in mutual:
                confirmed += 1
                mutual_caught.append((r.a_name, r.b_name))
            elif pair in oneway:
                confirmed += 1
        return confirmed, mutual_caught, ranked

    v1_acc, v1_mutual, v1_top = top10_accuracy("v1_score")
    v2_acc, v2_mutual, v2_top = top10_accuracy("v2_score")

    # rank of each mutual pair
    def rank_of_mutuals(sort_key: str):
        ranked = sorted(rows, key=lambda r: getattr(r, sort_key), reverse=True)
        rmap = {}
        for i, r in enumerate(ranked, 1):
            pair = (r.a_id, r.b_id) if r.a_id < r.b_id else (r.b_id, r.a_id)
            rmap[pair] = (i, r.a_name, r.b_name)
        out = []
        for pair in mutual:
            if pair in rmap:
                out.append(rmap[pair])
        return sorted(out, key=lambda x: x[0])

    L.append("")
    L.append("ACCURACY SUMMARY")
    L.append("=" * 100)
    L.append(f"  V1 top-10 accuracy: {v1_acc}/10")
    L.append(f"  V2 top-10 accuracy: {v2_acc}/10")
    L.append(f"  Mutual picks total: {len(mutual)}")
    L.append("")
    L.append("  Mutual pair ranks:")
    L.append(f"    {'PAIR':<60}{'V1_RANK':>10}{'V2_RANK':>10}")
    v1_ranks = {(n1, n2): r for r, n1, n2 in rank_of_mutuals("v1_score")}
    v2_ranks = {(n1, n2): r for r, n1, n2 in rank_of_mutuals("v2_score")}
    for (r1, n1, n2) in rank_of_mutuals("v1_score"):
        r2 = v2_ranks.get((n1, n2), "?")
        pair = f"{n1[:28]} <-> {n2[:28]}"
        L.append(f"    {pair:<60}{'#'+str(r1):>10}{'#'+str(r2):>10}")
    return "\n".join(L)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    if len(sys.argv) < 2:
        print("Usage: diagnose.py <event.json> [--full]", file=sys.stderr)
        sys.exit(1)
    path = sys.argv[1]
    blind = "--full" not in sys.argv

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Preserve original for truth lookup
    original = copy.deepcopy(data)

    v1_people, v1_results = run_v1(data, blind=blind)
    v2_people, v2_results = run_v2(data, blind=blind)

    rows = diff_rows(v1_results, v2_results)

    out_lines = []
    out_lines.append("=" * 100)
    out_lines.append(f"PEOPLERANK v2 REGRESSION DIAGNOSTIC")
    out_lines.append(f"Input:  {path}")
    out_lines.append(f"Mode:   {'BLIND (post-event stripped)' if blind else 'FULL'}")
    out_lines.append(f"People: V1={len(v1_people)}  V2={len(v2_people)}")
    out_lines.append("=" * 100)

    out_lines.append(format_person_readiness(v1_people, v2_people))
    out_lines.append(format_diff_table(rows))
    out_lines.append(format_component_breakdown(rows, v1_people, v2_people))
    out_lines.append(format_accuracy(rows, original))

    output = "\n".join(out_lines) + "\n"
    print(output)

    stem = Path(path).stem
    out_path = Path(f"diagnostic-{stem}.txt")
    out_path.write_text(output, encoding="utf-8")
    print(f"[wrote {out_path}]")


if __name__ == "__main__":
    main()
