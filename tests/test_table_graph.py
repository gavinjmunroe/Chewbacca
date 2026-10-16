"""tools/table_graph.py: the column graph and client-readiness lint, on a fake table."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import table_graph as T  # noqa: E402


def col(cid, name, kind="text", action=None, binds=(), formula=None):
    ts = {}
    if action:
        ts["actionKey"] = action
        ts["inputsBinding"] = [{"name": "x", "formulaText": "{{%s}}" % b} for b in binds]
    if formula:
        ts["formulaText"] = formula
    return {"id": cid, "name": name, "type": kind, "typeSettings": ts}


SABO_SHAPE = [
    col("f_dom", "Brand Domain"),
    col("f_people", "Find contacts", "action", "cpj-find-lists-of-people-v2", ["f_dom"]),
    col("f_src", "Source links"),
    col("f_fm", "Find email", "action", "findymail-find-work-email-from-linkedin", ["f_src"]),
    col("f_em", "Email", "formula", formula="{{f_fm}}?.email"),
    col("f_zb", "Verify", "action", "validate-email", ["f_em"]),
    col("f_fm2", "Find email (2)", "action", "findymail-find-work-email-from-linkedin", ["f_people"]),
]


def test_order_puts_inputs_first_and_links_feeds():
    by_id, deps, feeds, order = T.graph(SABO_SHAPE)
    assert order.index("f_src") < order.index("f_fm") < order.index("f_em") < order.index("f_zb")
    assert feeds["f_dom"] == ["f_people"]
    assert deps["f_em"] == ["f_fm"]


def test_lint_flags_the_10_16_problems():
    by_id, deps, feeds, _ = T.graph(SABO_SHAPE)
    issues = " ".join(T.lint(by_id, deps, feeds))
    assert "No condensed result column" in issues
    assert "No Status column" in issues
    assert "2 columns run findymail" in issues


def test_clean_table_passes():
    clean = SABO_SHAPE[:6] + [
        col("f_status", "Status"),
        col("f_contact", "Contact", "formula", formula="{{f_em}} + {{f_zb}}"),
    ]
    by_id, deps, feeds, _ = T.graph(clean)
    assert T.lint(by_id, deps, feeds) == []


def test_cycle_is_refused():
    loop = [col("f_a", "A", "formula", formula="{{f_b}}"), col("f_b", "B", "formula", formula="{{f_a}}")]
    try:
        T.graph(loop)
    except SystemExit as e:
        assert "cycle" in str(e)
    else:
        raise AssertionError("cycle not caught")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("table_graph: ok")
