#!/usr/bin/env python3
"""No code fakes a model's confidence. Jev scores it.

2026-10-11: gtme's auto-answer passed "confidence": 1.0 with a comment that
the regex reader had no score, so every reply the regex called interested
cleared the bar. Jev was wired into the kit the whole time. Caleb: "ALWAYS RMR
WE HV JEEV FIX CHEWBS BRO". A judgment that needs a confidence asks Jev
(bin/lib/jev.py), and no score means a person decides. A 1.0 that is a fact
(only one agent exists) says so on its line: "# exact, not a model score".
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PINNED = re.compile(r"""["']confidence["']\s*:\s*1(?:\.0+)?\s*[,}]""")


class NoPinnedConfidence(unittest.TestCase):
    def test_no_source_file_hardcodes_a_perfect_confidence(self):
        hits = []
        for folder in ("tools", "bin/lib", "apps"):
            for path in (ROOT / folder).rglob("*"):
                if path.suffix not in (".py", ".js", ".ts", ".mjs") or "node_modules" in path.parts:
                    continue
                try:
                    text = path.read_text(errors="replace")
                except OSError:
                    continue
                for n, line in enumerate(text.splitlines(), 1):
                    if PINNED.search(line) and "exact, not a model score" not in line:
                        hits.append(f"{path.relative_to(ROOT)}:{n}: {line.strip()}")
        self.assertEqual(hits, [], "Ask Jev for the confidence instead of pinning it:\n" + "\n".join(hits))


if __name__ == "__main__":
    sys.exit(unittest.main())
