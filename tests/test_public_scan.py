#!/usr/bin/env python3
"""public_scan: personal content in a repo and its history, listed, never changed.

A temp repo with a fake people store: a name, a phone and an email at the
tip, a health line and a memory note only in a deleted file's history, and a
key-shaped string. Every value is synthetic (555 numbers, example names).
Run: python3 tests/test_public_scan.py
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "public_scan.py"
failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


tmp = Path(tempfile.mkdtemp(prefix="public-scan-"))
origin, repo, out = tmp / "origin.git", tmp / "repo", tmp / "out"
env = dict(os.environ, GIT_AUTHOR_NAME="Ada Owner", GIT_AUTHOR_EMAIL="ada@ownermail.com",
           GIT_COMMITTER_NAME="Ada Owner", GIT_COMMITTER_EMAIL="ada@example.com", HOME=str(tmp))


def git(*a, cwd=repo):
    return subprocess.run(["git", *a], cwd=cwd, env=env, capture_output=True, text=True, check=True).stdout


subprocess.run(["git", "init", "-q", "--bare", str(origin)], check=True, env=env)
subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True, env=env)
git("config", "user.name", "Ada Owner")
(repo / "README.md").write_text("Built by Ada Owner. Ask Bobby Example, 310-555-0142, bobby@example.org\n")
(repo / "notes").mkdir()
(repo / "notes" / "old.md").write_text("---\nname: x\nmetadata:\n  type: user\n---\nHe was hospitalized in March.\n")
(repo / "config.txt").write_text("key = AKIAABCDEFGHIJKLMNOP\nsupport@acme.com is fine\n")
git("add", "-A")
git("commit", "-q", "-m", "first")
# A conflict resolved in a merge: the resolved text exists only in the merge.
git("checkout", "-q", "-b", "side")
(repo / "merge.txt").write_text("side\n")
git("add", "merge.txt")
git("commit", "-q", "-m", "side")
git("checkout", "-q", "main")
(repo / "merge.txt").write_text("main\n")
git("add", "merge.txt")
git("commit", "-q", "-m", "main")
subprocess.run(["git", "merge", "-q", "side"], cwd=repo, env=env, capture_output=True)
(repo / "merge.txt").write_text("resolved: she was diagnosed in May\n")
git("add", "merge.txt")
git("commit", "-q", "--no-edit")
(repo / "merge.txt").write_text("clean now\n")
(repo / "dump.json").write_text('{"to": "3105550142"}\n{"to": "(310)555-0142"}\n{"id": "4105550199"}\n')
git("add", "merge.txt", "dump.json")
git("commit", "-q", "-m", "clean the merge")
subprocess.run(["git", "commit", "-q", "--allow-empty", "-m", "rebased"], cwd=repo, check=True,
               env=dict(env, GIT_COMMITTER_NAME="Ada Owner", GIT_COMMITTER_EMAIL="ada.personal@ownermail.com"))
git("rm", "-q", "notes/old.md")
git("commit", "-q", "-m", "drop the note Bobby asked about, 310-555-0142")
git("remote", "add", "origin", str(origin))
git("push", "-q", "origin", "main")
git("fetch", "-q", "origin")

db = tmp / "people.db"
con = sqlite3.connect(db)
con.execute("create table people (name text, phone text, email text, deleted_at text)")
con.executemany("insert into people values (?,?,?,null)", [
    ("Bobby Example", "+1 (310) 555-0142", "bobby@example.org"),
    ("Ada Owner", "", ""),
    ("Cher", "", ""),
])
con.commit()
con.close()

before_status = git("status", "--porcelain")
before_refs = git("for-each-ref")
done = subprocess.run([sys.executable, str(TOOL), "--repo", str(repo), "--out", str(out), "--people-db", str(db),
                       "--coursework", str(tmp / "none"), "--json"], capture_output=True, text=True, env=env)
check("it runs", done.returncode == 0, done.stderr[-400:])
hits = [json.loads(line) for line in (out / "hits.jsonl").read_text().splitlines()] if (out / "hits.jsonl").exists() else []


def has(kind, where=None, path=None, sev=None):
    return any(h["kind"] == kind and (where is None or h["where"] == where) and (path is None or h["path"] == path)
               and (sev is None or h["severity"] == sev) for h in hits)


check("a full name from the people store, at the tip", has("person", "tip", "README.md", "high"), hits)
check("a store phone, masked to its last four", any(h["kind"] == "phone" and h["found"].endswith("0142")
                                                    and "310" not in h["found"] for h in hits), hits)
check("a store email, masked", any(h["kind"] == "email" and h["found"] == "b***@example.org" for h in hits))
check("a health line that exists only in history, with its commit",
      any(h["kind"] == "health" and h["where"] == "history" and h["path"] == "notes/old.md" and len(h["commit"]) == 40
          for h in hits), [h for h in hits if h["kind"] == "health"])
check("a memory note in history", has("brain", "history", "notes/old.md"))
check("a key-shaped string, cut short", any(h["kind"] == "secret" and h["found"] == "AKIAABCD..." for h in hits))
check("the owner's own name is counted apart, never as a person", has("owner") and not any(
    h["kind"] == "person" and h["found"] == "Ada Owner" for h in hits))
check("a one-word name is not a person", not any(h["found"] == "Cher" for h in hits))
check("a role address is not personal", not any("acme" in h["found"] for h in hits if h["kind"] == "email"))
summary = (out / "SUMMARY.md").read_text() if (out / "SUMMARY.md").exists() else ""
check("the summary names files and commits", "notes/old.md" in summary and "commit " in summary, summary[:300])
check("the findings are private", oct(out.stat().st_mode & 0o777) == "0o700"
      and oct((out / "hits.jsonl").stat().st_mode & 0o777) == "0o600")
check("the repo is untouched: no file, no ref", git("status", "--porcelain") == before_status
      and git("for-each-ref") == before_refs)
inside = subprocess.run([sys.executable, str(TOOL), "--repo", str(repo), "--out", str(repo / "scan")],
                        capture_output=True, text=True, env=env)
check("an author address that isn't a noreply is listed",
      any(h["kind"] == "author" and h["found"] == "Ada Owner <a***@ownermail.com>" for h in hits), [h for h in hits if h["kind"] == "author"])
check("a commit message is read too",
      any(h["path"] == "(commit message)" and h["kind"] == "phone" for h in hits), [h for h in hits if h["path"] == "(commit message)"])
check("a file resolved in a merge commit is read",
      any(h["kind"] == "health" and h["path"] == "merge.txt" for h in hits), [h for h in hits if h["path"] == "merge.txt"])
check("a store phone with no separators is found, an unknown digit run is not",
      sum(1 for h in hits if h["path"] == "dump.json" and h["kind"] == "phone") == 2
      and not any("0199" in h["found"] for h in hits), [h for h in hits if h["path"] == "dump.json"])
check("a committer address is listed too",
      any(h["kind"] == "author" and "a***@ownermail.com" in h["found"] and "Ada Owner" in h["found"]
          and h["found"].startswith("Ada Owner <a***") for h in hits)
      and any("ada.personal" not in h["found"] and h["kind"] == "author" for h in hits)
      and len([h for h in hits if h["kind"] == "author"]) >= 2, [h for h in hits if h["kind"] == "author"])
busy = tmp / "busy"
busy.mkdir()
(busy / "mine.txt").write_text("x")
refused = subprocess.run([sys.executable, str(TOOL), "--repo", str(repo), "--out", str(busy), "--people-db", str(db)],
                         capture_output=True, text=True, env=env)
check("a folder holding other files is never locked down or written",
      refused.returncode == 2 and oct(busy.stat().st_mode & 0o777) != "0o700" and not (busy / "hits.jsonl").exists())
check("findings are never written inside the repo", inside.returncode == 2 and not (repo / "scan").exists())

import shutil  # noqa: E402
shutil.rmtree(tmp, ignore_errors=True)
print(f"\n{'all passed' if not failed else f'{failed} failed'}")
sys.exit(1 if failed else 0)
