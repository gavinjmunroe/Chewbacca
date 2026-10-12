#!/usr/bin/env python3
"""gtme done: the end-of-session question answered from data.

The cases are the 2026-10-11 misses: three deck asks unanswered for two days,
and decks plus form answers a client sent in a Slack DM that a to-do post then
asked him for again. A check that cannot read its source reports "not run",
never clean."""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import gtme_done  # noqa: E402

fails = 0


def check(name, ok):
    global fails
    print(("ok    " if ok else "FAIL  ") + name)
    fails += 0 if ok else 1


def thread(lead, *msgs):
    return {"lead_email": lead, "history": {"history": [
        {"type": t, "time": f"2026-10-0{9 if t == 'REPLY' else 8}T10:00:00Z", "email_body": b} for t, b in msgs]}}


T = [
    thread("gary@sixtrees.example", ("SENT", "Hi Gary, Qube is raising"), ("REPLY", "Please send over the deck and we will review.")),
    thread("eric@crosslink.example", ("SENT", "Hi"), ("REPLY", "Can you send the deck?"), ("SENT", "Here's the deck: https://x/d/1")),
    thread("pass@fund.example", ("SENT", "Hi"), ("REPLY", "Thanks, but we'll pass on this one.")),
    thread("ooo@fund.example", ("SENT", "Hi"), ("REPLY", "I am out of the office until Monday with limited access to email.")),
    thread("q@fund.example", ("SENT", "Hi"), ("REPLY", "What is the round size and who is leading?")),
]
T.append(dict(thread("adryenn@fund.example", ("SENT", "Hi"), ("REPLY", "Thanks"), ("SENT", "Following up")),
              history_complete=False, last_reply_time="2026-10-09T20:49:08Z", last_sent_time="2026-10-09T08:01:14Z"))
T.append(dict(thread("done@fund.example", ("SENT", "Hi"), ("REPLY", "Thanks"), ("SENT", "Here you go")),
              history_complete=False, last_reply_time="2026-10-09T08:00:00Z", last_sent_time="2026-10-09T09:00:00Z"))
owed = gtme_done.replies_owed(T)
leads = [o[0] for o in owed]
check("an unanswered deck ask is owed", "gary@sixtrees.example" in leads)
check("an unanswered question is owed", "q@fund.example" in leads)
check("a deck ask we answered is not owed", "eric@crosslink.example" not in leads)
check("a thread missing its newest reply is owed, never called answered", "adryenn@fund.example" in leads)
check("an incomplete thread whose last word is ours is not owed", "done@fund.example" not in leads)
check("a pass and an out of office are not owed", "pass@fund.example" not in leads and "ooo@fund.example" not in leads)

# The own-inbox path (no Clay), the way Firm Foundation and any Chewbacca user
# without Clay runs: replies.jsonl, sent.jsonl, drafted.jsonl on disk.
rep = [{"from": "pastor@church.example", "kind": "question", "gmail_id": "g1", "at": "2026-10-11T10:00:00Z"},
       {"from": "no@church.example", "kind": "pass", "gmail_id": "g2", "at": "2026-10-11T10:00:00Z"},
       {"from": "drafted@church.example", "kind": "interested", "gmail_id": "g3", "at": "2026-10-11T10:00:00Z"},
       {"from": "sent@church.example", "kind": "interested", "gmail_id": "g4", "at": "2026-10-11T10:00:00Z"}]
sent = [{"email": "sent@church.example", "at": "2026-10-11T11:00:00Z"}]
drafted = [{"gmail_id": "g3"}]
solo = [o[0] for o in gtme_done.solo_owed(rep, sent, drafted)]
check("own inbox: an unanswered question is owed", solo == ["pastor@church.example"])

ME, JONAH = "UCALEB", "UJONAH"
dm = [
    {"ts": "100.0", "user": ME, "text": "Get back to me on the PDFs"},
    {"ts": "150.0", "user": JONAH, "subtype": "channel_join", "text": "<@UJONAH> has joined the channel"},
    {"ts": "200.0", "user": JONAH, "text": "", "files": [{"name": "Qube Deck.pdf"}]},
    {"ts": "201.0", "user": JONAH, "text": "I want to add my linkedin on most forms"},
]
got = gtme_done.client_unanswered(dm, JONAH, {ME})
check("files and messages the client sent after our last message are open", len(got) == 2 and got[0][1] == ["Qube Deck.pdf"])
check("a join notice is not a message", all("joined" not in t for _, _, t in got))
b = gtme_done.bursts(got)
check("a run of client messages is one open item with its files", len(b) == 1 and b[0][1] == 2 and b[0][2] == ["Qube Deck.pdf"])
dm.append({"ts": "300.0", "user": ME, "text": "Got them, sending now"})
check("our reply after them closes them", gtme_done.client_unanswered(dm, JONAH, {ME}) == [])

with tempfile.TemporaryDirectory() as d:
    cfg = os.path.join(d, "clients.json")
    json.dump({"clients": [{"name": "Acme", "principal": "Jonah", "workspaces": ["1"],
                            "client_slack": {"user": JONAH, "me": [ME], "conversations": ["D1"]}}]}, open(cfg, "w"))
    inbox = os.path.join(d, "inbox.json")
    json.dump(T, open(inbox, "w"))
    slack = os.path.join(d, "slack.json")
    json.dump({"D1": dm[:4]}, open(slack, "w"))
    env = dict(os.environ, CHEWBACCA_GTM_CLIENTS=cfg)
    run = lambda *a: subprocess.run([sys.executable, os.path.join(ROOT, "tools", "gtme_operator.py"), "done", *a],
                                    capture_output=True, text=True, env=env)
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack)
    check("open items exit 1 and are named", p.returncode == 1 and "gary@sixtrees.example" in p.stdout
          and "Qube Deck.pdf" in p.stdout and "Not done" in p.stdout)
    json.dump({"D1": dm}, open(slack, "w"))
    json.dump([T[1], T[2], T[-1]], open(inbox, "w"))
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack)
    check("nothing open exits 0 and says done", p.returncode == 0 and "Done:" in p.stdout)
    p = run("--client", "Acme", "--inbox", os.path.join(d, "missing.json"), "--slack", slack)
    check("an unreadable source is not run, never clean (exit 2)", p.returncode == 2 and "not run" in p.stdout and "Done:" not in p.stdout)

# The inbox reader: the API path is the default (no browser tab, 2026-10-11),
# and a thread missing the newest reply its row reports is marked incomplete.
import importlib.machinery, importlib.util
loader = importlib.machinery.SourceFileLoader("clay_inbox", os.path.join(ROOT, "bin", "clay-inbox"))
spec = importlib.util.spec_from_loader("clay_inbox", loader)
ci = importlib.util.module_from_spec(spec)
loader.exec_module(ci)
row = {"last_reply_time": "2026-10-09T20:49:08.000Z", "last_sent_time": "2026-10-09T08:01:14.432Z"}
cut = {"history": [{"type": "SENT", "time": "2026-10-09T08:01:14.432Z"}, {"type": "REPLY", "time": "2026-10-07T23:50:00Z"}]}
full = {"history": cut["history"] + [{"type": "REPLY", "time": "2026-10-09T20:49:08Z"}]}
check("a thread missing the row's newest reply is incomplete", ci.complete(row, cut) is False)
check("a thread with it is complete", ci.complete(row, full) is True)
src = open(os.path.join(ROOT, "bin", "clay-inbox")).read()
check("the browser read only runs behind --browser", "if not a.browser:" in src and 'chewie(["goto"' in src.split("if not a.browser:")[1].split("else:")[1])

sys.exit(1 if fails else 0)
