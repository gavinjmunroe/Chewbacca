#!/usr/bin/env python3
"""Is this employer on a client's target account list? Decided in code, never by a model.

  target-accounts match <sheet.csv> < employers.jsonl    one verdict per line
  target-accounts overlap <bridge_start> <bridge_end> <joined_year>

A model matching names against a list fails quietly both ways: it misses "Brown & Toland"
because the list says "Altais", and it matches Baptist Health South Florida to a Baptist in
Kentucky. So every match goes through here, domain first, then the exact normalized name. A
model's own claim of a match is kept as a hint and labelled one, never promoted.

Each employers.jsonl line is {"company": ..., "company_domain": ...}. Each verdict line adds
{"target": <account or null>, "basis": "domain" | "parent_domain" | "name" | null}.
"""
import csv
import io
import json
import re
import sys

# Two-label suffixes that need a third label to name an organization (nhs.co.uk, not co.uk).
SECOND_LEVEL = {"co", "com", "org", "net", "ac", "gov", "edu", "nhs"}
LEGAL = re.compile(r"\b(inc|llc|lp|llp|corp|corporation|co|ltd|pllc|pc|plc)\b")


def registrable_domain(value):
    """"https://www.hss.edu/about/" -> ("hss.edu", True). The flag says the cell pointed below
    the domain, so a match on it only proves the parent organization."""
    raw = (value or "").strip().lower()
    if not raw:
        return None, False
    no_scheme = re.sub(r"^[a-z]+://", "", raw)
    host, _, path = no_scheme.partition("/")
    host = re.sub(r":\d+$", "", host).rstrip(".")
    path = re.sub(r"[?#].*$", "", path)
    labels = [p for p in host.split(".") if p]
    if len(labels) < 2:
        return None, False
    keep = 3 if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in SECOND_LEVEL else 2
    return ".".join(labels[-keep:]), path.strip("/") != ""


def normalize_org_name(name):
    """Lowercase, "&" as "and", punctuation and legal suffixes gone, any parenthetical dropped.

    Words like "health", "system" or "hospital" stay: they tell two Baptists apart, and a false
    match becomes someone asking a customer for an introduction that doesn't exist. The
    abbreviation in the parenthetical is not matched on its own either, since "UHS" is both
    Universal Health Services and United Health Services.
    """
    s = (name or "").lower()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = LEGAL.sub(" ", s)
    s = re.sub(r"^\s*the\s+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _column(header, *names):
    lower = [h.strip().lower() for h in header]
    return next((lower.index(n) for n in names if n in lower), -1)


def parse_targets(text):
    """A target sheet as CSV, columns found by header name so their order can change."""
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    if not rows:
        raise ValueError("target sheet is empty")
    if re.match(r"^\s*<(!doctype|html)", text, re.I):
        raise ValueError("target sheet is a web page, not CSV; publish it to the web as CSV")
    header, body = rows[0], rows[1:]
    i_account = _column(header, "account", "account name", "company", "name")
    if i_account == -1:
        raise ValueError(f"target sheet has no Account column (header: {', '.join(header)})")
    i_segment, i_type = _column(header, "segment"), _column(header, "type")
    i_domain = _column(header, "company domain", "domain", "company url", "website", "url")
    cell = lambda r, i: ((r[i] if i < len(r) else "").strip() or None) if i != -1 else None
    out = []
    for r in body:
        account = cell(r, i_account)
        if not account:
            continue
        raw = cell(r, i_domain)
        domain, has_path = registrable_domain(raw)
        out.append({"segment": cell(r, i_segment), "type": cell(r, i_type), "account": account,
                    "domain_raw": raw, "domain": domain, "domain_has_path": has_path})
    if not out:
        raise ValueError("target sheet has a header but no accounts")
    return out


def match_employer(company, company_domain, targets):
    """Domain first, then exact normalized name. Returns (target, basis) or (None, None)."""
    domain, _ = registrable_domain(company_domain)
    if domain:
        hit = next((t for t in targets if t["domain"] == domain), None)
        if hit:
            return hit, "parent_domain" if hit["domain_has_path"] else "domain"
    name = normalize_org_name(company)
    if name:
        hit = next((t for t in targets if normalize_org_name(t["account"]) == name), None)
        if hit:
            return hit, "name"
    return None, None


def is_same_organization(target, company, company_domain):
    """Is this target where the person works today? Then it's not a former employer."""
    domain, _ = registrable_domain(company_domain)
    if domain and target["domain"] == domain:
        return True
    name = normalize_org_name(company)
    return bool(name) and normalize_org_name(target["account"]) == name


def tenure_overlap(bridge_start, bridge_end, joined_year):
    """Did the bridge and the buyer overlap at the target? Never guesses a missing year.

    Returns ("yes" | "possible" | "no" | "unknown", years or None).
    """
    if bridge_end is None or joined_year is None:
        return "unknown", None
    if joined_year > bridge_end:
        return "no", None
    if joined_year == bridge_end:
        return "possible", 0
    # With no start year the overlap is certain but its length isn't.
    return "yes", None if bridge_start is None else bridge_end - max(bridge_start, joined_year)


def _year(value):
    if value in (None, "", "null"):
        return None
    return int(value)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) == 2 and argv[0] == "match":
        with open(argv[1], encoding="utf-8") as f:
            targets = parse_targets(f.read())
        for line in sys.stdin:
            if not line.strip():
                continue
            row = json.loads(line)
            target, basis = match_employer(row.get("company"), row.get("company_domain"), targets)
            print(json.dumps({**row, "target": target["account"] if target else None, "basis": basis}))
        return 0
    if len(argv) == 4 and argv[0] == "overlap":
        overlap, years = tenure_overlap(*(_year(v) for v in argv[1:]))
        print(json.dumps({"overlap": overlap, "years": years}))
        return 0
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
