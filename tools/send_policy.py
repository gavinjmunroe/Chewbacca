#!/usr/bin/env python3
"""Send policy: could this send go right now? One file answers.

The rules about who, when and how much (quiet hours, unowned addresses,
NO_SEND, cold email caps and weekends, the Clay gates) live in
config/send-policy.cedar. This module gathers the facts a rule reads, hands
them to crates/sendpolicy (Cedar), and returns its answer. It never decides
anything itself, and it is never a press: a yes here still needs
send_approval.take() before anything reaches a person.

    send_policy.py could text --channel imessage [--name "Sagar Tiwari"] [--group]
                              [--after-hours] [--at 2026-10-12T23:30:00-07:00]
    send_policy.py could cold --client "Zeutara" [--to a@b.com] [--weekend]
    send_policy.py could clay --op reply [--allow-writes] [--person-ok]
                              [--reply-finished] [--campaign-status draft] [--grade-pass] [--start]
    send_policy.py ask        {"action": ..., "facts": {...}} on stdin, JSON out
    send_policy.py rules      every rule's id and reason

Exit 0 yes, 3 no, 4 when the policy can't be asked (no binary: run setup.sh,
which builds it when cargo is present). --json prints the whole answer.

When the binary is missing the answer is "unavailable", and every sink keeps
its own inline checks exactly as before, so a missing build costs this one
answer, never a check. When the binary is there but the policy, schema or
facts are broken, the answer is no.

Runs on /usr/bin/python3 3.9.
"""
import datetime
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "config" / "send-policy.cedar"
SCHEMA = ROOT / "config" / "send-policy.cedarschema"
DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
# One call measured 8 ms wall on this Mac (2026-10-12, release build, ten
# calls in 0.078 s with the policy parsed and validated on each). 10 s only
# matters on a Mac at load 100, where a no beats a hang.
TIMEOUT = 10


def binary():
    env = os.environ.get("CHEWBACCA_SENDPOLICY")
    if env:
        return env if os.path.isfile(env) and os.access(env, os.X_OK) else None
    # Only where setup.sh installs it, never a PATH search: tests stub
    # shutil.which for their fake `mac`, and a PATH lookup found the stub.
    local = os.path.expanduser("~/.local/bin/chewbacca-sendpolicy")
    return local if os.path.isfile(local) and os.access(local, os.X_OK) else None


def ask_raw(action, context):
    """The policy's answer for one action and a context already in the
    schema's shape: {"decision": "allow"|"deny"|"unavailable", "rules": [...]}."""
    exe = binary()
    if not exe:
        return {"decision": "unavailable", "rules": [],
                "errors": ["chewbacca-sendpolicy isn't built here (setup.sh builds it when cargo is present)"]}
    try:
        r = subprocess.run([exe, "--policy", str(POLICY), "--schema", str(SCHEMA)],
                           input=json.dumps({"action": action, "context": context}),
                           capture_output=True, text=True, timeout=TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        return {"decision": "deny", "rules": [], "errors": ["the send policy didn't answer: %s" % e]}
    try:
        got = json.loads(r.stdout)
    except ValueError:
        got = None
    if not isinstance(got, dict) or got.get("decision") not in ("allow", "deny"):
        # A broken policy or a fact of the wrong type: a no, never a yes.
        errs = (got or {}).get("errors") if isinstance(got, dict) else None
        return {"decision": "deny", "rules": [],
                "errors": errs or [(r.stderr or "").strip() or "the send policy exited %s" % r.returncode]}
    if (r.returncode == 0) != (got["decision"] == "allow"):
        return {"decision": "deny", "rules": got.get("rules") or [], "errors": ["exit code and decision disagree"]}
    return got


# ---- facts ------------------------------------------------------------------


def _minutes(hhmm):
    m = re.match(r"^(\d{1,2}):(\d{2})$", str(hhmm or ""))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def quiet_rules():
    people = os.environ.get("PEOPLE_DIR") or os.path.expanduser("~/.chewbacca/people")
    try:
        with open(os.path.join(people, "quiet-hours.json")) as f:
            rows = json.load(f)
        return rows if isinstance(rows, list) else []
    except (OSError, ValueError):
        return []


def quiet_record(name, when=None, rules=None):
    """The person's quiet-hours rule turned into their local clock, in the
    schema's Quiet shape, or None when they have no rule. Only the clock is
    worked out here; whether it's quiet is the policy's call."""
    want = str(name or "").strip().lower()
    if not want:
        return None
    rule = next((r for r in (quiet_rules() if rules is None else rules)
                 if isinstance(r, dict) and str(r.get("name") or "").strip().lower() == want), None)
    if not rule or not rule.get("tz"):
        return None
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(rule["tz"])
    except Exception:  # an unknown zone: no record, so the inline check decides
        return None
    when = when or datetime.datetime.now(datetime.timezone.utc)
    local = when.astimezone(tz)
    day = DAYS[local.weekday()]
    yesterday = DAYS[(local.weekday() + 6) % 7]
    by_day = rule.get("after_by_day")
    by_day = by_day if isinstance(by_day, dict) else {}

    def cutoff(d):
        # Same as quietFor's `after_by_day[day] ?? after`: a null day falls back.
        v = by_day.get(d)
        return _minutes(v if v is not None else rule.get("after"))

    rec = {"minute": local.hour * 60 + local.minute}
    if cutoff(day) is not None:
        rec["cutoff_today"] = cutoff(day)
    if cutoff(yesterday) is not None:
        rec["cutoff_yesterday"] = cutoff(yesterday)
    if _minutes(rule.get("until")) is not None:
        rec["until"] = _minutes(rule.get("until"))
    return rec


def no_send(env=None):
    return bool((os.environ if env is None else env).get("CHEWBACCA_NO_SEND"))


def text_context(channel, name="", direct=None, after_hours=False, address_owned=None,
                 to_confirmed=False, unverified_sender=False, when=None, env=None):
    ctx = {"channel": str(channel), "no_send": no_send(env)}
    if direct is not None:
        ctx["direct"] = bool(direct)
    if direct:
        q = quiet_record(name, when)
        if q:
            ctx["quiet"] = q
    if after_hours:
        ctx["after_hours"] = True
    if address_owned is not None:
        ctx["address_owned"] = bool(address_owned)
    if to_confirmed:
        ctx["to_confirmed"] = True
    if unverified_sender:
        ctx["unverified_sender"] = True
    return ctx


def cold_context(client, to="", weekend=False, dry_run=False, now=None, env=None):
    """Facts for one cold email from a client's inbox, read from gtme's own
    ledger (sent.jsonl, suppress.jsonl). Read only."""
    import gtme_solo as g
    from gtme_operator import parse_time, utc_now
    now = now or utc_now()
    sent = list(g.jsonl(g.cdir(client) / "sent.jsonl"))
    first = [parse_time(r["at"]) for r in sent if r.get("step") == 1]
    ctx = {"no_send": no_send(env), "dry_run": bool(dry_run), "utc_weekday": now.weekday(),
           "weekend_ok": bool(weekend),
           "sent_today": sum(1 for r in sent if parse_time(r["at"]).date() == now.date()),
           "suppressed": bool(to) and to.lower() in g.suppressed(client),
           "already_sent": bool(to) and any(r.get("email") == to and r.get("step") == 1 for r in sent)}
    if first:
        ctx["days_since_first"] = (now - min(first)).days
    return ctx


def clay_context(op, start=False, allow_writes=False, person_ok=False, reply_finished=None,
                 campaign_status=None, grade_pass=None, env=None):
    ctx = {"op": str(op), "start": bool(start), "no_send": no_send(env),
           "allow_writes": bool(allow_writes), "person_ok": bool(person_ok)}
    if reply_finished is not None:
        ctx["reply_finished"] = bool(reply_finished)
    if campaign_status is not None:
        ctx["campaign_status"] = str(campaign_status)
    if grade_pass is not None:
        ctx["grade_pass"] = bool(grade_pass)
    return ctx


def ask(action, facts, env=None):
    """facts are a sink's own names for what it knows; the context is built
    from them here so every caller fills the schema the same way."""
    facts = dict(facts or {})
    when = facts.pop("at", None)
    if isinstance(when, str):
        # 3.9's fromisoformat rejects a trailing Z.
        when = datetime.datetime.fromisoformat(when[:-1] + "+00:00" if when.endswith("Z") else when)
    if action == "text":
        return ask_raw("text", text_context(env=env, when=when, **facts))
    if action == "clay_write":
        return ask_raw("clay_write", clay_context(env=env, **facts))
    if action == "cold_email":
        return ask_raw("cold_email", cold_context(env=env, **facts))
    return {"decision": "deny", "rules": [], "errors": ["unknown action %r" % action]}


def refuses(answer):
    """True only when a named rule forbids the send. A no that names no rule
    means the reader broke (a crash, a timeout, a fact of the wrong type), and
    a sink treats that like a missing binary: its own inline checks stand.
    Caleb, 2026-10-12 9:54am, on a gate in front of agent sends: "Wait wtf of
    course it should be able to send texts or emails???" The answer itself
    still says no, so `could` reports a broken policy honestly."""
    return answer.get("decision") == "deny" and bool(answer.get("rules"))


def why_not(answer):
    """One line for a refusal, or None for a yes or an unavailable policy."""
    if answer.get("decision") != "deny":
        return None
    parts = ["%s (%s)" % (r.get("reason") or r.get("id"), r.get("id")) for r in answer.get("rules") or []]
    parts += answer.get("errors") or []
    return "The send policy says no: %s. Nothing was sent." % "; ".join(parts or ["no reason given"])


def rules():
    """Every forbid's id and reason, read from the policy file itself."""
    out, ann = [], {}
    for line in POLICY.read_text().splitlines():
        m = re.match(r'^@(id|reason)\("(.*)"\)\s*$', line.strip())
        if m:
            ann[m.group(1)] = m.group(2)
        elif line.startswith("forbid"):
            out.append({"id": ann.get("id"), "reason": ann.get("reason")})
            ann = {}
        elif line.startswith("permit"):
            ann = {}
    return out


# ---- CLI --------------------------------------------------------------------


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(prog="send-policy", description="Could this send go right now?")
    sub = ap.add_subparsers(dest="cmd", required=True)
    could = sub.add_parser("could")
    kinds = could.add_subparsers(dest="kind", required=True)
    t = kinds.add_parser("text", help="a text, email, Slack or bridged-chat message")
    t.add_argument("--channel", required=True)
    t.add_argument("--name", default="", help="the person, as in quiet-hours.json")
    t.add_argument("--group", action="store_true", help="a group chat (quiet hours don't apply)")
    t.add_argument("--after-hours", action="store_true")
    t.add_argument("--unowned", action="store_true", help="the address isn't provably theirs")
    t.add_argument("--to-confirmed", action="store_true")
    t.add_argument("--at", help="ISO time with offset; default now")
    c = kinds.add_parser("cold", help="one cold email from a client's inbox")
    c.add_argument("--client", required=True)
    c.add_argument("--to", default="")
    c.add_argument("--weekend", action="store_true")
    k = kinds.add_parser("clay", help="a Clay write")
    k.add_argument("--op", required=True)
    k.add_argument("--start", action="store_true")
    k.add_argument("--allow-writes", action="store_true")
    k.add_argument("--person-ok", action="store_true")
    k.add_argument("--reply-finished", action="store_true")
    k.add_argument("--campaign-status")
    k.add_argument("--grade-pass", action="store_true")
    for p in (t, c, k):
        p.add_argument("--json", action="store_true")
    a_ask = sub.add_parser("ask")
    a_ask.add_argument("--json", action="store_true", default=True)
    sub.add_parser("rules")
    a = ap.parse_args(argv)

    if a.cmd == "rules":
        for r in rules():
            print("%-20s %s" % (r["id"], r["reason"]))
        return 0
    if a.cmd == "ask":
        try:
            req = json.loads(sys.stdin.read() or "{}")
        except ValueError:
            req = {}
        try:
            got = ask(req.get("action"), req.get("facts") or {})
        except Exception as e:  # bad facts: a no, with the reason
            got = {"decision": "deny", "rules": [], "errors": ["bad facts: %s" % e]}
        got["refuses"] = refuses(got)
        print(json.dumps(got))
        return {"allow": 0, "deny": 3}.get(got["decision"], 4)

    try:
        got = _could(a)
    except Exception as e:  # bad facts or a bad --at: a no, with the reason
        got = {"decision": "deny", "rules": [], "errors": ["bad facts: %s" % e]}
    if a.json:
        print(json.dumps(got, indent=2))
    elif got["decision"] == "allow":
        print("yes: no rule in config/send-policy.cedar stops it (a person's press is still needed)")
    elif got["decision"] == "unavailable":
        print("can't say: " + "; ".join(got.get("errors") or []))
    else:
        print("no:")
        for r in got.get("rules") or []:
            print("  %-20s %s" % (r.get("id"), r.get("reason")))
        for e in got.get("errors") or []:
            print("  error                %s" % e)
    return {"allow": 0, "deny": 3}.get(got["decision"], 4)


def _could(a):
    if a.kind == "text":
        got = ask("text", {"channel": a.channel, "name": a.name, "direct": not a.group,
                           "after_hours": a.after_hours, "address_owned": False if a.unowned else None,
                           "to_confirmed": a.to_confirmed, "at": a.at})
    elif a.kind == "cold":
        got = ask("cold_email", {"client": a.client, "to": a.to, "weekend": a.weekend})
    else:
        got = ask("clay_write", {"op": a.op, "start": a.start, "allow_writes": a.allow_writes,
                                 "person_ok": a.person_ok,
                                 "reply_finished": True if a.reply_finished else (False if a.op == "reply" else None),
                                 "campaign_status": a.campaign_status,
                                 "grade_pass": True if a.grade_pass else None})
    return got


if __name__ == "__main__":
    sys.exit(main())
