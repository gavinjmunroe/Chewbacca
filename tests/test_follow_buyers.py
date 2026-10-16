"""Unit tests for tools/creator_gtm/follow_buyers.py with brand_buyer's fake Clay and fake Jev.

Nothing leaves the Mac. Run: python3 -I tests/test_follow_buyers.py
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "tools", "creator_gtm"))
from test_brand_buyer import FakeClay, _Base, fake_jev, person  # noqa: E402
import brand_buyer as L  # noqa: E402
import follow_buyers as F  # noqa: E402

SEED_URL = "https://www.linkedin.com/in/riley-seed-0001/"
COLS = {"person": "f_person", "title": "f_title", "why": "f_why", "status": "f_status", "contact": "f_contact"}


def seeds():
    return [
        {"name": "Sam Stay", "linkedin": "", "history": "ran partnerships",
         "paid_from": {"brands": ["Old Bar"], "domains": ["oldparent.com", "oldbar.com"]},
         "current": {"employer": "Old Parent", "domain": "oldparent.com", "title": "Partnerships",
                     "since": "", "source": "people search"}},
        {"name": "Riley Seed", "linkedin": SEED_URL, "history": "ran Old Drink's influencer contracts",
         "paid_from": {"brands": ["Old Drink"], "domains": ["olddrink.com", "oldparent.com"]},
         "current": {"employer": "New Snack Co", "domain": "newsnack.com",
                     "title": "Social Media and Influencer Manager", "since": "2026-03", "source": "research row"}},
    ]


class FollowTest(_Base):
    def run_follow(self, fake, scores, gate=True):
        L.clay, L.jev_rank = fake, fake_jev(scores, gate)
        path = os.path.join(self.tmp.name, "buyers.json")
        F.save_buyers(path, seeds())
        with open(os.devnull, "w") as null:
            out, err = sys.stdout, sys.stderr
            sys.stdout = sys.stderr = null
            saved = L.ensure_pick_columns
            L.ensure_pick_columns = lambda live: COLS
            try:
                F.main(["--client", os.path.join(self.tmp.name, "none.json"), "--buyers", path, "--live"])
            finally:
                sys.stdout, sys.stderr = out, err
                L.ensure_pick_columns = saved
        return F.load_buyers(path), fake

    def test_stayed_seed_costs_nothing(self):
        buyers, fake = self.run_follow(FakeClay({"newsnack.com": []}), {})
        self.assertFalse([c for c in fake.ops("add-rows") if "Old Parent" in c[2]["records"]])
        self.assertNotIn("row", buyers[0]["current"])

    def test_moved_seed_found_in_search_is_picked_over_higher_score(self):
        riley = person("Riley Seed", "Social Media and Influencer Manager", url=SEED_URL)
        boss = person("Pat Lee", "Director of Brand Marketing")
        fake = FakeClay({"newsnack.com": [boss, riley]}, email_by_url={SEED_URL: "riley@newsnack.com"})
        buyers, fake = self.run_follow(fake, {"Pat Lee": 1.9, "Riley Seed": 0.2})
        self.assertEqual(fake.value("f_status"), F.WARM)
        self.assertEqual(fake.value("f_person"), "Riley Seed")
        why = fake.value("f_why")
        self.assertIn("ran Old Drink's influencer contracts", why)
        self.assertIn("lists Riley Seed there", why)
        self.assertIn("Also on the team: Pat Lee", why)
        self.assertIn("riley@newsnack.com", fake.value("f_contact"))
        self.assertEqual(buyers[1]["current"]["email"], "riley@newsnack.com")
        # one Findymail run: the seed was the chain's pick, so no second lookup
        self.assertEqual(len([c for c in fake.ops("run-cells") if c[2]["fields"] == L.F_FINDYMAIL]), 1)

    def test_seed_missing_from_search_still_gets_own_email(self):
        other = person("Jordan Kim", "Brand Manager")
        fake = FakeClay({"newsnack.com": [other]},
                        email_by_url={other["url"]: "jordan@newsnack.com", SEED_URL: "riley@newsnack.com"})
        buyers, fake = self.run_follow(fake, {"Jordan Kim": 1.5})
        self.assertEqual(fake.value("f_person"), "Riley Seed")
        self.assertEqual(fake.value(L.F_PROFILE), SEED_URL)
        self.assertIn("did not return Riley Seed", fake.value("f_why"))
        self.assertEqual(fake.value("f_status"), F.WARM)
        self.assertFalse(buyers[1]["current"]["in_clay_search"])

    def test_invalid_seed_email_is_warm_but_needs_work_and_left_off_contact(self):
        riley = person("Riley Seed", "Social Media and Influencer Manager", url=SEED_URL)
        fake = FakeClay({"newsnack.com": [riley]}, email_by_url={SEED_URL: "riley@newsnack.com"},
                        verdict_by_email={"riley@newsnack.com": "invalid"})
        _, fake = self.run_follow(fake, {"Riley Seed": 1.0})
        self.assertEqual(fake.value("f_status"), F.WARM + "; needs work: invalid")
        self.assertIn("no email", fake.value("f_contact"))

    def test_old_employer_email_is_named_and_team_door_offered(self):
        # Archer Meat Snacks, 2026-10-16: Findymail gave riley.seed@oldparent.com, ZeroBounce valid.
        cooper = person("Jamie Door", "Sr. Brand Manager, Innovation")
        fake = FakeClay({"newsnack.com": [cooper]},
                        email_by_url={cooper["url"]: "jamie@newsnack.com",
                                      SEED_URL: "riley.seed@oldparent.com"})
        buyers, fake = self.run_follow(fake, {"Jamie Door": 0.9})
        self.assertEqual(fake.value("f_status"), F.WARM + "; needs work: off-domain oldparent.com")
        why = fake.value("f_why")
        self.assertIn("riley.seed@oldparent.com, an address at the brand Riley Seed left", why)
        self.assertIn("Jamie Door (Sr. Brand Manager, Innovation)", why)
        self.assertIn("Verified email on that team: Jamie Door, jamie@newsnack.com", why)
        self.assertNotIn("oldparent.com", fake.value("f_contact").split(".")[0])

    def test_events_move_a_seed_by_linkedin_url(self):
        buyers = seeds()
        changed = F.apply_events(buyers, [{"linkedin": "https://www.linkedin.com/in/riley-seed-0001",
                                           "employer": "New Co", "domain": "newco.com", "title": "Head of Social"}])
        self.assertEqual(changed, ["Riley Seed"])
        self.assertEqual(buyers[1]["current"]["domain"], "newco.com")
        self.assertTrue(F.moved(buyers[1]))
        self.assertFalse(F.moved(buyers[0]))


if __name__ == "__main__":
    unittest.main()
