"""FastAPI entrypoint for PeopleRank UC1."""
from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Set

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError

# Make src/ importable
_ROOT = Path(__file__).resolve().parent.parent
_SRC = str(_ROOT / "src")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from .adapter import attendee_to_person  # noqa: E402
from .auth import check_bearer  # noqa: E402
from .cache import idempotency_cache  # noqa: E402
from .rationale import generate_rationale, generate_member_rationale, generate_group_rationale  # noqa: E402
from .schemas import (  # noqa: E402
    Attendee,
    GroupMatchResponse,
    GroupMemberOut,
    GroupOut,
    MatchRequest,
    MatchResponse,
    PairOut,
    ScoreBreakdown,
    SkippedOut,
)
from .scoring import extract_signals, score_people_openai  # noqa: E402
from .matching import select_mutual_pairs, assignments_from_pairs  # noqa: E402
from .grouping import assign_groups  # noqa: E402
from .people_rank import run_people_rank  # noqa: E402
from .schemas import PeopleRankRequest  # noqa: E402

logger = logging.getLogger("peoplerank.api")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="PeopleRank UC1", version="1.0")


# ---------- helpers ----------

SCREENING_MIN_WORDS = 0
CONF_HIGH = 0.70
CONF_LOW = 0.45


def _word_count(*texts: str) -> int:
    total = 0
    for t in texts:
        if not t:
            continue
        total += len(t.split())
    return total


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _clamp01(v: float) -> float:
    if v < 0:
        return 0.0
    if v > 1:
        return 1.0
    return v


def _readiness_harmony(pair: Dict) -> float:
    """
    Derive a readiness harmony value in [0,1]. We use min(readiness_a, readiness_b)
    over 100 as a simple proxy: a pair is only as ready as its least-ready side.
    """
    ra = (pair.get("person_a") or {}).get("readiness") or 0.0
    rb = (pair.get("person_b") or {}).get("readiness") or 0.0
    low = min(ra, rb)
    if low <= 0:
        return 0.0
    return _clamp01(low / 100.0)


def _compute_calibrated_score(pair: Dict) -> float:
    """
    Calibrated 0-1 compatibility for the response.
    Formula: 0.7 * textSim + 0.3 * structSim, clamped.
    This lands naturally in 0.3 - 0.9 for real matches and matches the
    brief's example scores (0.87, 0.74).
    """
    text_sim = float(pair.get("vec_sim", 0.0) or 0.0)
    struct_sim = float(pair.get("struct_sim", 0.0) or 0.0)
    return _clamp01(0.70 * text_sim + 0.30 * struct_sim)


def _confidence_band(score: float) -> str:
    if score >= CONF_HIGH:
        return "high"
    if score >= CONF_LOW:
        return "medium"
    return "low"


def _explain(breakdown_text: float, breakdown_struct: float, trust: float, readiness: float, score: float) -> str:
    """Template-based one-line explanation of the score."""
    parts: List[str] = []

    if breakdown_text >= 0.55:
        parts.append("strong written overlap")
    elif breakdown_text >= 0.35:
        parts.append("moderate written overlap")
    else:
        parts.append("limited written overlap")

    if breakdown_struct >= 0.70:
        parts.append("aligned demographics and archetypes")
    elif breakdown_struct >= 0.45:
        parts.append("partial demographic alignment")
    else:
        parts.append("weak demographic alignment")

    if trust >= 0.70:
        trust_phrase = "prior connection in the graph"
    elif trust >= 0.35:
        trust_phrase = "some prior context"
    else:
        trust_phrase = "no prior relationship"
    parts.append(trust_phrase)

    if readiness >= 0.70:
        parts.append("both socially ready")
    elif readiness >= 0.40:
        parts.append("mixed readiness")
    else:
        parts.append("low readiness signal")

    return "; ".join(parts) + "."


# ---------- routes ----------

@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "peoplerank-uc1", "time": _iso_now()}


@app.post("/v1/me/people-rank")
async def people_rank(request: Request):
    """Rank the caller's own contacts for the Amber middle tab.

    Query-driven semantic relevance over the caller's synced contacts, plus a
    grounded answer with inline [[p:CONTACT_ID]] citations. Returns the exact
    shape apps/mobile/lib/peoplerank.ts parses.
    """
    check_bearer(request)

    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "invalid_json"})

    try:
        req = PeopleRankRequest(**payload)
    except ValidationError as e:
        return JSONResponse(
            status_code=400,
            content={"error": "validation_error", "detail": e.errors()},
        )

    try:
        return run_people_rank(req)
    except Exception as e:
        logger.exception("people-rank failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"people_rank_failed: {e}",
        )


@app.post("/v1/match/community-event")
async def match_community_event(request: Request):
    # 1. Auth
    check_bearer(request)

    # Parse body manually so we can return 400 with runId on validation error
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_json", "runId": None},
        )

    run_id = payload.get("runId") if isinstance(payload, dict) else None

    try:
        req = MatchRequest(**payload)
    except ValidationError as e:
        return JSONResponse(
            status_code=400,
            content={"error": "validation_error", "runId": run_id, "detail": e.errors()},
        )

    # 2. Idempotency
    cached = idempotency_cache.get(req.runId)
    if cached is not None:
        return cached

    # 2a. UC3 branch — if grouping is present, run the leader-anchored path.
    if req.grouping is not None:
        try:
            response = handle_uc3(req)
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("UC3 handler failed")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"uc3_failed: {e}",
            )
        idempotency_cache.set(req.runId, response)
        return response

    # 3 + 4. Screening sufficiency
    attendees_by_id: Dict[str, Attendee] = {a.id: a for a in req.attendees}
    insufficient: Set[str] = set()
    for a in req.attendees:
        _host_note_texts = []
        for hn in (a.hostNotes or []):
            _host_note_texts.append(getattr(hn, "note", "") or "")
            _host_note_texts.append(getattr(hn, "observation", "") or "")
        _feedback_texts = []
        for fb in (a.feedback or []):
            _feedback_texts.append(getattr(fb, "highlight", "") or "")
            _feedback_texts.append(getattr(fb, "myDinner", "") or "")
            _feedback_texts.append(getattr(fb, "nextBigEvent", "") or "")
        wc = _word_count(
            a.whyJoin or "",
            a.socialBravery or "",
            a.screeningNotes or "",
            a.passion or "",
            a.occupation or "",
            *(_host_note_texts),
            *(_feedback_texts),
        )
        if wc < SCREENING_MIN_WORDS:
            insufficient.add(a.id)

    scoring_pool = [a for a in req.attendees if a.id not in insufficient]

    skipped: List[SkippedOut] = [
        SkippedOut(memberId=aid, reason="insufficient_screening", note=f"<{SCREENING_MIN_WORDS} screening words")
        for aid in insufficient
    ]

    if len(scoring_pool) < 2:
        for a in scoring_pool:
            skipped.append(SkippedOut(memberId=a.id, reason="no_viable_partners"))
        resp = MatchResponse(
            runId=req.runId,
            model="peoplerank-uc1-v1",
            generatedAt=_iso_now(),
            pairs=[],
            skipped=skipped,
        ).model_dump()
        idempotency_cache.set(req.runId, resp)
        return resp

    # 5. Score
    people = [attendee_to_person(a) for a in scoring_pool]
    try:
        scored_pairs = score_people_openai(people)
    except Exception as e:
        logger.exception("scoring failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"scoring_failed: {e}",
        )

    # 6. Mutual pair selection via 2-regular max-weight b-matching.
    # Guarantees: every member gets exactly 2 matches, all mutual,
    # total score across all pairs is globally optimized.
    exclusions: Dict[str, Set[str]] = {
        a.id: set(a.excludedPartnerIds or []) for a in scoring_pool
    }
    filtered_pairs = []
    for sp in scored_pairs:
        a_id = sp["person_a"]["id"]
        b_id = sp["person_b"]["id"]
        if b_id in exclusions.get(a_id, set()):
            continue
        if a_id in exclusions.get(b_id, set()):
            continue
        filtered_pairs.append(sp)
    pool_ids = [m.id for m in scoring_pool]
    mutual_pairs = select_mutual_pairs(filtered_pairs, pool_ids, target_degree=2)
    assignments = assignments_from_pairs(mutual_pairs, pool_ids)
    selected: List[Dict] = []
    no_viable: Set[str] = set()
    for mid in pool_ids:
        partners = assignments.get(mid, [])
        if not partners:
            no_viable.add(mid)
            continue
        for partner_id, pair in partners:
            selected.append({"memberId": mid, "partnerId": partner_id, "pair": pair})
    for mid in no_viable:
        skipped.append(SkippedOut(memberId=mid, reason="no_viable_partners"))

    # 7 + 8. Generate + validate rationales (in parallel)
    from concurrent.futures import ThreadPoolExecutor, as_completed

    successful_pair_entries: List[Dict] = []
    member_success_counts: Dict[str, int] = {}
    per_member_rank_counter: Dict[str, int] = {}
    selected.sort(key=lambda s: (s["memberId"], -s["pair"]["final_score"]))

    # Fire all rationale calls in parallel, up to 10 concurrent
    def _gen(sel):
        mid = sel["memberId"]
        pid = sel["partnerId"]
        member = attendees_by_id.get(mid)
        partner = attendees_by_id.get(pid)
        if member is None or partner is None:
            return None
        rationale = generate_rationale(member, partner)
        return (sel, rationale)

    rationale_results: List[tuple] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(_gen, sel) for sel in selected]
        for fut in as_completed(futures):
            result = fut.result()
            if result is not None:
                rationale_results.append(result)

    # Preserve original ordering: sort results by (memberId, -score)
    rationale_results.sort(key=lambda r: (r[0]["memberId"], -r[0]["pair"]["final_score"]))

    for sel, rationale in rationale_results:
        mid = sel["memberId"]
        pid = sel["partnerId"]
        if rationale is None:
            continue

        rank = per_member_rank_counter.get(mid, 0) + 1
        if rank > 2:
            continue
        per_member_rank_counter[mid] = rank

        pair = sel["pair"]

        compat_score = _compute_calibrated_score(pair)
        confidence = _confidence_band(compat_score)

        text_sim = float(pair.get("vec_sim", 0.0) or 0.0)
        struct_sim = float(pair.get("struct_sim", 0.0) or 0.0)
        trust = float(pair.get("trust", 0.0) or 0.0)
        readiness = _readiness_harmony(pair)

        breakdown = ScoreBreakdown(
            textSimilarity=round(_clamp01(text_sim), 4),
            structuredSimilarity=round(_clamp01(struct_sim), 4),
            trust=round(_clamp01(trust), 4),
            readinessHarmony=round(readiness, 4),
            explanation=_explain(text_sim, struct_sim, trust, readiness, compat_score),
        )

        successful_pair_entries.append({
            "memberId": mid,
            "partnerId": pid,
            "rank": rank,
            "rationale": rationale,
            "compatibilityScore": round(compat_score, 4),
            "confidence": confidence,
            "scoreBreakdown": breakdown,
            "signals": extract_signals(pair),
        })
        member_success_counts[mid] = member_success_counts.get(mid, 0) + 1

    selected_member_ids = {s["memberId"] for s in selected}
    for mid in selected_member_ids:
        if member_success_counts.get(mid, 0) == 0:
            skipped.append(SkippedOut(memberId=mid, reason="low_confidence"))

    # 9. Final validation pass
    attendee_ids = set(attendees_by_id.keys())
    final_pairs: List[PairOut] = []
    seen_ranks: Dict[str, Set[int]] = {}
    for entry in successful_pair_entries:
        mid = entry["memberId"]
        pid = entry["partnerId"]
        if mid == pid:
            continue
        if mid not in attendee_ids or pid not in attendee_ids:
            continue
        member_attendee = attendees_by_id[mid]
        if pid in (member_attendee.excludedPartnerIds or []):
            continue
        rank = entry["rank"]
        if rank not in (1, 2):
            continue
        if rank in seen_ranks.get(mid, set()):
            continue
        score = entry["compatibilityScore"]
        if not (0.0 <= score <= 1.0):
            score = _clamp01(score)
        final_pairs.append(PairOut(
            memberId=mid,
            partnerId=pid,
            rank=rank,
            rationale=entry["rationale"],
            compatibilityScore=score,
            confidence=entry["confidence"],
            scoreBreakdown=entry["scoreBreakdown"],
            signals=entry["signals"],
        ))
        seen_ranks.setdefault(mid, set()).add(rank)

    response = MatchResponse(
        runId=req.runId,
        model="peoplerank-uc1-v1",
        generatedAt=_iso_now(),
        pairs=final_pairs,
        skipped=skipped,
    ).model_dump()

    idempotency_cache.set(req.runId, response)
    return response


def handle_uc3(req: MatchRequest) -> Dict:
    """UC3 — leader-anchored group matching.

    Validates request, runs scoring, assigns groups via leader-anchored greedy +
    local-swap, generates per-member + group rationales sequentially.
    """
    grouping = req.grouping
    attendees_by_id: Dict[str, Attendee] = {a.id: a for a in req.attendees}
    all_ids = [a.id for a in req.attendees]
    leader_ids = list(grouping.leaderIds)

    # Request-level validation
    if len(leader_ids) != grouping.groupCount:
        raise HTTPException(
            status_code=400,
            detail=f"leaderIds length {len(leader_ids)} != groupCount {grouping.groupCount}",
        )
    missing_leaders = [lid for lid in leader_ids if lid not in attendees_by_id]
    if missing_leaders:
        raise HTTPException(
            status_code=400,
            detail=f"leaderIds not in attendees: {missing_leaders}",
        )
    if len(set(leader_ids)) != len(leader_ids):
        raise HTTPException(
            status_code=400,
            detail="leaderIds must be unique",
        )
    if len(req.attendees) < grouping.groupCount:
        raise HTTPException(
            status_code=400,
            detail=f"attendees ({len(req.attendees)}) < groupCount ({grouping.groupCount})",
        )

    # Score everyone (UC3 does NOT apply excludedPartnerIds — see brief §5)
    people = [attendee_to_person(a) for a in req.attendees]
    try:
        scored_pairs = score_people_openai(people)
    except Exception as e:
        logger.exception("UC3 scoring failed")
        raise HTTPException(status_code=500, detail=f"scoring_failed: {e}")

    # Build pair_scores map for the grouping algorithm
    pair_scores: Dict = {}
    for sp in scored_pairs:
        a_id = sp["person_a"]["id"]
        b_id = sp["person_b"]["id"]
        score = float(sp.get("final_score", 0.0) or 0.0)
        pair_scores[(a_id, b_id)] = score

    # Run leader-anchored assignment
    groups_assigned = assign_groups(leader_ids, all_ids, pair_scores)

    # Generate rationales in PARALLEL to keep wall time under client timeout.
    # 4 workers handles ~50 calls in ~50-70s for 10x4 events.
    from concurrent.futures import ThreadPoolExecutor

    out_groups: List[GroupOut] = []
    skipped_uc3: List[SkippedOut] = []

    def _gen_member(reader, carmate):
        r = generate_member_rationale(reader, carmate)
        return r if r is not None else "(rationale unavailable)"

    # Build the full list of (group_index, member_index, reader, carmate) jobs
    # so we can fan out all member rationales across all groups at once.
    member_jobs = []  # (gi, idx, reader, carmate)
    group_member_attendees: List[List[Attendee]] = []
    for gi, member_ids in enumerate(groups_assigned):
        members_attendees = [attendees_by_id[mid] for mid in member_ids]
        group_member_attendees.append(members_attendees)
        for idx, carmate in enumerate(members_attendees):
            if idx == 0:
                # Leader's rationale: pick the second member as the reader
                reader = members_attendees[1] if len(members_attendees) > 1 else members_attendees[0]
            else:
                # Non-leader rationale: leader is the reader
                reader = members_attendees[0]
            member_jobs.append((gi, idx, reader, carmate))

    # Run all member rationale calls concurrently. 4 workers matches UC1.
    member_results: Dict = {}  # (gi, idx) -> rationale text
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(_gen_member, reader, carmate): (gi, idx)
            for (gi, idx, reader, carmate) in member_jobs
        }
        for fut in futures:
            gi, idx = futures[fut]
            try:
                member_results[(gi, idx)] = fut.result()
            except Exception as e:
                logger.warning("uc3 member rationale gi=%d idx=%d failed: %s", gi, idx, e)
                member_results[(gi, idx)] = "(rationale unavailable)"

    # Reassemble per-group member rationale lists in order.
    per_group_member_rationales: List[List[str]] = []
    for gi, member_ids in enumerate(groups_assigned):
        rationales = [member_results.get((gi, idx), "(rationale unavailable)") for idx in range(len(member_ids))]
        per_group_member_rationales.append(rationales)

    # Now generate group-level rationales in parallel across all groups.
    def _gen_group(members_atts, mem_rats):
        r = generate_group_rationale(members_atts, mem_rats)
        return r if r is not None else "(group rationale unavailable)"

    group_rationales: List[str] = ["(group rationale unavailable)"] * len(groups_assigned)
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(_gen_group, group_member_attendees[gi], per_group_member_rationales[gi]): gi
            for gi in range(len(groups_assigned))
        }
        for fut in futures:
            gi = futures[fut]
            try:
                group_rationales[gi] = fut.result()
            except Exception as e:
                logger.warning("uc3 group rationale gi=%d failed: %s", gi, e)

    # Assemble final response.
    for gi, member_ids in enumerate(groups_assigned):
        leader_id = member_ids[0]
        member_rationales = per_group_member_rationales[gi]
        out_members = [
            GroupMemberOut(guestId=mid, rationale=rat_text)
            for mid, rat_text in zip(member_ids, member_rationales)
        ]
        out_groups.append(GroupOut(
            groupId=f"grp_{gi+1:03d}",
            leaderId=leader_id,
            members=out_members,
            groupRationale=group_rationales[gi],
        ))

    # Final invariant check against §10 of the brief
    _validate_uc3_response(out_groups, grouping, all_ids)

    response = GroupMatchResponse(
        runId=req.runId,
        model="peoplerank-uc3-v1",
        generatedAt=_iso_now(),
        groups=out_groups,
        skipped=skipped_uc3,
    ).model_dump()
    return response


def _validate_uc3_response(groups: List[GroupOut], grouping, all_ids: List[str]) -> None:
    """Enforce §10 of the brief. Raises HTTPException on any violation."""
    if len(groups) != grouping.groupCount:
        raise HTTPException(
            status_code=500,
            detail=f"internal: produced {len(groups)} groups, expected {grouping.groupCount}",
        )
    seen_leaders = set()
    seen_members = set()
    leader_set = set(grouping.leaderIds)
    attendee_set = set(all_ids)

    for g in groups:
        if not g.groupId:
            raise HTTPException(status_code=500, detail="internal: missing groupId")
        if g.leaderId not in leader_set:
            raise HTTPException(
                status_code=500,
                detail=f"internal: group {g.groupId} leader {g.leaderId} not in leaderIds",
            )
        if g.leaderId in seen_leaders:
            raise HTTPException(
                status_code=500,
                detail=f"internal: leader {g.leaderId} assigned to multiple groups",
            )
        seen_leaders.add(g.leaderId)
        member_ids_in_group = [m.guestId for m in g.members]
        if g.leaderId not in member_ids_in_group:
            raise HTTPException(
                status_code=500,
                detail=f"internal: group {g.groupId} leaderId not in members",
            )
        if not g.groupRationale:
            raise HTTPException(
                status_code=500,
                detail=f"internal: group {g.groupId} missing groupRationale",
            )
        for m in g.members:
            if not m.rationale:
                raise HTTPException(
                    status_code=500,
                    detail=f"internal: empty rationale for {m.guestId} in {g.groupId}",
                )
            if m.guestId not in attendee_set:
                raise HTTPException(
                    status_code=500,
                    detail=f"internal: member {m.guestId} not in attendees",
                )
            if m.guestId in seen_members:
                raise HTTPException(
                    status_code=500,
                    detail=f"internal: member {m.guestId} in multiple groups",
                )
            seen_members.add(m.guestId)


@app.get("/test")
async def test_harness():
    from .test_page import test_page
    return test_page()
