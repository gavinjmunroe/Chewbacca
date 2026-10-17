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
    env = dict(os.environ, CHEWBACCA_GTM_CLIENTS=cfg, CHEWBACCA_STATE_DIR=d)
    run = lambda *a: subprocess.run([sys.executable, os.path.join(ROOT, "tools", "gtme_operator.py"), "done", *a],
                                    capture_output=True, text=True, env=env)
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack)
    check("open items exit 1 and are named", p.returncode == 1 and "gary@sixtrees.example" in p.stdout
          and "Qube Deck.pdf" in p.stdout and "Not done" in p.stdout)
    json.dump({"D1": dm}, open(slack, "w"))
    json.dump([T[1], T[2], T[-1]], open(inbox, "w"))
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack)
    check("nothing open exits 0 and says done", p.returncode == 0 and "Done:" in p.stdout)
    r = json.load(open(os.path.join(d, "gtme-done", "acme.json")))
    check("each run leaves a receipt the client-ask guard reads", r["open"] == 0 and r["client_unanswered"] == 0)
    p = run("--client", "Acme", "--inbox", os.path.join(d, "missing.json"), "--slack", slack)
    check("an unreadable source is not run, never clean (exit 2)", p.returncode == 2 and "not run" in p.stdout and "Done:" not in p.stdout)

    # Answered by phone (Caleb called Jonah, 2026-10-16): the gate only sees
    # Slack, so the call is recorded with how it happened, and only messages
    # up to then close. A later message opens it again.
    env["CHEWBACCA_GTM_ACKS"] = os.path.join(d, "acks")
    json.dump({"D1": dm[:4]}, open(slack, "w"))
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack, "--answered-offline", "D1")
    check("answered offline without --how is not run", p.returncode == 2)
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack, "--answered-offline", "D1", "--how", "phone call")
    check("a phone answer closes the client's messages", p.returncode == 0 and "Done:" in p.stdout)
    later = dm[:4] + [{"ts": "999.0", "user": JONAH, "text": "One more thing"}]
    json.dump({"D1": later}, open(slack, "w"))
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack)
    check("a message after the call is open again", p.returncode == 1 and "One more thing" in p.stdout)
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack, "--answered-offline", "D9", "--how", "call")
    check("an unknown conversation is refused", p.returncode == 2)

    # Togari's follow-up queue (2026-10-16: done said "nobody is waiting" and
    # the next digest listed 26). Each queued investor is an open item.
    json.dump({"D1": dm}, open(slack, "w"))
    togari = os.path.join(d, "stuck.json")
    json.dump([{"email": "vc@fund.example", "company": "Qube", "hours": 40, "reason": "asked for a call"},
               {"email": "lp@fund.example", "company": "Vertocol", "hours": 26, "reason": None}], open(togari, "w"))
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack, "--togari", togari)
    check("togari: each queued investor is an open item named togari", p.returncode == 1
          and p.stdout.count("togari   ") == 2 and "vc@fund.example" in p.stdout and "Not done: 2 open." in p.stdout)
    r = json.load(open(os.path.join(d, "gtme-done", "acme.json")))
    check("togari: the receipt counts the queue as open", r["open"] == 2)
    json.dump([], open(togari, "w"))
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack, "--togari", togari)
    check("togari: an empty queue is clean", p.returncode == 0 and "Done:" in p.stdout)
    json.dump({"error": "no Clay workspace for this client"}, open(togari, "w"))
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack, "--togari", togari)
    check("togari: a non-list answer is not run (exit 2)", p.returncode == 2 and "not run  togari" in p.stdout)
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack, "--togari", os.path.join(d, "nope.json"))
    check("togari: an unreadable file is not run (exit 2)", p.returncode == 2 and "Done:" not in p.stdout)

    # Live path from clients.json: a 503 is not run, a list is read, and the
    # URL's token never reaches the output.
    import http.server
    import threading
    answers = {"code": 503, "body": b'{"error":"down"}'}

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(answers["code"])
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(answers["body"])

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    secret = "f" * 40
    url = f"http://127.0.0.1:{srv.server_port}/dash/{secret}/stuck.json"
    c = json.load(open(cfg))
    c["clients"][0]["togari_stuck_url"] = url
    json.dump(c, open(cfg, "w"))
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack)
    check("togari url: a 503 is not run, never clean", p.returncode == 2 and "HTTP 503" in p.stdout)
    check("togari url: the token is never printed", secret not in p.stdout + p.stderr)
    answers.update(code=200, body=json.dumps([{"email": "vc@fund.example", "company": "Qube", "hours": 40}]).encode())
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack, "--json")
    check("togari url: a live queue is read", p.returncode == 1 and json.loads(p.stdout)["togari"][0][0] == "vc@fund.example"
          and secret not in p.stdout)
    srv.shutdown()
    c["clients"][0]["togari_stuck_url"] = f"http://127.0.0.1:1/dash/{secret}/stuck.json"
    json.dump(c, open(cfg, "w"))
    p = run("--client", "Acme", "--inbox", inbox, "--slack", slack)
    check("togari url: an unreachable queue is not run and hides the token", p.returncode == 2 and secret not in p.stdout + p.stderr)

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

# A person read the thread and it needs no answer: acked at that reply's time.
# A newer reply from the lead reopens it.
inc = dict(thread("ack@fund.example", ("SENT", "Hi")), history_complete=False,
           last_reply_time="2026-10-09T20:49:08Z", last_sent_time="2026-10-09T08:00:00Z")
check("an acked thread is not owed", gtme_done.replies_owed([inc], {"ack@fund.example": "2026-10-09T20:49:08Z"}) == [])
newer = dict(inc, last_reply_time="2026-10-12T09:00:00Z")
check("a reply newer than the ack reopens it", len(gtme_done.replies_owed([newer], {"ack@fund.example": "2026-10-09T20:49:08Z"})) == 1)

sys.exit(1 if fails else 0)
