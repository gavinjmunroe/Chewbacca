"""Exercise the CLI boundary without spending model quota."""

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from test_hud_listen import load


BIN = Path(__file__).resolve().parents[1] / "bin" / "hud-codex"
THREAD = "12345678-1234-1234-1234-123456789abc"
FAKE = '''#!/usr/bin/env python3
import json, os, pathlib, signal, sys, time
args = sys.argv[1:]
with open(os.environ["RECORD"], "a") as record:
    record.write(json.dumps({"args": args, "prompt": sys.stdin.read(),
                             "child": os.environ.get("CHEWBACCA_HUD_CHILD")}) + "\\n")
if os.environ.get("GRANDCHILD_PID"):
    pathlib.Path(os.environ["SLEEP_PID"]).write_text(str(os.getpid()))
    if os.fork() == 0:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        pathlib.Path(os.environ["GRANDCHILD_PID"]).write_text(str(os.getpid()))
        time.sleep(60)
        os._exit(0)
    time.sleep(60)
if os.environ.get("SLEEP_PID"):
    pathlib.Path(os.environ["SLEEP_PID"]).write_text(str(os.getpid()))
    time.sleep(60)
print(json.dumps({"type": "thread.started", "thread_id": "12345678-1234-1234-1234-123456789abc"}))
print(json.dumps({"type": "item.completed", "item": {"text": "private tool output"}}))
if os.environ.get("NO_FINAL") != "1":
    pathlib.Path(args[args.index("--output-last-message") + 1]).write_text("s Hello from Codex\\n")
sys.exit(int(os.environ.get("FAKE_EXIT", "0")))
'''


class HudCodexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        fake = self.root / "codex"
        fake.write_text(FAKE)
        fake.chmod(0o755)
        self.state = self.root / "session.json"
        self.record = self.root / "record.jsonl"
        self.env = dict(os.environ, PATH=str(self.root) + os.pathsep + os.environ["PATH"],
                        HUD_CODEX_STATE=str(self.state), RECORD=str(self.record))

    def tearDown(self):
        self.temp.cleanup()

    def call(self, prompt="Please help", **env):
        return subprocess.run([sys.executable, str(BIN)], input=prompt, text=True,
                              capture_output=True, env=dict(self.env, **env), cwd=self.root)

    def records(self):
        return [json.loads(line) for line in self.record.read_text().splitlines()]

    def test_only_final_text_and_explicit_resume(self):
        first = self.call()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(first.stdout, "s Hello from Codex\n")
        self.assertEqual(json.loads(self.state.read_text())["thread_id"], THREAD)
        second = self.call("Continue")
        self.assertEqual(second.returncode, 0, second.stderr)
        records = self.records()
        self.assertEqual(records[0]["args"][0], "exec")
        self.assertEqual(records[1]["args"][:3], ["exec", "resume", THREAD])
        self.assertEqual(records[1]["prompt"], "Continue")
        for record in records:
            self.assertEqual(record["child"], "1")
            self.assertFalse(set(record["args"]) & {"-m", "--model", "-c", "--config", "--sandbox",
                            "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust", "--last"})

    def test_failure_does_not_emit_or_save_apparent_answer(self):
        result = self.call(FAKE_EXIT="7")
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.state.exists())

    def test_no_final_is_failure(self):
        result = self.call(NO_FINAL="1")
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.state.exists())

    def test_failed_resume_preserves_saved_session(self):
        self.assertEqual(self.call().returncode, 0)
        original = self.state.read_bytes()
        self.assertEqual(self.call(FAKE_EXIT="4").returncode, 4)
        self.assertEqual(self.state.read_bytes(), original)

    def test_termination_stops_codex_child(self):
        pidfile = self.root / "child.pid"
        process = subprocess.Popen([sys.executable, str(BIN)], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                   env=dict(self.env, SLEEP_PID=str(pidfile)), cwd=self.root)
        try:
            process.stdin.write("Wait\n")
            process.stdin.close()
            deadline = time.monotonic() + 5
            while not pidfile.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(pidfile.exists(), "fake Codex did not start")
            child = int(pidfile.read_text())
            process.terminate()
            self.assertEqual(process.wait(timeout=5), 143, process.stderr.read())
            with self.assertRaises(ProcessLookupError):
                os.kill(child, 0)
            self.assertFalse(self.state.exists())
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            process.stdout.close()
            process.stderr.close()

    def test_different_workspace_does_not_resume(self):
        self.state.write_text(json.dumps({"cwd": "/different", "thread_id": THREAD}))
        self.assertEqual(self.call().returncode, 0)
        self.assertNotIn("resume", self.records()[0]["args"])

    def test_termination_kills_tool_even_when_codex_parent_exits_first(self):
        parent_file = self.root / "parent.pid"
        tool_file = self.root / "tool.pid"
        process = subprocess.Popen([sys.executable, str(BIN)], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                   env=dict(self.env, SLEEP_PID=str(parent_file),
                                            GRANDCHILD_PID=str(tool_file)), cwd=self.root)
        parent = tool = None
        try:
            process.stdin.write("Wait\n")
            process.stdin.close()
            deadline = time.monotonic() + 5
            while not tool_file.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(tool_file.exists(), "TERM-ignoring tool did not start")
            parent, tool = int(parent_file.read_text()), int(tool_file.read_text())
            process.terminate()
            self.assertEqual(process.wait(timeout=5), 143, process.stderr.read())
            with self.assertRaises(ProcessLookupError):
                os.kill(parent, 0)
            # An orphan can briefly be a zombie until init reaps it; a zombie
            # is dead and cannot perform more tool work.
            status = subprocess.run(['ps', '-o', 'stat=', '-p', str(tool)],
                                    capture_output=True, text=True).stdout.strip()
            self.assertTrue(not status or status.startswith('Z'), status)
            self.assertFalse(self.state.exists())
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            if parent is not None:
                try:
                    os.killpg(parent, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.stdout.close()
            process.stderr.close()

    def test_listener_stop_kills_term_ignoring_descendant_before_outer_timer(self):
        module = load()
        listener = module.Listener(str(BIN), False, False)
        self.addCleanup(listener.sock.close)
        listener.log = lambda *args: None
        for attempt in range(5):
            with self.subTest(attempt=attempt):
                parent_file = self.root / f"parent-{attempt}.pid"
                tool_file = self.root / f"tool-{attempt}.pid"
                process = subprocess.Popen(
                    [sys.executable, str(BIN)], stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True,
                    env=dict(self.env, SLEEP_PID=str(parent_file),
                             GRANDCHILD_PID=str(tool_file)), cwd=self.root)
                timers = []
                original_later = module.later

                def later(delay, callback):
                    timer = original_later(delay, callback)
                    timers.append(timer)
                    return timer

                try:
                    process.stdin.write("Wait\n")
                    process.stdin.close()
                    deadline = time.monotonic() + 5
                    while not tool_file.exists() and time.monotonic() < deadline:
                        time.sleep(0.01)
                    self.assertTrue(tool_file.exists(), "TERM-ignoring tool did not start")
                    listener.running = module.Request(said="wait", spoken_at=0, pointed=None)
                    listener.proc = process
                    # Keep the real stop method, grace and kill callback. Joining
                    # the timer ensures the test covers the outer deadline too.
                    with patch.object(module, "later", later):
                        listener.stop()
                    self.assertEqual(len(timers), 1, "outer kill timer was not scheduled")
                    process.wait(timeout=5)
                    for timer in timers:
                        timer.join(timeout=5)
                        self.assertFalse(timer.is_alive())
                    for pidfile in (parent_file, tool_file):
                        status = subprocess.run(
                            ['ps', '-o', 'stat=', '-p', pidfile.read_text()],
                            capture_output=True, text=True, check=False).stdout.strip()
                        self.assertTrue(not status or status.startswith('Z'),
                                        f"{pidfile.name} survived cancellation: {status}")
                    self.assertEqual(process.returncode, 143)
                    self.assertFalse(self.state.exists())
                finally:
                    for timer in timers:
                        timer.cancel()
                        timer.join(timeout=5)
                    if parent_file.exists():
                        # Always clean up a failing baseline without waiting on
                        # inherited pipes held open by a surviving tool.
                        subprocess.run(['kill', '-KILL', '--', '-' + parent_file.read_text()],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=5)
                    if not process.stdin.closed:
                        process.stdin.close()

    def test_stop_during_spawn_is_serviced_after_child_handle_exists(self):
        pidfile = self.root / 'spawn.pid'
        # Send TERM from inside Popen, after creation but before the adapter
        # receives the process handle. The fake child is still awaiting stdin.
        wrapper = '''
import os, pathlib, runpy, signal, subprocess, sys
adapter = runpy.run_path(sys.argv[1])
original = subprocess.Popen
def spawn(*args, **kwargs):
    child = original(*args, **kwargs)
    subprocess.Popen = original
    pathlib.Path(os.environ['SPAWN_PID']).write_text(str(child.pid))
    os.kill(os.getpid(), signal.SIGTERM)
    return child
subprocess.Popen = spawn
sys.exit(adapter['main']())
'''
        result = subprocess.run([sys.executable, '-c', wrapper, str(BIN)],
                                input='Wait', text=True, capture_output=True,
                                env=dict(self.env, SPAWN_PID=str(pidfile)),
                                cwd=self.root, timeout=8)
        self.assertEqual(result.returncode, 143, result.stderr)
        self.assertTrue(pidfile.exists())
        with self.assertRaises(ProcessLookupError):
            os.kill(int(pidfile.read_text()), 0)
        self.assertFalse(self.state.exists())

    def test_invalid_state_cannot_inject_arguments(self):
        self.state.write_text(json.dumps({"cwd": str(self.root), "thread_id": "--last"}))
        self.assertEqual(self.call().returncode, 0)
        self.assertNotIn("resume", self.records()[0]["args"])

    def test_empty_prompt_never_invokes_cli(self):
        self.assertEqual(self.call("  ").returncode, 2)
        self.assertFalse(self.record.exists())


if __name__ == "__main__":
    unittest.main()
