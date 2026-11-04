#!/usr/bin/env python3
"""chewbacca gtme accounts: a scored account list for any client, the whole stack, no flags.

    chewbacca gtme accounts --client aurapath [--out PATH] [--limit N] [--workers 4] [--refresh]
    chewbacca gtme accounts --client aurapath --check     validate the accounts block, fetch nothing

THE FAILURE THIS EXISTS FOR. Two org lists were built by hand in two days, Medrano Partners
for John Knox (10/27) and AuraPath AI for Travis Johnson (10/29), each by copying the last
one's scripts out of ~/Downloads. The AuraPath copy picked "Chair Karen Scott / First 5 San
Bernardino Executive Director" as IEHP Foundation's buyer, a title from another org on the
same page, and it skipped Jev until Caleb wrote "I SHOULD NEVER HAVE TO SAY THIS ... IT
SHOULD BE BUILT IN". This file is those two scripts as one kit command, so every step runs
on every list whether or not the agent remembers it.

Every run, in order:

  1. refuse      no `accounts` block, or its ICP isn't confirmed (`icp.confirmed: true` plus
                 `icp.confirmed_by`, the person and the moment). A list for a guessed buyer
                 is the Medrano mistake, run faster.
  2. source      the accounts: the IRS EO master file (nonprofits, by state, zip, NTEE and
                 revenue), `gtme-signals formd` (companies that just raised), `chewbacca api`
                 (any site api-anything knows), or a CSV someone pulled. treg is not an
                 account source yet; it is wired below as the email finder only.
  3. enrich      Google Maps finds the site, Firm Foundation's site audit reads it (named
                 leaders, published emails, systems), the org's own jobs pages and dated
                 Google News give the why-now. Cached per account, so a rerun refetches
                 nothing (--refresh to redo).
  4. score       gtme_score.resolve_primary picks the buyer from the people the org's own
                 site names, signal_strength scores the why-now (HOLD under 6), assign_tier
                 tiers it on fit against the client's band.
  5. Jev         one call per picked buyer: do they lead THIS org in a role that signs. Under
                 0.8, or unscored, the buyer is dropped and the row re-tiered with none.
  6. dedupe      one row per org, then gtme-dedupe over the buyers.
  7. dnc         every published email through gtme-dnc against the client's lists.
  8. people      the people store's relationship column: someone already known is warm and
                 gets a text, never a cold email (Sagar).
  9. treg        a row with a Jev-confirmed buyer and no published email gets a priced treg
                 find, never run here: the cap per lookup and the total, so the spend is a
                 decision someone makes.

The accounts block, in ~/.chewbacca/gtm/clients/<slug>.json:

    "accounts": {
      "icp": {"confirmed": true, "confirmed_by": "Travis on the 10/29 call",
              "buyer": "COO, CTO or ED at an LA/OC nonprofit", "sells": "AI discovery, 2 to 4 weeks"},
      "source": {"kind": "irs_eo", "states": ["CA"], "zips": ["900-918", "926-928"],
                 "ntee": ["R", "W", "I", "E", "F"], "revenue": {"min": 10000000, "max": 50000000}},
            or {"kind": "formd", "since_days": 30, "industry": "Technology", "state": "CA"}
            or {"kind": "api", "site": "google-maps", "op": "searchPlaces", "args": {"query": "..."}}
            or {"kind": "csv", "path": "~/Downloads/x.csv", "columns": {"Company": "name"}}
            or {"kind": "search", "queries": ["baptism 2026 site:churchcenter.com California"], "state": "CA",
                "signal": "baptism", "budget_usd": 1, "customer": "baptize"}   signal first, metered SERP
      "titles": ["Chief Operating", "COO", "Executive Director"],
      "criteria": {"revenue_range": {"min": 10000000, "max": 50000000}},
      "lanes": {"R": "advocacy", "I": "legal aid"},          NTEE letter -> what the row says it is
      "news_words": "\\bAI\\b|data|cyber|breach",             headlines that are a reason to talk
      "jev_question": "...",                                 optional; the default asks about signing
      "dnc": {"csv": ["~/x/dnc.csv"], "client": "aurapath"}, optional
      "treg_budget_usd": 5,
      "out": "~/Downloads/AuraPath leads/AuraPath leads.csv"}

For churches and other many-people orgs (Baptize the World, 2026-11-02), all optional:

      "source": {"kind": "api", "site": "google-maps", "op": "searchPlaces",
                 "queries": ["baptist church in Fresno CA", ...],      one call per query, deduped
                 "keep_category": "church", "drop_category": "catholic|kingdom hall"},
      "audit_titles": "pastors",          the site audit's title table: church (default), org, pastors
      "per_person": true,                 one row per named person, so each campus pastor gets a row
      "page_signals": [{"name": "baptism", "link_words": "baptis", "line_words": "baptis"}],
                                          the org's own pages whose link says link_words, and the
                                          lines on them that say line_words, kept with their URL
      "checks": [{"name": "baptized_2026", "question": "...", "lines": ["baptism"],
                  "pass": "yes", "bar": 0.8}],        one Jev call per org answers every check;
                                          pass "yes" holds a row under the bar, pass "no" excludes
                                          a row at or over it, and an unscored check holds the row
      "segments": [{"name": "B", "category": "baptist", "title": "next steps", "checks": ["..."]}]
                                          the first segment whose category, title and passing
                                          checks all match; none means the row is held
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import contextlib
import csv
import datetime as dt
import email.utils
import inspect
import io
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import gtme_dedupe  # noqa: E402
import gtme_dnc  # noqa: E402
import gtme_score  # noqa: E402
import gtme_signals  # noqa: E402
import treg_client  # noqa: E402

# Same bar gtme_jev.py uses for an opener. On 10/29 it held IEHP (0.06) and Saint John's and
# passed 9 buyers on the AuraPath list; never measured against a labeled set of buyers. The same
# MLK Community Hospital COO scored 0.77, then 0.81 on two runs an hour apart, so a row within
# about 0.05 of the bar can flip between runs: read those by hand before a client sees the list.
BUYER_OK = 0.8
JEV_QUESTION = ("Is this person a current leader of THIS organization (not another organization named in the "
                "title, and not only a board chair or donor), in a role that owns operations, technology, "
                "finance or the whole organization, so they could sign for an outside project?")
# Below this Jaro-Winkler similarity the Google Maps place is a different org than the filer:
# "Next Generation Signature Homes" came back for a ministry on 10/27. Guessed, never measured.
NAME_MATCH = 0.86
NEWS_DAYS = 365
# A reason to talk, from John Knox's 10/27 call (AI governance and data work); a client's
# `news_words` replaces it. Chosen from that call, never measured.
NEWS_WORDS = (r"\bAI\b|artificial intelligence|chatgpt|technology|digital|data|cyber|breach|hack|ransomware|"
              r"software|CRM|platform")
GROWTH_WORDS = (r"new (ceo|president|executive director|leader)|names .* (ceo|president)|expan|acquir|merge|"
                r"campus|launch|grant|campaign|record")
# Law firms are run by owners and partners. Without these words the 2026-11-02 Michigan PIP
# list for AuraPath kept 11 of 145 firms' leaders, and at Marko Law it dropped "Principal
# Attorney/Founder" Jonathan Marko and kept the IT director.
LEADER = re.compile(r"\b(ceo|chief|president|executive director|coo|cfo|cto|cio|operations|technology|"
                    r"information|it director|director of it|digital|data|founder|owner|"
                    r"managing partner|founding partner|senior partner|name partner|partner|principal|"
                    r"managing (shareholder|member|attorney)|firm administrator|legal administrator|"
                    r"practice manager)\b", re.I)
# How many leaders the enrich step keeps. resolve_primary picks among them by the client's own
# `titles` order, so this only has to be wide enough to hold the real buyer: at 3, with the
# tech titles sorted first, Marko Law's three slots went to the IT director and two others.
LEADERS_KEPT = 6
# A buyer's name with a title or heading word in it is not a person. Any reader can hand one
# over: on 2026-11-02 "Managing Attorney", "Firm Founder" and "Recent Articles" reached Jev as
# names on the Michigan PIP list, and Jev passed them at 0.82 to 0.91.
NOT_PERSON = re.compile(r"\b(partners?|founders?|owners?|attorneys?|lawyers?|managing|principal|firm|"
                        r"articles?|recent|news|blog|team|staff|leadership|management|director|officer|"
                        r"president|chief|ceo|coo|cfo|cto|executive|contact|about|office)\b", re.I)


def site_home(rec: dict) -> str:
    """Where the org's site really lives after redirects. Calvary Chapel North Long Beach is
    listed on Maps as ccnlb.com and serves calvarynlb.org, so own_page dropped its pastor on 11/2.
    Older cached reads have no final_url; their first signal page is the home page they reached."""
    if rec.get("final_url"):
        return rec["final_url"]
    for pages in (rec.get("signals") or {}).values():
        if pages:
            return pages[0].get("url", "")
    return ""


def own_page(page: str, website: str) -> bool:
    """A buyer counts only when the org's own site names them. A page on another domain is
    someone else's claim, the shape of IEHP's buyer on 10/29 (a title from another org)."""
    if not page or not website:
        return True  # nothing to compare; the Jev check and a person's read still apply
    a, b = _domain(page), _domain(website)
    return a == b or a.endswith("." + b) or b.endswith("." + a)


# A buyer who died or retired can still sit on a firm's site. Fieger Law's founder Bernard
# Fieger came back as a buyer on 2026-11-02, and The Lobb Law Firm lists its founder
# "In Memoriam (1949-2024)" next to the owner who runs it now.
GONE = re.compile(r"in memoriam|deceased|\bthe late\b|\bretired\b|emerit|\((?:18|19|20)\d\d\s*[-\u2013]\s*(?:19|20)\d\d\)", re.I)


def is_person(name) -> bool:
    words = str(name or "").split()
    return len(words) >= 2 and not NOT_PERSON.search(str(name))
# The sample read before a full run, and the buyer fill under which it stops. On 2026-11-02 the
# Michigan PIP list read all 145 firms and found a buyer at 1, because no title the reader knew
# was a law title. 20 sites cost about a minute; the bar is a guess, never measured on a list
# that was right, so lower it for a market where buyers truly aren't on the site.
SAMPLE = 20
MIN_BUYER_FILL = 0.2
LISTICLE = re.compile(r"MinistryWatch|top \d+|largest|\d+ (best|largest)", re.I)
KNOWN_STACK = re.compile(r"planning center|rock|pushpay|ministry ?platform|ccb|church community builder|breeze|"
                         r"elvanto|fellowship one|realm|shelby|subsplash|churchteams|tithely|touchpoint|acs|"
                         r"blackbaud|raiser|salesforce|virtuous|bloomerang|donorperfect|neon", re.I)
IRS_EO = "https://www.irs.gov/pub/irs-soi/eo_{state}.csv"
COLUMNS = ["tier", "fit", "why_now_score", "hold", "kind", "org", "city", "state", "website", "revenue", "size",
           "stack", "buyer", "buyer_first", "buyer_title", "buyer_email", "buyer_source", "buyer_check", "relationship",
           "channel", "dnc", "treg_find", "dupe_of", "why_now", "why_now_date", "why_now_source",
           "tier_rationale", "account_source", "icp_fit", "icp_line", "icp_source", "email_verdict"]
lock = threading.Lock()


class Refused(Exception):
    pass


# ── config ───────────────────────────────────────────────────────────────


def clients_dir() -> Path:
    return Path(os.environ.get("GTME_CLIENTS_DIR") or Path(os.environ.get("GTME_HOME") or
                Path.home() / ".chewbacca" / "gtm") / "clients")


def load(client: str) -> tuple[Path, dict]:
    slug = re.sub(r"[^a-z0-9]+", "-", client.lower()).strip("-")
    for p in (clients_dir() / f"{client}.json", clients_dir() / f"{slug}.json"):
        if p.exists():
            return p, json.loads(p.read_text())
    raise Refused(f"no client config for {client!r} in {clients_dir()}. Write one with an `accounts` "
                  f"block first (see `chewbacca gtme accounts --help`).")


def accounts_block(cfg: dict) -> dict:
    acc = cfg.get("accounts")
    if not isinstance(acc, dict):
        raise Refused("this client has no `accounts` block, so there's no ICP to build against.")
    icp = acc.get("icp") if isinstance(acc.get("icp"), dict) else {}
    if icp.get("confirmed") is not True or not str(icp.get("confirmed_by") or "").strip():
        raise Refused("the ICP isn't confirmed. Set accounts.icp.confirmed to true and confirmed_by to who "
                      "said yes and when, once the client has agreed who the buyer is. A list for a "
                      "guessed buyer is the 10/27 Medrano mistake.")
    src = acc.get("source") if isinstance(acc.get("source"), dict) else {}
    if src.get("kind") not in SOURCES:
        raise Refused(f"accounts.source.kind must be one of {', '.join(SOURCES)}")
    if not acc.get("titles"):
        raise Refused("accounts.titles is empty: name the titles that buy, from the client's own words")
    return acc


# ── step 2: accounts ─────────────────────────────────────────────────────


def _zip_ok(z: str, ranges: list[str]) -> bool:
    if not ranges:
        return True
    head = (z or "")[:3]
    for r in ranges:
        lo, _, hi = str(r).partition("-")
        if lo <= head <= (hi or lo):
            return True
    return False


def irs_rows(src: dict, cache: Path) -> list[dict]:
    rev = src.get("revenue") or {}
    ntee = [n.upper() for n in src.get("ntee") or []]
    out = []
    for st in src.get("states") or []:
        path = Path(os.path.expanduser(src["files"][st])) if (src.get("files") or {}).get(st) else \
            cache / f"eo_{st.lower()}.csv"
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(IRS_EO.format(state=st.lower()), timeout=120) as r:
                path.write_bytes(r.read())
        with open(path, encoding="latin-1", newline="") as fh:
            for r in csv.DictReader(fh):
                if r.get("STATE") != st.upper() or not _zip_ok(r.get("ZIP", ""), src.get("zips") or []):
                    continue
                if ntee and not any((r.get("NTEE_CD") or "").upper().startswith(n) for n in ntee):
                    continue
                try:
                    amt = int(r.get("REVENUE_AMT") or 0)
                except ValueError:
                    continue
                if not gtme_score._in_range(amt, rev):
                    continue
                out.append({"key": r["EIN"], "name": r["NAME"].title(), "city": r["CITY"].title(),
                            "state": r["STATE"], "revenue": amt, "headcount": None, "ntee": r.get("NTEE_CD", ""),
                            "size": f"${amt:,} revenue (IRS, period {r.get('TAX_PERIOD', '')})",
                            "account_source": f"IRS EO master file {IRS_EO.format(state=st.lower())}"})
    return out


def formd_rows(src: dict, cache: Path) -> list[dict]:
    today = dt.date.today()
    argv = [sys.executable, str(HERE / "gtme_signals.py"), "formd", "--json",
            "--since", (today - dt.timedelta(days=int(src.get("since_days") or 30))).isoformat(),
            "--limit", str(src.get("limit") or 200)]
    for k in ("industry", "state", "min_amount"):
        if src.get(k):
            argv += [f"--{k.replace('_', '-')}", str(src[k])]
    p = subprocess.run(argv, capture_output=True, text=True, timeout=1800)
    if p.returncode:
        raise Refused(f"gtme-signals formd failed: {(p.stderr or p.stdout)[:300]}")
    rows = json.loads(p.stdout or "[]")
    rows = rows.get("rows", rows) if isinstance(rows, dict) else rows
    return [{"key": r.get("cik") or r["issuer"], "name": r["issuer"], "city": (r.get("city") or "").title(),
             "state": r.get("state", ""), "revenue": None, "headcount": None, "ntee": "",
             "raised": int(r.get("amount_sold") or r.get("offering_amount") or 0) or None,
             "size": f"raised ${int(r.get('amount_sold') or r.get('offering_amount') or 0):,} (Form D "
                     f"{r.get('file_date', '')})",
             "account_source": r.get("filing_url") or "SEC Form D"} for r in rows]


def _first_list(obj):
    if isinstance(obj, list) and obj and isinstance(obj[0], dict):
        return obj
    if isinstance(obj, dict):
        for v in obj.values():
            hit = _first_list(v)
            if hit:
                return hit
    return []


def _mapped(raw: dict, cols: dict, n: int, where: str) -> dict:
    r = {cols.get(k, k): v for k, v in raw.items()}
    rev = r.get("revenue")
    try:
        rev = int(float(rev)) if rev not in (None, "") else None
    except (TypeError, ValueError):
        rev = None
    return {"key": str(r.get("key") or r.get("website") or r.get("name") or n), "name": r.get("name") or "",
            "city": r.get("city") or "", "state": r.get("state") or "", "revenue": rev,
            "headcount": None, "ntee": r.get("ntee") or "", "website": r.get("website") or "",
            "size": f"${rev:,} revenue" if rev else "", "account_source": where}


def api_rows(src: dict, cache: Path, call=None) -> list[dict]:
    """One call per query in `queries` (Maps returns 20 places a query), deduped on the place
    id or site, then kept or dropped on the place's category. Each answer is cached under
    `cache`, so a rerun asks nothing it already asked."""
    import gtme_operator as op
    call = call or op.api
    cols = src.get("columns") or {"title": "name", "displayName": "name"}
    keep = re.compile(src["keep_category"], re.I) if src.get("keep_category") else None
    drop = re.compile(src["drop_category"], re.I) if src.get("drop_category") else None
    queries = src.get("queries") or [None]
    out, seen = [], set()
    cache.mkdir(parents=True, exist_ok=True)
    for q in queries:
        args = dict(src.get("args") or {}, **({"query": q} if q else {}))
        hit = cache / ("api-" + re.sub(r"[^a-z0-9]+", "-", json.dumps(args, sort_keys=True).lower())[:120] + ".json")
        if hit.exists():
            res = json.loads(hit.read_text())
        else:
            res = call(src["site"], src["op"], **args)
            if res.get("ok") is False:
                if q is None:
                    raise Refused(f"chewbacca api {src['site']} {src['op']} failed: {res.get('reason')}")
                print(f"gtme accounts: query {q!r} failed: {res.get('reason')}", file=sys.stderr)
                continue
            hit.write_text(json.dumps(res))
        where = f"chewbacca api {src['site']} {src['op']}" + (f" {q!r}" if q else "")
        for raw in _first_list(res):
            cats = " ".join([str(raw.get("category") or "")] + [str(c) for c in raw.get("categories") or []])
            if (keep and not keep.search(cats)) or (drop and drop.search(cats)):
                continue
            r = _mapped(raw, cols, len(out), where)
            k = raw.get("placeId") or urllib.parse.urlparse(r["website"]).netloc.removeprefix("www.") or r["name"]
            if k in seen:
                continue
            seen.add(k)
            r["key"] = str(k)
            r["category"] = str(raw.get("category") or "")
            if not r["city"] and raw.get("address"):
                # "1338 W Indianapolis Ave, Fresno, CA 93705"
                parts = [x.strip() for x in str(raw["address"]).split(",")]
                # ARC's finder ends with ", United States"
                if parts and parts[-1].lower() in ("united states", "usa", "us"):
                    parts = parts[:-1]
                if len(parts) >= 3:
                    r["city"], r["state"] = parts[-2], parts[-1].split()[0]
            if raw.get("reviewCount") is not None:
                r["size"] = f"{raw['reviewCount']} Google reviews"
            # a directory op (ARC's finder) answers by radius, so it crosses state lines
            if src.get("state") and r["state"] and r["state"].upper() != src["state"].upper():
                continue
            out.append(r)
    return out


def csv_rows(src: dict, cache: Path) -> list[dict]:
    path = Path(os.path.expanduser(src["path"]))
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return [_mapped(r, src.get("columns") or {}, i, str(path)) for i, r in enumerate(csv.DictReader(fh))]


def _domain(url: str) -> str:
    from urllib.parse import urlparse
    host = urlparse(url if "://" in url else "http://" + url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def maps_rows(src: dict, cache: Path, call=None) -> list[dict]:
    """Google Maps, every query in every place, one row per website. Each search returns at
    most 20 places, so a market needs many: the 2026-11-02 Michigan PIP list took 20 searches
    (2 phrasings x 10 cities) run by hand, and that's what this replaces.

    "source": {"kind": "maps", "queries": ["no-fault PIP attorney", "auto accident lawyer"],
               "places": ["Southfield MI", "Troy MI"], "state": "MI", "exclude": "Morgan|Mike Morse"}
    """
    import gtme_operator as op
    call = call or (lambda q: op.api("google-maps", "searchPlaces", query=q))
    state = (src.get("state") or "").upper()
    skip = re.compile(src["exclude"], re.I) if src.get("exclude") else None
    seen, out = set(), []
    for place in src.get("places") or [""]:
        for q in src.get("queries") or []:
            query = f"{q} in {place}".strip() if place else q
            res = call(query)
            if res.get("ok") is False:
                print(f"gtme accounts: maps search failed, skipped: {query}: {res.get('reason')}", file=sys.stderr)
                continue
            for r in _first_list(res):
                site, addr = r.get("website") or "", r.get("address") or ""
                dom = _domain(site)
                if not dom or dom in seen:
                    continue
                if state and not re.search(rf",\s*{state}\s+\d{{5}}", addr):
                    continue
                if skip and skip.search(f"{r.get('name', '')} {dom}"):
                    continue
                seen.add(dom)
                city = addr.split(",")[-2].strip() if addr.count(",") >= 2 else ""
                out.append(_mapped({"key": dom, "name": r.get("name") or "", "website": site.split("?")[0],
                                    "city": city, "state": state}, {}, len(out), f"google maps: {query}"))
    return out


def name_key(name: str) -> str:
    """A company name reduced for an exact match: "Hamo Law Firm - Auto Accident Lawyers" and
    "Hamo Law Firm, PLLC" both become "hamolawfirm". A loose substring match tied 37 of 38
    LinkedIn posts to the wrong firm on 2026-11-02 (Blue Cross to Michigan Injury Attorneys)."""
    base = re.split(r"\s[-|]\s", name or "")[0]
    base = re.sub(r"(?i)\b(pllc|p\.?c\.?|llp|llc|inc\.?|ltd\.?|co\.?)(?=\W|$)", "", base)
    return re.sub(r"[^a-z0-9]", "", base.lower())


def linkedin_hiring(cfg: dict, call=None) -> dict:
    """{org_key: [job]} from LinkedIn's public job search, every keyword in every place.

    "why_now": {"linkedin_jobs": {"keywords": ["no-fault paralegal"], "places": ["Southfield, Michigan"]}}
    """
    import gtme_operator as op
    call = call or (lambda kw, loc: op.api("linkedin-jobs", "searchJobs", keywords=kw, location=loc))
    out: dict = {}
    for place in cfg.get("places") or [""]:
        for kw in cfg.get("keywords") or []:
            res = call(kw, place)
            for j in _first_list(res) if res.get("ok") is not False else []:
                k = name_key(j.get("company", ""))
                if len(k) >= 6:
                    out.setdefault(k, []).append({"title": j.get("title", ""), "url": j.get("url", ""),
                                                  "date": j.get("postedDate", "")})
    return out


# ── signal first: search for the signal, then find the org ─────────────────

# On 11/2 the Baptize list read 1,357 churches from Maps to find 76 that posted a baptism this
# year (about 5%). A search for the signal itself ("baptism 2026" on Church Center) found real
# California churches on its first page. Guessed, never measured: one SERP page is 10 results.
# On 11/3 a hand-built sample stripped one title off "Rev. Dr. Mathew P. John" and greeted him
# "Hi Dr.,"; gtme-grade caught it. Titles stack, so strip them all.
HONORIFIC = re.compile(r"^(?:(?:pastor|rev(?:erend)?|dr|bishop|apostle|elder|minister|mr|mrs|ms)\.?\s+)+", re.I)


def greeting_name(full: str) -> str:
    """The first name a cold email greets: every leading title stripped, ALL CAPS fixed."""
    rest = HONORIFIC.sub("", (full or "").strip())
    first = rest.split()[0] if rest.split() else ""
    return first.title() if first.isupper() and len(first.strip(".")) > 2 else first


SEARCH_ENDPOINT = "treg.google.serp.organic"
SEARCH_MAX_USD = 0.002  # routed SERP lists at $0.00015 to $0.002 a page (treg catalog, 11/2)
SHARED_SIGNAL_HOSTS = ("churchcenter.com", "subsplash.com")


def _get_html(url: str) -> str:
    """A page from a search result or a lead's site, through gtme_solo's guarded fetch: http and
    https only, every host resolved and refused when it isn't a public address, the connection
    pinned to that address and every redirect hop checked again. A security review on 2026-11-03
    found this one used a bare urlopen that followed redirects anywhere, including to private
    addresses, for URLs that come from search results and strangers' sites."""
    import gtme_solo  # lazy: gtme_solo never imports this module, so there's no cycle
    return gtme_solo.fetch(url, limit=400000)


ORG_WORDS = re.compile(r"church|chapel|fellowship|ministr|assembl|tabernacle|cathedral|parish|worship center|"
                       r"christian center|community|bible|baptist|vineyard|calvary", re.I)
PAGE_WORDS = re.compile(r"^(home|welcome|baptisms?|events?|register|registration|sign ?up|about( us)?|"
                        r"next steps|calendar|404|page not found)$", re.I)
# Hosts that list many orgs or none: on 11/2, 245 of 690 Baptize search results were google.com
# links and 70 more were Facebook, Yelp and Instagram.
NOT_ORG_HOSTS = ("google.com", "yelp.com", "facebook.com", "instagram.com", "eventbrite.com", "youtube.com",
                 "tiktok.com", "x.com", "twitter.com", "wikipedia.org", "linkedin.com", "happeningnext.com",
                 "allevents.in", "patch.com", "nextdoor.com")


def org_name_from_page(html: str) -> str:
    """The org's name from a page title: Church Center writes "<page> - <church>" (a 404 for an
    old event too), most sites "<Church> | Home" or "Home - <Church>" or just the name."""
    m = re.search(r'property="og:site_name" content="([^"]+)"', html) or \
        re.search(r'property="og:title" content="([^"]+)"', html) or re.search(r"<title[^>]*>([^<]+)", html)
    title = re.sub(r"\s+", " ", (m.group(1) if m else "")).strip()
    parts = [x.strip() for x in re.split(r"\s+[-|\u2013\u2014:\u00b7]\s+", title) if x.strip()]
    parts = [x for x in parts if not PAGE_WORDS.match(x)]
    if not parts:
        return ""
    named = [x for x in parts if ORG_WORDS.search(x)]
    return (named[-1] if named else max(parts, key=len))[:80]


def search_rows(src: dict, cache: Path, call=None, fetch=None, place=None) -> list[dict]:
    """Accounts found by searching for the signal. Each search hit becomes the org's seeded
    signal line (its title, date and snippet, with its link); a hit on a shared host like Church
    Center is resolved to the church by the page's title, then to its own site on Maps. Every
    search is a metered treg call, so the client's `budget_usd` caps it, and each answer is cached
    so a rerun pays for nothing twice."""
    import gtme_operator as op
    cache.mkdir(parents=True, exist_ok=True)
    spend = cache / "spend.jsonl"
    customer = src.get("customer") or "gtme"
    call = call or (lambda q: treg_client.call(src.get("endpoint") or SEARCH_ENDPOINT,
                                               {"q": q, "country": "us", "limit": int(src.get("per_query") or 10)},
                                               customer=customer, spend_file=spend,
                                               budget_usd=float(src.get("budget_usd") or 0),
                                               max_cost_usd=float(src.get("max_cost_usd") or SEARCH_MAX_USD)))
    fetch = fetch or _get_html
    place = place or (lambda q: op.api("google-maps", "searchPlaces", query=q))
    skip = NOT_ORG_HOSTS + tuple(src.get("skip_hosts") or [])
    keep = re.compile(src["keep_category"], re.I) if src.get("keep_category") else None
    drop = re.compile(src["drop_category"], re.I) if src.get("drop_category") else None
    state = (src.get("state") or "").upper()
    hits: dict[str, dict] = {}
    for q in src.get("queries") or []:
        hit = cache / ("search-" + re.sub(r"[^a-z0-9]+", "-", q.lower())[:120] + ".json")
        if hit.exists():
            res = json.loads(hit.read_text())
        else:
            try:
                res = call(q)
            except treg_client.Refused as e:
                raise Refused(f"search source: {e}")
            hit.write_text(json.dumps(res))
        out = res.get("output") if isinstance(res.get("output"), dict) else res
        for r in out.get("results") or []:
            url = r.get("url") or ""
            host = _domain(url)
            if not host or any(host == h or host.endswith("." + h) for h in skip):
                continue
            # A label match, so evilchurchcenter.com isn't read as churchcenter.com (review, 11/3).
            shared = any(host == h or host.endswith("." + h) for h in SHARED_SIGNAL_HOSTS)
            key = host if shared or not any(host.endswith(h) for h in SHARED_HOSTS) else host + urllib.parse.urlparse(url).path
            # crawl4ai calls it snippet; the scrapecreators fallback treg routes to calls it description
            line = " / ".join(x for x in (r.get("title"), r.get("date"), r.get("snippet") or r.get("description")) if x)
            hits.setdefault(key, {"shared": shared, "url": url, "lines": []})["lines"].append(line[:300])
    # each hit costs a page fetch and a Maps lookup to resolve; on 11/3 a 40-query round reran
    # all ~700 old hits for 20+ minutes before reaching the new ones, so resolutions are cached
    resolved_file = cache / "resolved.json"
    resolved = json.loads(resolved_file.read_text()) if resolved_file.exists() else {}
    rows = []
    for key, h in hits.items():
        name = website = city = category = ""
        st = ""
        if key in resolved:
            name, website, p = resolved[key]["name"], resolved[key]["website"], resolved[key]["place"]
        else:
            if h["shared"]:
                name = org_name_from_page(fetch(h["url"]))
            else:
                u = urllib.parse.urlparse(h["url"])
                website = f"{u.scheme or 'https'}://{u.netloc}/"
                name = org_name_from_page(fetch(website)) or ""
            lookup = f"{name} {state}".strip() if name else ""
            p, res = {}, {}
            if lookup:
                res = place(lookup)
                cands = _first_list(res) if isinstance(res, dict) else (res or [])
                if not h["shared"]:
                    # the org's own site: the place has to list this same domain
                    p = next((c for c in cands if c.get("website") and _domain(c["website"]) == _domain(website)), {})
                else:
                    # a Church Center page: the place whose name matches the church the page names
                    p = next((c for c in cands if gtme_score.jaro_winkler(
                        gtme_score.normalize_company_name(c.get("name") or ""),
                        gtme_score.normalize_company_name(name)) >= NAME_MATCH), {})
            # a failed fetch or Maps call may be a blip, so only an answer is kept
            if name and not (isinstance(res, dict) and res.get("reason")):
                resolved[key] = {"name": name, "website": website, "place": p}
                resolved_file.write_text(json.dumps(resolved))
        if p:
            parts = [x.strip() for x in str(p.get("address") or "").split(",")]
            city, st = (parts[-2], parts[-1].split()[0]) if len(parts) >= 3 else ("", "")
            category = str(p.get("category") or "")
            website = website or p.get("website") or ""
            name = p.get("name") or name
        if not website or not name or (state and st and st.upper() != state):
            continue
        if (keep and not keep.search(category)) or (drop and drop.search(category)):
            continue
        # a page's own title names the church, so a stranger's page could claim any name: when the
        # hit was the org's own site, Maps has to list that same domain, and a place with no site
        # can't vouch for it either (fail closed, security review 11/2)
        if not h["shared"] and (not p.get("website") or _domain(p["website"]) != _domain(website)):
            continue
        rows.append({"key": _domain(website), "name": name, "city": city, "state": st, "revenue": None,
                     "headcount": None, "ntee": "", "website": website, "category": category,
                     "size": f"{p.get('reviewCount')} Google reviews" if p.get("reviewCount") is not None else "",
                     "account_source": f"search: {h['url']}",
                     "seed_signals": {src.get("signal") or "signal": [{"url": h["url"], "lines": h["lines"]}]}})
    return rows


SOURCES = {"irs_eo": irs_rows, "formd": formd_rows, "api": api_rows, "csv": csv_rows, "maps": maps_rows,
           "search": search_rows}


# ── step 3: enrich ───────────────────────────────────────────────────────


def site_audit():
    """Firm Foundation's site audit and lead card. They live in that repo, not the kit, so the
    folder comes from GTME_SITE_AUDIT_DIR or the usual checkout. No audit means no buyers, so
    a missing one refuses instead of shipping a list of names with nobody to write to."""
    d = Path(os.environ.get("GTME_SITE_AUDIT_DIR") or Path.home() / "code" / "firm-foundation" / "ops" / "audit")
    if not (d / "audit_site.py").exists():
        raise Refused(f"Firm Foundation's site audit isn't at {d}. Clone gavinjmunroe/firm-foundation there, "
                      f"or set GTME_SITE_AUDIT_DIR.")
    sys.path.insert(0, str(d))
    import audit_site
    import lead_card
    if "titles" not in inspect.signature(audit_site.audit).parameters:
        # FF 93a65fb added titles="org". Without it the audit keeps church buyers only and
        # the AuraPath list (10/29) got a buyer for 9 of 52 orgs, so say so instead of quietly.
        print(f"gtme accounts: the site audit at {d} predates titles=\"org\" (FF 93a65fb), so it reads "
              f"church titles only and most CEOs, presidents and CTOs will be missed. Pull firm-foundation.",
              file=sys.stderr)
    return audit_site, lead_card


def news(lead_card, name: str, words: re.Pattern, growth: re.Pattern) -> list[dict]:
    q = urllib.parse.quote(f'"{name}"')
    try:
        root = lead_card.ET.fromstring(lead_card.get(
            f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"))
    except Exception:
        return []
    now = dt.datetime.now(dt.timezone.utc)
    hits, grow = [], []
    for it in root.iter("item"):
        title = it.findtext("title") or ""
        try:
            when = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "")
        except (TypeError, ValueError):
            continue
        if (now - when).days > NEWS_DAYS:
            continue
        row = {"date": when.date().isoformat(), "title": title, "url": it.findtext("link") or ""}
        if words.search(title):
            hits.append(row)
        elif growth.search(title):
            grow.append(row)
    return hits[:3] + grow[:3]


def leaders(contacts, titles=None, keep_all: bool = False, cap: int | None = None) -> list[dict]:
    """The people worth scoring. The client's own `titles` are kept and ranked first, so any
    ICP works from its config; the built-in LEADER words cover the markets Dough has run."""
    mine = [t.lower() for t in titles or [] if t]

    def icp_rank(title: str) -> int:
        t = title.lower()
        return next((i for i, w in enumerate(mine) if w in t), len(mine))

    if keep_all:
        # the audit's own title table already chose them (titles="pastors"): keep them all, client titles first
        return sorted(contacts or [], key=lambda c: icp_rank(c.get("title", "")))[:cap or LEADERS_KEPT]
    out = [c for c in contacts or [] if LEADER.search(c.get("title", "")) or icp_rank(c.get("title", "")) < len(mine)]
    out.sort(key=lambda c: (icp_rank(c["title"]),
                            0 if re.search(r"technology|information|\bit\b|cto|cio|data|digital", c["title"], re.I)
                            else 1 if re.search(r"operat|coo", c["title"], re.I) else 2))
    return out[:LEADERS_KEPT]



OFFSITE_SIGNAL_HOSTS = (".churchcenter.com", ".subsplash.com")


def without_org(line: str, org: str) -> str:
    """The line with the org's own name words taken out, so a signal can't match on the name.
    On 11/2 "baptis" matched every church named Baptist, and only Baptize's config was fixed."""
    for w in set(re.findall(r"[A-Za-z]{4,}", org or "")):
        line = re.sub(r"\b" + re.escape(w) + r"\b", " ", line, flags=re.I)
    return line
# On the 11/2 Baptize run, 514 of 698 churches showed no baptism line on the home page or the 3
# links it named, though many keep a /baptism page the menu hides. A sitemap lists it.
SITEMAP_MAX = 3
# 855 sites took about 55 minutes at 10 workers on 11/2: ~39 seconds a site per worker
SECONDS_PER_SITE = 39


def sitemap_urls(audit_site, base: str) -> list[str]:
    """Page addresses from the site's sitemap.xml, following up to SITEMAP_MAX child sitemaps."""
    root = urllib.parse.urljoin(base, "/sitemap.xml")
    todo, seen, out = [root], set(), []
    while todo and len(seen) <= SITEMAP_MAX:
        u = todo.pop(0)
        if u in seen:
            continue
        seen.add(u)
        try:
            r = audit_site.fetch(u)
        except Exception:
            continue
        body = r.get("html") or ""
        if (r.get("status") or 0) >= 400 or "<loc>" not in body:
            continue
        locs = [x.strip() for x in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", body)]
        if "<sitemapindex" in body:
            # pages and posts first; a WordPress index also lists tags and authors
            todo += sorted(locs, key=lambda x: not re.search(r"page|post|sitemap\.xml$", x))
        else:
            out += locs
    return out


def page_lines(audit_site, start: str, signals: list[dict], max_pages: int = 3, max_lines: int = 14,
               org: str = "") -> dict:
    """{signal name: [{"url", "lines"}]}: the org's own pages whose link text or address says the
    signal's link_words (the home page too), and the lines on them that say its line_words, each
    kept with the line after it, since a baptism heading's date is often on the next line."""
    out: dict[str, list] = {}
    home = audit_site.fetch(start)
    if not home.get("html"):
        return out
    base = home.get("final_url") or start
    hp = audit_site.parse(home["html"])
    for sig in signals:
        link = re.compile(sig.get("link_words") or sig["line_words"], re.I)
        line = re.compile(sig["line_words"], re.I)
        urls, pages = [], [(base, hp)]
        for href, text, _ in hp.links:
            u = urllib.parse.urljoin(base, href).split("#")[0]
            host = urllib.parse.urlparse(u).netloc.lower()
            # baptism sign-ups often live on the church's Planning Center or Subsplash page
            ours = audit_site.same_site(u, base) or host.endswith(OFFSITE_SIGNAL_HOSTS)
            if (link.search(text or "") or link.search(urllib.parse.urlparse(u).path)) and \
                    ours and u.rstrip("/") != base.rstrip("/") and u not in urls:
                urls.append(u)
        if sig.get("sitemap"):
            for u in sitemap_urls(audit_site, base):
                if line.search(urllib.parse.urlparse(u).path) and audit_site.same_site(u, base) and u not in urls:
                    urls.insert(0, u)
        # a link that names the signal itself ("Baptism") before a broad one ("Events")
        urls.sort(key=lambda u: not line.search(urllib.parse.urlparse(u).path + " " + " ".join(
            t for h, t, _ in hp.links if urllib.parse.urljoin(base, h).split("#")[0] == u)))
        for u in urls[:max_pages]:
            r = audit_site.fetch(u)
            if r.get("html") and (r.get("status") or 0) < 400:
                pages.append((r.get("final_url") or u, audit_site.parse(r["html"])))
        hits = []
        for u, pg in pages:
            ls = pg.clean_lines
            got = [" / ".join(x for x in ls[i:i + 2] if len(x) <= 300) for i, l in enumerate(ls)
                   if line.search(without_org(l, org))]
            if got:
                hits.append({"url": u, "lines": got[:max_lines]})
        out[sig["name"]] = hits
    return out



def enrich_one(a: dict, tools, words, growth, acc: dict | None = None, titles=None, must_show="") -> dict:
    audit_site, lead_card = tools
    acc = acc or {}
    rec = dict(a)
    if not rec.get("website"):
        try:
            place = lead_card.resolve(f"{a['name']} {a['city']} {a['state']}".strip())
        except Exception as e:
            place, rec["error"] = None, f"maps: {e}"
        if place:
            rec.update({"website": place.get("website", ""), "maps_name": place.get("name", "")})
    if rec.get("website"):
        try:
            # titles="org": executive, tech, ops and finance chiefs, not the church buyer rules
            params = inspect.signature(audit_site.audit).parameters
            mode = acc.get("audit_titles") or "org"
            if "buyer_titles" in params:
                au = audit_site.audit(rec["website"], None, titles=mode, buyer_titles=titles)
            elif "titles" in params:
                au = audit_site.audit(rec["website"], None, titles=mode)
            else:
                au = audit_site.audit(rec["website"], None)
            rec["site_status"] = au.get("status")
            rec["final_url"] = au.get("final_url") or ""
            rec["leaders"] = leaders(au.get("contacts"), titles, keep_all=bool(acc.get("per_person")),
                                     cap=int(acc.get("max_people") or 0) or None)
            rec["site_people"] = au.get("staff_count")
            rec["titles_key"] = titles_key(titles, must_show)
            if must_show:
                rec["icp_fit"] = icp_evidence(audit_site, lead_card, au.get("final_url") or rec["website"], must_show)
            if acc.get("page_signals") and au.get("status") == "ok":
                rec["signals"] = page_lines(audit_site, au.get("final_url") or rec["website"], acc["page_signals"],
                                            org=rec.get("maps_name") or rec.get("name", ""))
            # A search snippet only says where to look. Its text is a stranger's page as Google
            # summarized it, so it's kept apart and never reaches a Jev check or a quoted line:
            # only what the org's own site says does (security review, 11/2).
            if rec.get("seed_signals"):
                rec["search_hits"] = rec["seed_signals"]
            rec["page_emails"] = [e.get("email") for e in au.get("page_emails") or []][:8]
            rec["chms"] = au.get("chms") or ""
            rec["jobs"] = lead_card.jobs(au.get("final_url") or rec["website"])
        except Exception as e:
            rec["site_status"] = f"error: {e}"
    rec["news"] = news(lead_card, a["name"], words, growth)
    return rec


def titles_key(titles, must_show="") -> str:
    return "|".join(sorted(t.lower() for t in titles or [])) + ("#" + must_show if must_show else "")


ICP_LINK = re.compile(r'href="([^"#]+)"[^>]*>([^<]{0,80})<', re.I)
BLOCKED = re.compile(r"\b403\b|forbidden|access denied|just a moment|captcha|attention required|are you a robot", re.I)
ICP_PAGES = 4  # links followed past the home page; PIP work sat one click deep on 2026-11-02


def page_html(audit_site, lead_card, url: str) -> tuple[str, str]:
    """(html, final url). The audit's fetcher first: plain urllib was refused by 46 of 145 law sites."""
    fetch = getattr(audit_site, "fetch", None)
    if fetch:
        d = fetch(url) or {}
        return d.get("html") or "", d.get("final_url") or url
    try:
        return lead_card.get(url) or "", url
    except Exception:
        return "", url


def same_site(link: str, home: str) -> bool:
    from urllib.parse import urlparse
    u = urlparse(link)
    if u.scheme not in ("http", "https") or not u.hostname:
        return False
    if re.fullmatch(r"[\d.]+|\[?[0-9a-f:]+\]?", u.hostname) or u.hostname == "localhost":
        return False
    a, b = _domain(link), _domain(home)
    return a == b or a.endswith("." + b)


def icp_evidence(audit_site, lead_card, url: str, must_show: str) -> dict:
    """Does the org's own site show it does the thing the ICP needs? The matching line and the
    page it sits on, or ok False. On 2026-11-02 75 of 145 Michigan injury firms showed no-fault
    or PIP work, and that check ran as a side script outside Dough."""
    rx = re.compile(must_show, re.I)
    html, final = page_html(audit_site, lead_card, url)
    # A site that blocks us or won't load is unread, never "doesn't do the work": Sinas Dramis,
    # one of Michigan's best-known no-fault firms, answered 403 on 2026-11-02 and came back "no"
    words = re.sub(r"<[^>]+>", " ", html).split()
    if not html.strip() or (len(words) < 150 and BLOCKED.search(html)):
        return {"ok": None, "line": "", "url": final, "why": "site unread (blocked or empty)"}
    pages = [(html, final)]
    words = re.compile(must_show + r"|practice|services|what we do|about", re.I)
    from urllib.parse import urljoin
    for href, text in ICP_LINK.findall(html)[:400]:
        if len(pages) > ICP_PAGES:
            break
        link = urljoin(final, href)
        # only the org's own pages over http(s): a scraped href can point anywhere, file:// and
        # localhost included, and those were never what "does their site show the work" asks
        if words.search(href + " " + text) and same_site(link, final):
            pages.append(page_html(audit_site, lead_card, link))
    for h, u in pages:
        text = re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", h))
        m = rx.search(text)
        if m:
            line = re.sub(r"\s+", " ", text[max(0, m.start() - 100):m.end() + 100]).strip()
            return {"ok": True, "line": line, "url": u}
    return {"ok": False, "line": "", "url": final if html else ""}


def enrich(accounts: list[dict], work: Path, tools, words, growth, workers: int, refresh: bool,
           titles=None, must_show="", acc: dict | None = None, refresh_signals: bool = False,
           refresh_empty: str | bool = False) -> list[dict]:
    path = work / "enriched.jsonl"
    done, lines = {}, 0
    if path.exists() and not refresh:
        for line in path.read_text().splitlines():
            if line.strip():
                lines += 1
                r = json.loads(line)
                # a Maps or audit error is a lookup that didn't happen, so it's retried, never kept
                # a read made for other buyer titles found other people, so it's read again
                stale = r.get("website") and r.get("titles_key", "") != titles_key(titles, must_show)
                if not r.get("error") and not str(r.get("site_status") or "").startswith("error") and not stale:
                    done[r["key"]] = r
    if refresh_signals and (acc or {}).get("page_signals"):
        # page signals changed (a new word, the sitemap) but staff pages didn't: reread only those
        again = [r for r in done.values() if r.get("site_status") == "ok"]
        print(f"gtme accounts: rereading page signals for {len(again)} cached accounts", file=sys.stderr)

        def resig(r):
            try:
                r["signals"] = page_lines(tools[0], r["website"], acc["page_signals"],
                                          org=r.get("maps_name") or r.get("name", ""))
            except Exception as e:
                r["signals_error"] = str(e)[:200]
            return r
        with cf.ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(resig, again))
        refresh = True  # rewrite the cache file below with the new signals
    if refresh_empty:
        # the audit learned new titles: reread the sites that showed a signal but no person
        # Only the signal that matters: on 11/2 "any signal" counted belief and story lines, which
        # nearly every site has, and a reread meant for ~250 sites ran 694 for 45 minutes.
        names = [refresh_empty] if isinstance(refresh_empty, str) else None
        empty = [k for k, r in done.items() if r.get("site_status") == "ok" and not r.get("leaders")
                 and any(p.get("lines") for n, v in (r.get("signals") or {}).items() if names is None or n in names
                         for p in v)]
        print(f"gtme accounts: rereading {len(empty)} cached accounts with a {'/'.join(names or ['page'])} signal and no "
              f"person, about {max(1, round(len(empty) * SECONDS_PER_SITE / max(workers, 1) / 60))} minutes",
              file=sys.stderr)
        for k in empty:
            del done[k]
    todo = [a for a in accounts if a["key"] not in done]
    print(f"gtme accounts: {len(accounts)} accounts, {len(done)} cached, {len(todo)} to read", file=sys.stderr)
    # rewrite when errors were dropped, so the file only ever holds lookups that happened
    rewrite = refresh or refresh_signals or refresh_empty or lines != len(done)
    with cf.ThreadPoolExecutor(max_workers=workers) as ex, open(path, "w" if rewrite else "a") as fh:
        if rewrite:
            for rec in done.values():
                fh.write(json.dumps(rec) + "\n")
        for rec in ex.map(lambda a: enrich_one(a, tools, words, growth, acc, titles, must_show), todo):
            with lock:
                fh.write(json.dumps(rec) + "\n")
                fh.flush()
                done[rec["key"]] = rec
    return [done[a["key"]] for a in accounts]


# ── step 4: score ────────────────────────────────────────────────────────


def same_org(name: str, maps_name: str | None) -> bool:
    if not maps_name:
        return True  # the site came with the account, nothing to mismatch
    a, b = gtme_score.normalize_company_name(name), gtme_score.normalize_company_name(maps_name)
    short = a if len(a) <= len(b) else b
    # a one-word name inside a longer one is a different org: "Hope" in "Hope Mission Thrift Store"
    # but an acronym the place spells in capitals is that org: IRS "KCS Inc" is "KCS Health Center"
    acronym = len(short.split()) == 1 and re.search(r"\b" + re.escape(short.upper()) + r"\b", maps_name or "")
    contained = (len(short.split()) >= 2 or bool(acronym)) and (a in b or b in a)
    return bool(b) and (gtme_score.jaro_winkler(a, b) >= NAME_MATCH or contained)


def own_news(name: str, items: list[dict]) -> list[dict]:
    """Headlines that name this org, every word of it as a capitalized phrase. A first-word
    match tied "The Well" to Bitcoin Well and "Urban Impact" to a Thai university on 10/28."""
    full = gtme_score.normalize_company_name(name).split()
    while full and full[0] == "the":
        full = full[1:]
    while full and full[-1] in ("inc", "ministries", "church"):
        full = full[:-1]
    words = full if len(full) > 1 else gtme_score.normalize_company_name(name).split()
    if not words or len(" ".join(words)) <= 5:
        return []
    # A two-word-plus name is matched in any case, so IEHP and YMCA match; a one-word name has
    # to be capitalized in the headline, so "positive urban impact" isn't the ministry. Small
    # words stay in the phrase ("YMCA of Greater Los Angeles").
    small = ("of", "and", "the", "for", "in")
    body = r"\W+".join(re.escape(w) if (len(words) > 1 or w in small) else re.escape(w.capitalize()) for w in words)
    pat = re.compile(r"\b" + body + r"\b", re.I if len(words) > 1 else 0)
    return [n for n in items or [] if pat.search(n["title"]) and not LISTICLE.search(n["title"])]


def score(rec: dict, acc: dict, words: re.Pattern, today: dt.date, about=None) -> dict:
    criteria = acc.get("criteria") or {}
    cands = [{"contact_id": c.get("email") or c.get("name"), "full_name": c.get("name"), "title": c.get("title", ""),
              "email": c.get("email") or "", "email_verified": False,  # published, never run through a validator
              "source_url": c.get("source_url", "")} for c in map(name_from_title, rec.get("leaders") or [])
             if is_person(c.get("name")) and (own_page(c.get("source_url", ""), rec.get("website", ""))
                                              or bool(site_home(rec)) and own_page(c.get("source_url", ""), site_home(rec)))
             and not GONE.search(c.get("title", ""))
             # a client can rule titles out: coordinators aren't on Travis's 11/2 Baptize title list,
             # and list-gate refused two of them as too junior to decide
             and not (acc.get("exclude_titles") and re.search(acc["exclude_titles"], c.get("title", ""), re.I))]
    prim = gtme_score.resolve_primary(cands, acc["titles"]) if cands else None
    pc = next((c for c in cands if prim and c["contact_id"] == prim["primary_contact_id"]), None)
    items = own_news(rec["name"], rec.get("news"))
    sigs = [{"what": n["title"], "date": n["date"], "scope": "company", "company_match": True, "source": n["url"]}
            for n in items]
    # a job post is the org's own but undated on most sites, so it scores as relevance only
    sigs += [{"what": "hiring: " + j["title"], "date": j.get("date", ""), "scope": "company", "company_match": True,
              "source": j["url"]} for j in rec.get("jobs") or []]
    # Jev asks whether each signal is about THIS org; under 0.8 it's dropped, no answer is HOLD
    org = {"name": rec.get("maps_name") or rec["name"], "city": rec.get("city", ""), "state": rec.get("state", ""),
           "website": rec.get("website", "")}
    sig = gtme_score.signal_strength(sigs, today, org=org, about=about)
    gone = {d.get("what") for d in sig.get("dropped") or []}
    need = any(j for j in rec.get("jobs") or [] if "hiring: " + j["title"] not in gone) or \
        any(words.search(n["title"]) for n in items if n["title"] not in gone)
    company = {"estimated_revenue": rec.get("revenue"), "estimated_headcount": rec.get("headcount")}
    # a Form D company files no revenue, so what it just raised stands in when the client sets raise_range
    in_band = gtme_score._in_range(rec.get("revenue"), criteria.get("revenue_range")) or \
        gtme_score._in_range(rec.get("headcount"), criteria.get("headcount_range")) or \
        (bool(criteria.get("raise_range")) and gtme_score._in_range(rec.get("raised"), criteria["raise_range"]))
    if rec.get("raised") and not rec.get("revenue"):
        company["estimated_revenue"] = rec["raised"] if in_band and criteria.get("raise_range") else None
        if company["estimated_revenue"] is not None:
            criteria = dict(criteria, revenue_range=criteria["raise_range"])
    stack = bool(KNOWN_STACK.search(rec.get("chms") or ""))
    icp = rec.get("icp_fit") or {}
    sized = rec.get("revenue") or rec.get("headcount") or rec.get("raised")
    # A market with no size data (law firms, 2026-11-02: all 145 tier 3) is judged on whether
    # its own site shows the work the ICP needs. That stands in for the size band, never on top.
    on_icp = bool(icp.get("ok")) and not sized
    # People named on the org's own team page, against the client's band for that count. A firm
    # of 10 to 150 staff shows roughly 3 to 60 people; the site figure only ever holds a row
    # back, since a page can list fewer people than work there. Michigan PIP, 2026-11-02.
    people, band = rec.get("site_people"), criteria.get("site_people_range")
    too_big = bool(band and people and band.get("max") and people > band["max"])
    # Weights guessed from John Knox's 10/27 call, never measured: can they pay (40), a system
    # to connect (20), someone who signs (20), a reason to help now (20).
    fit = 40 * (in_band or on_icp) + 20 * stack + 20 * bool(pc) + 20 * need
    if too_big:
        fit = min(fit, gtme_score.TIER_2 - 1)
    if "must_show" in (acc.get("icp") or {}) and not icp.get("ok"):
        fit = min(fit, gtme_score.TIER_2 - 1)  # the site never showed the ICP's work: never above tier 3
    tier = gtme_score.assign_tier(fit, bool(pc and pc.get("email")), company, criteria)
    if on_icp and tier["tier"] == 2 and fit >= gtme_score.TIER_1 and pc and pc.get("email"):
        tier = {"tier": 1, "rationale": f"Tier 1: fit score {fit}/100, with a reachable primary, the ICP's work "
                                        f"shown on its own site (no size data in this market)."}
    top = sig["top"][0] if sig["top"] else {}
    lanes = acc.get("lanes") or {}
    return {"tier": tier["tier"], "fit": fit, "why_now_score": sig["score"], "hold": "HOLD" if sig["hold"] else "",
            "kind": lanes.get((rec.get("ntee") or " ")[0].upper(), acc.get("kind", "account")),
            "org": rec.get("maps_name") or rec["name"], "city": rec["city"], "state": rec["state"],
            "website": rec.get("website", ""), "revenue": rec.get("revenue") or "",
            "size": rec.get("size") or (f"{people} people on its site" + (" (over the band)" if too_big else "")
                                        if people else ""),
            "stack": rec.get("chms") or "", "buyer": (pc or {}).get("full_name", ""),
            "buyer_first": greeting_name((pc or {}).get("full_name", "")),
            "buyer_title": (pc or {}).get("title", ""), "buyer_email": (pc or {}).get("email", ""),
            "buyer_source": (pc or {}).get("source_url", ""), "buyer_check": "", "relationship": "",
            "channel": "", "dnc": "", "treg_find": "", "dupe_of": "",
            "why_now": top.get("what", ""), "why_now_date": top.get("date", ""),
            "why_now_source": top.get("source", ""), "tier_rationale": tier["rationale"],
            "account_source": rec.get("account_source", ""), "icp_fit": "yes" if icp.get("ok") else
            ("unread" if icp.get("ok") is None and "ok" in icp else "no" if "ok" in icp else ""), "icp_line": icp.get("line", "")[:240], "icp_source": icp.get("url", ""),
            "_page_emails": rec.get("page_emails") or []}


# ── step 5: Jev ──────────────────────────────────────────────────────────


def jev_ask(state: dict, questions: dict, decision: str):
    import gtme_jev
    jev = gtme_jev.kit_jev()
    if jev is None or not jev.allowed():
        return None
    return jev.ask(state, questions, decision=decision)


def jev_check(row: dict, acc: dict, slug: str, ask=jev_ask) -> None:
    if not row["buyer"]:
        return
    state = {"organization": row["org"], "website": row["website"], "person": row["buyer"],
             "title_on_their_site": row["buyer_title"], "page": row["buyer_source"],
             "client_buyer": (acc.get("icp") or {}).get("buyer", "")}
    q = {"buyer": {"type": "noul", "instructions": acc.get("jev_question") or JEV_QUESTION}}
    try:
        res = ask(state, q, f"{slug}-buyer-check")
    except Exception:
        res = None
    p = ((res or {}).get("buyer") or {}).get("noul")
    p = p if isinstance(p, (int, float)) and not isinstance(p, bool) and 0 <= p <= 1 else None
    row["_jev_called"] = True
    if p is not None and p >= BUYER_OK:
        row["buyer_check"] = f"Jev {p:.2f}"
        return
    # a check that didn't run isn't a pass
    row["buyer_check"] = "Jev not scored, held" if p is None else f"Jev {p:.2f}, held"
    row["buyer"] = row["buyer_title"] = row["buyer_email"] = ""
    company = {"estimated_revenue": int(row["revenue"] or 0) or None, "estimated_headcount": None}
    t = gtme_score.assign_tier(int(row["fit"]) - 20, False, company, acc.get("criteria") or {})
    row["fit"], row["tier"], row["tier_rationale"] = int(row["fit"]) - 20, t["tier"], t["rationale"]


# ── step 5b: org checks, one row per person, segments ────────────────────

# A line that dates itself or asks for a sign-up beats a line that only says the word.
DATED = re.compile(r"\b20\d\d\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|"
                   r"sign ?up|register|next baptism|upcoming", re.I)


def evidence(rec: dict, name: str) -> tuple[str, str]:
    """The best line a page signal found, with the page it is on, or two blanks."""
    best = ("", "", -1)
    for page in (rec.get("signals") or {}).get(name) or []:
        for ln in page["lines"]:
            # this year's date beats any date, and an old year sinks it: on 11/2 a 2019 water
            # baptism and a 2022 sermon came up as churches' baptism lines
            year = str(dt.date.today().year)
            rank = 4 * (year in ln) + 2 * bool(DATED.search(ln)) + (page["url"].rstrip("/").count("/") > 2) - \
                5 * bool(re.search(r"\b20(0\d|1\d|2[0-%d])\b" % (int(year[-1]) - 1), ln))
            if rank > best[2]:
                best = (ln[:300], page["url"], rank)
    return best[0], best[1]


JEV_CACHE: dict | None = None
JEV_CACHE_PATH: Path | None = None


def cached_ask(ask, state: dict, qs: dict, decision: str) -> dict:
    """Jev once per exact question and evidence: a rerun after a column change asked the same
    2,638 questions again on 11/2. Only scored answers are kept, so a timeout is asked again."""
    import hashlib
    key = hashlib.sha256(json.dumps([state, qs], sort_keys=True).encode()).hexdigest()
    if JEV_CACHE is not None and key in JEV_CACHE:
        return JEV_CACHE[key]
    res = ask(state, qs, decision) or {}
    if JEV_CACHE is not None and res:
        with lock:
            JEV_CACHE[key] = res
    return res


def org_checks(rec: dict, acc: dict, slug: str, ask=jev_ask) -> dict:
    """Every check in `checks` for one org, in one Jev call, over the lines its own pages gave.
    {name: probability or None}. No lines for a check means Jev isn't asked it: None."""
    checks = acc.get("checks") or []
    if not checks:
        return {}
    sigs = rec.get("signals") or {}
    state = {"organization": rec.get("maps_name") or rec.get("name"), "website": rec.get("website", ""),
             "google_category": rec.get("category", ""), "today": dt.date.today().isoformat()}
    qs = {}
    for c in checks:
        text = [f"[{p['url']}] {ln}" for n in c.get("lines") or [] for p in sigs.get(n) or [] for ln in p["lines"]]
        if text or c.get("ask_without_lines"):
            state[c["name"] + "_lines"] = text[:30]
            qs[c["name"]] = {"type": "noul", "instructions": c["question"]}
    if not qs:
        return {c["name"]: None for c in checks}
    try:
        res = cached_ask(ask, state, qs, f"{slug}-org-checks")
    except Exception:
        res = {}
    out = {}
    for c in checks:
        p = (res.get(c["name"]) or {}).get("noul") if c["name"] in qs else None
        out[c["name"]] = p if isinstance(p, (int, float)) and not isinstance(p, bool) and 0 <= p <= 1 else None
    return out


def check_verdicts(probs: dict, acc: dict) -> dict:
    """{name: "pass" | "fail" | "held"} from each check's pass side and bar."""
    out = {}
    for c in acc.get("checks") or []:
        p, bar = probs.get(c["name"]), float(c.get("bar", 0.8))
        if p is None:
            # an exclusion nobody could read evidence for passes; a requirement doesn't
            out[c["name"]] = "pass" if c.get("pass") == "no" and c.get("absent_passes") else "held"
        elif c.get("pass") == "no":
            out[c["name"]] = "fail" if p >= bar else "pass"
        else:
            out[c["name"]] = "pass" if p >= bar else "fail"
    return out


# A staff card with the title above the name reads back swapped. On 11/3 ARC plant sites gave
# "IMMEASURABLY MORE" titled "Pastor Adam Magana" and "WHAT WE BELIEVE" titled "PASTOR JP + JACKIE",
# and Jev passed both pairs at 0.80 to 0.85.
TITLE_HOLDS_NAME = re.compile(r"^((?:lead |senior |founding |executive |campus )?pastors?)\s+"
                              r"([A-Z][\w.'\u00c0-\u017f-]*(?:\s*(?:[&+]|and)?\s*[A-Z][\w.'\u00c0-\u017f-]*){0,4})$", re.I)


def name_from_title(c: dict) -> dict:
    """A leader whose title is "Pastor <Name>": the name is in the title, so the title's name wins."""
    m = TITLE_HOLDS_NAME.match((c.get("title") or "").strip())
    if not m or re.search(r"\b(of|for|to|the|ministr\w*|students?|youth|kids|worship)\b", m.group(2), re.I):
        return c
    name = m.group(2)
    if name.isupper():
        name = " ".join(w if len(w) <= 2 else w.title() for w in name.split())
    return dict(c, name=name, title=m.group(1).title())


def per_person(recs: list[dict]) -> list[dict]:
    """One record per named person, so a church with three campus pastors is three rows."""
    out = []
    for r in recs:
        people = r.get("leaders") or []
        if len(people) <= 1:
            out.append(r)
            continue
        for i, person in enumerate(people):
            out.append(dict(r, leaders=[person], key=f"{r['key']}#{i}"))
    return out


def title_rank(title: str, titles: list[str]) -> int:
    low = (title or "").lower()
    return next((i for i, t in enumerate(titles) if t.lower() in low), len(titles))


def campus_of(title: str) -> str:
    """The campus a title names: "Campus Pastor, Fontana" and "Brea Campus Pastor" name one,
    "Campus Pastor" alone names none."""
    t = re.sub(r"(?i)\b(campus|site|location)\s+pastors?\b|\bpastors?\b|\b(lead|senior|executive|associate)\b|"
               r"[,&/|]|\band\b|\bcontact\b", " ", title or "")
    return " ".join(t.split()).strip().title()


def one_per_org(rows: list[dict], acc: dict) -> list[dict]:
    """The best-titled person per org, by the order of `titles`, plus everyone whose title says
    `one_per_org_except` (each campus pastor of a multi-campus church). Six pastors at one church
    getting the same cold invitation reads as a blast."""
    keep_all = re.compile(acc["one_per_org_except"], re.I)
    best: dict[str, dict] = {}
    out, seen_campus = [], set()
    for r in rows:
        # only a campus the title names is its own pitch: E2's "Campus Pastor" next to its lead
        # pastor was the same email twice to one church on 11/2
        if r["buyer"] and keep_all.search(r["buyer_title"] or "") and campus_of(r["buyer_title"]):
            # one per campus: two "Campus Pastor"s at Bayside Santa Rosa got the same pitch on 11/2
            k = (org_key(r), campus_of(r["buyer_title"]))
            if k in seen_campus:
                continue
            seen_campus.add(k)
            out.append(r)
            continue
        k = org_key(r)
        if k not in best or title_rank(r["buyer_title"], acc["titles"]) < title_rank(best[k]["buyer_title"], acc["titles"]):
            best[k] = r
    campus = {org_key(r) for r in out}
    return out + [r for k, r in best.items() if k not in campus or r["buyer"]]


def segment_of(row: dict, verdicts: dict, acc: dict) -> str:
    for seg in acc.get("segments") or []:
        if seg.get("category") and not re.search(seg["category"], row.get("category") or "", re.I):
            continue
        if seg.get("title") and not re.search(seg["title"], row.get("buyer_title") or "", re.I):
            continue
        if any(verdicts.get(n) != "pass" for n in seg.get("checks") or []):
            continue
        return seg["name"]
    return ""


# "Bayside Santa Rosa / Campus Pastor" and "Lead Pastors / Lead Pastor" came back as people on
# 11/2, and Jev passed both. A name that is the org's own name or a title isn't a person.
NOT_PASTOR_NAME = re.compile(r"\b(pastors?|church|campus|team|staff|ministr\w*|leadership|elders)\b", re.I)


# Widget words read as names in reads cached before the site audit learned them ("My Account")
WIDGET_NAME = re.compile(r"\b(account|hello|youtube|channel|search|process|author|oversight|login|subscribe)\b", re.I)


def not_a_person(name: str, org: str, title: str = "") -> bool:
    words = [w for w in re.findall(r"[a-z]+", (name or "").lower()) if w not in ("pastor", "rev", "dr")]
    org_words = set(re.findall(r"[a-z]{4,}", (org or "").lower())) - {"church", "community", "christian"}
    first_org = (re.findall(r"[a-z]{4,}", (org or "").lower()) or [""])[0]
    bare = re.sub(r"^(pastor|rev\.?|dr\.?)\s+", "", name or "", flags=re.I)
    # "Bayside Santa Rosa / Campus Pastor": a campus pastor whose "name" starts with the church's name
    # three words or more, so a pastor named Grace Lee at Grace City Church still counts
    campus_name = "campus" in (title or "").lower() and len(words) >= 3 and words[0] == first_org
    return bool(NOT_PASTOR_NAME.search(bare)) or bool(WIDGET_NAME.search(bare)) or campus_name or \
        bool(words and all(w in org_words for w in words))


WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")


def stale_weekday(line: str, today: dt.date | None = None) -> bool:
    """"Sun, Apr 21" with no year is 2024 when April 21 isn't a Sunday this year or next. Lake
    Hills Christian Center's only baptism line on 11/2 was exactly that."""
    m = re.search(r"\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
                  r"\s+(\d{1,2})\b(?!,?\s*\d{4})", line, re.I)
    if not m:
        return False
    year = (today or dt.date.today()).year
    want = WEEKDAYS.index(m.group(1).lower()[:3])
    for y in (year, year + 1):
        try:
            if dt.date(y, MONTHS.index(m.group(2).lower()[:3]) + 1, int(m.group(3))).weekday() == want:
                return False
        except ValueError:
            continue
    return True


def church_fields(row: dict, rec: dict, probs: dict, acc: dict) -> None:
    if row.get("buyer") and not_a_person(row["buyer"], row.get("org", ""), row.get("buyer_title", "")):
        row["buyer_check"] = f"not a person: {row['buyer']}"
        row["buyer"] = row["buyer_title"] = row["buyer_email"] = ""
    verdicts = check_verdicts(probs, acc)
    row["category"] = rec.get("category", "")
    for sig in acc.get("page_signals") or []:
        row[sig["name"] + "_evidence"], row[sig["name"] + "_source"] = evidence(rec, sig["name"])
    held = []
    for c in acc.get("checks") or []:
        p = probs.get(c["name"])
        row["check_" + c["name"]] = f"{verdicts[c['name']]} (Jev {p:.2f})" if p is not None else \
            f"{verdicts[c['name']]} (no evidence on their pages)"
        if verdicts[c["name"]] == "fail" and c.get("pass") == "no":
            held.append("excluded: " + c["name"])
        elif verdicts[c["name"]] != "pass" and c.get("required"):
            held.append(c["name"] + " " + verdicts[c["name"]])
    weak = False
    for sig in acc.get("page_signals") or []:
        # Jev reads every line a page gave, but the client sees only the one we quote. On 11/2 Jev
        # passed churches whose quotable line was a sermon title or a description with no date,
        # and a hand read had to hold 10 of 98. A signal can name what its quoted line must show.
        must = sig.get("evidence_must")
        line = row.get(sig["name"] + "_evidence") or ""
        bad = sig.get("evidence_not")
        src = row.get(sig["name"] + "_source") or ""
        if bad and line and re.search(bad, line + " " + urllib.parse.urlparse(src).path, re.I):
            weak = True
            held.append(f"{sig['name']} line is {sig.get('evidence_not_label') or 'excluded'}")
        elif line and stale_weekday(line):
            weak = True
            held.append(f"{sig['name']} line's weekday and date don't fit this year or next")
        elif must and not re.search(must, line, re.I):
            weak = True
            held.append(f"{sig['name']} line shows no {sig.get('evidence_must_label') or 'required detail'}"
                        if line else f"no {sig['name']} line to quote")
    row["segment"] = segment_of(row, verdicts, acc) if row.get("buyer") and not weak else ""
    if not row.get("buyer"):
        held.append("no named person on their site" if not row.get("buyer_check") else "person " + row["buyer_check"])
    elif not row["segment"] and not held:
        held.append("no segment fits")
    row["held_why"] = "; ".join(held)
    if not row["buyer_email"]:
        row["email_status"] = ""
    else:
        row["email_status"] = "published next to their name on the church's site, not run through a validator"


def church_columns(acc: dict) -> list[str]:
    cols = ["segment", "held_why", "category", "email_status"]
    for sig in acc.get("page_signals") or []:
        cols += [sig["name"] + "_evidence", sig["name"] + "_source"]
    return cols + ["check_" + c["name"] for c in acc.get("checks") or []]


# ── step 6: dedupe ───────────────────────────────────────────────────────


# Hosts many orgs share: a Maps place whose site is one of these isn't one org's domain.
SHARED_HOSTS = ("facebook.com", "instagram.com", "linktr.ee", "sites.google.com", "linkedin.com", "yelp.com",
                "wixsite.com", "squarespace.com", "godaddysites.com", "weebly.com")


def org_key(row: dict) -> str:
    u = urllib.parse.urlparse(row["website"] or "")
    dom = u.netloc.lower().removeprefix("www.")
    if any(dom == h or dom.endswith("." + h) for h in SHARED_HOSTS):
        return dom + u.path.rstrip("/").lower()
    return dom or gtme_score.normalize_company_name(row["org"] or "")


def dedupe(rows: list[dict], by_person: bool = False) -> list[dict]:
    """One row per org (two IRS filers often share one site), or per org and person when each
    person gets a row, then gtme-dedupe's exact passes over the buyers, so one person heading
    two orgs is written to once."""
    best: dict[str, dict] = {}
    for r in rows:
        k = org_key(r) + ("|" + (r.get("buyer") or "").lower() if by_person else "")
        if k not in best or (r["tier"], -int(r["fit"]), -int(r["why_now_score"])) < \
                (best[k]["tier"], -int(best[k]["fit"]), -int(best[k]["why_now_score"])):
            best[k] = r
    rows = list(best.values())
    people = [r for r in rows if r["buyer"]]
    if len(people) < 2:
        return rows
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "buyers.csv"
        with open(src, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["full_name", "email", "company", "website", "title"])
            for r in people:
                w.writerow([r["buyer"], r["buyer_email"], r["org"], r["website"], r["buyer_title"]])
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            gtme_dedupe.main([str(src), "--out", str(Path(tmp) / "out"), "--no-splink", "--json"])
        with open(Path(tmp) / "out" / "clusters.csv", newline="") as fh:
            groups: dict[str, list[dict]] = {}
            for c in csv.DictReader(fh):
                groups.setdefault(c["cluster_id"], []).append(people[int(c["source_row"]) - 2])
        for members in groups.values():
            members.sort(key=lambda r: (r["tier"], -int(r["fit"]), -int(r["why_now_score"])))
            for r in members[1:]:
                r["dupe_of"] = members[0]["org"]
    return rows


# ── steps 7 to 9: dnc, people, treg ──────────────────────────────────────


def dnc_entries(acc: dict) -> tuple[list | None, str]:
    cfg = acc.get("dnc") or {}
    entries, where = [], []
    try:
        for p in cfg.get("csv") or []:
            entries += gtme_dnc.load_csv(os.path.expanduser(p))
            where.append(Path(p).name)
        if cfg.get("client"):
            entries += gtme_dnc.load_client(cfg["client"])
            where.append(f"gtm graph {cfg['client']}")
    except Exception as e:  # an unreadable list is unknown, never clear
        return None, f"not checked: {e}"
    if not where:
        return None, "not checked: no DNC list for this client"
    return entries, ", ".join(where)


def apply_dnc(row: dict, entries: list | None, where: str) -> None:
    """A suppressed person or domain is terminal: no email, no channel, no treg find, so
    nobody buys a fresh address for someone who asked not to hear from us."""
    target = row["buyer_email"] or urllib.parse.urlparse(row.get("website") or "").netloc.removeprefix("www.")
    if not row["buyer"] or not target:
        row["dnc"] = ""
        return
    if entries is None:
        row["dnc"] = where
        return
    d = gtme_dnc.check(target, entries, company_wide=not row["buyer_email"])
    row["dnc"] = f"SUPPRESSED: {d['reason']}" if d["suppressed"] else f"clear ({where})"
    if d["suppressed"]:
        row["buyer_email"] = ""
        row["_suppressed"] = True


def people_db() -> sqlite3.Connection | None:
    path = Path(os.environ.get("PEOPLE_DIR") or Path.home() / ".chewbacca" / "people") / "people.db"
    if not path.exists():
        return None
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def relationship(row: dict, db: sqlite3.Connection | None) -> None:
    """Warm means a text, never a cold email (Sagar). A name alone matches only with the
    same company in the people store, since two Jaqueline Padillas are two people."""
    if not row["buyer"] or row.get("_suppressed") or row.get("dupe_of"):
        row["channel"] = "none: on a DNC list" if row.get("_suppressed") else \
            "none: same person as " + row["dupe_of"] if row.get("dupe_of") else ""
        return
    hit = None
    if db is not None:
        if row["buyer_email"]:
            hit = db.execute("select p.name, p.phone from identities i join people p on p.id = i.person_id "
                             "where i.kind = 'email' and lower(i.value) = lower(?)", (row["buyer_email"],)).fetchone()
        if not hit:
            for name, phone, company in db.execute("select name, phone, company from people where lower(name) = "
                                                   "lower(?)", (row["buyer"].strip(),)):
                if company and gtme_score.jaro_winkler(gtme_score.normalize_company_name(company),
                                                       gtme_score.normalize_company_name(row["org"])) >= NAME_MATCH:
                    hit = (name, phone)
                    break
    if hit:
        row["relationship"] = f"warm: {hit[0]} is in the people store"
        row["channel"] = "text" if hit[1] else "warm intro, no phone on file"
    else:
        row["relationship"] = "cold" if db is not None else "not checked: no people store"
        row["channel"] = "email" if row["buyer_email"] else "find email"


def price_treg(row: dict) -> float:
    if row["buyer"] and not row["buyer_email"] and row["channel"] == "find email":
        row["treg_find"] = f"priced, not spent: up to ${treg_client.FIND_MAX_USD:.2f} (treg.people.email.find)"
        return treg_client.FIND_MAX_USD
    return 0.0


# ── stages: the one list pipeline ────────────────────────────────────────

# Every list builder runs as named steps through run_stages: this file's accounts, `gtme list`'s
# registry builder (gtme_pipeline), the investor and angel lists (gtme_investors). Five builders
# overlapped on 2026-11-02 (Dough improvement plan, item 13), each with its own copy of the same
# steps, so a fix to one (judge each angel alone, a DNC hit is terminal) never reached the others.
# A step is (stage, fn): fn takes the rows and returns the rows it keeps. The order is each
# builder's own, since the investor list dedupes before it judges and this file after.
STAGES = ("source", "fit", "buyer", "verify", "dedupe", "dnc", "tier")


def run_stages(steps, rows=None, trace: list | None = None):
    """Run a builder's steps in order and return the rows. With `trace`, append one
    {stage, step, in, out} per step, so a row count that drops can be traced to the step."""
    for stage, fn in steps:
        if stage not in STAGES:
            raise ValueError(f"unknown stage {stage!r}: a step is one of {', '.join(STAGES)}")
        before = len(rows) if rows is not None else 0
        rows = fn(rows)
        if trace is not None:
            trace.append({"stage": stage, "step": getattr(fn, "__name__", stage), "in": before,
                          "out": len(rows) if rows is not None else 0})
    return rows


def jev_judge_rows(states: list[dict], question: str, decision: str, batch: int) -> list[float | None]:
    """The same yes/no question asked of each row, `batch` rows to a Jev call; None where Jev
    gave no answer or isn't installed. The registry list and the fund list share this; the angel
    pass calls it one row at a time (batch rows mixed up, see gtme_investors.build_angels)."""
    sys.path.insert(0, str(ROOT / "bin" / "lib"))
    import gtme_jev  # the kit's Jev by path, never tools/jev.py (11/2)
    jev = gtme_jev.kit_jev()
    if jev is None:
        return [None] * len(states)
    out: list[float | None] = []
    for i in range(0, len(states), batch):
        chunk = states[i:i + batch]
        qs = {f"row:{j}": {"type": "noul", "instructions": f"Look only at row {j}. {question}"}
              for j in range(len(chunk))}
        answers = jev.ask({"rows": chunk}, qs, decision=decision) or {}
        for j in range(len(chunk)):
            a = answers.get(f"row:{j}")
            out.append(jev.probability(a.get("noul")) if isinstance(a, dict) else None)
    return out


# ── run ──────────────────────────────────────────────────────────────────


def build(client: str, acc: dict, work: Path, *, limit: int | None = None, workers: int = 4,
          refresh: bool = False, tools=None, ask=jev_ask, about=None, today: dt.date | None = None,
          refresh_signals: bool = False, refresh_empty: str | bool = False,
          trace: list | None = None) -> tuple[list[dict], dict]:
    today = today or dt.date.today()
    work.mkdir(parents=True, exist_ok=True)
    run: dict = {"org_jev": 0}

    def source(_):
        accounts = SOURCES[acc["source"]["kind"]](acc["source"], work / "source")
        if limit:
            accounts = accounts[:limit]  # a test run, and the summary says so
        run["accounts"] = accounts
        return accounts

    def read_sites(accounts):
        nonlocal tools, refresh
        words = re.compile(acc.get("news_words") or NEWS_WORDS, re.I)
        growth = re.compile(acc.get("growth_words") or GROWTH_WORDS, re.I)
        run["words"] = words
        tools = tools or site_audit()
        titles = acc.get("titles") or []
        must_show = (acc.get("icp") or {}).get("must_show") or ""
        if len(accounts) > SAMPLE and not acc.get("allow_low_buyer_fill"):
            sample = enrich(accounts[:SAMPLE], work, tools, words, growth, workers, refresh, titles, must_show, acc)
            read = [r for r in sample if r.get("site_status") == "ok"]
            found = sum(1 for r in read if r.get("leaders"))
            if read and found / len(read) < MIN_BUYER_FILL:
                raise Refused(f"the site reader found a buyer at {found} of {len(read)} sample sites, so it's blind to "
                              f"this market. Add the titles these orgs really use to the accounts block's `titles` "
                              f"(now: {', '.join(titles) or 'none'}), check one site by hand, then rerun. Set "
                              f"allow_low_buyer_fill: true only if buyers really aren't on these sites.")
            refresh = False  # the sample is read; the full run reuses it
        recs = enrich(accounts, work, tools, words, growth, workers, refresh, titles, must_show, acc, refresh_signals,
                      refresh_empty)
        return [r for r in recs if r.get("website") and same_org(r["name"], r.get("maps_name"))]

    def why_now_jobs(recs):
        hiring_cfg = (acc.get("why_now") or {}).get("linkedin_jobs")
        if hiring_cfg:
            posts = linkedin_hiring(hiring_cfg)
            for r in recs:
                r["jobs"] = (r.get("jobs") or []) + posts.get(name_key(r.get("maps_name") or r["name"]), [])
        job_words = (acc.get("why_now") or {}).get("job_words")
        if job_words:
            # a hire only counts when it's the work the client sells into: Ben Hall Law hiring a
            # criminal defense attorney came back as a PIP why-now on 2026-11-02
            jw = re.compile(job_words, re.I)
            for r in recs:
                r["jobs"] = [j for j in r.get("jobs") or [] if jw.search(j.get("title", ""))]
        return recs

    def checks(recs):
        global JEV_CACHE, JEV_CACHE_PATH
        JEV_CACHE_PATH = work / "jev-cache.json"
        JEV_CACHE = json.loads(JEV_CACHE_PATH.read_text()) if JEV_CACHE_PATH.exists() else {}
        if acc.get("checks"):
            for r in recs:
                r["_probs"] = org_checks(r, acc, client, ask)
                run["org_jev"] += 1
        JEV_CACHE_PATH.write_text(json.dumps(JEV_CACHE))
        if acc.get("per_person"):
            recs = per_person(recs)
        run["by_row"] = recs
        return recs

    def pick_buyer(recs):
        return [score(rec, acc, run["words"], today, about) for rec in recs]

    def confirm_buyer(rows):
        for row, rec in zip(rows, run["by_row"]):
            jev_check(row, acc, client, ask)
            if acc.get("checks") or acc.get("page_signals"):
                church_fields(row, rec, rec.get("_probs") or {}, acc)
        run["jev_calls"] = sum(1 for r in rows if r.pop("_jev_called", False)) + run["org_jev"]
        if acc.get("per_person"):
            # a person Jev held is dropped when someone else at that org kept their row
            kept = {r["org"] for r in rows if r["buyer"]}
            rows = [r for r in rows if r["buyer"] or r["org"] not in kept]
        return rows

    def one_row_each(rows):
        rows = dedupe(rows, by_person=bool(acc.get("per_person")))
        if acc.get("per_person") and acc.get("one_per_org_except"):
            rows = one_per_org(rows, acc)
        return rows

    def dnc_people_treg(rows):
        entries, where = dnc_entries(acc)
        run["dnc"] = where
        db = people_db()
        treg_total = 0.0
        for r in rows:
            apply_dnc(r, entries, where)
            relationship(r, db)
            treg_total += price_treg(r)
            for k in ("_page_emails", "_suppressed"):
                r.pop(k, None)
        run["treg_total"] = treg_total
        return rows

    def order(rows):
        if acc.get("segments"):
            # segmented rows first, by segment, then the held ones with their reason
            rows.sort(key=lambda r: (not r.get("segment"), r.get("segment") or "", r["org"] or "", r["buyer"] or ""))
        else:
            rows.sort(key=lambda r: (r["tier"], -int(r["why_now_score"]), -int(r["fit"]), r["org"] or ""))
        return rows

    rows = run_stages([("source", source), ("fit", read_sites), ("fit", why_now_jobs), ("fit", checks),
                       ("buyer", pick_buyer), ("verify", confirm_buyer), ("dedupe", one_row_each),
                       ("dnc", dnc_people_treg), ("tier", order)], trace=trace)
    accounts, recs, where, treg_total = run["accounts"], run["by_row"], run["dnc"], run["treg_total"]
    fill = {c: sum(1 for r in rows if str(r.get(c) or "").strip()) for c in
            ("website", "buyer", "buyer_email", "why_now", "relationship")}
    summary = {"client": client, "accounts_sourced": len(accounts), "rows": len(rows),
               "limited": bool(limit), "fill": fill,
               "jev_confirmed": sum(1 for r in rows if r["buyer_check"].startswith("Jev") and "held" not in r["buyer_check"]),
               "jev_held": [r["org"] for r in rows if "held" in r["buyer_check"]],
               "tiers": {t: sum(1 for r in rows if r["tier"] == t) for t in (1, 2, 3)},
               "jev_calls": run["jev_calls"], "dropped_no_site": len(accounts) - len({r["key"].split("#")[0] for r in recs}),
               "icp_unread": [r["org"] for r in rows if r.get("icp_fit") == "unread"],
               "dnc": where, "treg_priced_rows": sum(1 for r in rows if r["treg_find"]),
               "treg_priced_usd": round(treg_total, 2), "treg_budget_usd": acc.get("treg_budget_usd")}
    if acc.get("segments"):
        summary["segments"] = {s["name"]: sum(1 for r in rows if r.get("segment") == s["name"])
                               for s in acc["segments"]}
        summary["held"] = sum(1 for r in rows if not r.get("segment"))
    return rows, summary


def find_emails(rows: list[dict], client: str, acc: dict, work: Path, finder=None, verifier=None) -> dict:
    """Spend the client's data budget on the rows worth it: a confirmed buyer, ICP work shown on
    their own site, and no email yet. Only a "valid" verdict fills buyer_email; catch-all and
    risky stay out of it, because a bounce costs the inbox more than a missing row. treg_client
    refuses any call past `treg_budget_usd` for the month, so the cap lives in client config.
    A published email gets verified the same way before it counts."""
    budget = float(acc.get("treg_budget_usd") or 0)
    spend = work / "spend.jsonl"
    finder = finder or (lambda dom, name: treg_client.find_email(domain=dom, full_name=name, customer=client,
                                                              spend_file=spend, budget_usd=budget))
    verifier = verifier or (lambda email: treg_client.verify_email(email=email, customer=client,
                                                                  spend_file=spend, budget_usd=budget))
    # every paid answer is kept, so a rerun never pays twice for the same person (a retry after
    # 5 treg timeouts on 2026-11-02 would have re-bought the 17 emails already found)
    cache_file = work / "emails.json"
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    found = checked = 0
    for r in rows:
        # "not checked" and "clear" are both sendable; only a suppression stops a spend. On
        # 2026-11-02 any non-empty dnc skipped all 54 buyers, and the run spent nothing.
        if not r["buyer"] or r.get("icp_fit") in ("no", "unread") or str(r.get("dnc") or "").startswith("SUPPRESSED"):
            continue
        try:
            if r["buyer_email"]:
                v = verifier(r["buyer_email"])["verdict"]
                checked += 1
                r["email_verdict"] = v
                if v != "valid":
                    r["buyer_email"] = ""
            elif r["treg_find"]:
                key = f"{_domain(r['website'])}|{r['buyer'].lower()}"
                res = cache.get(key) or finder(_domain(r["website"]), r["buyer"])
                cache[key] = {k: res.get(k) for k in ("email", "verdict", "cost_usd")}
                cache_file.write_text(json.dumps(cache, indent=1))
                r["email_verdict"] = res.get("verdict") or ("none found" if not res.get("email") else "unknown")
                r["treg_find"] = f"spent ${res.get('cost_usd', 0):.3f}"
                if res.get("email") and res.get("verdict") == "valid":
                    r["buyer_email"], found = res["email"], found + 1
        except treg_client.Refused as e:
            r["email_verdict"] = f"not run: {e}"
            if "budget" in str(e):
                break
    return {"found": found, "verified_published": checked}


DM_MAX_USD = 0.04  # anymailfinder decision maker, per success; a miss is free (treg catalog, 2026-11-02)


def name_on_site(tools, website: str, name: str) -> str:
    """The page on the org's own site that names this person, or "". A paid lookup's buyer
    counts only when the firm's own site names them too (own_page's rule, for paid data)."""
    audit_site, lead_card = tools
    last = (name or "").split()[-1:] or [""]
    if len(last[0]) < 3:
        return ""
    rx = re.compile(r"\b" + re.escape(last[0]) + r"\b", re.I)
    html, final = page_html(audit_site, lead_card, website)
    pages = [(html, final)]
    from urllib.parse import urljoin
    for href, text in ICP_LINK.findall(html)[:400]:
        if len(pages) > ICP_PAGES:
            break
        link = urljoin(final, href)
        if re.search(r"attorney|lawyer|team|about|staff|people|leadership|partner", href + " " + text, re.I) \
                and same_site(link, final):
            pages.append(page_html(audit_site, lead_card, link))
    return next((u for h, u in pages if rx.search(re.sub(r"<[^>]+>", " ", h))), "")


def find_buyers(rows: list[dict], client: str, acc: dict, work: Path, tools, lookup=None) -> dict:
    """For an ICP-fit row whose own site named nobody: ask treg's decision maker finder, then
    keep the person only if the firm's own site names them. On 2026-11-02 62 Michigan PIP firms
    showed PIP work but no reader-visible owner. Cached like emails, so nobody is bought twice."""
    budget = float(acc.get("treg_budget_usd") or 0)
    spend = work / "spend.jsonl"
    cats = (acc.get("buyer_lookup") or {}).get("categories") or ["ceo", "operations"]
    lookup = lookup or (lambda dom: treg_client.call(
        "anymailfinder.people.decision_makers", {"domain": dom, "decision_maker_category": cats},
        customer=client, spend_file=spend, budget_usd=budget, max_cost_usd=DM_MAX_USD))
    cache_file = work / "buyers.json"
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    added = asked = 0
    for r in rows:
        if r["buyer"] or r.get("icp_fit") != "yes" or str(r.get("dnc") or "").startswith("SUPPRESSED"):
            continue
        dom = _domain(r["website"])
        try:
            if dom not in cache:
                res = lookup(dom)
                out = res.get("output") if isinstance(res.get("output"), dict) else (res.get("raw") or {})
                cache[dom] = {k: out.get(k) for k in ("person_full_name", "person_job_title", "valid_email",
                                                      "email_status")}
                cache_file.write_text(json.dumps(cache, indent=1))
                asked += 1
        except treg_client.Refused as e:
            r["buyer_check"] = f"lookup not run: {e}"
            if "budget" in str(e):
                break
            continue
        hit = cache[dom]
        name = hit.get("person_full_name") or ""
        if not name or not is_person(name):
            continue
        page = name_on_site(tools, r["website"], name)
        if not page:
            r["buyer_check"] = f"lookup found {name}, but the firm's own site never names them: held"
            continue
        r.update({"buyer": name, "buyer_title": hit.get("person_job_title") or "", "buyer_source": page,
                  "buyer_check": "treg decision maker, named on own site"})
        if hit.get("email_status") == "valid" and hit.get("valid_email"):
            r["buyer_email"], r["email_verdict"] = hit["valid_email"].lower(), "valid"
        added += 1
    return {"asked": asked, "added": added}


def evaluate(rows: list[dict], gold_path: Path) -> dict:
    """Score a run against hand labels, so a change that makes Dough worse shows up as a number.

    gold CSV columns: website, icp (yes/no), buyer (the person who signs, blank if the site names
    nobody, ? when only icp was checked), checked_by, note. Built 2026-11-02 after the Michigan PIP list went from 1 buyer to 32
    to 5 fake names to a dead founder, every miss caught by eye and none by a number.
    """
    with open(gold_path, newline="", encoding="utf-8-sig") as fh:
        gold = {_domain(g["website"]): g for g in csv.DictReader(fh) if g.get("website")}
    seen = {_domain(r["website"]): r for r in rows}
    tp = fp = fn = tn = 0
    right = wrong = missed = invented = 0
    misses = []
    for dom, g in gold.items():
        r = seen.get(dom)
        if not r:
            misses.append(f"{dom}: not in this run")
            continue
        want, got = g["icp"].strip().lower() == "yes", r.get("icp_fit") == "yes"
        tp += want and got
        fp += got and not want
        fn += want and not got
        tn += not want and not got
        if want != got:
            misses.append(f"{dom}: icp gold {g['icp']}, run {r.get('icp_fit') or 'blank'}")
        if (g.get("buyer") or "").strip() == "?":
            continue  # icp labeled, buyer not checked by hand
        gb = (g.get("buyer") or "").strip().lower().split()
        rb = (r.get("buyer") or "").strip().lower().split()
        if gb and rb:
            # first and last name both: the late founder Joseph Lobb is not Cherie Lobb, the owner now
            ok = gb[-1] == rb[-1] and gb[0] == rb[0]
            right += ok
            wrong += not ok
            if not ok:
                misses.append(f"{dom}: buyer gold {g['buyer']}, run {r['buyer']}")
        elif gb:
            missed += 1
        elif rb:
            invented += 1
            misses.append(f"{dom}: run named {r['buyer']}, gold says nobody")
    div = lambda a, b: round(a / b, 3) if b else None  # noqa: E731
    return {"labeled": len(gold), "in_run": sum(1 for d in gold if d in seen),
            "icp_precision": div(tp, tp + fp), "icp_recall": div(tp, tp + fn),
            "buyer_right": right, "buyer_wrong": wrong, "buyer_missed": missed, "buyer_invented": invented,
            "buyer_precision": div(right, right + wrong + invented), "misses": misses}


def email_line(summary: dict) -> str:
    """11/2: the first --find-emails run skipped every row and still printed only "priced, not
    spent", so nobody could tell the step ran and did nothing."""
    if "emails" in summary:
        e = summary["emails"]
        empty = not (e["found"] or e["verified_published"])
        return (f"  emails: {e['found']} verified found, {e['verified_published']} published checked"
                + ("  <- ran and found NOTHING, read email_verdict" if empty else ""))
    return (f"  treg find priced for {summary['treg_priced_rows']} rows, up to ${summary['treg_priced_usd']:.2f}, "
            f"not spent (--find-emails spends it)")


def write(rows: list[dict], out: Path, columns: list[str] | None = None) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=columns or COLUMNS, extrasaction="ignore")
        w.writeheader()
        # buyer titles and headlines are read off strangers' pages, and the CSV opens in Sheets
        w.writerows({k: gtme_signals.csv_cell(v) if isinstance(v, str) else v for k, v in r.items()} for r in rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="chewbacca gtme accounts", description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--client", required=True)
    ap.add_argument("--out", help="the CSV (default: accounts.out, else the client's state folder)")
    ap.add_argument("--limit", type=int, help="first N accounts only, for a test run")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--refresh", action="store_true", help="re-read every site instead of the cache")
    ap.add_argument("--refresh-signals", action="store_true",
                    help="reread only the page signals of cached accounts (after a signal change)")
    ap.add_argument("--refresh-empty", metavar="SIGNAL", nargs="?", const=True, default=False,
                    help="reread cached accounts whose pages showed SIGNAL (default: any page signal) but no "
                         "named person; prints how many and about how long first")
    ap.add_argument("--check", action="store_true", help="validate the accounts block and stop")
    ap.add_argument("--find-buyers", action="store_true",
                    help="for ICP-fit rows with no buyer, a paid decision-maker lookup kept only if their own site names them")
    ap.add_argument("--eval", metavar="GOLD_CSV",
                    help="score the run against hand labels (website, icp, buyer) and print precision and recall")
    ap.add_argument("--find-emails", action="store_true",
                    help="spend the client's treg_budget_usd on verified buyer emails (ICP-fit rows only)")
    a = ap.parse_args(argv)
    try:
        path, cfg = load(a.client)
        acc = accounts_block(cfg)
        if a.check:
            print(f"ok    {path}: ICP confirmed by {acc['icp']['confirmed_by']}, source {acc['source']['kind']}")
            return 0
        slug = path.stem
        work = clients_dir() / slug / "accounts"
        rows, summary = build(slug, acc, work, limit=a.limit, workers=a.workers, refresh=a.refresh,
                              refresh_signals=a.refresh_signals, refresh_empty=a.refresh_empty)
        if a.find_buyers:
            summary["buyers_found"] = find_buyers(rows, slug, acc, work, site_audit())
            summary["fill"]["buyer"] = sum(1 for r in rows if r["buyer"])
        if a.find_emails:
            summary["emails"] = find_emails(rows, slug, acc, work)
            summary["fill"]["buyer_email"] = sum(1 for r in rows if r["buyer_email"])
    except Refused as e:
        print(f"gtme accounts: {e}", file=sys.stderr)
        return 2
    out = Path(os.path.expanduser(a.out or acc.get("out") or str(work / "accounts.csv")))
    extra = church_columns(acc) if (acc.get("checks") or acc.get("page_signals")) else []
    write(rows, out, extra[:2] + COLUMNS + extra[2:] if extra else None)
    (work / "summary.json").write_text(json.dumps(summary, indent=2))
    f = summary["fill"]
    n = summary["rows"] or 1
    print(f"{summary['rows']} accounts from {summary['accounts_sourced']} sourced"
          f"{' (LIMITED test run)' if summary['limited'] else ''} -> {out}")
    print(f"  tiers 1/2/3: {summary['tiers'][1]}/{summary['tiers'][2]}/{summary['tiers'][3]}")
    if summary.get("segments"):
        print("  segments: " + ", ".join(f"{k} {v}" for k, v in summary["segments"].items()) +
              f"; held {summary['held']}")
    print(f"  Jev-confirmed buyers: {summary['jev_confirmed']}; held: {', '.join(summary['jev_held']) or 'none'}")
    print("  fill: " + ", ".join(f"{k} {v}/{n}" for k, v in f.items()))
    print(f"  Jev calls: {summary['jev_calls']}; sourced but no site found: {summary['dropped_no_site']}")
    if summary.get("icp_unread"):
        print(f"  sites we couldn't read, so ICP fit is unknown (check by hand): {', '.join(summary['icp_unread'])}")
    print(f"  dnc: {summary['dnc']}")
    print(email_line(summary))
    if a.eval:
        ev = evaluate(rows, Path(os.path.expanduser(a.eval)))
        (work / "eval.json").write_text(json.dumps(ev, indent=2))
        print(f"  eval on {ev['in_run']} of {ev['labeled']} labeled: ICP precision {ev['icp_precision']}, "
              f"recall {ev['icp_recall']}; buyer right {ev['buyer_right']}, wrong {ev['buyer_wrong']}, "
              f"missed {ev['buyer_missed']}, invented {ev['buyer_invented']}")
        for m in ev["misses"][:15]:
            print(f"    {m}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
