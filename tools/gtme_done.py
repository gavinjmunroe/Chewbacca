#!/usr/bin/env python3
"""Have we done everything we can? The question every GTM session ends on.

Caleb, 2026-10-11: "Have we done everything we can do - this should be the
question for every gtm chewb session". The same night showed why it has to be
answered from data and not from memory: Jonah had sent three decks and his
form answers in a Slack DM on 10/10, a to-do post asked him for them again on
10/11, and three investors had waited two days for a deck that was on file.

    chewbacca gtme done --client Zeutara
    chewbacca gtme done --client Zeutara --inbox inbox.json --slack slack.json

Two checks, each from the source and never from notes:
  replies   every inbox thread whose last word is the lead's and whose reply
            needs a person (a question, interest, a deck or form ask, unclear).
            Passes, opt-outs, bounces, out of office and referrals are handled
            by the reply autopilot and are not owed.
  client    every message or file the client sent in their Slack DM or channel
            after our last message there. Nothing they sent sits unread.

Prints what is still open, one line each. Exit 0 when nothing is, 1 when
something is, 2 when a source could not be read (a check that did not run is
reported as not run, never as clean).
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gtme_reply  # noqa: E402

CLIENTS = os.path.expanduser(os.environ.get("CHEWBACCA_GTM_CLIENTS", "~/.chewbacca/gtm/clients.json"))
NOT_OWED = set(gtme_reply.AUTO_HANDLED) | {"ignore"}


def client_config(name):
    try:
        data = json.load(open(CLIENTS))
    except (OSError, ValueError):
        return {}
    for c in data.get("clients", []):
        if c.get("name", "").lower() == (name or "").lower():
            return c
    return {}


def acks_path(client):
    base = os.path.expanduser(os.environ.get("CHEWBACCA_GTM_ACKS", "~/.chewbacca/gtm/acks"))
    return os.path.join(base, "".join(c if c.isalnum() else "-" for c in client.lower()) + ".json")


def load_acks(client):
    try:
        return json.load(open(acks_path(client)))
    except (OSError, ValueError):
        return {}


def replies_owed(threads, acks=None):
    """(lead, kind, when) for each thread whose last message is the lead's reply
    and needs a person. `acks` maps a lead to the reply time someone read and
    marked as needing no answer; a newer reply reopens the thread."""
    acks = acks or {}
    owed = []
    for t in threads:
        h = (t.get("history") or {}).get("history") or []
        lead = (t.get("lead_email") or "").lower()
        if lead in acks and acks[lead] >= (t.get("last_reply_time") or (h[-1].get("time") if h else "") or ""):
            continue
        if t.get("history_complete") is False:
            # The thread read missed the newest message (clay-inbox, 2026-10-11).
            # The row's own times still say whose word is last.
            reply, sent = (t.get("last_reply_time") or ""), (t.get("last_sent_time") or "")
            if reply > sent:
                owed.append((t.get("lead_email") or "?", "unread: thread missing its newest reply", reply[:10]))
            continue
        if not h or h[-1].get("type") != "REPLY":
            continue
        text = gtme_reply.clean_reply_text(h[-1].get("email_body") or "")
        kind = gtme_reply.reply_intent(text, t.get("lead_email"))["kind"]
        if kind in NOT_OWED:
            continue
        owed.append((t.get("lead_email") or "?", kind, (h[-1].get("time") or "")[:10]))
    return owed


def solo_owed(replies, sent, drafted):
    """The own-inbox path (gtme_solo: one Gmail, no Clay), used by Firm Foundation
    and anyone running Chewbacca without Clay. A reply is answered once a draft
    was saved for it or anything was sent to that person after it arrived."""
    drafted_ids = {d.get("gmail_id") for d in drafted}
    owed = []
    for r in replies:
        if r.get("kind") in NOT_OWED or r.get("gmail_id") in drafted_ids:
            continue
        who = (r.get("from") or r.get("email") or "").lower()
        later = [s for s in sent if (s.get("email") or "").lower() == who and (s.get("at") or "") > (r.get("at") or "")]
        if not later:
            owed.append((who or "?", r.get("kind") or "?", (r.get("at") or "")[:10]))
    return owed


def read_jsonl(path):
    try:
        return [json.loads(l) for l in open(path) if l.strip()]
    except OSError:
        return []


def receipt_path(client):
    base = os.path.expanduser(os.environ.get("CHEWBACCA_STATE_DIR", "~/.chewbacca/state"))
    return os.path.join(base, "gtme-done", "".join(c if c.isalnum() else "-" for c in client.lower()) + ".json")


def write_receipt(client, report, open_items):
    """What the last run found, read by client-ask-guard.sh before a post that
    asks the client for something."""
    import time
    path = receipt_path(client)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump({"at": int(time.time()), "open": open_items, "not_run": len(report["not_run"]),
                   "client_unanswered": len(report["client_unanswered"] or [])}, f)


def client_unanswered(messages, client_user, me):
    """Messages and files from the client after our last message, oldest first.
    `messages` is one conversation's history, any order."""
    msgs = sorted(messages, key=lambda m: float(m.get("ts") or 0))
    last_ours = max((float(m["ts"]) for m in msgs if m.get("user") in me), default=0.0)
    out = []
    for m in msgs:
        # Join notices and other system events carry a subtype; no person wrote them.
        if m.get("subtype") or "has joined" in (m.get("text") or "") or "accepted your invitation" in (m.get("text") or ""):
            continue
        if m.get("user") != client_user or float(m.get("ts") or 0) <= last_ours:
            continue
        files = [f.get("name") or "file" for f in m.get("files") or []]
        text = (m.get("text") or "").strip()
        out.append((m["ts"], files, text))
    return out


def bursts(items):
    """Consecutive client messages as one open item: (first_ts, count, files, first words)."""
    if not items:
        return []
    files = [f for _, fs, _ in items for f in fs]
    words = " / ".join(t for _, _, t in items if t)[:160]
    return [(items[0][0], len(items), files, words)]


def fetch_inbox(workspace):
    p = subprocess.run([os.path.join(HERE, "..", "bin", "clay-inbox"), "--workspace", workspace],
                       capture_output=True, text=True, timeout=300)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip()[-200:] or "clay-inbox failed")
    return json.loads(p.stdout)


def fetch_slack(channel):
    p = subprocess.run(["slackcli", "conversations", "read", channel, "--limit", "200", "--json"],
                       capture_output=True, text=True, timeout=120)
    raw = p.stdout
    if p.returncode != 0 or "{" not in raw:
        raise RuntimeError((p.stderr or raw).strip()[-200:] or "slackcli failed")
    data, _ = json.JSONDecoder().raw_decode(raw[raw.index("{"):])
    return data.get("messages") or []


def main(argv=None):
    ap = argparse.ArgumentParser(prog="chewbacca gtme done", description=__doc__.splitlines()[0])
    ap.add_argument("--client", required=True)
    ap.add_argument("--inbox", help="a saved clay-inbox JSON instead of reading it live")
    ap.add_argument("--slack", help="a saved {channel_id: [messages]} JSON instead of reading Slack")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--ack", metavar="EMAIL", action="append",
                    help="mark this lead's latest reply as read and needing no answer")
    a = ap.parse_args(argv)
    cfg = client_config(a.client)
    slack_cfg = cfg.get("client_slack") or {}
    report = {"client": a.client, "replies_owed": None, "client_unanswered": None, "not_run": []}

    try:
        if a.inbox or cfg.get("workspaces"):
            threads = json.load(open(a.inbox)) if a.inbox else fetch_inbox(cfg["workspaces"][0])
            if a.ack:
                rows = {(t.get("lead_email") or "").lower(): t for t in threads}
                acks = load_acks(a.client)
                for lead in a.ack:
                    t = rows.get(lead.lower())
                    if not t:
                        raise RuntimeError(f"no thread with {lead}")
                    acks[lead.lower()] = t.get("last_reply_time") or ""
                os.makedirs(os.path.dirname(acks_path(a.client)), exist_ok=True)
                json.dump(acks, open(acks_path(a.client), "w"), indent=1)
            report["replies_owed"] = replies_owed(threads, load_acks(a.client))
        else:
            # No Clay workspace: the own-inbox path keeps its replies on disk.
            import gtme_operator as op
            d = op.client_dir(a.client)
            # A plan with nothing sent yet owes nobody; no plan at all is unknown.
            if not any((d / f).exists() for f in ("replies.jsonl", "sent.jsonl", "plan.json")):
                raise RuntimeError(f"no Clay workspace and no own-inbox state for {a.client}")
            report["replies_owed"] = solo_owed(read_jsonl(d / "replies.jsonl"), read_jsonl(d / "sent.jsonl"),
                                               read_jsonl(d / "drafted.jsonl"))
    except Exception as e:  # a check that did not run is never reported as clean
        report["not_run"].append(f"replies: {e}")

    if slack_cfg.get("user") and slack_cfg.get("conversations"):
        try:
            saved = json.load(open(a.slack)) if a.slack else None
            found = []
            for ch in slack_cfg["conversations"]:
                msgs = saved.get(ch, []) if saved is not None else fetch_slack(ch)
                items = client_unanswered(msgs, slack_cfg["user"], set(slack_cfg.get("me") or []))
                for ts, n, files, words in bursts(items):
                    found.append((ch, ts, n, files, words))
            report["client_unanswered"] = found
        except Exception as e:
            report["not_run"].append(f"client messages: {e}")
    else:
        # Not set up is said out loud, but it is not a failed check.
        report["skipped"] = ["client messages: no client_slack {user, me, conversations} for this client in clients.json"]

    open_items = len(report["replies_owed"] or []) + len(report["client_unanswered"] or [])
    write_receipt(a.client, report, open_items)
    if a.json:
        print(json.dumps(report, indent=1))
    else:
        principal = cfg.get("principal") or a.client
        for lead, kind, when in report["replies_owed"] or []:
            print(f"owed     {lead} wrote {when} ({kind}) and has no answer")
        for ch, ts, n, files, words in report["client_unanswered"] or []:
            sent = f", files: {', '.join(files)}" if files else ""
            print(f"client   {principal} sent {n} message(s) in {ch} that nobody answered{sent}. Starts: \"{words}\"")
        for why in report["not_run"]:
            print(f"not run  {why}")
        for why in report.get("skipped") or []:
            print(f"skipped  {why}")
        if open_items:
            print(f"Not done: {open_items} open.")
        elif report["not_run"]:
            print("Unknown: a check did not run, so this is not a clean answer.")
        elif report.get("skipped"):
            print("Done on replies: nobody is waiting on us. Client messages are not checked until client_slack is set up.")
        else:
            print("Done: nobody is waiting on us and nothing the client sent is unread.")
    if report["not_run"]:
        return 2
    return 1 if open_items else 0


if __name__ == "__main__":
    sys.exit(main())
