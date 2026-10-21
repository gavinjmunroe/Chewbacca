"""
test_ranking.py — tests for the ported PeopleRank query-ranking logic.

togari-search shipped no unit tests for its scoring/rationale modules (only an
HTML test_page.py), so these tests are new but pin the PORTED behavior: the
CTO's confidence weights/bands, the rationale validators/scrubber (verbatim),
the signal shape, and the ranking ordering. They guard against drift between
this reference implementation and the in-process JS ranker.
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_PKG = os.path.dirname(_HERE)
if _PKG not in sys.path:
    sys.path.insert(0, _PKG)

import ranking  # noqa: E402


# ---------- Confidence model (ported weights/bands) ----------

def test_confidence_weights_match_cto_source():
    assert ranking.CONFIDENCE_WEIGHTS == {
        "text_completeness": 0.50,
        "structured_coverage": 0.30,
        "graph_signal": 0.20,
    }


def test_confidence_bands_match_cto_source():
    assert ranking.CONFIDENCE_BANDS == (
        (0.70, "high"),
        (0.40, "medium"),
        (0.00, "low"),
    )


def test_compute_confidence_is_weighted_sum():
    # all-ones -> 1.0
    assert ranking.compute_confidence(1.0, 1.0, 1.0) == 1.0
    # only text completeness -> its weight
    assert ranking.compute_confidence(1.0, 0.0, 0.0) == 0.50
    assert ranking.compute_confidence(0.0, 1.0, 0.0) == 0.30
    assert ranking.compute_confidence(0.0, 0.0, 1.0) == 0.20


def test_confidence_label_high_has_empty_reason():
    band, reason = ranking.confidence_label(0.80, 1.0, 1.0, 1.0)
    assert band == "high"
    assert reason == ""


def test_confidence_label_medium_names_weakest():
    band, reason = ranking.confidence_label(0.50, 0.9, 0.2, 0.9)
    assert band == "medium"
    assert "structured data" in reason


def test_confidence_label_low_band():
    band, _ = ranking.confidence_label(0.10, 0.1, 0.1, 0.1)
    assert band == "low"


# ---------- Candidate signal helpers ----------

def test_text_completeness_saturates_at_100_words():
    short = "alpha beta gamma"
    long = " ".join(["word"] * 200)
    assert 0.0 < ranking.text_completeness(short) < 0.1
    assert ranking.text_completeness(long) == 1.0
    assert ranking.text_completeness("") == 0.0


def test_structured_coverage_counts_present_fields():
    full = {"name": "A", "source": "linkedin", "handle": "@a", "external_id": "x"}
    assert ranking.structured_coverage(full) == 1.0
    half = {"name": "A", "source": "linkedin", "handle": "", "external_id": ""}
    assert ranking.structured_coverage(half) == 0.5
    assert ranking.structured_coverage({}) == 0.0


def test_graph_signal_source_and_handle():
    assert ranking.graph_signal({"source": "linkedin", "handle": "@a"}) == 1.0
    assert ranking.graph_signal({"source": "linkedin", "handle": ""}) == 0.5
    assert ranking.graph_signal({"source": "apple", "handle": "@a"}) == 0.5
    assert ranking.graph_signal({"source": "apple", "handle": ""}) == 0.0


def test_extract_signals_shape_and_cap():
    sigs = ranking.extract_signals(
        0.9,
        " ".join(["word"] * 60),
        {"source": "contacts/linkedin", "handle": "@a"},
        "high",
    )
    assert any(s.startswith("relevance:") for s in sigs)
    assert any(s.startswith("source:linkedin") for s in sigs)
    assert any(s.startswith("confidence:high") for s in sigs)
    assert len(sigs) <= 6


# ---------- Rationale validators (ported verbatim) ----------

def test_validate_rejects_em_dash():
    ok, reason = ranking.validate_rationale("She is great — really great.")
    assert not ok and reason == "em_dash"


def test_validate_rejects_banned_substring():
    ok, reason = ranking.validate_rationale("In a world where contacts matter.")
    assert not ok and reason.startswith("banned_sub")


def test_validate_rejects_banned_pattern():
    ok, reason = ranking.validate_rationale("They could be a good match here.")
    assert not ok and reason.startswith("banned_pat")


def test_validate_rejects_too_long():
    ok, reason = ranking.validate_rationale("x " * 500)
    assert not ok and reason.startswith("too_long")


def test_validate_accepts_clean_text():
    ok, reason = ranking.validate_rationale(
        "Jane shows up from LinkedIn for your query. Strong relevance."
    )
    assert ok and reason == "ok"


def test_scrub_replaces_em_dash_and_smart_quotes():
    out = ranking.scrub_ai_tells("He said “hi” — then left")
    assert "—" not in out
    assert "“" not in out and "”" not in out


def test_scrub_strips_ai_hedge_phrases():
    out = ranking.scrub_ai_tells("Moreover, this is a match.")
    assert not out.lower().startswith("moreover")


# ---------- Rationale generation always validates ----------

def test_generate_rationale_passes_own_validator():
    text = ranking.generate_rationale(
        "founders in NYC",
        "Jane Doe",
        0.82,
        {"source": "contacts/linkedin", "handle": "@jane"},
        " ".join(["NYC", "founder", "fintech"] * 10),
        "high",
    )
    ok, reason = ranking.validate_rationale(text)
    assert ok, f"generated rationale failed validator: {reason} :: {text}"
    assert "—" not in text


# ---------- Top-level ranking ----------

def _candidate(name, score, source="contacts/linkedin", handle="@h", text="a b c d e"):
    return {
        "score": score, "name": name, "source": source,
        "handle": handle, "external_id": f"id-{name}", "text": text,
    }


def test_rank_orders_by_score_desc():
    cands = [
        _candidate("Low", 0.10),
        _candidate("High", 0.95),
        _candidate("Mid", 0.55),
    ]
    ranked = ranking.rank_candidates("q", cands)
    names = [r["name"] for r in ranked]
    assert names == ["High", "Mid", "Low"]


def test_rank_output_shape():
    ranked = ranking.rank_candidates("q", [_candidate("A", 0.9)])
    r = ranked[0]
    assert set(r.keys()) >= {
        "id", "name", "score", "confidence", "rationale", "signals", "source"
    }
    assert isinstance(r["signals"], list)
    assert 0.0 <= r["confidence"] <= 1.0
    assert 0.0 <= r["score"] <= 100.0


def test_rank_handles_empty_and_null_scores():
    assert ranking.rank_candidates("q", []) == []
    ranked = ranking.rank_candidates("q", [_candidate("N", None)])
    assert ranked[0]["score"] >= 0.0


def test_graph_source_outranks_address_book_at_equal_relevance():
    cands = [
        _candidate("Linked", 0.8, source="contacts/linkedin", handle="@l"),
        _candidate("Apple", 0.8, source="contacts/apple", handle=""),
    ]
    ranked = ranking.rank_candidates("q", cands)
    assert ranked[0]["name"] == "Linked"
