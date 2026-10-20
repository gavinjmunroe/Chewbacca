"""Tests for the extended structured prior (Layer-6 additive fields).

Covers the three guarantees of the additive change:
  (a) a contact sharing me.schools / me.cities / me.employers ranks ABOVE an
      otherwise-identical contact that shares none of them;
  (b) when all the new fields are empty, the scoring primitives are IDENTICAL
      to the legacy city/occupation-only behavior (so ranking is unchanged);
  (c) unknown/stray extra fields on the payload are still accepted (ignored),
      never rejected -- we must not 422 the live medha-id caller.

Run fully offline: keys are popped so relevance falls back to local TF-IDF /
keyword and the grounded answer is skipped. No network, no API spend.

Run: python -m unittest discover -s tests
"""
import os
import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from api.people_rank import run_people_rank, _proximity, _scoring_units, _prox_flags  # noqa: E402
from api.schemas import ContactIn, MeProfile, PeopleRankRequest  # noqa: E402


def _legacy_proximity(me, c):
    """Reimplementation of the pre-change _proximity, verbatim, so (b) can
    assert the new function reduces to it exactly when the extended fields are
    empty. Do NOT 'simplify' this to call the new code -- its whole job is to be
    an independent oracle for the legacy behavior."""
    if me is None:
        return 0.0
    score = 0.0
    if me.city and c.city and me.city.strip().lower() == c.city.strip().lower():
        score += 0.5
    if me.occupation:
        import re
        toks = lambda s: set(re.findall(r"[a-z0-9]+", (s or "").lower()))
        occ = toks(me.occupation)
        ctx = toks(" ".join(x for x in [c.title, c.company] if x))
        if occ & ctx:
            score += 0.5
    return min(1.0, max(0.0, score))


class PriorSignalsTest(unittest.TestCase):
    def setUp(self):
        self._saved = {}
        for k in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
            self._saved[k] = os.environ.pop(k, None)
        os.environ["PEOPLERANK_CACHE_DISABLED"] = "1"

    def tearDown(self):
        for k, v in self._saved.items():
            if v is not None:
                os.environ[k] = v
        os.environ.pop("PEOPLERANK_CACHE_DISABLED", None)

    # ---- (a) shared prior ranks a matching contact above a non-matching one --
    def test_shared_prior_ranks_matching_contact_above(self):
        # me.city intentionally left empty so the legacy same-city path cannot
        # fire; the ONLY way `match` beats `control` is the extended prior
        # (cities membership, employer overlap, school overlap). No query -> the
        # final score IS proximity, so this isolates the prior cleanly.
        me = MeProfile(
            cities=["Boston"],
            employers=["Acme Corp"],
            schools=["Stanford University"],
        )
        match = ContactIn(
            contactId="match",
            name="Match Person",
            city="Boston",                       # in me.cities
            company="Acme Corp",                 # in me.employers
            notes="studied at Stanford University",  # school overlap via profile text
        )
        control = ContactIn(
            contactId="control",
            name="Control Person",
            city="Denver",
            company="Globex",
            notes="enjoys hiking",
        )
        req = PeopleRankRequest(me=me, contacts=[match, control])
        out = run_people_rank(req)

        order = [p["contactId"] for p in out["people"]]
        self.assertEqual(order[0], "match", f"expected match first, got order {order}")

        by_id = {p["contactId"]: p for p in out["people"]}
        self.assertGreater(
            by_id["match"]["components"]["proximity"],
            by_id["control"]["components"]["proximity"],
        )
        self.assertGreater(by_id["match"]["components"]["proximity"], 0.0)
        # Control shares nothing structural -> zero prior.
        self.assertEqual(by_id["control"]["components"]["proximity"], 0.0)

    # ---- (b) empty new fields => identical to legacy behavior -----------------
    def test_empty_new_fields_proximity_matches_legacy(self):
        # Matrix of city/occupation combos, all with the extended fields empty.
        # The new _proximity must equal the legacy oracle exactly.
        me = MeProfile(city="London", occupation="Software Engineer")
        cases = [
            ContactIn(contactId="a", name="A", city="London", title="Engineer", company="X"),   # city + field
            ContactIn(contactId="b", name="B", city="London", title="Chef", company="Kitchen"), # city only
            ContactIn(contactId="c", name="C", city="Paris", title="Software Lead", company="Y"),# field only
            ContactIn(contactId="d", name="D", city="Paris", title="Chef", company="Z"),         # neither
            ContactIn(contactId="e", name="E"),                                                  # empty contact
        ]
        for c in cases:
            self.assertEqual(
                _proximity(me, c),
                _legacy_proximity(me, c),
                f"proximity diverged from legacy for contact {c.contactId}",
            )
        # And me=None short-circuits to 0.0 exactly as before.
        self.assertEqual(_proximity(None, cases[0]), 0.0)

    def test_empty_new_fields_profile_unit_byte_identical(self):
        # A contact with no industry and no tags must produce the exact same
        # profile scoring-unit text as the legacy notes/title/company/city join.
        c = ContactIn(
            contactId="p", name="P", title="Engineer", company="Acme",
            city="London", notes="likes tacos",
        )
        legacy_profile = " ".join(
            x for x in [c.notes, c.title, c.company, c.city] if x
        ).strip()
        units = _scoring_units(c)
        profile_units = [text for fact, text in units if fact is None]
        self.assertEqual(profile_units, [legacy_profile])

    def test_empty_new_fields_ranking_unchanged(self):
        # End-to-end: a proximity-only request where nobody sets any new field
        # ranks and scores exactly as the legacy hand-computation predicts.
        me = MeProfile(city="London", occupation="Engineer")
        contacts = [
            ContactIn(contactId="near", name="Near", city="London"),
            ContactIn(contactId="far", name="Far", city="Tokyo"),
            ContactIn(contactId="field", name="Field", title="Engineer"),
        ]
        req = PeopleRankRequest(me=me, contacts=contacts)
        out = run_people_rank(req)
        got = {p["contactId"]: p["components"]["proximity"] for p in out["people"]}
        for c in contacts:
            self.assertAlmostEqual(got[c.contactId], _legacy_proximity(me, c), places=4)

    # ---- school/employer overlap requires a NON-stopword shared token ---------
    def test_school_overlap_ignores_generic_tokens(self):
        me = MeProfile(schools=["University of Texas"])
        # Only shared tokens are generic ("of", "university") -> must NOT flag.
        generic = ContactIn(
            contactId="g", name="Generic",
            company="University of Phoenix",   # shares "university", "of" only
        )
        self.assertFalse(_prox_flags(me, generic)["school"])

        # Shares the discriminating token "texas" -> MUST flag.
        real = ContactIn(
            contactId="r", name="Real",
            notes="grew up in Texas",          # shares "texas"
        )
        self.assertTrue(_prox_flags(me, real)["school"])

        # And the generic-only contact gets zero proximity (no other signal),
        # while the real match gets a positive prior.
        self.assertEqual(_proximity(me, generic), 0.0)
        self.assertGreater(_proximity(me, real), 0.0)

    def test_employer_overlap_ignores_generic_tokens(self):
        me = MeProfile(employers=["Acme Corp"])
        # Shares only "corp" (a stopword) -> must NOT flag.
        generic = ContactIn(contactId="g", name="G", company="Globex Corp")
        self.assertFalse(_prox_flags(me, generic)["employer"])
        # Shares "acme" -> must flag.
        real = ContactIn(contactId="r", name="R", company="Acme Industries")
        self.assertTrue(_prox_flags(me, real)["employer"])

    # ---- (c) unknown/stray extra fields are accepted, not rejected ------------
    def test_stray_extra_fields_accepted(self):
        # medha-id already sends fields PeopleRank does not model (phoneNumbers,
        # emails, and possibly others). Constructing the request must NOT raise;
        # the stray fields are silently ignored (default extra behavior).
        payload = {
            "query": "who to call",
            "limit": 5,
            "somethingUnknownTopLevel": {"nested": True},
            "me": {
                "id": "me",
                "city": "London",
                "cities": ["Boston"],
                "schools": ["MIT"],
                "unknownMeField": 123,
            },
            "contacts": [
                {
                    "contactId": "c1",
                    "name": "Stray Contact",
                    "phoneNumbers": ["+1-555-0100"],   # not modeled
                    "emails": ["a@b.com"],             # not modeled
                    "industry": "Tech",
                    "tags": ["investor", "warm-intro"],
                    "linkedin_url": "https://linkedin.com/in/x",
                    "randomExtra": "ignored",
                },
            ],
        }
        # Must construct without ValidationError.
        req = PeopleRankRequest(**payload)
        self.assertEqual(len(req.contacts), 1)
        c = req.contacts[0]
        # Modeled new fields are captured...
        self.assertEqual(c.industry, "Tech")
        self.assertEqual(c.tags, ["investor", "warm-intro"])
        self.assertEqual(c.linkedin_url, "https://linkedin.com/in/x")
        # ...stray ones are dropped, not present as attributes.
        self.assertFalse(hasattr(c, "phoneNumbers"))
        self.assertFalse(hasattr(c, "emails"))
        self.assertFalse(hasattr(c, "randomExtra"))
        self.assertEqual(req.me.cities, ["Boston"])
        self.assertEqual(req.me.schools, ["MIT"])
        self.assertFalse(hasattr(req.me, "unknownMeField"))
        self.assertFalse(hasattr(req, "somethingUnknownTopLevel"))
        # And it still runs end-to-end without raising.
        out = run_people_rank(req)
        self.assertIn("people", out)


if __name__ == "__main__":
    unittest.main()
