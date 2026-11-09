#!/usr/bin/env python3
"""tools_link puts setup.sh's tools on PATH without rerunning setup, and never
touches a file that's already there."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "tools_link.py"
spec = importlib.util.spec_from_file_location("tools_link", SCRIPT)
tl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tl)

SETUP = '''
link_tool() { :; }
# link_tool commented-out
for _tool in alpha beta; do
  if [ -f "$SCRIPT_DIR/bin/$_tool" ]; then
    link_tool "$_tool"
  fi
done
for other in gamma; do
  echo "$other"
done
for HELPER in delta; do
  link_tool "${HELPER}"
done
link_tool epsilon
[ -f "$SCRIPT_DIR/bin/zeta" ] && link_tool zeta
if link_tool eta; then :; fi
'''


class Names(unittest.TestCase):
    def test_loops_and_literals(self):
        self.assertEqual(tl.names_from_setup(SETUP),
                         ["alpha", "beta", "delta", "epsilon", "zeta", "eta"])

    def test_a_loop_that_never_links_is_ignored(self):
        self.assertNotIn("gamma", tl.names_from_setup(SETUP))

    def test_real_setup_parses(self):
        names = tl.names_from_setup((ROOT / "setup.sh").read_text())
        # chewbacca itself: start.sh's stub was never replaced, so every fresh
        # install's `chewbacca usc` printed stub help (2026-10-10).
        for expected in ("gtme-reply", "text-command", "people", "peekaboo", "hud", "chewbacca",
                         "coursework", "brightspace", "brightspace-sync"):
            self.assertIn(expected, names)
        for name in names:
            self.assertTrue((ROOT / "bin" / name).exists(), f"setup links {name} but bin/{name} is missing")


class Apply(unittest.TestCase):
    def run_tool(self, repo, live, *mode):
        out = subprocess.run([sys.executable, "-I", str(SCRIPT), *mode, "--repo", str(repo),
                              "--live", str(live), "--setup", "-", "--json"],
                             input=SETUP, capture_output=True, text=True, check=True)
        return json.loads(out.stdout)

    def test_links_only_what_is_missing(self):
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            repo, live = tmp / "repo", tmp / "live"
            (repo / "bin").mkdir(parents=True)
            live.mkdir()
            for name in ("alpha", "beta", "delta", "epsilon"):
                (repo / "bin" / name).write_text("#!/bin/sh\n")
            (live / "beta").write_text("someone else's beta\n")   # a real file: keep it
            os.symlink("/nowhere", live / "delta")                # even a broken link stays

            scan = self.run_tool(repo, live, "scan")
            self.assertEqual(scan["missing"], ["alpha", "epsilon"])
            self.assertEqual(scan["absent"], ["zeta", "eta"])
            self.assertFalse((live / "alpha").exists())          # scan writes nothing

            done = self.run_tool(repo, live, "apply")
            self.assertEqual(done["linked_now"], ["alpha", "epsilon"])
            self.assertEqual(os.readlink(live / "alpha"), str((repo / "bin" / "alpha").resolve()))
            self.assertEqual((live / "beta").read_text(), "someone else's beta\n")
            self.assertEqual(os.readlink(live / "delta"), "/nowhere")
            self.assertFalse((live / "zeta").exists())

            again = self.run_tool(repo, live, "apply")
            self.assertEqual(again["linked_now"], [])

    def test_start_sh_stub_is_replaced_and_nothing_else(self):
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            repo, live = tmp / "repo", tmp / "live"
            (repo / "bin").mkdir(parents=True)
            live.mkdir()
            for name in ("alpha", "beta"):
                (repo / "bin" / name).write_text("#!/bin/sh\n")
            # The exact header start.sh writes, read from start.sh itself.
            header = next(l for l in (ROOT / "start.sh").read_text().splitlines()
                          if l.startswith("# Chewbacca control."))
            (live / "alpha").write_text("#!/bin/bash\n" + header + "\n")
            (live / "beta").write_text("#!/bin/bash\n# my own beta\n")
            done = self.run_tool(repo, live, "apply")
            self.assertIn("alpha", done["linked_now"])
            self.assertTrue((live / "alpha").is_symlink())
            self.assertEqual((live / "beta").read_text(), "#!/bin/bash\n# my own beta\n")


if __name__ == "__main__":
    unittest.main()
