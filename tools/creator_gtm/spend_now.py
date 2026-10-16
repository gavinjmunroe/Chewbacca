"""Rank a client's brands by who is spending on creators now, from dated, sourced evidence.

    python3 tools/creator_gtm/spend_now.py <client.json> columns [--live]   make the client's columns
    python3 tools/creator_gtm/spend_now.py <client.json> collect            public ATS jobs -> evidence, Jev-checked
    python3 tools/creator_gtm/spend_now.py <client.json> add --file x.jsonl research from anywhere -> evidence
    python3 tools/creator_gtm/spend_now.py <client.json> check              Jev judges unchecked evidence
    python3 tools/creator_gtm/spend_now.py <client.json> score              print scores, write nothing
    python3 tools/creator_gtm/spend_now.py <client.json> write [--live]     scores and sources into Clay

Everything client-specific lives in the client file's "spend_now" block: the signals (kind,
weight, label, the question Jev answers), the scoring window, the budget reset day, the
brands, their ATS boards and the evidence file. The code names no client and no signal.

An evidence item is one JSONL line: brand, kind, date, url, text, found_by, jev. It scores only
with a date, a URL and Jev's "yes". Jev decides that one thing; the number is arithmetic, so the
same evidence always gives the same score. The writes are plain columns and cells, which cost no
Clay credits. Every Clay call goes through `chewbacca clay`, which owns the write gate. Dry run
is the default for writes.
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.request

# A title has to carry one of these before Jev is asked about it. Celsius, 2026-10-16: 13 of
# 13 Workable posts that matched were paid field or campus ambassadors, a NASCAR deal or a
# community role, and Jev said no to all of them, so the filter is cheap recall, Jev is precision.
DEFAULT_TITLE_WORDS = r"creator|influenc|partnership|ambassador|athlete|social|communit|ugc|talent"
DEFAULT_WINDOW = {"full_days": 90, "half_days": 180}


class Failed(SystemExit):
    pass


# ── config ───────────────────────────────────────────────────────────────────

def load_client(path):
    with open(os.path.expanduser(path)) as f:
        cfg = json.load(f)
    spend = cfg.get("spend_now")
    if not spend or not spend.get("signals") or not spend.get("brands"):
        raise Failed(f"{path} has no spend_now block with signals and brands")
    kinds = [s["kind"] for s in spend["signals"]]
    if len(set(kinds)) != len(kinds):
        raise Failed(f"{path}: signal kinds repeat: {kinds}")
    cfg["_dir"] = os.path.dirname(os.path.abspath(os.path.expanduser(path)))
    return cfg


def evidence_path(cfg):
    p = os.path.expanduser(cfg["spend_now"].get("evidence") or f"{cfg.get('client_slug', 'client')}.spend-evidence.jsonl")
    return p if os.path.isabs(p) else os.path.join(cfg["_dir"], p)


def signals(cfg):
    return {s["kind"]: s for s in cfg["spend_now"]["signals"]}


def column_plan(cfg):
    """Every column this client gets, as role -> (name, data type). Names come from config."""
    spend = cfg["spend_now"]
    names = spend.get("columns") or {}
    plan = {"score": (names.get("score", "Spending now"), "number"),
            "evidence": (names.get("evidence", "Spend evidence"), "text")}
    for s in spend["signals"]:
        if s.get("columns", True):
            label = s.get("label") or s["kind"].capitalize()
            plan[f"{s['kind']}_date"] = (f"{label} signal date", "date")
            plan[f"{s['kind']}_source"] = (f"{label} signal source", "text")
    return plan


def score_description(cfg):
    spend = cfg["spend_now"]
    win = {**DEFAULT_WINDOW, **(spend.get("window") or {})}
    parts = ", ".join(f"{s['kind']} {s['weight']}" for s in spend["signals"])
    total = sum(s["weight"] for s in spend["signals"])
    reset = spend.get("budget_reset")
    tail = f"; half again if dated before the last budget reset ({reset})" if reset else ""
    return (f"0 to {total}: sum of weights ({parts}) for each kind's newest dated, Jev-confirmed item. "
            f"Full weight within {win['full_days']} days, half to {win['half_days']}, zero after{tail}. "
            "Written by tools/creator_gtm/spend_now.py; every point has a dated source in the signal columns.")


# ── scoring ──────────────────────────────────────────────────────────────────

def parse_date(value):
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def last_reset(today, reset):
    """The most recent budget reset on or before today, from "MM-DD"."""
    month, day = (int(x) for x in reset.split("-"))
    this_year = dt.date(today.year, month, day)
    return this_year if this_year <= today else dt.date(today.year - 1, month, day)


def recency(date, today, window, reset=None):
    age = (today - date).days
    if age < 0 or age > window["half_days"]:
        return 0.0
    factor = 1.0 if age <= window["full_days"] else 0.5
    if reset and date < last_reset(today, reset):
        factor *= 0.5
    return factor


def score_brand(items, today, cfg):
    """(score, best item per kind). The best item is the newest Jev-confirmed one with a date and
    a URL; it is kept even at 0 points so the row still shows the newest dated source."""
    spend = cfg["spend_now"]
    window = {**DEFAULT_WINDOW, **(spend.get("window") or {})}
    best, total = {}, 0.0
    for kind, sig in signals(cfg).items():
        ok = [it for it in items if it.get("kind") == kind and parse_date(it.get("date"))
              and str(it.get("url", "")).startswith("http") and it.get("jev") == "yes"]
        if not ok:
            continue
        scored = [(recency(parse_date(it["date"]), today, window, spend.get("budget_reset")), it["date"], it) for it in ok]
        factor, _, it = max(scored, key=lambda c: (c[0], c[1]))
        best[kind] = {**it, "factor": factor, "points": round(sig["weight"] * factor, 1)}
        total += sig["weight"] * factor
    return round(total), best


def evidence_line(best, today, rejected=()):
    """The strongest dated source in one sentence, for the evidence cell."""
    counted = [b for b in best.values() if b["points"] > 0]
    if counted:
        b = max(counted, key=lambda b: (b["points"], b["date"]))
        more = len(counted) - 1
        tail = f" Plus {more} more signal{'s' if more > 1 else ''}." if more else ""
        return f"{b['date']} ({(today - parse_date(b['date'])).days} days, {b['kind']}): {b['text']} {b['url']}{tail}"
    if best:
        b = max(best.values(), key=lambda b: b["date"])
        return (f"Nothing recent enough to score. Newest: {b['date']} ({(today - parse_date(b['date'])).days} days), "
                f"{b['text']} {b['url']}")
    if rejected:
        r = max(rejected, key=lambda e: e["date"])
        n = len(rejected)
        return (f"No creator-spend evidence found. {n} dated item{'s' if n > 1 else ''} checked and judged not "
                f"creator spend; newest {r['date'][:10]}: {r['text']} {r['url']}")
    return "No dated creator-spend evidence found yet."


def brand_result(evidence, brand, today, cfg):
    items = [e for e in evidence if e.get("brand") == brand]
    score, best = score_brand(items, today, cfg)
    rejected = [e for e in items if e.get("jev") == "no" and parse_date(e.get("date"))]
    return score, best, evidence_line(best, today, rejected)


# ── evidence ─────────────────────────────────────────────────────────────────

def load_evidence(cfg):
    path = evidence_path(cfg)
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def save_evidence(cfg, rows):
    with open(evidence_path(cfg), "w") as f:
        for e in rows:
            f.write(json.dumps(e) + "\n")


def append_evidence(cfg, items):
    """Add items not already on file, keyed by brand, kind and URL. One posting can list
    several cities under one URL, so the key also dedupes within a batch."""
    have = {(e["brand"], e["kind"], e["url"]) for e in load_evidence(cfg)}
    fresh = []
    for it in items:
        key = (it["brand"], it["kind"], it["url"])
        if key not in have:
            have.add(key)
            fresh.append(it)
    with open(evidence_path(cfg), "a") as f:
        for it in fresh:
            f.write(json.dumps(it) + "\n")
    return fresh


def validate_item(cfg, raw, today):
    """Return a clean evidence item, or raise naming what's wrong."""
    kinds = list(signals(cfg))
    brands = list(cfg["spend_now"]["brands"])
    problems = []
    if raw.get("brand") not in brands:
        problems.append(f"brand not in {brands}")
    if raw.get("kind") not in kinds:
        problems.append(f"kind not in {kinds}")
    if not str(raw.get("url", "")).startswith("http"):
        problems.append("url must be http(s)")
    if raw.get("date") and not parse_date(raw["date"]):
        problems.append("date must be YYYY-MM-DD or empty")
    if not raw.get("text"):
        problems.append("text is empty")
    if problems:
        raise Failed(f"bad evidence {json.dumps(raw)[:200]}: {'; '.join(problems)}")
    return {"brand": raw["brand"], "kind": raw["kind"], "date": raw.get("date") or "", "url": raw["url"],
            "text": raw["text"], "found_by": raw.get("found_by") or "hand", "found_on": today.isoformat(),
            "jev": "unchecked"}


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "chewbacca-spend-now/1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def ats_jobs(board, slug, fetch=fetch_json):
    """Dated jobs from a public ATS board. Checked live 2026-10-16: Greenhouse gymshark
    (first_published), Ashby strava (publishedAt), Workable celsius (published_on). Lever's
    shape is from its public docs and hasn't been seen live."""
    if board == "greenhouse":
        data = fetch(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
        return [{"date": j.get("first_published") or j.get("updated_at"), "title": j["title"],
                 "where": (j.get("location") or {}).get("name"), "url": j["absolute_url"]} for j in data["jobs"]]
    if board == "ashby":
        data = fetch(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
        return [{"date": j.get("publishedAt"), "title": j["title"], "where": j.get("location"),
                 "url": j["jobUrl"]} for j in data["jobs"]]
    if board == "workable":
        data = fetch(f"https://apply.workable.com/api/v1/widget/accounts/{slug}")
        return [{"date": j.get("published_on"), "title": j["title"], "where": j.get("city"),
                 "url": j["url"]} for j in data["jobs"]]
    if board == "lever":
        data = fetch(f"https://api.lever.co/v0/postings/{slug}?mode=json")
        return [{"date": dt.datetime.fromtimestamp(j["createdAt"] / 1000, dt.timezone.utc).date().isoformat(),
                 "title": j["text"], "where": (j.get("categories") or {}).get("location"),
                 "url": j["hostedUrl"]} for j in data]
    raise Failed(f"unknown ATS board {board}")


def run_jev(request):
    out = subprocess.run(["chewbacca", "jev", "evaluate", "-"], input=json.dumps(request),
                         capture_output=True, text=True, timeout=90)
    return json.loads(out.stdout)["answers"]


def jev_check(cfg, brand, items, jev=run_jev):
    """One Jev call per brand, one yes/no per item, asked with that signal's own question.
    Returns None when Jev fails, and those items stay unchecked, which scores nothing."""
    if not items:
        return []
    sigs = signals(cfg)
    request = {
        "state": "\n".join(f"{i}: [{it['kind']}] {it['date'][:10] or 'undated'}: {it['text']}" for i, it in enumerate(items)),
        "questions": {f"item_{i}": {
            "type": "choice",
            "instructions": f"Item {i} is about {brand}. " + sigs[it["kind"]]["question"].format(brand=brand),
            "criteria": {"yes": "Yes", "no": "No"},
        } for i, it in enumerate(items)},
    }
    try:
        answers = jev(request)
        return [answers[f"item_{i}"]["choice"] for i in range(len(items))]
    except (json.JSONDecodeError, KeyError, TypeError, ValueError, subprocess.SubprocessError) as exc:
        print(f"jev failed for {brand}: {exc}", file=sys.stderr)
        return None


# TODO: when tools/creator_gtm/provider.py lands (tab local_e6857244, ~/code/wt-gtm-provider), get
# jobs from Provider.company_signals and send writes through it, not ats_jobs and clay() directly.
def collect(cfg, today, fetch=fetch_json, jev=run_jev):
    """Every ATS board in config: keep creator-team titles in the window, let Jev judge, append."""
    spend = cfg["spend_now"]
    window = {**DEFAULT_WINDOW, **(spend.get("window") or {})}
    words = re.compile(spend.get("title_words") or DEFAULT_TITLE_WORDS, re.I)
    if "hiring" not in signals(cfg):
        raise Failed("collect writes hiring evidence, and this client has no hiring signal")
    found = []
    for brand, boards in (spend.get("ats") or {}).items():
        items = []
        for board, slug in boards.items():
            try:
                jobs = ats_jobs(board, slug, fetch)
            except Exception as exc:  # a dead board is reported, never read as zero hiring
                print(f"{brand}: {board}/{slug} unreadable: {exc}", file=sys.stderr)
                continue
            for j in jobs:
                d = parse_date(j["date"])
                if d and 0 <= (today - d).days <= window["half_days"] and words.search(j["title"]):
                    items.append({"brand": brand, "kind": "hiring", "date": d.isoformat(),
                                  "text": f"{brand} job: {j['title'].strip()} ({j.get('where') or 'location not given'}), via {board}",
                                  "url": j["url"], "found_by": f"ats:{board}", "found_on": today.isoformat()})
        verdicts = jev_check(cfg, brand, items, jev) or [None] * len(items)
        for it, v in zip(items, verdicts):
            it["jev"] = v or "unchecked"
        found += append_evidence(cfg, items)
    return found


def check(cfg, today, jev=run_jev):
    rows = load_evidence(cfg)
    todo = {}
    for i, e in enumerate(rows):
        if e.get("jev") not in ("yes", "no"):
            todo.setdefault(e["brand"], []).append(i)
    checked = 0
    for brand, idxs in todo.items():
        verdicts = jev_check(cfg, brand, [rows[i] for i in idxs], jev)
        for i, v in zip(idxs, verdicts or []):
            rows[i]["jev"], rows[i]["jev_on"] = v, today.isoformat()
            checked += 1
    save_evidence(cfg, rows)
    return checked


# ── Clay ─────────────────────────────────────────────────────────────────────

def clay(op, live=True, write=False, **kw):
    args = ["chewbacca", "clay", op] + [f"{k}={v}" for k, v in kw.items()]
    if write:
        args.append("--allow-writes" if live else "--dry-run")
    out = subprocess.run(args, capture_output=True, text=True, timeout=120)
    try:
        receipt = json.loads(out.stdout or "{}")
    except json.JSONDecodeError:
        raise Failed(f"{op}: not JSON: {out.stdout[:300]} {out.stderr[:300]}")
    if not receipt.get("ok", False) and (live or not write):
        raise Failed(f"{op} failed: {(out.stdout or out.stderr)[:600]}")
    return receipt


def table_columns(cfg):
    return {c.get("name"): c["id"] for c in clay("columns", table=cfg["table"]).get("data") or []}


def ensure_columns(cfg, live):
    """Create every planned column the table lacks, then set the score's description. Returns
    role -> field id, plus brand, domain and status from the client's column names."""
    plan = column_plan(cfg)
    cols = table_columns(cfg)
    for name, kind in plan.values():
        if name not in cols:
            clay("add-column", live, write=True, ws=cfg["ws"], table=cfg["table"], name=name,
                 data_type=kind, view=cfg["view"])
    if live:
        cols = table_columns(cfg)
    ids = {role: cols.get(name) for role, (name, _) in plan.items()}
    names = cfg.get("columns") or {}
    for role, default in (("brand", "Brand"), ("domain", "Brand Domain"), ("status", "Status")):
        ids[role] = cols.get(names.get(role, default))
    if live:
        lost = [plan[r][0] for r in plan if not ids[r]]
        if lost:
            raise Failed(f"added but can't find columns {lost}")
        clay("update-column", live, write=True, ws=cfg["ws"], table=cfg["table"], field=ids["score"],
             update=json.dumps({"description": score_description(cfg)}))
    return ids


def brand_rows(cfg, brand_field):
    """Every row id per configured brand, reading only the brand cell so no row hits the
    engine's 20k read cap. A brand on several rows (a test row and a Ready row) gets all."""
    brands = set(cfg["spend_now"]["brands"])
    ids = clay("row-ids", ws=cfg["ws"], table=cfg["table"], view=cfg["view"]).get("data") or []
    found = {}
    for i in range(0, len(ids), 100):
        data = clay("rows-by-id", ws=cfg["ws"], table=cfg["table"], rows=",".join(ids[i:i + 100]),
                    fields=brand_field).get("data") or []
        for r in data:
            name = ((r.get("cells") or {}).get(brand_field) or {}).get("value")
            if name in brands:
                found.setdefault(name, []).append(r["id"])
    return found


def write(cfg, today, live):
    spend = cfg["spend_now"]
    brands = spend["brands"]
    evidence = load_evidence(cfg)
    ids = ensure_columns(cfg, live)
    if not ids["brand"]:
        raise Failed("the table has no brand column; set columns.brand in the client file")
    rows = brand_rows(cfg, ids["brand"])
    missing = [b for b in brands if b not in rows]
    if missing:
        status = spend.get("new_row_status", "Needs work: no contact run yet, spend score only")
        records = [{k: v for k, v in ((ids["brand"], b), (ids["domain"], brands[b]), (ids["status"], status)) if k}
                   for b in missing]
        r = clay("add-rows", live, write=True, ws=cfg["ws"], table=cfg["table"], records=json.dumps(records))
        for b, rid in zip(missing, re.findall(r'"(r_[0-9A-Za-z]{15,})"', json.dumps(r.get("data")))):
            rows[b] = [rid]
    plan = column_plan(cfg)
    records, report = [], []
    for brand in brands:
        score, best, line = brand_result(evidence, brand, today, cfg)
        cells = {ids["score"]: score, ids["evidence"]: line}
        for kind in signals(cfg):
            if f"{kind}_date" in plan:
                b = best.get(kind)
                cells[ids[f"{kind}_date"]] = b["date"] if b else None
                cells[ids[f"{kind}_source"]] = f"{b['date']}: {b['text']} {b['url']}" if b else None
        if all(cells):  # a dry run has no ids for columns it hasn't made
            records += [{"id": rid, "cells": cells} for rid in rows.get(brand, [])]
        report.append((brand, score, line))
    for i in range(0, len(records), 100):
        clay("update-rows", live, write=True, ws=cfg["ws"], table=cfg["table"], records=json.dumps(records[i:i + 100]))
    return report


# ── CLI ──────────────────────────────────────────────────────────────────────

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("client", help="client file, e.g. ~/.chewbacca/gtm/clients/sabo.json")
    p.add_argument("cmd", choices=["columns", "collect", "add", "check", "score", "write"])
    p.add_argument("--live", action="store_true", help="send writes (default is a dry run)")
    p.add_argument("--file", help="add: a JSONL file of evidence items")
    p.add_argument("--today", help="YYYY-MM-DD, for replays and tests")
    a = p.parse_args(argv)
    cfg = load_client(a.client)
    today = parse_date(a.today) if a.today else dt.date.today()
    if a.cmd == "columns":
        ids = ensure_columns(cfg, a.live)
        print(json.dumps({column_plan(cfg)[r][0]: ids.get(r) for r in column_plan(cfg)}, indent=1))
    elif a.cmd == "collect":
        for it in collect(cfg, today):
            print(json.dumps(it))
    elif a.cmd == "add":
        if not a.file:
            p.error("add needs --file with one JSON item per line")
        with open(a.file) as f:
            items = [validate_item(cfg, json.loads(line), today) for line in f if line.strip()]
        print(f"added {len(append_evidence(cfg, items))} of {len(items)}; run check so Jev judges them")
    elif a.cmd == "check":
        print(f"checked {check(cfg, today)} items")
    else:
        if a.cmd == "write":
            report = write(cfg, today, a.live)
        else:
            ev = load_evidence(cfg)
            report = [(b, *brand_result(ev, b, today, cfg)[::2]) for b in cfg["spend_now"]["brands"]]
        for brand, score, line in report:
            print(f"{score:>3}  {brand}: {line}")


if __name__ == "__main__":
    main()
