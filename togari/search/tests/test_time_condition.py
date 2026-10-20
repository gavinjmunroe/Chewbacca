"""Tests for the deterministic Stage-2 time-condition (wrong-day) penalty.

This penalty was previously driven by Stage-1 LLM notes; it is now recomputed in
Stage 2 straight from the structured FactIn fields (is_conditional /
condition_text / is_past) versus the query timeframe resolved against now_local.
No LLM, no network. These pin the canonical conflict/match cases and the
conservative defaults (ambiguity -> no penalty).

Run: python -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from api.people_rank import _time_condition_multiplier  # noqa: E402
from api.schemas import ContactIn, FactIn  # noqa: E402

# Stated local datetimes with a leading weekday word (medha-id's format).
WEEKDAY = "Tuesday, July 7, 2026, 8:47 PM (America/New_York)"   # a weekday
MONDAY = "Monday, July 6, 2026, 7:00 PM (America/New_York)"
TUESDAY = "Tuesday, July 7, 2026, 7:00 PM (America/New_York)"


def _c(*facts) -> ContactIn:
    return ContactIn(contactId="c1", name="Test", facts=list(facts))


class TimeConditionTest(unittest.TestCase):
    def test_weekend_only_fact_conflicts_with_weekday_tonight(self):
        # Canonical case: weekend-only fact, query 'dinner tonight', today is a
        # weekday -> conflict -> 0.55.
        c = _c(FactIn(text="likes Mexican food only on weekends",
                      is_conditional=True, condition_text="only on weekends"))
        self.assertAlmostEqual(
            _time_condition_multiplier(c, "who's up for dinner tonight?", WEEKDAY), 0.55)

    def test_weekend_only_fact_matches_this_weekend(self):
        c = _c(FactIn(text="likes Mexican food only on weekends",
                      is_conditional=True, condition_text="only on weekends"))
        self.assertAlmostEqual(
            _time_condition_multiplier(c, "who wants tacos this weekend?", WEEKDAY), 1.0)

    def test_monday_fact_matches_monday_query(self):
        c = _c(FactIn(text="free on Mondays", is_conditional=True,
                      condition_text="on Mondays"))
        # now_local is a Monday, query 'today' resolves to Monday -> match.
        self.assertAlmostEqual(
            _time_condition_multiplier(c, "who is free today?", MONDAY), 1.0)

    def test_monday_fact_conflicts_tuesday_query(self):
        c = _c(FactIn(text="free on Mondays", is_conditional=True,
                      condition_text="on Mondays"))
        # now_local is a Tuesday, query 'today' resolves to Tuesday -> conflict.
        self.assertAlmostEqual(
            _time_condition_multiplier(c, "who is free today?", TUESDAY), 0.55)

    def test_named_weekday_in_query_conflicts(self):
        c = _c(FactIn(text="free on Mondays", is_conditional=True,
                      condition_text="on Mondays"))
        # Query explicitly names Tuesday -> conflict regardless of now_local.
        self.assertAlmostEqual(
            _time_condition_multiplier(c, "anyone free on Tuesday?", WEEKDAY), 0.55)

    def test_morning_only_fact_conflicts_with_tonight(self):
        # Time-bucket mismatch: morning-only fact vs an evening ('tonight') query.
        c = _c(FactIn(text="only meets in the mornings", is_conditional=True,
                      condition_text="only in the mornings"))
        self.assertAlmostEqual(
            _time_condition_multiplier(c, "grab a drink tonight?", WEEKDAY), 0.55)

    def test_non_conditional_fact_never_penalized(self):
        # Same weekend window text, but is_conditional False -> ignored -> 1.0.
        c = _c(FactIn(text="loves Mexican food on weekends", is_conditional=False,
                      condition_text="on weekends"))
        self.assertAlmostEqual(
            _time_condition_multiplier(c, "dinner tonight?", WEEKDAY), 1.0)

    def test_timeless_query_never_penalized(self):
        # No detectable timeframe in the query -> never penalize, even with a
        # conflicting conditional fact present.
        c = _c(FactIn(text="likes Mexican food only on weekends",
                      is_conditional=True, condition_text="only on weekends"))
        self.assertAlmostEqual(
            _time_condition_multiplier(c, "who should I get dinner with?", WEEKDAY), 1.0)

    def test_unparseable_condition_text_no_penalty(self):
        c = _c(FactIn(text="available when the stars align", is_conditional=True,
                      condition_text="when the stars align"))
        self.assertAlmostEqual(
            _time_condition_multiplier(c, "dinner tonight?", WEEKDAY), 1.0)

    def test_unparseable_now_local_no_penalty_for_today_anchored(self):
        # 'tonight' needs today; unparseable now_local -> query timeframe cannot
        # be resolved -> no penalty (conservative).
        c = _c(FactIn(text="likes Mexican food only on weekends",
                      is_conditional=True, condition_text="only on weekends"))
        self.assertAlmostEqual(
            _time_condition_multiplier(c, "dinner tonight?", "not-a-real-datetime"), 1.0)

    def test_worst_across_multiple_facts(self):
        # One matching + one conflicting conditional fact -> the WORST wins.
        c = _c(
            FactIn(text="loves tacos", is_conditional=False),
            FactIn(text="only weekends", is_conditional=True, condition_text="only on weekends"),
        )
        self.assertAlmostEqual(
            _time_condition_multiplier(c, "tacos tonight?", WEEKDAY), 0.55)

    def test_no_facts_no_penalty(self):
        self.assertAlmostEqual(
            _time_condition_multiplier(_c(), "dinner tonight?", WEEKDAY), 1.0)


if __name__ == "__main__":
    unittest.main()
