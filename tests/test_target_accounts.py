import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
from target_accounts import (build_connections, collect_target_contacts, is_same_organization,  # noqa: E402
                             match_employer, normalize_org_name, warm_paths,
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


CUSTOMER = {"company": "Surgery Partners", "company_domain": "surgerypartners.com"}
JUSTIN = {"name": "Justin Oppenheimer", "title": "COO", "relation": "colleague", "roles": [
    {"company": "Hospital for Special Surgery", "company_domain": "hss.edu", "title": "VP Operations",
     "start_year": "2016", "end_year": "Dec 2021", "source_url": "https://example.com/justin"},
    {"company": "Surgery Partners", "title": "COO", "start_year": 2022, "end_year": "present",
     "source_url": "https://example.com/sp"},
    {"company": "Baptist Health", "title": "Director", "source_url": ""},
]}
SHANNON = {"name": "Shannon Yarrow", "relation": "self", "roles": [
    {"company": "Tenet Healthcare", "company_domain": "tenethealth.com", "title": "AVP National Contracting",
     "start_year": 2004, "end_year": 2007, "source_url": "https://example.com/shannon"},
    {"company": "Hospital for Special Surgery", "company_domain": "hss.edu", "title": "Director",
     "start_year": 2008, "end_year": 2012, "source_url": "https://example.com/shannon-hss"},
]}
CONTACTS = [
    {"target_account": "Tenet Healthcare", "target_domain": "tenethealth.com", "name": "Pat Rivera",
     "title": "SVP Managed Care", "source_url": "https://example.com/pat", "joined_year": "2005"},
    {"target_account": "Tenet", "name": "Lee Okafor", "title": "CFO",
     "source_url": "https://example.com/lee", "joined_year": 2019},
    {"target_account": "Tenet", "name": "No Source", "title": "VP Payer Relations"},
    {"target_account": "Somewhere Else", "name": "Off List", "source_url": "https://example.com/x"},
]


class PathTest(unittest.TestCase):
    def test_keeps_the_sourced_former_employer_only(self):
        out = build_connections(CUSTOMER, [JUSTIN], TARGETS)
        self.assertEqual(len(out), 1)
        self.assertEqual((out[0]["target_account"], out[0]["match"], out[0]["start_year"], out[0]["end_year"]),
                         ("Hospital for Special Surgery", "domain", 2016, 2021))

    def test_a_model_only_match_is_labelled_and_an_off_sheet_target_dropped(self):
        out = build_connections(CUSTOMER, [{"name": "Shannon Yarrow", "relation": "self", "roles": [
            {"company": "Altais Medical Group", "source_url": "https://example.com/a",
             "target_account": "Brown & Toland", "match_basis": "acquisition"},
            {"company": "Somewhere", "source_url": "https://example.com/b", "target_account": "Not On The List"},
        ]}], TARGETS)
        self.assertEqual([(c["target_account"], c["match"], c["model_match_basis"]) for c in out],
                         [("Brown & Toland", "model_only", "acquisition")])

    def test_buyers_are_placed_by_domain_or_name_and_unsourced_dropped(self):
        buyers = collect_target_contacts(CONTACTS, TARGETS)
        self.assertEqual(list(buyers), ["Tenet"])
        self.assertEqual([b["name"] for b in buyers["Tenet"]], ["Pat Rivera", "Lee Okafor"])

    def test_one_row_per_complete_path_with_overlap(self):
        rows = warm_paths(CUSTOMER, [SHANNON], CONTACTS, TARGETS)
        self.assertEqual(len(rows), 3)
        pat = next(r for r in rows if r["buyer_name"] == "Pat Rivera")
        self.assertEqual((pat["tenure_overlap"], pat["overlap_years"], pat["buyers_found"]), ("yes", 2, 2))
        self.assertEqual(next(r for r in rows if r["buyer_name"] == "Lee Okafor")["tenure_overlap"], "no")
        hss = next(r for r in rows if r["target_account"] == "Hospital for Special Surgery")
        self.assertEqual((hss["buyer_name"], hss["buyers_found"]), (None, 0))

    def test_a_path_never_ends_at_the_bridge(self):
        rows = warm_paths(CUSTOMER, [SHANNON], [{**CONTACTS[1], "name": "Shannon Yarrow"}], TARGETS)
        self.assertTrue(all(r["buyer_name"] != "Shannon Yarrow" for r in rows))


if __name__ == "__main__":
    unittest.main()
