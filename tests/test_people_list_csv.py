"""people_list_csv: the tagging traps found on the first Dream list, 2026-11-03."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import people_list_csv as plc  # noqa: E402


def person(role="", company="", location="", warmth=0, msgs=0, name="A B", pid="1"):
    return {"id": pid, "name": name, "role": role, "company": company, "location": location,
            "warmth": warmth, "msgs": msgs, "linkedin": "", "how_we_met": "", "li_connected_on": "", "last": ""}


class Categorize(unittest.TestCase):
    def test_indiana_is_not_india(self):
        p = person("Director of Operations", "IU Innovates", "Indianapolis, Indiana, United States")
        self.assertNotEqual(plc.categorize(p), "Pilot org (global)")

    def test_doctoral_is_not_cto(self):
        p = person("Doctoral Researcher", "Mila", "Nagpur, Maharashtra, India")
        self.assertNotEqual(plc.categorize(p), "Pilot org (global)")

    def test_emerging_market_leader(self):
        p = person("Executive Director & Co- Founder", "iDebate Rwanda", "Rwanda")
        self.assertEqual(plc.categorize(p), "Pilot org (global)")

    def test_interns_dropped(self):
        self.assertIsNone(plc.categorize(person("Venture Capital Intern", "Paramount Investment")))

    def test_los_angeles_is_not_an_angel(self):
        p = person("Swim Instructor", "YMCA of Metropolitan Los Angeles")
        self.assertIsNone(plc.categorize(p))


class Seniority(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(plc.seniority("President & CEO"), "Senior leader")
        self.assertEqual(plc.seniority("Investment Banking Analyst"), "Early career")
        self.assertEqual(plc.seniority("Founder"), "Mid / founder")


class Cell(unittest.TestCase):
    def test_formula_neutralized(self):
        self.assertEqual(plc.cell("=HYPERLINK(1)"), "'=HYPERLINK(1)")
        self.assertEqual(plc.cell("@x"), "'@x")
        self.assertEqual(plc.cell("Founder"), "Founder")


class Build(unittest.TestCase):
    def test_columns_and_order(self):
        people = [person("Managing Partner", "Dorm Room Fund", pid="1", name="Zed"),
                  person("Founder", "Tiny", pid="2", name="Amy", msgs=3),
                  person("Founder", "Tiny", pid="3", name="Amy", msgs=3)]
        picks = [{"store_name": "Zed", "name": "Zed", "title": "MP", "organization": "DRF", "location": "",
                  "category": "Investor", "help": "h", "ask": "a", "how_known": "k",
                  "intro_path": "i", "source": "s", "relationship": "Know them"}]
        cols, rows = plc.build("Dream", picks, people)
        self.assertEqual(cols[0], "Priority")
        self.assertIn("How they help Dream", cols)
        self.assertIn("Source", cols)
        self.assertEqual([r["Name"] for r in rows], ["Zed", "Amy"])  # pick first, dupe dropped
        self.assertEqual(rows[0]["Priority"], "1")
        self.assertEqual(rows[0]["Group"], "Hand-picked")
        self.assertEqual(rows[1]["Group"], "Founders and operators Caleb knows")
        self.assertEqual(rows[1]["Status"], "Not started")

    def test_bad_pick_category_refused(self):
        picks = [{"store_name": "", "name": "X", "title": "", "organization": "", "location": "",
                  "category": "Growth", "help": "", "ask": "", "how_known": "", "intro_path": "",
                  "source": "", "relationship": ""}]
        with self.assertRaises(SystemExit):
            plc.build("Dream", picks, [])


if __name__ == "__main__":
    unittest.main()
