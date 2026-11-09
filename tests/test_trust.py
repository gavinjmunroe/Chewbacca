"""The trust statement covers every source the OS graph reads, in plain words.

Work-ledger mog-b9, 2026-10-13: a person who has never opened Terminal is asked
to let Chewbacca read their texts, and the only account of what happens next
was spread across code comments. The statement lives in config/trust.json and
this test is its owner: a new ingester with no entry, or an entry written in
words that person would not know, fails here.
"""

import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import trust  # noqa: E402
import osgraph_ingest  # noqa: E402
import osgraph  # noqa: E402

# Words the people this is written for do not use. Found in the first draft of
# this file and in the install screens on 2026-10-13.
JARGON = re.compile(r"\b(sqlite|database|MCP|OAuth|API|TCC|launchd|ingest\w*|graph|node|"
                    r"homeserver|wacli|slacrawl|gws|CLI|token|endpoint|repo)\b", re.I)


class TrustTests(unittest.TestCase):
    def setUp(self):
        self.data = trust.load()

    def test_every_source_the_graph_reads_has_an_entry(self):
        missing = sorted(set(osgraph_ingest.INGESTERS) - set(self.data["sources"]))
        self.assertEqual(missing, [], f"sources with no trust entry: {missing}")
        stale = sorted(set(self.data["sources"]) - set(osgraph_ingest.INGESTERS))
        self.assertEqual(stale, [], f"trust entries for sources the graph no longer reads: {stale}")

    def test_entries_say_what_is_read_and_what_leaves(self):
        for key, source in self.data["sources"].items():
            for field in ("name", "reads", "leaves"):
                self.assertTrue(source.get(field, "").strip(), f"{key} has no {field}")

    def test_plain_words_only(self):
        text = trust.render(self.data)
        for line in text.splitlines():
            if "~/.chewbacca" in line:
                line = line.replace("~/.chewbacca/os-graph.sqlite", "").replace("~/.chewbacca", "")
            self.assertIsNone(JARGON.search(line), f"jargon in: {line}")

    def test_numbers_match_the_code(self):
        # The statement promises a file and a retention window. Both are set
        # in osgraph.py; if either moves, the promise has to move with it.
        self.assertIn(str(osgraph.default_path().relative_to(Path.home())), self.data["kept_on_mac"])
        self.assertIn(f"at most {osgraph.RETENTION_DAYS} days", self.data["kept_on_mac"])

    def test_cli_prints_it(self):
        out = subprocess.run(["bash", str(ROOT / "bin" / "chewbacca"), "trust"],
                             capture_output=True, text=True, timeout=20)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("What leaves it", out.stdout)
        self.assertIn("Texts: reads", out.stdout)


if __name__ == "__main__":
    unittest.main()
