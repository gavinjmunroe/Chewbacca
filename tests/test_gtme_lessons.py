"""gtme lesson: every oracle refuses the claims it can't support, the ledger keeps
history and private data out, and retrieval passes the sealed held-out cases."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import gtme_lessons as L  # noqa: E402

HELDOUT = json.loads((ROOT / "tests" / "fixtures" / "gtme_lessons_heldout.json").read_text())


def lesson(**over):
    x = {"id": "acme-test-lesson", "title": "A synthetic lesson", "client": "Acme", "date": "2026-10-16",
         "stage": "copy", "applies_to": ["copy"], "hypothesis": "h", "change": "c",
         "oracle": {"metric": "reply_rate", "numerator": 40, "denominator": 600, "unit": "people",
                    "source": "gtm_funnel", "baseline": "the old opener, 20 of 600"},
         "result": "r", "verdict": "confirmed", "next_decision": "n", "check": "k", "evidence": ["docs/plans/GTME-MEMORY.md"]}
    x.update(over)
    return x


def with_oracle(verdict="confirmed", **o):
    x = lesson(verdict=verdict)
    x["oracle"] = {**x["oracle"], **o}
    return x


class OraclesRejectWhatTheyShould(unittest.TestCase):
    """REA: test the checker with deliberate failures before trusting it."""

    def assertRefused(self, x, needle):
        errs = L.lesson_errors(x)
        self.assertTrue(any(needle in e for e in errs), f"expected {needle!r} in {errs}")

    def test_a_good_confirmed_lesson_passes(self):
        self.assertEqual(L.lesson_errors(lesson()), [])

    def test_small_sample_cannot_confirm(self):
        self.assertRefused(with_oracle(denominator=120, numerator=9), "denominator of at least 500")

    def test_small_sample_cannot_refute_either(self):
        self.assertRefused(with_oracle("refuted", denominator=120, numerator=9), "denominator of at least 500")

    def test_small_sample_is_fine_as_inconclusive(self):
        self.assertEqual(L.lesson_errors(with_oracle("inconclusive", denominator=120, numerator=9)), [])

    def test_no_baseline_cannot_confirm(self):
        self.assertRefused(with_oracle(baseline=""), "needs a baseline")

    def test_unstated_unit_cannot_confirm(self):
        self.assertRefused(with_oracle(unit=None), "needs a unit")

    def test_positive_replies_never_from_a_category(self):
        self.assertRefused(with_oracle("observed", metric="positive_reply_rate", source="clay_category"),
                           "never trusts source")

    def test_positive_replies_from_reply_text_pass(self):
        self.assertEqual(L.lesson_errors(with_oracle(metric="positive_reply_rate", source="reply_text")), [])

    def test_verified_email_needs_the_domain_check(self):
        x = with_oracle("observed", metric="verified_email_rate", source="zerobounce", unit="contacts",
                        numerator=3, denominator=3)
        self.assertRefused(x, "domain_checked")
        x["oracle"]["domain_checked"] = True
        self.assertEqual(L.lesson_errors(x), [])

    def test_meetings_never_inferred(self):
        self.assertRefused(with_oracle("observed", metric="meetings", source="inferred"), "never trusts source")

    def test_buyer_hit_never_from_the_model_pick(self):
        self.assertRefused(with_oracle("observed", metric="buyer_hit_rate", source="jev_choice", unit="accounts"),
                           "never trusts source")

    def test_cost_never_per_attempted_row(self):
        self.assertRefused(with_oracle("observed", metric="credits_per_verified", source="credit_ledger",
                                       unit="attempted"), "never measured per")

    def test_proxy_cannot_confirm(self):
        self.assertRefused(with_oracle(metric="grade_score", source="gtme_grade", unit="drafts", denominator=600),
                           "is a proxy")

    def test_observation_cannot_confirm(self):
        self.assertRefused(with_oracle(metric="observation", source="run_log", unit="cases", denominator=600),
                           "is a observation")

    def test_mechanical_confirms_on_one_clean_case_without_baseline(self):
        self.assertEqual(L.lesson_errors(with_oracle(metric="row_chars", source="clay_row_read", unit="rows",
                                                     numerator=2800, denominator=1, baseline="")), [])

    def test_rate_numerator_over_denominator(self):
        self.assertRefused(with_oracle("observed", numerator=700, denominator=600), "larger than its denominator")

    def test_unknown_metric(self):
        self.assertRefused(with_oracle(metric="vibes"), "unknown oracle metric")

    def test_need_marker_means_pending(self):
        self.assertRefused(lesson(verdict="observed", result="[NEED: the unit]"), "still pending")


class VerifiedEmailRowOracle(unittest.TestCase):
    def test_on_domain_valid_counts(self):
        self.assertTrue(L.verified_email("gymshark.com", "valid", "gymshark.com")[0])

    def test_subdomain_counts(self):
        self.assertTrue(L.verified_email("uk.gymshark.com", "valid", "https://www.gymshark.com/")[0])

    def test_parent_domain_counts(self):
        self.assertTrue(L.verified_email("vitaminwell.com", "valid", "barebells.com", ["vitaminwell.com"])[0])

    def test_valid_at_another_company_is_refused(self):
        ok, why = L.verified_email("supplementco.com", "valid", "gymshark.com")
        self.assertFalse(ok)
        self.assertIn("wrong person", why)

    def test_lookalike_suffix_is_refused(self):
        self.assertFalse(L.verified_email("notgymshark.com", "valid", "gymshark.com")[0])

    def test_invalid_and_catch_all_are_refused(self):
        self.assertFalse(L.verified_email("gymshark.com", "invalid", "gymshark.com")[0])
        self.assertFalse(L.verified_email("gymshark.com", "catch-all", "gymshark.com")[0])

    def test_port_and_trailing_dot_are_ignored(self):
        self.assertTrue(L.verified_email("gymshark.com.", "valid", "https://gymshark.com:443/pages")[0])

    def test_a_whole_address_reads_its_domain(self):
        self.assertTrue(L.verified_email("someone@gymshark.com", "VALID", "gymshark.com")[0])


class Portability(unittest.TestCase):
    def test_title_or_check_naming_the_client_is_refused(self):
        for field in ("title", "check"):
            errs = L.lesson_errors(lesson(**{field: "What Acme taught us"}))
            self.assertTrue(any("names the client" in e for e in errs), (field, errs))

    def test_client_named_in_result_is_fine(self):
        self.assertEqual(L.lesson_errors(lesson(result="Acme's list was 10 of 481 fits")), [])

    def test_missing_kit_evidence_breaks_and_away_evidence_is_noted(self):
        d = Path(tempfile.mkdtemp())
        L.write(lesson(id="acme-kit-ev", evidence=["docs/no-such-file.md"]), d)
        L.write(lesson(id="acme-away-ev", evidence=["~/no-such-dir-gtme/x.md", "ab12cd3"]), d)
        got = {r["id"]: r for r in L.audit(L.load_all(d))}
        self.assertEqual(got["acme-kit-ev"]["state"], "BROKEN")
        self.assertEqual(got["acme-away-ev"]["state"], "PROSE")
        self.assertIn("not on this Mac", got["acme-away-ev"]["detail"])


class Privacy(unittest.TestCase):
    def test_email_address_refused(self):
        errs = L.lesson_errors(lesson(result="found someone@brand.com"))
        self.assertTrue(any("email address" in e for e in errs))

    def test_phone_refused(self):
        errs = L.lesson_errors(lesson(result="call +1 310 555 0100"))
        self.assertTrue(any("phone" in e for e in errs))

    def test_counts_and_dates_are_not_phones(self):
        self.assertEqual(L.lesson_errors(lesson(result="1,548 refs on 2026-10-16, 49,826 chars")), [])


class Ledger(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def test_write_refuses_bad_and_duplicate(self):
        with self.assertRaises(L.LessonError):
            L.write(with_oracle(denominator=10), self.dir)
        L.write(lesson(), self.dir)
        with self.assertRaises(L.LessonError):
            L.write(lesson(), self.dir)

    def test_record_appends_history_never_erases(self):
        L.write(with_oracle("inconclusive", denominator=120, numerator=9), self.dir)
        L.record("acme-test-lesson", "now 40 of 600 against 20 of 600", "confirmed", "keep it",
                 lesson()["oracle"], when="2026-10-30", ledger=self.dir)
        got = json.loads((self.dir / "acme-test-lesson.json").read_text())
        self.assertEqual(got["verdict"], "confirmed")
        self.assertEqual(got["history"][0]["verdict"], "inconclusive")
        self.assertEqual(got["history"][0]["oracle"]["denominator"], 120)

    def test_record_refuses_an_unsupported_upgrade(self):
        L.write(with_oracle("inconclusive", denominator=120, numerator=9), self.dir)
        with self.assertRaises(L.LessonError):
            L.record("acme-test-lesson", "looks better", "confirmed", ledger=self.dir)

    def test_audit_states(self):
        L.write(lesson(id="acme-checked", check_ref=["kit:tools/gtme_lessons.py::def verified_email"]), self.dir)
        L.write(lesson(id="acme-prose"), self.dir)
        L.write(lesson(id="acme-broken-ref", check_ref=["kit:tools/gtme_lessons.py::no such needle"]), self.dir)
        L.write(lesson(id="acme-orphan", derived_from=["acme-missing"]), self.dir)
        old = json.loads((self.dir / "acme-prose.json").read_text())
        old["id"] = "acme-revisit"
        old["oracle"]["version"] = 0
        (self.dir / "acme-revisit.json").write_text(json.dumps(old))
        (self.dir / "acme-junk.json").write_text("{not json")
        (self.dir / "acme-bare.json").write_text(json.dumps({"id": "acme-bare", "title": "no other fields"}))
        got = {r["id"]: r["state"] for r in L.audit(L.load_all(self.dir))}
        self.assertEqual(got, {"acme-checked": "CHECKED", "acme-prose": "PROSE", "acme-broken-ref": "BROKEN",
                               "acme-orphan": "BROKEN", "acme-revisit": "REVISIT", "acme-junk": "BROKEN",
                               "acme-bare": "BROKEN"})


class RealLedger(unittest.TestCase):
    """The ledger in git passes its own audit."""

    def test_audit_has_no_broken_lesson(self):
        rows = L.audit(L.load_all(ROOT / "team" / "gtme-lessons"))
        self.assertGreaterEqual(len(rows), 10)
        self.assertEqual([r for r in rows if r["state"] == "BROKEN"], [])


def run_case(case, lessons):
    hits = L.rank(case["query"], lessons, case.get("client"), case.get("exclude_client"),
                  limit=case.get("within", 5))
    ids = [h["lesson"]["id"] for h in hits]
    if case.get("must_be_empty"):
        return ids == [], ids
    ok = all(i in ids for i in case.get("must_include", []))
    if case.get("must_include_any"):
        ok = ok and any(i in ids for i in case["must_include_any"])
    if case.get("must_include_stage"):
        ok = ok and any(h["lesson"]["stage"] == case["must_include_stage"] for h in hits)
    return ok, ids


class HeldOutRetrieval(unittest.TestCase):
    """Sealed cases from tests/fixtures/gtme_lessons_heldout.json, against the real ledger."""

    lessons = L.load_all(ROOT / "team" / "gtme-lessons")

    def test_first_sealed_batch(self):
        for case in HELDOUT["cases"]:
            ok, ids = run_case(case, self.lessons)
            self.assertTrue(ok, f"{case['id']} got {ids}")

    def test_second_sealed_batch(self):
        for case in HELDOUT["cases_second"]:
            ok, ids = run_case(case, self.lessons)
            self.assertTrue(ok, f"{case['id']} got {ids}")

    def test_leave_one_client_out_finds_the_ancestor(self):
        """H6: a lesson that names a parent finds it with its own client hidden."""
        pairs = [(x, p) for x in self.lessons for p in x.get("derived_from") or []]
        self.assertTrue(pairs)
        for x, parent in pairs:
            ids = [h["lesson"]["id"] for h in L.rank(x["title"] + " " + x["hypothesis"], self.lessons,
                                                     exclude_client=x["client"], limit=5)]
            self.assertIn(parent, ids, f"{x['id']} -> {parent}: got {ids}")

    def test_transfer_is_marked(self):
        hits = L.rank(HELDOUT["cases"][0]["query"], self.lessons, client="Sabo", exclude_client="Sabo")
        self.assertTrue(hits and all(h["transfer"] for h in hits))

    def test_single_shared_word_is_not_a_match(self):
        self.assertEqual(L.rank("email", self.lessons), [])


class PlanShowsLessons(unittest.TestCase):
    """gtme start shows the checks, and never another person's client name."""

    def lines(self, clients):
        import gtme_operator as op

        class Out:
            def __init__(self):
                self.lines = []

            def say(self, line=""):
                self.lines.append(line)

        out, real = Out(), op.load_config
        op.load_config = lambda: {"clients": [{"name": c} for c in clients]}
        try:
            op.show_lessons(out, {"client": "Newco", "icp": {"buyer": "brand partnerships managers",
                                                             "company": "consumer brands"},
                                  "offer": {"promise": "creators for your next campaign"}})
        finally:
            op.load_config = real
        return "\n".join(out.lines)

    def test_stranger_sees_checks_without_client_names(self):
        text = self.lines([])
        self.assertIn("check:", text)
        self.assertIn("an earlier client", text)
        for name in ("Zeutara", "Sabo", "Qube", "Gymshark"):
            self.assertNotIn(name, text)

    def test_own_client_is_named(self):
        self.assertRegex(self.lines(["Zeutara", "Sabo"]), r"from (Zeutara|Sabo)")


class Cli(unittest.TestCase):
    def run_cli(self, *args, env=None):
        e = dict(os.environ, **(env or {}))
        return subprocess.run([sys.executable, str(ROOT / "tools" / "gtme_operator.py"), "lesson", *args],
                              capture_output=True, text=True, env=e, cwd=str(ROOT))

    def test_plan_through_gtme(self):
        r = self.run_cli("plan", "the campaign got paused for bounces, how do we restart it safely")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("recovery window", r.stdout)
        self.assertIn("check:", r.stdout)

    def test_plan_with_nothing_relevant_says_so(self):
        r = self.run_cli("plan", "make the TTS logo spin in Blender")
        self.assertEqual(r.returncode, 0)
        self.assertIn("No lesson in the ledger covers this", r.stdout)

    def test_add_refuses_and_writes(self):
        d = tempfile.mkdtemp()
        env = {"GTME_LESSONS_DIR": d}
        bad = Path(d) / "bad.in"
        bad.write_text(json.dumps(with_oracle(metric="positive_reply_rate", source="clay_category")))
        r = self.run_cli("add", str(bad), env=env)
        self.assertEqual(r.returncode, 2)
        self.assertIn("never trusts source", r.stderr)
        good = Path(d) / "good.in"
        good.write_text(json.dumps(lesson()))
        r = self.run_cli("add", str(good), env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((Path(d) / "acme-test-lesson.json").is_file())

    def test_verified_email_exit_codes(self):
        self.assertEqual(self.run_cli("verified-email", "--email-domain", "gymshark.com", "--status", "valid",
                                      "--brand-domain", "gymshark.com").returncode, 0)
        self.assertEqual(self.run_cli("verified-email", "--email-domain", "other.com", "--status", "valid",
                                      "--brand-domain", "gymshark.com").returncode, 1)

    def test_template_is_pending_and_refused_until_filled(self):
        r = self.run_cli("template")
        t = json.loads(r.stdout)
        self.assertEqual(t["verdict"], "pending")
        self.assertTrue(L.lesson_errors(copy.deepcopy(t)))


if __name__ == "__main__":
    unittest.main()
