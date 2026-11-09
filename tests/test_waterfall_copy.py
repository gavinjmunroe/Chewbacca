"""waterfall_copy rebuilds a source waterfall on another table: its own columns, in order, inputs swapped."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import waterfall_copy as W  # noqa: E402

DOMAIN = "{{f_src}}?.company?.domain"
COLS = [
    {"id": "f_name", "name": "Full Name", "type": "formula", "typeSettings": {"formulaText": "{{f_src}}.name"}},
    {"id": "f_src", "name": "Source", "type": "source", "typeSettings": {}},
    {"id": "f_a", "name": "Find A", "type": "action", "typeSettings": {
        "actionKey": "a-find", "inputsBinding": [{"name": "name", "formulaText": "{{f_name}}"},
                                                 {"name": "domain", "formulaText": DOMAIN}]}},
    {"id": "f_va", "name": "Validate A", "type": "action", "typeSettings": {
        "actionKey": "validate", "inputsBinding": [{"name": "email", "formulaText": "{{f_a}}?.email"}]}},
    {"id": "f_b", "name": "Find B", "type": "action", "typeSettings": {
        "actionKey": "b-find", "inputsBinding": [{"name": "name", "formulaText": "{{f_name}}"}],
        "conditionalRunFormulaText": "!({{f_va}}.verified === true)"}},
    {"id": "f_w", "name": "Work email", "type": "formula", "typeSettings": {
        "formulaType": "waterfall", "formulaWaterfall": [{"formula": "{{f_a}}?.email"}, {"formula": "{{f_b}}?.email"}]}},
    {"id": "f_other", "name": "Unrelated", "type": "action", "typeSettings": {"actionKey": "x"}},
]


def test_plan_takes_only_the_waterfall_and_orders_dependencies_first():
    bodies = W.plan(COLS, "f_w", {"f_name": "f_person"}, {DOMAIN: "f_dom"}, "gv_1")
    names = [b["body"]["name"] for b in bodies]
    assert "Unrelated" not in names and names[-1] == "Work email"
    assert names.index("Find A") < names.index("Validate A") < names.index("Find B")


def test_inputs_are_swapped_and_every_action_waits_for_a_button():
    bodies = {b["body"]["name"]: b["body"] for b in W.plan(COLS, "f_w", {"f_name": "f_person"}, {DOMAIN: "f_dom"}, "gv_1")}
    binding = {i["name"]: i["formulaText"] for i in bodies["Find A"]["typeSettings"]["inputsBinding"]}
    assert binding == {"name": "{{f_person}}", "domain": "{{f_dom}}"}
    assert all(b["typeSettings"]["runAsButton"] for b in bodies.values() if b["type"] == "action")
    assert bodies["Work email"]["activeViewId"] == "gv_1"


def test_an_unmapped_input_stops_before_any_write():
    with pytest.raises(SystemExit) as e:
        W.plan(COLS, "f_w", {}, {DOMAIN: "f_dom"}, "gv_1")
    assert "f_name (Full Name)" in str(e.value)
