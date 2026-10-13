#!/usr/bin/env python3
"""The decision inbox draws only calls with a take and receipts with proof,
from one owner, and an item is never both.

Caleb, 2026-10-13: Chewbacca should come to him instead of him watching it.
On 10/12 he typed "Progress?" and "We good?" six times into tabs that had the
answer. The inbox is the answer, so it must never show a call he would have
to research (no take) or a "done" he would have to check (no proof).

Everything here runs in a temp CHEWBACCA_HOME: made-up jobs, reports, a
ledger, a verdict log and a transcript. Nothing reads ~/.chewbacca.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bin" / "lib"))
sys.dont_write_bytecode = True

import decision_inbox as inbox  # noqa: E402
import surface_intent  # noqa: E402
import surface_lint  # noqa: E402
from surfaces import Context, data_line, make  # noqa: E402

failed = 0
DAY = "2026-10-13"
NOON = datetime.fromisoformat(f"{DAY}T12:00:00").astimezone()


def check(name: str, ok: bool, got: object = "") -> None:
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += 0 if ok else 1


def at(hour: int) -> float:
    return datetime.fromisoformat(f"{DAY}T{hour:02d}:00:00").astimezone().timestamp()


REPORT = """# Setup app: a double-click install

Landed `abcdef12` on origin/main, and an older try `0badc0de`.

- Ur calls, no rush: whether to pay Apple $99 a year for the Developer ID. My take: pay it the day a stranger gets the app.
- BLOCKED: loading the extension is a click only u can make (chrome://extensions, Load unpacked).

## 4. PR candidates for Carlton (your call, nothing opened)

```
Ur call: this fenced line is code, never a call
```
"""

MORNING = """# Overnight: morning summary

5. Two calls only u can make. (a) Going public: the scan found 5 phone numbers in old commits. My rec: keep it private and publish a scrubbed copy. (b) Switching on the fast write-log: 43 rows still disagree. My rec: wait a day for fresh rows, then flip it.
"""


def world(tmp: Path) -> Path:
    home = tmp / "chewbacca"
    lane = home / "overnight" / "d1013"
    lane.mkdir(parents=True)
    (lane / "setup-app.md").write_text("prompt")
    (lane / "REPORT-setup-app.md").write_text(REPORT)
    night = home / "overnight" / "n1012"
    night.mkdir(parents=True)
    (night / "REPORT.md").write_text(MORNING)
    os.utime(night / "REPORT.md", (at(7), at(7)))

    def job(jid, title, status, exit_code, created, cmd):
        d = home / "jobs" / jid
        d.mkdir(parents=True)
        (d / "job.json").write_text(json.dumps({"id": jid, "title": title, "status": status, "exit": exit_code,
                                                "created": created, "ended": created + 600, "cmd": cmd}))
    agent = ["/bin/bash", "-c", f'claude -p "$(cat {lane}/setup-app.md)" > {lane}/setup-app.log 2>&1']
    job("1013-090000-aaaa", "Setup app: first try", "killed", None, at(9), agent)
    job("1013-100000-bbbb", "Setup app: double-click install", "done", 0, at(10), agent)
    job("1013-110000-cccc", "full suite on main", "done", 1, at(11), ["bash", "tests/run.sh"])
    job("1013-113000-dddd", "evening summary", "queued", None, at(11) + 1800, ["true"])
    job("1012-230000-eeee", "yesterday's job", "done", 0, at(0) - 3600, ["true"])

    db = home / "work-ledger.sqlite"
    con = sqlite3.connect(db)
    con.execute("""CREATE TABLE tasks (id TEXT PRIMARY KEY, scope TEXT NOT NULL, source_key TEXT NOT NULL,
        title TEXT NOT NULL, status TEXT NOT NULL, owner TEXT NOT NULL, next_action TEXT NOT NULL,
        evidence TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
    rows = [
        ("t1", "Decide: Apple Developer ID and notarization for the Setup app (99 USD a year)", "queued", "", ""),
        ("t2", "Decide: wipe the personal gold sets from git history", "queued", "", ""),
        ("t3", "Ship the showcase pages", "done", "", "docs/showcases landed 2a796bd7"),
        ("t4", "Write the README hero", "done", "", ""),
        ("t5", "Refactor the jobs runner", "queued", "", ""),
    ]
    for tid, title, status, nxt, evidence in rows:
        con.execute("insert into tasks values (?,?,?,?,?,?,?,?,?,?,?)",
                    (tid, "/x", f"k-{tid}", title, status, "", nxt, evidence, "", f"{DAY}T09:00:00", f"{DAY}T09:00:00"))
    con.commit()
    con.close()

    logs = home / "logs"
    logs.mkdir()
    ms = int(at(10) * 1000)
    (logs / "verdicts.tsv").write_text(
        f"{ms}\tsend\tgtme send\t\theld\t0\ts1\tAcme batch 1\twaiting on a press\n"
        f"{ms}\tsend\tgtme send\t\theld\t0\ts1\tFixture batch\tCHEWBACCA_NO_SEND\n"
        f"{ms - 86_400_000}\tsend\tgtme send\t\theld\t0\ts1\tOld batch\tyesterday\n")
    return home


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="inbox-"))
    home = world(tmp)
    on_main = {"abcdef12"}.__contains__

    # The two kinds can't mix.
    for name, kwargs in (("a decision with proof", dict(kind=inbox.DECISION, proof="sha")),
                         ("a receipt with a recommendation", dict(kind=inbox.RECEIPT, recommendation="do x")),
                         ("a third kind", dict(kind="maybe"))):
        try:
            inbox.Item(key="k", text="t", source="s", **kwargs)
            check(f"{name} is refused", False, "constructed")
        except ValueError:
            check(f"{name} is refused", True)

    feed = inbox.build_feed(day=DAY, home=home, repo=tmp, on_main=on_main, now=at(12))
    texts = [d.text for d in feed.decisions]
    held = {i.text: r for i, r in feed.held}

    check("every drawn call has a take and two options",
          all(d.recommendation and len(d.options) >= 2 for d in feed.decisions), feed.decisions)
    check("every drawn receipt has proof", all(r.proof for r in feed.receipts), feed.receipts)
    check("a call with no take is held, not drawn",
          any("PR candidates for Carlton" in t and r == "no recommendation" for t, r in held.items()), held)
    check("a ledger decision with no matching take is held",
          held.get("wipe the personal gold sets from git history") == "no recommendation", held)
    check("a done ledger task with no evidence is held as a receipt without proof",
          held.get("Write the README hero") == "no proof", held)
    check("a fenced code line is never a call", not any("fenced line" in t for t in list(held) + texts))

    apple = [d for d in feed.decisions if "Apple" in d.text]
    check("the ledger's Apple ID call and the report's are one call", len(apple) == 1, texts)
    check("that one call carries the report's take and both sources",
          apple and "stranger" in apple[0].recommendation and "ledger" in apple[0].sources, apple)
    check("a BLOCKED click is a call whose take is its own how-to",
          any(d.options == ("Do it", "Later") and "Load unpacked" in d.recommendation for d in feed.decisions),
          feed.decisions)
    check("the BLOCKED click is first", feed.decisions and feed.decisions[0].options[0] == "Do it", texts)
    check("the morning summary's two lettered calls are two calls",
          any(t.startswith("Going public") for t in texts) and any("write-log" in t for t in texts), texts)
    check("a call's prefix ('Ur calls, no rush:') is dropped", not any(t.lower().startswith("ur call") for t in texts),
          texts)

    jobs = [r for r in feed.receipts if r.source == "jobs"]
    check("a killed try and its rerun that wrote one report are one receipt",
          sum(1 for r in jobs if r.text.startswith("Setup app")) == 1, [r.text for r in jobs])
    setup = next((r for r in jobs if r.text.startswith("Setup app")), None)
    check("a sha counts as proof only when it is on main",
          setup and setup.proof == "on main: abcdef12", setup and setup.proof)
    check("a failed job is a receipt that says failed, with its job id",
          any(r.state == "failed" and "1013-110000-cccc" in r.proof for r in jobs), jobs)
    check("a job from yesterday is not today's", not any("yesterday" in r.text for r in jobs))
    check("a queued job is working, not a receipt",
          any("evening summary" in w for w in feed.working) and not any("evening" in r.text for r in jobs))
    check("a held send waiting on him is a call (held: no take yet)",
          any("Acme batch 1" in t for t in held), list(held))
    check("a dry-run hold and yesterday's hold are not",
          not any("Fixture batch" in t or "Old batch" in t for t in list(held) + texts))

    # A press records his pick on the ledger; the next build drops the call.
    chosen = feed.decisions[1]
    con = sqlite3.connect(home / "work-ledger.sqlite")
    con.execute("insert into tasks values (?,?,?,?,?,?,?,?,?,?,?)",
                ("t9", "/x", f"inbox:{chosen.key}", f"Caleb chose: {chosen.text}", "queued", "claude",
                 "carry it out", "", "", f"{DAY}T12:01:00", f"{DAY}T12:01:00"))
    con.commit()
    con.close()
    after = inbox.build_feed(day=DAY, home=home, repo=tmp, on_main=on_main, now=at(12))
    check("an answered call leaves the list", chosen.key not in [d.key for d in after.decisions],
          [d.key for d in after.decisions])
    check("and comes back as a 'you chose' receipt with the ledger as proof",
          any(r.state == "chosen" and r.proof.startswith("ledger ") for r in after.receipts), after.receipts)

    text = inbox.digest(feed)
    check("the digest leads with the calls", text.startswith(f"{len(feed.decisions)} calls only u can make"), text)
    check("the digest has no long dash", "—" not in text and "–" not in text, text)
    check("the digest counts what landed", "landed code on main" in text, text)

    # The surface draws the same feed and its one press writes only the ledger.
    p = make("decisions")
    ran = []

    def run(argv, timeout=20.0):
        ran.append(argv)
        return 0, "", ""
    ctx = Context(run=run, now=lambda: NOON, home=tmp, env={"CHEWBACCA_HOME": str(home), "CHEWBACCA_REPO": str(tmp)})
    data = {"feed": feed, "_at": NOON}
    model = p.model(data, None, {}, ctx)
    lines = p.layout() + [data_line(k, v) for k, v in model.items()]
    walls = surface_lint.lint(lines)
    check("the panel passes the glass lint (rows, total, no raw ids)", not walls, walls)
    rows = model[p.p("list")]
    check("the panel's rows are the drawn calls, each with its take",
          len(rows) == min(len(feed.decisions), 5) and all("my take:" in r["text"] for r in rows), rows)
    check("held calls are a count in the note, never rows", "held" in model[p.p("note")], model[p.p("note")])
    res = p.choose(ctx, data, {"row": rows[0]["id"]})
    argv = ran[-1] if ran else []
    check("Go with it writes one ledger task keyed inbox:<call>",
          res.ok and "add" in argv and f"inbox:{rows[0]['id']}" in argv, argv)
    check("the press runs the ledger and nothing else", len(ran) == 1 and argv[1].endswith("work-ledger"), ran)
    res = p.choose(ctx, data, {"row": "report:made-up"})
    check("a press naming a call that isn't listed writes nothing", not res.ok and len(ran) == 1, ran)
    loading = p.model(None, None, {}, ctx)
    check("before the first fetch it says Loading", loading[p.p("note")].startswith("Loading"), loading)

    for said in ("we good?", "Progress?", "what do I need to decide", "show my decisions"):
        cmd = surface_intent.parse(said, resolve_person=lambda _n: None)
        check(f"{said!r} opens the decision inbox", cmd is not None and cmd.name == "decisions", cmd)

    # Status asks: his typed messages only, in local time.
    projects = tmp / "projects" / "p"
    projects.mkdir(parents=True)

    def msg(text, hour, entry="claude-vscode"):
        stamp = datetime.fromisoformat(f"{DAY}T{hour:02d}:30:00").astimezone().isoformat()
        return json.dumps({"type": "user", "timestamp": stamp, "entrypoint": entry,
                           "message": {"role": "user", "content": text}})
    (projects / "s.jsonl").write_text("\n".join([
        msg("We good?", 10), msg("Progress?", 11), msg("make the logo bigger", 12),
        msg("We good?", 13, entry="sdk-cli"), msg("we good? also fix the header", 14)]) + "\n")
    asks = inbox.status_asks(tmp / "projects", DAY)
    check("status asks count only his bare 'we good?' and 'progress?'", asks["status_asks"] == 2, asks)
    check("a headless run's message is not his", asks["messages"] == 4, asks)

    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
