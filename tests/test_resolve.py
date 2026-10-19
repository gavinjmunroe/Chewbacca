#!/usr/bin/env python3
"""chewbacca resolve answers the two questions an agent asked Caleb on 2026-10-11
instead of looking them up: a partial address (Gavin's, 2849 Summerdale Dr) and
his own mailing address. The geocoder is faked; nothing reaches the network."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import resolve  # noqa: E402


def census(matches_by_state):
    def fetch(url):
        st = url.rsplit("%2C%20", 1)[-1] if "%2C%20" in url else ""
        return {"result": {"addressMatches": [{"matchedAddress": m} for m in matches_by_state.get(st, [])]}}
    return fetch


class Resolve(unittest.TestCase):
    def test_places_runs_the_kits_own_command_when_path_has_none(self):
        # A runtime-only install puts no `chewbacca` on PATH (a stranger's
        # install, rehearsed 2026-10-13), and a bare name raised FileNotFoundError.
        from unittest import mock
        seen = []
        with mock.patch.object(resolve.shutil, "which", return_value=None), \
                mock.patch.object(resolve, "run", side_effect=lambda argv, *a, **k: seen.append(argv) or ""):
            resolve.places("Blue Bottle Oakland")
        kit = (Path(__file__).resolve().parent.parent / "bin" / "chewbacca").resolve()
        self.assertEqual(Path(seen[0][0]).resolve(), kit)

    def test_a_partial_street_completes_with_the_persons_state(self):
        fetch = census({"CA": ["2849 SUMMERDAYS CT, SAN JOSE, CA, 95132"],
                        "TX": ["2849 SUMMERDALE DR, HURST, TX, 76054"]})
        got = resolve.complete_address("2849 Summerdale Dr", ["CA", "TX"], fetch)
        self.assertEqual([g["answer"] for g in got], ["2849 Summerdale Dr, Hurst, TX 76054"])

    def test_a_fuzzy_geocoder_match_on_another_street_is_dropped(self):
        fetch = census({"CA": ["2849 SUMMERDAYS CT, SAN JOSE, CA, 95132"]})
        self.assertEqual(resolve.complete_address("2849 Summerdale Dr", ["CA"], fetch), [])

    def test_states_come_from_what_people_said(self):
        self.assertIn("TX", resolve.states_in("He is from Dallas and introduces himself as Caleb's buddy."))
        self.assertEqual(resolve.states_in("lunch at the place"), [])

    def test_a_street_is_found_in_a_question(self):
        self.assertEqual(resolve.street_in("city and zip for 2849 Summerdale Dr?"), "2849 Summerdale Dr")

    def test_an_address_in_the_brain_is_found_by_name(self):
        tmp = Path(tempfile.mkdtemp())
        (tmp / "chewbacca" / "agents").mkdir(parents=True)
        (tmp / "chewbacca" / "agents" / "contacts.csv").write_text(
            'Dana,"",Ruiz,"","","","",+15555550100,"dana@x.test","","12 Main St Austin TX 78701",""\n'
            'Sam,"",Ruiz,"","","","","","","",""\n')
        old = resolve.BRAIN
        resolve.BRAIN = tmp
        try:
            rows = resolve.brain_lines(["Ruiz", "Dana"], keep=resolve.street_in)
        finally:
            resolve.BRAIN = old
        self.assertEqual(len(rows), 1)
        self.assertIn("12 Main St", rows[0])

    def _brain(self, text, csv=""):
        tmp = Path(tempfile.mkdtemp())
        (tmp / "core").mkdir(parents=True)
        (tmp / "core" / "people.md").write_text(text)
        if csv:
            (tmp / "chewbacca" / "agents").mkdir(parents=True)
            (tmp / "chewbacca" / "agents" / "contacts.csv").write_text(csv)
        return tmp

    def _resolve(self, brain, about, path="/usr/bin:/bin"):
        old, old_path = resolve.BRAIN, os.environ.get("PATH", "")
        resolve.BRAIN, os.environ["PATH"] = brain, path
        try:
            return resolve.resolve("their address", about, fetch=census({}))
        finally:
            resolve.BRAIN, os.environ["PATH"] = old, old_path

    def test_another_person_who_shares_a_surname_is_not_the_answer(self):
        # Break-it, 2026-10-19: a line naming both words in another order gave
        # "Gavin Munroe" his cousin Zed's address.
        brain = self._brain("Gavin Munroe lives at 2849 Summerdale Dr Dallas TX 75287\n"
                            "Zed Munroe, Gavin's cousin, 12 Oak St Beverly Hills CA 90210\n")
        got = " ".join(a["answer"] for a in self._resolve(brain, "Gavin Munroe")["answers"])
        self.assertIn("2849 Summerdale", got)
        self.assertNotIn("12 Oak St", got)

    def test_a_contacts_row_with_split_name_fields_still_counts(self):
        brain = self._brain("", csv='Dana,"",Ruiz,"","","","",+15555550100,"","","12 Main St Austin TX 78701",""\n')
        got = " ".join(a["answer"] for a in self._resolve(brain, "Dana Ruiz")["answers"])
        self.assertIn("12 Main St", got)

    def test_checked_names_only_sources_that_ran_and_blank_about_is_fine(self):
        brain = self._brain("nothing here\n")
        r = self._resolve(brain, "Nobody Atall")
        self.assertNotIn("Contacts", r["checked"])
        self.assertNotIn("people brief", r["checked"])
        self._resolve(brain, "   ")  # was an IndexError


if __name__ == "__main__":
    unittest.main()
