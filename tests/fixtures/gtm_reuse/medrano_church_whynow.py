#!/usr/bin/env python3
"""Why-now for every large church in John's band: dated Google News (180 days) and the church's
own jobs pages, through lead_card. Writes whynow.csv for score.py. Read-only.

    python3 church_whynow.py churches-scored.csv whynow.csv
"""
import concurrent.futures as cf
import csv
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.expanduser("~/code/firm-foundation/ops/audit"))
import lead_card  # noqa: E402


def one(r):
    city = (r["address"].split(",")[-2:-1] or [""])[0].strip()
    n = lead_card.news(r["church"], city)
    j = lead_card.jobs(r["website"])
    why = "; ".join([f"{x['date']} {x['title']}" for x in n] + [f"hiring: {x['title']}" for x in j])
    src = (n[0]["url"] if n else (j[0]["url"] if j else ""))
    key = urllib.parse.urlparse(r["website"]).netloc.removeprefix("www.")
    return {"site_key": key, "why_now": why, "source": src}


def main():
    rows = [r for r in csv.DictReader(open(sys.argv[1])) if r["tier"] != "out (Gloo)"]
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        out = list(ex.map(one, rows))
    w = csv.DictWriter(open(sys.argv[2], "w", newline=""), fieldnames=["site_key", "why_now", "source"])
    w.writeheader()
    w.writerows(out)
    print(f"{sum(1 for o in out if o['why_now'])} of {len(out)} have a dated reason")


if __name__ == "__main__":
    main()
