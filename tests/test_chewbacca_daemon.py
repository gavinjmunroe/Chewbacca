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

    def test_no_installer_bootstraps_its_own_agent(self):
        for rel in self.FILES:
            text = (ROOT / rel).read_text()
            self.assertNotIn("launchctl bootstrap", text, rel)
            self.assertNotIn('"bootstrap"', text, rel)
            self.assertNotIn("launchctl load", text, rel)


if __name__ == "__main__":
    unittest.main()
