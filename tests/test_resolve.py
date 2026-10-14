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


if __name__ == "__main__":
    unittest.main()
