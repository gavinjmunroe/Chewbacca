"""Exercise the native HUD lock in separate processes without creating any UI."""

from pathlib import Path
import select
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swiftc"), "needs macOS Swift")
class HUDSingletonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = tempfile.TemporaryDirectory(prefix="hud-singleton-build-")
        cls.addClassCleanup(cls.build.cleanup)
        directory = Path(cls.build.name)
        harness = directory / "main.swift"
        harness.write_text('''import Foundation
_ = readLine()
do {
    guard let owner = try HUDInstanceLock(path: CommandLine.arguments[1]) else {
        print("duplicate")
        exit(0)
    }
    withExtendedLifetime(owner) {
        FileHandle.standardOutput.write(Data("acquired\\n".utf8))
        if CommandLine.arguments.count > 2 {
            let command = strdup("/bin/cat")!
            var arguments: [UnsafeMutablePointer<CChar>?] = [command, nil]
            execv(command, &arguments)
            exit(2)
        }
        _ = readLine()
    }
} catch {
    print("error")
    exit(1)
}
''')
        cls.executable = directory / "lock-test"
        result = subprocess.run(
            ["swiftc", "-swift-version", "6", str(ROOT / "hud/Sources/KyberKit/HUDInstanceLock.swift"),
             str(harness), "-o", str(cls.executable)],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode:
            raise RuntimeError(result.stderr)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="hud-singleton-")
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "hud.instance.lock"

    def spawn(self, *, exec_child=False):
        process = subprocess.Popen(
            [str(self.executable), str(self.path)] + (["exec"] if exec_child else []),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.addCleanup(self.stop, process)
        return process

    @staticmethod
    def stop(process):
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=5)

    def send(self, process):
        process.stdin.write(b"go\n")
        process.stdin.flush()

    def result(self, process):
        self.assertTrue(select.select([process.stdout], [], [], 10)[0], "lock process hung")
        return process.stdout.readline().decode().strip()

    def acquire(self, **kwargs):
        process = self.spawn(**kwargs)
        self.send(process)
        self.assertEqual(self.result(process), "acquired")
        return process

    def test_simultaneous_launches_have_exactly_one_owner(self):
        contenders = [self.spawn() for _ in range(12)]
        for contender in contenders:
            self.send(contender)
        results = [self.result(contender) for contender in contenders]
        self.assertEqual(results.count("acquired"), 1)
        self.assertEqual(results.count("duplicate"), len(contenders) - 1)
        for contender, result in zip(contenders, results):
            if result == "duplicate":
                self.assertEqual(contender.wait(timeout=5), 0)

    def test_normal_exit_releases_same_lock_file(self):
        owner = self.acquire()
        inode = self.path.stat().st_ino
        self.send(owner)
        self.assertEqual(owner.wait(timeout=5), 0)
        self.acquire()
        self.assertEqual(self.path.stat().st_ino, inode)

    def test_crash_releases_lock_without_stale_pid_cleanup(self):
        owner = self.acquire()
        inode = self.path.stat().st_ino
        owner.kill()
        owner.wait(timeout=5)
        self.acquire()
        self.assertEqual(self.path.stat().st_ino, inode)

    def test_exec_does_not_inherit_lock(self):
        owner = self.acquire(exec_child=True)
        # cat echoing this line proves exec completed and its process is alive.
        self.send(owner)
        self.assertEqual(self.result(owner), "go")
        self.assertIsNone(owner.poll())
        self.acquire()

    def test_symlink_fails_closed(self):
        target = Path(self.directory.name) / "unrelated"
        target.write_text("preserve me")
        self.path.symlink_to(target)
        process = self.spawn()
        self.send(process)
        self.assertEqual(self.result(process), "error")
        self.assertEqual(process.wait(timeout=5), 1)
        self.assertEqual(target.read_text(), "preserve me")

    def test_app_claims_lock_before_creating_app_or_delegate(self):
        source = (ROOT / "hud/Sources/Kyber/main.swift").read_text()
        entry = source[source.rindex("\ndo {"):]
        self.assertLess(entry.index("try HUDInstanceLock()"), entry.index("NSApplication.shared"))
        self.assertLess(entry.index("try HUDInstanceLock()"), entry.index("AppDelegate()"))
        self.assertIn("withExtendedLifetime(instance)", entry)


if __name__ == "__main__":
    unittest.main()
