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
      "titles": ["Chief Operating", "COO", "Executive Director"],
      "criteria": {"revenue_range": {"min": 10000000, "max": 50000000}},
      "lanes": {"R": "advocacy", "I": "legal aid"},          NTEE letter -> what the row says it is
      "news_words": "\\bAI\\b|data|cyber|breach",             headlines that are a reason to talk
      "jev_question": "...",                                 optional; the default asks about signing
      "dnc": {"csv": ["~/x/dnc.csv"], "client": "aurapath"}, optional
      "treg_budget_usd": 5,
      "out": "~/Downloads/AuraPath leads/AuraPath leads.csv"}
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
LEADER = re.compile(r"\b(ceo|chief|president|executive director|coo|cfo|cto|cio|operations|technology|"
                    r"information|it director|director of it|digital|data)\b", re.I)
LISTICLE = re.compile(r"MinistryWatch|top \d+|largest|\d+ (best|largest)", re.I)
KNOWN_STACK = re.compile(r"planning center|rock|pushpay|ministry ?platform|ccb|church community builder|breeze|"
                         r"elvanto|fellowship one|realm|shelby|subsplash|churchteams|tithely|touchpoint|acs|"
                         r"blackbaud|raiser|salesforce|virtuous|bloomerang|donorperfect|neon", re.I)
IRS_EO = "https://www.irs.gov/pub/irs-soi/eo_{state}.csv"
COLUMNS = ["tier", "fit", "why_now_score", "hold", "kind", "org", "city", "state", "website", "revenue", "size",
           "stack", "buyer", "buyer_title", "buyer_email", "buyer_source", "buyer_check", "relationship",
           "channel", "dnc", "treg_find", "dupe_of", "why_now", "why_now_date", "why_now_source",
           "tier_rationale", "account_source"]
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


def api_rows(src: dict, cache: Path) -> list[dict]:
    import gtme_operator as op
    res = op.api(src["site"], src["op"], **(src.get("args") or {}))
    if res.get("ok") is False:
        raise Refused(f"chewbacca api {src['site']} {src['op']} failed: {res.get('reason')}")
    cols = src.get("columns") or {"title": "name", "displayName": "name"}
    return [_mapped(r, cols, i, f"chewbacca api {src['site']} {src['op']}") for i, r in enumerate(_first_list(res))]


def csv_rows(src: dict, cache: Path) -> list[dict]:
    path = Path(os.path.expanduser(src["path"]))
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return [_mapped(r, src.get("columns") or {}, i, str(path)) for i, r in enumerate(csv.DictReader(fh))]


SOURCES = {"irs_eo": irs_rows, "formd": formd_rows, "api": api_rows, "csv": csv_rows}


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


def leaders(contacts) -> list[dict]:
    out = [c for c in contacts or [] if LEADER.search(c.get("title", ""))]
    out.sort(key=lambda c: 0 if re.search(r"technology|information|\bit\b|cto|cio|data|digital", c["title"], re.I)
             else 1 if re.search(r"operat|coo", c["title"], re.I) else 2)
    return out[:3]


def enrich_one(a: dict, tools, words, growth) -> dict:
    audit_site, lead_card = tools
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
            if "titles" in inspect.signature(audit_site.audit).parameters:
                au = audit_site.audit(rec["website"], None, titles="org")
            else:
                au = audit_site.audit(rec["website"], None)
            rec["site_status"] = au.get("status")
            rec["leaders"] = leaders(au.get("contacts"))
            rec["page_emails"] = [e.get("email") for e in au.get("page_emails") or []][:8]
            rec["chms"] = au.get("chms") or ""
            rec["jobs"] = lead_card.jobs(au.get("final_url") or rec["website"])
        except Exception as e:
            rec["site_status"] = f"error: {e}"
    rec["news"] = news(lead_card, a["name"], words, growth)
    return rec


def enrich(accounts: list[dict], work: Path, tools, words, growth, workers: int, refresh: bool) -> list[dict]:
    path = work / "enriched.jsonl"
    done, lines = {}, 0
    if path.exists() and not refresh:
        for line in path.read_text().splitlines():
            if line.strip():
                lines += 1
                r = json.loads(line)
                # a Maps or audit error is a lookup that didn't happen, so it's retried, never kept
                if not r.get("error") and not str(r.get("site_status") or "").startswith("error"):
                    done[r["key"]] = r
    todo = [a for a in accounts if a["key"] not in done]
    print(f"gtme accounts: {len(accounts)} accounts, {len(done)} cached, {len(todo)} to read", file=sys.stderr)
    # rewrite when errors were dropped, so the file only ever holds lookups that happened
    rewrite = refresh or lines != len(done)
    with cf.ThreadPoolExecutor(max_workers=workers) as ex, open(path, "w" if rewrite else "a") as fh:
        if rewrite:
            for rec in done.values():
                fh.write(json.dumps(rec) + "\n")
        for rec in ex.map(lambda a: enrich_one(a, tools, words, growth), todo):
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
              "source_url": c.get("source_url", "")} for c in rec.get("leaders") or []]
    prim = gtme_score.resolve_primary(cands, acc["titles"]) if cands else None
    pc = next((c for c in cands if prim and c["contact_id"] == prim["primary_contact_id"]), None)
    items = own_news(rec["name"], rec.get("news"))
    sigs = [{"what": n["title"], "date": n["date"], "scope": "company", "company_match": True, "source": n["url"]}
            for n in items]
    # a job post is the org's own but undated on most sites, so it scores as relevance only
    sigs += [{"what": "hiring: " + j["title"], "date": "", "scope": "company", "company_match": True,
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
    # Weights guessed from John Knox's 10/27 call, never measured: can they pay (40), a system
    # to connect (20), someone who signs (20), a reason to help now (20).
    fit = 40 * in_band + 20 * stack + 20 * bool(pc) + 20 * need
    tier = gtme_score.assign_tier(fit, bool(pc and pc.get("email")), company, criteria)
    top = sig["top"][0] if sig["top"] else {}
    lanes = acc.get("lanes") or {}
    return {"tier": tier["tier"], "fit": fit, "why_now_score": sig["score"], "hold": "HOLD" if sig["hold"] else "",
            "kind": lanes.get((rec.get("ntee") or " ")[0].upper(), acc.get("kind", "account")),
            "org": rec.get("maps_name") or rec["name"], "city": rec["city"], "state": rec["state"],
            "website": rec.get("website", ""), "revenue": rec.get("revenue") or "", "size": rec.get("size", ""),
            "stack": rec.get("chms") or "", "buyer": (pc or {}).get("full_name", ""),
            "buyer_title": (pc or {}).get("title", ""), "buyer_email": (pc or {}).get("email", ""),
            "buyer_source": (pc or {}).get("source_url", ""), "buyer_check": "", "relationship": "",
            "channel": "", "dnc": "", "treg_find": "", "dupe_of": "",
            "why_now": top.get("what", ""), "why_now_date": top.get("date", ""),
            "why_now_source": top.get("source", ""), "tier_rationale": tier["rationale"],
            "account_source": rec.get("account_source", ""), "_page_emails": rec.get("page_emails") or []}


# ── step 5: Jev ──────────────────────────────────────────────────────────


def jev_ask(state: dict, questions: dict, decision: str):
    import jev
    if not jev.allowed():
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


def dedupe(rows: list[dict]) -> list[dict]:
    """One row per org (two IRS filers often share one site), then gtme-dedupe's exact passes
    over the buyers, so one person heading two orgs is written to once."""
    best: dict[str, dict] = {}
    for r in rows:
        k = org_key(r)
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


# ── run ──────────────────────────────────────────────────────────────────


def build(client: str, acc: dict, work: Path, *, limit: int | None = None, workers: int = 4,
          refresh: bool = False, tools=None, ask=jev_ask, about=None, today: dt.date | None = None) -> tuple[list[dict], dict]:
    today = today or dt.date.today()
    work.mkdir(parents=True, exist_ok=True)
    accounts = SOURCES[acc["source"]["kind"]](acc["source"], work / "source")
    if limit:
        accounts = accounts[:limit]  # a test run, and the summary says so
    words = re.compile(acc.get("news_words") or NEWS_WORDS, re.I)
    growth = re.compile(acc.get("growth_words") or GROWTH_WORDS, re.I)
    recs = enrich(accounts, work, tools or site_audit(), words, growth, workers, refresh)
    recs = [r for r in recs if r.get("website") and same_org(r["name"], r.get("maps_name"))]
    rows = [score(r, acc, words, today, about) for r in recs]
    for r in rows:
        jev_check(r, acc, client, ask)
    jev_calls = sum(1 for r in rows if r.pop("_jev_called", False))
    rows = dedupe(rows)
    entries, where = dnc_entries(acc)
    db = people_db()
    treg_total = 0.0
    for r in rows:
        apply_dnc(r, entries, where)
        relationship(r, db)
        treg_total += price_treg(r)
        for k in ("_page_emails", "_suppressed"):
            r.pop(k, None)
    rows.sort(key=lambda r: (r["tier"], -int(r["why_now_score"]), -int(r["fit"]), r["org"] or ""))
    fill = {c: sum(1 for r in rows if str(r.get(c) or "").strip()) for c in
            ("website", "buyer", "buyer_email", "why_now", "relationship")}
    summary = {"client": client, "accounts_sourced": len(accounts), "rows": len(rows),
               "limited": bool(limit), "fill": fill,
               "jev_confirmed": sum(1 for r in rows if r["buyer_check"].startswith("Jev") and "held" not in r["buyer_check"]),
               "jev_held": [r["org"] for r in rows if "held" in r["buyer_check"]],
               "tiers": {t: sum(1 for r in rows if r["tier"] == t) for t in (1, 2, 3)},
               "jev_calls": jev_calls, "dropped_no_site": len(accounts) - len(recs),
               "dnc": where, "treg_priced_rows": sum(1 for r in rows if r["treg_find"]),
               "treg_priced_usd": round(treg_total, 2), "treg_budget_usd": acc.get("treg_budget_usd")}
    return rows, summary


def write(rows: list[dict], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, extrasaction="ignore")
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
    ap.add_argument("--check", action="store_true", help="validate the accounts block and stop")
    a = ap.parse_args(argv)
    try:
        path, cfg = load(a.client)
        acc = accounts_block(cfg)
        if a.check:
            print(f"ok    {path}: ICP confirmed by {acc['icp']['confirmed_by']}, source {acc['source']['kind']}")
            return 0
        slug = path.stem
        work = clients_dir() / slug / "accounts"
        rows, summary = build(slug, acc, work, limit=a.limit, workers=a.workers, refresh=a.refresh)
    except Refused as e:
        print(f"gtme accounts: {e}", file=sys.stderr)
        return 2
    out = Path(os.path.expanduser(a.out or acc.get("out") or str(work / "accounts.csv")))
    write(rows, out)
    (work / "summary.json").write_text(json.dumps(summary, indent=2))
    f = summary["fill"]
    n = summary["rows"] or 1
    print(f"{summary['rows']} accounts from {summary['accounts_sourced']} sourced"
          f"{' (LIMITED test run)' if summary['limited'] else ''} -> {out}")
    print(f"  tiers 1/2/3: {summary['tiers'][1]}/{summary['tiers'][2]}/{summary['tiers'][3]}")
    print(f"  Jev-confirmed buyers: {summary['jev_confirmed']}; held: {', '.join(summary['jev_held']) or 'none'}")
    print("  fill: " + ", ".join(f"{k} {v}/{n}" for k, v in f.items()))
    print(f"  Jev calls: {summary['jev_calls']}; sourced but no site found: {summary['dropped_no_site']}")
    print(f"  dnc: {summary['dnc']}")
    print(f"  treg find priced for {summary['treg_priced_rows']} rows, up to ${summary['treg_priced_usd']:.2f}, "
          f"not spent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
