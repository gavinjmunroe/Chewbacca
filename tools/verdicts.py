#!/usr/bin/env python3
"""Every verdict the kit makes, one row each, and the reader for them.

Hooks, routers and sends each decide something: refuse a command, pick a
skill, hold a text. Before 2026-10-12 the only trace was hooks.log (name, ms,
exit code), cut to 3,000 lines, which at ~1,500 rows an hour kept about three
hours. That night it held 394 refusals from 01:04 to 04:10 and not one said
why or in which session, so "why was this refused" meant reading transcripts.

Now each writer appends one row to ~/.chewbacca/logs/verdicts.tsv:

    epoch_ms  kind  name  event  decision  ms  session  subject  reason

kind is hook, router or send. lib.sh writes the bash hooks' rows, hookd the
rows for the guards it runs (it has the payload, so those carry the event and
the command), and record() below everyone written in Python or calling it.

    verdicts.py refused [--all] [--session ID] [--hook NAME] [-n N] [--json]
    verdicts.py show    [--all] [--session ID] [--kind K] [--decision D] [-n N] [--json]
    verdicts.py stats   [--since HOURS] [--json]
    verdicts.py record  KIND NAME DECISION [--ms N] [--reason R] [--subject S] [--event E]

Without --all or --session, refused and show read the current session
(CLAUDE_CODE_SESSION_ID), and fall back to every session when it has none.
Runs on /usr/bin/python3 3.9.
"""
import argparse
import glob
import json
import os
import sys
import time

COLUMNS = ("ts", "kind", "name", "event", "decision", "ms", "session", "subject", "reason")
# Caps a field so one row stays one short write; the same numbers as lib.sh
# and hookd (a refusal's first four lines run 100 to 400 characters).
SUBJECT_MAX = 300
REASON_MAX = 600
# The same rotation line lib.sh and hookd draw: 4,658 hook rows landed in
# 3h06m on 2026-10-12, ~36,000 a day at ~110 bytes, so 8 MB is ~two days.
MAX_BYTES = 8_000_000


def log_path():
    explicit = os.environ.get("CHEWBACCA_VERDICT_LOG")
    if explicit:
        return explicit
    base = os.environ.get("CHEWBACCA_LOG_DIR") or os.path.expanduser("~/.chewbacca/logs")
    return os.path.join(base, "verdicts.tsv")


SECRET_KEYS = ("token", "secret", "password", "passwd", "apikey", "api_key", "api-key", "auth")
TOKEN_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-+/=.")
# A word this long with letters and digits and at most one slash reads as a
# key, not a path: GitHub and Anthropic tokens run 36 to 100+ characters, and
# the replay corpus's longest ordinary words were paths (many slashes).
TOKEN_MIN = 24


def redact(text):
    """A command with any token-shaped word, a `Bearer x` or a key=value whose
    key names a secret, cut out. hookd's verdicts.rs does the same."""
    out, after_bearer = [], False
    for word in str(text or "").split(" "):
        low = word.lower()
        if after_bearer and word:
            out.append("[redacted]")
            after_bearer = False
            continue
        after_bearer = low.strip("\"'").endswith("bearer")
        sep = min((i for i in (word.find("="), word.find(":")) if i > 0), default=-1)
        if 0 < sep < len(word) - 1 and any(k in low[:sep] for k in SECRET_KEYS):
            out.append(word[:sep + 1] + "[redacted]")
        elif (len(word) >= TOKEN_MIN and word.count("/") <= 1 and set(word) <= TOKEN_CHARS
              and any(c.isdigit() for c in word) and any(c.isalpha() for c in word)):
            out.append("[redacted]")
        else:
            out.append(word)
    return " ".join(out)


def mask_to(to):
    """Enough of a recipient to tell two sends apart, never the whole address
    or number: the domain of an email, the last four of anything else."""
    to = str(to or "").strip()
    if not to:
        return ""
    if "@" in to:
        return "...@" + to.rsplit("@", 1)[1]
    return "..." + to[-4:] if len(to) > 4 else "..."


def scrub(reason, values=()):
    """A send's reason, unless it quotes what the send said: a timeout's
    str() carries the whole argv, subject and body included."""
    reason = str(reason or "")
    for value in values:
        if isinstance(value, str) and len(value) >= 4 and value in reason:
            return "(the reason quotes the message, so it isn't logged)"
    return reason


def _clean(value, cap):
    text = "" if value is None else str(value)
    return text.replace("\t", " ").replace("\n", " ").replace("\r", " ")[:cap]


def record(kind, name, decision, ms=0, reason="", subject="", event="", session=None):
    """Append one row. Never raises: a missing row must not fail a send."""
    try:
        if os.environ.get("CHEWBACCA_VERDICTS") == "0":
            return
        path = log_path()
        now = int(time.time() * 1000)
        try:
            if os.path.getsize(path) > MAX_BYTES:
                os.rename(path, "%s-%d.tsv" % (path[:-4] if path.endswith(".tsv") else path, now))
        except OSError:
            pass
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        if session is None:
            session = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
        row = "\t".join([str(now), _clean(kind, 20), _clean(name, 200), _clean(event, 60),
                         _clean(decision, 40), str(int(ms or 0)), _clean(session, 80),
                         _clean(redact(_clean(subject, 2000)), SUBJECT_MAX),
                         _clean(redact(_clean(reason, 2000)), REASON_MAX)]) + "\n"
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(fd, row.encode("utf-8", "replace"))
        finally:
            os.close(fd)
    except Exception:
        pass


def _send_decision(result, error=None):
    """held, sent, dry-run or failed, read from what a send function returned:
    a dict with ok/dry_run/error, a (code, dict) pair, or an exit code."""
    if error is not None:
        text = "%s: %s" % (type(error).__name__, error)
        if "CHEWBACCA_NO_SEND" in text:
            return "held", "CHEWBACCA_NO_SEND"
        # Refused, PlanError: the send's own gate said no, which is a verdict,
        # and its words are the gate's. Anything else is logged by type only:
        # a TimeoutExpired's text is the whole command, body included.
        if type(error).__name__ in ("Refused", "PlanError"):
            return "refuse", text
        return "failed", type(error).__name__
    body = result[1] if isinstance(result, tuple) and len(result) == 2 else result
    if isinstance(body, dict):
        reason = str(body.get("error") or "")
        if body.get("dry_run"):
            return "dry-run", reason
        if body.get("ok"):
            return "sent", reason
        return ("held" if "CHEWBACCA_NO_SEND" in reason else "failed"), reason
    if isinstance(body, int):
        return ("sent" if body == 0 else "failed"), ("" if body == 0 else "exit %d" % body)
    return "sent", ""


def _about(about, args, kwargs):
    try:
        return about(args, kwargs) if about else ""
    except Exception:
        return ""


def send_row(name, decision, to="", reason="", started=None, values=(), about=""):
    """One send row: a masked recipient, never what it said. `values` are the
    send's own arguments; a reason quoting any of them is dropped. People send
    sets CHEWBACCA_SEND_LOGGED for the child it hands a send to, so one send is
    one row."""
    if os.environ.get("CHEWBACCA_SEND_LOGGED"):
        return
    ms = (time.time() - started) * 1000 if started else 0
    masked = mask_to(to)
    subject = ("to %s" % masked) if masked else ""
    if about:
        # Not a person: a batch id, a client name. Logged as given.
        subject = (subject + " " + about).strip()
    record("send", name, decision, ms, scrub(reason, values), subject=subject)


def logged_send(name, fn, to_index=0, to_key="to", who=None, about=None):
    """fn, unchanged, plus one send row per call. The row reads fn's own
    result, so the gate inside fn (CHEWBACCA_NO_SEND, dry run, a press)
    still decides; this only writes down what it decided."""
    import functools

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        started = time.time()
        try:
            to = who(args, kwargs) if who else kwargs.get(to_key, args[to_index] if len(args) > to_index else "")
        except Exception:
            to = ""
        values = list(args) + list(kwargs.values())
        try:
            result = fn(*args, **kwargs)
        except Exception as exc:
            decision, reason = _send_decision(None, exc)
            send_row(name, decision, to, reason, started, values, about=_about(about, args, kwargs))
            raise
        decision, reason = _send_decision(result)
        send_row(name, decision, to, reason, started, values, about=_about(about, args, kwargs))
        return result
    wrapper.__wrapped_send__ = fn
    return wrapper


def files():
    """The live log and its rotated parts, oldest first."""
    path = log_path()
    stem = path[:-4] if path.endswith(".tsv") else path
    parts = sorted(glob.glob(stem + "-*.tsv"), key=lambda p: os.path.getmtime(p))
    return parts + ([path] if os.path.exists(path) else [])


def rows(since_ms=0):
    for path in files():
        try:
            if since_ms and os.path.getmtime(path) * 1000 < since_ms:
                continue
            with open(path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    cells = line.rstrip("\n").split("\t")
                    if len(cells) != len(COLUMNS):
                        continue
                    row = dict(zip(COLUMNS, cells))
                    try:
                        row["ts"] = int(row["ts"])
                        row["ms"] = int(row["ms"] or 0)
                    except ValueError:
                        continue
                    if row["ts"] >= since_ms:
                        yield row
        except OSError:
            continue


def _ago(ts_ms):
    secs = max(0, int(time.time() - ts_ms / 1000))
    if secs < 90:
        return "%ds ago" % secs
    if secs < 5400:
        return "%dm ago" % (secs // 60)
    if secs < 172800:
        return "%dh ago" % (secs // 3600)
    return "%dd ago" % (secs // 86400)


def hook_file(name):
    """Where the hook that wrote a row lives, so the answer names the file."""
    for base in (os.path.expanduser("~/.claude/hooks"),
                 os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".claude", "hooks")):
        path = os.path.join(base, name)
        if os.path.isfile(path):
            return path
    return ""


def select(args, refused_only):
    session = getattr(args, "session", None)
    if not session and not getattr(args, "all", False):
        session = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
    picked = []
    for row in rows():
        if session and row["session"] != session:
            continue
        if refused_only and row["decision"] != "refuse":
            continue
        if getattr(args, "hook", None) and args.hook not in row["name"]:
            continue
        if getattr(args, "kind", None) and row["kind"] != args.kind:
            continue
        if getattr(args, "decision", None) and row["decision"] != args.decision:
            continue
        picked.append(row)
    picked.sort(key=lambda r: r["ts"], reverse=True)
    return picked[: args.n], session


def print_rows(found, session, what):
    if not found:
        scope = "this session" if session else "the log"
        print("No %s in %s (%s)." % (what, scope, log_path()))
        return
    for row in found:
        when = time.strftime("%H:%M:%S", time.localtime(row["ts"] / 1000))
        print("%s  %s (%s)  %s  %s %s  %dms" % (when, _ago(row["ts"]), row["kind"], row["name"],
                                                row["decision"], row["event"] or "", row["ms"]))
        if row["subject"]:
            print("  on:   %s" % row["subject"])
        if row["reason"]:
            print("  why:  %s" % row["reason"])
        where = hook_file(row["name"]) if row["kind"] == "hook" else ""
        if where:
            print("  rule: %s" % where.replace(os.path.expanduser("~"), "~"))
        if not session and row["session"]:
            print("  session: %s" % row["session"])


def stats(since_hours):
    since = int((time.time() - since_hours * 3600) * 1000)
    table = {}
    for row in rows(since):
        key = (row["kind"], row["name"])
        cell = table.setdefault(key, {"rows": 0, "refuse": 0, "error": 0, "ms": 0})
        cell["rows"] += 1
        cell["ms"] += row["ms"]
        if row["decision"] in ("refuse", "error"):
            cell[row["decision"]] += 1
    out = [{"kind": k, "name": n, **v, "avg_ms": round(v["ms"] / v["rows"], 1)} for (k, n), v in table.items()]
    out.sort(key=lambda r: (-r["refuse"], -r["rows"]))
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(prog="verdicts", description="What the kit decided, and why.")
    sub = parser.add_subparsers(dest="cmd")
    for name in ("refused", "show"):
        p = sub.add_parser(name)
        p.add_argument("--all", action="store_true", help="every session, not just this one")
        p.add_argument("--session")
        p.add_argument("--hook", help="only names containing this")
        p.add_argument("-n", type=int, default=5 if name == "refused" else 20)
        p.add_argument("--json", action="store_true")
        if name == "show":
            p.add_argument("--kind", choices=("hook", "router", "send"))
            p.add_argument("--decision")
    p = sub.add_parser("stats")
    p.add_argument("--since", type=float, default=24.0, help="hours")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("record")
    p.add_argument("kind")
    p.add_argument("name")
    p.add_argument("decision")
    p.add_argument("--ms", type=int, default=0)
    p.add_argument("--reason", default="")
    p.add_argument("--subject", default="")
    p.add_argument("--event", default="")
    args = parser.parse_args(argv)

    if args.cmd in ("refused", "show"):
        found, session = select(args, args.cmd == "refused")
        if args.json:
            print(json.dumps(found, indent=1))
        else:
            print_rows(found, session, "refusals" if args.cmd == "refused" else "verdicts")
        return 0
    if args.cmd == "stats":
        out = stats(args.since)
        if args.json:
            print(json.dumps(out, indent=1))
        else:
            print("%-7s %-28s %7s %7s %6s %8s" % ("kind", "name", "rows", "refuse", "error", "avg ms"))
            for r in out:
                print("%-7s %-28s %7d %7d %6d %8.1f" % (r["kind"], r["name"][:28], r["rows"], r["refuse"],
                                                       r["error"], r["avg_ms"]))
        return 0
    if args.cmd == "record":
        record(args.kind, args.name, args.decision, args.ms, args.reason, args.subject, args.event)
        return 0
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
