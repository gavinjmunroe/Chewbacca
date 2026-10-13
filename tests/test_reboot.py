#!/usr/bin/env python3
"""A reboot, simulated: kill everything with no cleanup, start the daemon, check.

2026-10-12 22:21: Caleb's Mac ran its battery to 1%, slept, failed to wake
from hibernation (iBoot panic) and restarted. The daemon, its always-on
services, the HUD and the realm engine all came back on their own. The one
thing that didn't was the job queue's 238-creator transcription, 222 of 779
videos in: the first tick after boot marked it failed, "supervisor gone",
and nothing ran it again.

Pids here wrapped all the way round in under three hours that night (the
daemon was pid 2414 at 22:25 and pid 5668 at 00:58), so a pid saved before a
restart names some other process soon after it. The queue and the daemon both
trusted saved pids, so this also covers the stranger that inherits one.

Nothing here touches the real daemon, queue, LaunchAgents or kit: every path
is a temp dir, and the boot is injected: CHEWBACCA_BOOT_SESSION stands in for
kern.bootsessionuuid, CHEWBACCA_BOOT_TIME for kern.boottime (what records
from before the id was stamped fall back to).
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAEMON = ROOT / "bin" / "chewbacca-daemon"
JOBS = ROOT / "bin" / "chewbacca-jobs"
NODE = shutil.which("node")


def wait_for(pred, timeout=40.0, step=0.2):
    end = time.time() + timeout
    while time.time() < end:
        v = pred()
        if v:
            return v
        time.sleep(step)
    return pred()


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def stranger():
    """A process that is not ours, the kind that inherits a saved pid after a
    restart. /bin/sleep, so its name matches the service it stands in for."""
    return subprocess.Popen(["/bin/sleep", "300"], start_new_session=True,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


@unittest.skipUnless(NODE, "node not installed")
class RebootTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.out = self.tmp / "work"
        self.out.mkdir()
        (self.tmp / "agents").mkdir()
        self.env = dict(os.environ,
                        JOBS_DIR=str(self.tmp / "jobs"),
                        JOBS_LOAD="1", JOBS_MEMFREE="60",
                        MACHINE_PROFILE=str(ROOT / "tests" / "fixtures" / "machine" / "reference-14core.json"),
                        CHEWBACCA_BACKGROUND_WRITERS=str(self.tmp / "bw.tsv"),
                        CHEWBACCA_DAEMON_DIR=str(self.tmp / "daemon"),
                        CHEWBACCA_LAUNCH_AGENTS=str(self.tmp / "agents"),
                        CHEWBACCA_DAEMON_LOGS=str(self.tmp / "logs"),
                        CHEWBACCA_KIT=str(self.tmp / "kit"),
                        CHEWBACCA_BOOT_SESSION="boot-1",
                        OUT=str(self.out))
        self.procs = []

    def tearDown(self):
        for p in self.procs:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        for f in (self.tmp / "jobs").glob("*/job.json"):
            try:
                pid = json.loads(f.read_text()).get("pid")
                if pid:
                    os.killpg(pid, signal.SIGKILL)
            except (ValueError, OSError):
                pass
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ------------------------------------------------------------ helpers

    def jobs(self, *args, env=None):
        r = subprocess.run([sys.executable, str(JOBS), *args], capture_output=True, text=True,
                           env=env or self.env, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return r.stdout

    def submit(self, *args):
        return self.jobs("submit", *args).split()[0]

    def job(self, job_id):
        return json.loads((self.tmp / "jobs" / job_id / "job.json").read_text())

    def power_cut(self, job_id):
        """The job's whole process group dies with no chance to write a result,
        the way it does when the Mac loses power."""
        pid = self.job(job_id)["pid"]
        os.killpg(pid, signal.SIGKILL)
        wait_for(lambda: not alive(pid), timeout=5)

    def daemon(self, env):
        p = subprocess.Popen([NODE, str(DAEMON), "run"], env=env, start_new_session=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.procs.append(p)
        return p

    # -------------------------------------------------------------- tests

    def test_power_cut_then_boot(self):
        # Before the restart: a resumable job partway through, a job queued
        # --after it, a job whose saved pid a stranger will inherit, and a job
        # submitted --once.
        work = ('for i in 1 2 3 4 5 6; do [ -e "$OUT/$i" ] && continue; '
                'sleep 0.4; echo ran >> "$OUT/$i"; done')
        a = self.submit("--title", "resumable", "--", "sh", "-c", work)
        b = self.submit("--after", a, "--title", "after", "--", "sh", "-c", 'echo b > "$OUT/b"')
        c = self.submit("--title", "pid reused", "--", "sh", "-c",
                        'test -e "$OUT/c" && exit 0; touch "$OUT/c"; sleep 300')
        d = self.submit("--once", "--title", "once", "--", "sh", "-c", 'echo d >> "$OUT/d"; sleep 300')
        self.assertTrue(wait_for(lambda: (self.out / "2").exists(), timeout=10), "the job never got going")
        wait_for(lambda: (self.out / "d").exists(), timeout=10)
        for j in (a, c, d):
            self.power_cut(j)
        done_before = sorted(p.name for p in self.out.iterdir() if p.name.isdigit())

        # A stranger inherits job c's pid. job.json is the queue's mirror; a
        # newer write there is adopted, so this is how old code would record it.
        sc = stranger()
        self.procs.append(sc)
        jc = self.job(c)
        jc["pid"] = sc.pid
        time.sleep(0.01)
        (self.tmp / "jobs" / c / "job.json").write_text(json.dumps(jc))

        # The daemon's state as a power cut leaves it: two always-on services,
        # one of them just handed over on a kit move, and strangers now
        # holding both saved pids under the same program name.
        before = int(time.time() * 1000) - 60_000
        sa, sb = stranger(), stranger()
        self.procs += [sa, sb]
        daemon_dir = self.tmp / "daemon"
        (daemon_dir / "services").mkdir(parents=True)
        for name in ("svc-a", "svc-b"):
            (daemon_dir / "services" / f"{name}.json").write_text(json.dumps(
                {"name": name, "keepalive": True, "argv": ["/bin/sleep", "300"]}))
        (daemon_dir / "services" / "jobs.json").write_text(json.dumps(
            {"name": "jobs", "every": 5, "argv": [sys.executable, str(JOBS), "tick"]}))
        (daemon_dir / "state.json").write_text(json.dumps({
            "svc-a": {"firstSeen": before, "lastStart": before, "pid": sa.pid, "argv0": "sleep", "bootId": "boot-1"},
            "svc-b": {"firstSeen": before, "lastStart": before, "pid": sb.pid, "argv0": "sleep",
                      "handover": int(time.time() * 1000) - 5_000},
        }))

        # Boot.
        boot = time.time()
        env = dict(self.env, CHEWBACCA_BOOT_TIME=str(boot), CHEWBACCA_BOOT_SESSION="boot-2")
        t0 = time.time()
        self.daemon(env)

        def state():
            return json.loads((daemon_dir / "state.json").read_text()) if (daemon_dir / "state.json").exists() else {}

        up = wait_for(lambda: all(state().get(n, {}).get("pid") not in (None, sa.pid, sb.pid) for n in ("svc-a", "svc-b")),
                      timeout=15)
        services_s = time.time() - t0
        self.assertTrue(up, f"the always-on services didn't come back: {state()}")
        self.assertTrue(alive(sa.pid), "the daemon killed a stranger that inherited a saved pid")
        self.assertTrue(alive(sb.pid), "the daemon adopted (and will later kill) a stranger as a handed-over service")

        ended = ("done", "failed", "killed")
        settled = wait_for(lambda: all(self.job(j)["status"] in ended for j in (a, b, c, d)), timeout=40)
        jobs_s = time.time() - t0
        got = {j: (self.job(j)["status"], self.job(j).get("note")) for j in (a, b, c, d)}
        self.assertTrue(settled, f"jobs never settled after the boot: {got}")
        self.assertEqual(self.job(a)["status"], "done", got)
        self.assertEqual(self.job(a).get("restarts"), 1)
        # Restarted from where it was: every item ran exactly once.
        self.assertEqual([(self.out / str(i)).read_text().count("ran") for i in range(1, 7)], [1] * 6,
                         f"items done before the cut: {done_before}")
        log = (self.tmp / "jobs" / a / "out.log").read_text()
        self.assertIn("the Mac restarted", log, "the job's log never says it was rerun")
        self.assertEqual(self.job(b)["status"], "done", "the job queued --after it didn't run")
        self.assertGreaterEqual(self.job(b)["started"], self.job(a)["ended"], "--after ran before its job finished")
        self.assertEqual(self.job(c)["status"], "done", f"a job whose pid a stranger took was never rerun: {got}")
        self.assertTrue(alive(sc.pid), "the queue signalled a stranger that inherited a job's pid")
        self.assertEqual(self.job(d)["status"], "failed", "a --once job ran again after a restart")
        self.assertIn("restarted", self.job(d).get("note") or "")
        self.assertEqual((self.out / "d").read_text().count("d"), 1)
        print(f"\n  reboot sim: services back in {services_s:.1f} s, jobs requeued and finished in {jobs_s:.1f} s",
              file=sys.stderr)

    def test_restart_cap(self):
        # A job that is running at every boot (one that brings the Mac down
        # itself, say) is rerun MAX_RESTARTS times and then left failed.
        a = self.submit("--title", "every boot", "--", "sleep", "300")
        for n in range(1, 5):
            self.assertTrue(wait_for(lambda: self.job(a)["status"] == "running", timeout=10))
            self.power_cut(a)
            env = dict(self.env, CHEWBACCA_BOOT_SESSION=f"boot-{n + 1}")
            self.jobs("tick", env=env)
            self.env = env
        j = self.job(a)
        self.assertEqual(j["status"], "failed", j)
        self.assertEqual(j.get("restarts"), 4)

    def test_clock_step_is_not_a_restart(self):
        # The clock stepped forward an hour after boot moves kern.boottime with
        # it; a job from this boot is still running and must stay that way.
        a = self.submit("--", "sleep", "300")
        self.assertTrue(wait_for(lambda: self.job(a)["status"] == "running", timeout=10))
        pid = self.job(a)["pid"]
        self.jobs("tick", env=dict(self.env, CHEWBACCA_BOOT_TIME=str(time.time() + 3600)))
        self.assertEqual(self.job(a)["status"], "running")
        self.assertEqual(self.job(a)["pid"], pid, "the job was started a second time")

    def test_retry_waits_for_a_stopping_run(self):
        # kill marks a job killed before its command has exited; a retry then
        # must not start a second copy beside it.
        a = self.submit("--writes", str(self.out), "--", "sh", "-c",
                        "trap 'sleep 2; exit 1' TERM; touch \"$OUT/trapped\"; sleep 300 & wait")
        # Killed before its trap is set, the command just dies; that's not the case here.
        self.assertTrue(wait_for(lambda: (self.out / "trapped").exists(), timeout=10))
        self.jobs("kill", a)
        r = subprocess.run([sys.executable, str(JOBS), "retry", a], capture_output=True, text=True, env=self.env)
        self.assertNotEqual(r.returncode, 0, "retry started a second copy beside one still stopping")
        self.assertIn("still stopping", r.stderr)

    def test_retry(self):
        a = self.submit("--", "sh", "-c", 'test -e "$OUT/r" && exit 0; touch "$OUT/r"; exit 3')
        self.assertTrue(wait_for(lambda: self.job(a)["status"] == "failed", timeout=10))
        self.jobs("retry", a)
        self.assertTrue(wait_for(lambda: self.job(a)["status"] == "done", timeout=10), self.job(a))


if __name__ == "__main__":
    unittest.main(verbosity=2)
