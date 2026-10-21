"""Adapter: UC1 Attendee payload -> peoplerank.ingestion.Person objects."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import List

# Make src/ importable
_ROOT = Path(__file__).resolve().parent.parent
_SRC = str(_ROOT / "src")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from peoplerank.ingestion import Person  # noqa: E402

from .schemas import Attendee, MatchRequest  # noqa: E402


def attendee_to_person(a: Attendee) -> Person:
    """Map a UC1 Attendee to the algorithm's Person dataclass."""
    occupation = a.occupation or ""
    city = a.city or ""
    archetype_joined = ", ".join(a.guestArchetype) if a.guestArchetype else ""

    identity_text = " ".join(x for x in [occupation, city, archetype_joined] if x)
    personality_text = " ".join(x for x in [a.socialBravery or "", archetype_joined] if x)

    host_notes_joined = " ".join(hn.notes for hn in a.hostNotes if hn.notes)
    highlights_joined = " ".join((f.highlight or "") for f in a.feedback)
    mydinner_joined = " ".join((f.myDinner or "") for f in a.feedback)
    experience_text = " ".join(
        x for x in [
            a.screeningNotes or "",
            host_notes_joined,
            highlights_joined,
            mydinner_joined,
        ] if x
    )

    next_big_event_joined = " ".join((f.nextBigEvent or "") for f in a.feedback)
    interest_text = " ".join(
        x for x in [a.whyJoin or "", a.passion or "", next_big_event_joined] if x
    )

    attendance_ratio = 1.0 if a.eventsAttended else 0.0
    feedback_ratio = min(
        len(a.feedback) / max(len(a.eventsAttended), 1), 1.0
    )

    p = Person(
        id=a.id,
        display_name=a.id,
        age=a.age,
        gender=a.gender,
        city=a.city,
        occupation=a.occupation,
        role_type=a.guestType,
        identity_text=identity_text,
        personality_text=personality_text,
        experience_text=experience_text,
        interest_text=interest_text,
        bravery_text=a.socialBravery or "",
        attendance_ratio=attendance_ratio,
        feedback_ratio=feedback_ratio,
        qualification_score=None,
        readiness_score=0.0,  # score.py will recompute
        connections=[],
        hangout_flag=False,
        one_liner=(a.occupation or "")[:60],
        raw_source=a.model_dump(),
    )
    return p


def uc1_request_to_people(req: MatchRequest, exclude_ids: set[str] | None = None) -> List[Person]:
    """Build Person list, optionally excluding ids (e.g. insufficient screening)."""
    exclude_ids = exclude_ids or set()
    return [attendee_to_person(a) for a in req.attendees if a.id not in exclude_ids]
