#!/usr/bin/env python3
"""How often "waiting on you" is right, scored against what Caleb actually did.

    needs_you_eval.py split                 write the dev/sealed manifest (ids hashed)
    needs_you_eval.py run --set dev         precision and recall on dev, with failure classes
    needs_you_eval.py run --set sealed      the sealed set, once, at the end
    needs_you_eval.py run --set dev --ingest PATH   score another osgraph_ingest.py (the "before")

Read-only on chat.db, the people store and CallHistory. Nothing leaves the
Mac, and a report never prints a message body: counts, and for an example
only the first word of the newest inbound message.

THE LABEL (written before any tuning, CHW-135):

A needs-you row is a (thread, snapshot) pair. Snapshots are 09:00, 15:00 and
21:00 local each day whose snapshot falls between FROZEN_NOW - 30 days and
FROZEN_NOW - 3 days. At a snapshot T, a thread is a candidate when it has a
message in the 7 days before T (the ingester's window). Its TRUTH is
"waiting on him" iff all three hold:

  1. pending: the newest thing in the thread at or before T is a message from
     someone else. A message of his, or a reaction (tapback) of his, after it
     means he already acted;
  2. not handled elsewhere: between that message and T he did not call the
     sender, or text, mail or WhatsApp them outside this thread;
  3. answered: within 72 hours after T he wrote in this thread, or called,
     texted, mailed or WhatsApped one of the people who wrote since his last
     action. A reaction alone does not count: a tapback is an acknowledgement
     that needed no words, so the row should not have been the head card.

Everything else is not waiting on him: he never answered within 72 h (an
ignored text, a blast, a closer), someone else answered in the group and he
did not, or he only reacted. The rule never sees the future; the label is
read only from what happened after T.

SPLIT: by thread (chat_identifier), never by message: sealed iff
sha256("chw135-split:" + identifier) mod 3 == 0. The manifest commits the
frozen now, the counts and a digest of the hashed sealed ids, so the sealed
set is fixed before tuning and nothing personal is in the repo.

Scope: iMessage (chat.db), the source of almost every needs-you text row.
WhatsApp and bridged chats run through the same awaits_me rule, but the
people store holds 399 WhatsApp rows over three years and no bridged rows, so
they are not scored here.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import random
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "bin" / "lib"
sys.path.insert(0, str(LIB))
import osgraph  # noqa: E402

MANIFEST = ROOT / "tests" / "fixtures" / "needs_you_split.json"
APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)
# Frozen so the candidate threads do not move as days pass. Set on the day
# the eval was written (2026-10-10).
FROZEN_NOW = "2026-10-10T00:00:00-07:00"
WINDOW_DAYS = 7          # the ingester's default window
OLDEST_DAYS = 30         # snapshots from 30 days back ...
NEWEST_DAYS = 3          # ... to 3 days back, so every snapshot has 72 h of future
ANSWER_HOURS = 72
SNAPSHOT_HOURS = (9, 15, 21)
SALT = "chw135-split:"


def apple_ns(moment: datetime) -> int:
    return int((moment - APPLE_EPOCH).total_seconds() * 1e9)


def from_apple(ns) -> datetime:
    return (APPLE_EPOCH + timedelta(seconds=(ns or 0) / 1e9)).astimezone()


def is_sealed(ident: str) -> bool:
    return int(hashlib.sha256((SALT + ident).encode()).hexdigest()[:8], 16) % 3 == 0


def hashed(ident: str) -> str:
    return hashlib.sha256((SALT + ident).encode()).hexdigest()[:16]


def load_ingest(path: str | None):
    """osgraph_ingest from bin/lib, or another copy (the base commit's) for the
    before number."""
    if not path:
        import osgraph_ingest  # noqa: PLC0415
        return osgraph_ingest
    spec = importlib.util.spec_from_file_location("osgraph_ingest_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── reading ──────────────────────────────────────────────────────────────


def chat_db() -> Path:
    return Path(os.environ.get("KYBER_SURFACES_CHAT_DB") or Path.home() / "Library" / "Messages" / "chat.db")


def read_threads(now: datetime, ingest) -> dict[str, dict]:
    """Every chat with a message in the scored span, folded by
    chat_identifier as the ingester folds them, messages oldest first."""
    floor = apple_ns(now - timedelta(days=OLDEST_DAYS + WINDOW_DAYS + 1))
    db = sqlite3.connect(f"file:{chat_db()}?mode=ro", uri=True, timeout=5)
    try:
        chats: dict[int, tuple] = {}
        for rowid, ident, display, style in db.execute(
                "SELECT ROWID, chat_identifier, display_name, style FROM chat"):
            chats[rowid] = (ident, display or "", style)
        handles: dict[str, set] = defaultdict(set)
        for chat_id, h in db.execute(
                "SELECT chj.chat_id, h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id"):
            if chat_id in chats:
                handles[chats[chat_id][0]].add(h)
        threads: dict[str, dict] = {}
        for chat_id, guid, text, blob, from_me, date, handle, item_type, assoc in db.execute(
                """SELECT j.chat_id, m.guid, m.text, m.attributedBody, m.is_from_me, m.date, h.id,
                          m.item_type, m.associated_message_type
                   FROM message m JOIN chat_message_join j ON j.message_id = m.ROWID
                   LEFT JOIN handle h ON h.ROWID = m.handle_id
                   WHERE m.date > ? ORDER BY m.date""", (floor,)):
            if chat_id not in chats:
                continue
            ident, display, style = chats[chat_id]
            t = threads.setdefault(ident, {"ident": ident, "display": "", "group": style == ingest.STYLE_GROUP,
                                           "handles": handles.get(ident, set()), "msgs": []})
            t["display"] = t["display"] or display
            t["msgs"].append({"guid": guid, "text": ingest.body_text(text, blob), "from_me": bool(from_me),
                              "at": from_apple(date), "handle": handle or "", "item_type": item_type or 0,
                              "assoc": assoc or 0})
    finally:
        db.close()
    for t in threads.values():
        seen, out = set(), []
        for m in sorted(t["msgs"], key=lambda m: m["at"]):
            if m["guid"] not in seen:  # a message in two folded rows
                seen.add(m["guid"])
                out.append(m)
        t["msgs"] = out
    return threads


def read_other_contacts(now: datetime, ids: osgraph.Identities) -> dict[str, list[datetime]]:
    """Times he reached a person outside chat.db, keyed by handle_key: calls
    either way that connected, and his own mail, WhatsApp and Slack rows in
    the people store (keyed through every handle the person has)."""
    out: dict[str, list[datetime]] = defaultdict(list)
    calls = Path.home() / "Library" / "Application Support" / "CallHistoryDB" / "CallHistory.storedata"
    if calls.exists():
        db = sqlite3.connect(f"file:{calls}?mode=ro", uri=True, timeout=5)
        try:
            for addr, date, answered, originated, duration in db.execute(
                    "SELECT ZADDRESS, ZDATE, ZANSWERED, ZORIGINATED, ZDURATION FROM ZCALLRECORD"):
                if not addr or date is None:
                    continue
                # A call he placed counts even unanswered (he tried); an
                # incoming one only when it connected.
                if originated or answered or (duration or 0) > 0:
                    key = osgraph.handle_key(str(addr))
                    if key:
                        out[key].append(from_apple(date * 1e9))
        finally:
            db.close()
    keys_of: dict[str, set] = defaultdict(set)
    for key, pids in ids.by_key.items():
        for pid in pids:
            keys_of[pid].add(key)
    path = Path(os.environ.get("PEOPLE_DB") or Path(os.environ.get("PEOPLE_DIR") or Path.home() / ".chewbacca" / "people") / "people.db")
    if path.exists():
        since = (now - timedelta(days=OLDEST_DAYS + WINDOW_DAYS + 1)).strftime("%Y-%m-%d")
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        try:
            for pid, sent_at in db.execute(
                    "SELECT person_id, sent_at FROM messages WHERE from_me = 1 AND source != 'imessage' "
                    "AND person_id IS NOT NULL AND sent_at >= ?", (since,)):
                try:
                    at = datetime.fromisoformat(sent_at)
                except ValueError:
                    continue
                at = at.astimezone() if at.tzinfo else at.replace(tzinfo=timezone.utc).astimezone()
                for key in keys_of.get(pid, ()):
                    out[key].append(at)
        finally:
            db.close()
    return out


# ── the label ────────────────────────────────────────────────────────────


def is_reaction(m: dict) -> bool:
    return 2000 <= m["assoc"] < 4000 or m["assoc"] in (2, 3)


def countable(m: dict) -> bool:
    return m["item_type"] == 0 and m["assoc"] == 0


def truth(thread: dict, T: datetime, my_imessage: dict[str, list], other: dict[str, list]) -> tuple[bool, str]:
    """(waiting on him, why) at snapshot T, read from what happened."""
    msgs = [m for m in thread["msgs"] if m["at"] <= T]
    last_in, last_me, senders = None, None, set()
    for m in reversed(msgs):
        if m["from_me"] and (countable(m) or is_reaction(m)):
            last_me = m
            break
        if not m["from_me"] and countable(m):
            last_in = last_in or m
            if m["handle"]:
                senders.add(m["handle"])
    if not last_in:
        return False, "his move was last" if last_me and last_me["item_type"] == 0 and not is_reaction(last_me) else (
            "he reacted last" if last_me else "nothing inbound")
    keys = {osgraph.handle_key(h) for h in senders} - {""}

    def reached(lo: datetime, hi: datetime) -> bool:
        for k in keys:
            for at in other.get(k, ()):
                if lo < at <= hi:
                    return True
            for at in my_imessage.get(k, ()):
                if lo < at <= hi:
                    return True
        return False

    if reached(last_in["at"], T):
        return False, "handled in another app"
    hi = T + timedelta(hours=ANSWER_HOURS)
    after = [m for m in thread["msgs"] if T < m["at"] <= hi]
    wrote = any(m["from_me"] and countable(m) for m in after)
    if wrote or reached(T, hi):
        return True, "he answered"
    if any(m["from_me"] and is_reaction(m) for m in after):
        return False, "he only reacted"
    if thread["group"] and any(not m["from_me"] and countable(m) and m["handle"] not in senders for m in after):
        return False, "someone else answered"
    return False, "never answered in 72 h"


def my_direct_texts(threads: dict[str, dict]) -> dict[str, list]:
    """His messages in each one-to-one chat, by the other side's handle key, so
    an answer in a 1:1 counts for a group sender."""
    out: dict[str, list] = defaultdict(list)
    for t in threads.values():
        if t["group"]:
            continue
        key = osgraph.handle_key(t["ident"])
        if not key:
            continue
        out[key] += [m["at"] for m in t["msgs"] if m["from_me"] and countable(m)]
    return out


# ── the rule, as the ingester would have seen it at T ────────────────────


def rule(ingest, thread: dict, T: datetime, known: bool) -> bool:
    floor = T - timedelta(days=WINDOW_DAYS)
    window = [m for m in thread["msgs"] if floor < m["at"] <= T]
    if hasattr(ingest, "thread_awaits_me"):
        view = [m for m in window if m["item_type"] == 0][::-1]
        return ingest.thread_awaits_me(
            [{"from_me": m["from_me"], "text": m["text"], "reaction": is_reaction(m) or m["assoc"] != 0}
             for m in view], thread["ident"], thread["group"], known)
    # The base commit's ingester: item_type 0, no associated messages, the
    # newest MESSAGES_PER_THREAD, burst = inbound until his first message.
    view = [m for m in window if countable(m)][::-1][: ingest.MESSAGES_PER_THREAD]
    burst = []
    for m in view:
        if m["from_me"]:
            break
        burst.append(m["text"])
    return ingest.awaits_me(list(reversed(burst)), thread["ident"], thread["group"], known)


def known_of(thread: dict, ids: osgraph.Identities) -> bool:
    return bool(thread["display"]) or any(ids.resolve(h) for h in thread["handles"])


# ── scoring ──────────────────────────────────────────────────────────────


def snapshots(now: datetime) -> list[datetime]:
    out = []
    day = (now - timedelta(days=OLDEST_DAYS)).replace(hour=0, minute=0, second=0, microsecond=0)
    while day < now:
        for h in SNAPSHOT_HOURS:
            T = day.replace(hour=h)
            if now - timedelta(days=OLDEST_DAYS) <= T <= now - timedelta(days=NEWEST_DAYS):
                out.append(T)
        day += timedelta(days=1)
    return out


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if not n:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / d
    return (max(0.0, c - h), min(1.0, c + h))


def cluster_ci(rows: list[dict], key: str, draws: int = 2000, seed: int = 135) -> tuple[float, float]:
    """95% bootstrap interval resampling whole threads, because one thread's
    snapshots are not independent."""
    by: dict[str, list] = defaultdict(list)
    for r in rows:
        by[r["thread"]].append(r)
    names = list(by)
    if not names:
        return (0.0, 0.0)
    rng = random.Random(seed)
    vals = []
    for _ in range(draws):
        k = n = 0
        for _ in names:
            for r in by[rng.choice(names)]:
                n += 1
                k += r[key]
        if n:
            vals.append(k / n)
    vals.sort()
    return (vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1])


def first_word(text: str) -> str:
    t = osgraph_ingest_url.sub(" ", text or "").strip()
    return (t.split() or ["(none)"])[0][:16]


osgraph_ingest_url = re.compile(r"https?://\S+", re.I)


def features(thread: dict, T: datetime) -> dict:
    """What a failure looked like, without the words."""
    msgs = [m for m in thread["msgs"] if m["at"] <= T]
    newest_in = next((m for m in reversed(msgs) if not m["from_me"] and countable(m)), None)
    text = (newest_in or {}).get("text", "")
    return {"group": thread["group"], "first_word": first_word(text), "q": "?" in text,
            "chars": len(text or ""), "age_h": round((T - newest_in["at"]).total_seconds() / 3600) if newest_in else None}


def run(args) -> dict:
    ingest = load_ingest(args.ingest)
    now = datetime.fromisoformat(FROZEN_NOW)
    ids = osgraph.Identities()
    threads = read_threads(now, ingest)
    mine = my_direct_texts(threads)
    other = read_other_contacts(now, ids)
    want_sealed = args.set == "sealed"
    rows = []
    for ident, t in threads.items():
        if is_sealed(ident) != want_sealed:
            continue
        known = known_of(t, ids)
        for T in snapshots(now):
            if not any(T - timedelta(days=WINDOW_DAYS) < m["at"] <= T for m in t["msgs"]):
                continue
            flagged = rule(ingest, t, T, known)
            real, why = truth(t, T, mine, other)
            rows.append({"thread": hashed(ident), "T": T.isoformat(), "flag": int(flagged), "truth": int(real),
                         "why": why, **(features(t, T) if flagged != real else {"group": t["group"]})})
    flagged = [r for r in rows if r["flag"]]
    real = [r for r in rows if r["truth"]]
    tp = sum(1 for r in flagged if r["truth"])
    out = {
        "set": args.set, "ingest": args.ingest or "bin/lib/osgraph_ingest.py",
        "threads": len({r["thread"] for r in rows}), "snapshots": len(rows),
        "flagged": len(flagged), "truly_waiting": len(real), "tp": tp,
        "precision": round(tp / len(flagged), 3) if flagged else None,
        "precision_wilson95": [round(x, 3) for x in wilson(tp, len(flagged))],
        "precision_cluster95": [round(x, 3) for x in cluster_ci(flagged, "truth")],
        "recall": round(tp / len(real), 3) if real else None,
        "recall_wilson95": [round(x, 3) for x in wilson(tp, len(real))],
        "recall_cluster95": [round(x, 3) for x in cluster_ci(real, "flag")],
        "distinct_flagged_threads": len({r["thread"] for r in flagged}),
        "fp_why": dict(Counter(r["why"] for r in flagged if not r["truth"])),
        "fp_group": sum(1 for r in flagged if not r["truth"] and r["group"]),
        "fn_why": dict(Counter(r["why"] for r in real if not r["flag"])),
        "fn_group": sum(1 for r in real if not r["flag"] and r["group"]),
    }
    if args.examples and not want_sealed:
        out["fp_examples"] = [{k: r[k] for k in ("thread", "why", "group", "first_word", "q", "chars", "age_h")}
                              for r in flagged if not r["truth"]][: args.examples]
        out["fn_examples"] = [{k: r[k] for k in ("thread", "why", "group", "first_word", "q", "chars", "age_h")}
                              for r in real if not r["flag"]][: args.examples]
    if args.rows:
        Path(args.rows).write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    return out


def split(_args) -> dict:
    ingest = load_ingest(None)
    now = datetime.fromisoformat(FROZEN_NOW)
    threads = read_threads(now, ingest)
    snaps = snapshots(now)
    scored = [i for i, t in threads.items()
              if any(T - timedelta(days=WINDOW_DAYS) < m["at"] <= T for T in snaps for m in t["msgs"])]
    sealed = sorted(hashed(i) for i in scored if is_sealed(i))
    dev = [i for i in scored if not is_sealed(i)]
    manifest = {"frozen_now": FROZEN_NOW, "rule": "sha256('chw135-split:' + chat_identifier) mod 3 == 0 is sealed",
                "snapshots": len(snaps), "dev_threads": len(dev), "sealed_threads": len(sealed),
                "sealed_digest": hashlib.sha256("\n".join(sealed).encode()).hexdigest()}
    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n")
    return manifest


def verify_split() -> None:
    """Refuse to score sealed if the sealed set is not the one committed."""
    manifest = json.loads(MANIFEST.read_text())
    ingest = load_ingest(None)
    now = datetime.fromisoformat(manifest["frozen_now"])
    threads = read_threads(now, ingest)
    snaps = snapshots(now)
    sealed = sorted(hashed(i) for i, t in threads.items() if is_sealed(i) and any(
        T - timedelta(days=WINDOW_DAYS) < m["at"] <= T for T in snaps for m in t["msgs"]))
    if hashlib.sha256("\n".join(sealed).encode()).hexdigest() != manifest["sealed_digest"]:
        sys.exit("the sealed set differs from the committed manifest; not scoring it")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("split")
    r = sub.add_parser("run")
    r.add_argument("--set", choices=("dev", "sealed"), default="dev")
    r.add_argument("--ingest", help="score this osgraph_ingest.py instead of bin/lib's")
    r.add_argument("--examples", type=int, default=0, help="redacted dev examples to print (first word only)")
    r.add_argument("--rows", help="write every scored (thread, snapshot) row here, hashed ids, no text")
    args = ap.parse_args(argv)
    if args.cmd == "split":
        print(json.dumps(split(args), indent=1))
        return 0
    if args.set == "sealed":
        verify_split()
    print(json.dumps(run(args), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
