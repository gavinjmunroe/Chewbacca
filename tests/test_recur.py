"""bin/recur on synthetic corrections and transcripts: nothing real is read."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def stamp(t):
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(t))


class RecurTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.mem = base / "memory"
        self.mem.mkdir()
        self.saved = time.time() - 10 * 86400
        (self.mem / "feedback_zebra_tables.md").write_text(
            "---\nname: feedback_zebra_tables\ndescription: Never render zebra striped tables in reports\n---\nbody\n")
        # The description shares almost no words with how he says it; his
        # quoted words in the body do. The old matcher missed all four of
        # these on 2026-10-10.
        (self.mem / "feedback_slow_turns.md").write_text(
            "---\nname: feedback_slow_turns\ndescription: Nothing you do should ever take this long\n---\n"
            'He wrote "Wtf taking so long?" twice that night.\n')
        (self.mem / "feedback_quiet_kettle.md").write_text(
            "---\nname: feedback_quiet_kettle\ndescription: The kettle alarm stays quiet after midnight\n---\nbody\n")
        for f in self.mem.iterdir():
            os.utime(f, (self.saved, self.saved))
        proj = base / "projects" / "p"
        proj.mkdir(parents=True)
        lines = []
        def say(text, t):
            lines.append(json.dumps({"type": "user", "timestamp": stamp(t), "sessionId": "s1",
                                     "message": {"role": "user", "content": text}}))
        say("bro the report has zebra striped tables again wtf", time.time() - 86400)
        say("bro zebra striped tables", self.saved - 86400)          # before the save: not a recurrence
        say("lol nice weather today", time.time() - 3600)              # no overlap
        say("Wtf taking so long?????", time.time() - 1800)             # his words, not the description's
        say("make me a report with tables", time.time() - 7200)        # overlap but no repair marker
        filler = ["we shipped the kettle docs today", "midnight deploy went fine", "the alarm app is cool",
                  "render the deck", "reports are due", "quiet night"] * 4
        for i, text in enumerate(filler):
            say(text, time.time() - 5000 - i)
        (proj / "s.jsonl").write_text("\n".join(lines) + "\n")
        self.env = dict(os.environ, CHEWBACCA_RECUR_DIRS=str(self.mem),
                        CHEWBACCA_TRANSCRIPTS=str(base / "projects"),
                        CHEWBACCA_RECUR_CACHE=str(base / "cache" / "asks.json"),
                        CHEWBACCA_RECUR_NO_JUDGE="1")

    def run_recur(self, *args):
        r = subprocess.run([sys.executable, str(ROOT / "bin" / "recur"), *args], env=self.env,
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def test_only_a_repair_after_the_save_counts(self):
        rows = {r["slug"]: r for r in json.loads(self.run_recur("--json"))}
        self.assertEqual(rows["feedback_zebra_tables"]["recurrences"], 1)
        self.assertEqual(rows["feedback_quiet_kettle"]["recurrences"], 0)

    def test_his_quoted_words_find_a_repeat_the_description_would_miss(self):
        rows = {r["slug"]: r for r in json.loads(self.run_recur("--json"))}
        self.assertEqual(rows["feedback_slow_turns"]["recurrences"], 1)

    def test_weekly_counts_every_kept_repeat(self):
        weeks = json.loads(self.run_recur("--weekly", "--json"))
        rows = json.loads(self.run_recur("--json"))
        self.assertEqual(sum(weeks.values()), sum(r["recurrences"] for r in rows))

    def test_evidence_line_is_printed(self):
        out = self.run_recur("zebra_tables")
        self.assertIn("zebra striped tables again", out)
        self.assertNotIn("nice weather", out)

    def test_rerun_uses_the_cache_and_agrees(self):
        first = self.run_recur("--json")
        self.assertTrue((Path(self.env["CHEWBACCA_RECUR_CACHE"])).exists())
        self.assertEqual(first, self.run_recur("--json"))


class JudgeTests(unittest.TestCase):
    """The judge's pick-one step, from cached verdicts only: no model is called."""

    def setUp(self):
        from importlib.machinery import SourceFileLoader
        self.R = SourceFileLoader("recur_under_test", str(ROOT / "bin" / "recur")).load_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.R.JUDGE_CACHE = Path(self.tmp.name) / "choices.json"

    def rows(self):
        said = "Bro we hv NALANA never forget"
        hit = lambda score: {"t": 1.0, "score": score, "shared": [], "said": said}
        return said, [
            {"slug": "feedback_hud_realm", "description": "HUD agent work builds on Realm", "hits": [hit(0.4)]},
            {"slug": "feedback_3d_means_nalana", "description": "any 3D work starts in Nalana", "hits": [hit(0.3)]},
        ]

    def judge_with(self, verdict):
        import hashlib
        said, rows = self.rows()
        key = said + "\0" + "HUD agent work builds on Realm" + "\0" + "any 3D work starts in Nalana"
        gid = hashlib.sha256(key.encode()).hexdigest()[:16]
        self.R.JUDGE_CACHE.write_text(json.dumps({gid: verdict}))
        self.R.judge(rows)
        return {r["slug"]: len(r["hits"]) for r in rows}

    def test_the_picked_candidate_wins_even_when_it_scored_lower(self):
        got = self.judge_with(["b", 0.9])
        self.assertEqual(got, {"feedback_hud_realm": 0, "feedback_3d_means_nalana": 1})

    def test_an_unsure_pick_counts_for_nothing(self):
        got = self.judge_with(["b", 0.4])
        self.assertEqual(got, {"feedback_hud_realm": 0, "feedback_3d_means_nalana": 0})

    def test_none_counts_for_nothing(self):
        self.assertEqual(self.judge_with("none"), {"feedback_hud_realm": 0, "feedback_3d_means_nalana": 0})


if __name__ == "__main__":
    unittest.main()
