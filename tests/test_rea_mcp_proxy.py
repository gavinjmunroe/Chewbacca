"""chewbacca rea mcp: the server agents launch. A fake REA MCP server stands
in for the real one, so nothing is downloaded or analyzed. What must hold:

- a universal binary handed to open_binary reaches REA as one thinned slice,
  because Ghidra refuses universal Mach-O (every Mac app is one);
- no call outlives its deadline, a cancelled call gets only a short grace,
  and REA's whole process group dies with it, grandchildren included;
- the next call after a kill starts REA again and replays initialize;
- a proxy killed with SIGKILL still takes REA's group down (the reaper);
- the slice is cut without lipo, byte for byte, and a Java class file, which
  shares the 0xCAFEBABE magic, is never mistaken for a universal binary."""
import importlib.util
import json
import os
import select
import signal
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "rea_kit.py"

FAKE = r'''
import json, os, subprocess, sys, time
log = sys.argv[1]
for line in sys.stdin:
    m = json.loads(line)
    with open(log, "a") as f:
        f.write(json.dumps(m) + "\n")
    if "id" not in m:
        continue
    if m.get("method") == "initialize":
        r = {"protocolVersion": "2025-06-18", "capabilities": {}, "serverInfo": {"name": "fake", "version": "0"}}
    elif m["params"]["name"] == "slow":
        # One grandchild in REA's group, one leading its own group the way
        # REA starts Ghidra's JVM.
        p = subprocess.Popen(["sleep", "300"])
        q = subprocess.Popen(["sleep", "301"], start_new_session=True)
        with open(log + ".grandchild", "w") as f:
            f.write("%d %d" % (p.pid, q.pid))
        time.sleep(300)
        r = {}
    elif m["params"]["name"] == "crash":
        # REA dying on its own with Ghidra running (upstream #2269): the JVM
        # leads its own group and is orphaned the moment REA exits.
        q = subprocess.Popen(["sleep", "303"], start_new_session=True)
        with open(log + ".grandchild", "w") as f:
            f.write(str(q.pid))
        time.sleep(1.5)
        os._exit(3)
    else:
        r = {"content": [{"type": "text", "text": json.dumps(m["params"]["arguments"])}]}
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": r}) + "\n")
    sys.stdout.flush()
'''


def load(home: Path):
    os.environ["HOME"] = str(home)
    os.environ["REA_KIT_CACHE"] = str(home / "cache")
    os.environ["REA_KIT_CLAUDE"] = ""
    spec = importlib.util.spec_from_file_location("rea_kit", str(TOOL))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    st = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(st) and not st.startswith("Z")


def gone_within(pids, secs: float) -> bool:
    end = time.time() + secs
    while time.time() < end:
        if not any(alive(p) for p in pids):
            return True
        time.sleep(0.2)
    return False


def grandchildren(log: Path):
    return [int(x) for x in Path(str(log) + ".grandchild").read_text().split()]


def fat(slices):
    """A universal file of (cputype, subtype, payload) slices, 4 KB aligned."""
    head = struct.pack(">II", 0xCAFEBABE, len(slices))
    body, off = b"", 4096
    for cpu, sub, data in slices:
        head += struct.pack(">iiIII", cpu, sub, off, len(data), 12)
        off += 4096
    out = bytearray(head.ljust(4096, b"\0"))
    for _, _, data in slices:
        out += data.ljust(4096, b"\0")
    return bytes(out)


class Client:
    def __init__(self, home: Path, deadline: str, grace: str = "30", bin_: str = "fake-rea"):
        self.log = home / "fake.log"
        env = dict(os.environ, REA_KIT_BIN=str(home / bin_), REA_KIT_CALL_DEADLINE=deadline,
                   REA_KIT_CANCEL_GRACE=grace, REA_KIT_CACHE=str(home / "cache"), REA_KIT_SNAPSHOT="0.3")
        self.p = subprocess.Popen([sys.executable, str(TOOL), "mcp"], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, env=env)
        self.n = 0

    def send(self, msg):
        self.p.stdin.write((json.dumps(msg) + "\n").encode())
        self.p.stdin.flush()

    def call(self, name=None, args=None, method="tools/call", wait=20):
        self.n += 1
        params = {"name": name, "arguments": args or {}} if method == "tools/call" else {
            "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}
        self.send({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params})
        return self.n if wait == 0 else self.read(self.n, wait)

    def read(self, rid, wait):
        end = time.time() + wait
        while time.time() < end:
            if select.select([self.p.stdout], [], [], 0.2)[0]:
                m = json.loads(self.p.stdout.readline())
                if m.get("id") == rid:
                    return m
        raise AssertionError("no answer to %s in %ss" % (rid, wait))

    def inits(self):
        return sum(1 for l in self.log.read_text().splitlines() if json.loads(l).get("method") == "initialize")


def main() -> int:
    with tempfile.TemporaryDirectory() as d:
        home = Path(d)
        rk = load(home)
        fake = home / "fake-rea"
        fake.write_text("#!/bin/sh\nexec %s -c '%s' %s\n" % (sys.executable, FAKE.replace("'", "'\\''"),
                                                             home / "fake.log"))
        fake.chmod(0o755)

        # 1. Slices without lipo: the arm64 slice, byte for byte; a class file is not universal.
        uni = home / "Uni"
        uni.write_bytes(fat([(0x01000007, 3, b"X86-SLICE"), (0x0100000C, 0, b"ARM-SLICE")]))
        assert rk.archs(uni) == ["x86_64", "arm64"], rk.archs(uni)
        cls = home / "A.class"
        cls.write_bytes(struct.pack(">IHH", 0xCAFEBABE, 0, 52) + b"\0" * 64)
        assert rk.fat_slices(cls) == [] and rk.thin(cls) == cls
        sliced = Path(rk.thin_target(str(uni)))
        want = "ARM-SLICE" if rk.pick_arch(["x86_64", "arm64"]) == "arm64" else "X86-SLICE"
        assert sliced.read_bytes() == want.encode(), sliced.read_bytes()[:16]
        app = home / "Thing.app"
        (app / "Contents" / "MacOS").mkdir(parents=True)
        (app / "Contents" / "Info.plist").write_bytes(
            b'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key>'
            b'<string>Thing</string></dict></plist>')
        (app / "Contents" / "MacOS" / "Thing").write_bytes(uni.read_bytes())
        assert Path(rk.thin_target(str(app))).read_bytes() == sliced.read_bytes()
        assert rk.thin_target("/no/such/file") == "/no/such/file"

        # 2. open_binary reaches REA thinned; other tools and thin files pass untouched.
        c = Client(home, deadline="2", grace="1")
        assert "result" in c.call(method="initialize")
        c.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        r = c.call("open_binary", {"path": str(app)})
        got = json.loads(r["result"]["content"][0]["text"])["path"]
        assert got != str(app) and Path(got).read_bytes() == sliced.read_bytes(), got
        r = c.call("open_binary", {"path": str(cls)})
        assert json.loads(r["result"]["content"][0]["text"])["path"] == str(cls), r
        r = c.call("inspect_signature", {"path": str(uni)})
        assert json.loads(r["result"]["content"][0]["text"])["path"] == str(uni), r

        # 3. A call past its deadline errors, and REA's group dies, grandchild too.
        t0 = time.time()
        r = c.call("slow", wait=15)
        assert "deadline" in r["error"]["message"] and time.time() - t0 < 10, r
        gpids = grandchildren(c.log)
        assert gone_within(gpids, 5), "grandchildren %s survived the deadline" % gpids

        # 4. The next call starts REA again and replays initialize first.
        r = c.call("open_binary", {"path": str(cls)})
        assert "result" in r and c.inits() == 2, (r, c.inits())

        # 5. A cancelled call is killed after the grace, not the full deadline.
        c.p.stdin.close()
        c.p.wait(timeout=10)
        c = Client(home, deadline="60", grace="1")
        c.call(method="initialize")
        rid = c.call("slow", wait=0)
        time.sleep(0.5)
        c.send({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": rid}})
        t0 = time.time()
        r = c.read(rid, 15)
        assert "error" in r and time.time() - t0 < 8, r

        # 6. The agent closing stdin stops REA's group.
        c.call("slow", wait=0)
        time.sleep(1)
        gpids = grandchildren(c.log)
        c.p.stdin.close()
        c.p.wait(timeout=10)
        assert gone_within(gpids, 5), "grandchildren %s outlived the agent" % gpids

        # 7. A proxy killed with SIGKILL runs no cleanup; the reaper does it.
        c = Client(home, deadline="60")
        c.call(method="initialize")
        c.call("slow", wait=0)
        time.sleep(1)
        gpids = grandchildren(c.log)
        os.kill(c.p.pid, signal.SIGKILL)
        c.p.wait()
        assert gone_within(gpids, 8), "grandchildren %s outlived a SIGKILLed proxy" % gpids

        # 7b. The CLI path too: run_rea's deadline reaches a grandchild leading its own group.
        cli = home / "fake-cli"
        detach = ('import subprocess; q = subprocess.Popen(["sleep", "302"], start_new_session=True); '
                  'open("%s", "w").write(str(q.pid)); q.wait()' % (home / "cli.pid"))
        cli.write_text("#!/bin/sh\n%s -c '%s'\nsleep 300\n" % (sys.executable, detach))
        cli.chmod(0o755)
        os.environ["REA_KIT_BIN"] = str(cli)
        res = rk.run_rea(["analyze", "x"], home / "cli.json", deadline=1.5)
        qpid = int((home / "cli.pid").read_text())
        assert res["code"] == "deadline" and gone_within([qpid], 5), (res, qpid)

        # 7c. REA exiting by itself: the open call gets an error, the JVM it
        # orphaned dies too, and the next request starts a fresh REA.
        c = Client(home, deadline="60")
        c.call(method="initialize")
        t0 = time.time()
        r = c.call("crash", wait=15)
        assert "exited" in r["error"]["message"] and time.time() - t0 < 10, r
        gpids = grandchildren(c.log)
        assert gone_within(gpids, 5), "orphan %s outlived REA's own exit" % gpids
        assert "result" in c.call("open_binary", {"path": str(cls)})

        # 7d. A notification while REA is down boots nothing; a request does.
        c.p.stdin.close()
        c.p.wait(timeout=10)
        c = Client(home, deadline="1")
        c.call(method="initialize")
        c.call("slow", wait=15)
        before = c.inits()
        c.send({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": c.n}})
        time.sleep(1)
        assert c.inits() == before, "a notification restarted REA"
        assert "result" in c.call("open_binary", {"path": str(cls)}) and c.inits() == before + 1
        c.p.stdin.close()
        c.p.wait(timeout=10)

        # 7e. REA that can't start answers the call with an error; the proxy stays up.
        c = Client(home, deadline="60", bin_="no-such-rea")
        r = c.call(method="initialize")
        assert "could not start" in r["error"]["message"], r
        assert c.p.poll() is None, "proxy died when REA couldn't start"
        c.p.stdin.close()
        c.p.wait(timeout=10)

        # 7f. A request landing mid-kill waits for the kill, then gets a fresh
        # REA whose reaper and lifeline the old kill can't touch, and only the
        # killed call gets an error (the race review found: 2026-10-13).
        import io
        import threading
        real_kill_tree = rk.kill_tree
        rk.kill_tree = lambda g, known=None: (real_kill_tree(g, known), time.sleep(1.0))[0]
        out = io.BytesIO()
        px = rk.Proxy([sys.executable, "-c", "import sys\nfor l in sys.stdin: pass"], {}, out=out)
        px.handle(b'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n')
        k = threading.Thread(target=px.kill, args=("deadline",))
        k.start()
        time.sleep(0.3)
        px.handle(b'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"x"}}\n')
        k.join()
        proc, reaper, lifeline = px.child
        assert proc.poll() is None and reaper.poll() is None, "the new REA or its reaper was killed"
        os.fstat(lifeline)
        assert [json.loads(l)["id"] for l in out.getvalue().splitlines()] == [1], out.getvalue()
        px.done = True
        px.kill("bye")
        rk.kill_tree = real_kill_tree

        # 8. The pinned local copy boots before npx, and only at the pinned version.
        os.environ.pop("REA_KIT_BIN", None)
        pkg = rk.LOCAL_SCRIPT.parent.parent
        pkg.mkdir(parents=True)
        (pkg / "package.json").write_text(json.dumps({"version": rk.PIN}))
        assert rk.rea_cmd()[1:] == [str(rk.LOCAL_SCRIPT)], rk.rea_cmd()
        (pkg / "package.json").write_text(json.dumps({"version": "0.0.1"}))
        assert rk.rea_cmd()[0] == "npx", rk.rea_cmd()

        # 9. Codex: command and args point at the proxy, the call limit covers
        # a long import, and every other key and table survives byte for byte.
        entry = {"command": "/usr/bin/python3", "args": ["/k/tools/rea_kit.py", "mcp", "--node", "/n"]}
        text = ('[mcp_servers.a]\ncommand = "a"\n\n[mcp_servers.rea]  # REA\ncommand = "npx"\n'
                'args = [\n  "-y",\n  "rea-agents@6.4.0",\n  "mcp",\n]\nstartup_timeout_sec = 30\n'
                'tool_timeout_sec = 60\n\n[mcp_servers.rea.env]\nGHIDRA_INSTALL_DIR = "/g"\nMINE = "1"\n\n'
                '[projects."/x"]\ntrust_level = "trusted"\n')
        out = rk.codex_rewrite(text, entry)
        assert "npx" not in out and "rea-agents" not in out, out
        assert 'args = [ "/k/tools/rea_kit.py", "mcp", "--node", "/n" ]' in out, out
        assert "startup_timeout_sec = 30" in out and "tool_timeout_sec = %d" % rk.TOOL_TIMEOUT in out, out
        assert rk.TOOL_TIMEOUT > rk.CALL_DEADLINE and "tool_timeout_sec = 60" not in out, out
        assert '[mcp_servers.rea.env]\nGHIDRA_INSTALL_DIR = "/g"\nMINE = "1"\n' in out, out
        assert out.startswith('[mcp_servers.a]\ncommand = "a"\n\n[mcp_servers.rea]  # REA\n'), out
        assert out.endswith('[projects."/x"]\ntrust_level = "trusted"\n'), out
        assert rk.codex_rewrite(out, entry) == out
        crlf = text.replace("\n", "\r\n")
        assert rk.codex_rewrite(crlf, entry).count("[mcp_servers.rea]") == 1
        assert "\r\ncommand = \"/usr/bin/python3\"\r\n" in rk.codex_rewrite(crlf, entry)
        for odd in ('[mcp_servers]\nrea = { command = "npx" }\n', 'mcp_servers.rea.command = "npx"\n'):
            try:
                rk.codex_rewrite(odd, entry)
                raise AssertionError("appended a second rea next to %r" % odd)
            except ValueError:
                pass
        fresh = rk.codex_rewrite('[mcp_servers.a]\ncommand = "a"\n', entry)
        assert fresh.count("[mcp_servers.rea]") == 1 and "tool_timeout_sec" in fresh, fresh
        assert rk.mcp_entry()["args"][1:3] == ["mcp", "--node"], rk.mcp_entry()
    print("rea mcp: thinned, deadlined, cancelled, reaped, pinned")
    return 0


if __name__ == "__main__":
    sys.exit(main())
