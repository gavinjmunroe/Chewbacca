"""Shelf life.

The case that drove this: "Sagar is visiting San Francisco in a week and
staying a month". Live for five weeks, dead after. The old behaviour ranked it
the same in month eight.

Every test pins `now` explicitly. A shelf-life test that reads the wall clock
passes in March and fails in November, which is the exact bug class it exists
to catch.
"""
from api.temporal import (
    STALE_EXPIRED_FACTOR,
    STALE_LONG_GONE_FACTOR,
    TRANSIENT_DEFAULT_DAYS,
    age_in_days,
    describe_age,
    fact_time_note,
    parse_iso_day,
    staleness_multiplier,
    transient_window_days,
)

NOW = "2026-08-25T12:00:00Z"


def _days_before(n: int) -> str:
    from datetime import date, timedelta
    return (date(2026, 8, 25) - timedelta(days=n)).isoformat()


# ── the driving case ─────────────────────────────────────────────────────────

VISIT = "Sagar is visiting San Francisco in a week and staying a month"


def test_the_month_long_visit_planned_a_week_out_lives_five_weeks():
    # 30-day stay + 7-day lead-in.
    assert transient_window_days(VISIT) == 37


def test_that_visit_is_live_while_it_is_happening_and_dead_afterwards():
    assert staleness_multiplier(VISIT, _days_before(0), NOW) == 1.0
    assert staleness_multiplier(VISIT, _days_before(20), NOW) == 1.0
    assert staleness_multiplier(VISIT, _days_before(37), NOW) == 1.0
    # Day 38 is the first day it is over.
    assert staleness_multiplier(VISIT, _days_before(38), NOW) == STALE_EXPIRED_FACTOR
    assert staleness_multiplier(VISIT, _days_before(90), NOW) == STALE_EXPIRED_FACTOR
    # Well past it, this is history rather than a stale plan.
    assert staleness_multiplier(VISIT, _days_before(200), NOW) == STALE_LONG_GONE_FACTOR


def test_the_same_sentence_about_a_move_never_expires():
    # This is the pair that matters: identical shape, opposite shelf life.
    moved = "Sagar moved to San Francisco"
    assert transient_window_days(moved) is None
    assert staleness_multiplier(moved, _days_before(900), NOW) == 1.0


# ── durations ────────────────────────────────────────────────────────────────

def test_stated_durations_are_read_in_words_and_digits():
    assert transient_window_days("Priya is in town for three days") == 3
    assert transient_window_days("Priya is in town for 3 days") == 3
    assert transient_window_days("Dev is visiting for two weeks") == 14
    assert transient_window_days("Mia is here for a month") == 30
    assert transient_window_days("Ravi is visiting for the weekend") == 3
    assert transient_window_days("Ana is on a trip for a year") == 365
    assert transient_window_days("Kai is visiting for a couple of weeks") == 14
    assert transient_window_days("Lee is in town for a few days") == 3


def test_a_duration_written_as_a_trip_length_is_read_too():
    assert transient_window_days("Nia is on a two-week trip to Lisbon") == 14
    assert transient_window_days("Omar has a 3 day trip to Denver") == 3


def test_a_transient_fact_with_no_duration_gets_the_default_window():
    assert transient_window_days("Tom is visiting Austin") == TRANSIENT_DEFAULT_DAYS
    assert transient_window_days("Zoe is in town") == TRANSIENT_DEFAULT_DAYS
    assert transient_window_days("Sam is passing through Chicago") == TRANSIENT_DEFAULT_DAYS


def test_the_lead_in_extends_the_window_rather_than_replacing_it():
    assert transient_window_days("Ali is visiting in two weeks for a week") == 21
    assert transient_window_days("Bea is in town next month") == TRANSIENT_DEFAULT_DAYS + 30
    # No lead-in phrase: the window is the duration alone.
    assert transient_window_days("Cy is in town for a week") == 7


def test_the_window_is_capped_at_a_year():
    assert transient_window_days("Dara is on a trip for five years") == 365


# ── what must never be treated as perishable ─────────────────────────────────

def test_a_permanence_cue_wins_over_a_transience_cue_in_the_same_sentence():
    # "staying" is a transience cue and this is not a visit.
    t = "Eli moved to Austin and is staying with his brother for a month"
    assert transient_window_days(t) is None
    assert staleness_multiplier(t, _days_before(500), NOW) == 1.0


def test_ordinary_facts_are_left_completely_alone():
    for text in (
        "Fay loves Mexican food",
        "Gus works at Stripe",
        "Hana is stressed about her funding round",
        "Ivan lives in Brooklyn",
        "Jo is training for a marathon",
        "Kim grew up in Chennai",
        "Lena is a designer",
    ):
        assert transient_window_days(text) is None, text
        assert staleness_multiplier(text, _days_before(400), NOW) == 1.0, text


def test_an_undated_transient_fact_is_never_punished():
    # We cannot know whether it is stale, so we do not guess.
    assert staleness_multiplier(VISIT, None, NOW) == 1.0
    assert staleness_multiplier(VISIT, "", NOW) == 1.0
    assert staleness_multiplier(VISIT, "not-a-date", NOW) == 1.0
    assert staleness_multiplier(VISIT, 12345, NOW) == 1.0


def test_degenerate_text_never_raises():
    for value in (None, "", "   ", 42, [], {}):
        assert transient_window_days(value) is None
        assert staleness_multiplier(value, _days_before(10), NOW) == 1.0


# ── dates ────────────────────────────────────────────────────────────────────

def test_the_javascript_z_suffix_parses():
    # JS toISOString() is what actually crosses the wire, and Python's
    # fromisoformat rejects its trailing Z on older versions.
    assert parse_iso_day("2026-08-25T12:00:00.000Z").isoformat() == "2026-08-25"
    assert parse_iso_day("2026-08-25T12:00:00+00:00").isoformat() == "2026-08-25"
    assert parse_iso_day("2026-08-25").isoformat() == "2026-08-25"


def test_an_unparseable_date_is_undated_not_an_exception():
    assert parse_iso_day("yesterday") is None
    assert parse_iso_day("") is None
    assert parse_iso_day(None) is None
    assert parse_iso_day(3.14) is None
    assert age_in_days("nonsense", NOW) is None


def test_a_future_stamped_fact_reads_as_learned_today_not_as_negative_age():
    assert age_in_days("2027-01-01", NOW) == 0


def test_age_counts_whole_days():
    assert age_in_days("2026-08-25", NOW) == 0
    assert age_in_days("2026-08-24", NOW) == 1
    assert age_in_days("2026-07-26", NOW) == 30


# ── the words Stage 1 reads ──────────────────────────────────────────────────

def test_describe_age_reads_like_a_person_wrote_it():
    assert describe_age(0) == "today"
    assert describe_age(1) == "yesterday"
    assert describe_age(5) == "5 days ago"
    assert describe_age(21) == "3 weeks ago"
    assert describe_age(90) == "3 months ago"
    assert describe_age(800) == "2 years ago"
    assert describe_age(None) is None


def test_the_stage1_note_agrees_with_the_stage2_multiplier():
    # These two are the whole reason temporal.py is one module: the filter is
    # shown a verdict in words and the scorer applies a number, and they must
    # never disagree about the same fact.
    for age in (0, 10, 37, 38, 100, 400):
        observed = _days_before(age)
        note = fact_time_note(VISIT, observed, NOW)
        mult = staleness_multiplier(VISIT, observed, NOW)
        assert note is not None
        assert ("EXPIRED" in note) == (mult < 1.0), (age, note, mult)


def test_there_is_no_note_when_there_is_nothing_to_say():
    assert fact_time_note("Mel works at Figma", _days_before(10), NOW) is None
    assert fact_time_note(VISIT, None, NOW) is None
