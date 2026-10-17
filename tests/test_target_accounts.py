import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
from target_accounts import (is_same_organization, match_employer, normalize_org_name,  # noqa: E402
                             parse_targets, registrable_domain, tenure_overlap)

# Shaped like a real client's published sheet, including its awkward cells.
SHEET = "\n".join([
    "Segment,Type,Account,Company Domain",
    "Health Systems,,Hospital for Special Surgery,www.hss.edu",
    "Health Systems,,Baptist Health,baptisthealth.net",
    "Health Systems,,Universal Health Services (UHS),uhs.com/",
    'Providers,IPA,"Brown & Toland",altais.com/about/brown-and-toland/',
    "Provider Tech,,TriZetto,www.cognizant.com/us/en/trizetto",
    "Provider,Behavioral / ABA,Recovery Centers of America,lp.recoverycentersofamerica.com/",
    "Providers,ASC,Surgery Partners,surgerypartners.com",
    "Health Systems,,Tenet,www.tenethealth.com",
])
TARGETS = parse_targets(SHEET)


class SheetTest(unittest.TestCase):
    def test_reads_every_account_by_header(self):
        self.assertEqual(len(TARGETS), 8)
        bt = next(t for t in TARGETS if t["account"] == "Brown & Toland")
        self.assertEqual((bt["segment"], bt["type"]), ("Providers", "IPA"))

    def test_refuses_a_sheet_with_no_account_column(self):
        with self.assertRaisesRegex(ValueError, "Account column"):
            parse_targets("Name Of Thing,Domain\nx,y.com")

    def test_refuses_a_sign_in_page(self):
        with self.assertRaisesRegex(ValueError, "web page"):
            parse_targets("<!DOCTYPE html><html>sign in</html>")


class DomainTest(unittest.TestCase):
    def test_reduces_a_url_to_the_organization(self):
        self.assertEqual(registrable_domain("https://www.hss.edu/about"), ("hss.edu", True))
        self.assertEqual(registrable_domain("lp.recoverycentersofamerica.com/"),
                         ("recoverycentersofamerica.com", False))
        self.assertEqual(registrable_domain("nhs.co.uk")[0], "nhs.co.uk")
        self.assertEqual(registrable_domain("trust.nhs.co.uk")[0], "nhs.co.uk")
        self.assertEqual(registrable_domain(""), (None, False))


class MatchTest(unittest.TestCase):
    def test_domain_first_even_when_the_name_differs(self):
        t, basis = match_employer("HSS", "hss.edu", TARGETS)
        self.assertEqual((t["account"], basis), ("Hospital for Special Surgery", "domain"))

    def test_a_row_pointing_inside_a_bigger_company_is_a_parent_match(self):
        t, basis = match_employer("Cognizant", "cognizant.com", TARGETS)
        self.assertEqual((t["account"], basis), ("TriZetto", "parent_domain"))

    def test_exact_name_ignores_legal_suffixes_and_punctuation(self):
        self.assertEqual(match_employer("Brown and Toland, Inc.", None, TARGETS)[1], "name")

    def test_full_name_matches_when_the_sheet_adds_an_abbreviation(self):
        t, basis = match_employer("Universal Health Services, Inc.", None, TARGETS)
        self.assertEqual((t["account"], basis), ("Universal Health Services (UHS)", "name"))

    def test_bare_abbreviation_does_not_match(self):
        self.assertEqual(match_employer("UHS", None, TARGETS), (None, None))

    def test_two_baptists_stay_apart(self):
        self.assertEqual(match_employer("Baptist Health South Florida", None, TARGETS), (None, None))
        self.assertNotEqual(normalize_org_name("Baptist Health South Florida"),
                            normalize_org_name("Baptist Health"))

    def test_tenet_healthcare_matches_tenet_only_once_the_domain_is_given(self):
        self.assertEqual(match_employer("Tenet Healthcare", None, TARGETS), (None, None))
        self.assertEqual(match_employer("Tenet Healthcare", "tenethealth.com", TARGETS)[1], "domain")

    def test_the_customer_itself_is_not_a_former_employer(self):
        sp = next(t for t in TARGETS if t["account"] == "Surgery Partners")
        self.assertTrue(is_same_organization(sp, "Surgery Partners", None))
        self.assertTrue(is_same_organization(sp, "Someone Else", "www.surgerypartners.com"))


class OverlapTest(unittest.TestCase):
    def test_overlap_from_the_years_never_guessing_a_missing_one(self):
        self.assertEqual(tenure_overlap(2004, 2007, 2000), ("yes", 3))
        self.assertEqual(tenure_overlap(2004, 2007, 2005), ("yes", 2))
        self.assertEqual(tenure_overlap(2004, 2007, 2007), ("possible", 0))
        self.assertEqual(tenure_overlap(2004, 2007, 2015), ("no", None))
        self.assertEqual(tenure_overlap(2004, 2007, None), ("unknown", None))
        self.assertEqual(tenure_overlap(2004, None, 2005)[0], "unknown")
        self.assertEqual(tenure_overlap(None, 2007, 2005), ("yes", None))


if __name__ == "__main__":
    unittest.main()
