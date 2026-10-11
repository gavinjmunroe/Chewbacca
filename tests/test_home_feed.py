#!/usr/bin/env python3
"""The desktop home panel's feed (bin/lib/home_feed.py): which repositories
count as projects he is working on, and the file the panel reads.

Throwaway git repositories under a temp home; nothing real is read, and the
person's own git config never decides a test (every commit names its author).
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bin" / "lib"))
sys.path.insert(0, str(ROOT / "tests"))
import home_feed  # noqa: E402
import osgraph  # noqa: E402

failed = 0
ME_EMAIL = "me@example.test"


def check(name, ok, got=None):
    global failed
    print(("ok  " if ok else "FAIL") + f" {name}" + ("" if ok else f"  got {got!r}"))
    failed += 0 if ok else 1


def commit(repo: Path, subject: str, when: datetime, email: str = ME_EMAIL) -> None:
    repo.mkdir(parents=True, exist_ok=True)
    if not (repo / ".git").exists():
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
    (repo / "f.txt").write_text(f"{subject}\n{when.isoformat()}\n")
    stamp = when.strftime("%Y-%m-%dT%H:%M:%S%z")
    env = {**os.environ, "GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp,
           "GIT_AUTHOR_NAME": "T", "GIT_COMMITTER_NAME": "T",
           "GIT_AUTHOR_EMAIL": email, "GIT_COMMITTER_EMAIL": email}
    git = ["git", "-C", str(repo), "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"]
    subprocess.run([*git, "add", "f.txt"], check=True, env=env)
    subprocess.run([*git, "commit", "-q", "-m", subject], check=True, env=env)


def projects(tmp: Path) -> None:
    now = datetime.now(timezone.utc)
    home = tmp / "home"
    dev = home / "dev"
    commit(dev / "firm-foundation", "feat: fix the audit promise", now - timedelta(hours=10))
    commit(dev / "oakleysarshar0", "fix(round3): shorter hooks", now - timedelta(days=2))
    # Only someone else's commits: a fork that took upstream's merges.
    commit(dev / "weft", "Merge upstream", now - timedelta(hours=1), email="them@example.test")
    # Only a nightly job's upkeep.
    commit(dev / "loyola-studio", "chore: nightly brain run", now - timedelta(hours=3))
    # His, but outside the window.
    commit(dev / "old-thing", "feat: last touched a month ago", now - timedelta(days=30))
    commit(dev / "gavin-context", "memory: a note", now - timedelta(minutes=5))
    # A worktree's `.git` is a file: a second checkout, never its own project.
    (dev / "wt-copy").mkdir(parents=True)
    (dev / "wt-copy" / ".git").write_text("gitdir: /nowhere\n")
    config = {"projects": {"roots": ["~/dev"], "hide": ["gavin-context"],
                           "names": {"oakleysarshar0": "Oakley"}}}

    rows = home_feed.projects(now, home, config, email=ME_EMAIL, most=10)
    titles = [r["title"] for r in rows]
    check("his recent repos are projects, newest first", titles[:2] == ["Firm Foundation", "Oakley"], titles)
    check("a repo with only someone else's commits is not his project", "Weft" not in titles, titles)
    check("a repo whose only recent commits are chores is not", "Loyola Studio" not in titles, titles)
    check("a repo untouched for a month is not", "Old Thing" not in titles, titles)
    check("a hidden repo stays hidden", "Gavin Context" not in titles, titles)
    check("a worktree is not a second project", "Wt Copy" not in titles, titles)
    first = rows[0] if rows else {}
    check("the detail is the last subject without its conventional prefix",
          first.get("detail") == "Fix the audit promise", first)
    check("a project row carries its folder and a repo: id",
          first.get("path") == str(dev / "firm-foundation") and first.get("id", "").startswith("repo:"), first)
    check("the row count is capped", len(home_feed.projects(now, home, config, email=ME_EMAIL, most=1)) == 1)
    check("a root that does not exist is skipped, not an error",
          home_feed.projects(now, home, {"projects": {"roots": ["~/nope"]}}, email=ME_EMAIL) == [])


def feed_file(tmp: Path) -> None:
    g = osgraph.Graph(str(tmp / "g.sqlite"))
    now = datetime.now(timezone.utc)
    rows = [{"id": "repo:/x", "title": "X", "detail": "", "at": now.isoformat(), "path": "/x"}]
    body = home_feed.build(g, now, rows, {"calendar": "mac calendar failed", "mail": "no access"})
    check("the feed names the sources that failed", body["failed"] == ["calendar", "mail"], body["failed"])
    check("the feed carries the projects it was handed", body["projects"] == rows)
    check("an empty graph is empty lists, not missing keys",
          body["calendar"] == [] and body["todos"] == [] and body["people"] == [], body)
    path = tmp / "bob" / "home-panel.json"
    home_feed.write(body, path)
    mode = stat.S_IMODE(path.stat().st_mode)
    check("the feed file is owner-only: it holds names and the last line of texts", mode == 0o600, oct(mode))
    check("the feed file is the body, as JSON", json.loads(path.read_text())["projects"] == rows)
    check("no temp file is left beside it", sorted(p.name for p in path.parent.iterdir()) == ["home-panel.json"])
    if shutil.which("tmutil") and not os.environ.get("KYBER_OS_GRAPH_NO_TM"):
        done = subprocess.run(["tmutil", "isexcluded", str(path)], capture_output=True, text=True)
        check("the feed is out of Time Machine, like the graph, after the rename",
              "[Excluded]" in done.stdout, done.stdout.strip())
    stamped = home_feed.build(g, now, [], written=now - timedelta(hours=2))
    check("a feed read from an old graph carries the graph's age, not now",
          stamped["at"] == (now - timedelta(hours=2)).isoformat(), stamped["at"])
    g.db.close()


def refresh_command(tmp: Path) -> None:
    """`kyber-surfaces home --write`, which Kyber runs when the feed is stale."""
    env = {**os.environ, "BOB_DIR": str(tmp / "bob"), "KYBER_OS_GRAPH": str(tmp / "graph.sqlite"),
           "KYBER_OS_GRAPH_NO_TM": "1", "HOME": str(tmp / "home")}
    run = [sys.executable, str(ROOT / "bin" / "kyber-surfaces"), "home", "--write"]
    done = subprocess.run(run, env=env, capture_output=True, text=True, timeout=60)
    check("with no graph yet it writes nothing and makes no graph",
          done.returncode == 1 and not (tmp / "graph.sqlite").exists() and not (tmp / "bob").exists(),
          (done.returncode, done.stderr[-200:]))
    g = osgraph.Graph(str(tmp / "graph.sqlite"))
    g.db.close()
    feed = tmp / "bob" / "home-panel.json"
    feed.parent.mkdir(parents=True)
    feed.write_text(json.dumps({"failed": ["calendar"]}))
    old = datetime.now().timestamp() - 3600
    for p in tmp.glob("graph.sqlite*"):
        os.utime(p, (old, old))
    done = subprocess.run(run, env=env, capture_output=True, text=True, timeout=60)
    body = json.loads(feed.read_text()) if feed.exists() else {}
    check("a refresh keeps the sources the daemon last could not read", body.get("failed") == ["calendar"],
          (done.returncode, done.stderr[-300:], body.get("failed")))
    age = datetime.now(timezone.utc) - datetime.fromisoformat(body.get("at", "2000-01-01T00:00:00+00:00"))
    check("a refresh is stamped with when the graph was written", timedelta(minutes=55) < age < timedelta(minutes=65),
          body.get("at"))


def main() -> int:
    with tempfile.TemporaryDirectory() as d:
        projects(Path(d))
    with tempfile.TemporaryDirectory() as d:
        feed_file(Path(d))
    with tempfile.TemporaryDirectory() as d:
        refresh_command(Path(d))
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
