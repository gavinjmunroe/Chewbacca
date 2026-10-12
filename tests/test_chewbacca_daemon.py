"""chewbacca-daemon: one Login Items row runs every background job. Offline, sandboxed.

Caleb, 2026-10-11: "Chewb should aim to be only 1 thing". These check that a
registered job actually runs under the supervisor, that a keepalive service is
restarted, that the old per-job plists fold into services and leave
LaunchAgents, and that the installers register instead of writing plists.
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

ROOT = Path(__file__).resolve().parents[1]
DAEMON = ROOT / "bin" / "chewbacca-daemon"
NODE = shutil.which("node")


def node_eval(code, env):
    r = subprocess.run([NODE, "-e", code], capture_output=True, text=True, env=env, timeout=30)
    if r.returncode:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


@unittest.skipUnless(NODE, "node not installed")
class DaemonTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.env = dict(os.environ,
                        CHEWBACCA_DAEMON_DIR=str(self.tmp / "daemon"),
                        CHEWBACCA_LAUNCH_AGENTS=str(self.tmp / "agents"),
                        CHEWBACCA_DAEMON_LOGS=str(self.tmp / "logs"),
                        CHEWBACCA_KIT=str(self.tmp / "kit"))
        (self.tmp / "agents").mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def cli(self, *args, check=True):
        r = subprocess.run([NODE, str(DAEMON), *args], capture_output=True, text=True, env=self.env, timeout=30)
        if check and r.returncode:
            raise AssertionError(r.stdout + r.stderr)
        return r

    def test_register_validates(self):
        self.assertNotEqual(self.cli("register", "x", "--", "true", check=False).returncode, 0)
        self.assertNotEqual(self.cli("register", "Bad Name", "--every", "60", "--", "true", check=False).returncode, 0)
        self.assertNotEqual(self.cli("register", "x", "--every", "2", "--", "true", check=False).returncode, 0)
        self.assertNotEqual(self.cli("register", "x", "--at", "25:00", "--", "true", check=False).returncode, 0)
        self.cli("register", "ok", "--every", "60", "--env", "A=b", "--", "/bin/echo", "hi")
        svc = json.loads((self.tmp / "daemon/services/ok.json").read_text())
        self.assertEqual(svc["argv"], ["/bin/echo", "hi"])
        self.assertEqual(svc["env"], {"A": "b"})

    def test_supervisor_runs_interval_and_restarts_keepalive(self):
        tick = self.tmp / "tick.txt"
        alive = self.tmp / "alive.txt"
        self.cli("register", "tick", "--every", "5", "--", "/bin/sh", "-c", f"echo x >> '{tick}'")
        self.cli("register", "flaky", "--keepalive", "--", "/bin/sh", "-c", f"echo y >> '{alive}'; exit 1")
        proc = subprocess.Popen([NODE, str(DAEMON), "run"], env=self.env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.time() + 20
            while time.time() < deadline:
                if tick.exists() and alive.exists() and len(alive.read_text().split()) >= 2:
                    break
                time.sleep(0.5)
        finally:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=10)
        self.assertTrue(tick.exists(), "interval service never ran")
        self.assertGreaterEqual(len(alive.read_text().split()), 2, "keepalive service was not restarted")
        state = json.loads((self.tmp / "daemon/state.json").read_text())
        self.assertEqual(state["flaky"]["lastExit"], 1)

    def test_crash_only_service_stays_down_after_clean_exit(self):
        hits = self.tmp / "hits.txt"
        self.cli("register", "clean", "--restart-on-crash", "--", "/bin/sh", "-c", f"echo z >> '{hits}'; exit 0")
        proc = subprocess.Popen([NODE, str(DAEMON), "run"], env=self.env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(16)
        finally:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=10)
        self.assertEqual(len(hits.read_text().split()), 1, "a clean exit was restarted")

    def test_reregistering_clears_a_crash_backoff(self):
        # 2026-10-11: realm-ui sat out a 300 s backoff after an orphan held its port.
        hits = self.tmp / "hits.txt"
        self.cli("register", "svc", "--keepalive", "--", "/bin/sh", "-c", f"echo x >> '{hits}'; exit 1")
        proc = subprocess.Popen([NODE, str(DAEMON), "run"], env=self.env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(6)
            before = len(hits.read_text().split())
            time.sleep(1.1)
            self.cli("register", "svc", "--keepalive", "--", "/bin/sh", "-c", f"echo y >> '{hits}'; sleep 30")
            time.sleep(7)
        finally:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=10)
        self.assertIn("y", hits.read_text().split(), f"re-registered service waited out its backoff ({before} runs before)")

    def test_unregistered_service_stops(self):
        self.cli("register", "sleeper", "--keepalive", "--", "/bin/sleep", "300")
        proc = subprocess.Popen([NODE, str(DAEMON), "run"], env=self.env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            pid = None
            for _ in range(40):
                st = json.loads((self.tmp / "daemon/state.json").read_text()) if (self.tmp / "daemon/state.json").exists() else {}
                pid = st.get("sleeper", {}).get("pid")
                if pid:
                    break
                time.sleep(0.25)
            self.assertTrue(pid)
            self.cli("unregister", "sleeper")
            gone = False
            for _ in range(40):
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    gone = True
                    break
                time.sleep(0.25)
            self.assertTrue(gone, "unregistered service kept running")
        finally:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=10)

    def test_old_plists_fold_into_services(self):
        agents = self.tmp / "agents"
        plists = {
            "com.chewbacca.jobs": {"Label": "com.chewbacca.jobs", "ProgramArguments": ["/usr/bin/python3", "/x/chewbacca-jobs", "tick"],
                                   "StartInterval": 30, "RunAtLoad": True},
            "com.calebnewton.chewbacca.hud": {"Label": "com.calebnewton.chewbacca.hud",
                                              "ProgramArguments": ["/Applications/Kyber.app/Contents/MacOS/Kyber"],
                                              "KeepAlive": True, "EnvironmentVariables": {"PATH": "/a:/b"}},
            "com.calebnewton.people-sync": {"Label": "com.calebnewton.people-sync", "ProgramArguments": ["/bin/bash", "-lc", "echo"],
                                            "StartCalendarInterval": [{"Hour": 7, "Minute": 30}, {"Hour": 21, "Minute": 30}]},
            "com.chewbacca.bridge": {"Label": "com.chewbacca.bridge", "ProgramArguments": ["/usr/bin/python3", "/x/bridge", "serve"],
                                     "KeepAlive": True},
            "com.chewbacca.realm": {"Label": "com.chewbacca.realm", "ProgramArguments": ["/usr/bin/env", "python3", "/x/realm-engine", "run"],
                                    "KeepAlive": {"SuccessfulExit": False}, "RunAtLoad": True},
            "ai.nova.brief": {"Label": "ai.nova.brief", "ProgramArguments": ["/bin/bash", "-lc", "echo"],
                              "StartCalendarInterval": {"Hour": 8, "Minute": 0}, "RunAtLoad": False},
            "com.someoneelse.thing": {"Label": "com.someoneelse.thing", "ProgramArguments": ["/bin/true"], "StartInterval": 60},
        }
        import plistlib
        for label, body in plists.items():
            (agents / f"{label}.plist").write_bytes(plistlib.dumps(body))
        out = node_eval(f"process.stdout.write(JSON.stringify(require({json.dumps(str(DAEMON))}).adoptLegacy()))", self.env)
        names = {a["label"]: a.get("service") for a in out}
        self.assertEqual(names, {"com.chewbacca.jobs": "jobs", "com.calebnewton.chewbacca.hud": "hud",
                                 "com.calebnewton.people-sync": "people-sync", "com.chewbacca.bridge": "bridge",
                                 "com.chewbacca.realm": "realm", "ai.nova.brief": "brief"})
        left = sorted(p.name for p in agents.iterdir())
        self.assertEqual(left, ["com.someoneelse.thing.plist"], "a kit plist stayed, or a stranger's was taken")
        svc = lambda n: json.loads((self.tmp / f"daemon/services/{n}.json").read_text())
        self.assertEqual(svc("jobs")["every"], 30)
        self.assertEqual(svc("hud")["app"], "/Applications/Kyber.app")
        self.assertEqual(svc("hud")["env"], {"PATH": "/a:/b"})
        self.assertNotIn("argv", svc("hud"))
        self.assertEqual(svc("people-sync")["at"], ["07:30", "21:30"])
        self.assertIs(svc("bridge")["keepalive"], True)
        self.assertEqual(svc("realm")["keepalive"], "crash", "realm's stop would be undone by a plain restart")
        self.assertEqual(svc("brief")["at"], ["08:00"])
        self.assertTrue((self.tmp / "daemon/legacy/com.chewbacca.jobs.plist").exists(), "old plist was deleted, not kept")

    def test_at_slot_catches_up_after_sleep(self):
        out = node_eval(f"""
          const d = require({json.dumps(str(DAEMON))});
          const now = new Date(2026, 9, 11, 22, 0).getTime();
          const slot = d.lastSlot(["07:30", "21:30"], now);
          const morning = d.lastSlot(["07:30", "21:30"], new Date(2026, 9, 11, 6, 0).getTime());
          const svc = {{ name: "s", at: ["21:30"], argv: ["true"] }};
          process.stdout.write(JSON.stringify({{
            slot: new Date(slot).getHours() * 60 + new Date(slot).getMinutes(),
            morningDay: new Date(morning).getDate(),
            dueMissed: d.due(svc, {{ firstSeen: new Date(2026, 9, 11, 20, 0).getTime() }}, now),
            dueDone: d.due(svc, {{ lastStart: new Date(2026, 9, 11, 21, 31).getTime() }}, now),
          }}));""", self.env)
        self.assertEqual(out["slot"], 21 * 60 + 30)
        self.assertEqual(out["morningDay"], 10)
        self.assertTrue(out["dueMissed"])
        self.assertFalse(out["dueDone"])

    def test_plist_is_one_named_agent(self):
        r = self.cli("install", "--dry-run")
        xml = json.loads(r.stdout)["xml"]
        self.assertIn("<string>com.chewbacca</string>", xml)
        self.assertIn("<key>KeepAlive</key><true/>", xml)
        self.assertIn("<string>run</string>", xml)

    def test_missing_binary_backs_off_and_does_not_wedge(self):
        self.cli("register", "ghost", "--every", "5", "--", str(self.tmp / "no-such-tool"))
        proc = subprocess.Popen([NODE, str(DAEMON), "run"], env=self.env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(8)
        finally:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=10)
        st = json.loads((self.tmp / "daemon/state.json").read_text())["ghost"]
        self.assertIsNone(st.get("pid"), "a binary that never started is still counted as running")
        self.assertIn("ENOENT", str(st.get("lastExit")))
        self.assertGreater(st.get("retryAt", 0), st["lastStart"], "a missing binary is retried every tick")

    def test_adopt_keeps_fresh_service_and_skips_what_it_cannot_reproduce(self):
        import plistlib
        agents = self.tmp / "agents"
        self.cli("register", "messages-refresh", "--every", "600", "--", "/new/node", "people", "texts", "refresh")
        bodies = {
            "com.chewbacca.messages-refresh": {"ProgramArguments": ["/old/node", "people"], "StartInterval": 600},
            "com.calebnewton.presence-watch": {"ProgramArguments": ["/bin/true"], "StartInterval": 60, "Disabled": True},
            "com.calebnewton.brain-index": {"ProgramArguments": ["/bin/true"],
                                            "StartCalendarInterval": {"Weekday": 1, "Hour": 9, "Minute": 0}},
            "com.chewbacca.bridge": {"ProgramArguments": ["/bin/true"], "KeepAlive": {"NetworkState": True}},
        }
        for label, body in bodies.items():
            (agents / f"{label}.plist").write_bytes(plistlib.dumps(dict(body, Label=label)))
        out = node_eval(f"process.stdout.write(JSON.stringify(require({json.dumps(str(DAEMON))}).adoptLegacy()))", self.env)
        got = {a["label"]: a for a in out}
        svc = json.loads((self.tmp / "daemon/services/messages-refresh.json").read_text())
        self.assertEqual(svc["argv"][0], "/new/node", "the old plist overwrote the service setup just registered")
        self.assertFalse((agents / "com.chewbacca.messages-refresh.plist").exists())
        for label in ("com.calebnewton.presence-watch", "com.calebnewton.brain-index", "com.chewbacca.bridge"):
            self.assertIn("skipped", got[label], label)
            self.assertTrue((agents / f"{label}.plist").exists(), f"{label} was retired without a service")

    def test_python_register_refuses_what_the_daemon_would_skip(self):
        sys.path.insert(0, str(ROOT / "bin" / "lib"))
        import importlib
        import daemon_register
        importlib.reload(daemon_register)
        with self.assertRaises(ValueError):
            daemon_register.register("maintain", ["/x"], at=["24:17"], ensure_daemon=False)

    def test_python_register_writes_service(self):
        sys.path.insert(0, str(ROOT / "bin" / "lib"))
        os.environ["CHEWBACCA_DAEMON_DIR"] = self.env["CHEWBACCA_DAEMON_DIR"]
        os.environ["CHEWBACCA_LAUNCH_AGENTS"] = self.env["CHEWBACCA_LAUNCH_AGENTS"]
        try:
            import importlib
            import daemon_register
            importlib.reload(daemon_register)
            daemon_register.register("kit-runtime", ["/usr/bin/python3", "x"], every=900, ensure_daemon=False)
            svc = json.loads((self.tmp / "daemon/services/kit-runtime.json").read_text())
            self.assertEqual(svc, {"name": "kit-runtime", "argv": ["/usr/bin/python3", "x"], "every": 900})
        finally:
            os.environ.pop("CHEWBACCA_DAEMON_DIR", None)
            os.environ.pop("CHEWBACCA_LAUNCH_AGENTS", None)


class InstallersWriteNoPlistTests(unittest.TestCase):
    """Every installer registers with the daemon; none writes its own LaunchAgent."""

    FILES = ["setup.sh", "bin/chewbacca-bridge", "bin/hud-autostart", "bin/lib/people/dashboard.js",
             "tools/kit_runtime.py", "apps/live/agent/install", "bin/maintain", "bin/main-ci"]

    def test_agent_watch_runs_on_stock_python(self):
        # 2026-10-11 16:57: Homebrew Python 3.14 segfaulted in its GC running
        # kyber-sessions watch, and the crash dialog landed on Caleb's screen.
        text = (ROOT / "setup.sh").read_text()
        self.assertIn('register agent-watch --every 60 --nice 10 -- /usr/bin/python3 ', text)

    def test_no_installer_bootstraps_its_own_agent(self):
        for rel in self.FILES:
            text = (ROOT / rel).read_text()
            self.assertNotIn("launchctl bootstrap", text, rel)
            self.assertNotIn('"bootstrap"', text, rel)
            self.assertNotIn("launchctl load", text, rel)


SHA_A = "a" * 40
SHA_B = "b" * 40


@unittest.skipUnless(NODE, "node not installed")
class GenerationTests(unittest.TestCase):
    """Reengineer step 9: every service knows the kit snapshot it runs from.

    On 2026-10-11 room-capture, hud-speak and the origin-guard server ran from
    snapshots already pruned, and only reading ps by hand showed it.
    """

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self.env = dict(os.environ,
                        CHEWBACCA_DAEMON_DIR=str(self.tmp / "daemon"),
                        CHEWBACCA_LAUNCH_AGENTS=str(self.tmp / "agents"),
                        CHEWBACCA_DAEMON_LOGS=str(self.tmp / "logs"),
                        CHEWBACCA_KIT=str(self.tmp / "kit"))
        (self.tmp / "agents").mkdir()
        for sha, word in ((SHA_A, "old"), (SHA_B, "new")):
            b = self.tmp / "snapshots" / sha / "bin"
            b.mkdir(parents=True)
            (b / "svc.sh").write_text(f"#!/bin/sh\necho {word} >> '{self.tmp}/ran.txt'\nexec sleep 300\n")
            (b / "svc.sh").chmod(0o755)
        self.point(SHA_A)
        self.procs = []

    def tearDown(self):
        for p in self.procs:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except OSError:
                pass
            p.wait(timeout=5)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def point(self, sha, age_s=0):
        link = self.tmp / "kit"
        tmp = self.tmp / ".kit-new"
        os.symlink(f"snapshots/{sha}", tmp)
        os.replace(tmp, link)
        if age_s:
            t = time.time() - age_s
            os.utime(link, (t, t), follow_symlinks=False)

    def cli(self, *args, check=True):
        r = subprocess.run([NODE, str(DAEMON), *args], capture_output=True, text=True, env=self.env, timeout=30)
        if check and r.returncode:
            raise AssertionError(r.stdout + r.stderr)
        return r

    def status(self, *extra):
        r = self.cli("status", "--json", *extra, check=False)
        return r.returncode, json.loads(r.stdout)

    def spawn(self, argv):
        p = subprocess.Popen(argv, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.procs.append(p)
        return p

    def test_status_flags_a_service_on_an_old_generation_and_check_fails_past_a_minute(self):
        self.cli("register", "svc", "--keepalive", "--", "/bin/sh", str(self.tmp / "kit/bin/svc.sh"))
        p = self.spawn(["/bin/sh", str(self.tmp / "snapshots" / SHA_A / "bin/svc.sh")])
        (self.tmp / "daemon").mkdir(exist_ok=True)
        (self.tmp / "daemon/state.json").write_text(json.dumps(
            {"svc": {"pid": p.pid, "argv0": "sh", "gen": SHA_A, "from": "kit", "lastStart": 1}}))
        rc, d = self.status("--check")
        row = d["services"][0]
        self.assertEqual((rc, row["gen"], row["stale"]), (0, SHA_A, False))
        # The kit moves on; 10 s later the service is stale but inside the grace.
        self.point(SHA_B, age_s=10)
        rc, d = self.status("--check")
        row = d["services"][0]
        self.assertTrue(row["stale"])
        self.assertEqual(rc, 0, "a service stale for 10 s already fails the check")
        # Past the 60 s line the check fails, naming it.
        self.point(SHA_B, age_s=120)
        rc, d = self.status("--check")
        self.assertEqual((rc, d["late"]), (1, ["svc"]))
        self.assertEqual(d["services"][0]["pruned"], [])
        # Its snapshot is pruned under it: the row says so.
        shutil.rmtree(self.tmp / "snapshots" / SHA_A)
        rc, d = self.status("--check")
        self.assertEqual(d["services"][0]["pruned"], [SHA_A])
        self.assertIn("PRUNED", self.cli("status", check=False).stdout)

    def test_a_timed_job_mid_run_on_an_old_generation_is_not_late(self):
        self.cli("register", "job", "--every", "600", "--", "/bin/sh", str(self.tmp / "kit/bin/svc.sh"))
        p = self.spawn(["/bin/sh", str(self.tmp / "snapshots" / SHA_A / "bin/svc.sh")])
        (self.tmp / "daemon").mkdir(exist_ok=True)
        (self.tmp / "daemon/state.json").write_text(json.dumps(
            {"job": {"pid": p.pid, "argv0": "sh", "gen": SHA_A, "from": "kit", "lastStart": 1}}))
        self.point(SHA_B, age_s=120)
        rc, d = self.status("--check")
        self.assertTrue(d["services"][0]["stale"])
        self.assertEqual(rc, 0, "a timed job finishing on its own generation failed the check")

    def test_status_lists_processes_outside_the_daemon_on_a_pruned_snapshot(self):
        gone = self.tmp / "snapshots" / ("c" * 40) / "bin" / "room-capture"
        # "; true" keeps sh from exec'ing sleep, so $0 stays in its command line.
        self.spawn(["/bin/sh", "-c", "sleep 300; true", str(gone)])
        rc, d = self.status()
        hits = [o for o in d["others"] if "c" * 40 == o["gen"]]
        self.assertEqual(len(hits), 1, d["others"])
        self.assertTrue(hits[0]["pruned"])

    def test_generation_of_argv(self):
        code = (f"const d=require({json.dumps(str(DAEMON))});process.stdout.write(JSON.stringify(["
                f"d.generationOf({{argv:['/bin/sh',{json.dumps(str(self.tmp / 'kit/bin/svc.sh'))}]}}),"
                f"d.generationOf({{argv:['/bin/bash','-lc','exec \\\"$HOME/x\\\"']}}),"
                f"d.generationOf({{argv:['node','--import','file://{self.tmp}/snapshots/{SHA_B}/bin/svc.sh','x']}})]))")
        got = node_eval(code, self.env)
        self.assertEqual(got[0], {"gen": SHA_A, "from": "kit"})
        self.assertEqual(got[1], {"gen": SHA_A, "from": "assumed"})
        self.assertEqual(got[2], {"gen": SHA_B, "from": "kit"})

    def test_a_kit_outside_the_snapshots_never_restarts_a_service_in_a_loop(self):
        # With no snapshot to name, a service's generation is unknown, and an
        # unknown generation must not count as old on every tick.
        for d in ("one", "two"):
            (self.tmp / d / "bin").mkdir(parents=True)
            shutil.copy(self.tmp / "snapshots" / SHA_A / "bin/svc.sh", self.tmp / d / "bin/svc.sh")
        os.remove(self.tmp / "kit")
        os.symlink(self.tmp / "one", self.tmp / "kit")
        self.cli("register", "slow", "--every", "600", "--", "/bin/sleep", "60")
        self.cli("register", "svc", "--keepalive", "--", "/bin/sh", str(self.tmp / "kit/bin/svc.sh"))
        proc = subprocess.Popen([NODE, str(DAEMON), "run"], env=self.env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(3)
            tmp = self.tmp / ".kit-new"
            os.symlink(self.tmp / "two", tmp)
            os.replace(tmp, self.tmp / "kit")
            time.sleep(12)
        finally:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=15)
        st = json.loads((self.tmp / "daemon/state.json").read_text())["svc"]
        self.assertIsNone(st.get("lastEnd"), f"the service was stopped with an unknown generation: {st}")

    def test_a_service_pinned_to_one_snapshot_is_not_swapped_in_a_loop(self):
        # chewbacca-bridge registers its resolved path, so its argv names one
        # snapshot and a restart lands on that same old code.
        self.cli("register", "slow", "--every", "600", "--", "/bin/sleep", "60")
        self.cli("register", "svc", "--keepalive", "--", "/bin/sh", str(self.tmp / "snapshots" / SHA_A / "bin/svc.sh"))
        proc = subprocess.Popen([NODE, str(DAEMON), "run"], env=self.env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(3)
            self.point(SHA_B)
            time.sleep(12)
        finally:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=15)
        st = json.loads((self.tmp / "daemon/state.json").read_text())["svc"]
        self.assertIsNone(st.get("lastEnd"), f"a pinned service was swapped onto its own old code: {st}")

    def test_a_swap_flag_left_in_state_never_cancels_a_crash_only_stop(self):
        # A daemon that exits mid-swap leaves swapping: true on disk; a clean
        # exit of a crash-only service (realm stopped on purpose) must still stay down.
        hits = self.tmp / "hits.txt"
        self.cli("register", "clean", "--restart-on-crash", "--", "/bin/sh", "-c", f"echo z >> '{hits}'; exit 0")
        (self.tmp / "daemon/state.json").write_text(json.dumps({"clean": {"swapping": True, "gen": SHA_A}}))
        proc = subprocess.Popen([NODE, str(DAEMON), "run"], env=self.env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(12)
        finally:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=15)
        self.assertEqual(len(hits.read_text().split()), 1, "a clean exit was restarted")

    def test_keepalive_moves_to_the_new_generation_while_a_timed_job_holds_the_daemon(self):
        # people-sync ran 960 s on 2026-10-12, and the daemon waits for timed
        # jobs before restarting, so every keepalive service sat on old code.
        self.cli("register", "slow", "--every", "600", "--", "/bin/sleep", "60")
        self.cli("register", "svc", "--keepalive", "--", "/bin/sh", str(self.tmp / "kit/bin/svc.sh"))
        proc = subprocess.Popen([NODE, str(DAEMON), "run"], env=self.env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        state = self.tmp / "daemon/state.json"
        try:
            first = None
            for _ in range(40):
                st = json.loads(state.read_text()) if state.exists() else {}
                if st.get("svc", {}).get("pid") and st.get("slow", {}).get("pid"):
                    first = st["svc"]["pid"]
                    break
                time.sleep(0.25)
            self.assertTrue(first, "services never started")
            self.assertEqual(json.loads(state.read_text())["svc"]["gen"], SHA_A)
            self.point(SHA_B)
            moved = None
            for _ in range(80):
                st = json.loads(state.read_text())
                if st["svc"].get("pid") and st["svc"]["pid"] != first and st["svc"].get("gen") == SHA_B:
                    moved = st
                    break
                time.sleep(0.25)
            self.assertIsNone(proc.poll(), "the daemon exited with a timed job mid-run")
            self.assertTrue(moved, "the keepalive service stayed on the old generation")
            self.assertEqual((self.tmp / "ran.txt").read_text().split(), ["old", "new"])
            rc, d = self.status("--check")
            row = next(r for r in d["services"] if r["name"] == "svc")
            self.assertFalse(row["stale"])
        finally:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=15)


if __name__ == "__main__":
    unittest.main()
