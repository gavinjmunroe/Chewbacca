#!/usr/bin/env python3
"""data/surfaces/apps.json: every app names its status honestly, a replaced or
partial app names a surface that exists, and every open-source link points at
a real row of data/oss-apps/apps.json."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import surfaces  # noqa: E402

failed = 0


def check(name, ok, got=None):
    global failed
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))
    failed += not ok


TOOLS = {"hud-music", "hud-listen quick path", "hud-listen opener"}


def main() -> int:
    body = json.loads((ROOT / "data" / "surfaces" / "apps.json").read_text())
    apps = body["apps"]
    check("statuses are the three honest words", all(a["status"] in ("replaced", "partial", "not yet") for a in apps))
    for a in apps:
        if a["status"] in ("replaced", "partial"):
            known = all(s.split()[0] in surfaces.KINDS or s in TOOLS for s in a["surfaces"])
            check(f"{a['app']}: names a surface that exists", a["surfaces"] and known, a["surfaces"])
            check(f"{a['app']}: says what works", bool(a["works"]))
        if a["status"] == "partial" or a["status"] == "not yet":
            check(f"{a['app']}: says what is missing", bool(a["missing"]))
    counts = {s: sum(1 for a in apps if a["status"] == s) for s in ("replaced", "partial", "not yet")}
    check("the counts in meta are the counts in the list", counts == body["meta"]["counts"], counts)
    oss_path = ROOT / "data" / "oss-apps" / "apps.json"
    if oss_path.exists():
        ids = {a["id"] for a in json.loads(oss_path.read_text())["apps"]}
        links = [o["id"] for a in apps for o in a["oss"]]
        check("every oss link is a row of data/oss-apps/apps.json", all(i in ids for i in links),
              [i for i in links if i not in ids])
    print("all passed" if not failed else f"{failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
