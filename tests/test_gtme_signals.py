import contextlib
from datetime import date
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import urllib.parse


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("gtme_signals", ROOT / "tools" / "gtme_signals.py")
signals = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(signals)
FIXTURES = ROOT / "tests" / "fixtures" / "formd"

# Real public SEC filings, saved 2026-10-09: (fixture, cik, accession, EFTS file_type, state).
FILINGS = [
    ("wisecode-0002154039-26-000001.xml", "0002154039", "0002154039-26-000001", "D", "NV"),
    ("metabolica-0002158586-26-000001.xml", "0002158586", "0002158586-26-000001", "D", "FL"),
    ("mvperec26-0002159176-26-000001.xml", "0002159176", "0002159176-26-000001", "D", "CA"),
]


def doc(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


def search_page(filings, total=None):
    return json.dumps({"hits": {"total": {"value": total if total is not None else len(filings)}, "hits": [
        {"_id": f"{adsh}:primary_doc.xml", "_source": {
            "ciks": [cik], "adsh": adsh, "file_type": kind, "file_date": "2026-10-07",
            "biz_states": [state], "display_names": [name]}}
        for name, cik, adsh, kind, state in filings]}})


class FakeFetcher:
    """Serves the search page and fixtures; records every URL so tests can count requests."""

    def __init__(self, filings=FILINGS, pages=None):
        self.filings, self.pages, self.urls = filings, pages, []

    @property
    def requests(self):
        return len(self.urls)

    def get(self, url):
        self.urls.append(url)
        if url.startswith(signals.SEARCH_URL):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            assert query["forms"] == ["D"], query
            if self.pages is not None:
                return self.pages[int(query.get("from", ["0"])[0]) // signals.PAGE_SIZE]
            return search_page(self.filings)
        for name, cik, adsh, _, _ in self.filings:
            if url == signals.xml_url(cik, adsh):
                return doc(name)
        raise AssertionError(f"unexpected request {url}")


class ParserTests(unittest.TestCase):
    def test_operating_company_fields(self):
        row = signals.parse_primary_doc(doc(FILINGS[0][0]), "0002154039", "0002154039-26-000001")
        self.assertEqual(row["issuer"], "WISEcode Inc.")
        self.assertEqual(row["cik"], "2154039")
        self.assertEqual(row["state"], "NV")
        self.assertEqual(row["industry"], "Other Technology")
        self.assertEqual(row["offering_amount"], 1687128)
        self.assertEqual(row["amount_sold"], 0)
        self.assertEqual(row["first_sale"], "yet to occur")
        self.assertFalse(row["is_amendment"])
        self.assertEqual([p["name"] for p in row["people"]], ["Peter Castleman", "Nicholas Poaletti", "Ron Harel"])
        self.assertEqual(row["people"][0]["titles"], ["Executive Officer", "Director"])
        self.assertEqual(row["xml_url"],
                         "https://www.sec.gov/Archives/edgar/data/2154039/000215403926000001/primary_doc.xml")
        self.assertTrue(row["filing_url"].endswith("/2154039/000215403926000001/0002154039-26-000001-index.htm"))

    def test_middle_name_and_health_care(self):
        row = signals.parse_primary_doc(doc(FILINGS[1][0]))
        self.assertEqual(row["issuer"], "Metabolica, Inc.")
        self.assertEqual(row["industry"], "Other Health Care")
        self.assertEqual(row["offering_amount"], 325000)
        self.assertIn("Nicholas Noble", " ".join(p["name"] for p in row["people"]))
        self.assertEqual(row["cik"], "2158586", "cik falls back to the document when not supplied")

    def test_fund_with_indefinite_offering_and_entity_person(self):
        row = signals.parse_primary_doc(doc(FILINGS[2][0]))
        self.assertEqual(row["industry"], signals.FUND_GROUP)
        self.assertEqual(row["fund_type"], "Venture Capital Fund")
        self.assertIsNone(row["offering_amount"])
        self.assertTrue(row["offering_indefinite"])
        self.assertEqual(row["amount_sold"], 3900000)
        self.assertEqual(row["first_sale"], "2026-08-13")
        self.assertEqual([p["name"] for p in row["people"]], ["Andre de Baubigny", "MVP Ventures LLC"])

    def test_entity_name_repeated_in_first_and_last_prints_once(self):
        xml = doc(FILINGS[0][0]).replace("<firstName>Peter</firstName>", "<firstName>Acme LLC</firstName>") \
                                .replace("<lastName>Castleman</lastName>", "<lastName>Acme LLC</lastName>")
        self.assertEqual(signals.parse_primary_doc(xml)["people"][0]["name"], "Acme LLC")

    def test_refuses_entity_declarations(self):
        bomb = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><edgarSubmission>&a;</edgarSubmission>'
        with self.assertRaisesRegex(ValueError, "DTD"):
            signals.parse_primary_doc(bomb)

    def test_search_hits_with_unsafe_ids_are_dropped(self):
        page = json.loads(search_page(FILINGS[:1]))
        page["hits"]["hits"][0]["_source"]["adsh"] = "../../etc/passwd"
        filings, total = signals.parse_hits(page)
        self.assertEqual((filings, total), ([], 1))


class FilterTests(unittest.TestCase):
    def setUp(self):
        self.rows = [signals.parse_primary_doc(doc(name), cik, adsh) for name, cik, adsh, _, _ in FILINGS]

    def kept(self, **options):
        return [row["issuer"] for row in self.rows if signals.keep(row, **options)]

    def test_funds_dropped_unless_asked(self):
        self.assertEqual(self.kept(), ["WISEcode Inc.", "Metabolica, Inc."])
        self.assertEqual(len(self.kept(include_funds=True)), 3)

    def test_industry_is_case_insensitive_substring(self):
        self.assertEqual(self.kept(industry="technology"), ["WISEcode Inc."])
        self.assertEqual(self.kept(industry="Health Care"), ["Metabolica, Inc."])

    def test_min_amount_uses_larger_of_offered_and_sold(self):
        self.assertEqual(self.kept(min_amount=1_000_000), ["WISEcode Inc."])
        self.assertEqual(self.kept(min_amount=3_000_000, include_funds=True), ["MVPEREC26, a series of MVP II Co-Invest LLC"])

    def test_state(self):
        self.assertEqual(self.kept(state="fl"), ["Metabolica, Inc."])


class CommandTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cache = Path(self.directory.name) / "formd"

    def run_main(self, args, fetcher):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = signals.main(["formd", "--cache-dir", str(self.cache)] + args,
                                fetcher=fetcher, today=date(2026, 10, 9))
        return code, out.getvalue(), err.getvalue()

    def test_json_default_window_and_cache_makes_rerun_free(self):
        first = FakeFetcher()
        code, out, _ = self.run_main(["--json"], first)
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual((result["since"], result["until"]), ("2026-10-02", "2026-10-09"))
        self.assertEqual([row["issuer"] for row in result["rows"]], ["WISEcode Inc.", "Metabolica, Inc."])
        self.assertEqual(first.requests, 4)
        self.assertEqual(len(list(self.cache.glob("*.xml"))), 3)
        again = FakeFetcher()
        self.run_main(["--json"], again)
        self.assertEqual(again.requests, 1, "only the search page; every XML came from the cache")

    def test_state_prefilter_skips_xml_requests(self):
        fetcher = FakeFetcher()
        code, out, _ = self.run_main(["--json", "--state", "FL"], fetcher)
        self.assertEqual([row["issuer"] for row in json.loads(out)["rows"]], ["Metabolica, Inc."])
        self.assertEqual(fetcher.requests, 2)

    def test_amendments_skipped_and_one_row_per_issuer(self):
        name, cik, adsh, _, state = FILINGS[0]
        filings = [FILINGS[0], (name, cik, "0002154039-26-000002", "D/A", state), FILINGS[1]]
        code, out, _ = self.run_main(["--json"], FakeFetcher(filings))
        self.assertEqual(len(json.loads(out)["rows"]), 2)
        filings[1] = (name, cik, "0002154039-26-000002", "D", state)
        code, out, _ = self.run_main(["--json"], FakeFetcher(filings))
        self.assertEqual([r["issuer"] for r in json.loads(out)["rows"]], ["WISEcode Inc.", "Metabolica, Inc."])

    def test_limit_stops_fetching(self):
        fetcher = FakeFetcher()
        code, out, _ = self.run_main(["--json", "--limit", "1"], fetcher)
        self.assertEqual(len(json.loads(out)["rows"]), 1)
        self.assertEqual(fetcher.requests, 2)

    def test_pagination_reads_every_page(self):
        pages = [search_page(FILINGS[:2], total=101), search_page(FILINGS[2:], total=101)]
        fetcher = FakeFetcher(pages=pages)
        code, out, _ = self.run_main(["--json", "--include-funds"], fetcher)
        self.assertEqual(len(json.loads(out)["rows"]), 3)
        self.assertIn("from=100", fetcher.urls[3])

    def test_csv_has_one_line_per_issuer_with_people(self):
        code, out, _ = self.run_main(["--csv", "--industry", "Technology"], FakeFetcher())
        lines = out.strip().splitlines()
        self.assertEqual(lines[0].split(",")[:3], ["issuer", "cik", "state"])
        self.assertEqual(len(lines), 2)
        self.assertIn("Peter Castleman (Executive Officer, Director)", lines[1])

    def test_text_output_says_signal_not_proof(self):
        code, out, _ = self.run_main([], FakeFetcher())
        self.assertIn("not proof of intent to buy", out)
        self.assertIn("WISEcode Inc.", out)

    def test_bad_window_is_an_error(self):
        code, _, err = self.run_main(["--since", "2026-10-09", "--until", "2026-10-01"], FakeFetcher())
        self.assertEqual(code, 1)
        self.assertIn("after --until", err)

    def test_throttle_spaces_requests(self):
        now = [0.1]
        waits = []
        fetcher = signals.Fetcher(user_agent="test", sleep=lambda s: (waits.append(s), now.__setitem__(0, now[0] + s)),
                                  clock=lambda: now[0])
        fetcher.last = 0.05
        fetcher.interval = 0.2
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b"ok"
        with mock.patch.object(signals.urllib.request, "urlopen", return_value=response) as opened:
            self.assertEqual(fetcher.get("https://example.test/"), "ok")
        self.assertAlmostEqual(waits[0], 0.15)
        self.assertEqual(opened.call_args[0][0].get_header("User-agent"), "test")

    def test_transient_server_error_is_retried_and_404_is_not(self):
        fetcher = signals.Fetcher(user_agent="test", sleep=lambda s: None)
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b"ok"
        error = lambda code: signals.urllib.error.HTTPError("u", code, "x", {}, None)
        with mock.patch.object(signals.urllib.request, "urlopen", side_effect=[error(500), response]):
            self.assertEqual(fetcher.get("https://example.test/"), "ok")
        with mock.patch.object(signals.urllib.request, "urlopen", side_effect=[error(404)]):
            with self.assertRaises(signals.urllib.error.HTTPError):
                fetcher.get("https://example.test/")

    def test_user_agent_comes_from_environment(self):
        import os
        previous = os.environ.get("CHEWBACCA_SEC_UA")
        os.environ["CHEWBACCA_SEC_UA"] = "Tester test@example.com"
        try:
            self.assertEqual(signals.Fetcher().user_agent, "Tester test@example.com")
        finally:
            if previous is None:
                os.environ.pop("CHEWBACCA_SEC_UA")
            else:
                os.environ["CHEWBACCA_SEC_UA"] = previous
        self.assertIn("@", signals.DEFAULT_UA)


if __name__ == "__main__":
    unittest.main()
