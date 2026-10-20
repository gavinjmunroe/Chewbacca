"""
PeopleRank v2 — Schema-Agnostic Ingestion Layer

Maps arbitrary input data to the 5 signal categories the algorithm operates on.
The scoring algorithm never references Blind8-specific field names directly — it
only operates on the normalized Person objects produced by this module.

Two source adapters:
  1. blind8_adapter   — Takes Blind8 event JSON → List[Person]
  2. generic_adapter   — Takes any JSON + mapping config → List[Person]
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Person dataclass — the universal record the algorithm operates on
# ---------------------------------------------------------------------------

@dataclass
class Person:
    id: str
    display_name: str  # short readable name for output

    # Identity signals (demographic / structural facts)
    age: Optional[int] = None
    gender: Optional[str] = None
    city: Optional[str] = None
    occupation: Optional[str] = None
    role_type: Optional[str] = None  # storyteller/investigator/listener OR partner-defined

    # Text sources for vectors
    identity_text: str = ""
    personality_text: str = ""
    experience_text: str = ""
    interest_text: str = ""

    # Isolated bravery source (matches only the socialBravery field, not the
    # concatenated personality blob). Used by compute_bravery so keyword
    # density stays discriminative.
    bravery_text: str = ""

    # Behavioral signals
    attendance_ratio: float = 0.5  # events attended / invited
    feedback_ratio: float = 0.0    # feedbacks submitted / events attended
    qualification_score: Optional[float] = None  # 0-100 if known
    readiness_score: float = 0.0   # computed by the algorithm

    # Social graph (list of edges out from this person)
    connections: List[Dict] = field(default_factory=list)
    # Each: {"to_id": str, "type": str, "weight": float}

    # Contextual
    hangout_flag: bool = False
    one_liner: str = ""  # human-readable blurb for output
    raw_source: Dict = field(default_factory=dict)  # keep original for debugging


# ---------------------------------------------------------------------------
# Occupation shortening
# ---------------------------------------------------------------------------

_ABBREV_MAP = {
    "real estate": "RE",
    "artificial intelligence": "AI",
    "machine learning": "ML",
    "software engineering": "SWE",
    "user experience": "UX",
    "product management": "PM",
}


def shorten_occupation(raw: str, limit: int = 25) -> str:
    if not raw:
        return ""
    text = raw.strip().rstrip(".")

    if len(text) <= limit:
        return text

    lower = text.lower()
    for long, short in _ABBREV_MAP.items():
        lower = lower.replace(long, short)
        text = re.sub(re.escape(long), short, text, flags=re.IGNORECASE)

    if len(text) <= limit:
        return text

    parts = re.split(r"[,;/&]+|\band\b|\bin\b", text)
    first = parts[0].strip()

    if len(parts) > 1:
        rest_words = []
        for p in parts[1:]:
            p = p.strip()
            if not p:
                continue
            words = p.split()
            if len(words) == 1:
                rest_words.append(words[0])
            else:
                abbr = " ".join(w[0].upper() for w in words if len(w) > 2)
                if abbr:
                    rest_words.append(abbr)
                else:
                    rest_words.append(words[0])

        if rest_words:
            rest_str = " & ".join(rest_words[:2])
            candidate = f"{first} ({rest_str})"
            if len(candidate) <= limit:
                return candidate

    if len(first) <= limit:
        return first
    return first[: limit - 1].rstrip() + "\u2026"


# ---------------------------------------------------------------------------
# One-liner extraction
# ---------------------------------------------------------------------------


def _extract_one_liner(texts: list[str], limit: int = 60) -> str:
    for source in texts:
        text = (source or "").strip()
        if not text or text.lower() in ("none", "null", "n/a"):
            continue

        text = re.sub(
            r"^(About them|Screener|Notes|Assessment)[:\-\s]+",
            "", text, flags=re.IGNORECASE,
        ).strip()

        if len(text) <= limit:
            return text

        sentences = re.split(r"(?<=[.!?])\s+", text)
        if sentences and len(sentences[0]) <= limit:
            return sentences[0].rstrip(".")

        clauses = re.split(r"[,;]\s*", text)
        built = clauses[0]
        for clause in clauses[1:]:
            if len(built) + 2 + len(clause) <= limit:
                built += ", " + clause
            else:
                break
        if len(built) <= limit:
            return built

        truncated = text[:limit]
        last_space = truncated.rfind(" ")
        if last_space > limit * 0.5:
            truncated = truncated[:last_space]
        return truncated.rstrip(".,;:- ") + "\u2026"

    return ""


# ---------------------------------------------------------------------------
# Helper: clean text
# ---------------------------------------------------------------------------


def _clean(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"\b(None|null|N/A|n/a|undefined)\b", "", text)
    return re.sub(r"\s+", " ", cleaned).strip()


# ---------------------------------------------------------------------------
# Helper: parse nested JSON strings
# ---------------------------------------------------------------------------


def _parse_host_notes(raw) -> dict:
    if not raw or not isinstance(raw, str):
        if isinstance(raw, dict):
            return raw
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
        return {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _parse_application_answers(raw) -> str:
    if not raw:
        return ""
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return raw
    else:
        parsed = raw

    if isinstance(parsed, dict):
        parts = []
        for k, v in parsed.items():
            if v and str(v).strip() and str(v).lower() not in ("none", "null", "n/a"):
                parts.append(f"{k}: {v}")
        return ". ".join(parts)
    elif isinstance(parsed, list):
        return ". ".join(str(item) for item in parsed if item)
    return str(parsed) if parsed else ""


# ---------------------------------------------------------------------------
# Adapter 1: Blind8
# ---------------------------------------------------------------------------


def blind8_adapter(data: dict, *, blind: bool = False) -> List[Person]:
    """
    Takes a Blind8 event JSON export → List[Person].

    If blind=True, strips affinities, feedback, and hostNotes before
    building Person objects (profile-only mode).
    """
    if blind:
        data = _strip_post_event(data)

    # --- Phase 1: parse guest basics ---
    guest_raw: dict[str, dict] = {}  # id → raw guest dict
    people: dict[str, Person] = {}

    for g in data.get("guests", []):
        gid = g.get("id", "")
        if not gid:
            continue
        guest_raw[gid] = g

        # Name
        name_parts = []
        for nf in ["firstName", "first_name", "name", "fullName", "full_name"]:
            if g.get(nf):
                name_parts.append(str(g[nf]))
                break
        for nf in ["lastName", "last_name"]:
            if g.get(nf):
                name_parts.append(str(g[nf]))
                break
        name = " ".join(name_parts) if name_parts else gid[:8]

        age_raw = g.get("age")
        age = None
        if age_raw is not None:
            try:
                age = int(age_raw)
            except (ValueError, TypeError):
                pass

        occ_raw = str(g.get("occupation", "") or "")
        guest_type = str(g.get("guestType", "") or g.get("guest_type", "") or "")
        why_join = str(g.get("whyJoin", "") or g.get("why_join", "") or "")
        social_bravery = str(g.get("socialBravery", "") or g.get("social_bravery", "") or "")
        passion = str(g.get("passion", "") or "")
        screening_notes = str(g.get("screeningNotes", "") or g.get("screening_notes", "") or "")
        notes = str(g.get("notes", "") or "")
        gender = str(g.get("gender", "") or "")
        city = str(g.get("city", "") or "")

        people[gid] = Person(
            id=gid,
            display_name=shorten_occupation(occ_raw) or name,
            age=age,
            gender=gender,
            city=city,
            occupation=occ_raw,
            role_type=guest_type,
            raw_source=g,
        )

        # Stash text sources temporarily (will be assembled after all data merged)
        # We'll keep the text pieces in raw_source for now and assemble after
        # enriching with applications/eventGuests/feedback
        people[gid]._screening_notes = screening_notes
        people[gid]._why_join = why_join
        people[gid]._social_bravery = social_bravery
        people[gid]._passion = passion
        people[gid]._notes = notes
        people[gid]._qualification_notes = ""
        people[gid]._application_answers = ""
        people[gid]._host_notes_raw = {}
        people[gid]._feedback_highlight = ""
        people[gid]._feedback_one_word = ""
        people[gid]._feedback_improvement = ""
        people[gid]._feedback_next_big_event = ""
        people[gid]._feedback_spend_time_with = []

    # --- Phase 2: applications ---
    for app in data.get("applications", []):
        gid = app.get("guestId", "") or app.get("guest_id", "")
        if gid not in people:
            continue
        score_raw = app.get("qualificationScore") or app.get("qualification_score")
        if score_raw is not None:
            try:
                people[gid].qualification_score = float(score_raw)
            except (ValueError, TypeError):
                pass
        people[gid]._qualification_notes = str(
            app.get("qualificationNotes", "") or app.get("qualification_notes", "") or ""
        )
        answers_raw = app.get("answers") or app.get("application_answers") or ""
        people[gid]._application_answers = _parse_application_answers(answers_raw)

    # --- Phase 3: eventGuests (attendance, hostNotes, hangout_flag) ---
    for eg in data.get("eventGuests", data.get("event_guests", [])):
        gid = eg.get("guestId", "") or eg.get("guest_id", "")
        if gid not in people:
            continue
        people[gid].attendance_ratio = 1.0  # attended this event

        host_notes_raw = eg.get("hostNotes") or eg.get("host_notes") or ""
        parsed = _parse_host_notes(host_notes_raw)
        people[gid]._host_notes_raw = parsed

        for key, obs in parsed.items():
            if isinstance(key, str) and key.endswith("_hangout"):
                if obs is True or obs == "true":
                    people[gid].hangout_flag = True
                    break
            if isinstance(obs, dict) and obs.get("hangout") is True:
                people[gid].hangout_flag = True
                break

    # --- Phase 4: feedback ---
    for fb in data.get("feedback", []):
        gid = fb.get("guestId", "") or fb.get("guest_id", "")
        if gid not in people:
            continue
        people[gid].feedback_ratio = 1.0  # submitted feedback
        people[gid]._feedback_highlight = str(fb.get("highlight", "") or "")
        people[gid]._feedback_one_word = str(fb.get("oneWord", "") or fb.get("one_word", "") or "")
        people[gid]._feedback_next_big_event = str(
            fb.get("nextBigEvent", "") or fb.get("next_big_event", "") or ""
        )
        people[gid]._feedback_improvement = str(fb.get("improvement", "") or "")
        spend_raw = fb.get("spendTimeWithGuestIds") or fb.get("spend_time_with_guest_ids") or []
        if isinstance(spend_raw, list):
            people[gid]._feedback_spend_time_with = spend_raw

    # --- Phase 5: assemble text buckets ---
    for p in people.values():
        # Identity text
        pi = []
        if p.occupation:
            pi.append(f"Occupation: {p.occupation}.")
        if p.city:
            pi.append(f"City: {p.city}.")
        if p.age is not None:
            pi.append(f"Age: {p.age}.")
        if p.role_type:
            pi.append(f"Guest type: {p.role_type}.")
        if p.gender:
            pi.append(f"Gender: {p.gender}.")
        p.identity_text = _clean(" ".join(pi))

        # Personality text
        pp = []
        if p._screening_notes:
            pp.append(f"About them: {p._screening_notes}.")
        if p._why_join:
            pp.append(f"Why they joined: {p._why_join}.")
        if p._social_bravery:
            pp.append(f"Social style: {p._social_bravery}.")
        if p._qualification_notes:
            pp.append(f"Screener assessment: {p._qualification_notes}.")
        if p._application_answers:
            pp.append(f"Application answers: {p._application_answers}.")
        if p._notes:
            pp.append(f"Notes: {p._notes}.")
        p.personality_text = _clean(" ".join(pp))

        # Isolated bravery source — ONLY the socialBravery field.
        p.bravery_text = _clean(p._social_bravery)

        # Experience text
        pe = []
        if p._host_notes_raw:
            obs_texts = []
            for key, obs in p._host_notes_raw.items():
                if isinstance(key, str) and key.endswith("_hangout"):
                    continue
                if isinstance(obs, dict):
                    obs_str = ". ".join(
                        f"{k}: {v}" for k, v in obs.items()
                        if v and k != "hangout"
                        and str(v).lower() not in ("none", "null", "false", "true", "")
                    )
                    if obs_str:
                        obs_texts.append(obs_str)
                elif isinstance(obs, str) and obs.strip():
                    obs_texts.append(obs)
            if obs_texts:
                pe.append(f"Observer notes: {'; '.join(obs_texts)}.")
        if p._feedback_highlight:
            pe.append(f"Best moments: {p._feedback_highlight}.")
        if p._feedback_one_word:
            pe.append(f"One word: {p._feedback_one_word}.")
        if p._feedback_improvement:
            pe.append(f"Improvements: {p._feedback_improvement}.")
        p.experience_text = _clean(" ".join(pe))

        # Interest text
        pn = []
        if p._passion:
            pn.append(f"Passions: {p._passion}.")
        if p._feedback_next_big_event:
            pn.append(f"Next big event: {p._feedback_next_big_event}.")
        if p._notes:
            pn.append(f"Notes: {p._notes}.")
        p.interest_text = _clean(" ".join(pn))

        # One-liner
        p.one_liner = _extract_one_liner([
            p._screening_notes, p._social_bravery, p._why_join,
        ])

    # --- Phase 6: connections from guestConnections + guestAffinities ---
    valid_ids = set(people.keys())

    for conn in data.get("guestConnections", data.get("guest_connections", [])):
        a = conn.get("guestIdA", "") or conn.get("guest_id_a", "")
        b = conn.get("guestIdB", "") or conn.get("guest_id_b", "")
        ctype = str(conn.get("connectionType", "") or conn.get("connection_type", "") or "")
        if a and b and a in valid_ids and b in valid_ids:
            weight = {"friends": 0.90, "referred_by": 0.80, "knows": 0.40}.get(ctype, 0.30)
            people[a].connections.append({"to_id": b, "type": ctype, "weight": weight})
            people[b].connections.append({"to_id": a, "type": ctype, "weight": weight})

    for aff in data.get("guestAffinities", data.get("guest_affinities", [])):
        from_id = aff.get("fromGuestId", "") or aff.get("from_guest_id", "")
        to_id = aff.get("toGuestId", "") or aff.get("to_guest_id", "")
        if from_id and to_id and from_id in valid_ids and to_id in valid_ids:
            people[from_id].connections.append({
                "to_id": to_id, "type": "affinity", "weight": 1.0,
            })

    # Also encode spendTimeWith as affinity-type connections
    for p in people.values():
        for tid in getattr(p, "_feedback_spend_time_with", []):
            if tid in valid_ids:
                p.connections.append({
                    "to_id": tid, "type": "spend_time_pick", "weight": 1.0,
                })

    # --- Clean up temp attributes ---
    for p in people.values():
        for attr in [
            "_screening_notes", "_why_join", "_social_bravery", "_passion",
            "_notes", "_qualification_notes", "_application_answers",
            "_host_notes_raw", "_feedback_highlight", "_feedback_one_word",
            "_feedback_improvement", "_feedback_next_big_event",
            "_feedback_spend_time_with",
        ]:
            if hasattr(p, attr):
                delattr(p, attr)

    return list(people.values())


def _strip_post_event(data: dict) -> dict:
    """
    Return a deep copy of data with all post-event signals removed:
      - guestAffinities → []
      - feedback → []
      - hostNotes nullified in every eventGuests entry
    """
    stripped = copy.deepcopy(data)
    stripped["guestAffinities"] = []
    stripped["guest_affinities"] = []
    stripped["feedback"] = []

    for key in ("eventGuests", "event_guests"):
        for eg in stripped.get(key, []):
            eg["hostNotes"] = None
            eg["host_notes"] = None

    return stripped


# ---------------------------------------------------------------------------
# Adapter 2: Generic (for non-Blind8 data)
# ---------------------------------------------------------------------------


def generic_adapter(json_data: dict, mapping_config: dict) -> List[Person]:
    """
    Takes any JSON blob + mapping config → List[Person].

    mapping_config = {
        "people_path": "contacts",       # key to the list of people
        "id_field": "id",
        "name_field": "name",
        "identity_fields": ["job_title", "location", "age"],
        "personality_fields": ["bio", "about", "description"],
        "interest_fields": ["interests", "passions", "hobbies"],
        "experience_fields": [],
        "connections_path": "connections", # optional
    }
    """
    people_path = mapping_config.get("people_path", "people")
    raw_people = json_data.get(people_path, [])
    if not isinstance(raw_people, list):
        raise ValueError(f"Expected a list at key '{people_path}', got {type(raw_people).__name__}")

    id_field = mapping_config.get("id_field", "id")
    name_field = mapping_config.get("name_field", "name")
    identity_fields = mapping_config.get("identity_fields", [])
    personality_fields = mapping_config.get("personality_fields", [])
    interest_fields = mapping_config.get("interest_fields", [])
    experience_fields = mapping_config.get("experience_fields", [])
    connections_path = mapping_config.get("connections_path")

    people: list[Person] = []

    for raw in raw_people:
        pid = str(raw.get(id_field, ""))
        if not pid:
            continue
        name = str(raw.get(name_field, pid[:8]))

        # Extract age if present
        age = None
        for f in identity_fields:
            if "age" in f.lower():
                try:
                    age = int(raw.get(f, 0))
                except (ValueError, TypeError):
                    pass
                break

        p = Person(
            id=pid,
            display_name=shorten_occupation(name) or name,
            age=age,
            city=str(raw.get("city", "") or raw.get("location", "") or ""),
            occupation=str(raw.get("occupation", "") or raw.get("job_title", "") or ""),
            role_type=str(raw.get("role_type", "") or raw.get("type", "") or ""),
            identity_text=_clean(" ".join(
                f"{f}: {raw.get(f, '')}" for f in identity_fields if raw.get(f)
            )),
            personality_text=_clean(" ".join(
                f"{f}: {raw.get(f, '')}" for f in personality_fields if raw.get(f)
            )),
            experience_text=_clean(" ".join(
                f"{f}: {raw.get(f, '')}" for f in experience_fields if raw.get(f)
            )),
            interest_text=_clean(" ".join(
                f"{f}: {raw.get(f, '')}" for f in interest_fields if raw.get(f)
            )),
            raw_source=raw,
        )

        # One-liner from personality or interest text
        liner_sources = [raw.get(f, "") for f in personality_fields[:3]]
        p.one_liner = _extract_one_liner(liner_sources)

        people.append(p)

    # Connections
    if connections_path and connections_path in json_data:
        people_by_id = {p.id: p for p in people}
        valid_ids = set(people_by_id.keys())
        for conn in json_data[connections_path]:
            from_id = str(conn.get("from", "") or conn.get("from_id", ""))
            to_id = str(conn.get("to", "") or conn.get("to_id", ""))
            ctype = str(conn.get("type", "knows"))
            weight = float(conn.get("weight", 0.5))
            if from_id in valid_ids and to_id in valid_ids:
                people_by_id[from_id].connections.append({
                    "to_id": to_id, "type": ctype, "weight": weight,
                })

    return people


# ---------------------------------------------------------------------------
# Auto-detection and dispatch
# ---------------------------------------------------------------------------


def ingest(data: dict, *, blind: bool = False) -> List[Person]:
    """
    Detect input format and route to the correct adapter.

    - If JSON has "guests" and "guestAffinities" keys → blind8_adapter
    - If JSON has "mapping_config" key → generic_adapter
    - Otherwise → error with helpful message
    """
    if "guests" in data and ("guestAffinities" in data or "guest_affinities" in data):
        return blind8_adapter(data, blind=blind)

    if "mapping_config" in data:
        config = data["mapping_config"]
        return generic_adapter(data, config)

    raise ValueError(
        "Unrecognized input format. Expected either:\n"
        "  1. Blind8 event JSON (must have 'guests' and 'guestAffinities' keys)\n"
        "  2. Generic JSON with a 'mapping_config' section describing field mappings\n"
        f"Got top-level keys: {list(data.keys())}"
    )
