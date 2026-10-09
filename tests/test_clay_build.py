"""clay-build: one locked run at a time, refusing without Kyber, and touching
Chewie's Chrome only to open a Clay tab when none is open. Nothing here starts
Kyber, Chrome or the real tab board."""
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import clay_lock  # noqa: E402

BIN = ROOT / "bin" / "clay-build"
HOLD = ("import sys, time; sys.path.insert(0, sys.argv[1]); import clay_lock; "
        "fd, _ = clay_lock.acquire(sys.argv[2]); print('ready', flush=True); time.sleep(30)")


def load_cli():
    loader = SourceFileLoader("clay_build_cli", str(BIN))
    module = module_from_spec(spec_from_loader("clay_build_cli", loader))
    loader.exec_module(module)
    return module


class Holder:
    """A child process holding the lock, killed on exit."""

    def __init__(self, path: Path):
        self.proc = subprocess.Popen([sys.executable, "-c", HOLD, str(ROOT / "bin" / "lib"), str(path)],
                                     stdout=subprocess.PIPE, text=True)
        assert self.proc.stdout.readline().strip() == "ready"

    def __enter__(self):
        return self.proc

    def __exit__(self, *exc):
        self.proc.kill()
        self.proc.wait()
        self.proc.stdout.close()


class Lock(unittest.TestCase):
    def test_a_held_lock_names_its_holder_and_frees_when_it_dies(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "clay-build.lock"
            with Holder(path) as child:
                fd, holder = clay_lock.acquire(path)
                self.assertIsNone(fd)
                self.assertEqual(holder, str(child.pid))
            fd, holder = clay_lock.acquire(path)
            self.assertIsInstance(fd, int)
            self.assertEqual(holder, "")
            os.close(fd)

    def test_the_lock_lives_under_chewbacca_home(self):
        self.assertEqual(clay_lock.lock_path({"CHEWBACCA_HOME": "/x/y"}), Path("/x/y/clay-build.lock"))
        self.assertEqual(clay_lock.lock_path({}), Path.home() / ".chewbacca" / "clay-build.lock")


class Cli(unittest.TestCase):
    def run_cli(self, *args, home: str):
        env = {**os.environ, "CHEWBACCA_HOME": home, "BOB_HUD_SOCKET": str(Path(home) / "none.sock")}
        return subprocess.run([sys.executable, str(BIN), *args], capture_output=True, text=True, env=env,
                              timeout=30)

    def test_usage(self):
        with tempfile.TemporaryDirectory() as d:
            for args in (["fintech VC partners", "--count", "0"], ["fintech VC partners", "--count", "501"],
                         ["--count", "50"], ["   ", "--count", "50"], ["fintech VC partners"]):
                self.assertEqual(self.run_cli(*args, home=d).returncode, 2, args)

    def test_refuses_without_kyber(self):
        with tempfile.TemporaryDirectory() as d:
            got = self.run_cli("fintech VC partners", "--count", "50", home=d)
        self.assertEqual(got.returncode, 3)
        self.assertIn("Kyber isn't running", got.stderr)
        last = json.loads(got.stdout.strip().splitlines()[-1])
        self.assertEqual(last, {"state": "refused", "line": "Kyber isn't running, and this run is meant to be watched.",
                                "spent": 0.0})

    def test_refuses_while_another_run_holds_the_lock(self):
        with tempfile.TemporaryDirectory() as d:
            with Holder(Path(d) / "clay-build.lock") as child:
                got = self.run_cli("fintech VC partners", "--count", "50", home=d)
        self.assertEqual(got.returncode, 3)
        self.assertIn(str(child.pid), got.stderr)


class Tabs(unittest.TestCase):
    def setUp(self):
        self.cli = load_cli()
        self.opened = []

    def ready(self, counts):
        counts = iter(counts)
        return self.cli.clay_tab(9333, targets=lambda port: [{}] * next(counts),
                                 open_tab=lambda port: self.opened.append(port), sleep=lambda s: None)

    def test_one_tab_is_used_as_it_is(self):
        self.assertIsNone(self.ready([1]))
        self.assertEqual(self.opened, [])

    def test_no_tab_opens_exactly_one(self):
        self.assertIsNone(self.ready([0, 0, 1]))
        self.assertEqual(self.opened, [9333])

    def test_two_tabs_refuse_and_open_nothing(self):
        self.assertEqual(self.ready([2]), "Two Clay tabs are open in Chewie's Chrome. Close one, then run it again.")
        self.assertEqual(self.opened, [])

    def test_a_tab_that_never_appears_says_so(self):
        got = self.ready([0] * 1000)
        self.assertIn("Clay did not open", got)
        self.assertEqual(self.opened, [9333])

    def test_the_only_url_ever_passed_is_clay_home(self):
        calls = []
        self.cli.open_clay_tab(9333, run=lambda argv, **kw: calls.append((argv, kw["env"])) or
                               subprocess.CompletedProcess(argv, 0, "1\n", ""))
        argv, env = calls[0]
        self.assertEqual(argv[-1], "https://app.clay.com/")
        self.assertEqual(env["CHEWIE_CDP_PORT"], "9333")
        self.assertNotIn("CHEWIE_WEB_FRAME", env)


class Board(unittest.TestCase):
    def test_board_trouble_never_stops_a_run(self):
        cli = load_cli()

        def broken(argv, **kw):
            raise subprocess.TimeoutExpired(argv, 5)

        err = io.StringIO()
        board = cli.Board("clay-build-1", run=broken, err=err)
        board.register("fintech VC partners", 50)
        board.note("step 1 of 6: FIND PEOPLE")
        board.end()
        self.assertIn("tab board", err.getvalue())

    def test_board_lines(self):
        cli = load_cli()
        calls = []
        board = cli.Board("clay-build-7", run=lambda argv, **kw: calls.append((argv, kw["timeout"])) or
                          subprocess.CompletedProcess(argv, 0, "", ""))
        board.register("fintech VC partners", 50)
        board.note("step 1 of 6: FIND PEOPLE")
        board.end()
        self.assertEqual([argv[1:] for argv, _ in calls], [
            ["register", "--session", "clay-build-7", "--runtime", "clay-build", "--cwd", str(ROOT),
             "clay-build: fintech VC partners x50"],
            ["note", "--session", "clay-build-7", "step 1 of 6: FIND PEOPLE"],
            ["end", "--session", "clay-build-7"],
        ])
        self.assertTrue(all(timeout == 5 for _, timeout in calls))


class Exits(unittest.TestCase):
    def test_every_outcome_has_its_exit(self):
        cli = load_cli()
        self.assertEqual({s: cli.EXITS[s] for s in ("done", "dry-run", "failed", "stopped", "declined", "refused")},
                         {"done": 0, "dry-run": 0, "failed": 1, "stopped": 4, "declined": 4, "refused": 3})


if __name__ == "__main__":
    unittest.main()
