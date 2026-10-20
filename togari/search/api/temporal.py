"""Shelf life: which facts are still true, and which have quietly expired.

THE PROBLEM. "Sagar is visiting San Francisco in a week and staying a month"
and "Sagar moved to San Francisco" are the same sentence to a ranker that only
sees text. One of them is true forever and one of them is true for five weeks.
Until now every fact reached this service undated, so both ranked identically
on a "who is in SF" query -- in November as confidently as in March. That is the
"stop telling me about it afterward" failure, and it is not a scoring-weight
problem: it is missing information plus a missing rule.

The information now arrives as `FactIn.observed_at` (when the fact was LEARNED,
which is not when the thing it describes happens). This module is the rule.

TWO USES, ONE SOURCE OF TRUTH. `staleness_multiplier` is the deterministic
Stage-2 down-weight, and `describe_age` / `transient_window_days` feed the same
judgement to Stage 1 in words. They agree by construction because they read the
same parser -- a filter that keeps someone whose only fact is expired, feeding a
scorer that then zeroes them, is just a slower way to return nothing.

CONSERVATIVE BY DESIGN. A fact is treated as perishable only when it SAYS it is
temporary. Anything else -- no marker, no date, a marker that also carries a
permanence cue ("moved to", "lives in") -- is left completely alone at 1.0. The
failure mode we accept is keeping a stale fact; the one we refuse is quietly
burying a true one.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional
import re

# How long an unqualified temporary presence is assumed to last when the fact
# names no duration. Two weeks: long enough to cover the ordinary "in town this
# week" and short enough that a trip nobody mentioned again goes quiet.
TRANSIENT_DEFAULT_DAYS = 14

# Applied once the claimed window has passed. Not zero -- an expired trip is
# still evidence the person travels there, which is a real if much weaker answer
# to "who do I know in Austin". Zero would also make this indistinguishable from
# "no such fact", which it is not.
STALE_EXPIRED_FACTOR = 0.30
# Long past the window (3x), it is history rather than a stale plan.
STALE_LONG_GONE_FACTOR = 0.10
STALE_LONG_GONE_MULTIPLE = 3

# A fact that SAYS it is temporary. These are the only facts that can expire.
_TRANSIENT_CUES = (
    "visiting", "visits", "visit to", "is visiting", "on a visit",
    "in town", "back in town", "into town", "comes to town",
    "passing through", "stopping by", "swinging by", "flying in", "flies in",
    "on a trip", "trip to", "trips to", "traveling to", "travelling to",
    "travelling", "traveling", "on the road",
    "here for", "in for", "staying", "stays with", "crashing",
    "on vacation", "on holiday", "on leave", "sabbatical",
    "layover", "in sf for", "conference in", "wedding in", "offsite",
    "house sitting", "subletting", "temporarily in", "for the summer",
)

# A fact that says it is NOT temporary. Checked first and wins outright: "moved
# to Austin, staying with his brother while he looks for a place" contains
# "staying" and is not a visit. A permanence cue means never perishable.
_PERSISTENT_CUES = (
    "moved to", "moving to", "relocated", "relocating", "lives in", "living in",
    "based in", "settled in", "settling in", "bought a house", "bought a place",
    "new job", "started at", "starting at", "works at", "working at",
    "grew up", "is from", "hometown", "married", "engaged", "had a baby",
    "graduated", "joined", "founded", "co-founded", "retired",
)

_NUMBER_WORDS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
    "twelve": 12, "couple": 2, "few": 3, "several": 4,
}
_UNIT_DAYS = {
    "day": 1, "days": 1,
    "night": 1, "nights": 1,
    "week": 7, "weeks": 7,
    "weekend": 3, "weekends": 3,
    "month": 30, "months": 30,
    "quarter": 91, "quarters": 91,
    "year": 365, "years": 365,
    "summer": 90, "winter": 90, "spring": 90, "fall": 90, "autumn": 90,
    "semester": 120, "semesters": 120,
}
_NUM = r"(?:\d{1,3}|" + "|".join(_NUMBER_WORDS) + r")"
_UNIT = r"(?:" + "|".join(_UNIT_DAYS) + r")"

# "for a month", "for two weeks", "staying 3 nights", "a month-long trip"
_DURATION_RE = re.compile(
    rf"\b(?:for|over|across|staying)\s+(?:the\s+|a\s+|an\s+)?(?:next\s+)?({_NUM})?\s*({_UNIT})\b"
    rf"|\b({_NUM})[\s-]*({_UNIT})[\s-]*(?:long\s+)?(?:trip|stay|visit|stint)\b",
    re.I,
)
# "in a week", "next month", "in three days" -- the lead-in before it STARTS.
# Added to the window because observed_at is when we heard the plan, not when it
# begins: a month-long trip mentioned a week ahead is live for five weeks.
_LEAD_IN_RE = re.compile(
    rf"\b(?:in|starting in|beginning in)\s+(?:a\s+|an\s+|the\s+)?({_NUM})?\s*({_UNIT})\b"
    rf"|\bnext\s+({_UNIT})\b",
    re.I,
)


def _num(token: Optional[str]) -> int:
    if not token:
        return 1
    t = token.strip().lower()
    if t.isdigit():
        n = int(t)
        # A three-digit count of years is a typo or a joke, not a window.
        return n if 0 < n <= 400 else 1
    return _NUMBER_WORDS.get(t, 1)


def parse_iso_day(value) -> Optional[date]:
    """The calendar day of an ISO8601 string (or a date/datetime), or None.

    Tolerant on purpose: this reads a field that crossed a network boundary from
    another service, and a shape we did not expect must degrade to "undated"
    rather than raise inside a ranking request.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    # Python's fromisoformat rejects the trailing Z that JS toISOString() emits.
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        pass
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def age_in_days(observed_at, now=None) -> Optional[int]:
    """Whole days between when a fact was learned and `now`. None if undated.

    A negative age (a clock skew, or a fact stamped in the future) is clamped to
    0: "learned today" is the honest reading, and letting it go negative would
    make a future-stamped fact look eternally fresh.
    """
    observed = parse_iso_day(observed_at)
    if observed is None:
        return None
    today = parse_iso_day(now) or datetime.now(timezone.utc).date()
    return max(0, (today - observed).days)


def transient_window_days(text: Optional[str]) -> Optional[int]:
    """How many days this fact claims to be true for, or None if it never expires.

    None is the answer for the overwhelming majority of facts, and that is the
    point: only a fact that states its own impermanence gets a shelf life.
    """
    if not text or not isinstance(text, str):
        return None
    t = text.lower()
    if any(cue in t for cue in _PERSISTENT_CUES):
        return None
    if not any(cue in t for cue in _TRANSIENT_CUES):
        return None

    window = None
    m = _DURATION_RE.search(t)
    if m:
        if m.group(2):
            window = _num(m.group(1)) * _UNIT_DAYS[m.group(2).lower()]
        elif m.group(4):
            window = _num(m.group(3)) * _UNIT_DAYS[m.group(4).lower()]
    if window is None:
        window = TRANSIENT_DEFAULT_DAYS

    lead = _LEAD_IN_RE.search(t)
    if lead:
        if lead.group(3):
            window += _UNIT_DAYS[lead.group(3).lower()]
        elif lead.group(2):
            window += _num(lead.group(1)) * _UNIT_DAYS[lead.group(2).lower()]
    # A year is the ceiling. Past that the fact is doing something other than
    # describing a trip and the shelf-life idea stops applying.
    return min(window, 365)


def staleness_multiplier(text: Optional[str], observed_at, now=None) -> float:
    """Down-weight for a fact whose claimed window has passed. 1.0 = untouched.

    Returns 1.0 whenever we cannot be sure: no transience marker, no date, an
    unparseable date, or still inside the window.
    """
    window = transient_window_days(text)
    if window is None:
        return 1.0
    age = age_in_days(observed_at, now)
    if age is None:
        return 1.0
    if age <= window:
        return 1.0
    if age > window * STALE_LONG_GONE_MULTIPLE:
        return STALE_LONG_GONE_FACTOR
    return STALE_EXPIRED_FACTOR


def describe_age(days: Optional[int]) -> Optional[str]:
    """"today" / "3 days ago" / "5 weeks ago" / "8 months ago".

    Words, not an ISO timestamp. The Stage-1 prompt already tells the model not
    to do date arithmetic on timestamps because it is unreliable; handing it a
    computed phrase removes the arithmetic instead of asking for it again.
    """
    if days is None:
        return None
    if days <= 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 14:
        return f"{days} days ago"
    if days < 60:
        return f"{days // 7} weeks ago"
    if days < 730:
        return f"{days // 30} months ago"
    return f"{days // 365} years ago"


def fact_time_note(text: Optional[str], observed_at, now=None) -> Optional[str]:
    """The one-line temporal verdict Stage 1 reads, or None when there is none.

    Deliberately states the REASON rather than an instruction: the filter is
    told what is true about the fact and decides, which keeps a stale trip
    available for "who has ever been to Austin" while sinking it for "who is in
    Austin now".
    """
    window = transient_window_days(text)
    age = age_in_days(observed_at, now)
    if window is None or age is None:
        return None
    if age <= window:
        return f"still within the ~{window}-day window this describes"
    return (
        f"EXPIRED: describes something temporary lasting about {window} days, "
        f"and it was learned {describe_age(age)}"
    )
