#!/usr/bin/env python3
"""chewbacca gtme dns: is a sending domain set up to land in an inbox?

    chewbacca gtme dns getaurapath.com aurapathhq.com [--selector google] [--min-age 10] [--json]

Each domain gets the checks a cold email inbox needs before its first send, read from public
DNS and whois only. Nothing here changes a record or sends a message.

  mx       the domain takes mail (a reply to a domain with no MX bounces, and filters notice)
  spf      one v=spf1 record, and only one (two SPF records is a permerror, the same as none)
  dkim     a DKIM key at <selector>._domainkey (Google Workspace's default selector is google)
  dmarc    a v=DMARC1 record at _dmarc
  age      days since the domain was registered, against the warmup minimum
  site     the bare domain answers on https, so someone who checks the sender finds a page

Written 2026-11-02 for the AuraPath trial, whose three lookalike domains get bought on 11/3:
before tonight the kit had no check for any of these, and the plan (dough IMPROVEMENT-PLAN.md,
item 9) puts deliverability ahead of the first send.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
import urllib.request

# Warmup minimum in days. Caleb told Travis 10 to 15 days on the 10/29 call, and Zeutara's
# standing ruling uses 12 (team rulings, 2026-10-16). 10 is the floor, never the target.
MIN_AGE_DAYS = 10


def dig(name: str, rtype: str) -> list[str]:
    try:
        out = subprocess.run(["dig", "+short", rtype, name], capture_output=True, text=True, timeout=15).stdout
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [ln.strip().strip('"').replace('" "', "") for ln in out.splitlines() if ln.strip()]


def created(domain: str) -> dt.date | None:
    """The registration date from RDAP, the JSON successor to whois. Plain whois was tried
    first on 2026-11-02: it hung past 60 s on firmfoundation.tech's registrar referral and gave
    nothing when piped, and on an unregistered .com it printed the TLD's own 1985 date."""
    try:
        req = urllib.request.Request(f"https://rdap.org/domain/{domain}", headers={"Accept": "application/rdap+json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read() or b"{}")
    except Exception:
        return None  # a 404 here means not registered, which is unknown age, never old
    for ev in data.get("events") or []:
        if ev.get("eventAction") == "registration" and re.match(r"\d{4}-\d{2}-\d{2}", ev.get("eventDate", "")):
            return dt.date.fromisoformat(ev["eventDate"][:10])
    return None


def site_up(domain: str) -> bool:
    try:
        req = urllib.request.Request(f"https://{domain}/", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=12) as r:
            return r.status < 400
    except Exception:
        return False


def check(domain: str, selector: str = "google", min_age: int = MIN_AGE_DAYS, today: dt.date | None = None,
          lookup=dig, born=created, up=site_up) -> dict:
    today = today or dt.date.today()
    res = {"domain": domain, "checks": {}}
    c = res["checks"]
    mx = lookup(domain, "MX")
    c["mx"] = {"ok": bool(mx), "seen": mx}
    spf = [t for t in lookup(domain, "TXT") if t.lower().startswith("v=spf1")]
    c["spf"] = {"ok": len(spf) == 1, "seen": spf,
                "why": "" if len(spf) == 1 else ("no SPF record" if not spf else "more than one SPF record")}
    dkim = [t for t in lookup(f"{selector}._domainkey.{domain}", "TXT") if "p=" in t]
    c["dkim"] = {"ok": bool(dkim), "seen": [t[:60] for t in dkim], "selector": selector}
    dmarc = [t for t in lookup(f"_dmarc.{domain}", "TXT") if t.lower().startswith("v=dmarc1")]
    c["dmarc"] = {"ok": bool(dmarc), "seen": dmarc}
    when = born(domain)
    age = (today - when).days if when else None
    c["age"] = {"ok": age is not None and age >= min_age, "days": age, "min": min_age,
                "why": "registration date not found" if age is None else ""}
    c["site"] = {"ok": up(domain)}
    res["ok"] = all(v["ok"] for v in c.values())
    return res


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="chewbacca gtme dns", description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("domains", nargs="+")
    ap.add_argument("--selector", default="google", help="DKIM selector (Google Workspace: google)")
    ap.add_argument("--min-age", type=int, default=MIN_AGE_DAYS, help="warmup minimum in days")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    results = [check(d.lower().strip(), a.selector, a.min_age) for d in a.domains]
    if a.json:
        print(json.dumps(results, indent=2))
    else:
        for r in results:
            print(f"{'READY' if r['ok'] else 'NOT READY'}  {r['domain']}")
            for name, v in r["checks"].items():
                extra = v.get("why") or (f"{v['days']} days, min {v['min']}" if name == "age" and v.get("days")
                                         is not None else "")
                print(f"  {'ok  ' if v['ok'] else 'FAIL'}  {name}{'  ' + extra if extra else ''}")
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
