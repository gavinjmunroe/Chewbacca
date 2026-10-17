"""table_tidy turns a client file into one client view: the story columns, in order, best rows first."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import table_tidy as T  # noqa: E402

SABO = {"columns": {"brand": "Brand", "status": "Status", "person": "Person", "title": "Title",
                    "contact": "Contact", "creator": "Creator", "findymail": "Find work email from profile URL"},
        "spend_now": {"columns": {"score": "Spending now"}}}
COLUMNS = [{"id": f"f_{i}", "name": n} for i, n in enumerate(
    ["Brand", "Brand Domain", "Creator", "Find work email from profile URL", "Email (2)", "Person",
     "Title", "Status", "Contact", "Spending now"])]


def test_spec_is_derived_when_the_client_file_has_none():
    names, sort = T.spec(SABO)
    assert names == ["Brand", "Status", "Spending now", "Person", "Title", "Contact", "Creator"]
    assert sort == [("Status", "DESC"), ("Spending now", "DESC")]


def test_an_explicit_client_view_wins():
    names, sort = T.spec({**SABO, "client_view": {"columns": ["Brand", "Contact"], "sort": [["Brand", "ASC"]]}})
    assert names == ["Brand", "Contact"] and sort == [("Brand", "ASC")]


def test_plan_hides_everything_off_the_story():
    p = T.plan(COLUMNS, *T.spec(SABO))
    shown = [c["name"] for c in COLUMNS if p["visibility"][c["id"]]["isVisible"]]
    assert set(shown) == {"Brand", "Status", "Spending now", "Person", "Title", "Contact", "Creator"}
    assert not p["missing"]
    # Each move puts one column right after the previous one, so the order is exact.
    ids = {c["id"]: c["name"] for c in COLUMNS}
    assert [(ids[a], ids[b]) for a, b in p["moves"]][:2] == [("Status", "Brand"), ("Spending now", "Status")]


def test_a_missing_story_column_is_reported_not_skipped_silently():
    p = T.plan([c for c in COLUMNS if c["name"] != "Contact"], *T.spec(SABO))
    assert p["missing"] == ["Contact"]
