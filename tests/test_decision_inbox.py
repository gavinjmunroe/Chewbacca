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

import importlib.machinery
import importlib.util
import json
import os
import sqlite3
import subprocess
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
        ("t6", "Agents write a take on every call", "queued", "calls come as 'ur call' with no take", ""),
    ]
    for tid, title, status, nxt, evidence in rows:
        owner = "claude" if tid == "t6" else ""
        con.execute("insert into tasks values (?,?,?,?,?,?,?,?,?,?,?)",
                    (tid, "/x", f"k-{tid}", title, status, owner, nxt, evidence, "", f"{DAY}T09:00:00",
                     f"{DAY}T09:00:00"))
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


# The shapes agents used on 10/13, one per line. 7 of the 11 calls they handed
# Caleb that day said "ur call" and stopped.
LANE = """# A lane report

Press first: say "We good?" to the bar. It opens with the calls only u can make, each with a take.
- Most calls came with no take. 7 of 11 said "ur call" and stopped.
- 9026cc5c agent-owned ledger tasks never show as ur calls, and a receipt shows once
- Getting the zip to a stranger. No public download while the repo is private. Ur call.
- The repo is private, so the README's clone line 404s. It's ur call.
  - My take (takes-gate lane, 10/13): keep it private and add the people u hand it to as collaborators.
- Wiping the gold sets from history: Caleb decides yes/no.
- BLOCKED: pricing the Pro tier.
- BLOCKED: loading the extension is a click only u can make (chrome://extensions, Load unpacked).
- Ur calls, my take on each: keep it private. Turn the text door on.

Calls only u can make (2):

## 4. PR candidates for Carlton (your call, nothing opened)

My take (takes-gate lane, 10/13): open one PR, Stage one hunk, and hold the other two.

- Stage one hunk: the strongest.

## Not done, and ur calls

- Ur call, no rush: turning the text door on. My take: turn it on, it only ever texts u.
"""


def takes_gate(tmp: Path) -> None:
    """Every call handed over carries a take, at every place one can arrive."""
    # The constructor is the gate: no take, no options or no proof can't be built.
    for name, kwargs in (("a decision with no take", dict(kind=inbox.DECISION, options=("a", "b"))),
                         ("a decision with one option", dict(kind=inbox.DECISION, recommendation="x",
                                                             options=("a",))),
                         ("a receipt with no proof", dict(kind=inbox.RECEIPT, state="done"))):
        try:
            inbox.Item(key="k", text="t", source="s", **kwargs)
            check(f"{name} can't be built as an Item", False, "constructed")
        except ValueError:
            check(f"{name} can't be built as an Item", True)
    draft = inbox.Draft(inbox.DECISION, key="k", text="t", source="s")
    check("a Draft with no take is ready for nothing, with the reason",
          draft.ready() == (None, "no recommendation"), draft.ready())

    flagged = [line for _n, line in inbox.untaken(LANE)]
    check("a bare 'Ur call.' is flagged", any("zip to a stranger" in f for f in flagged), flagged)
    check("'Caleb decides' with no take is flagged", any("gold sets" in f for f in flagged), flagged)
    check("a BLOCKED line with no take and no how-to is flagged", any("Pro tier" in f for f in flagged), flagged)
    check("exactly those three are flagged", len(flagged) == 3, flagged)
    check("a take on the line under the call counts, and so does a take in a heading's section",
          not any("404" in f or "Carlton" in f for f in flagged), flagged)
    check("quotes, noun uses ('as ur calls', 'the calls only u'), intros and recaps are not calls",
          not any(w in f for f in flagged for w in ("said", "9026cc5c", "Press first", "Calls only", "on each",
                                                    "Not done")), flagged)

    drafts = inbox.decisions_in_report(LANE, "REPORT-lane.md")
    by = {d.text: d for d in drafts}
    pr = next((d for d in drafts if d.text.startswith("PR candidates for Carlton")), None)
    check("a heading call is drawn with the take from its section, its '(your call...)' aside dropped",
          pr is not None and pr.text == "PR candidates for Carlton" and pr.recommendation.startswith("open one PR")
          and pr.ready()[0] is not None, pr)
    clone = next((d for d in drafts if "404" in d.text), None)
    check("a backfilled take keeps its marker out of the take and draws",
          clone is not None and clone.recommendation.startswith("keep it private") and clone.ready()[0] is not None,
          clone)
    check("the bare BLOCKED line is held, not given a made-up 'Do it'",
          any("Pro tier" in t and not d.recommendation for t, d in by.items()), list(by))

    # A ledger call carries its own take in its next action.
    rows = [{"id": "l1", "source_key": "k1", "title": "Decide whether to introduce Jonah to the assistant",
             "status": "queued", "owner": "caleb", "next_action": "Live since 10/10. My take (takes-gate lane, "
             "10/13): not yet, he asked us to handle replies.", "reason": "", "evidence": "", "updated_at": DAY},
            {"id": "l2", "source_key": "k2", "title": "Decide: wipe the gold sets", "status": "queued",
             "owner": "caleb", "next_action": "Caleb decides yes/no.", "reason": "", "evidence": "",
             "updated_at": DAY}]
    _r, calls, _c = inbox.from_ledger(rows, DAY)
    ready = {c.key: c.ready() for c in calls}
    check("a ledger call with 'My take:' in its next action is drawn with that take",
          ready["ledger:l1"][0] is not None and ready["ledger:l1"][0].recommendation.startswith("not yet"), ready)
    check("one without stays held", ready["ledger:l2"] == (None, "no recommendation"), ready)

    # The check, from the command line and from the jobs runner.
    lane = tmp / "lanes"
    lane.mkdir()
    (lane / "REPORT-lane.md").write_text(LANE)
    (lane / "REPORT-clean.md").write_text("# Clean\n\n- Ur call: x. My take: y.\n")
    cli = [sys.executable, str(ROOT / "bin" / "decision-inbox"), "check"]
    bad = subprocess.run(cli + [str(lane / "REPORT-lane.md")], capture_output=True, text=True)
    check("decision-inbox check exits 1 and names file:line for each call with no take",
          bad.returncode == 1 and bad.stdout.count("REPORT-lane.md:") == 3, (bad.returncode, bad.stdout))
    ok = subprocess.run(cli + [str(lane / "REPORT-clean.md")], capture_output=True, text=True)
    check("and exits 0 on a report where every call has one", ok.returncode == 0, (ok.returncode, ok.stdout))

    jobs_dir = tmp / "jobs-runner"
    (jobs_dir / "1013-150000-ffff").mkdir(parents=True)
    os.environ["JOBS_DIR"] = str(jobs_dir)
    spec = importlib.util.spec_from_loader("chewbacca_jobs", importlib.machinery.SourceFileLoader(
        "chewbacca_jobs", str(ROOT / "bin" / "chewbacca-jobs")))
    jobs = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(jobs)
    (lane / "lane.md").write_text("prompt")
    job = {"id": "1013-150000-ffff", "cmd": ["/bin/bash", "-c", f'claude -p "$(cat {lane}/lane.md)"']}
    jobs.note_untaken_calls(job)
    log = (jobs_dir / job["id"] / "out.log")
    said = log.read_text() if log.is_file() else ""
    check("an agent job's end lists its calls with no take at the end of its log",
          "3 call(s) in REPORT-lane.md with no take" in said and "line " in said, said)

    header = (ROOT / "config" / "instructions" / "unattended-lane.md").read_text()
    check("the lane prompt header asks for a take on every call and names the check",
          "My take:" in header and "decision-inbox check" in header, header[:200])
    check("the lane header's own examples are not untaken calls", not inbox.untaken(header), inbox.untaken(header))


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
    check("an agent-owned ledger task is never one of his calls, whatever its words say",
          not any("Agents write a take" in t for t in list(held) + texts), list(held))
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
    shown = next(a for a in argv if a.startswith("He pressed"))
    check("the ledger task quotes what the row showed and marks the take as an agent's words",
          rows[0]["text"] in shown and "written by an agent" in shown, shown)
    changed = inbox.Item(inbox.DECISION, key=inbox.call_key("R.md", "q", "take two"), text="q", source="R.md",
                         recommendation="take two", options=("Go with my take", "Not now"))
    check("a take that changed after the draw has a different id, so the old press can't approve it",
          changed.key != inbox.call_key("R.md", "q", "take one"))
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

    takes_gate(tmp)
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
