"""tools/hooks_sync.py sorts live hooks against a ref and writes only what a
scan called stale or missing (and local, when asked), with backups."""
import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("hooks_sync", ROOT / "tools" / "hooks_sync.py")
hs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hs)

FAILS = 0


def check(name, ok, detail=""):
    global FAILS
    FAILS += not ok
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}{'' if ok else f'  got {detail}'}")


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@t", *args],
                   check=True, capture_output=True)


def main() -> int:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        repo, live, backups = tmp / "repo", tmp / "live", tmp / "backups"
        hooks = repo / ".claude" / "hooks"
        hooks.mkdir(parents=True)
        git(tmp, "init", "-q", "-b", "main", str(repo))
        (hooks / "a.sh").write_text("echo a1\n")
        (hooks / "c.sh").write_text("echo c1\n")
        (hooks / "d.sh").write_text("echo d1\n")
        (hooks / "notes.md").write_text("not a hook\n")
        git(repo, "add", "."); git(repo, "commit", "-qm", "v1")
        (hooks / "a.sh").write_text("echo a2\n")
        (hooks / "b.sh").write_text("echo b\n")
        (hooks / "c.sh").write_text("echo c2\n")
        git(repo, "add", "."); git(repo, "commit", "-qm", "v2")

        live.mkdir()
        (live / "a.sh").write_text("echo a1\n")            # an older kit version
        (live / "c.sh").write_text("echo c-edited-live\n")  # matches nothing stored
        (live / "d.sh").write_text("echo d1\n")            # current
        (live / "mine.sh").write_text("echo mine\n")        # not the kit's at all

        states = {r["name"]: r["state"] for r in hs.scan(repo, live, "main")}
        check("stale, missing, local and current are told apart",
              states == {"a.sh": "stale", "b.sh": "missing", "c.sh": "local", "d.sh": "current"}, states)

        before = {p.name: p.read_text() for p in live.iterdir()}
        hs.scan(repo, live, "main")
        check("a scan writes nothing", before == {p.name: p.read_text() for p in live.iterdir()})

        rows = hs.scan(repo, live, "main")
        done = {r["name"] for r in hs.apply(repo, live, rows, backups)}
        check("apply updates only stale and missing", done == {"a.sh", "b.sh"}, done)
        check("the stale copy is now the ref's", (live / "a.sh").read_text() == "echo a2\n")
        check("the missing hook is installed and executable",
              (live / "b.sh").read_text() == "echo b\n" and (live / "b.sh").stat().st_mode & 0o111)
        check("a live edit is left alone by default", (live / "c.sh").read_text() == "echo c-edited-live\n")
        check("a file the kit doesn't ship is never touched", (live / "mine.sh").read_text() == "echo mine\n")
        saved = list(backups.glob("hooks-backup-*/a.sh"))
        check("the overwritten copy is backed up", len(saved) == 1 and saved[0].read_text() == "echo a1\n")

        rows = hs.scan(repo, live, "main")
        done = {r["name"] for r in hs.apply(repo, live, rows, backups, include_local=True)}
        check("--include-local replaces the unmatched copy", done == {"c.sh"} and
              (live / "c.sh").read_text() == "echo c2\n", done)
        check("and backs it up first",
              any(p.read_text() == "echo c-edited-live\n" for p in backups.glob("hooks-backup-*/c.sh")))

        check("a second run has nothing to do",
              all(r["state"] == "current" for r in hs.scan(repo, live, "main")))
    print(f"hooks-sync: {'ok' if not FAILS else f'{FAILS} failed'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
