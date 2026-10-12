"""chewbacca-bridge runs only its fixed tools, refuses the rest, and round-trips a job. Offline."""
import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "bin/chewbacca-bridge"


def load(tmp):
    os.environ["CHEWBACCA_BRIDGE_DIR"] = tmp
    loader = importlib.machinery.SourceFileLoader("bridge_mod", str(TOOL))
    spec = importlib.util.spec_from_loader("bridge_mod", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    mod.LOG = Path(tmp) / "bridge.log"
    return mod


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.b = load(self.tmp)

    def test_allow_commit_is_refused(self):
        with self.assertRaises(self.b.Refused):
            self.b.jev_browse(["run", "--url", "https://x.com", "--goal", "g", "--allow-commit"])

    def test_non_https_refused(self):
        with self.assertRaises(self.b.Refused):
            self.b.jev_browse(["run", "--url", "file:///etc/passwd", "--goal", "g"])

    def test_unknown_flag_refused(self):
        with self.assertRaises(self.b.Refused):
            self.b.jev_browse(["run", "--url", "https://x.com", "--goal", "g", "--exec", "rm"])

    def test_valid_run_builds_json_argv(self):
        argv, _ = self.b.jev_browse(["run", "--url", "https://x.com/a", "--goal", "open it"])
        self.assertIn("--json", argv)
        self.assertEqual(argv[argv.index("--url") + 1], "https://x.com/a")

    def test_model_route_never_runs_or_writes_a_plan_through_the_bridge(self):
        for args in (["accept", "/tmp/plan.md"], ["handoff", "/tmp/plan.md", "--out", "x"],
                     ["handoff", "/tmp/plan.md", "--save"]):
            with self.subTest(args=args), self.assertRaises(self.b.Refused):
                self.b.REGISTRY["model-route"](args)
        self.b.REGISTRY["model-route"](["check", "/tmp/plan.md"])

    def test_fixed_tools_take_no_args(self):
        with self.assertRaises(self.b.Refused):
            self.b.TOOLS["ping"](["; rm -rf ~"])

    def test_unknown_tool_and_round_trip(self):
        self.b.ensure_dirs()
        stop = threading.Event()

        def loop():
            while not stop.is_set():
                for p in sorted(self.b.INBOX.glob("*.json")):
                    self.b.run_job(p)
                time.sleep(0.05)

        t = threading.Thread(target=loop, daemon=True)
        t.start()
        try:
            self.assertEqual(self.b.call("ping", [], timeout=5), 0)
            self.assertEqual(self.b.call("bash", ["-c", "id"], timeout=5), 126)
        finally:
            stop.set()
        self.assertIn("refused", self.b.LOG.read_text())

    def test_page_read_is_https_only(self):
        with self.assertRaises(self.b.Refused):
            self.b.page_read(["javascript:alert(1)"])
        argv, _ = self.b.page_read(["https://app.clay.com/x", "4"])
        self.assertEqual(argv[-2:], ["https://app.clay.com/x", "4.0"])

    def test_git_is_read_and_fetch(self):
        with self.assertRaises(self.b.Refused):
            self.b.REGISTRY["git"](["-C", "/tmp", "push"])
        with self.assertRaises(self.b.Refused):
            self.b.REGISTRY["git"](["-C", "/tmp", "-c", "x=y", "status"])
        self.b.REGISTRY["git"](["-C", "/tmp", "status"])

    def test_no_shell_agents(self):
        with self.assertRaises(self.b.Refused):
            self.b.REGISTRY["claude-tab"](["send", "rm -rf ~"])
        self.assertNotIn("op", self.b.TOOLS)
        self.assertNotIn("gemini", self.b.TOOLS)

    def test_gtme_signals_takes_only_its_flag_list(self):
        build = self.b.TOOLS["gtme-signals"]
        argv, timeout = build(["formd", "--industry", "Health Care", "--min-amount", "1000000",
                               "--state", "CA", "--limit", "5", "--since", "2026-10-01", "--csv"])
        self.assertEqual(argv[1:], ["formd", "--industry=Health Care", "--min-amount=1000000",
                                    "--state=CA", "--limit=5", "--since=2026-10-01", "--csv"])
        self.assertEqual(timeout, 900)
        for args in (
            ["formd", "--cache-dir", "../../x"], ["formd", "--cache-dir=/tmp/x"],
            ["formd", "--cache", "../x"], ["formd", "--cache-dir", "~/Library/LaunchAgents"],
            ["formd", "--industry", "--cache-dir"], ["formd", "--industry"],
            ["formd", "--since", "../x"], ["formd", "--limit", "0"], ["formd", "--state", "../"],
            ["formd", "--csv", "/tmp/out.csv"], ["formd", "extra"], ["other"], [],
            ["formd", "--allow-commit"],
        ):
            with self.subTest(args=args), self.assertRaises(self.b.Refused):
                build(args)

    def test_gtme_signals_refuses_abbreviated_cache_dir_itself(self):
        out = subprocess.run([sys.executable, str(ROOT / "bin/gtme-signals"), "formd", "--cache", "/tmp/x",
                              "--since", "2026-10-09", "--until", "2026-10-01"],
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 2)
        self.assertIn("unrecognized arguments", out.stderr)

    def test_sends_are_out(self):
        with self.assertRaises(self.b.Refused):
            self.b.REGISTRY["imsg"](["send", "--to", "+15555550123", "--text", "hi"])
        with self.assertRaises(self.b.Refused):
            self.b.REGISTRY["himalaya"](["message", "send"])
        argv, _ = self.b.REGISTRY["gog"](["gmail", "search", "from:jonah"])
        self.assertIn("--gmail-no-send", argv)
        self.assertNotIn("write-file", self.b.TOOLS)

    def test_tools_listing(self):
        out = subprocess.run([sys.executable, str(TOOL), "tools"], capture_output=True, text=True).stdout
        self.assertIn("jev-browse", out)
        self.assertNotIn("bash", out.split())



class OverlapTests(unittest.TestCase):
    """Reengineer step 10: on a kit move the daemon starts the new bridge beside
    the old one. Both loops glob one inbox, so each job must run exactly once."""

    def test_two_serve_loops_run_each_job_once(self):
        tmp = Path(tempfile.mkdtemp())
        env = dict(os.environ, HOME=str(tmp), CHEWBACCA_BRIDGE_DIR=str(tmp / "q"))
        loops = [subprocess.Popen([sys.executable, str(TOOL), "serve"], env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) for _ in range(2)]
        try:
            inbox = tmp / "q/in"
            for _ in range(50):
                if inbox.is_dir():
                    break
                time.sleep(0.1)
            ids = [f"job{i:03d}" for i in range(60)]
            for job_id in ids:
                t = inbox / f".{job_id}.tmp"
                t.write_text(json.dumps({"id": job_id, "tool": "ping", "args": []}))
                t.rename(inbox / f"{job_id}.json")
            log = tmp / ".chewbacca/bridge.log"
            for _ in range(300):
                if log.exists() and log.read_text().count(" done ") >= len(ids) and not list(inbox.glob("*.json")):
                    break
                time.sleep(0.1)
            time.sleep(1.0)
            done = [l.split()[2] for l in log.read_text().splitlines() if l.split()[1:2] == ["done"]]
            twice = sorted({d for d in done if done.count(d) > 1})
            self.assertEqual(twice, [], f"{len(twice)} jobs ran in both loops")
            self.assertEqual(sorted(set(done)), ids)
            for job_id in ids:
                self.assertEqual(json.loads((tmp / "q/out" / f"{job_id}.json").read_text())["rc"], 0, job_id)
        finally:
            for p in loops:
                p.terminate()
                p.wait(timeout=5)

    def test_a_job_whose_claimer_died_runs_again(self):
        # The daemon stops the old bridge mid-job on a swap; the job it had
        # claimed must not sit as a .claim file while its caller waits 700 s.
        tmp = Path(tempfile.mkdtemp())
        env = dict(os.environ, HOME=str(tmp), CHEWBACCA_BRIDGE_DIR=str(tmp / "q"))
        inbox = tmp / "q/in"
        inbox.mkdir(parents=True)
        dead = subprocess.Popen(["/usr/bin/true"])
        dead.wait()
        (inbox / f".orphan1.{dead.pid}.claim").write_text(json.dumps({"id": "orphan1", "tool": "ping", "args": []}))
        live = subprocess.Popen(["/bin/sleep", "30"])
        (inbox / f".busy1.{live.pid}.claim").write_text(json.dumps({"id": "busy1", "tool": "ping", "args": []}))
        loop = subprocess.Popen([sys.executable, str(TOOL), "serve"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            out = tmp / "q/out/orphan1.json"
            for _ in range(100):
                if out.exists():
                    break
                time.sleep(0.1)
            self.assertEqual(json.loads(out.read_text())["rc"], 0)
            # A claim whose owner is alive is that owner's to finish.
            self.assertTrue((inbox / f".busy1.{live.pid}.claim").exists())
            self.assertFalse((tmp / "q/out/busy1.json").exists())
        finally:
            loop.terminate(); loop.wait(timeout=5)
            live.kill(); live.wait()

if __name__ == "__main__":
    unittest.main()
