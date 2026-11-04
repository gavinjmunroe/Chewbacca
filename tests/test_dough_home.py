"""The gtme engine lives in Dough. The kit keeps front doors that run Dough's copy and
none of the engine itself, and the kit runtime installs Dough as a snapshot."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARK = "gtme-front-door"
# Engine pieces that live only in Dough now. A file here with any of these names is a
# second copy, the thing the move was for.
ENGINE_ONLY = ["tools/creator_gtm", "tools/next_move.py", "tools/treg_client.py", "tools/brand_buyer.py",
               "bin/lib/gtm_query.py", "config/gtm", "team/gtme-lessons", "skills/gtm-engineering",
               "library/gtm", "tests/test_gtme_solo.py", "tests/test_gtme_operator.py"]
# gtme tools that stay in the kit's Mac layer: credentials on this Mac, or Caleb's
# interview drill over the kit's library.
KIT_GTME = {"gtme_interview.py"}


def git(repo, *args):
    env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
           "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, env=env)


def fake_dough(d):
    """A Dough with a two-module engine and one bin wrapper."""
    root = Path(d) / "dough"
    tools = root / "engine" / "tools"
    (root / "engine" / "bin").mkdir(parents=True)
    tools.mkdir(parents=True)
    (tools / "gtme_solo.py").write_text(
        "import os, sys\nWHO = 'dough'\nimport gtme_ready\n"
        "def main():\n    print('solo', os.environ.get('CHEWBACCA_ROOT', ''), *sys.argv[1:])\n"
        "if __name__ == '__main__':\n    main()\n")
    (tools / "gtme_ready.py").write_text("FROM = __file__\n")
    w = root / "engine" / "bin" / "gtme"
    w.write_text("#!/bin/sh\necho gtme-bin \"$@\"\n")
    w.chmod(0o755)
    return root


class FrontDoors(unittest.TestCase):
    def test_every_engine_module_here_is_a_front_door(self):
        doors = sorted(ROOT.glob("tools/gtme_*.py")) + [ROOT / "tools" / "gtm.py"]
        self.assertGreater(len(doors), 20)
        for f in doors:
            if f.name in KIT_GTME:
                continue
            text = f.read_text()
            self.assertIn(MARK, text, f.name)
            self.assertLess(len(text.splitlines()), 20, f"{f.name} holds code; the engine lives in Dough")

    def test_bin_wrappers_are_front_doors(self):
        for name in ("gtm", "gtme", "gtme-grade", "gtme-dnc", "gtme-dedupe", "gtme-reply", "list-audit", "list-gate"):
            self.assertIn(MARK, (ROOT / "bin" / name).read_text(), name)

    def test_no_second_copy_of_the_engine(self):
        for rel in ENGINE_ONLY:
            self.assertFalse((ROOT / rel).exists(), f"{rel} lives in Dough")


class Resolve(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dough = fake_dough(self.tmp.name)
        self.env = {**os.environ, "DOUGH_HOME": str(self.dough), "PYTHONDONTWRITEBYTECODE": "1"}
        self.env.pop("CHEWBACCA_ROOT", None)

    def tearDown(self):
        self.tmp.cleanup()

    def py(self, code, env=None):
        return subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env or self.env,
                              cwd=self.tmp.name)

    def test_an_import_gets_doughs_module_itself(self):
        p = self.py(f"import sys; sys.path.insert(0, {str(ROOT / 'tools')!r}); import gtme_solo, gtme_ready; "
                    "print(gtme_solo.WHO, gtme_solo.__file__, sys.modules['gtme_solo'] is gtme_solo, gtme_ready.FROM)")
        self.assertEqual(p.returncode, 0, p.stderr)
        who, path, same, ready = p.stdout.split()
        self.assertEqual(who, "dough")
        self.assertEqual(path, str(self.dough / "engine" / "tools" / "gtme_solo.py"))
        self.assertEqual(same, "True")
        self.assertTrue(ready.startswith(str(self.dough)))

    def test_a_script_run_is_doughs_main_and_points_back_at_this_kit(self):
        p = subprocess.run([sys.executable, str(ROOT / "tools" / "gtme_solo.py"), "batch", "--x"],
                           capture_output=True, text=True, env=self.env)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.split(), ["solo", str(ROOT), "batch", "--x"])

    def test_a_bin_front_door_execs_doughs(self):
        p = subprocess.run([sys.executable, str(ROOT / "bin" / "gtme"), "brief"], capture_output=True, text=True,
                           env=self.env)
        self.assertEqual((p.returncode, p.stdout.strip()), (0, "gtme-bin brief"), p.stderr)

    def test_no_dough_says_how_to_get_it(self):
        env = {**self.env, "DOUGH_HOME": "", "HOME": self.tmp.name,
               "CHEWBACCA_DOUGH_RUNTIME": str(Path(self.tmp.name) / "none")}
        # The real home's install is a second place to look; point it nowhere for this test.
        code = (f"import importlib.util as u, sys; s = u.spec_from_file_location('h', {str(ROOT / 'tools' / 'dough_home.py')!r}); "
                "m = u.module_from_spec(s); s.loader.exec_module(m); m.pwd.getpwuid = lambda uid: "
                f"type('P', (), {{'pw_dir': {self.tmp.name!r}}}); "
                "\ntry:\n    m.root()\nexcept m.DoughMissing as e:\n    print('missing', e)")
        p = self.py(code, env)
        self.assertIn("missing", p.stdout, p.stderr)
        self.assertIn("chewbacca update", p.stdout)

    def test_a_bad_dough_home_is_refused_not_ignored(self):
        p = subprocess.run([sys.executable, str(ROOT / "tools" / "gtme_solo.py")], capture_output=True, text=True,
                           env={**self.env, "DOUGH_HOME": self.tmp.name})
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("DOUGH_HOME", p.stderr)


class Install(unittest.TestCase):
    def test_dough_update_builds_a_snapshot_of_origin_main(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            up = fake_dough(d)
            git(up, "init", "-q", "-b", "main")
            git(up, "add", ".")
            git(up, "commit", "-qm", "one")
            src = d / "src"
            subprocess.run(["git", "clone", "-q", str(up), str(src)], check=True, capture_output=True)
            env = {**os.environ, "HOME": str(d), "DOUGH_SOURCE": str(src),
                   "CHEWBACCA_DOUGH_RUNTIME": str(d / "rt")}
            kr = ROOT / "tools" / "kit_runtime.py"
            p = subprocess.run([sys.executable, "-I", str(kr), "dough-update", "--json"], capture_output=True,
                               text=True, env=env)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            res = json.loads(p.stdout)
            self.assertEqual(res["result"], "updated")
            cur = d / "rt" / "current"
            self.assertTrue((cur / "engine" / "tools" / "gtme_solo.py").is_file())
            st = json.loads(subprocess.run([sys.executable, "-I", str(kr), "dough-status", "--json"],
                                           capture_output=True, text=True, env=env).stdout)
            self.assertTrue(st["equal"])
            # A new commit upstream: stale until the next update with a fetch.
            (up / "engine" / "tools" / "gtme_ready.py").write_text("FROM = 'two'\n")
            git(up, "commit", "-qam", "two")
            subprocess.run(["git", "-C", str(src), "fetch", "-q"], check=True, capture_output=True)
            self.assertFalse(json.loads(subprocess.run([sys.executable, "-I", str(kr), "dough-status", "--json"],
                                                       capture_output=True, text=True, env=env).stdout)["equal"])
            p = subprocess.run([sys.executable, "-I", str(kr), "dough-update", "--json"], capture_output=True,
                               text=True, env=env)
            self.assertEqual(json.loads(p.stdout)["result"], "updated")
            self.assertEqual((cur / "engine" / "tools" / "gtme_ready.py").read_text(), "FROM = 'two'\n")
            for snap in (d / "rt" / "snapshots").iterdir():
                if snap.is_dir():
                    subprocess.run(["git", "-C", str(src), "worktree", "remove", "--force", str(snap)],
                                   capture_output=True)


if __name__ == "__main__":
    unittest.main()
