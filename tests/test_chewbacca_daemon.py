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
class KitSandbox(unittest.TestCase):
    """A daemon dir, a kit link and two snapshots, A and B, in a temp dir."""

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
        # A daemon killed mid-test leaves its services orphaned under launchd.
        # 2026-10-19: twelve kit/bin/web.py servers from these tests were still
        # running 14 to 16 hours later. Anything still running from this
        # sandbox is a leak, so stop it before the directory goes.
        subprocess.run(["/usr/bin/pkill", "-f", str(self.tmp)], capture_output=True)
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



@unittest.skipUnless(NODE, "node not installed")
class GenerationTests(KitSandbox):
    """Reengineer step 9: every service knows the kit snapshot it runs from.

    On 2026-10-11 room-capture, hud-speak and the origin-guard server ran from
    snapshots already pruned, and only reading ps by hand showed it.
    """

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



SERVER = r"""
import http.server, os, socket, sys
word, port = sys.argv[1], int(sys.argv[2])
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = word.encode()
        self.send_response(200); self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
srv = http.server.HTTPServer(("127.0.0.1", port), H, bind_and_activate=False)
fd = os.environ.get("CHEWBACCA_LISTEN_FD")
if fd:
    srv.socket = socket.socket(fileno=int(fd))
else:
    srv.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); srv.server_bind(); srv.server_activate()
srv.serve_forever()
"""


def free_port():
    import socket
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close()
    return p


@unittest.skipUnless(NODE, "node not installed")
class BlueGreenTests(KitSandbox):
    """Reengineer step 10: a kit move leaves no gap in a keepalive service.

    Before this, every service died with the daemon on a kit move and came
    back with the next one, 5.3 to 8.0 s later per the 2026-10-12 daemon log.
    """

    def setUp(self):
        super().setUp()
        self.port = free_port()
        for sha, word in ((SHA_A, "old"), (SHA_B, "new")):
            (self.tmp / "snapshots" / sha / "bin" / "web.py").write_text(SERVER)
        self.daemons = []
        self.stop_launchd = False

    def tearDown(self):
        self.stop_launchd = True
        for d in self.daemons:
            if d.poll() is None:
                d.send_signal(signal.SIGTERM)
                try:
                    d.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    d.kill()
        super().tearDown()

    def launchd(self):
        """Stand in for launchd's KeepAlive: start the daemon again whenever it
        exits. Real launchd took 5.3 to 8.0 s; this restarts at once, which
        flatters the code before this step."""
        import threading

        def loop():
            while not self.stop_launchd:
                with open(self.tmp / "daemon.out", "a") as out:
                    d = subprocess.Popen([NODE, str(DAEMON), "run"], env=self.env, stdout=out, stderr=subprocess.STDOUT)
                self.daemons.append(d)
                while d.poll() is None and not self.stop_launchd:
                    time.sleep(0.05)
        threading.Thread(target=loop, daemon=True).start()

    def write_service(self, **extra):
        # Written as JSON rather than through `register`, so the same test runs
        # on the daemon before this step (which has no --swap flag) and measures it.
        svc = {"name": "web", "keepalive": True,
               "argv": [sys.executable, str(self.tmp / "kit/bin/web.py"), "X", str(self.port)], **extra}
        d = self.tmp / "daemon/services"
        d.mkdir(parents=True, exist_ok=True)
        (d / "web.json").write_text(json.dumps(svc))

    def get(self):
        import urllib.request
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/", timeout=1) as r:
                return r.read().decode()
        except OSError:
            return None

    def state(self):
        f = self.tmp / "daemon/state.json"
        try:
            return json.loads(f.read_text())
        except (OSError, ValueError):
            return {}

    def probe_across_a_move(self, word_old, word_new):
        for _ in range(80):
            if self.get() == word_old:
                break
            time.sleep(0.1)
        self.assertEqual(self.get(), word_old, "service never came up")
        first_daemon = self.daemons[-1].pid
        self.point(SHA_B)
        failed, longest, down_since, answers = 0, 0.0, None, []
        deadline = time.time() + 40
        while time.time() < deadline:
            t = time.time()
            a = self.get()
            if a is None:
                failed += 1
                down_since = down_since or t
            else:
                if down_since:
                    longest = max(longest, t - down_since)
                    down_since = None
                answers.append(a)
                if a == word_new and self.state().get("web", {}).get("gen") == SHA_B and self.daemons[-1].pid != first_daemon:
                    break
            time.sleep(0.05)
        print(f"\n  gap across a kit move: {failed} refused probes, longest {longest:.2f} s", file=sys.stderr)
        return failed, longest, answers

    def test_overlap_service_refuses_nothing_across_a_kit_move(self):
        self.write_service(swap="overlap", listen=self.port, health={"http": "/"})
        for sha, word in ((SHA_A, "old"), (SHA_B, "new")):
            (self.tmp / "snapshots" / sha / "bin" / "web.py").write_text(SERVER.replace("word, port = sys.argv[1]", f"word, port = {word!r}"))
        self.launchd()
        failed, longest, answers = self.probe_across_a_move("old", "new")
        self.assertEqual(answers[-1], "new", "the service never moved to the new kit")
        self.assertEqual(failed, 0, f"{failed} requests refused across the move, longest gap {longest:.2f} s")
        swaps = [json.loads(l) for l in (self.tmp / "daemon/swaps.jsonl").read_text().splitlines()]
        self.assertEqual([(s["service"], s["mode"], s["from"], s["to"], s["downMs"]) for s in swaps],
                         [("web", "overlap", SHA_A, SHA_B, 0)])
        self.assertIn("healthy", swaps[0]["result"])

    def test_stop_start_service_outlives_the_daemon_restart(self):
        # realm-ui binds its own port, so it can't overlap: it stops and starts
        # in one tick of the new daemon, instead of dying with the old one.
        self.write_service()
        for sha, word in ((SHA_A, "old"), (SHA_B, "new")):
            (self.tmp / "snapshots" / sha / "bin" / "web.py").write_text(SERVER.replace("word, port = sys.argv[1]", f"word, port = {word!r}"))
        self.launchd()
        failed, longest, answers = self.probe_across_a_move("old", "new")
        self.assertEqual(answers[-1], "new")
        out = (self.tmp / "daemon.out").read_text()
        self.assertIn("left running for the next one: web", out)
        self.assertIn("adopted web from the last run", out)
        swaps = [json.loads(l) for l in (self.tmp / "daemon/swaps.jsonl").read_text().splitlines()]
        self.assertEqual([(s["mode"], s["to"]) for s in swaps], [("stop-start", SHA_B)])
        # The service was down only for its own stop and start, never for the
        # daemon's restart: well under a second here, 5.3 to 8.0 s before.
        self.assertLess(longest, 1.5)

    def test_a_new_copy_that_dies_leaves_the_old_one_serving(self):
        self.write_service(swap="overlap", listen=self.port, health={"http": "/"})
        (self.tmp / "snapshots" / SHA_A / "bin" / "web.py").write_text(SERVER.replace("word, port = sys.argv[1]", "word, port = 'old'"))
        (self.tmp / "snapshots" / SHA_B / "bin" / "web.py").write_text("import sys; sys.exit(3)\n")
        self.launchd()
        for _ in range(80):
            if self.get() == "old":
                break
            time.sleep(0.1)
        first = self.state()["web"]["pid"]
        self.point(SHA_B)
        swaps = self.tmp / "daemon/swaps.jsonl"
        for _ in range(200):
            if swaps.exists() and swaps.read_text().strip():
                break
            time.sleep(0.1)
        ev = json.loads(swaps.read_text().splitlines()[0])
        self.assertEqual(ev["result"], "new copy exited")
        self.assertEqual(self.get(), "old")
        st = self.state()["web"]
        self.assertEqual((st["pid"], st["gen"]), (first, SHA_A))
        self.assertGreater(st["swapRetryAt"], time.time() * 1000)

    def test_a_copy_bound_without_reuseport_swaps_stop_start_once(self):
        # people-dashboard ran from a registration without --listen and bound
        # 7373 itself; no new copy can bind beside that one.
        self.write_service()
        for sha, word in ((SHA_A, "old"), (SHA_B, "new")):
            (self.tmp / "snapshots" / sha / "bin" / "web.py").write_text(SERVER.replace("word, port = sys.argv[1]", f"word, port = {word!r}"))
        self.launchd()
        for _ in range(80):
            if self.get() == "old":
                break
            time.sleep(0.1)
        self.assertEqual(self.get(), "old")
        self.write_service(swap="overlap", listen=self.port, health={"http": "/"})
        self.point(SHA_B)
        swaps = self.tmp / "daemon/swaps.jsonl"
        for _ in range(200):
            if self.get() == "new" and swaps.exists():
                break
            time.sleep(0.1)
        ev = [json.loads(l) for l in swaps.read_text().splitlines()]
        self.assertEqual([(e["mode"], e["result"]) for e in ev], [("stop-start", "started")])
        self.assertTrue(self.state()["web"]["shared"])

    def test_a_handover_too_old_is_reaped_not_adopted(self):
        self.write_service()
        p = self.spawn(["/bin/sleep", "300"])
        lstart = node_eval(f"console.log(JSON.stringify(require({str(DAEMON)!r}).startedAt({p.pid})))", self.env)
        (self.tmp / "daemon/state.json").write_text(json.dumps({"web": {
            "pid": p.pid, "argv0": "sleep", "gen": SHA_A, "from": "kit", "lastStart": lstart,
            "handover": int(time.time() * 1000) - 200_000}}))
        with open(self.tmp / "daemon.out", "a") as out:
            d = subprocess.Popen([NODE, str(DAEMON), "run"], env=self.env, stdout=out, stderr=subprocess.STDOUT)
        self.daemons.append(d)
        for _ in range(100):
            if p.poll() is not None:
                break
            time.sleep(0.1)
        self.assertIsNotNone(p.poll(), "a handover older than HANDOVER_MAX_S was adopted")

    def test_register_flags_round_trip_and_validate(self):
        self.cli("register", "web", "--keepalive", "--swap", "overlap", "--listen", "7373", "--health-http", "/", "--", "/bin/true")
        svc = json.loads((self.tmp / "daemon/services/web.json").read_text())
        self.assertEqual((svc["swap"], svc["listen"], svc["health"]), ("overlap", 7373, {"http": "/"}))
        for bad in (["--every", "60", "--swap", "overlap"], ["--keepalive", "--swap", "sideways"],
                    ["--keepalive", "--listen", "0"], ["--keepalive", "--health-http", "/"]):
            r = self.cli("register", "bad", *bad, "--", "/bin/true", check=False)
            self.assertEqual(r.returncode, 2, bad)
        sys.path.insert(0, str(ROOT / "bin" / "lib"))
        import daemon_register
        self.assertIsNone(daemon_register.validate({"name": "w", "keepalive": True, "argv": ["/bin/true"],
                                                    "swap": "overlap", "listen": 7373, "health": {"http": "/"}}))
        self.assertIsNotNone(daemon_register.validate({"name": "w", "every": 60, "argv": ["/bin/true"], "swap": "overlap"}))


@unittest.skipUnless(NODE, "node not installed")
class SelfHandoverTests(KitSandbox):
    """A service that hands itself over (realm-engine run) is never stopped by
    a kit move. On 2026-10-12 the daemon stop-started the realm engine at
    14:57:19Z and 15:03:47Z, 30 s and 23 s into two real Claude turns, and
    both turns died (swaps.jsonl, day-ide-report.md). realm-engine already
    waits for no turn to be running before it execs the new kit's copy."""

    AGENT = r"""#!/bin/sh
me=$(cd "$(dirname "$0")" && pwd -P)
trap 'echo killed >> "{T}/killed.txt"; kill $child 2>/dev/null; exit 0' TERM
echo "$me" >> "{T}/ran.txt"
/bin/sh "$me/child.sh" &
child=$!
while :; do
  cur=$(cd "{T}/kit/bin" && pwd -P)
  if [ "$cur" != "$me" ] && [ ! -e "{T}/busy" ]; then
    kill $child
    exec /bin/sh "{T}/kit/bin/agent.sh"
  fi
  sleep 0.2
done
"""

    launchd = BlueGreenTests.launchd
    state = BlueGreenTests.state

    def setUp(self):
        super().setUp()
        self.daemons = []
        self.stop_launchd = False
        for sha in (SHA_A, SHA_B):
            b = self.tmp / "snapshots" / sha / "bin"
            (b / "agent.sh").write_text(self.AGENT.replace("{T}", str(self.tmp)))
            # A child whose command names its snapshot, like realm's node
            # --import <snapshot>/config/data/realm/origin-guard.mjs.
            (b / "child.sh").write_text("while :; do sleep 1; done\n")

    def tearDown(self):
        self.stop_launchd = True
        for d in self.daemons:
            if d.poll() is None:
                d.send_signal(signal.SIGTERM)
                try:
                    d.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    d.kill()
        subprocess.run(["/usr/bin/pkill", "-f", str(self.tmp)], capture_output=True)
        super().tearDown()

    def register_agent(self, **extra):
        svc = {"name": "realm", "keepalive": "crash",
               "argv": ["/bin/sh", str(self.tmp / "kit/bin/agent.sh")], **extra}
        d = self.tmp / "daemon/services"
        d.mkdir(parents=True, exist_ok=True)
        (d / "realm.json").write_text(json.dumps(svc))

    def run_turn_across_a_move(self):
        busy = self.tmp / "busy"
        busy.write_text("a turn is running")
        self.launchd()
        first = None
        for _ in range(80):
            first = self.state().get("realm", {}).get("pid")
            if first:
                break
            time.sleep(0.25)
        self.assertTrue(first, "the agent never started")
        first_daemon = self.daemons[-1].pid
        self.point(SHA_B)
        # Two daemon ticks past the restart onto the new kit, turn still running.
        deadline = time.time() + 30
        while time.time() < deadline and (self.daemons[-1].pid == first_daemon or len(self.daemons) < 2):
            time.sleep(0.2)
        time.sleep(11)
        killed = self.tmp / "killed.txt"
        self.assertFalse(killed.exists(), "the kit move killed the agent mid-turn")
        self.assertEqual(self.state()["realm"]["pid"], first)
        os.kill(first, 0)
        # The turn ends: the agent hands itself over, same pid, new kit.
        busy.unlink()
        moved = False
        for _ in range(80):
            st = self.state().get("realm", {})
            if st.get("pid") == first and st.get("gen") == SHA_B:
                moved = True
                break
            time.sleep(0.25)
        self.assertTrue(moved, f"the daemon never saw the handover: {self.state().get('realm')}")
        self.assertFalse(killed.exists())
        ran = (self.tmp / "ran.txt").read_text().split()
        self.assertEqual([Path(r).parent.name for r in ran], [SHA_A, SHA_B])
        swaps = self.tmp / "daemon/swaps.jsonl"
        events = [json.loads(l) for l in swaps.read_text().splitlines()] if swaps.exists() else []
        self.assertEqual([e for e in events if e["service"] == "realm" and e["mode"] != "self"], [])
        code, st = self.status("--check")
        self.assertEqual(code, 0, st.get("late"))

    def test_the_realm_engine_adopted_from_its_plist_survives_a_kit_move_mid_turn(self):
        # The live registration: adopted from com.chewbacca.realm, no swap key.
        self.register_agent(adoptedFrom="com.chewbacca.realm")
        self.run_turn_across_a_move()

    def test_swap_self_survives_a_kit_move_mid_turn(self):
        self.register_agent(swap="self")
        self.run_turn_across_a_move()

    def test_swap_self_validates_and_registers(self):
        self.cli("register", "eng", "--restart-on-crash", "--swap", "self", "--", "/bin/true")
        self.assertEqual(json.loads((self.tmp / "daemon/services/eng.json").read_text())["swap"], "self")
        r = self.cli("register", "bad", "--every", "60", "--swap", "self", "--", "/bin/true", check=False)
        self.assertEqual(r.returncode, 2)
        sys.path.insert(0, str(ROOT / "bin" / "lib"))
        import daemon_register
        self.assertIsNone(daemon_register.validate({"name": "w", "keepalive": "crash", "argv": ["/bin/true"], "swap": "self"}))

    def test_a_plist_adopted_realm_registers_as_self_handover(self):
        out = node_eval("const d=require(%r);const s=d.serviceFromPlist('com.chewbacca.realm',"
                        "{ProgramArguments:['/usr/bin/env','python3','/x/realm-engine','run'],KeepAlive:{SuccessfulExit:false},RunAtLoad:true});"
                        "console.log(JSON.stringify({swap:d.swapOf(s),key:s.swap===undefined,valid:d.validate(s)}))"
                        % str(DAEMON), self.env)
        # Self by label, with no key in the file an older daemon would reject.
        self.assertEqual(out, {"swap": "self", "key": True, "valid": None})


class ListenExecTests(unittest.TestCase):
    def test_people_dashboard_serves_on_the_handed_over_port(self):
        port = free_port()
        code = ("require(%r).serve({db: () => null, port: 1, host: '127.0.0.1', onReady: () => {}})"
                % str(ROOT / "bin/lib/people-dashboard.js"))
        p = subprocess.Popen(["/usr/bin/python3", str(ROOT / "bin/lib/listen_exec.py"), str(port), "--", NODE, "-e", code],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            import urllib.request
            body = None
            for _ in range(100):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as r:
                        body = r.read()
                    break
                except OSError:
                    time.sleep(0.05)
            self.assertTrue(body and b"<" in body, "dashboard did not answer on the handed-over fd")
        finally:
            p.terminate(); p.wait(timeout=5)

    def test_only_the_new_half_of_a_swap_binds_beside_a_live_copy(self):
        import socket
        port = free_port()
        held = socket.socket()
        held.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        held.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        held.bind(("127.0.0.1", port))
        held.listen(8)
        try:
            run = lambda env: subprocess.run(["/usr/bin/python3", str(ROOT / "bin/lib/listen_exec.py"), str(port), "--", "true"],
                                             env=env, capture_output=True, text=True, timeout=10)
            plain = run({k: v for k, v in os.environ.items() if k != "CHEWBACCA_LISTEN_OVERLAP"})
            self.assertEqual(plain.returncode, 1, plain.stderr)
            self.assertIn("already answers", plain.stderr)
            # execvp: a bare command name resolves on PATH.
            swap = run(dict(os.environ, CHEWBACCA_LISTEN_OVERLAP="1"))
            self.assertEqual(swap.returncode, 0, swap.stderr)
        finally:
            held.close()

    def test_kit_paths_register_through_current(self):
        tmp = Path(tempfile.mkdtemp()).resolve()
        try:
            snap = tmp / ".chewbacca/kit/snapshots/abc123/bin"
            snap.mkdir(parents=True)
            (snap / "people").write_text("")
            (tmp / ".chewbacca/kit/current").symlink_to("snapshots/abc123")
            code = "console.log(JSON.stringify(require(%r).viaCurrentKit(%r)))" % (str(ROOT / "bin/lib/people/dashboard.js"), str(snap / "people"))
            env = dict(os.environ, HOME=str(tmp))
            self.assertEqual(node_eval(code, env), str(tmp / ".chewbacca/kit/current/bin/people"))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


SANDBOX = shutil.which("sandbox-exec")
# Every launchd write below runs where /bin/launchctl can't start, so even the
# old code these fail on can't touch the real gui domain while proving it.
NO_LAUNCHCTL = '(version 1)(allow default)(deny process-exec (literal "/bin/launchctl"))'


@unittest.skipUnless(NODE and SANDBOX, "node and sandbox-exec needed")
class ScratchHomeLeavesLaunchdAlone(unittest.TestCase):
    """2026-10-13 00:04: setup.sh in a scratch HOME replaced the real
    com.chewbacca with one pointing into the scratch kit. When that folder was
    deleted, realm-ui exited 2 on every start (listen_exec.py beside a deleted
    daemon) and the agents page was down. Only the account's own LaunchAgents
    may change what launchd runs."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "agents").mkdir()
        self.env = dict(os.environ, HOME=str(self.tmp),
                        CHEWBACCA_DAEMON_DIR=str(self.tmp / "daemon"),
                        CHEWBACCA_LAUNCH_AGENTS=str(self.tmp / "agents"),
                        CHEWBACCA_DAEMON_LOGS=str(self.tmp / "logs"),
                        CHEWBACCA_KIT=str(self.tmp / "kit"))
        self.env.pop("CHEWBACCA_LAUNCHCTL", None)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def sandboxed(self, argv, env=None):
        return subprocess.run([SANDBOX, "-p", NO_LAUNCHCTL, *argv], capture_output=True,
                              text=True, env=env or self.env, timeout=60)

    def test_same_folder_rule_matches_aliases_and_refuses_others(self):
        own = self.tmp / "Own" / "Library" / "LaunchAgents"
        own.mkdir(parents=True)
        (self.tmp / "link").symlink_to(own)
        other = self.tmp / "other"
        other.mkdir()
        cases = [(own, True), (self.tmp / "link", True),
                 (Path(str(own).replace("/Own/", "/own/")), True),  # APFS folds case
                 (Path("/private" + str(own)) if not str(own).startswith("/private") else own, True),
                 (other, False), (self.tmp / "missing", False)]
        sys.path.insert(0, str(ROOT / "bin" / "lib"))
        import daemon_register  # noqa: PLC0415
        js = node_eval("const d=require(%s);console.log(JSON.stringify(%s.map(([a,o])=>d.agentsVsOwn(a,o)===null)))" % (
            json.dumps(str(DAEMON)), json.dumps([[str(a), str(own)] for a, _ in cases])), self.env)
        for (agents, want), got_js in zip(cases, js):
            self.assertEqual(daemon_register.agents_vs_own(agents, own) is None, want, agents)
            self.assertEqual(got_js, want, agents)

    def test_daemon_install_in_scratch_home_writes_plist_and_never_loads_it(self):
        r = self.sandboxed([NODE, str(DAEMON), "install"])
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue((self.tmp / "agents" / "com.chewbacca.plist").exists())
        self.assertIn("not loaded into launchd", r.stdout)

    def test_a_fake_launchctl_is_still_called(self):
        log = self.tmp / "calls"
        fake = self.tmp / "fake-launchctl"
        fake.write_text("#!/bin/sh\necho \"$@\" >> {}\n".format(log))
        fake.chmod(0o755)
        r = self.sandboxed([NODE, str(DAEMON), "install"], dict(self.env, CHEWBACCA_LAUNCHCTL=str(fake)))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("bootstrap gui/", log.read_text())

    def test_realm_engine_launchctl_skips_writes_from_a_scratch_home(self):
        code = ("import importlib.machinery,importlib.util,sys;"
                "l=importlib.machinery.SourceFileLoader('re',sys.argv[1]);"
                "s=importlib.util.spec_from_loader('re',l);m=importlib.util.module_from_spec(s);l.exec_module(m);"
                "print(m.launchctl('bootstrap','gui/0','/nope').returncode, bool(m.foreign_agents()))")
        r = self.sandboxed(["/usr/bin/python3", "-c", code, str(ROOT / "bin" / "realm-engine")],
                           dict(self.env, CHEWBACCA_LAUNCH_AGENTS_DIR=str(self.tmp / "agents")))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.split(), ["0", "True"])

    def test_daemon_register_retire_skips_bootout_from_a_scratch_home(self):
        (self.tmp / "agents" / "com.example.old.plist").write_text("<plist/>")
        code = ("import sys;sys.path.insert(0,sys.argv[1]);import daemon_register as d;"
                "d.retire('com.example.old');print('ok')")
        r = self.sandboxed(["/usr/bin/python3", "-c", code, str(ROOT / "bin" / "lib")])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse((self.tmp / "agents" / "com.example.old.plist").exists())


if __name__ == "__main__":
    unittest.main()
