#!/usr/bin/env python3
"""chewbacca gtme list, list-verify and outreach: a founder's pipeline from config.

    chewbacca gtme list        --client acme [--motion customers] [--out PATH] [--limit N] [--add rows.csv]
    chewbacca gtme list-verify --client acme [--csv PATH] [--sample N] [--seed N]
    chewbacca gtme outreach    --client acme [--csv PATH] [--queue-texts]
    chewbacca gtme outreach    --founders [--event "UCLA Draper"] [--exclude myblockskin] [--queue-texts]

THE FAILURE THIS EXISTS FOR. After the UCLA Draper showcase (2026-10-22) the
first founder's list was right because one agent followed a method by hand: a
complete public registry first (an industry ranking, ranks 201 to 501), each
title confirmed on the firm's own site, a source URL per fact, emails only
where printed. Two later
list agents got "find about 50 contacts" and the method was gone (Caleb,
2026-10-26: "Plz be methodical and use everything you know when you make a
list!!!!!!"). The method is now this file, and everything that differs per
founder is the client json in ~/.chewbacca/gtm/clients/<slug>.json.

The client json (only the fields this reads; gtme_investors reads `investors`):

    "motion": ["customers", "investors"]    or a sentence: "customers first, investors second"
    "pricing_shape": "one_time_list"         or {"pick": "one_time_list", "price": 900}
    "customers": {                           also "channel_partners"
      "sources": [{"name": "MSP 501 2026", "urls": ["https://..."],
                   "extract": {"kind": "table",
                               "columns": {"Rank": "rank", "Company": "company", "Top Executive": "full_name"},
                               "where": {"country": ["United States"]}}}],
      "titles": ["Owner", "CEO", "President"],
      "exclude": ["Current Customer Inc"],
      "pages": ["", "/about", "/about-us", "/team", "/leadership", "/contact"],
      "hook": {"words": ["ConnectWise", "Autotask"], "line": "Your site mentions {hook}. ..."},
      "judge": {"question": "Is this a US MSP whose top executive buys software for the help desk?"},
      "tiers": [{"tier": "A", "need": ["judge=yes", "title_confirmed=yes", "hook"]}, ...],
      "outreach": {"sender": "Dana", "company": "Acme",
                   "linkedin": "Hi {first_name}, {line} I'm {sender} at {sender_company}. Open to connecting?",
                   "email": {"subject": "...", "body": "..."}},
      "out": "~/Downloads/Client/list.csv"}

What each step guarantees:

  list         every registry row, never a round-number cap (--limit is for test runs and says so);
               a fact only with the page it came from; an email only where the firm printed it for
               that person; a Jev yes/no on every row, unscored rows held; tiers strongest first.
               A row the method couldn't finish names its gap, for an agent to fill and --add back.
  list-verify  re-opens a random sample of every row's source pages, fresh, and checks each fact is
               still on its page. Exit 1 on any fact that isn't.
  outreach     one draft per lead or founder, LinkedIn notes counted against the 300 cap, never sent.
               --queue-texts adds a text only for someone already in the people store, through
               `people texts drafts add`, which runs voice-check and never sends either.

Network reads go through gtme_solo.fetch: public hosts only (SSRF guard), pinned DNS, 400 KB a page.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import hashlib
import html
import json
import math
import os
import random
import re
import sqlite3
import subprocess
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gtme_investors as gi  # noqa: E402
import gtme_operator as op  # noqa: E402
import gtme_solo as solo  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MOTIONS = ("customers", "channel_partners", "investors")
# Order matters: "channel partners" also contains no customer word, but
# "referral partners" and "CPAs" do mean partners, and "buyers" means customers.
MOTION_WORDS = (("investors", re.compile(r"\binvestor|\bvc\b|\bangels?\b|fundrais", re.I)),
                ("channel_partners", re.compile(r"\bpartner|\bchannel|\breferr|\bcpas?\b|\breseller", re.I)),
                ("customers", re.compile(r"\bcustomer|\bbuyer|\bclient|\bretail", re.I)))
DEFAULT_PAGES = ("", "/about", "/about-us", "/team", "/our-team", "/leadership", "/contact", "/contact-us")
# The registry table's own header words, for when a source gives no column map.
HEADER_FIELDS = {"rank": "rank", "#": "rank", "company": "company", "organization": "company", "firm": "company",
                 "name": "full_name", "top executive": "full_name", "executive": "full_name", "contact": "full_name",
                 "title": "title", "role": "title", "city": "city", "state": "state", "country": "country",
                 "website": "domain", "url": "domain", "domain": "domain"}
TITLE_ABBR = {"ceo": "chief executive officer", "coo": "chief operating officer", "cto": "chief technology officer",
              "cfo": "chief financial officer", "cro": "chief revenue officer", "vp": "vice president"}
# A title has to sit this close to the person's name on their own page to
# count as theirs. A real bio ("Brian Strong, Chief Executive Officer") puts
# it within 40 characters; 160 also catches a card layout where the title is
# a separate line. Guessed from those two shapes, never measured on a corpus.
TITLE_NEAR = 160
# Jev: a row is a yes at 0.7 and a no under 0.3; between them a person reads
# it. Guessed, never measured: a wrong yes costs a cold email to the wrong
# company, a wrong no costs one row, so the yes bar sits higher.
JUDGE_YES, JUDGE_NO = 0.7, 0.3
JUDGE_BATCH = 20
# How many rows list-verify re-opens: a tenth, never fewer than 5. Five is the
# smallest sample where one bad fact in five rows (20%) shows up more often
# than not; guessed, not derived from a target error rate.
VERIFY_SHARE, VERIFY_MIN = 0.10, 5
LINKEDIN_CAP = 300
WORKERS = 6
# Plain helpers the outreach checks share with gtme_solo.problems.
NEED = re.compile(r"\[NEED[:\]]", re.I)
COLUMNS = ["tier", "company", "domain", "rank", "city", "state", "country", "full_name", "first_name", "title",
           "title_confirmed", "title_source", "person_source", "email", "email_source", "company_inbox", "hook",
           "hook_source", "line", "line_source", "domain_source", "judge", "judge_p", "gaps", "why"]


class Refused(Exception):
    pass


# ── config ───────────────────────────────────────────────────────────────


def config_for(client: str) -> tuple[Path, dict]:
    base = gi.clients_dir()
    for cand in (base / f"{client}.json", base / f"{op.slug(client)}.json"):
        if cand.exists():
            return cand, op.read_json(cand, {})
    for cand in sorted(base.glob("*.json")):
        doc = op.read_json(cand, {})
        if isinstance(doc, dict) and op.slug(doc.get("client", "")) == op.slug(client):
            return cand, doc
    raise Refused(f"no client config for {client!r} in {base}")


def motions_of(cfg: dict) -> list[str]:
    """The client's motions in order. A list is taken as written; a sentence
    ("customers first, investors second") is read for its words, in the order
    they appear. Unknown words are an error, never a silent default."""
    raw = cfg.get("motion")
    if isinstance(raw, list):
        bad = [m for m in raw if m not in MOTIONS]
        if bad:
            raise Refused(f"motion {bad} is not one of {', '.join(MOTIONS)}")
        return list(dict.fromkeys(raw))
    if isinstance(raw, str) and raw.strip():
        found = sorted(((m.start(), kind) for kind, rx in MOTION_WORDS for m in [rx.search(raw)] if m))
        return list(dict.fromkeys(kind for _, kind in found))
    return [m for m in MOTIONS if isinstance(cfg.get(m), dict)]


def pricing_of(cfg: dict) -> dict:
    """{"shape": one of solo.SHAPES or None, "price": number or None}. A
    [NEED: ...] marker means the founder hasn't picked yet, which is None."""
    raw = cfg.get("pricing_shape")
    pick, price = (raw.get("pick"), raw.get("price")) if isinstance(raw, dict) else (raw, None)
    shape = pick if pick in solo.SHAPES else None
    if isinstance(pick, str) and pick and not shape and not NEED.search(pick):
        raise Refused(f"pricing_shape {pick!r} is not one of {', '.join(sorted(solo.SHAPES))}")
    return {"shape": shape, "price": price if isinstance(price, (int, float)) else None}


def block_for(cfg: dict, motion: str | None) -> tuple[str, dict]:
    order = motions_of(cfg)
    motion = motion or (order[0] if order else None)
    if not motion:
        raise Refused("this client names no motion; set \"motion\" in its config")
    block = cfg.get(motion) or (cfg.get("partners") if motion == "channel_partners" else None)
    if not isinstance(block, dict):
        raise Refused(f"no {motion} block in the client config")
    return motion, block


# ── pages ────────────────────────────────────────────────────────────────


def cache_dir() -> Path:
    return Path(os.environ.get("GTME_LIST_CACHE") or Path.home() / ".cache" / "chewbacca" / "gtme-list")


# A registry page is read whole. The first test run (2026-10-26) read the MSP
# 501 pages at the site-page cap of 400 KB; each is about 1.27 MB, so every
# row past the first third was never seen, and the verifier then failed two
# true names (Treysta, Universal Data) that sat past the cut.
REGISTRY_BYTES = solo.PAGE_CHARS


def page(url: str, fresh: bool = False, limit: int = solo.FETCH_BYTES) -> str:
    """One public page, cached so a rerun reads nothing twice. list-verify
    passes fresh=True: a fact is only verified against the page as it is now."""
    if os.environ.get("GTME_FIXTURES"):
        return solo.fetch(url)
    path = cache_dir() / (hashlib.sha1(f"{url} {limit}".encode()).hexdigest() + ".html")
    if not fresh and path.exists():
        return path.read_text(errors="replace")
    body = solo.fetch(url, limit)
    if body:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
    return body


def text_of(body: str) -> str:
    body = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", body or "")
    body = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h\d|td|tr)>", "\n", body)
    return re.sub(r"[ \t\r\f\v]+", " ", html.unescape(re.sub(r"<[^>]+>", " ", body)))


def norm(s: str) -> str:
    s = html.unescape(s or "").replace("’", "'").replace(" ", " ").lower()
    return re.sub(r"\s+", " ", s).strip()


def on_page(value: str, body: str) -> bool:
    """Is this fact on the page, ignoring case, spacing, entities and the
    usual title abbreviations (CEO for Chief Executive Officer)?"""
    v, t = norm(value), norm(text_of(body)) + " " + norm(urllib.parse.unquote(body or ""))
    if not v:
        return False
    if v in t:
        return True
    for short, long in TITLE_ABBR.items():
        if v == long and re.search(rf"\b{short}\b", t) or v == short and long in t:
            return True
    return False


# ── seed: the registry ──────────────────────────────────────────────────


def cells(row_html: str) -> list[str]:
    return [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip()
            for c in re.findall(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>", row_html)]


def extract_table(body: str, spec: dict) -> list[dict]:
    """Rows of every table on the page whose header maps to a company. The
    header row's own words pick the fields unless the source names them."""
    names = {norm(k): v for k, v in (spec.get("columns") or {}).items()} or HEADER_FIELDS
    out = []
    for table in re.findall(r"(?is)<table[^>]*>(.*?)</table>", body):
        rows = [cells(r) for r in re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", table)]
        rows = [r for r in rows if any(r)]
        if not rows:
            continue
        fields = [names.get(norm(h)) for h in rows[0]]
        if "company" not in fields:
            continue
        for r in rows[1:]:
            rec = {f: v for f, v in zip(fields, r) if f and v}
            if rec.get("company"):
                out.append(rec)
    return out


def extract_regex(body: str, spec: dict) -> list[dict]:
    rx = re.compile(spec["pattern"], re.I | re.M)
    return [{k: v.strip() for k, v in m.groupdict().items() if v} for m in rx.finditer(text_of(body))]


def links_by_text(body: str) -> dict[str, str]:
    """Company name -> its site, from links on the registry page itself."""
    out = {}
    for href, label in re.findall(r"(?is)<a[^>]+href=[\"'](https?://[^\"']+)[\"'][^>]*>(.*?)</a>", body):
        label = norm(re.sub(r"<[^>]+>", "", label))
        host = solo.domain_of(href)
        if label and host and not gov(host) and not re.search(r"linkedin|twitter|x\.com|facebook|instagram|youtube", host):
            out.setdefault(label, host)
    return out


# An award registry (SBIR) prints the agency's program officer beside the
# company. 2026-10-26: 10 of 265 rows carried a .gov or .mil email, one army.mil
# officer on two companies, and 27 rows took their domain from it.
GOV_HOST = re.compile(r"(^|\.)[a-z0-9-]+\.(gov|mil)(\.[a-z]{2})?$", re.I)


def gov(host_or_email: str) -> bool:
    return bool(GOV_HOST.search((host_or_email or "").rsplit("@", 1)[-1].strip().lower()))


def matches(value: str, allowed: list[str]) -> bool:
    v = norm(value)
    return any(norm(a) in v for a in allowed)


def seed(block: dict) -> tuple[list[dict], dict]:
    rows, report = [], {"sources": [], "dropped": {}}
    exclude = block.get("exclude") or []
    for src in block.get("sources") or []:
        urls = src.get("urls") or ([src["url"]] if src.get("url") else [])
        spec = src.get("extract") or {"kind": "table"}
        got = 0
        for url in urls:
            body = page(url, limit=REGISTRY_BYTES)
            if not body:
                report["sources"].append({"name": src.get("name"), "url": url, "rows": 0, "error": "unreachable"})
                continue
            found = extract_regex(body, spec) if spec.get("kind") == "regex" else extract_table(body, spec)
            links = links_by_text(body)
            n = 0
            for rec in found:
                if not rec.get("company"):
                    continue
                if any(not matches(rec.get(f, ""), vals) for f, vals in (spec.get("where") or {}).items()):
                    report["dropped"]["outside the source filter"] = report["dropped"].get("outside the source filter", 0) + 1
                    continue
                if exclude and matches(rec["company"], exclude):
                    report["dropped"]["excluded by the client"] = report["dropped"].get("excluded by the client", 0) + 1
                    continue
                rec["registry_source"] = url
                if gov(rec.get("email", "")) or gov(rec.get("domain", "")):
                    report["dropped"]["agency contact, not the company"] = report["dropped"].get(
                        "agency contact, not the company", 0) + 1
                    if gov(rec.get("email", "")):
                        rec.pop("email", None)
                        rec.pop("full_name", None)
                        rec.pop("title", None)
                    if gov(rec.get("domain", "")):
                        rec.pop("domain", None)
                if not rec.get("domain") and links.get(norm(rec["company"])):
                    rec["domain"], rec["domain_source"] = links[norm(rec["company"])], url
                if rec.get("full_name"):
                    rec["person_source"] = url
                rows.append(rec)
                n += 1
            got += n
            report["sources"].append({"name": src.get("name"), "url": url, "rows": n})
        if not urls:
            report["sources"].append({"name": src.get("name"), "rows": 0, "note": "a method step, not a registry"})
    seen, out = set(), []
    for r in rows:
        key = op.slug(r["company"])
        if key in seen:
            report["dropped"]["same company twice"] = report["dropped"].get("same company twice", 0) + 1
            continue
        seen.add(key)
        out.append(r)
    return out, report


# ── confirm: each firm's own site ───────────────────────────────────────

LEGAL = re.compile(r"\b(inc|llc|ltd|corp|co|company|group|the|technologies|technology|solutions|services|it|"
                   r"networks?|systems|consulting|managed|partners)\b", re.I)


def domain_guesses(company: str) -> list[str]:
    core = op.slug(LEGAL.sub(" ", company)) or op.slug(company)
    full = op.slug(company)
    stems = list(dict.fromkeys([full.replace("-", ""), core.replace("-", ""), full, core]))
    return [f"{s}.{tld}" for s in stems if s for tld in ("com", "net", "io", "us")]


LEGAL_SUFFIX = re.compile(r"\b(inc|llc|ltd|corp|co|l\.?p)\.?$", re.I)


def names_company(body: str, company: str) -> bool:
    """The homepage title or site name carries the company's distinctive
    words, and the page says the company's whole name somewhere. The second
    half is there because the first test run (2026-10-26) matched Mann
    Consulting to mann.com and ACS Services to acs.io, other companies whose
    names share the short word."""
    head = norm(" ".join(solo.TITLE_RX.findall(body)[:1] + re.findall(
        r"(?i)<meta[^>]+property=[\"']og:site_name[\"'][^>]*content=[\"']([^\"']+)", body)))
    words = [w for w in re.findall(r"[a-z0-9]+", norm(LEGAL.sub(" ", company))) if len(w) > 2]
    squashed = re.sub(r"[^a-z0-9]", "", head)
    whole = re.sub(r"[^a-z0-9]", "", norm(LEGAL_SUFFIX.sub("", company.strip())))
    return bool(words) and all(w in squashed for w in words) and whole in re.sub(r"[^a-z0-9]", "", norm(text_of(body)))


def find_domain(rec: dict) -> str:
    if rec.get("domain"):
        return solo.domain_of(rec["domain"])
    for guess in domain_guesses(rec["company"]):
        body = page(f"https://{guess}/")
        if body and names_company(body, rec["company"]):
            rec["domain_source"] = f"https://{guess}/"
            return guess
    return ""


NAME_RX = r"([A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,2})"


def title_near(text: str, name: str, titles: list[str]) -> str:
    for m in re.finditer(re.escape(name), text, re.I):
        window = text[m.end():m.end() + TITLE_NEAR] + " " + text[max(0, m.start() - 60):m.start()]
        for t in titles:
            if re.search(rf"\b{re.escape(t)}\b", window, re.I):
                hit = re.search(rf"\b{re.escape(t)}\b[\w ,&-]{{0,40}}", window, re.I)
                return re.split(r"\s{2,}|\n|,\s(?=[A-Z][a-z]+\s[A-Z])", hit.group(0).strip())[0][:80].strip(" ,&-")
    return ""


def person_by_title(text: str, titles: list[str]) -> tuple[str, str]:
    for t in titles:
        m = re.search(rf"{NAME_RX}\s*[,|\n–-]?\s*(?:\n\s*)?({re.escape(t)}\b[\w ,&-]{{0,40}})", text)
        if m:
            return m.group(1).strip(), m.group(2).strip().split("\n")[0][:80]
    return "", ""


def person_email(emails: list[str], name: str) -> str:
    parts = [p for p in re.findall(r"[a-z]+", norm(name)) if len(p) > 1]
    if len(parts) < 2:
        return ""
    first, last = parts[0], parts[-1]
    ok = {first, last, f"{first}.{last}", f"{first}{last}", f"{first[0]}{last}", f"{first}{last[0]}",
          f"{first}_{last}", f"{first[0]}.{last}"}
    return next((e for e in emails if e.split("@")[0] in ok), "")


def confirm(rec: dict, block: dict) -> dict:
    titles = block.get("titles") or ["Owner", "CEO", "Founder", "President"]
    gaps = []
    if rec.get("full_name"):
        rec["first_name"] = gi.first_name(rec["full_name"])
    dom = find_domain(rec)
    rec["domain"] = dom
    if not dom:
        rec["gaps"] = "no site found for the company, add its domain"
        return rec
    hook = block.get("hook") or {}
    seen_emails: dict[str, str] = {}
    for path in block.get("pages") or DEFAULT_PAGES:
        url = f"https://{dom}{path}" if path else f"https://{dom}/"
        body = page(url)
        if not body:
            continue
        text = text_of(body)
        if not rec.get("_fact"):
            rec["_fact"] = solo.fact_on(body)
        if not rec.get("full_name"):
            name, title = person_by_title(text, titles)
            if name:
                rec.update(full_name=name, title=title, title_confirmed="yes", title_source=url, person_source=url)
        elif rec.get("title_confirmed") != "yes" and on_page(rec["full_name"], body):
            title = title_near(text, rec["full_name"], titles)
            if title:
                rec.update(title=title, title_confirmed="yes", title_source=url)
        for e in solo.emails_on(body, dom):
            seen_emails.setdefault(e, url)
        if hook.get("words") and not rec.get("hook"):
            # Raw HTML too: a PSA often shows up only as a logo's alt text or a portal link.
            for w in hook["words"]:
                if re.search(rf"\b{re.escape(w)}\b", text, re.I) or re.search(
                        re.escape(re.sub(r"\s+", "", w)), re.sub(r"\s+", "", body), re.I):
                    rec["hook"], rec["hook_source"] = w, url
                    break
    if rec.get("full_name"):
        rec["first_name"] = gi.first_name(rec["full_name"])
        own = person_email(list(seen_emails), rec["full_name"])
        if own:
            rec["email"], rec["email_source"] = own, seen_emails[own]
    role = [e for e in seen_emails if solo.ROLE.match(e)]
    if role:
        rec["company_inbox"] = role[0]
    if rec.get("hook") and hook.get("line"):
        rec["line"] = fill(hook["line"], rec)
        rec["line_source"] = "; ".join(dict.fromkeys(
            x for x in (rec["hook_source"], rec.get("registry_source") if "{rank}" in hook["line"] else "") if x))
    rec.setdefault("title_confirmed", "no")
    if not rec.get("full_name"):
        gaps.append("no person with a buyer title on the site")
    elif rec["title_confirmed"] != "yes":
        gaps.append("title not on the firm's own site")
    if not rec.get("email"):
        gaps.append("no email printed for the person")
    if hook.get("words") and not rec.get("hook"):
        gaps.append("no hook on the site")
    rec["gaps"] = "; ".join(gaps)
    return rec


def fill(template: str, rec: dict, extra: dict | None = None) -> str:
    vals = {**{k: str(v) for k, v in rec.items() if not k.startswith("_")}, **(extra or {})}
    return re.sub(r"\{(\w+)\}", lambda m: vals.get(m.group(1), m.group(0)), template).strip()


# ── judge and tier ──────────────────────────────────────────────────────


def jev_judge(states: list[dict], question: str) -> list[float | None]:
    """One Jev call per JUDGE_BATCH rows: the same yes/no question, asked of each row."""
    sys.path.insert(0, str(ROOT / "bin" / "lib"))
    try:
        import jev
    except ImportError:
        return [None] * len(states)
    out: list[float | None] = []
    for i in range(0, len(states), JUDGE_BATCH):
        chunk = states[i:i + JUDGE_BATCH]
        qs = {f"row:{j}": {"type": "noul", "instructions": f"Look only at row {j}. {question}"}
              for j in range(len(chunk))}
        answers = jev.ask({"rows": chunk}, qs, decision="gtme-list-judge") or {}
        for j in range(len(chunk)):
            a = answers.get(f"row:{j}")
            out.append(jev.probability(a.get("noul")) if isinstance(a, dict) else None)
    return out


def judge(rows: list[dict], block: dict, ask=jev_judge) -> None:
    q = (block.get("judge") or {}).get("question")
    if not q:
        for r in rows:
            r["judge"], r["judge_p"] = "unjudged", ""
        return
    states = [{k: r.get(k, "") for k in ("company", "domain", "full_name", "title", "city", "state", "country",
                                         "hook", "rank")} | {"site_says": r.get("_fact", "")} for r in rows]
    yes = float((block.get("judge") or {}).get("yes", JUDGE_YES))
    for r, p in zip(rows, ask(states, q)):
        r["judge_p"] = "" if p is None else f"{p:.2f}"
        r["judge"] = "unjudged" if p is None else "yes" if p >= yes else "no" if p < JUDGE_NO else "unsure"


DEFAULT_TIERS = [{"tier": "A", "need": ["judge=yes", "title_confirmed=yes", "email"]},
                 {"tier": "A", "need": ["judge=yes", "title_confirmed=yes", "hook"]},
                 {"tier": "B", "need": ["judge=yes", "title_confirmed=yes"]},
                 {"tier": "C", "need": ["judge=yes"]}]


def meets(rec: dict, need: str) -> bool:
    field, _, want = need.partition("=")
    have = str(rec.get(field) or "").strip()
    return have.lower() == want.lower() if want else bool(have) and have.lower() != "no"


def tier(rows: list[dict], block: dict) -> None:
    rules = block.get("tiers") or DEFAULT_TIERS
    for r in rows:
        r["tier"] = "hold" if r.get("judge") in ("unjudged", "unsure") else next(
            (t["tier"] for t in rules if all(meets(r, n) for n in t.get("need", []))), "hold")


def rank_key(r: dict):
    order = {"A": 0, "B": 1, "C": 2, "D": 3, "hold": 8, "no": 9}
    rank = re.sub(r"[^\d.]", "", str(r.get("rank") or ""))
    return (order.get(r["tier"], 7), float(rank) if rank else math.inf, -float(r.get("judge_p") or 0))


def why_of(r: dict) -> str:
    out = []
    if r.get("rank"):
        out.append(f"registry #{r['rank']}")
    if r.get("title_confirmed") == "yes":
        out.append(f"{r.get('title') or 'title'} confirmed on own site")
    if r.get("hook"):
        out.append(f"site names {r['hook']}")
    if r.get("email"):
        out.append("email printed on own site")
    out.append(f"judge {r['judge']}" + (f" {r['judge_p']}" if r.get("judge_p") else ""))
    return "; ".join(out)


def build(block: dict, limit: int = 0, added: list[dict] | None = None, ask=jev_judge) -> tuple[list[dict], dict]:
    rows, report = seed(block)
    report["registry_rows"] = len(rows)
    if limit:
        rows = rows[:limit]
        report["test_limit"] = limit
    with concurrent.futures.ThreadPoolExecutor(WORKERS) as ex:
        rows = list(ex.map(lambda r: confirm(r, block), rows))
    have = {op.slug(r["company"]) for r in rows}
    for extra in added or []:
        if extra.get("company") and op.slug(extra["company"]) not in have:
            rows.append(extra)
    judge(rows, block, ask)
    no = [r for r in rows if r["judge"] == "no"]
    rows = [r for r in rows if r["judge"] != "no"]
    report["judged_no"] = len(no)
    tier(rows, block)
    for r in rows:
        r["why"] = why_of(r)
    rows.sort(key=rank_key)
    report["tiers"] = {t: sum(1 for r in rows if r["tier"] == t) for t in sorted({r["tier"] for r in rows})}
    report["gaps"] = {}
    for r in rows:
        for g in filter(None, (r.get("gaps") or "").split("; ")):
            report["gaps"][g] = report["gaps"].get(g, 0) + 1
    return rows, report


def write_rows(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: op.csv_cell(str(r.get(k) or "")) for k in COLUMNS})


def read_rows(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8", errors="replace") as fh:
        return list(csv.DictReader(fh))


# ── verify: re-open a sample ─────────────────────────────────────────────


def fact_pairs(cols: list[str]) -> list[tuple[str, str]]:
    """(fact column, its source column). Any X with an X_source column, and
    person_source for the person's name. line_source backs a sentence we
    wrote, not a fact on a page, so it isn't re-checked as one."""
    pairs = [(c[:-7], c) for c in cols if c.endswith("_source") and c[:-7] in cols and c != "line_source"]
    if "person_source" in cols and "full_name" in cols:
        pairs.append(("full_name", "person_source"))
    return pairs


def verify(rows: list[dict], sample: int | None = None, seed_n: int | None = None, fetch=None) -> dict:
    fetch = fetch or (lambda u: page(u, fresh=True, limit=REGISTRY_BYTES))
    cols = list(rows[0]) if rows else []
    pairs = fact_pairs(cols)
    usable = [r for r in rows if any(r.get(f) and r.get(s) for f, s in pairs)]
    n = min(len(usable), sample or max(VERIFY_MIN, math.ceil(len(usable) * VERIFY_SHARE)))
    picked = random.Random(seed_n).sample(usable, n) if n else []
    out = {"rows": len(rows), "sampled": n, "checked": 0, "passed": 0, "failed": [], "unreachable": []}
    bodies: dict[str, str] = {}
    for r in picked:
        for field, src in pairs:
            # The list's own "not confirmed" mark means it never claimed this one.
            if not (r.get(field) and r.get(src)) or str(r.get(f"{field}_confirmed", "")).lower() == "no":
                continue
            urls = [u.strip() for u in re.split(r"[;\s]+", r[src]) if u.strip().startswith("http")]
            for u in urls:
                if u not in bodies:
                    bodies[u] = fetch(u)
            live = [bodies[u] for u in urls if bodies[u]]
            # Lists ("ConnectWise; Pax8") are checked item by item; a name or a
            # title is one value, so a note pasted into it fails whole.
            parts = [r[field]] if field in ("title", "full_name", "company") else r[field].split(";")
            for value in [v.strip() for v in parts if v.strip()]:
                fact = {"company": r.get("company", ""), "field": field, "value": value, "source": r[src]}
                if not live:
                    out["unreachable"].append(fact)
                    continue
                out["checked"] += 1
                # A domain is proved by its own homepage naming the company,
                # since most homepages never print their own domain.
                if any(on_page(value, b) for b in live) or field == "domain" and any(
                        solo.domain_of(u) == value and names_company(bodies[u], r.get("company", ""))
                        for u in urls if bodies[u]):
                    out["passed"] += 1
                else:
                    out["failed"].append(fact)
    return out


def print_verify(res: dict) -> None:
    print(f"  re-opened {res['sampled']} of {res['rows']} rows: {res['passed']} of {res['checked']} facts still on "
          f"their page, {len(res['failed'])} not, {len(res['unreachable'])} on a page that didn't load")
    for f in res["failed"][:20]:
        print(f"    NOT ON PAGE  {f['company']}: {f['field']} {f['value']!r} at {f['source']}")


# ── outreach drafts ──────────────────────────────────────────────────────


def fit_note(template: str, rec: dict, extra: dict) -> tuple[str, list[str]]:
    """A LinkedIn note under the 300 cap. The line's later sentences go first,
    then the note is held: it is never cut mid-sentence."""
    line = rec.get("line") or ""
    sentences = re.split(r"(?<=[.!?])\s+", line) if line else [""]
    for keep in range(len(sentences), 0, -1):
        note = re.sub(r"\s{2,}", " ", fill(template, {**rec, "line": " ".join(sentences[:keep])}, extra))
        if len(note) <= LINKEDIN_CAP:
            return note, []
    return note, [f"{len(note)} characters, over LinkedIn's {LINKEDIN_CAP}"]


def held(text: str) -> list[str]:
    out = []
    if solo.DASH.search(text):
        out.append("it has a long dash")
    if re.search(r"\{\w+\}|\{\{", text):
        out.append("a {blank} is still in it")
    if NEED.search(text):
        out.append("a [NEED] marker is still in it")
    return out


def people_db() -> Path:
    return Path(os.environ.get("PEOPLE_DIR") or Path.home() / ".chewbacca" / "people") / "people.db"


def known_people(names: list[str]) -> set[str]:
    """Which of these names are already in the people store, by exact name."""
    db = people_db()
    if not db.exists() or not names:
        return set()
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        got = {norm(n) for (n,) in con.execute("SELECT name FROM people WHERE deleted_at IS NULL")}
        con.close()
    except sqlite3.Error:
        return set()
    return {n for n in names if norm(n) in got}


def queue_text(who: str, text: str, why: str) -> str:
    people = os.environ.get("GTME_PEOPLE_BIN") or "people"
    try:
        proc = subprocess.run([people, "texts", "drafts", "add", who, text, "--why=" + why],
                              capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as err:
        return f"not queued: {err}"
    if proc.returncode != 0:
        said = (proc.stderr or proc.stdout).strip().splitlines()
        return "not queued: " + (said[-1] if said else f"people exited {proc.returncode}")
    m = re.search(r"#(\d+)", proc.stdout)
    return f"queued as text draft #{m.group(1)}" if m else "queued"


DEFAULT_NOTE = "Hi {first_name}. {line} I'm {sender} at {sender_company}. Open to connecting?"


def lead_drafts(rows: list[dict], block: dict, cfg: dict, queue: bool) -> list[dict]:
    o = block.get("outreach") or {}
    extra = {"sender": o.get("sender") or "", "sender_company": o.get("company") or cfg.get("client", "")}
    known = known_people([r.get("full_name", "") for r in rows if r.get("full_name")])
    out = []
    for r in rows:
        if r.get("tier") in ("hold", "no") or not r.get("full_name"):
            continue
        r = {**r, "first_name": r.get("first_name") or gi.first_name(r["full_name"])}
        d = {"to": r["full_name"], "company": r.get("company", ""), "tier": r.get("tier", ""),
             "source": r.get("line_source", "")}
        note, why = fit_note(o.get("linkedin") or DEFAULT_NOTE, r, extra)
        d["linkedin"], d["linkedin_chars"] = note, len(note)
        d["held"] = why + held(note) + ([] if r.get("line") else ["no sourced line for this lead"])
        if o.get("email") and r.get("email"):
            d["email"] = {"to": r["email"], "subject": fill(o["email"].get("subject", ""), r, extra),
                          "body": fill(o["email"].get("body", ""), r, extra)}
            d["held"] += [f"email: {x}" for x in held(d["email"]["subject"] + "\n" + d["email"]["body"])]
        if r["full_name"] in known and o.get("text"):
            d["text"] = fill(o["text"], r, extra)
            if queue and not d["held"]:
                d["text_status"] = queue_text(r["full_name"], d["text"], f"gtme outreach {cfg.get('client_slug', '')}")
        out.append(d)
    return out


FOUNDER_NOTE = ("Hi {first_name}, great meeting you at {event}. I built {built} for {company}. "
                "Want me to walk you through it?")
CONFIRM_EMAIL = ("Hi {first_name},\n\nConfirming {call}. I'll bring {built} and walk through how we'd run it."
                 "\n\nSee you then,\n{me}")


def founder_of(cfg: dict) -> tuple[str, str]:
    m = re.match(r"\s*([^,;(]+?)\s*(?:,|\(|$)", cfg.get("contact") or "")
    name = m.group(1).strip() if m else ""
    em = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", cfg.get("contact") or "")
    return name, em.group(0) if em else ""


def built_for(cfg: dict) -> tuple[str, list[str]]:
    """What's already built for this founder, counted from the files, never from notes."""
    parts, missing = [], []
    for m in motions_of(cfg):
        blk = cfg.get(m) or {}
        out = blk.get("out")
        path = Path(os.path.expanduser(out)) if out else None
        if path and path.exists():
            n = sum(1 for _ in read_rows(path))
            parts.append(f"a list of {n} {m.replace('_', ' ')}")
        elif blk:
            missing.append(m)
    return (" and ".join(parts) if parts else ""), missing


def founder_drafts(event: str, exclude: list[str], queue: bool, me: str) -> list[dict]:
    out = []
    for path in sorted(gi.clients_dir().glob("*.json")):
        cfg = op.read_json(path, {})
        if not isinstance(cfg, dict) or not cfg.get("contact"):
            continue
        slugname = cfg.get("client_slug") or path.stem
        if slugname in exclude or (event and event.lower() not in (cfg.get("source") or "").lower()):
            continue
        name, email = founder_of(cfg)
        built, missing = built_for(cfg)
        rec = {"first_name": gi.first_name(name), "company": cfg.get("client", slugname)}
        extra = {"event": event or "the showcase", "built": built, "me": me, "call": cfg.get("call") or ""}
        note = re.sub(r"\s{2,}", " ", fill(FOUNDER_NOTE, rec, extra))
        d = {"client": slugname, "to": name, "linkedin": note, "linkedin_chars": len(note),
             "held": held(note) + ([f"{len(note)} characters, over {LINKEDIN_CAP}"] if len(note) > LINKEDIN_CAP else [])
             + ([] if built else ["nothing built for them yet: no list file on disk"])}
        if missing:
            d["not_built"] = missing
        if cfg.get("call") and email:
            d["email"] = {"to": email, "subject": f"Confirming {cfg['call']}", "body": fill(CONFIRM_EMAIL, rec, extra)}
        if name in known_people([name]):
            d["text"] = re.sub(r"\s{2,}", " ", fill(cfg.get("text") or FOUNDER_NOTE, rec, extra))
            if queue and not d["held"]:
                d["text_status"] = queue_text(name, d["text"], f"gtme outreach {slugname}")
        out.append(d)
    return out


def write_drafts(drafts: list[dict], path: Path, title: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(drafts, indent=1))
    lines = [f"# {title}", "", "Drafts only. Nothing here was sent.", ""]
    for d in drafts:
        lines += [f"## {d['to']}" + (f", {d.get('company') or d.get('client')}"), ""]
        if d["held"]:
            lines += [f"- HELD: {'; '.join(d['held'])}", ""]
        lines += [f"- LinkedIn ({d['linkedin_chars']} of {LINKEDIN_CAP}): {d['linkedin']}", ""]
        if d.get("email"):
            lines += [f"- Email to {d['email']['to']}, subject \"{d['email']['subject']}\":", "",
                      "```", d["email"]["body"], "```", ""]
        if d.get("text"):
            lines += [f"- Text: {d['text']}" + (f" ({d['text_status']})" if d.get("text_status") else ""), ""]
        if d.get("source"):
            lines += [f"- Source: {d['source']}", ""]
    md = path.with_suffix(".md")
    md.write_text("\n".join(lines))
    return md


# ── commands ─────────────────────────────────────────────────────────────

LEGACY = -1


def out_path(block: dict, given: str | None) -> Path:
    if given:
        return Path(os.path.expanduser(given))
    if not block.get("out"):
        raise Refused("no output path: pass --out or set \"out\" in the block")
    return Path(os.path.expanduser(block["out"]))


def cmd_list(a) -> int:
    try:
        path, cfg = config_for(a.client)
    except Refused:
        return LEGACY
    try:
        motion, block = block_for(cfg, a.motion)
    except Refused:
        if a.motion:
            raise
        return LEGACY
    if motion == "investors":
        argv = ["--config", str(path)] + (["--out", a.out] if a.out else []) + (
            ["--limit", str(a.limit)] if a.limit else [])
        return gi.main(argv)
    if not block.get("sources"):
        return LEGACY
    added = read_rows(Path(os.path.expanduser(a.add))) if a.add else []
    rows, report = build(block, a.limit or 0, added)
    out = out_path(block, a.out)
    write_rows(rows, out)
    res = verify(read_rows(out), seed_n=a.seed) if rows and not a.no_verify else None
    report.update(out=str(out), written=len(rows), motion=motion, verify=res)
    out.with_suffix(".report.json").write_text(json.dumps(report, indent=1))
    if a.json:
        print(json.dumps(report, indent=1))
    else:
        print(f"{cfg.get('client')}, {motion}: {report['registry_rows']} registry rows from "
              f"{sum(1 for s in report['sources'] if s.get('url'))} pages"
              + (f", first {a.limit} only (a test run, not the list)" if a.limit else ""))
        print(f"  {len(rows)} written to {out}, {report['judged_no']} judged no and left out")
        print("  tiers: " + ", ".join(f"{t} {n}" for t, n in report["tiers"].items()))
        for g, n in sorted(report["gaps"].items(), key=lambda kv: -kv[1]):
            print(f"  gap  {n:>4}  {g}")
        if res:
            print_verify(res)
    return 1 if res and res["failed"] else 0


def cmd_verify(a) -> int:
    if a.csv:
        path = Path(os.path.expanduser(a.csv))
    else:
        _, cfg = config_for(a.client)
        _, block = block_for(cfg, a.motion)
        path = out_path(block, None)
    rows = read_rows(path)
    res = verify(rows, a.sample, a.seed)
    if a.json:
        print(json.dumps(res, indent=1))
    else:
        print(f"{path}")
        print_verify(res)
    return 1 if res["failed"] or not res["checked"] else 0


def cmd_outreach(a) -> int:
    if a.founders:
        drafts = founder_drafts(a.event or "", a.exclude or [], a.queue_texts, a.me)
        name = f"{a.event or 'Founder'} outreach drafts"
        path = Path(os.path.expanduser(a.out or f"~/Downloads/{name}.json"))
    else:
        if not a.client:
            raise Refused("pass --client, or --founders for one note per founder")
        _, cfg = config_for(a.client)
        motion, block = block_for(cfg, a.motion)
        src = Path(os.path.expanduser(a.csv)) if a.csv else out_path(block, None)
        drafts = lead_drafts(read_rows(src), block, cfg, a.queue_texts)
        name = f"{cfg.get('client', a.client)} {motion.replace('_', ' ')} outreach drafts"
        path = Path(os.path.expanduser(a.out)) if a.out else src.with_name(op.slug(name) + ".json")
    md = write_drafts(drafts, path, name)
    ready = sum(1 for d in drafts if not d["held"])
    queued = sum(1 for d in drafts if str(d.get("text_status", "")).startswith("queued"))
    print(f"{len(drafts)} drafts, {ready} clean, {len(drafts) - ready} held with a reason, {queued} text drafts "
          f"queued. Nothing sent.\n  {md}")
    for d in drafts:
        if d["held"]:
            print(f"  HELD  {d['to']}: {'; '.join(d['held'])}")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="chewbacca gtme", description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("list", help="the whole registry, confirmed on each firm's own site, judged and tiered")
    p.add_argument("--client", required=True)
    p.add_argument("--motion", choices=MOTIONS)
    p.add_argument("--out")
    p.add_argument("--limit", type=int, help="first N registry rows only, for a test run")
    p.add_argument("--add", help="a CSV of rows an agent finished by hand, merged in and judged like the rest")
    p.add_argument("--seed", type=int, help="fix the verifier's sample")
    p.add_argument("--no-verify", action="store_true")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("list-verify", help="re-open a random sample of sources and check every fact is there")
    p.add_argument("--client")
    p.add_argument("--motion", choices=MOTIONS)
    p.add_argument("--csv")
    p.add_argument("--sample", type=int)
    p.add_argument("--seed", type=int)
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("outreach", help="LinkedIn notes, emails and texts as drafts, never sent")
    p.add_argument("--client")
    p.add_argument("--motion", choices=MOTIONS)
    p.add_argument("--csv")
    p.add_argument("--founders", action="store_true", help="one note per founder in the client configs")
    p.add_argument("--event", help="only founders whose config source names this event")
    p.add_argument("--exclude", action="append", help="a client slug to leave out (repeatable)")
    p.add_argument("--me", default=os.environ.get("GTME_SENDER_NAME", ""), help="the sign-off on founder emails")
    p.add_argument("--queue-texts", action="store_true", help="add text drafts for people you already know")
    p.add_argument("--out")
    a = ap.parse_args(argv)
    if a.cmd == "list-verify" and not (a.client or a.csv):
        ap.error("list-verify needs --client or --csv")
    try:
        return {"list": cmd_list, "list-verify": cmd_verify, "outreach": cmd_outreach}[a.cmd](a)
    except Refused as err:
        print(f"chewbacca gtme: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
