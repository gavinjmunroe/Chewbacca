#!/usr/bin/env python3
"""One church, scored live in about a minute: the five checks FF runs for Medrano Partners.

    python3 lead_card.py "Fellowship Dallas"
    python3 lead_card.py https://www.fellowshipdallas.org/
    python3 lead_card.py "Fellowship Dallas" --json

Read-only. The church's own site is fetched with GET (audit_site.audit), the name is resolved
through api-anything's google-maps site, and the why-now check reads Google News RSS plus the
church's own jobs pages. No form is submitted and no email address is ever guessed.

Checks, in order:
  1 Fit     about 1,000 to 5,000 a week; gigachurches (Gloo's lane) are out
  2 Stack   the church management system read off the church's own site
  3 Buyer   a named executive pastor, operations or technology lead on the staff page
  4 Reach   that person's email published on the church's own domain, else a role inbox
  5 Why now a dated reason this quarter: news in the last 180 days, or an ops or tech job opening
"""
import datetime as dt
import email.utils
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET  # Google News RSS only, a fixed trusted host

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import audit_site  # noqa: E402

API_ANYTHING = os.environ.get(
    "API_ANYTHING_BIN", "/Users/joelnewton/.nvm/versions/node/v22.20.0/bin/api-anything")

# Same cutoffs as the Medrano scorer; guessed, never measured. In-band DFW churches topped out
# at 218 Google reviews and Watermark (well over 5,000 a week) has 892.
GIGA_CAMPUSES = 5
GIGA_STAFF = 120
GIGA_REVIEWS = 800
NEWS_DAYS = 180

KNOWN_CHMS = ("Planning Center", "Rock", "Pushpay", "Ministry Platform", "MinistryPlatform", "CCB",
              "Church Community Builder", "Breeze", "Elvanto", "Fellowship One", "Realm", "ShelbyNext",
              "Subsplash", "Churchteams", "Tithely", "TouchPoint", "ACS")
BUYER = re.compile(r"executive pastor|operations|chief of staff|business administrator|church administrator|"
                   r"technology|\bit\b|information|digital|director of finance|administrative pastor", re.I)
NEWS_HIT = re.compile(r"campus|building|expan|new (lead|senior) pastor|names .* pastor|install|merge|"
                      r"relocat|groundbreak|launch|capital campaign|acquir", re.I)
# The first run (10/27) matched a baseball trade on "acquir" and an anniversary art piece on
# "install", so a headline also needs one of these church-specific phrases.
NEWS_STRICT = re.compile(r"new (campus|building|sanctuary|facility|location)|construction|groundbreak|expan|"
                         r"capital campaign|new (lead|senior|head) pastor|names .{0,40}pastor|"
                         r"installs? .{0,30}pastor|merge|relocat|launch(es)? .{0,30}(campus|church|site)", re.I)
JOB_HIT = re.compile(r"(technology|IT |information|systems|data|digital|operations|database|"
                     r"executive pastor|communications) ?(director|manager|coordinator|specialist|pastor)?", re.I)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh) FirmFoundation-lead-card"}


def get(url, timeout=12):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


def resolve(name):
    env = dict(os.environ)
    # api-anything is a node script; a PATH without its node dir returned nothing (10/27)
    env["PATH"] = os.path.dirname(API_ANYTHING) + ":" + env.get("PATH", "/usr/bin:/bin")
    out = subprocess.run([API_ANYTHING, "call", "google-maps", "searchPlaces", f"query={name}"],
                         capture_output=True, text=True, timeout=60, env=env)
    data = json.loads(out.stdout or "{}").get("data") or []
    if not data and not name.lower().endswith((" church", " ministries")):
        # an exact name match comes back as data:null ("Fellowship Dallas", 10/27); a category word lists it
        return resolve(name + " church")
    hit = next((d for d in data if d.get("website")), None)
    return hit


def buyer_of(contacts):
    ranked = []
    for c in contacts or []:
        t = c.get("title", "")
        if BUYER.search(t):
            rank = 0 if re.search(r"executive pastor|chief of staff", t, re.I) else 1 if re.search(r"operat|admin", t, re.I) else 2
            ranked.append((rank, c))
    ranked.sort(key=lambda x: x[0])
    return ranked[0][1] if ranked else None


def news(name, city):
    q = urllib.parse.quote(f'"{name}" {city}'.strip())
    try:
        root = ET.fromstring(get(f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"))
    except Exception:
        return []
    now = dt.datetime.now(dt.timezone.utc)
    hits = []
    for it in root.iter("item"):
        title = it.findtext("title") or ""
        when = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "Mon, 01 Jan 1990 00:00:00 GMT")
        # the org's own name has to lead the match, or it is someone else's story
        core = re.sub(r"\b(church|the|of|community|fellowship|baptist|methodist|ministries|inc)\b", "",
                      name, flags=re.I).split()
        # "First Baptist" matched the Anniston, Alabama paper for a Dallas church (10/27), so a
        # common first word also needs the city in the headline
        generic = core and core[0].lower() in ("first", "grace", "calvary", "christ", "new", "trinity",
                                               "faith", "hope", "life", "st.", "saint", "our", "bethel")
        named = core and core[0].lower() in title.lower() and (not generic or (city and city.lower() in title.lower()))
        if (now - when).days <= NEWS_DAYS and NEWS_STRICT.search(title) and named:
            hits.append({"date": when.date().isoformat(), "title": title, "url": it.findtext("link") or ""})
    return hits[:3]


def jobs(base):
    found = []
    for path in ("jobs", "careers", "employment", "job-openings", "join-our-team"):
        url = urllib.parse.urljoin(base, path)
        try:
            html = get(url, 8)
        except Exception:
            continue
        text = re.sub(r"<[^>]+>", " ", html)
        for m in re.finditer(r"\b((?:[A-Z][a-z&/]+ ){0,4}(?:Director|Manager|Coordinator|Specialist|Pastor))\b", text):
            t = m.group(1).strip()
            # a real opening names the work: "Communications Manager", never "Visit West A Cafe Pastor"
            if (re.search(r"technology|IT|information|systems|data|digital|operations|database|communications|"
                          r"executive pastor", t) and len(t.split()) <= 5 and t not in [f["title"] for f in found]):
                found.append({"title": t, "url": url})
        if found:
            break
    return found[:3]


def card(arg):
    place = None
    url = arg if re.match(r"https?://", arg) else None
    if not url:
        place = resolve(arg)
        if not place:
            return {"input": arg, "error": "no Google Maps listing with a website"}
        url = place["website"]
    a = audit_site.audit(url, None)
    if a.get("status") != "ok":
        return {"input": arg, "url": url, "error": a.get("error") or a.get("status")}
    name = (place or {}).get("name") or a.get("title", "")
    city = ((place or {}).get("address", "").split(",")[-2:-1] or [""])[0].strip()
    campuses = max(a.get("campuses_stated") or 0, 1)
    staff = a.get("staff_count") or 0
    reviews = (place or {}).get("reviewCount") or 0
    giga = campuses >= GIGA_CAMPUSES or staff >= GIGA_STAFF or reviews >= GIGA_REVIEWS
    chms = (a.get("chms") or "").strip()
    b = buyer_of(a.get("contacts"))
    dom = urllib.parse.urlparse(a.get("final_url") or url).netloc.removeprefix("www.")
    mails = [e.get("email", "") for e in a.get("page_emails") or []]
    inbox = next((m for m in mails if m.lower().endswith("@" + dom) and
                  re.match(r"(info|office|hello|contact|admin|connect)@", m, re.I)), "")
    n = news(name, city)
    j = jobs(a.get("final_url") or url)
    checks = {
        "fit": {"pass": not giga, "evidence": ("giga, Gloo's lane: " if giga else "") + (a.get("attendance_evidence") or f"{reviews} Google reviews")},
        "stack": {"pass": any(k.lower() in chms.lower() for k in KNOWN_CHMS), "evidence": chms or "not found on the site"},
        "buyer": {"pass": bool(b), "evidence": f"{b['name']}, {b['title']} ({b.get('source_url', '')})" if b else "no ops, exec or tech lead named"},
        "reach": {"pass": bool((b or {}).get("email") or inbox), "evidence": (b or {}).get("email") or inbox or "no email published"},
        "why_now": {"pass": bool(n or j), "evidence": "; ".join([f"{x['date']} {x['title']}" for x in n] + [f"hiring: {x['title']} ({x['url']})" for x in j]) or "nothing dated found"},
    }
    passed = sum(c["pass"] for c in checks.values())
    tier = "out (Gloo)" if giga else "A" if passed == 5 else "B" if all(checks[k]["pass"] for k in ("fit", "stack", "buyer")) else "C"
    return {"church": name, "url": a.get("final_url") or url, "tier": tier, "passed": passed, "checks": checks}


def show(c):
    if c.get("error"):
        print(f"{c['input']}: {c['error']}")
        return
    print(f"\n{c['church']}  {c['url']}\nTier {c['tier']}, {c['passed']} of 5\n")
    for k, v in c["checks"].items():
        print(f"  {'PASS' if v['pass'] else '----'}  {k:8} {v['evidence']}")
    print()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    res = card(sys.argv[1])
    print(json.dumps(res, indent=1)) if "--json" in sys.argv else show(res)
