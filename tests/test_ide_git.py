#!/usr/bin/env python3
"""ide_git: one hunk kept or rejected byte for byte, in a real checkout.

What is held here: a reject puts back exactly the hunk's old bytes, including
a last line with no newline and CRLF line endings; a file whose lines moved
under a hunk is left alone; a Keep stages one hunk and nothing else; a repo
filter driver never runs on any call here; a backup is a byte copy, and
Undo refuses once the file moved on.
Run: python3 tests/test_ide_git.py
"""
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin" / "lib"))
import ide_git  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"\n     got: {got!r}"))
    failed += 0 if ok else 1


def repo(path: Path, files: dict) -> ide_git.Git:
    path.mkdir(parents=True)
    for name, body in files.items():
        (path / name).write_bytes(body)
    for argv in (["init", "-q", "-b", "main"], ["add", "-A"],
                 ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "start"]):
        subprocess.run(["git", "-C", str(path), *argv], check=True, capture_output=True)
    return ide_git.Git(str(path))


def main() -> int:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        backups = tmp / "backups"
        # A last line with no newline, changed by the agent.
        g = repo(tmp / "eol", {"a.txt": b"one\ntwo\nthree"})
        (tmp / "eol" / "a.txt").write_bytes(b"one\ntwo\nTHREE\nfour")
        head, hunks = ide_git.file_hunks(g, "a.txt")
        w, why = ide_git.reject_hunk(tmp / "eol" / "a.txt", hunks[0], backups)
        check("reject restores a last line that had no newline, exactly",
              w is not None and (tmp / "eol" / "a.txt").read_bytes() == b"one\ntwo\nthree", why)
        check("the backup is the agent's bytes", w and Path(w.backup).read_bytes() == b"one\ntwo\nTHREE\nfour")
        ok, why = ide_git.put_back(w)
        check("undo puts the agent's bytes back", ok and (tmp / "eol" / "a.txt").read_bytes()
              == b"one\ntwo\nTHREE\nfour", why)
        ok, why = ide_git.put_back(w)
        check("a second undo over a file it no longer matches leaves it alone", not ok and "left alone" in why)
        # CRLF content, as the bytes are on disk.
        g = repo(tmp / "crlf", {"w.txt": b"a\r\nb\r\nc\r\n"})
        (tmp / "crlf" / "w.txt").write_bytes(b"a\r\nB\r\nc\r\n")
        head, hunks = ide_git.file_hunks(g, "w.txt")
        w, why = ide_git.reject_hunk(tmp / "crlf" / "w.txt", hunks[0], backups)
        check("reject keeps CRLF line endings", w is not None and (tmp / "crlf" / "w.txt").read_bytes()
              == b"a\r\nb\r\nc\r\n", why)
        # Two hunks; stage only the second.
        body = b"".join(b"%d\n" % i for i in range(40))
        g = repo(tmp / "two", {"n.txt": body})
        new = body.replace(b"\n2\n", b"\nTWO\n").replace(b"\n30\n", b"\nTHIRTY\n")
        (tmp / "two" / "n.txt").write_bytes(new)
        head, hunks = ide_git.file_hunks(g, "n.txt")
        ok, why = ide_git.stage_hunk(g, head, hunks[1])
        cached = subprocess.run(["git", "-C", str(tmp / "two"), "diff", "--cached"], capture_output=True,
                                text=True).stdout
        check("keep stages one hunk only, file untouched", ok and "+THIRTY" in cached and "TWO" not in cached
              and (tmp / "two" / "n.txt").read_bytes() == new, (why, cached))
        ok, why = ide_git.stage_hunk(g, head, hunks[1], reverse=True)
        cached = subprocess.run(["git", "-C", str(tmp / "two"), "diff", "--cached"], capture_output=True,
                                text=True).stdout
        check("the same patch reversed takes it back out", ok and cached == "", (why, cached))
        # Lines moved under a hunk: refused, file left alone.
        (tmp / "two" / "n.txt").write_bytes(b"inserted\n" + new)
        w, why = ide_git.reject_hunk(tmp / "two" / "n.txt", hunks[0], backups)
        check("a hunk whose lines moved is refused and the file left alone",
              w is None and "changed" in why and (tmp / "two" / "n.txt").read_bytes() == b"inserted\n" + new)
        # A filter driver in the repo's own config never runs.
        g = repo(tmp / "pwn", {"f.txt": b"x\n", ".gitattributes": b"* filter=pwn diff=pwn\n"})
        mark = tmp / "pwned"
        subprocess.run(["git", "-C", str(tmp / "pwn"), "config", "filter.pwn.clean", f"touch {mark}; cat"], check=True)
        subprocess.run(["git", "-C", str(tmp / "pwn"), "config", "diff.pwn.textconv", f"touch {mark}; cat"],
                       check=True)
        (tmp / "pwn" / "f.txt").write_bytes(b"y\n")
        head, hunks = ide_git.file_hunks(ide_git.Git(str(tmp / "pwn")), "f.txt")
        ide_git.stage_hunk(ide_git.Git(str(tmp / "pwn")), head, hunks[0])
        check("a repo's own filter and textconv never run", not mark.exists() and hunks)
        # Backups past the kept count are dropped, oldest first.
        f = tmp / "k.txt"
        f.write_bytes(b"k")
        for _ in range(ide_git.KEPT_BACKUPS + 3):
            ide_git.keep_copy(f, b"k", tmp / "kept")
        check("backups of one name stop at the kept count",
              len(list((tmp / "kept").iterdir())) == ide_git.KEPT_BACKUPS)
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
