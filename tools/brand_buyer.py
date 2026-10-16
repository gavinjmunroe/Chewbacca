"""One brand in, one verified creator-partnerships contact out, through a client's Clay table.

Usage: python3 tools/brand_buyer.py --client <client.json> --setup [--live]
       python3 tools/brand_buyer.py --client <client.json> "<Brand>" <domain> [--live]
The client file names the table, its columns, the creator and the parents file; see
library/gtm/brand-buyer/client.example.json. Sabo (2026-10-16) was the first client.

Chewbacca picks the domain to search, Clay's native people search finds candidates, and when
the brand domain has nobody the chain reruns on the parent domain from parents.json. Jev scores
every candidate on title and remit, the top one goes to Findymail and ZeroBounce, and an invalid
email gets one retry on the runner-up. The pick and a one-sentence reason land in the
"Why this person" column. Every write and paid run goes through `chewbacca clay`, which keeps
its own approval gate.

Dry run is the default: it prints each request and spends nothing. Pass --live to execute.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gtme_lessons import same_org, verified_email  # noqa: E402

# Set from the client file by configure(); nothing here is one client's table.
WS = TABLE = VIEW = None
F_BRAND = F_DOMAIN = F_CREATOR = F_PEOPLE = F_PROFILE = F_FINDYMAIL = F_VERIFY = None
WHY_COLUMN = "Why this person"
PICK_COLUMNS = {"person": "Person", "title": "Title", "why": WHY_COLUMN, "status": "Status", "contact": "Contact"}
ROWS_FILE = None

HERE = os.getcwd()
PARENTS = RUN_LOG = None

# Keywords that put a title on the buying side. Measured on one batch of four Vitamin Well
# people: only Scout's title carried one, and Jev agreed she was the partnership lead.
BUYER_WORDS = ("partnership", "influencer marketing", "influencer manager", "brand manager",
               "athlete marketing", "creator partnership", "social", "head of", "director")
PRODUCER_WORDS = ("content creator", "producer", "ugc", "host", "videographer")

# Jev's fit rubric, scored 0 to 2 per candidate.
FIT_LEVELS = ["No role in choosing or paying outside creators",
              "Marketing or social nearby, but not the creator budget owner",
              "Runs creator, influencer, athlete or ambassador partnerships"]
# A runner-up below this is not worth a second Findymail spend. Gymshark, 2026-10-16: at 1.0
# Nona Bayat (0.76) was skipped after the first pick's email was off-domain, though she would
# have cleared the pick floor. Retry and pick now share one floor (defined below).
RETRY_MIN_FIT = 0.5
# Under this nobody gets an email lookup. Guessed: the Vitamin Well sales manager scored 0.13
# and the Celsius "Mentor" 0.03, while Alex McCullough (Social Media + Community) scored 0.92.
MIN_PICK_FIT = 0.5
# The engine's background read refuses a row over 20,000 chars. Full profiles ran 5,000 to
# 25,000 a person (Celsius at limit 2 was 49,826, unreadable). With identifiers_only on the
# people column, Celsius at limit 3 was 2,164 for the whole row, so 10 fits with room.
MAX_SAFE_LIMIT = 10


CREATOR = CLIENT_VIEW = None
CLIENT_FILE = os.environ.get("BRAND_BUYER_CLIENT")
# Column roles, found by name, so a new client's table needs only a client file, not field ids.
ROLES = {"brand": "F_BRAND", "domain": "F_DOMAIN", "creator": "F_CREATOR", "people": "F_PEOPLE",
         "profile": "F_PROFILE", "findymail": "F_FINDYMAIL", "verify": "F_VERIFY"}
# The people-search settings that found buyers on 2026-10-16 (Gymshark, Celsius, Barebells).
PEOPLE_SEARCH = {
    "keywords": "influencer marketing, partnership, creator marketing, social media manager, brand manager, "
                "community manager, marketing manager",
    "excludes": "strategic, wallet, merchant, sales, engineer, payments, ambassador, athlete, content creator, model",
    "limit": 5,
    "identifiers_only": True,
}


class ClayFailed(SystemExit):
    pass


def configure(cfg, strict=True):
    """Point the chain at one client's table: ids, views, creator, parents, people search."""
    global WS, TABLE, VIEW, CLIENT_VIEW, CREATOR, PARENTS, RUN_LOG, ROWS_FILE, PEOPLE_SEARCH
    WS, TABLE = str(cfg.get("ws", WS)), cfg.get("table", TABLE)
    VIEW = cfg.get("view", VIEW)
    CLIENT_VIEW = cfg.get("client_view") or cfg.get("view") or CLIENT_VIEW
    CREATOR = cfg.get("creator", CREATOR)
    base = os.path.dirname(os.path.abspath(cfg["_path"])) if cfg.get("_path") else HERE
    here = lambda key, default: os.path.join(base, os.path.expanduser(cfg.get(key, default)))
    PARENTS, RUN_LOG, ROWS_FILE = here("parents", "parents.json"), here("run_log", "runs.jsonl"), here("rows", "rows.json")
    PEOPLE_SEARCH = {**PEOPLE_SEARCH, **cfg.get("people_search", {})}
    # The client file is shared with other Sabo tools (watcher, ledger), so it can name
    # columns this chain never reads; only the roles below are looked up.
    names = {role: name for role, name in (cfg.get("columns") or {}).items() if role in ROLES}
    if names:
        by_name = {c.get("name"): c["id"] for c in columns()}
        missing = [n for n in names.values() if n not in by_name]
        if missing and strict:
            raise ClayFailed(f"client table {TABLE} has no column named {missing}; run --setup or fix client.json")
        for role, name in names.items():
            if name in by_name:
                globals()[ROLES[role]] = by_name[name]
    parent_domains.__defaults__ = (PARENTS,)


CLIENTS_DIR = os.path.expanduser("~/.chewbacca/gtm/clients")


def load_client(path):
    """A client file path, or a client slug like "sabo" for ~/.chewbacca/gtm/clients/sabo.json."""
    if path and os.sep not in path and not path.endswith(".json"):
        path = os.path.join(CLIENTS_DIR, path + ".json")
    if not path or not os.path.exists(path):
        return None
    with open(path) as f:
        cfg = json.load(f)
    cfg["_path"] = path
    return cfg


def clay(op, live, **kw):
    args = ["chewbacca", "clay", op] + [f"{k}={v}" for k, v in kw.items()]
    if op in ("add-rows", "update-rows", "run-cells", "update-column", "add-column", "delete-rows",
              "view-columns", "view-sort", "view-filter"):
        args.append("--allow-writes" if live else "--dry-run")
    started = time.time()
    out = subprocess.run(args, capture_output=True, text=True, timeout=120)
    receipt = json.loads(out.stdout or "{}")
    receipt["_ms"] = round((time.time() - started) * 1000)
    if not receipt.get("ok", False) and live:
        if receipt.get("class") == "incomplete":
            raise ClayFailed(f"{op} hit the 20,000-char read cap ({receipt.get('truncated')}); "
                             "rerun with a lower --people-limit")
        raise ClayFailed(f"{op} failed: {out.stdout or out.stderr}")
    return receipt


def read_row(row):
    return clay("row", True, ws=WS, table=TABLE, row=row).get("data") or {}


def run_and_wait(cell, row, timeout=180):
    """Run one cell and wait for a result from THIS run, never the old one still on the row.

    Strava rerun, 2026-10-16: the previous success cell stayed readable for a moment after
    run-cells, so a plain status poll returned stale people. A result counts only after the
    cell was seen running or the row's updatedAt moved past what it was before the run.
    """
    stamp = read_row(row).get("updatedAt")
    clay("run-cells", True, ws=WS, table=TABLE, fields=cell, rows=row)
    # Clay's people search took under a minute on the proof rows; 180s is a ceiling, guessed.
    deadline, seen_running = time.time() + timeout, False
    while time.time() < deadline:
        data = read_row(row)
        state = data.get("cells", {}).get(cell, {})
        status = state.get("status")
        if status in ("running", "queued"):
            seen_running = True
        elif status in ("success", "error") and (seen_running or data.get("updatedAt") != stamp):
            return state, len(json.dumps(data))
        time.sleep(4)
    raise ClayFailed(f"timed out waiting on {cell}")


def find_row(brand, domain):
    """The newest row whose Brand and Brand Domain match, paging the table in insertion order."""
    found, after = None, None
    for _ in range(80):  # 100 rows overflowed the 20k-char cap at row 13; 8 a page, 397 rows needs 50 pages
        kw = {"ws": WS, "table": TABLE, "view": VIEW, "limit": 8}
        if after:
            kw["after"] = after
        page = clay("rows", True, **kw).get("data") or []
        rows = page if isinstance(page, list) else page.get("results") or page.get("rows") or []
        if not rows:
            break
        for r in rows:
            cells = r.get("cells", {})
            if (cells.get(F_BRAND, {}).get("value") == brand
                    and cells.get(F_DOMAIN, {}).get("value") == domain):
                found = r.get("id")
        after = rows[-1].get("id")
    return found


# ── parent fallback ──────────────────────────────────────────────────────────

def _norm(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def parent_domains(brand, tried, path=PARENTS):
    """Domains parents.json names for this brand, in its order, minus the ones already tried.

    search_domain is free text ("liquid-iv.com, fallback unilever.com"), so this pulls every
    domain-shaped token out of it rather than trusting one value.
    """
    try:
        with open(path) as f:
            entries = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    want = _norm(brand)
    for entry in entries:
        name = _norm(entry.get("brand"))
        if name and (want == name or want.startswith(name)):
            found = re.findall(r"\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b", (entry.get("search_domain") or "").lower())
            seen = {d.lower() for d in tried}
            out = []
            for d in found:
                if d not in seen:
                    seen.add(d)
                    out.append(d)
            return out
    return []


# ── ranking ──────────────────────────────────────────────────────────────────

def keyword_score(person):
    title = (person.get("title") or "").lower()
    return sum(w in title for w in BUYER_WORDS) - 2 * sum(w in title for w in PRODUCER_WORDS)


def remit(person):
    """Title plus headline and the start of the summary: what the person says they own."""
    parts = [person.get("title"), person.get("headline"), (person.get("summary") or "")[:300]]
    return " | ".join(p.strip() for p in parts if p and p.strip())


def jev_rank(people):
    """Score each candidate 0 to 2 on title and remit with one Jev call.

    Returns (ranked indexes best first, scores, buyer_gate) where buyer_gate is False when
    Jev's choice question answered "none". Returns (None, None, raw) when Jev failed.
    """
    request = {
        "state": "\n".join(f"{i}: {p.get('name')}: {remit(p)}" for i, p in enumerate(people)),
        "questions": {
            "buyer": {
                "type": "choice",
                "instructions": "Which numbered person most likely decides which outside creators a brand pays?",
                "criteria": {str(i): f"{p.get('name')}" for i, p in enumerate(people)} | {"none": "No one listed"},
            },
        } | {f"fit_{i}": {
            "type": "score",
            # Gymshark, 2026-10-16: a "Social Media Ambassador" ranked first twice. Ambassadors,
            # athletes and creators are who the brand pays, not who decides the paying.
            "instructions": f"Person {i}, {p.get('name')}: how directly do their title and stated remit "
                            "own choosing and paying outside creators for this brand? Someone the brand "
                            "pays (an ambassador, athlete, creator or affiliate) scores the lowest level.",
            "criteria": FIT_LEVELS,
        } for i, p in enumerate(people)},
    }
    out = subprocess.run(["chewbacca", "jev", "evaluate", "-"], input=json.dumps(request),
                         capture_output=True, text=True, timeout=60)
    try:
        answers = json.loads(out.stdout)["answers"]
        scores = [float(answers[f"fit_{i}"]["score"]) for i in range(len(people))]
        gate = answers["buyer"]["choice"] != "none"
    except (json.JSONDecodeError, KeyError, TypeError, ValueError, AttributeError):
        return None, None, out.stdout[:300]
    ranked = sorted(range(len(people)), key=lambda i: (-scores[i], -keyword_score(people[i])))
    return ranked, scores, gate


def why_sentence(people, ranked, scores, pick, domain, brand_domain, first_try=None):
    p = people[pick]
    where = domain if domain == brand_domain else f"parent {domain}, after {brand_domain} returned no one"
    # Celsius, 2026-10-16: after a retry the sentence said Ava was "ahead of Brenna Tanner at 2.0",
    # the person who outscored her. The first try is named in the retry clause, not as beaten.
    skipped = first_try[0] if first_try is not None else None
    others = [i for i in ranked if i not in (pick, skipped)]
    if others:
        r = others[0]
        vs = f", ahead of {people[r].get('name')} at {scores[r]:.1f}"
    else:
        vs = ", the only candidate the search returned"
    retry = ""
    if first_try is not None:
        who, problem = first_try
        what = {"invalid": "'s email came back invalid", "no email": " had no email Findymail could find",
                "catch-all": "'s email was catch-all, not verified"}.get(
            problem, f"'s email was at {problem.split()[-1]}, not the brand")
        retry = f", picked after {people[who].get('name')}{what}"
    return (f"{p.get('name')} ({p.get('title') or 'no title listed'}) at {where}: Jev rated the title "
            f"and stated remit {scores[pick]:.1f} of 2 for owning creator partnerships{vs}{retry}.")


# ── column setup ─────────────────────────────────────────────────────────────

def columns():
    return clay("columns", True, table=TABLE).get("data") or []


def ensure_column(name, live):
    for c in columns():
        if c.get("name") == name:
            return c["id"]
    receipt = clay("add-column", live, ws=WS, table=TABLE, name=name, data_type="text", view=VIEW)
    if not live:
        return None
    for c in columns():
        if c.get("name") == name:
            return c["id"]
    raise ClayFailed(f"added {name!r} but cannot find it: {json.dumps(receipt)[:400]}")


def ensure_why_column(live):
    return ensure_column(WHY_COLUMN, live)


def ensure_pick_columns(live):
    """Person, Title and Why: what Sabo reads. Caleb, 2026-10-16, on the table: "We're not as
    goated as we pitched yet". The email showed and the person it belonged to did not."""
    return {key: ensure_column(name, live) for key, name in PICK_COLUMNS.items()}


def people_limit_binding(cols=None):
    col = next(c for c in (cols or columns()) if c["id"] == F_PEOPLE)
    return col, next((b for b in col["typeSettings"]["inputsBinding"] if b["name"] == "limit"), None)


def set_people_limit(limit, live):
    if not 1 <= limit <= MAX_SAFE_LIMIT:
        raise ClayFailed(f"--people-limit {limit} is outside 1..{MAX_SAFE_LIMIT} (the 20,000-char read cap)")
    col, binding = people_limit_binding()
    current = json.loads(binding["formulaText"]) if binding and binding.get("formulaText") else None
    if str(current) == str(limit):
        return current
    binding["formulaText"] = json.dumps(str(limit))
    clay("update-column", live, ws=WS, table=TABLE, field=F_PEOPLE,
         update=json.dumps({"typeSettings": col["typeSettings"]}))
    return limit


def setup(live, hide=()):
    """Make a client table ready: people search settings, pick columns, the client view.

    Each setting here was paid for on 2026-10-16: identifiers_only beat the 20k read cap,
    buyer keywords stopped the search returning athletes and ambassadors, and Sabo's table
    showed emails with no name or reason next to them.
    """
    col = next(c for c in columns() if c["id"] == F_PEOPLE)
    ps = PEOPLE_SEARCH
    want = {"job_title_keywords": json.dumps(ps["keywords"]), "job_title_exclude_keywords": json.dumps(ps["excludes"]),
            "limit": json.dumps(str(ps["limit"])), "identifiers_only": "true" if ps["identifiers_only"] else None}
    for b in col["typeSettings"]["inputsBinding"]:
        if b["name"] in want:
            if want[b["name"]] is None:
                b.pop("formulaText", None)
            else:
                b["formulaText"] = want[b["name"]]
    clay("update-column", live, ws=WS, table=TABLE, field=F_PEOPLE, update=json.dumps({"typeSettings": col["typeSettings"]}))
    cols = ensure_pick_columns(live)
    names = {c.get("name"): c["id"] for c in columns()}
    vis = {names[n]: {"isVisible": False} for n in hide if n in names}
    vis.update({fid: {"isVisible": True} for fid in cols.values() if fid})
    clay("view-columns", live, ws=WS, table=TABLE, view=CLIENT_VIEW, columns=json.dumps(vis))
    return {"people_search": want, "columns": cols, "hidden": [n for n in hide if n in names]}


# ── the chain ────────────────────────────────────────────────────────────────

def emit(log):
    print(json.dumps(log, indent=1))
    if log.get("live"):
        with open(RUN_LOG, "a") as f:
            f.write(json.dumps(log) + "\n")


def search_people(row, domain, log):
    state, size = run_and_wait(F_PEOPLE, row)
    people = (state.get("fields") or {}).get("people", [])
    log["steps"].append({"step": "Clay people search", "domain": domain, "found": len(people), "row_chars": size})
    return people


def email_for(row, person, log):
    url = person.get("url") or person.get("profile_url") or person.get("profile")
    clay("update-rows", True, ws=WS, table=TABLE, records=json.dumps([{"id": row, "cells": {F_PROFILE: url}}]))
    email = (run_and_wait(F_FINDYMAIL, row)[0].get("fields") or {}).get("email")
    verdict = None
    if email:
        verdict = (run_and_wait(F_VERIFY, row)[0].get("fields") or {}).get("status")
    log["steps"].append({"step": "email", "person": person.get("name"), "email": email, "zerobounce": verdict})
    return url, email, verdict


def email_problem(email, verdict, allowed):
    """None when the email is usable, else "invalid" or "off-domain <domain>".

    Gymshark, 2026-10-16: the gymshark.com search returned Ryan Shaw, a Social Media
    Ambassador, and Findymail gave ryan@buckedup.com, which ZeroBounce called valid. A valid
    mailbox at another company is the wrong person, so it retries like an invalid one.
    """
    if verdict == "invalid":
        return "invalid"
    # Celsius, 2026-10-16: Brenna Tanner scored 2.0 and Findymail had no email for her, which
    # left a 1.55 runner-up untried. No email is a dead end, so it retries too.
    if not email or "@" not in email:
        return "no email"
    at = email.rsplit("@", 1)[1].lower()
    brand, *parents = [d for d in allowed if d] or [""]
    if not any(same_org(at, d) for d in (brand, *parents)):
        return f"off-domain {at}"
    # Caleb, 2026-10-16 ("do wtv is best"): a catch-all or unknown verdict is not verified. Sabo
    # worries about sending too many emails, and a bounce from his domain costs more than one
    # missing contact. The same oracle grades the GTME lesson ledger, so the two can't drift.
    counts, _ = verified_email(at, verdict, brand, parents)
    return None if counts else "catch-all"


def status_for(email, problem, why):
    """Ready only with a usable email at the brand or parent and a reason; else Needs work: why."""
    if email and not problem and why:
        return "Ready"
    if problem == "catch-all":
        return "catch-all, unverified, send after the valid ones"
    return f"Needs work: {problem or 'no email'}"


def contact_line(name, title, email, why):
    """The one column Sabo reads, the way a waterfall collapses into one email."""
    return f"{name}, {title or 'no title listed'}, {email or 'no email'}. {why}"


# Caleb, 2026-10-16: "We're not as goated as we pitched yet". The table held 3 Barebells, 3 Celsius,
# 2 Gymshark and 2 Klarna rows, because every run added a row. A brand now reuses its row.
def load_rows(path=None):
    try:
        with open(path or ROWS_FILE) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_row(brand, row, path=None):
    rows = load_rows(path)
    rows[_norm(brand)] = row
    with open(path or ROWS_FILE, "w") as f:
        json.dump(rows, f, indent=1, sort_keys=True)


def finish(brand_domain, row, log, t0, before, cols):
    domain = brand_domain
    people = search_people(row, domain, log)
    if not people:
        for parent in parent_domains(log["brand"], [brand_domain]):
            # Barebells, 2026-10-16: barebells.com returned 0 and the parent row was added by
            # hand. The chain now points the same row at the parent domain and searches again.
            log["steps"].append({"step": "parent fallback", "from": domain, "to": parent})
            print(f"fallback: {domain} returned no one, trying parent {parent}", file=sys.stderr, flush=True)
            clay("update-rows", True, ws=WS, table=TABLE,
                 records=json.dumps([{"id": row, "cells": {F_DOMAIN: parent}}]))
            domain = parent
            people = search_people(row, domain, log)
            if people:
                break
    if not people:
        log["result"] = {"person": None, "row": row,
                         "reason": f"no people at {brand_domain} or any parent domain on file"}
        return done(log, before, t0, cols)

    ranked, scores, gate = jev_rank(people)
    if ranked is None:
        log["result"] = {"person": None, "row": row, "reason": f"Jev did not answer: {gate}"}
        return done(log, before, t0, cols)
    log["steps"].append({"step": "rank", "scores": {people[i].get("name"): round(scores[i], 2) for i in ranked},
                         "buyer_gate": gate})
    # ASICS, 2026-10-16: Jev answered "none" for a real estate agent the search tied to asics.com,
    # the keyword fallback ran Findymail anyway and ZeroBounce said invalid. Jev's "none" stops.
    # Celsius, 2026-10-16: three people scored 0.03, 0.02 and 0.01, Jev's choice still named one,
    # and Findymail ran on a "Mentor". The top score has to clear a floor too.
    if gate and scores[ranked[0]] < MIN_PICK_FIT:
        gate = False
        log["steps"].append({"step": "gate", "why": f"top fit {scores[ranked[0]]:.2f} under {MIN_PICK_FIT}"})
    if not gate:
        log["result"] = {"person": None, "row": row, "reason": "Jev found no creator buyer; no email spend",
                         "candidates": [(p.get("name"), p.get("title")) for p in people]}
        return done(log, before, t0, cols)

    allowed = [brand_domain, domain] + parent_domains(log["brand"], [])
    pick, first_try = ranked[0], None
    url, email, verdict = email_for(row, people[pick], log)
    problem = email_problem(email, verdict, allowed)
    if problem:
        runner = next((i for i in ranked[1:] if scores[i] >= RETRY_MIN_FIT), None)
        if runner is None:
            log["steps"].append({"step": "retry", "why": problem,
                                 "skipped": f"no runner-up scored {RETRY_MIN_FIT} or more"})
        else:
            # ASICS, 2026-10-16: an invalid verdict ended the chain. One retry on the next-ranked
            # person, then stop, so a bad domain costs at most two Findymail runs.
            log["steps"].append({"step": "retry", "why": problem, "from": people[pick].get("name"),
                                 "to": people[runner].get("name")})
            first = (pick, url, email, verdict, problem)
            first_try, pick = (pick, problem), runner
            url, email, verdict = email_for(row, people[pick], log)
            problem = email_problem(email, verdict, allowed)
            if first[4] == "catch-all" and problem:
                # A catch-all at the brand beats a runner-up with nothing usable. The Contact
                # column carries it; the Email column still shows the runner-up's lookup.
                pick, url, email, verdict, problem = first
                first_try = None
                log["steps"].append({"step": "kept catch-all", "person": people[pick].get("name")})

    why = why_sentence(people, ranked, scores, pick, domain, brand_domain, first_try)
    if problem == "invalid":
        why = why[:-1] + "; this email is also invalid, so the chain stopped."
    elif problem == "no email":
        why = why[:-1] + "; Findymail found no email."
    elif problem == "catch-all":
        why = why[:-1] + f"; ZeroBounce called {email} {verdict or 'unknown'}, so send it after the valid ones."
    elif problem:
        why = why[:-1] + f"; this email is at {email.split('@')[-1]}, not the brand, so do not use it."
    name, title = people[pick].get("name"), people[pick].get("title")
    cells = {cols.get("why"): why, cols.get("person"): name, cols.get("title"): title,
             cols.get("status"): status_for(email, problem, why),
             cols.get("contact"): contact_line(name, title, email, why)}
    cells = {k: v for k, v in cells.items() if k}
    if cells:
        clay("update-rows", True, ws=WS, table=TABLE, records=json.dumps([{"id": row, "cells": cells}]))
    log["result"] = {"person": people[pick].get("name"), "title": people[pick].get("title"), "profile": url,
                     "email": email, "zerobounce": verdict, "domain": domain, "row": row, "why": why}
    return done(log, before, t0)


def done(log, before, t0, cols=None):
    result = log.get("result") or {}
    why_field = (cols or {}).get("why")
    if why_field and result.get("person") is None and result.get("row"):
        # Celsius, 2026-10-16: Jev stopped on a "Mentor" and the row said nothing about why.
        seen = ", ".join(f"{n} ({t or 'no title'})" for n, t in result.get("candidates") or [])
        why = f"No one picked: {result['reason']}" + (f"; the search returned {seen}." if seen else ".")
        cells = {why_field: why, (cols or {}).get("status"): f"Needs work: {result['reason']}"}
        clay("update-rows", True, ws=WS, table=TABLE,
             records=json.dumps([{"id": result["row"], "cells": {k: v for k, v in cells.items() if k}}]))
    after = clay("credits", True).get("data", {}).get("balance")
    log["credits_observed"] = round(before - after, 2) if before is not None and after is not None else None
    log["seconds"] = round(time.time() - t0)
    emit(log)
    return log


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("brand", nargs="?")
    ap.add_argument("domain", nargs="?", help="the brand's own domain; the chain falls back to parents.json")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--client", default=CLIENT_FILE, help="client slug (sabo) or client.json: table, columns by name, creator, parents")
    ap.add_argument("--setup", action="store_true", help="set up the client table, then stop")
    ap.add_argument("--row", help="rerun on this row (default: the brand's row in rows.json)")
    ap.add_argument("--new-row", action="store_true", help="add a fresh row even if the brand has one")
    ap.add_argument("--people-limit", type=int, help=f"set the people-search cap first (1..{MAX_SAFE_LIMIT})")
    a = ap.parse_args(argv)
    cfg = load_client(a.client)
    if not cfg:
        ap.error("--client <slug or client.json> is required (or set BRAND_BUYER_CLIENT); slugs live in ~/.chewbacca/gtm/clients")
    configure(cfg, strict=not a.setup)
    if a.setup:
        out = setup(a.live, hide=(cfg or {}).get("hide", ()))
        print(json.dumps(out, indent=1))
        return out
    if not (a.brand and a.domain):
        ap.error("brand and domain are required unless --setup")
    log = {"brand": a.brand, "domain": a.domain, "live": a.live, "steps": [],
           "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    t0 = time.time()
    before = clay("credits", True).get("data", {}).get("balance")
    if a.people_limit:
        log["people_limit"] = set_people_limit(a.people_limit, a.live)
    else:
        binding = people_limit_binding()[1]
        log["people_limit"] = json.loads(binding["formulaText"]) if binding and binding.get("formulaText") else None
    cols = ensure_pick_columns(a.live)
    row = a.row or (None if a.new_row else load_rows().get(_norm(a.brand)))
    if row:
        log["steps"].append({"step": "reuse row", "row": row})
    if row and a.live:
        return finish(a.domain, row, log, t0, before, cols)

    added = clay("add-rows", a.live, ws=WS, table=TABLE, records=json.dumps(
        [{F_BRAND: a.brand, F_DOMAIN: a.domain, F_CREATOR: CREATOR}]))
    log["steps"].append({"step": "add row", "ms": added["_ms"]})
    if not a.live:
        print(json.dumps({"dry_run": added, "people_limit": log["people_limit"],
                          "pick_columns": {k: v or f"would add {PICK_COLUMNS[k]!r}" for k, v in cols.items()},
                          "parent_fallback": parent_domains(a.brand, [a.domain]) or "none on file",
                          "next": ["people search", "parent fallback if 0", "Jev rank", "find email",
                                   "verify", "retry runner-up once if invalid", "write why"]}, indent=1))
        return log
    # listRowsAfter stopped after 10 of 397 rows on 2026-10-16, so take the id from the add response.
    ids = re.findall(r'"(r_[0-9A-Za-z]{15,})"', json.dumps(added.get("data")))
    row = ids[0] if len(set(ids)) == 1 else None
    if not row:
        raise ClayFailed(f"added, but could not find the new row: {json.dumps(added)[:600]}")
    print(f"row {row}", file=sys.stderr, flush=True)
    save_row(a.brand, row)
    return finish(a.domain, row, log, t0, before, cols)


if __name__ == "__main__":
    main()
