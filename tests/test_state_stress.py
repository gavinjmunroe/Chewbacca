"""Ten tabs writing the shared state at once lose nothing.

2026-10-12, on the JSON stores before bin/lib/statedb: 10 tabs adding 50 text
drafts at once lost 19 to 22 of them (3 runs), and killing 20 queued jobs
while 10 tabs ticked brought 1 back as paused in 2 of 3 runs. The tabs board
and the work ledger were already SQLite and are checked here so a move back
to files shows up too.

STATE_STRESS_ROOT points the test at another checkout, which is how it was
shown to fail on main's code.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(os.environ.get("STATE_STRESS_ROOT") or pathlib.Path(__file__).resolve().parents[1])
TABS = 10
# Five writes a tab: 50 in all, enough that main's code lost writes in every
# drafts run and most jobs runs, and the whole test stays under a minute.
EACH = 5


class Scratch(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.env = dict(os.environ, CHEWBACCA_HOME=str(self.dir / "home"), CHEWBACCA_NO_SEND="1",
                        NODE_NO_WARNINGS="1")
        self.env.pop("CHEWBACCA_STATE_DB", None)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def fan(self, fn, items):
        with ThreadPoolExecutor(TABS) as ex:
            return list(ex.map(fn, items))


class Drafts(Scratch):
    def run_people(self, *args):
        env = dict(self.env, PEOPLE_DIR=str(self.dir / "people"))
        return subprocess.run([str(ROOT / "bin" / "people"), "texts", "drafts"] + list(args),
                              env=env, capture_output=True, text=True, timeout=120)

    def test_ten_tabs_add_and_drop(self):
        for k in range(TABS):
            self.assertEqual(self.run_people("add", "seed%d" % k, "seed %d" % k, "--voice-ok").returncode, 0)

        def tab(n):
            codes = [self.run_people("add", "tab%d" % n, "draft %d-%d" % (n, k), "--voice-ok").returncode
                     for k in range(EACH)]
            codes.append(self.run_people("drop", str(n + 1)).returncode)
            return codes

        codes = sum(self.fan(tab, range(TABS)), [])
        queue = json.loads((self.dir / "people" / "drafts.json").read_text())
        texts = {d["text"] for d in queue}
        want = {"draft %d-%d" % (n, k) for n in range(TABS) for k in range(EACH)}
        self.assertEqual(sorted(want - texts), [], "drafts lost")
        self.assertEqual(sorted(t for t in texts if t.startswith("seed")), [], "drops lost")
        numbers = [d["n"] for d in queue]
        self.assertEqual(len(numbers), len(set(numbers)), "two drafts share a number")
        self.assertEqual([c for c in codes if c], [], "a tab's call failed")


class Jobs(Scratch):
    def jobs(self, *args, **env):
        e = dict(self.env, JOBS_DIR=str(self.dir / "jobs"), JOBS_LOAD="1", JOBS_MEMFREE="60",
                 MACHINE_PROFILE=str(ROOT / "tests" / "fixtures" / "machine" / "reference-14core.json"))
        e.update(env)
        return subprocess.run([sys.executable, str(ROOT / "bin" / "chewbacca-jobs")] + list(args),
                              env=e, capture_output=True, text=True, timeout=120)

    def status(self, job_id):
        return json.loads((self.dir / "jobs" / job_id / "job.json").read_text())["status"]

    def tearDown(self):
        for f in (self.dir / "jobs").glob("*/job.json"):
            pid = json.loads(f.read_text()).get("pid")
            if pid:
                try:
                    os.killpg(pid, 9)
                except OSError:
                    pass
        super().tearDown()

    def test_kills_hold_while_ten_tabs_tick(self):
        ids = [self.jobs("submit", "--heavy", "--", "sleep", "30").stdout.split()[0] for _ in range(20)]

        def ticker(n):
            for k in range(10):
                self.jobs("tick", JOBS_LOAD="40" if k % 2 else "1")

        with ThreadPoolExecutor(30) as ex:
            work = [ex.submit(ticker, n) for n in range(TABS)] + [ex.submit(self.jobs, "kill", i) for i in ids]
            for w in work:
                w.result()
        self.assertEqual([(i, self.status(i)) for i in ids if self.status(i) != "killed"], [])

    def test_finished_jobs_stay_done_while_ten_tabs_submit_and_tick(self):
        def tab(n):
            out = []
            for k in range(EACH):
                out.append(self.jobs("submit", "--", "true").stdout.split()[0])
                self.jobs("tick")
            return out

        ids = sum(self.fan(tab, range(TABS)), [])
        deadline = time.time() + 30
        while time.time() < deadline and any(self.status(i) in ("queued", "running") for i in ids):
            time.sleep(0.2)
        self.jobs("tick")
        self.assertEqual([(i, self.status(i)) for i in ids if self.status(i) != "done"], [])


    def test_a_result_written_by_old_code_is_taken(self):
        # A supervisor started before the move writes job.json alone. The
        # tick must take its result, not call it gone or run the next job twice.
        first = self.jobs("submit", "--heavy", "--", "sleep", "30").stdout.split()[0]
        second = self.jobs("submit", "--heavy", "--", "sleep", "30").stdout.split()[0]
        p = self.dir / "jobs" / first / "job.json"
        j = json.loads(p.read_text())
        os.killpg(j["pid"], 9)
        time.sleep(0.05)
        j.update(status="done", exit=0, ended=time.time())
        p.write_text(json.dumps(j))
        self.jobs("tick")
        self.assertEqual(self.status(first), "done")
        self.assertEqual(self.status(second), "running")


    def test_a_kill_does_not_wait_behind_a_slow_machine_read(self):
        # The profile's ioreg read can take seconds on a swamped Mac. The tick
        # reads it before taking the lock, so a kill lands at once (review,
        # 10/12). The live read, not MACHINE_PROFILE, so the slow ioreg runs.
        job = self.jobs("submit", "--heavy", "--", "sleep", "30", JOBS_LOAD="40").stdout.split()[0]
        fake = self.dir / "fakebin"
        fake.mkdir()
        (fake / "ioreg").write_text("#!/bin/sh\nsleep 2.5\necho '\"HIDIdleTime\" = 0'\n")
        (fake / "ioreg").chmod(0o755)
        env = dict(self.env, JOBS_DIR=str(self.dir / "jobs"), JOBS_LOAD="1",
                   PATH="%s:%s" % (fake, os.environ["PATH"]))
        env.pop("JOBS_MEMFREE", None)
        env.pop("MACHINE_PROFILE", None)
        slow = subprocess.Popen([sys.executable, str(ROOT / "bin" / "chewbacca-jobs"), "tick"], env=env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1)
        began = time.time()
        self.jobs("kill", job)
        took = time.time() - began
        slow.wait(timeout=30)
        self.assertLess(took, 1.5)
        self.assertEqual(self.status(job), "killed")

    def test_a_tick_that_rolls_back_leaves_no_supervisor_behind(self):
        job = self.jobs("submit", "--heavy", "--", "sleep", "4321", JOBS_LOAD="40").stdout.split()[0]
        folder = self.dir / "jobs" / job
        folder.chmod(0o500)
        try:
            self.jobs("tick")
        finally:
            folder.chmod(0o700)
        time.sleep(0.3)
        self.assertEqual(self.status(job), "queued")
        left = subprocess.run(["pgrep", "-f", "sleep 4321"], capture_output=True, text=True).stdout.split()
        self.assertEqual(left, [], "a supervisor outlived the rolled-back tick")

    def test_a_tick_waits_for_an_old_tick_holding_the_lock(self):
        # A tick still on the code before the state file knows only the flock.
        import fcntl
        (self.dir / "jobs").mkdir(parents=True, exist_ok=True)
        with open(self.dir / "jobs" / ".tick.lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            env = dict(self.env, JOBS_DIR=str(self.dir / "jobs"), JOBS_LOAD="1", JOBS_MEMFREE="60")
            tick = subprocess.Popen([sys.executable, str(ROOT / "bin" / "chewbacca-jobs"), "tick"], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(1)
            self.assertIsNone(tick.poll(), "the tick ran while an old tick held the lock")
        self.assertEqual(tick.wait(timeout=30), 0)


class Paths(unittest.TestCase):
    """Only a store's exact default folder shares the real state file."""

    def setUp(self):
        self.home = pathlib.Path(tempfile.mkdtemp())
        self.env = dict(os.environ, HOME=str(self.home))
        self.env.pop("CHEWBACCA_STATE_DB", None)
        (self.home / ".chewbacca" / "people").mkdir(parents=True)
        (self.home / ".chewbacca" / "people-test").mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)

    def py(self, store, name):
        code = "import sys; sys.path.insert(0, sys.argv[1]); import statedb; print(statedb.path_for(sys.argv[2], sys.argv[3]))"
        return subprocess.run([sys.executable, "-c", code, str(ROOT / "bin" / "lib"), store, name], env=self.env,
                              capture_output=True, text=True).stdout.strip()

    def js(self, store, name):
        code = "console.log(require(process.argv[1]).pathFor(process.argv[2], process.argv[3]))"
        return subprocess.run(["node", "-e", code, str(ROOT / "bin" / "lib" / "statedb.js"), store, name],
                              env=self.env, capture_output=True, text=True).stdout.strip()

    def test_default_and_neighbour(self):
        real = os.path.realpath(str(self.home / ".chewbacca" / "state.sqlite"))
        for side in (self.py, self.js):
            self.assertEqual(os.path.realpath(side(str(self.home / ".chewbacca" / "people"), "people")), real)
            beside = side(str(self.home / ".chewbacca" / "people-test"), "people")
            self.assertNotEqual(os.path.realpath(beside), real, side.__name__)
            self.assertTrue(beside.endswith("people-test/.state.sqlite"), beside)


class Board(Scratch):
    def test_tabs_board_and_ledger(self):
        def tab(n):
            board = subprocess.run([sys.executable, str(ROOT / "tools" / "tabs.py"), "register", "--session",
                                    "s%d" % n, "--runtime", "test", "task %d" % n],
                                   env=self.env, capture_output=True, text=True, timeout=60).returncode
            ledger = [subprocess.run([sys.executable, str(ROOT / "tools" / "work_ledger.py"), "add", "--scope",
                                      str(self.dir), "--title", "t %d-%d" % (n, k), "--source-key",
                                      "k-%d-%d" % (n, k)],
                                     env=self.env, capture_output=True, text=True, timeout=60).returncode
                      for k in range(EACH)]
            return [board] + ledger

        codes = sum(self.fan(tab, range(TABS)), [])
        self.assertEqual([c for c in codes if c], [])
        listed = subprocess.run([sys.executable, str(ROOT / "tools" / "work_ledger.py"), "list", "--scope",
                                 str(self.dir)], env=self.env, capture_output=True, text=True).stdout
        self.assertEqual(sum(("t %d-%d" % (n, k)) in listed for n in range(TABS) for k in range(EACH)), TABS * EACH)
        board = subprocess.run([sys.executable, str(ROOT / "tools" / "tabs.py"), "list", "--json"],
                               env=self.env, capture_output=True, text=True).stdout
        self.assertEqual(len({r.get("id") or r.get("session") for r in json.loads(board)}), TABS)


if __name__ == "__main__":
    unittest.main()
