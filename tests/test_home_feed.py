#!/usr/bin/env python3
"""The desktop home panel's feed (bin/lib/home_feed.py): which repositories
count as projects he is working on, the to-dos crossed off on the panel, and
the file the panel reads.

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
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bin" / "lib"))
sys.path.insert(0, str(ROOT / "tests"))
import home_feed  # noqa: E402
import osgraph  # noqa: E402
from osgraph import Edge, Node  # noqa: E402

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


def pinned(tmp: Path) -> None:
    """His own list of five, in his order, each from one or more repos."""
    now = datetime.now(timezone.utc)
    home = tmp / "home"
    dev = home / "dev"
    commit(dev / "content-brain", "research: what to rebuild", now - timedelta(days=9))
    commit(dev / "oakley", "feat: round 3 ideas", now - timedelta(hours=20))
    commit(dev / "noah", "feat: the first 30 days", now - timedelta(days=2))
    commit(dev / "studio", "chore: nightly brain run", now - timedelta(hours=1))
    commit(dev / "firm", "fix: the demo reply", now - timedelta(days=40))
    config = {"projects": {"roots": ["~/dev"], "pinned": [
        {"title": "Social media consult", "paths": ["~/dev/content-brain", "~/dev/oakley", "~/dev/noah"]},
        {"title": "Music prod agent", "paths": ["~/dev/studio"]},
        {"title": "Firm Foundation", "path": "~/dev/firm"},
        {"title": "Gone", "paths": ["~/dev/never-cloned"]},
        {"paths": ["~/dev/firm"]},
    ]}}
    rows = home_feed.projects(now, home, config, email=ME_EMAIL)
    check("pinned projects come in his order, not by recency, and untitled ones are skipped",
          [r["title"] for r in rows] == ["Social media consult", "Music prod agent", "Firm Foundation", "Gone"],
          [r["title"] for r in rows])
    social = rows[0]
    check("a project over several repos shows and opens the newest commit across them",
          social["detail"] == "Round 3 ideas" and social["path"] == str(dev / "oakley"), social)
    check("a pinned project shows however long ago its last commit was",
          rows[2]["detail"] == "The demo reply", rows[2])
    check("a pinned project with only chores still shows, quietly, and opens its repo",
          rows[1]["detail"] == "" and rows[1]["at"] == "" and rows[1]["path"] == str(dev / "studio"), rows[1])
    check("a pinned project whose repo is missing still shows, with nowhere to open",
          rows[3]["path"] == "" and rows[3]["detail"] == "", rows[3])
    check("pinned rows have ids of their own", len({r["id"] for r in rows}) == len(rows), [r["id"] for r in rows])


LEDGER = """deliverables:
  - name: Attendance Check
    due: 2026-09-24
    type: assignment
    status: todo   # from the gradebook
    source: "Blackboard"

  # Chapter 6
  - name: "Quiz, Ch. 6 (VHL)"
    due: 2026-10-07
    notes: "two columns"
  - name: Lab
    status: todo
"""


def crossing(tmp: Path) -> None:
    """Crossing a to-do off on the panel, in its own app where it can be."""
    # Noon, so a few minutes either side is still today.
    now = datetime.now().astimezone().replace(hour=12, minute=0, second=0, microsecond=0)
    at = lambda minutes: now + timedelta(minutes=minutes)  # noqa: E731
    g = osgraph.Graph(str(tmp / "g.sqlite"))
    ledger = tmp / "coursework" / "span.yml"
    ledger.parent.mkdir(parents=True)
    ledger.write_text(LEDGER)
    reminder = osgraph.node_key("task", "reminders", "R-1", "Call the bank")
    quiz = osgraph.node_key("assignment", "coursework", "SPAN 1412", "Quiz, Ch. 6 (VHL)")
    nodes = [
        Node("person:me", "Person", "Me"),
        Node(reminder, "Task", "Call the bank", {"kind": "promise", "app": "Reminders"}),
        Node("task:people:abcdef123", "Task", "Send Maggie the book", {"kind": "promise"}),
        Node(quiz, "Assignment", "SPAN 1412 Quiz, Ch. 6 (VHL)", {"course": "SPAN 1412"}),
        Node("task:backlog-1", "Task", "Ship the panel", BLOCKING),
    ]
    g.apply("seed", nodes, [Edge(n.id, "OWED_BY", "person:me") for n in nodes[1:]])
    calls = []
    answers = {
        "reminders list": (0, json.dumps([{"id": "R-1", "title": "Call the bank"},
                                          {"id": "R-2", "title": "Something else"}])),
        "coursework due": (0, json.dumps({"overdue": [{"course": "SPAN 1412", "name": "Quiz, Ch. 6 (VHL)",
                                                       "file": str(ledger)}], "upcoming": []})),
    }

    def run(argv):
        calls.append(argv)
        key = " ".join(argv[1:3]) if argv[0] == "mac" else " ".join(argv[:2])
        return answers.get(key, (0, ""))

    record = tmp / "bob" / "home-done.json"
    said = home_feed.cross(g, reminder, at(3), record, home=tmp, run=run)
    check("a reminder is completed in Reminders by its exact id",
          ["mac", "reminders", "complete", "R-1", "--quiet"] in calls and said == "Crossed off in Reminders.",
          (said, calls))
    home_feed.cross(g, "task:people:abcdef123", at(1), record, home=tmp, run=run)
    check("a people-store task is finished by its short code", ["people", "task", "done", "abcdef"] in calls, calls)
    home_feed.cross(g, quiz, at(2), record, home=tmp, run=run)
    text = ledger.read_text()
    check("an assignment is marked done in the ledger, under its own name",
          '  - name: "Quiz, Ch. 6 (VHL)"\n    status: done\n    due: 2026-10-07' in text, text)
    check("no other line of the ledger moves", text.replace("    status: done\n", "", 1) == LEDGER, text)
    before = len(calls)
    said = home_feed.cross(g, "task:backlog-1", at(-1), record, home=tmp, run=run)
    check("a backlog row is crossed off on the panel only", len(calls) == before and said == "Crossed off on the panel.",
          (said, calls[before:]))
    check("crossing twice does nothing the second time",
          home_feed.cross(g, "task:backlog-1", now, record, home=tmp, run=run) == "Already crossed off.")
    mode = stat.S_IMODE(record.stat().st_mode)
    check("the record is owner-only", mode == 0o600, oct(mode))

    open_row = {"id": "task:open", "title": "Still to do", "detail": "", "day": "", "overdue": False}
    rows, count = home_feed.crossed([open_row, {"id": quiz, "title": "SPAN 1412 Quiz", "detail": "",
                                                "day": "", "overdue": True}],
                                    home_feed.load_done(record), now)
    check("open rows come first, then the last three crossed off today, in the order crossed",
          [r["id"] for r in rows] == ["task:open", "task:people:abcdef123", quiz, reminder],
          [r["id"] for r in rows])
    check("a crossed-off row is marked done, and only the ledger and the panel can take one back",
          [(r.get("done"), r.get("reopen")) for r in rows[1:]] == [(True, False), (True, True), (True, False)],
          rows)
    check("a row finished in its app is still drawn today, from the record",
          rows[3]["title"] == "Call the bank", rows[3])
    check("the count is what is still open", count == 1, count)
    tomorrow = now + timedelta(days=1)
    rows, count = home_feed.crossed([open_row], home_feed.load_done(record), tomorrow)
    check("the next day the crossed-off rows are gone", [r["id"] for r in rows] == ["task:open"], rows)
    rows, _ = home_feed.crossed([open_row, {"id": "task:backlog-1", "title": "Ship the panel"}],
                                home_feed.load_done(record), tomorrow)
    check("a row whose source was never written stays off the list",
          [r["id"] for r in rows] == ["task:open"], rows)
    rows, _ = home_feed.crossed([open_row, {"id": reminder, "title": "Call the bank"}],
                                home_feed.load_done(record), tomorrow)
    check("the next day an app that still lists a row decides: a repeating reminder is open again",
          [r["id"] for r in rows] == ["task:open", reminder], rows)
    many = [{"id": f"task:{i}", "title": str(i)} for i in range(9)]
    rows, count = home_feed.crossed(many, {}, now)
    check("open rows are capped and the count is all of them", len(rows) == 5 and count == 9, (len(rows), count))

    try:
        home_feed.uncross(reminder, record)
        refused = ""
    except home_feed.Refused as err:
        refused = str(err)
    check("a completed reminder cannot be reopened from the panel, and it says where to",
          refused == "Done in Reminders; reopen it there.", refused)
    check("taking an assignment back sets it to todo again",
          home_feed.uncross(quiz, record) == "Back on the list." and ledger.read_text() == LEDGER.replace(
              '"Quiz, Ch. 6 (VHL)"\n', '"Quiz, Ch. 6 (VHL)"\n    status: todo\n'), ledger.read_text())
    home_feed.uncross("task:backlog-1", record)
    check("taking a panel-only row back clears it", "task:backlog-1" not in home_feed.load_done(record))

    answers["reminders list"] = (1, "Reminders access denied")
    other = osgraph.node_key("task", "reminders", "R-9", "Renew the tags")
    g.apply("seed-2", [Node(other, "Task", "Renew the tags", {"kind": "promise", "app": "Reminders"})], [])
    said = home_feed.cross(g, other, now, record, home=tmp, run=run)
    rows, _ = home_feed.crossed([], home_feed.load_done(record), now)
    failed_row = next((r for r in rows if r["id"] == other), {})
    check("a write that fails is still crossed off here, and the row says it is still open",
          said.startswith("Crossed off here; still open in Reminders")
          and failed_row.get("detail") == "Still open in Reminders" and failed_row.get("reopen") is True,
          (said, failed_row))
    rows, _ = home_feed.crossed([{"id": other, "title": "Renew the tags"}], home_feed.load_done(record), tomorrow)
    check("the next day a row whose write failed is open again, never hidden",
          [r["id"] for r in rows] == [other] and not rows[0].get("done"), rows)
    try:
        home_feed.cross(g, "person:me", now, record, home=tmp, run=run)
        refused = ""
    except home_feed.Refused as err:
        refused = str(err)
    check("only a to-do can be crossed off", refused == "That is not a to-do the panel knows.", refused)
    g.db.close()


# A backlog row the to-do walk lists: a P0 decision.
BLOCKING = {"kind": "backlog", "status": "decision", "priority": "P0"}


def overlapping(tmp: Path) -> None:
    """Two cross-offs a second apart, each waiting on its app: both kept."""
    now = datetime.now().astimezone().replace(hour=12, minute=0, second=0, microsecond=0)
    g = osgraph.Graph(str(tmp / "g.sqlite"))
    nodes = [Node("person:me", "Person", "Me"),
             Node("task:people:aaaaaa1", "Task", "One", {"kind": "promise"}),
             Node("task:backlog-2", "Task", "Two", BLOCKING)]
    g.apply("seed", nodes, [Edge(n.id, "OWED_BY", "person:me") for n in nodes[1:]])
    record = tmp / "bob" / "home-done.json"

    def slow(argv):
        time.sleep(1)
        return 0, ""

    threads = [threading.Thread(target=home_feed.cross, args=(g, rid, now, record),
                                kwargs={"home": tmp, "run": slow})
               for rid in ("task:people:aaaaaa1", "task:backlog-2")]
    for t in threads:
        t.start()
        time.sleep(0.2)
    for t in threads:
        t.join()
    check("two cross-offs that overlap are both kept",
          sorted(home_feed.load_done(record)) == ["task:backlog-2", "task:people:aaaaaa1"],
          sorted(home_feed.load_done(record)))
    g.apply("seed", nodes[:2], [Edge("task:people:aaaaaa1", "OWED_BY", "person:me")])
    later = now + timedelta(days=home_feed.DONE_KEEP_DAYS + 5)
    nodes.append(Node("task:backlog-3", "Task", "Three", BLOCKING))
    g.apply("seed-3", [nodes[0], nodes[3]], [Edge("task:backlog-3", "OWED_BY", "person:me")])
    home_feed.cross(g, "task:backlog-3", later, record, home=tmp, run=slow)
    kept = home_feed.load_done(record)
    check("a panel-only record goes once its row has left the graph, and a written one after the keep",
          "task:backlog-2" not in kept and "task:people:aaaaaa1" not in kept and "task:backlog-3" in kept, kept)
    g.apply("seed-4", [nodes[0], Node("task:backlog-4", "Task", "Four", BLOCKING)],
            [Edge("task:backlog-4", "OWED_BY", "person:me")])
    home_feed.cross(g, "task:backlog-4", later + timedelta(days=home_feed.DONE_KEEP_DAYS + 5), record,
                    home=tmp, run=slow)
    check("a panel-only record whose row is still there outlives the keep, so the row never comes back",
          "task:backlog-3" in home_feed.load_done(record), sorted(home_feed.load_done(record)))
    g.db.close()


def ledger_edits(tmp: Path) -> None:
    path = tmp / "c.yml"
    path.write_text(LEDGER)
    home_feed.set_status(path, "Attendance Check", "done")
    check("a status keeps its comment", "    status: done   # from the gradebook\n" in path.read_text(),
          path.read_text())
    path.write_text(LEDGER + "  - name: Lab\n    status: todo\n")
    try:
        home_feed.set_status(path, "Lab", "done")
        refused = ""
    except home_feed.Refused as err:
        refused = str(err)
    check("two deliverables with one name are refused, never guessed between", "Two deliverables" in refused, refused)
    check("a refused edit changes nothing", path.read_text() == LEDGER + "  - name: Lab\n    status: todo\n")
    path.write_text('  - name: "Essay 2"   # moved from Friday\n    status: submitted\n'
                    '  - name: Quiz 7  # week 7\n    status: todo\n')
    was = home_feed.set_status(path, "Essay 2", "done")
    check("a quoted name with a comment after it is found, and its old status handed back",
          was == "submitted" and "    status: done\n" in path.read_text(), (was, path.read_text()))
    home_feed.set_status(path, "Quiz 7", "done")
    check("a plain name with a comment after it is found", path.read_text().count("status: done") == 2,
          path.read_text())


def feed_file(tmp: Path) -> None:
    g = osgraph.Graph(str(tmp / "g.sqlite"))
    now = datetime.now(timezone.utc)
    rows = [{"id": "repo:/x", "title": "X", "detail": "", "at": now.isoformat(), "path": "/x"}]
    body = home_feed.build(g, now, rows, {"calendar": "mac calendar failed", "mail": "no access"})
    check("the feed names the sources that failed", body["failed"] == ["calendar", "mail"], body["failed"])
    check("the feed carries the projects it was handed", body["projects"] == rows)
    check("an empty graph is empty lists, not missing keys",
          body["calendar"] == [] and body["todos"] == [], body)
    check("there is no reach-out list: he asked for it gone on 2026-10-11",
          "people" not in body and "peopleCount" not in body, sorted(body))
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
        pinned(Path(d))
    with tempfile.TemporaryDirectory() as d:
        crossing(Path(d))
    with tempfile.TemporaryDirectory() as d:
        overlapping(Path(d))
    with tempfile.TemporaryDirectory() as d:
        ledger_edits(Path(d))
    with tempfile.TemporaryDirectory() as d:
        feed_file(Path(d))
    with tempfile.TemporaryDirectory() as d:
        refresh_command(Path(d))
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
