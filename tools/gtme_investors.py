#!/usr/bin/env python3
"""chewbacca gtme investors: a per-client investor list from the Prometheus file.

    gtme-investors --client acme                     reads ~/.chewbacca/gtm/clients/acme.json
    gtme-investors --config path/to/client.json --out list.csv
    gtme-investors --client acme --dry-run           counts only, writes nothing
    gtme-investors --check-config path.json          validate the investors block

Every client that is raising wants the same step: pull the seed and pre-seed
investors who fit its thesis out of the investor database, drop the rows that
would break a send, and hand back one deduped, audited CSV. The only thing
that differs per client is the `investors` block in its config file, so no
client name appears in this file.

The investors block (every field optional except thesis):

    {"investors": {
       "thesis": ["saas", "software", "it services"],   sector words, matched as words
       "thesis_text": ["msp", "managed services"],      also matched in firm name and title
       "stage": ["seed", "pre-seed", "early stage"],    words that mark an early investor
       "max_check_musd": 3.0,                           the round: a smallest check above this is dropped
       "min_check_musd": 0.05,                          a largest check under this is dropped
       "require_stage": false,                          true drops rows with no early-stage evidence
       "org_types": ["VC", "Angel", "Investor"],
       "countries": ["united states", "usa", "us"],
       "regions": ["north america"],
       "exclude_sectors": ["crypto", "real estate"],
       "exclude_orgs": ["some fund"],                    substring of the firm name
       "seniority": ["A_founder_cxo", "B_vp_director"],
       "unknown_sector": "judge",                       blank-sector generalists: judge (a Jev yes only,
                                                        the default), keep (every one), or drop
       "judge": {"question": "..."},                    the yes/no Jev asks of each generalist
       "per_firm": 1,                                   contacts per firm, the best fit first
       "limit": 500,
       "out": "~/Downloads/Client/investors.csv",
       "suppress": ["~/path/already-emailed.csv"],       any CSV with an email column
       "db": "~/path/prometheus.db",
       "angels": true}}                                 or --angels: the angel pass, see build_angels

The database path comes from --db, then the block's "db", then $PROMETHEUS_DB.

What the file is, measured 2026-09-20 against the 1,039,715-row original: 52,350
people with an email and grade A or B, 984 of them role inboxes, the company
column junk on 48% (the literal "Person", blank, "Unknown", Airtable image
URLs), and sectors blank or "unknown" on 43%. A sector filter silently drops
that 43%, so `unknown_sector: judge` asks Jev about each generalist and keeps
only a yes, after every thesis match; the old `include_unknown_sector: false`
still means drop. A list is never padded to its limit with unjudged rows. Where a LinkedIn slug shares no
token with the name, 89.7% were confirmed wrong, so those slugs are blanked.

Writes nothing but the CSV. Never sends. The network is read only by the
judge (firm sites, portfolio pages, Jev) and, in angel mode, one MX lookup
per mail domain. After
writing it runs `list-audit` on the file and prints the result; exit 1 when
the audit finds a defect the tool should have removed.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import json
import os
import re
import sqlite3
import subprocess
import sys
import urllib.parse
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
# bin/gtme-investors runs this file through runpy, which puts bin/ on the
# path, not tools/: the judge's import of gtme_pipeline failed that way on
# 11 of 13 founder lists (2026-10-26) while every in-process test passed.
sys.path.insert(0, str(ROOT / "tools"))
import gtme_accounts  # noqa: E402  the stage runner every list builder shares

# Role inboxes are not people. 984 of 52,350 in the original file, attached to
# a real person's name so they pass a spreadsheet eyeball check.
ROLE_LOCALS = {
    "info", "contact", "hello", "admin", "support", "sales", "team", "office",
    "inquiries", "enquiries", "general", "ir", "press", "marketing", "careers",
    "jobs", "help", "noreply", "no-reply", "mail", "email", "hi", "invest",
    "investments", "investors", "deals", "dealflow", "pitch", "pitches",
    "submissions", "partners", "founders", "media", "hr", "accounts",
    "billing", "operations", "ops", "enquiry", "inquiry", "funding", "apply",
}
# The company column's four kinds of junk, plus values a scraper writes.
COMPANY_JUNK = {"person", "company", "unknown", "n/a", "na", "none", "-", "null",
                "nan", "self", "self-employed", "private", "individual", "angel",
                "investor", "independent"}
EMAIL_RE = re.compile(r"^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$")

SENIORITY_RANK = {"A_founder_cxo": 2, "B_vp_director": 1}
GRADE_RANK = {"A": 1, "B": 0}

COLUMNS = ["first_name", "full_name", "title", "organization", "org_type", "email",
           "website", "linkedin", "city", "state", "country", "sectors", "check_size",
           "grade", "thesis_match", "stage_match", "fit_score", "judge_p", "lender", "why", "record_id"]


class ConfigError(ValueError):
    pass


def expand(p: str | None) -> str | None:
    return os.path.expanduser(p) if p else p


def clients_dir() -> Path:
    base = os.environ.get("GTME_CLIENTS_DIR")
    if base:
        return Path(base).expanduser()
    home = os.environ.get("GTME_HOME")
    return (Path(home).expanduser() if home else Path.home() / ".chewbacca" / "gtm") / "clients"


def load_block(config_path: Path) -> dict:
    try:
        doc = json.loads(config_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"cannot read {config_path}: {exc}") from exc
    block = doc.get("investors") if isinstance(doc, dict) else None
    if not isinstance(block, dict):
        raise ConfigError(f"{config_path} has no investors block")
    check_block(block)
    return block


LIST_FIELDS = ("thesis", "thesis_text", "stage", "org_types", "countries", "regions",
               "exclude_sectors", "exclude_orgs", "seniority", "suppress")


def check_block(block: dict) -> None:
    for key in LIST_FIELDS:
        val = block.get(key, [])
        if not isinstance(val, list) or not all(isinstance(v, str) for v in val):
            raise ConfigError(f"investors.{key} must be a list of strings")
    if not block.get("thesis") and not block.get("thesis_text"):
        raise ConfigError("investors.thesis is empty: name at least one sector word")
    if (block.get("judge") or {}).get("mode", "all") not in ("all", "generalists", "keyword"):
        raise ConfigError("investors.judge.mode must be all, generalists or keyword")
    if block.get("unknown_sector") not in (None, *UNKNOWN_MODES):
        raise ConfigError(f"investors.unknown_sector must be one of {', '.join(UNKNOWN_MODES)}")
    if "require_stage" in block and not isinstance(block["require_stage"], bool):
        raise ConfigError("investors.require_stage must be true or false")
    for key in ("max_check_musd", "min_check_musd", "limit"):
        if key in block and not isinstance(block[key], (int, float)):
            raise ConfigError(f"investors.{key} must be a number")
    angels = block.get("angels", False)
    if not isinstance(angels, (bool, dict)) or (isinstance(angels, dict) and not isinstance(
            angels.get("question", ""), str)):
        raise ConfigError("investors.angels must be true, false or {\"question\": \"...\"}")


def word_re(words: list[str]) -> re.Pattern | None:
    words = [w.strip().lower() for w in words if w.strip()]
    if not words:
        return None
    return re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(w) for w in words) + r")(?![a-z0-9])")


def is_role(email: str) -> bool:
    local = email.split("@", 1)[0]
    return local in ROLE_LOCALS or local.split("+")[0] in ROLE_LOCALS


def company_ok(org: str) -> bool:
    o = (org or "").strip()
    low = o.lower()
    if not o or low in COMPANY_JUNK:
        return False
    if "airtable.com" in low or low.startswith("http") or re.search(r"\.(jpg|jpeg|png|gif)\b", low):
        return False
    return len(re.sub(r"[^a-z]", "", low)) >= 2


# A ticker or legal suffix reads wrong in "{{company}}": "Morgan Stanley (NYS: MS)",
# "SilkRoad Equity LLC". Measured on the first client pull, 2026-10-23: 31 of 500.
LEGAL_SUFFIX = re.compile(r"(,?\s+(llc|l\.l\.c\.|inc\.?|l\.p\.|lp|ltd\.?|corp\.?|co\.))+$", re.I)
TICKER = re.compile(r"\s*\((nys|nas|nasdaq|nyse|lon|tse|amex|otc)\s*:[^)]*\)", re.I)


def clean_company(org: str) -> str:
    out = TICKER.sub("", org or "").strip()
    out = LEGAL_SUFFIX.sub("", out).strip().rstrip(",").strip()
    return out or (org or "").strip()


def linkedin_matches(name: str, slug: str) -> bool:
    parts = [w for w in re.split(r"[^a-z]+", (name or "").lower()) if len(w) > 2]
    return bool(slug) and any(w in slug.lower() for w in parts)


def first_name(full: str) -> str:
    tokens = [t for t in re.split(r"\s+", (full or "").strip()) if t]
    while tokens and tokens[0].rstrip(".").lower() in {"dr", "mr", "mrs", "ms", "prof", "sir"}:
        tokens.pop(0)
    if not tokens:
        return ""
    t = tokens[0].strip(",")
    if len(re.sub(r"[^A-Za-z]", "", t)) < 2:
        return ""
    return t[:1].upper() + t[1:].lower() if t.isupper() or t.islower() else t


CHECK_NUM = re.compile(r"(\d+(?:,\d{3})*(?:\.\d+)?)\s*([kmb])?(?![a-z])", re.I)
UNIT_MUSD = {"k": 0.001, "m": 1.0, "b": 1000.0}


def check_range(check: str) -> tuple[float, float] | None:
    """A check-size cell as (smallest, largest) in $M, or None when it can't be read.

    Until 2026-10-26 the units were ignored, so "100K USD" read as $100M and
    "500K - 2.5M" as $500M: 147 + 43 rows of the Prometheus file, seed checks
    all of them, were dropped as "check too large". A number with no unit
    takes the unit of the next number that has one ("0 - 2.5M"); with none at
    all, 1,000 or more is dollars and anything smaller is $M, the file's own
    convention for bare ranges like "50.00 - 200.00"."""
    hits = [(float(n.replace(",", "")), (u or "").lower()) for n, u in CHECK_NUM.findall(check or "")]
    if not hits:
        return None
    vals = []
    for i, (n, unit) in enumerate(hits):
        unit = unit or next((u for _, u in hits[i + 1:] if u), "")
        vals.append(n * UNIT_MUSD[unit] if unit else n / 1e6 if n >= 1000 else n)
    return min(vals), max(vals)


def check_max(check: str) -> float | None:
    """The top of a check-size range in $M, or None when it can't be read."""
    rng = check_range(check)
    return rng[1] if rng else None


def fmt_musd(v: float) -> str:
    return f"${v * 1000:g}K" if v < 1 else f"${v:g}M"


def suppressed_emails(paths: list[str]) -> set[str]:
    out: set[str] = set()
    for p in paths:
        path = Path(expand(p))
        if not path.exists():
            raise ConfigError(f"suppress file not found: {path}")
        with path.open(newline="", encoding="utf-8", errors="replace") as fh:
            for row in csv.DictReader(fh):
                for k, v in row.items():
                    if k and "email" in k.lower() and v:
                        out.add(v.strip().lower())
    return out


def list_gate():
    """bin/list-gate's own rules, loaded from the file so the generator and
    the gate can never disagree about what a junior title or one firm is."""
    import importlib.machinery
    import importlib.util
    loader = importlib.machinery.SourceFileLoader("list_gate", str(ROOT / "bin" / "list-gate"))
    spec = importlib.util.spec_from_loader("list_gate", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


# Unknown-sector rows, before 2026-10-26, padded every list to its limit:
# measured that day with --limit 0, Thallus had 129 on-thesis rows of 500
# written (one of the rest an investment banker), HPC 36, Yeast Bay 98,
# BioMetal 137, and the founder notes said "500 food and climate investors".
# Now a generalist only gets in on a Jev yes.
UNKNOWN_MODES = ("judge", "keep", "drop")
# A generalist is kept at Jev 0.7. Guessed, never measured on labelled rows:
# a wrong yes is one founder pitching an investor who doesn't do their
# sector, a wrong no is one row a judged pool can refill.
JUDGE_YES = 0.7
JUDGE_BATCH = 20
# A firm judged on its homepage alone, with no portfolio on file, is kept at
# 0.6. Measured 2026-10-26 on 18 Thallus firms labelled by hand, one call
# each: the clear fits scored 0.64 to 0.87 and the misfits 0.12 to 0.53.
FIRM_YES = 0.6
LENDER_Q = ("From this firm's own site (firm_site_says), is it mainly a lender, offering venture debt, credit, "
            "loans or equipment financing, rather than buying equity in startups?")
# Guessed, never measured: a wrong yes only moves an investor to the bottom
# with a tag, so the bar is the same as a firm call.
LENDER_YES = 0.6


def jev_judge(states: list[dict], question: str) -> list[float | None]:
    return gtme_accounts.jev_judge_rows(states, question, "gtme-investors-judge", JUDGE_BATCH)


# What the firm's own homepage says about itself, for the judge. Measured
# 2026-10-26 on Thallus (food): judged from the firm name alone, Jev's yes
# rate sat at 0.70 to 0.76 and let in a venture lender, growth equity and
# endowments, and even its top 25 were mostly not food investors. A name is
# not evidence of a thesis; the firm's own words are the cheapest that is.
SITE_CHARS = 700


def site_says(website: str) -> str:
    website = (website or "").split()[0] if (website or "").split() else ""
    if not website:
        return ""
    import gtme_pipeline as gp
    import gtme_solo as solo
    url = website if "//" in website else f"https://{website}"
    body = gp.page(url)
    if not body:
        return ""
    return (solo.fact_on(body) + " | " + " ".join(gp.text_of(body).split()))[:SITE_CHARS]


def judge_question(block: dict) -> str:
    if (block.get("judge") or {}).get("question"):
        return block["judge"]["question"]
    pitch = block.get("pitch") or ("a startup in " + ", ".join((block.get("thesis_text") or block.get("thesis") or [])[:8]))
    return (f"The founder's pitch: {pitch}. From this firm's own site (firm_site_says) and the sectors on file, "
            f"would this firm plausibly write an early (pre-seed or seed) check into this exact startup? A firm "
            f"whose site and sectors point somewhere else (fintech, enterprise software, real estate) is no even "
            f"if one broad word overlaps. Investment banks, lenders, wealth managers, endowments, funds of funds "
            f"and growth or buyout equity are no.")


FREE_MAIL = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "me.com", "msn.com",
             "live.com", "protonmail.com", "comcast.net"}


def firm_keys(row: dict) -> set[str]:
    keys = {"name:" + list_gate().firm_key(row["organization"])}
    site = (row.get("website") or "").split()
    host = (urllib.parse.urlsplit(site[0] if "//" in site[0] else "http://" + site[0]).hostname or "") if site else ""
    host = host.lower().removeprefix("www.")
    mail = (row.get("email") or "").rsplit("@", 1)[-1].lower()
    if host:
        keys.add("domain:" + host)
    if mail and mail not in FREE_MAIL:
        keys.add("domain:" + mail)
    return keys


def build(con: sqlite3.Connection, block: dict, ask=jev_judge, says=None, match=None,
          read_portfolio=None, lender_ask=None, trace: list | None = None) -> tuple[list[dict], dict]:
    thesis = word_re(block.get("thesis", []) + block.get("thesis_text", []))
    thesis_text = word_re(block.get("thesis_text", []))
    stage = word_re(block.get("stage", []))
    excl = word_re(block.get("exclude_sectors", []))
    excl_orgs = [o.lower() for o in block.get("exclude_orgs", [])]
    org_types = {o.lower() for o in block.get("org_types", [])}
    countries = {c.lower() for c in block.get("countries", [])}
    regions = {r.lower() for r in block.get("regions", [])}
    seniority = set(block.get("seniority", []))
    max_check = block.get("max_check_musd")
    min_check = block.get("min_check_musd")
    require_stage = bool(block.get("require_stage"))
    unknown_mode = block.get("unknown_sector") or ("judge" if block.get("include_unknown_sector", True) else "drop")
    # judge: "all" (the default) has Jev decide every candidate against the
    # pitch; "generalists" judges only rows with no keyword hit; "keyword"
    # is the old offline match with no judge at all.
    judge_mode = (block.get("judge") or {}).get("mode", "all")
    keep_unknown = unknown_mode != "drop"
    gate = list_gate()
    suppress = suppressed_emails(block.get("suppress", []))

    cols = {r[1] for r in con.execute("PRAGMA table_info(contacts)")}
    flags = [c for c in ("d_org_junk", "d_name_nan") if c in cols]
    sql = ("SELECT record_id, full_name, title, organization, org_type, email, website, linkedin,"
           " city, state, country, region, sectors_norm, check_size, grade, grade_score,"
           " seniority_tier" + "".join(f", {c}" for c in flags) +
           " FROM contacts WHERE entity_kind='Person' AND grade IN ('A','B')"
           " AND email IS NOT NULL AND email != ''")
    stats = {"pool": 0, "dropped": {}}

    def drop(reason):
        stats["dropped"][reason] = stats["dropped"].get(reason, 0) + 1

    def source(_):
        records = list(con.execute(sql))
        stats["pool"] += len(records)
        return records

    def fit(records):
        rows = []
        for r in records:
            rec = dict(zip(["record_id", "full_name", "title", "organization", "org_type", "email",
                            "website", "linkedin", "city", "state", "country", "region", "sectors",
                            "check_size", "grade", "grade_score", "seniority"] + flags, r))
            email = (rec["email"] or "").strip().lower()
            sectors = (rec["sectors"] or "").lower()
            org = (rec["organization"] or "").strip()
            if org_types and (rec["org_type"] or "").lower() not in org_types:
                drop("org_type"); continue
            if countries or regions:
                c = (rec["country"] or "").strip().lower()
                g = (rec["region"] or "").strip().lower()
                if not (c in countries or (not c and g in regions)):
                    drop("geography"); continue
            if seniority and rec["seniority"] not in seniority:
                drop("seniority"); continue
            if not EMAIL_RE.match(email):
                drop("malformed email"); continue
            if is_role(email):
                drop("role inbox"); continue
            if any(rec.get(f) for f in flags) or not company_ok(org) or not first_name(rec["full_name"]):
                drop("junk company or name"); continue
            if any(gate.NAN_STRIP.search(str(v or "")) for v in rec.values()):
                drop("NaN-strip corruption"); continue
            if rec["title"] and gate.is_junior(rec["title"]):
                drop("too junior to decide"); continue
            if any(o in org.lower() for o in excl_orgs):
                drop("excluded firm"); continue
            if excl and excl.search(sectors):
                drop("excluded sector"); continue
            if email in suppress:
                drop("suppressed"); continue
            text = f"{org} {rec['title'] or ''}".lower()
            sector_hit = thesis.search(sectors) if thesis and sectors and sectors != "unknown" else None
            text_hit = thesis_text.search(text) if thesis_text else None
            known_sector = bool(sectors) and sectors != "unknown"
            if not (sector_hit or text_hit):
                if known_sector or not keep_unknown:
                    drop("off thesis"); continue
            rng = check_range(rec["check_size"])
            check_text = (rec["check_size"] or "").lower()
            stage_word = stage and (stage.search(check_text) or stage.search(sectors) or stage.search(text))
            stage_why = f"stage: {stage_word.group(1)}" if stage_word else ""
            if not stage_why and (rec["org_type"] or "").lower() == "angel":
                stage_why = "stage: angel"
            # A range is read as the checks they write. Their smallest over what
            # this round takes means they don't write a check this size; their
            # largest under min_check_musd means too small to be worth a slot.
            if rng and max_check is not None and rng[0] > max_check:
                drop("check too large"); continue
            if rng and min_check is not None and rng[1] < min_check:
                drop("check too small"); continue
            check_why = ""
            if rng:
                span = fmt_musd(rng[1]) if rng[0] == rng[1] else f"{fmt_musd(rng[0])} to {fmt_musd(rng[1])}"
                fits = max_check is None or rng[1] <= max_check
                check_why = f"checks {span}" + (f", inside the {fmt_musd(max_check)} round" if max_check and fits
                                                 else f", overlaps the {fmt_musd(max_check)} round" if max_check else "")
                if fits and max_check is not None and not stage_why:
                    stage_why = "stage: check size fits the round"
            stage_hit = bool(stage_why)
            if require_stage and not stage_hit:
                drop("no early-stage evidence"); continue
            hit = sector_hit or text_hit
            score = ((3 if hit else 0) + (2 if stage_hit else 0)
                     + SENIORITY_RANK.get(rec["seniority"], 0) + GRADE_RANK.get(rec["grade"], 0))
            why = []
            if hit:
                why.append(f"thesis: {hit.group(1)}" + (" (sector)" if sector_hit else " (firm or title)"))
            else:
                why.append("generalist, sector not on file")
            if stage_why:
                why.append(stage_why)
            if check_why:
                why.append(check_why)
            elif rec["check_size"]:
                why.append(f"check {rec['check_size']}")
            slug = rec["linkedin"] or ""
            rows.append({
                "first_name": first_name(rec["full_name"]),
                "full_name": (rec["full_name"] or "").strip(),
                "title": (rec["title"] or "").strip(),
                "organization": clean_company(org),
                "org_type": rec["org_type"] or "",
                "email": email,
                "website": rec["website"] or "",
                "linkedin": slug if linkedin_matches(rec["full_name"], slug) else "",
                "city": rec["city"] or "", "state": rec["state"] or "", "country": rec["country"] or "",
                "sectors": rec["sectors"] or "", "check_size": rec["check_size"] or "",
                "grade": rec["grade"] or "",
                "thesis_match": "yes" if hit else "no",
                "stage_match": "yes" if stage_hit else "no",
                "fit_score": score,
                "why": "; ".join(why),
                "record_id": rec["record_id"],
                "_rank": (score, float(rec["grade_score"] or 0), 1 if slug else 0),
            })
        rows.sort(key=lambda x: x["_rank"], reverse=True)
        return rows

    def one_per_firm(rows):
        per_firm = int(block.get("per_firm", 1))
        seen_email, seen_person, firms, out = set(), set(), {}, []
        for row in rows:
            person = (row["full_name"].lower(), row["organization"].lower())
            if row["email"] in seen_email or person in seen_person:
                drop("duplicate"); continue
            # One contact per firm, the best fit, the same firm_key list-gate
            # counts with: on 10/26 every list failed it (Stonepeak 7 on one).
            # A firm is also its domain: "Khosla Impact" and "Khosla Ventures"
            # are two firm_keys and one khoslaventures.com, and both made one
            # founder's list on 10/26. The site wins, then a work email domain.
            keys = firm_keys(row)
            if per_firm and any(firms.get(k, 0) >= per_firm for k in keys):
                drop("another contact at the same firm"); continue
            seen_email.add(row["email"]); seen_person.add(person)
            for k in keys:
                firms[k] = firms.get(k, 0) + 1
            row.pop("_rank")
            out.append(row)
        return out

    def judged(out):
        stats.update(thesis_rows=sum(1 for r in out if r["thesis_match"] == "yes"),
                     unknown_pool=sum(1 for r in out if r["thesis_match"] != "yes"), judged=0, judged_in=0, unscored=0,
                     keyword_only=False)
        if judge_mode == "keyword" or (unknown_mode == "drop" and judge_mode != "all"):
            out = [r for r in out if r["thesis_match"] == "yes" or unknown_mode == "keep"]
        else:
            out = judge_all(out, block, ask, says, stats, judge_mode, match, read_portfolio, lender_ask)
        stats["matched"] = len(out)
        return out

    def capped(out):
        limit = int(block.get("limit") or 0)
        return out[:limit] if limit else out

    out = gtme_accounts.run_stages([("source", source), ("fit", fit), ("dedupe", one_per_firm),
                                    ("verify", judged), ("tier", capped)], trace=trace)
    return out, stats


def judge_all(rows: list[dict], block: dict, ask, says, stats: dict, mode: str, match=None,
              read_portfolio=None, lender_ask=None) -> list[dict]:
    """Every candidate is decided against the founder's pitch from evidence,
    never from a keyword. Caleb, 2026-10-26, on a "consumer" keyword patch:
    "WHY IS THERE BRUTE FORCE WORD KEY STUFF IN CHEWBACCA? I THOUGHT WE HAD
    MADE AN INTELLIGENT SYSTEM???????" Keywords only choose who to look at.

    Two paths, strongest evidence first:
    1. The firm is in the portfolio graph: walk firm -invested_in-> company,
       and Jev asks of EACH company whether it is in the pitch's market. A
       firm is in when it backed at least one, and the row names them. On
       2026-10-26 this found Kapor -> Air Protein and Maveron -> Imperfect
       Foods for a mushroom-protein founder, firms a person had marked off
       thesis, and kept Greylock out.
    2. No portfolio on file: one Jev call per firm on its homepage and
       sectors (batched calls mixed rows up: a firm with no evidence scored
       0.88 in a batch of 20 and 0.13 alone). A yes only earns a portfolio
       read, built on demand into the graph, and then path 1 decides. On the
       first full run a homepage yes alone let a16z, Bessemer and Scribble in
       for a mushroom-protein founder; a generic "we back great founders"
       page reads as a fit to anything. A firm whose portfolio can't be read
       stays out, counted.
    With Jev unreachable every row is unscored, and the list falls back to the
    keyword rows with keyword_only set so the summary says so."""
    import gtme_portfolio
    graph = gtme_portfolio.load()
    q = judge_question(block)
    pitch = block.get("pitch") or ", ".join(block.get("thesis_text") or block.get("thesis") or [])
    match = match or (lambda firm, names: gtme_portfolio.matches(firm, names, pitch, graph))
    read_portfolio = read_portfolio or gtme_portfolio.build_one
    candidates = rows if mode == "all" else [r for r in rows if r["thesis_match"] != "yes"]
    fixed = [] if mode == "all" else [r for r in rows if r["thesis_match"] == "yes"]
    stats.update(by_portfolio=0, site_unproved=0, portfolio_firms=0)

    def decide(r):
        names = [c["name"] for c in gtme_portfolio.companies(gtme_portfolio.domain_of(r["website"]), graph)]
        if names:
            hits = match(r["organization"], names)
            if hits is None:
                return r, None, "portfolio", []
            best = max((p for _, p in hits), default=0.0)
            return r, (best if hits else 0.0), "portfolio", hits
        text = (says or site_says)(r["website"])
        if not (text or r["thesis_match"] == "yes"):
            return r, None, "none", []
        st = {**{k: r[k] for k in ("full_name", "title", "organization", "org_type", "sectors", "check_size")},
              "firm_site_says": text}
        got = ask([st], q)
        prob = got[0] if got else None
        if prob is None or prob < FIRM_YES:
            return r, prob, "site", []
        dom = gtme_portfolio.domain_of(r["website"])
        node = read_portfolio(dom, r["organization"]) if dom else {"companies": []}
        with gtme_portfolio._lock:
            if dom:
                graph["firms"][dom] = node
        names = [c["name"] for c in node.get("companies") or []]
        if not names:
            return r, prob, "site_unproved", []
        hits = match(r["organization"], names)
        if hits is None:
            return r, None, "portfolio", []
        return r, (max(p for _, p in hits) if hits else 0.0), "portfolio", hits

    kept = []
    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        for r, prob, path, hits in ex.map(decide, candidates):
            stats["judged"] += 1
            if path == "portfolio":
                stats["portfolio_firms"] += 1
            if prob is None:
                stats["unscored"] += 1
                continue
            r["judge_p"] = f"{prob:.2f}"
            if path == "portfolio" and hits:
                names = ", ".join(n for n, _ in sorted(hits, key=lambda h: -h[1])[:3])
                r["why"] = f"backed {names} (Jev {prob:.2f}, from its portfolio page); " + r["why"]
                stats["by_portfolio"] += 1
                kept.append(r)
            elif path == "site_unproved":
                stats["site_unproved"] += 1
    stats["judged_in"] = len(kept)
    if stats["judged"] and stats["unscored"] == stats["judged"] and mode == "all":
        stats["keyword_only"] = True
        return [r for r in rows if r["thesis_match"] == "yes"]
    gtme_portfolio.save(graph)
    stats["dropped"]["Jev: not a fit for the pitch"] = (stats["judged"] - stats["unscored"] - len(kept)
                                                         - stats["site_unproved"])
    if stats["site_unproved"]:
        stats["dropped"]["site reads as a fit, no portfolio to prove it"] = stats["site_unproved"]
    if stats["unscored"]:
        stats["dropped"]["no evidence to judge (no portfolio, site or sector)"] = stats["unscored"]
    # A lender's portfolio proves it lent, not that it buys equity: on 10/26
    # Plexus Capital and Trinity Capital ("Tech Lending, Equipment
    # Financing") came back proven for 8 founders. A person ruled they stay,
    # tagged and last, never counted as proven. One Jev call per kept firm.
    def lender(r):
        text = (says or site_says)(r["website"])
        got = (lender_ask or jev_judge)([{"organization": r["organization"], "org_type": r["org_type"],
                                    "firm_site_says": text}], LENDER_Q) if text else [None]
        return r, (got[0] if got else None)
    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        for r, p in ex.map(lender, kept):
            if p is not None and p >= LENDER_YES:
                r["lender"] = "yes"
                r["why"] = "LENDER, not counted as proven; " + r["why"]
    stats["lenders"] = sum(1 for r in kept if r.get("lender"))
    stats["by_portfolio"] -= stats["lenders"]
    kept.sort(key=lambda r: (bool(r.get("lender")), -float(r["judge_p"]), -r["fit_score"]))
    return fixed + kept


# An angel has no portfolio page, so judge_all drops every one as "no
# evidence" and a $5K-check round gets only funds: on 2026-10-26 a consumer
# hardware pre-seed came back with 9 rows, all institutional. Judged alone on
# title, company and sectors, 25 clear-fit angels scored 0.45 to 0.85 (21 of
# 25 at 0.6+) and 25 pure software or fintech angels 0.08 to 0.18.
ANGEL_YES = 0.6
# Angels invest as themselves, so the company they get mail at is the one a
# send can name (280 of 329 kept rows had a blank company on 10/26). A
# government address was the one list-gate refused outright that day.
NO_MAIL_COMPANY = (".gov", ".mil")


def angel_question(block: dict) -> str:
    angels = block.get("angels") if isinstance(block.get("angels"), dict) else {}
    if angels.get("question"):
        return angels["question"]
    pitch = block.get("pitch") or ("a startup in " + ", ".join((block.get("thesis_text") or block.get("thesis") or [])[:8]))
    return (f"This is an individual angel investor. From the sectors, title and company on file, would they plausibly "
            f"write a small angel check into this startup: {pitch}. Yes only if what's on file points at the "
            f"startup's own market. One broad word that overlaps (software, technology) is no when the rest of what's "
            f"on file points somewhere else (enterprise software, fintech, biotech, real estate).")


def has_mx(domain: str) -> Optional[bool]:
    """True when the domain takes mail, False when it has no MX or a null MX
    ("0 ."), None when the lookup itself could not run."""
    try:
        proc = subprocess.run(["dig", "+short", "+time=3", "+tries=1", "MX", domain],
                              capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    lines = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
    if proc.returncode != 0 or any(ln.startswith(";;") for ln in lines):
        return None
    return any(ln.split()[-1] != "." for ln in lines)


def build_angels(con: sqlite3.Connection, block: dict, ask=jev_judge, mx=has_mx,
                 trace: list | None = None) -> tuple[list[dict], dict]:
    """The angel pass: individual angels judged on what's on file, with the
    company taken from their mail domain. Run beside the fund list, not
    instead of it.

    Every row is judged ALONE, one Jev call each. In batches of 20, plain
    "software" angels rose to the top (0.77) for a consumer startup; alone
    they scored 0.08 to 0.18. 6,083 single calls took 122 s at 8 threads.
    Seniority and org_types are not applied: the pool is the angels."""
    countries = {c.lower() for c in block.get("countries", [])}
    regions = {r.lower() for r in block.get("regions", [])}
    excl = word_re(block.get("exclude_sectors", []))
    excl_orgs = [o.lower() for o in block.get("exclude_orgs", [])]
    thesis = word_re(block.get("thesis", []) + block.get("thesis_text", []))
    max_check = block.get("max_check_musd")
    min_check = block.get("min_check_musd")
    gate = list_gate()
    suppress = suppressed_emails(block.get("suppress", []))

    cols = {r[1] for r in con.execute("PRAGMA table_info(contacts)")}
    flags = [c for c in ("d_name_nan",) if c in cols]
    sql = ("SELECT record_id, full_name, title, organization, org_type, email, website, linkedin,"
           " city, state, country, region, sectors_norm, check_size, grade, grade_score"
           + "".join(f", {c}" for c in flags) +
           " FROM contacts WHERE entity_kind='Person' AND grade IN ('A','B')"
           " AND email IS NOT NULL AND email != ''"
           " AND (lower(org_type)='angel' OR check_size LIKE 'Angel (individual)%')")
    stats = {"pool": 0, "dropped": {}}

    def drop(reason):
        stats["dropped"][reason] = stats["dropped"].get(reason, 0) + 1

    def source(_):
        records = list(con.execute(sql))
        stats["pool"] += len(records)
        return records

    def fit(records):
        rows = []
        for r in records:
            rec = dict(zip(["record_id", "full_name", "title", "organization", "org_type", "email",
                            "website", "linkedin", "city", "state", "country", "region", "sectors",
                            "check_size", "grade", "grade_score"] + flags, r))
            email = (rec["email"] or "").strip().lower()
            sectors = (rec["sectors"] or "").strip()
            org = (rec["organization"] or "").strip()
            if countries or regions:
                c = (rec["country"] or "").strip().lower()
                g = (rec["region"] or "").strip().lower()
                if not (c in countries or (c in ("", "unknown") and g in regions)):
                    drop("geography"); continue
            if not EMAIL_RE.match(email):
                drop("malformed email"); continue
            if is_role(email):
                drop("role inbox"); continue
            if any(rec.get(f) for f in flags) or not first_name(rec["full_name"]):
                drop("junk name"); continue
            if any(gate.NAN_STRIP.search(str(v or "")) for v in rec.values()):
                drop("NaN-strip corruption"); continue
            if rec["title"] and gate.is_junior(rec["title"]):
                drop("too junior to decide"); continue
            if not sectors or sectors.lower() == "unknown":
                drop("no sector on file to judge"); continue
            if excl and excl.search(sectors.lower()):
                drop("excluded sector"); continue
            if any(o in org.lower() for o in excl_orgs):
                drop("excluded firm"); continue
            if email in suppress:
                drop("suppressed"); continue
            rng = check_range(rec["check_size"])
            if rng and max_check is not None and rng[0] > max_check:
                drop("check too large"); continue
            if rng and min_check is not None and rng[1] < min_check:
                drop("check too small"); continue
            domain = email.rsplit("@", 1)[1]
            if domain.endswith(NO_MAIL_COMPANY):
                drop("government address"); continue
            company = clean_company(org) if company_ok(org) else ""
            if not company:
                if domain in FREE_MAIL:
                    drop("free mailbox, no company"); continue
                company = domain
            hit = thesis.search(sectors.lower()) if thesis else None
            slug = rec["linkedin"] or ""
            rows.append({
                "first_name": first_name(rec["full_name"]),
                "full_name": (rec["full_name"] or "").strip(),
                "title": (rec["title"] or "").strip(),
                "organization": company,
                "org_type": rec["org_type"] or "",
                "email": email,
                "website": rec["website"] or "",
                "linkedin": slug if linkedin_matches(rec["full_name"], slug) else "",
                "city": rec["city"] or "", "state": rec["state"] or "", "country": rec["country"] or "",
                "sectors": sectors, "check_size": rec["check_size"] or "",
                "grade": rec["grade"] or "",
                "thesis_match": "yes" if hit else "no",
                "stage_match": "yes",
                "fit_score": (3 if hit else 0) + 2 + GRADE_RANK.get(rec["grade"], 0),
                "why": f"angel; sectors on file: {sectors}",
                "record_id": rec["record_id"],
            })

        return rows

    def judged_alone(rows):
        q = angel_question(block)

        def judge(r):
            st = {"title": r["title"], "company": r["organization"], "sectors": r["sectors"],
                  "check_size": r["check_size"]}
            got = ask([st], q)
            return r, (got[0] if got else None)

        stats.update(judged=0, unscored=0, mx_unchecked=0, keyword_only=False)
        kept = []
        with concurrent.futures.ThreadPoolExecutor(8) as ex:
            for r, p in ex.map(judge, rows):
                stats["judged"] += 1
                if p is None:
                    stats["unscored"] += 1
                    continue
                if p < ANGEL_YES:
                    drop("Jev: not a fit for the pitch"); continue
                r["judge_p"] = f"{p:.2f}"
                r["why"] = f"angel, Jev {p:.2f} on title, company and sectors; sectors on file: {r['sectors']}"
                kept.append(r)
        if stats["unscored"]:
            stats["dropped"]["no Jev answer"] = stats["unscored"]
        kept.sort(key=lambda r: (-float(r["judge_p"]), -r["fit_score"]))

        run["judged_in"] = len(kept)
        return kept

    def one_per_domain(kept):
        # One angel per mail domain and per company, the best fit first: two
        # angels at one family office read as a blast to whoever sorts its mail.
        seen_email, seen_keys, out = set(), set(), []
        for r in kept:
            domain = r["email"].rsplit("@", 1)[1]
            keys = {"name:" + gate.firm_key(r["organization"])}
            if domain not in FREE_MAIL:
                keys.add("domain:" + domain)
            if r["email"] in seen_email or keys & seen_keys:
                drop("another angel at the same domain"); continue
            seen_email.add(r["email"]); seen_keys |= keys
            out.append(r)

        return out

    def mail_domain(out):
        # A dead mail domain is a hard bounce, and bounces cost the sending
        # domain. One lookup per domain, after the cut, so the judge's no's
        # never cost a lookup.
        verdicts: dict = {}
        sendable = []
        for r in out:
            domain = r["email"].rsplit("@", 1)[1]
            if domain not in verdicts:
                verdicts[domain] = mx(domain)
            if verdicts[domain] is False:
                drop("mail domain has no MX"); continue
            if verdicts[domain] is None:
                stats["mx_unchecked"] += 1
            sendable.append(r)

        return sendable

    def capped(sendable):
        stats.update(thesis_rows=sum(1 for r in sendable if r["thesis_match"] == "yes"), unknown_pool=0,
                     judged_in=run["judged_in"], matched=len(sendable))
        limit = int(block.get("limit") or 0)
        return sendable[:limit] if limit else sendable

    run: dict = {}
    out = gtme_accounts.run_stages([("source", source), ("fit", fit), ("verify", judged_alone),
                                    ("dedupe", one_per_domain), ("verify", mail_domain), ("tier", capped)],
                                   trace=trace)
    return out, stats


def write_csv(rows: list[dict], path: Path) -> None:
    """Names, firms and titles come from strangers, and the file is opened in
    Sheets and Excel, so every string cell goes through the kit's one defuse
    helper (OWASP CSV injection), the same one gtme_solo uses."""
    sys.path.insert(0, str(ROOT / "tools"))
    import gtme_operator as op

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        for row in rows:
            w.writerow({k: op.csv_cell(v) if isinstance(v, str) else v for k, v in row.items()})


# list-audit fields that mean this tool let a defect through. It always exits
# 0, so the verdict is read from its JSON rather than its exit code.
AUDIT_DEFECTS = ("company_cell_is_junk", "nan_strip_names", "nan_strip_other_fields",
                 "linkedin_confirmed_wrong", "junk_rows", "no_org_rows")


def audit(path: Path) -> dict:
    tool = ROOT / "bin" / "list-audit"
    if not tool.exists():
        return {"ran": False, "why": "list-audit not found"}
    proc = subprocess.run([sys.executable, str(tool), str(path), "--json"],
                          capture_output=True, text=True, timeout=300)
    try:
        doc = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"ran": False, "why": (proc.stderr or proc.stdout).strip()[-400:]}
    defects = {k: doc.get(k) for k in AUDIT_DEFECTS if doc.get(k)}
    return {"ran": True, "rows": doc.get("rows"), "usable": doc.get("usable_rows"),
            "qualified": doc.get("qualified_rows"), "free_mail": doc.get("free_mail_rows"),
            "with_linkedin": doc.get("with_linkedin"), "defects": defects}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--client", help="client slug; reads <clients dir>/<slug>.json")
    src.add_argument("--config", help="path to a client config with an investors block")
    src.add_argument("--check-config", help="validate a config's investors block and exit")
    ap.add_argument("--db", help="Prometheus sqlite path (default: block's db, then $PROMETHEUS_DB)")
    ap.add_argument("--out", help="CSV path (default: block's out)")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--dry-run", action="store_true", help="count only, write nothing")
    ap.add_argument("--angels", action="store_true",
                    help="the angel pass: individual angels judged alone, company from the mail domain")
    ap.add_argument("--no-audit", action="store_true")
    ap.add_argument("--json", action="store_true", help="print the summary as JSON")
    ap.add_argument("--show", type=int, default=10, help="print the strongest N rows and why each fit (0: none)")
    a = ap.parse_args(argv)

    try:
        if a.check_config:
            load_block(Path(expand(a.check_config)))
            print(f"ok    {a.check_config}")
            return 0
        cfg = Path(expand(a.config)) if a.config else clients_dir() / f"{a.client}.json"
        block = load_block(cfg)
        if a.limit is not None:
            block["limit"] = a.limit
        if a.angels and not block.get("angels"):
            block["angels"] = True
        db = expand(a.db or block.get("db") or os.environ.get("PROMETHEUS_DB"))
        if not db or not Path(db).exists():
            print(f"no Prometheus db at {db!r}: pass --db or set PROMETHEUS_DB", file=sys.stderr)
            return 2
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        rows, stats = (build_angels if block.get("angels") else build)(con, block)
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    out = expand(a.out or block.get("out"))
    summary = {"config": str(cfg), "pool": stats["pool"], "matched": stats["matched"],
               "thesis_matched": stats["thesis_rows"], "unknown_pool": stats["unknown_pool"],
               "judged": stats["judged"], "judged_in": stats["judged_in"], "unscored": stats["unscored"], "written": 0 if a.dry_run else len(rows),
               "dropped": stats["dropped"], "out": out,
               "top": [{k: r[k] for k in ("full_name", "organization", "check_size", "fit_score", "why")}
                       for r in rows[:max(a.show, 0)]]}
    code = 0
    if not a.dry_run:
        if not out:
            print("no output path: pass --out or set investors.out", file=sys.stderr)
            return 2
        write_csv(rows, Path(out))
        if not a.no_audit:
            result = audit(Path(out))
            summary["audit"] = result
            gate = subprocess.run([sys.executable, str(ROOT / "bin" / "list-gate"), str(out), "--json"],
                                  capture_output=True, text=True, timeout=300)
            try:
                summary["list_gate"] = json.loads(gate.stdout).get("fails", [])
            except json.JSONDecodeError:
                summary["list_gate"] = [f"list-gate did not run: {(gate.stderr or gate.stdout).strip()[-200:]}"]
            code = 1 if (not result["ran"] or result["defects"] or summary["list_gate"]) else 0
    if a.json:
        print(json.dumps(summary, indent=1))
    else:
        if block.get("angels"):
            print(f"  pool {summary['pool']:,} angels with an email and grade A or B")
            print(f"  {stats['judged_in']:,} Jev judged a yes of {stats['judged']:,} judged alone "
                  f"({stats['unscored']:,} unscored), {stats['matched']:,} after one per domain and the MX "
                  f"check ({stats['mx_unchecked']:,} kept on a domain the lookup could not reach)")
        else:
            print(f"  pool {summary['pool']:,} people with an email and grade A or B")
            print(f"  {summary['thesis_matched']:,} ON THESIS, plus {stats['judged_in']:,} generalists Jev judged a yes "
                  f"of {stats['judged']:,} judged ({stats['unscored']:,} unscored) from {stats['unknown_pool']:,} with "
                  f"no sector on file")
        for k, v in sorted(stats["dropped"].items(), key=lambda kv: -kv[1]):
            print(f"    dropped {v:>7,}  {k}")
        if summary["top"]:
            print(f"  strongest {len(summary['top'])}, and why each fit:")
            for r in summary["top"]:
                print(f"    {r['fit_score']}  {r['full_name']}, {r['organization']}: {r['why']}")
        if a.dry_run:
            print("  dry run, nothing written")
        else:
            print(f"  wrote {len(rows):,} rows to {out}")
            au = summary.get("audit")
            if au and au["ran"]:
                print(f"  list-audit: {au['rows']:,} rows, {au['qualified']:,} qualified "
                      f"(person, real company, work email), {au['free_mail']:,} on a personal mailbox, "
                      f"defects: {au['defects'] or 'none'}")
            elif au:
                print(f"  list-audit did not run: {au['why']}")
            for f in summary.get("list_gate") or []:
                print(f"  list-gate FAIL  {f}")
            if summary.get("list_gate") == []:
                print("  list-gate: pass")
    return code


if __name__ == "__main__":
    sys.exit(main())
