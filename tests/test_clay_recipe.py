"""clay_recipe: the find-people run is data, and the loader refuses any
recipe that could spend a credit without an approval card in front of it."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin" / "lib"))
import clay_recipe  # noqa: E402


class Recipe(unittest.TestCase):
    def test_shipped_recipe_loads(self):
        steps = clay_recipe.load()
        self.assertEqual([s.id for s in steps], ["check", "find", "count", "test", "read", "rest", "done"])

    def test_every_paid_step_ends_on_its_one_approval(self):
        for step in clay_recipe.load():
            approvals = [a for a in step.actions if a.approve]
            if step.cost == "spends":
                self.assertEqual(len(approvals), 1, step.id)
                self.assertIs(step.actions[-1], approvals[0], step.id)
            else:
                self.assertEqual(approvals, [], step.id)

    def bad(self, mutate):
        data = json.loads(clay_recipe.DEFAULT.read_text())
        mutate(data)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(data, handle)
        with self.assertRaises(clay_recipe.RecipeError):
            clay_recipe.load(Path(handle.name))

    def test_refuses_a_paid_click_without_approval(self):
        self.bad(lambda d: d["steps"][3]["actions"][1].pop("approve"))

    def test_refuses_an_approval_in_a_free_step(self):
        self.bad(lambda d: d["steps"][1]["actions"][0].update(approve="test"))

    def test_refuses_an_action_after_the_approval(self):
        self.bad(lambda d: d["steps"][3]["actions"].append(dict(d["steps"][1]["actions"][0])))

    def test_refuses_an_unknown_do(self):
        self.bad(lambda d: d["steps"][1]["actions"][0].update(do="drag"))

    def test_refuses_two_expect_kinds(self):
        self.bad(lambda d: d["steps"][1]["actions"][0]["expect"].update(url="/x"))

    def test_refuses_type_without_value(self):
        self.bad(lambda d: d["steps"][1]["actions"][3].pop("value"))

    # The 2026-10-09 dry run stopped on two People buttons: Clay's Find leads
    # flyout had grown a "Create a workflow" section under "Search directly".
    def test_people_press_is_held_to_search_directly(self):
        find = next(s for s in clay_recipe.load() if s.id == "find")
        people = [alt for a in find.actions for alt in a.find if alt.get("text") == "People"]
        self.assertEqual([alt.get("section") for alt in people], ["Search directly"])

    def test_refuses_an_unknown_find_key(self):
        self.bad(lambda d: d["steps"][1]["actions"][0]["find"][0].update(under="Search directly"))

    def test_refuses_a_find_without_css(self):
        self.bad(lambda d: d["steps"][1]["actions"][0]["find"][0].pop("css"))

    def test_refuses_steps_out_of_order(self):
        self.bad(lambda d: d["steps"].reverse())

    def test_refuses_an_em_dash_in_copy(self):
        self.bad(lambda d: d["steps"][1].update(note="Asking Clay " + chr(0x2014) + " now"))

    def test_refuses_a_long_title(self):
        self.bad(lambda d: d["steps"][1].update(title="FIND PEOPLE IN CLAY NOW"))

    def test_fill(self):
        self.assertEqual(clay_recipe.fill("for {sentence}.", {"sentence": "VC partners"}), "for VC partners.")
        with self.assertRaises(KeyError):
            clay_recipe.fill("{nope}", {})


if __name__ == "__main__":
    unittest.main()
