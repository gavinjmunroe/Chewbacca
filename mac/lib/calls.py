#!/usr/bin/env python3
"""Phone and FaceTime calls from this Mac's call history, read-only, as JSON
rows for `people calls sync`.

  calls.py --json [--days N]

CallHistory.storedata is the Mac's copy of the iPhone's recents when Phone
calls are relayed (Continuity) plus FaceTime. Opened read-only; nothing here
writes to it, places a call, or reads a voicemail. Google Voice voicemail
arrives as messages through the gvoice bridge, not here.
"""
import argparse, json, os, sqlite3, sys
from datetime import datetime, timedelta, timezone

DB = os.path.expanduser(os.environ.get(
    "CHEWBACCA_CALLS_DB", "~/Library/Application Support/CallHistoryDB/CallHistory.storedata"))
APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)
# ZCALLTYPE values seen in this Mac's store on 2026-10-10: 1 phone, 8 FaceTime
# video, 16 FaceTime audio. Anything else is reported as "call".
KINDS = {1: "phone", 8: "facetime video", 16: "facetime audio"}


def read(days):
    if not os.path.exists(DB):
        return []
    try:
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=2)
    except sqlite3.Error:
        return []
    floor = 0
    if days:
        floor = (datetime.now(timezone.utc) - timedelta(days=days) - APPLE_EPOCH).total_seconds()
    out = []
    try:
        for uid, address, date, duration, originated, answered, ctype in con.execute(
                """SELECT ZUNIQUE_ID, ZADDRESS, ZDATE, ZDURATION, ZORIGINATED, ZANSWERED, ZCALLTYPE
                     FROM ZCALLRECORD WHERE ZDATE >= ? ORDER BY ZDATE""", (floor,)):
            if not uid or not address:
                continue
            at = (APPLE_EPOCH + timedelta(seconds=float(date or 0))).astimezone()
            out.append({
                "id": str(uid),
                "at": at.strftime("%Y-%m-%dT%H:%M:%S"),
                "handle": str(address),
                "outgoing": bool(originated),
                "answered": bool(answered),
                "seconds": int(duration or 0),
                "kind": KINDS.get(ctype, "call"),
            })
    except sqlite3.Error as e:
        print(f"calls: {e}", file=sys.stderr)
        return []
    finally:
        con.close()
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--days", type=int, default=30, help="0 means all history")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    rows = read(a.days)
    if a.json:
        json.dump(rows, sys.stdout)
        return
    for r in rows:
        print(f"{r['at']}  {'->' if r['outgoing'] else '<-'} {r['kind']:<15} {r['seconds']:>5}s  {r['handle']}")


if __name__ == "__main__":
    main()
