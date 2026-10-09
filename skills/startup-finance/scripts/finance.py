#!/usr/bin/env python3
"""Deterministic startup-finance checks. Stdlib only. Read-only: never writes your data.

Adapted from countinghouse and dime by Charles Zheng (MIT).
  https://github.com/goodnight000/countinghouse
  https://github.com/goodnight000/dime

Subcommands (all print JSON):
  franchise-tax   Delaware franchise tax, both methods
  categorize      bank CSV -> vendor + category + flags (duplicate, unusual, missing receipt, 1099)
  leaks           spikes, unused SaaS seats, and the categorize flags, as a findings list
  contractors     1099 candidates and missing W-9s
  runway          runway and hiring scenarios from cash and burn
  calendar        upcoming tax deadlines for a calendar-year C-corp
  daily-number    personal "what can I spend today"
  girl-math       what a purchase does to a savings goal date
"""
import argparse
import csv
import json
import math
import re
import statistics
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def load(name):
    return json.loads((DATA / name).read_text())


def money(x):
    """Parse '$1,234.50', '(12.00)', '-12', 12 into a float."""
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace("$", "").replace(",", "")
    if not s:
        raise ValueError("empty amount")
    neg = s.startswith("(") and s.endswith(")")
    return -float(s.strip("()")) if neg else float(s)


# ---------------------------------------------------------------- franchise tax

def franchise_tax(authorized, issued, gross_assets, par=0.00001):
    cfg = load("franchise-tax.json")
    if authorized <= 0 or issued <= 0:
        raise ValueError("authorized and issued shares must be positive")
    a = cfg["authorized_shares_method"]
    if authorized <= 5000:
        auth = a["up_to_5000"]
    elif authorized <= 10000:
        auth = a["5001_to_10000"]
    else:
        auth = a["5001_to_10000"] + math.ceil((authorized - 10000) / 10000) * a["per_additional_10000_or_part"]
    auth = min(auth, a["cap"])
    p = cfg["assumed_par_value_capital_method"]
    assumed_par = max(gross_assets / issued, par)
    apvc = assumed_par * authorized
    apv = min(max(math.ceil(apvc / 1_000_000) * p["rate_per_million"], p["minimum"]), p["cap"])
    fee = cfg["annual_report_fee"]
    return {
        "authorized_shares": authorized, "issued_shares": issued, "gross_assets": round(gross_assets),
        "authorized_shares_tax": auth, "authorized_shares_total": auth + fee,
        "assumed_par": round(assumed_par, 4), "assumed_par_value_capital": round(apvc),
        "assumed_par_value_tax": apv, "assumed_par_value_total": apv + fee,
        "annual_report_fee": fee, "savings": auth - apv,
        "file_with": "assumed_par_value" if apv < auth else "authorized_shares",
        "verify": cfg["_verify"],
    }


# ---------------------------------------------------------------- categorize

HEADERS = {
    "date": ("date", "posted", "posted date", "transaction date", "created at"),
    "amount": ("amount", "amt", "total"),
    "description": ("description", "descriptor", "memo", "name", "merchant", "details"),
    "account": ("account", "account name", "source"),
    "receipt": ("receipt", "has receipt", "receipt attached"),
    "id": ("id", "txn id", "transaction id"),
}


def read_csv(path):
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        cols = {h.lower().strip(): h for h in (reader.fieldnames or [])}
        pick = {k: next((cols[a] for a in v if a in cols), None) for k, v in HEADERS.items()}
        for need in ("date", "amount", "description"):
            if not pick[need]:
                raise SystemExit(f"CSV needs a {need} column (accepted: {', '.join(HEADERS[need])})")
        rows = []
        for i, r in enumerate(reader):
            rec = {
                "id": (r.get(pick["id"]) if pick["id"] else None) or f"row{i + 1}",
                "date": r[pick["date"]].strip()[:10],
                "amount": money(r[pick["amount"]]),
                "description": r[pick["description"]].strip(),
                "account": (r.get(pick["account"]) or "").strip() if pick["account"] else None,
                "receipt": None,
            }
            if pick["receipt"]:
                rec["receipt"] = (r.get(pick["receipt"]) or "").strip().lower() in ("yes", "y", "true", "1", "x")
                if not (r.get(pick["receipt"]) or "").strip():
                    rec["receipt"] = None
            rows.append(rec)
        return rows


def fallback_vendor(desc):
    s = re.sub(r"^(WIRE OUT|WIRE IN|ACH PAYMENT|MERCURY ACH|POS|SQ \*|TST\*)\s*\d*\s*", "", desc, flags=re.I)
    s = re.sub(r"\b(LLC|INC\.?|CORP|CO|LTD)\b.*$", "", s, flags=re.I)
    s = re.sub(r"[*#].*$", "", s).strip()
    return s.title() or desc


def days_between(a, b):
    return abs((date.fromisoformat(b) - date.fromisoformat(a)).days)


def categorize(rows, learned=None, card_pattern=r"card"):
    book = load("rulebook.json")
    th = load("thresholds.json")["startup"]
    rules = [(re.compile(r["pattern"], re.I), r["vendor"], r["category"]) for r in book["rules"]]
    learned = {k.lower(): v for k, v in (learned or {}).items()}
    out = []
    for r in rows:
        hit = next(((v, c) for rx, v, c in rules if rx.search(r["description"])), None)
        vendor = hit[0] if hit else fallback_vendor(r["description"])
        category = hit[1] if hit else "Other"
        note = f"rule matched -> {vendor} ({category})" if hit else "no rule matched: needs a human"
        if vendor.lower() in learned:
            category = learned[vendor.lower()]
            note = f"learned rule: {vendor} -> {category}"
        flags = []
        if r["receipt"] is False and r["amount"] < 0:
            flags.append("missing_receipt")
        if category in ("Contractors", "Legal & Accounting") and r["amount"] < 0:
            flags.append("1099_candidate")
        if category == "Other" and vendor.lower() not in learned:
            flags.append("needs_review")
        out.append({**r, "vendor": vendor, "category": category, "flags": flags, "note": note})

    # duplicates: same vendor and amount within N days, on a card (or any account if no account column)
    window = th["duplicate_window_days"]
    asc = sorted(range(len(out)), key=lambda i: out[i]["date"])
    for pos, i in enumerate(asc):
        t = out[i]
        if t["amount"] >= 0:
            continue
        if t["account"] is not None and not re.search(card_pattern, t["account"], re.I):
            continue
        for j in asc[:pos]:
            p = out[j]
            if p["vendor"] == t["vendor"] and p["amount"] == t["amount"] and days_between(p["date"], t["date"]) <= window:
                t["flags"].append("duplicate")
                t["note"] = f"possible duplicate of {p['id']} on {p['date']}; {t['note']}"
                break

    # unusual: first-time vendor over a floor, or a multiple of the vendor's median
    exempt = set(book["unusual_exempt_categories"])
    hist = {}
    for t in out:
        if t["amount"] < 0:
            hist.setdefault(t["vendor"], []).append(-t["amount"])
    for t in out:
        if t["amount"] >= 0 or t["category"] in exempt or t["vendor"].lower() in learned:
            continue
        h = hist[t["vendor"]]
        med = statistics.median_high(h)
        amt = -t["amount"]
        first = len(h) == 1 and amt >= th["unusual_first_time_vendor_min"]
        spike = len(h) >= th["unusual_multiple_min_history"] and amt > th["unusual_multiple_of_median"] * med and amt > th["unusual_multiple_min_amount"]
        if first or spike:
            t["flags"].append("unusual")
            t["note"] = ("first payment ever to this vendor" if first else f"{round(amt / med)}x typical") + f"; {t['note']}"
    return out


# ---------------------------------------------------------------- leaks

def month_totals(txns):
    book = load("rulebook.json")
    skip = set(book["non_spend_categories"])
    by = {}
    for t in txns:
        if t["amount"] < 0 and t["category"] not in skip:
            by.setdefault(t["vendor"], {}).setdefault(t["date"][:7], 0.0)
            by[t["vendor"]][t["date"][:7]] += -t["amount"]
    return by


def leaks(txns, logins=None):
    th = load("thresholds.json")["startup"]
    findings = []
    for t in txns:
        for f in t["flags"]:
            if f in ("duplicate", "unusual"):
                findings.append({"kind": f, "vendor": t["vendor"], "amount": -t["amount"], "date": t["date"], "id": t["id"], "detail": t["note"]})
    by = month_totals(txns)
    months = sorted({m for v in by.values() for m in v})
    if len(months) >= 4:
        last, prior = months[-1], months[-4:-1]
        for vendor, mm in by.items():
            avg = sum(mm.get(m, 0) for m in prior) / 3
            now = mm.get(last, 0)
            if avg > 0 and now >= th["spike_min_dollars"] and (now - avg) / avg * 100 >= th["spike_pct"]:
                findings.append({"kind": "spike", "vendor": vendor, "amount": round(now), "detail": f"{last} is {round((now - avg) / avg * 100)}% above the prior 3-month average of {round(avg)}"})
    for vendor, n in (logins or {}).items():
        if n == 0 and vendor in by:
            monthly = by[vendor].get(months[-1], 0) if months else 0
            findings.append({"kind": "unused_saas", "vendor": vendor, "amount": round(monthly), "detail": f"0 logins in 90 days; cancelling saves about {round(monthly * 12)} a year"})
    return findings


# ---------------------------------------------------------------- contractors

def contractors(txns, year, w9_on_file):
    th = load("thresholds.json")["startup"]
    paid = {}
    for t in txns:
        if "1099_candidate" in t["flags"] and t["date"].startswith(str(year)):
            paid[t["vendor"]] = paid.get(t["vendor"], 0) - t["amount"]
    have = {v.lower() for v in w9_on_file}
    rows = [{"vendor": v, "paid": round(p, 2), "w9_on_file": v.lower() in have} for v, p in paid.items() if p > th["contractor_1099_threshold"]]
    rows.sort(key=lambda r: -r["paid"])
    return {"year": year, "threshold": th["contractor_1099_threshold"], "verify": th["contractor_1099_verify"],
            "backup_withholding_rate": th["backup_withholding_rate"], "contractors": rows,
            "missing_w9": [r["vendor"] for r in rows if not r["w9_on_file"]],
            "note": "Candidates only. Corporations are often exempt from 1099-NEC but legal fees are not; a CPA decides."}


# ---------------------------------------------------------------- runway

def runway(cash, expenses, revenue=0.0, interest=0.0, hires=0, salary=160_000, extra=0.0, growth_pct=0.0, as_of=None):
    th = load("thresholds.json")["startup"]
    as_of = as_of or date.today()
    base_net = expenses - revenue - interest

    def run(exp, rev):
        c, months, net = cash, 0.0, exp - rev - interest
        for _ in range(120):
            net = exp - rev - interest
            if net <= 0:
                return None
            if c < net:
                return months + c / net
            c -= net
            months += 1
            rev *= 1 + growth_pct / 100
        return None  # still alive after 120 months

    def pack(m):
        if m is None:
            return {"runway_months": None, "zero_cash_date": "default alive"}
        return {"runway_months": round(m, 1), "zero_cash_date": (as_of + timedelta(days=round(m * 30.44))).isoformat()}

    added = extra + hires * salary * th["payroll_load_multiplier"] / 12
    base = run(expenses, revenue)
    scen = run(expenses + added, revenue)
    res = {"cash": cash, "baseline": {"net_burn": round(base_net), **pack(base)},
           "scenario": {"added_monthly_spend": round(added), "net_burn": round(base_net + added), **pack(scen)}}
    r = scen if (hires or extra or growth_pct) else base
    if r is not None and r < th["runway_warn_below_months"]:
        start = max(r - th["runway_fundraise_lead_months"], 0)
        res["fundraise_prep_by"] = (as_of + timedelta(days=round(start * 30.44))).isoformat()
    return res


# ---------------------------------------------------------------- calendar

def roll_weekend(d):
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def tax_calendar(as_of, within_days, tags):
    cal = load("tax-calendar.json")
    out = []
    for ev in cal["events"]:
        if ev["applies_to"] and not set(ev["applies_to"]) & tags:
            continue
        for y in (as_of.year - 1, as_of.year, as_of.year + 1):
            for m, d in ev["dates"]:
                nominal = date(y, m, d)
                eff = roll_weekend(nominal)
                gap = (eff - as_of).days
                if 0 <= gap <= within_days:
                    out.append({"date": nominal.isoformat(), "effective_date": eff.isoformat(), "days_away": gap,
                                "status": "due_soon" if gap <= 30 else "upcoming", "title": ev["title"],
                                "authority": ev["authority"], "form": ev["form"], "note": ev["note"], "verify": ev["verify"],
                                **({"date_depends_on": ev["date_depends_on"]} if "date_depends_on" in ev else {})})
    out.sort(key=lambda e: (e["effective_date"], e["title"]))
    return {"as_of": as_of.isoformat(), "assumed_tags": sorted(tags), "scope": cal["_scope"], "weekends": cal["_weekends"], "events": out}


# ---------------------------------------------------------------- personal

def days_left(d):
    """Days left in the month including `d`."""
    first_next = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return (first_next - d).days


def daily_number(income, bills, invest, spent_month, swept_month, spent_today, on):
    pool = income - bills - invest - spent_month - swept_month
    left = days_left(on)
    allowance = max(0, math.floor(pool / left))
    return {"pool": round(pool, 2), "days_left": left, "allowance_at_start_of_day": allowance,
            "today": max(0, math.floor(allowance - spent_today)),
            "over_by": max(0, math.ceil(spent_today - allowance)),
            "note": "spent_month is spend before today. A leftover swept at midnight leaves the pool; overspending shrinks tomorrow."}


def girl_math(price, goal_price, saved, sweeps, today_number=0.0):
    pace = max(1.0, (sum(sweeps) / len(sweeps)) if sweeps else today_number * 0.25)
    eta = math.ceil(max(0, goal_price - saved) / pace)
    eta_buy = math.ceil(max(0, goal_price - saved + price) / pace)
    d = price / pace
    if d < 1:
        lag = f"~{max(1, round(24 * d))} hours"
    else:
        lag = f"{round(d)} day" + ("" if round(d) == 1 else "s")
    return {"pace_per_day": round(pace, 2), "eta_days_if_skip": eta, "eta_days_if_buy": eta_buy,
            "delay_days": math.ceil(d), "delay_words": lag}


# ---------------------------------------------------------------- cli

def emit(obj):
    json.dump(obj, sys.stdout, indent=2, default=str)
    print()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("franchise-tax")
    p.add_argument("--authorized", type=int, required=True)
    p.add_argument("--issued", type=int, required=True)
    p.add_argument("--gross-assets", type=float, required=True)
    p.add_argument("--par", type=float, default=0.00001)
    for name in ("categorize", "leaks", "contractors"):
        p = sub.add_parser(name)
        p.add_argument("csv")
        p.add_argument("--learned", help="JSON file {vendor: category}")
        p.add_argument("--card-pattern", default="card", help="regex for accounts where duplicates count")
        if name == "categorize":
            p.add_argument("--format", choices=("json", "csv"), default="json")
        if name == "leaks":
            p.add_argument("--logins", help="JSON file {vendor: sso_logins_90d}")
        if name == "contractors":
            p.add_argument("--year", type=int, default=date.today().year)
            p.add_argument("--w9", default="", help="comma list of vendors with a W-9 on file")
    p = sub.add_parser("runway")
    p.add_argument("--cash", type=float, required=True)
    p.add_argument("--expenses", type=float, help="average monthly expenses")
    p.add_argument("--revenue", type=float, default=0.0)
    p.add_argument("--interest", type=float, default=0.0)
    p.add_argument("--net-burn", type=float, help="shortcut: monthly net burn when you lack the split")
    p.add_argument("--hires", type=int, default=0)
    p.add_argument("--salary", type=float, default=160_000)
    p.add_argument("--extra", type=float, default=0.0, help="extra monthly spend")
    p.add_argument("--growth-pct", type=float, default=0.0, help="monthly revenue growth")
    p.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    p = sub.add_parser("calendar")
    p.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    p.add_argument("--within-days", type=int, default=120)
    p.add_argument("--has", default="c_corp,delaware,payroll,contractors", help="comma tags: c_corp,delaware,payroll,contractors,california,options,rd,sf")
    p = sub.add_parser("daily-number")
    for a in ("income", "bills", "invest", "spent-month", "swept-month", "spent-today"):
        p.add_argument(f"--{a}", type=float, default=0.0)
    p.add_argument("--date", type=date.fromisoformat, default=date.today())
    p = sub.add_parser("girl-math")
    p.add_argument("--price", type=float, required=True)
    p.add_argument("--goal-price", type=float, required=True)
    p.add_argument("--saved", type=float, default=0.0)
    p.add_argument("--sweeps", default="", help="comma list of the last 7 days' sweeps")
    p.add_argument("--today-number", type=float, default=0.0)
    a = ap.parse_args(argv)

    if a.cmd == "franchise-tax":
        emit(franchise_tax(a.authorized, a.issued, a.gross_assets, a.par))
    elif a.cmd in ("categorize", "leaks", "contractors"):
        learned = json.loads(Path(a.learned).read_text()) if a.learned else None
        txns = categorize(read_csv(a.csv), learned, a.card_pattern)
        if a.cmd == "categorize":
            if a.format == "csv":
                w = csv.writer(sys.stdout)
                w.writerow(["id", "date", "amount", "description", "vendor", "category", "flags"])
                for t in txns:
                    w.writerow([t["id"], t["date"], t["amount"], t["description"], t["vendor"], t["category"], " ".join(t["flags"])])
            else:
                emit(txns)
        elif a.cmd == "leaks":
            emit(leaks(txns, json.loads(Path(a.logins).read_text()) if a.logins else None))
        else:
            emit(contractors(txns, a.year, [x.strip() for x in a.w9.split(",") if x.strip()]))
    elif a.cmd == "runway":
        if a.net_burn is not None:
            exp, rev = a.net_burn, 0.0
        elif a.expenses is not None:
            exp, rev = a.expenses, a.revenue
        else:
            ap.error("runway needs --expenses (with --revenue) or --net-burn")
        emit(runway(a.cash, exp, rev, a.interest, a.hires, a.salary, a.extra, a.growth_pct, a.as_of))
    elif a.cmd == "calendar":
        emit(tax_calendar(a.as_of, a.within_days, {x.strip() for x in a.has.split(",") if x.strip()}))
    elif a.cmd == "daily-number":
        emit(daily_number(a.income, a.bills, a.invest, a.spent_month, a.swept_month, a.spent_today, a.date))
    elif a.cmd == "girl-math":
        emit(girl_math(a.price, a.goal_price, a.saved, [float(x) for x in a.sweeps.split(",") if x.strip()], a.today_number))


if __name__ == "__main__":
    main()
