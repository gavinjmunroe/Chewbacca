#!/usr/bin/env python3
"""kit_snapshot.moved for a tool launched through the kit's `current` link.

2026-10-11: kyber-surfaces ran as ~/.chewbacca/kit/current/bin/kyber-surfaces
(ps), and its handover (9528874d) asked moved(Path(__file__)), which resolved
`current` again at check time and so always named the new snapshot: it never
saw the kit move. This runs a script through `current`, moves `current`, and
asks the script itself.

Run: python3 tests/test_kit_snapshot.py
"""
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


TOOL = """import sys, time
from pathlib import Path
sys.path.insert(0, {lib!r})
import kit_snapshot
print("up", flush=True)
go = Path({go!r})
while not go.exists():
    time.sleep(0.05)
print(kit_snapshot.moved(Path(__file__)), kit_snapshot.snapshot_of(Path(__file__)).name, flush=True)
"""


def main():
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        base, go = d / "kit", d / "go"
        for sha in ("aaaa", "bbbb"):
            (base / "snapshots" / sha / "bin").mkdir(parents=True)
            (base / "snapshots" / sha / "bin" / "tool").write_text(
                TOOL.format(lib=str(ROOT / "bin" / "lib"), go=str(go)))
        cur = base / "current"
        cur.symlink_to(base / "snapshots" / "aaaa")
        def started_then_moved(argv, cwd=None):
            """Start the tool, wait until it has imported kit_snapshot (a
            fixed sleep raced Python's start at load 50), move `current` to
            bbbb, then let it ask."""
            (base / "current").unlink()
            (base / "current").symlink_to(base / "snapshots" / "aaaa")
            if go.exists():
                go.unlink()
            proc = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, text=True)
            up = proc.stdout.readline().strip()
            cur.unlink()
            cur.symlink_to(base / "snapshots" / "bbbb")
            go.write_text("")
            return up, proc.communicate(timeout=60)[0].split()

        up, out = started_then_moved([sys.executable, str(cur / "bin" / "tool")])
        check("a tool started through `current` sees the kit move", up == "up" and out[:1] == ["True"], (up, out))
        check("and still knows it runs snapshot aaaa", out[1:2] == ["aaaa"], out)
        up, out = started_then_moved([sys.executable, "bin/tool"], cwd=str(cur))
        check("so does one started by hand with a relative path", out == ["True", "aaaa"], out)

        go.unlink()
        proc = subprocess.Popen([sys.executable, str(cur / "bin" / "tool")], stdout=subprocess.PIPE, text=True)
        go.write_text("")
        out = proc.communicate(timeout=60)[0].split()
        check("a tool on the current snapshot has not moved", out == ["up", "False", "bbbb"], out)

    sys.path.insert(0, str(ROOT / "bin" / "lib"))
    import kit_snapshot
    check("a checkout is no snapshot, so it never moves", not kit_snapshot.moved(ROOT / "bin" / "kyber-surfaces"))
    print(f"\n{'FAILED ' + str(failed) if failed else 'all passed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
