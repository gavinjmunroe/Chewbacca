#!/usr/bin/env python3
"""Discovery for an AI engagement: readiness, a measured baseline, an ROI range and a build order.

    discovery assess answers.json [--json]
    discovery roi workflows.csv [--json]
    discovery report --org NAME [--assess answers.json] [--roi workflows.csv] [--out report.md]
    discovery template assess|roi

Agency discovery sells three things: a maturity tier, a baseline of what the work costs today,
and a forecast of what automating it is worth and in what order. This does all three from
files a person can read and argue with, and refuses to dress a guess up as a number:

- A top answer on the readiness check counts only when it names evidence (a link, a file, a
  policy, a dashboard). A bare "yes" scores as partial and the report says so, because the
  self-scored quizzes this replaces let leaders grade themselves.
- Every ROI figure is a low/high range from the row's own inputs, never a single point.
- A workflow row with no source for its time estimate stays out of the totals and is listed
  as unmeasured, so the headline number is only what someone actually measured.
"""
import argparse
import csv
import json
import math
import sys

# Ten checks across four pillars. Order matters: the focus list fixes earlier pillars
# first, since adoption without an owner or access stalls (the dependency every public
# maturity model we read on 2026-11-03 assumes, AuraPath's included).
PILLARS = ["leadership", "foundation", "adoption", "compounding"]
CHECKS = [
    {"id": "owner", "pillar": "leadership",
     "ask": "Who owns AI here, with time, budget and a result they answer for?",
     "fix": "Name one owner with hours on the calendar and a number they report monthly."},
    {"id": "guardrails", "pillar": "leadership",
     "ask": "Is there a written data policy and an approved tool list that people follow?",
     "fix": "Write a one-page data policy and an approved tool list, then check one team against it."},
    {"id": "access", "pillar": "foundation",
     "ask": "Does every person have a company-paid frontier model account?",
     "fix": "Buy team accounts and run one hour of onboarding per department."},
    {"id": "inventory", "pillar": "foundation",
     "ask": "Is there a written list of workflows ranked by hours they take and what they're worth?",
     "fix": "Fill the roi template for one department: runs a week, minutes a run, who measured it."},
    {"id": "knowledge", "pillar": "foundation",
     "ask": "Could a system find your procedures and past decisions without asking a person?",
     "fix": "Move the procedures for the top three workflows into one searchable place."},
    {"id": "depth", "pillar": "adoption",
     "ask": "Do most people use AI daily inside core work, not just to draft email?",
     "fix": "Pick the top workflow and run it with AI for two weeks, with its owner timing it."},
    {"id": "automation", "pillar": "adoption",
     "ask": "Does any workflow run end to end without a person pasting into a chat box?",
     "fix": "Rebuild one measured workflow as an automation with a person approving the output."},
    {"id": "training", "pillar": "adoption",
     "ask": "Is there structured training plus named people who coach others?",
     "fix": "Name two champions, give them two hours a week, and have them teach one session each."},
    {"id": "measurement", "pillar": "compounding",
     "ask": "Are hours saved or output per person tracked per workflow and reviewed on a schedule?",
     "fix": "Track hours per run before and after for the automated workflow, reviewed monthly."},
    {"id": "sharing", "pillar": "compounding",
     "ask": "When one person finds a win, does a shared library carry it to everyone?",
     "fix": "Start a shared library of prompts and skills with an owner, and demo one win a week."},
]
# A tier is the share of the 20 available points. The cut points are guessed, never
# measured against outcomes: change them when there's data on which tier books results.
TIERS = [(0.25, "Not started", "AI isn't part of how work gets done yet."),
         (0.50, "Experimenting", "People try things, but nothing has become how the business runs."),
         (0.75, "Building", "The basics are in place. The work now is making wins spread and compound."),
         (1.01, "Operating", "AI runs inside the work. The job is widening the lead and proving it in numbers.")]


def _die(msg):
    print(f"discovery: {msg}", file=sys.stderr)
    sys.exit(2)


def assess(answers):
    """answers: {check_id: {"score": 0|1|2, "evidence": "..."}} or {check_id: 0|1|2}."""
    if not isinstance(answers, dict):
        _die("answers must be a JSON object keyed by check id")
    unknown = sorted(set(answers) - {c["id"] for c in CHECKS})
    if unknown:
        _die("unknown check ids: " + ", ".join(unknown))
    rows, total = [], 0
    for c in CHECKS:
        raw = answers.get(c["id"])
        if raw is None:
            rows.append({**c, "claimed": None, "score": 0, "evidence": "", "note": "not answered"})
            continue
        if isinstance(raw, (int, float)) and not isinstance(raw, bool):
            raw = {"score": raw}
        if not isinstance(raw, dict):
            _die(f"{c['id']}: answer must be a number or an object")
        claimed = raw.get("score")
        if claimed not in (0, 1, 2):
            _die(f"{c['id']}: score must be 0, 1 or 2")
        evidence = str(raw.get("evidence") or "").strip()
        score, note = claimed, ""
        if claimed == 2 and not evidence:
            score, note = 1, "claimed 2 with no evidence, scored 1"
        total += score
        rows.append({**c, "claimed": claimed, "score": score, "evidence": evidence, "note": note})
    share = total / (2 * len(CHECKS))
    tier = next(t for t in TIERS if share < t[0])
    by_pillar = {p: sum(r["score"] for r in rows if r["pillar"] == p) for p in PILLARS}
    weak = [r for r in rows if r["score"] < 2]
    weak.sort(key=lambda r: (PILLARS.index(r["pillar"]), r["score"]))
    return {"points": total, "of": 2 * len(CHECKS), "share": round(share, 3),
            "tier": tier[1], "tier_reading": tier[2], "pillars": by_pillar,
            "unproven": [r["id"] for r in rows if r["note"].startswith("claimed")],
            "focus_90_days": [{"check": r["id"], "do": r["fix"]} for r in weak[:3]],
            "checks": [{k: r[k] for k in ("id", "pillar", "claimed", "score", "evidence", "note")}
                       for r in rows]}


ROI_COLUMNS = ["workflow", "runs_per_week", "minutes_per_run", "loaded_hourly_cost",
               "automatable_low", "automatable_high", "build_hours", "build_hourly_cost", "source"]


def _num(row, key, line, lo=0.0, hi=None):
    v = (row.get(key) or "").strip()
    try:
        x = float(v)
    except ValueError:
        _die(f"line {line}: {key} must be a number, got {v!r}")
    if math.isnan(x) or x < lo or (hi is not None and x > hi):
        _die(f"line {line}: {key}={v} is out of range")
    return x


def roi(rows):
    """Per workflow: baseline hours and cost a year, savings as a low/high range, payback weeks."""
    measured, unmeasured = [], []
    for i, row in enumerate(rows, start=2):
        missing = [c for c in ROI_COLUMNS if c not in row]
        if missing:
            _die("missing columns: " + ", ".join(missing))
        name = (row["workflow"] or "").strip() or f"line {i}"
        if not (row.get("source") or "").strip():
            unmeasured.append({"workflow": name, "why": "no source for the time estimate"})
            continue
        runs = _num(row, "runs_per_week", i)
        mins = _num(row, "minutes_per_run", i)
        rate = _num(row, "loaded_hourly_cost", i)
        lo = _num(row, "automatable_low", i, 0, 1)
        hi = _num(row, "automatable_high", i, 0, 1)
        if lo > hi:
            _die(f"line {i}: automatable_low is above automatable_high")
        build = _num(row, "build_hours", i) * _num(row, "build_hourly_cost", i)
        hours_year = runs * mins / 60 * 52
        cost_year = hours_year * rate
        save_lo, save_hi = cost_year * lo, cost_year * hi
        weekly_lo = save_lo / 52
        payback = math.ceil(build / weekly_lo) if weekly_lo > 0 else None
        measured.append({
            "workflow": name, "source": row["source"].strip(),
            "baseline_hours_year": round(hours_year, 1), "baseline_cost_year": round(cost_year),
            "hours_returned_year": [round(hours_year * lo, 1), round(hours_year * hi, 1)],
            "savings_year": [round(save_lo), round(save_hi)], "build_cost": round(build),
            "payback_weeks_worst_case": payback,
            # Build order ranks on the LOW end of savings per build dollar, so a wide guess
            # can't jump the queue on its optimistic half.
            "rank_score": round(save_lo / build, 3) if build else float("inf")})
    measured.sort(key=lambda r: -r["rank_score"])
    for n, r in enumerate(measured, 1):
        r["build_order"] = n
    tot = lambda k, j: round(sum(r[k][j] for r in measured))
    return {"workflows": measured, "unmeasured": unmeasured,
            "totals": {"baseline_cost_year": round(sum(r["baseline_cost_year"] for r in measured)),
                       "savings_year": [tot("savings_year", 0), tot("savings_year", 1)],
                       "hours_returned_year": [tot("hours_returned_year", 0), tot("hours_returned_year", 1)],
                       "build_cost": round(sum(r["build_cost"] for r in measured))}}


def _money(x):
    return f"${x:,.0f}"


def report(org, a=None, r=None):
    if a is None and r is None:
        _die("report needs --assess, --roi or both")
    out = [f"# Discovery report: {org}", ""]
    if a:
        out += ["## Where you are", "",
                f"Tier: {a['tier']} ({a['points']} of {a['of']} points). {a['tier_reading']}", ""]
        if a["unproven"]:
            out += ["Scored down for missing evidence: " + ", ".join(a["unproven"]) +
                    ". Each one goes back up the day someone links the proof.", ""]
        out += ["## The next 90 days", ""]
        out += [f"{i}. {f['do']}" for i, f in enumerate(a["focus_90_days"], 1)] + [""]
    if r:
        t = r["totals"]
        out += ["## What the work costs today", "",
                f"Measured workflows cost {_money(t['baseline_cost_year'])} a year in staff time.",
                f"Automating them returns {t['hours_returned_year'][0]:,} to {t['hours_returned_year'][1]:,} hours "
                f"and {_money(t['savings_year'][0])} to {_money(t['savings_year'][1])} a year, "
                f"for {_money(t['build_cost'])} of build.", "",
                "## Build order", "",
                "| # | Workflow | Saved a year | Build | Payback (worst case) | Source |",
                "|---|---|---|---|---|---|"]
        for w in r["workflows"]:
            pb = f"{w['payback_weeks_worst_case']} weeks" if w["payback_weeks_worst_case"] else "never at the low end"
            out.append(f"| {w['build_order']} | {w['workflow']} | {_money(w['savings_year'][0])} to "
                       f"{_money(w['savings_year'][1])} | {_money(w['build_cost'])} | {pb} | {w['source']} |")
        out.append("")
        if r["unmeasured"]:
            out += ["## Not counted yet", "",
                    "These have no measured time, so they're out of every total above:", ""]
            out += [f"- {u['workflow']}: {u['why']}" for u in r["unmeasured"]] + [""]
    out += ["Every number above comes from the inputs file and can be recomputed with "
            "`discovery roi` or `discovery assess`."]
    return "\n".join(out) + "\n"


def _load_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        _die(f"can't read {path}: {e}")


def _load_csv(path):
    try:
        with open(path, newline="", encoding="utf-8-sig") as f:
            return list(csv.DictReader(f))
    except OSError as e:
        _die(f"can't read {path}: {e}")


def template(kind):
    if kind == "assess":
        return json.dumps({c["id"]: {"score": 0, "evidence": "", "_ask": c["ask"]} for c in CHECKS}, indent=2)
    return ",".join(ROI_COLUMNS) + "\n" + \
        "Invoice entry,40,12,55,0.5,0.8,24,150,timed 10 runs on 2026-11-03\n"


def main(argv=None):
    p = argparse.ArgumentParser(prog="discovery", description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("assess"); s.add_argument("answers"); s.add_argument("--json", action="store_true")
    s = sub.add_parser("roi"); s.add_argument("workflows"); s.add_argument("--json", action="store_true")
    s = sub.add_parser("report"); s.add_argument("--org", required=True)
    s.add_argument("--assess"); s.add_argument("--roi"); s.add_argument("--out")
    s = sub.add_parser("template"); s.add_argument("kind", choices=["assess", "roi"])
    a = p.parse_args(argv)
    if a.cmd == "template":
        print(template(a.kind)); return 0
    if a.cmd == "assess":
        res = assess({k: v for k, v in _load_json(a.answers).items() if not k.startswith("_")})
        if a.json:
            print(json.dumps(res, indent=2)); return 0
        print(f"{res['tier']}: {res['points']}/{res['of']}. {res['tier_reading']}")
        if res["unproven"]:
            print("Scored down, no evidence: " + ", ".join(res["unproven"]))
        for i, f in enumerate(res["focus_90_days"], 1):
            print(f"{i}. {f['do']}")
        return 0
    if a.cmd == "roi":
        res = roi(_load_csv(a.workflows))
        if a.json:
            print(json.dumps(res, indent=2)); return 0
        t = res["totals"]
        print(f"Saved a year: {_money(t['savings_year'][0])} to {_money(t['savings_year'][1])}, "
              f"build {_money(t['build_cost'])}")
        for w in res["workflows"]:
            print(f"{w['build_order']}. {w['workflow']}: {_money(w['savings_year'][0])} to "
                  f"{_money(w['savings_year'][1])}, payback {w['payback_weeks_worst_case']} weeks")
        for u in res["unmeasured"]:
            print(f"not counted: {u['workflow']} ({u['why']})")
        return 0
    ra = assess({k: v for k, v in _load_json(a.assess).items() if not k.startswith("_")}) if a.assess else None
    rr = roi(_load_csv(a.roi)) if a.roi else None
    text = report(a.org, ra, rr)
    if a.out:
        with open(a.out, "w") as f:
            f.write(text)
        print(a.out)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
