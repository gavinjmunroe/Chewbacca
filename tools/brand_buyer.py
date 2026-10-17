"""One brand in, one verified creator-partnerships contact out, through a client's Clay table.

Usage: python3 tools/brand_buyer.py --client <client.json> --setup [--live]
       python3 tools/brand_buyer.py --client <client.json> "<Brand>" <domain> [--live]
The client file names the table, its columns, the creator and the parents file; see
library/gtm/brand-buyer/client.example.json. Nothing in this file names a client.

Chewbacca picks the domain to search, Clay's native people search finds candidates, and when
the brand domain has nobody, gtme next-move (tools/next_move.py) reads the brand's own site,
derives the companies it names as owner or links to, and reruns the search on the one Jev rates
most likely, with no lookup table. Jev scores
every candidate on title and remit, the top one goes to Findymail and ZeroBounce, and an invalid
email gets one retry on the runner-up. The pick and a one-sentence reason land in the
"Why this person" column. Every write and paid run goes through `chewbacca clay`, which keeps
its own approval gate.

Dry run is the default: it prints each request and spends nothing. Pass --live to execute.

Every data step (people search, find email, verify) goes through the provider the client file
names, Clay by default; see tools/creator_gtm/provider.py. Each pick lands first in the client's
record file ("records" in the client file), and the Clay table is written from it as a view.
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
import next_move  # noqa: E402
from creator_gtm import provider as gtm_provider  # noqa: E402

# Set from the client file by configure(); nothing here is one client's table.
WS = TABLE = VIEW = None
F_BRAND = F_DOMAIN = F_CREATOR = F_PEOPLE = F_PROFILE = F_FINDYMAIL = F_VERIFY = None
WHY_COLUMN = "Why this person"
# The columns the chain writes, by role. A client file's "columns" block can rename any of them
# (the same roles deliver.py reads), so a table whose pick column is "Decision maker" works.
DEFAULT_PICK_COLUMNS = {"person": "Person", "title": "Title", "why": WHY_COLUMN, "status": "Status",
                        "contact": "Contact"}
PICK_COLUMNS = dict(DEFAULT_PICK_COLUMNS)
# The status a usable pick gets; deliver.py records rows carrying it. The client file's "ready_value".
READY = "Ready"
CLIENT_SLUG = None
ROWS_FILE = None
# The data provider (clay, treg, ...) and the canonical record file, both from the client file.
PROVIDER = RECORDS_FILE = None

HERE = os.getcwd()
RUN_LOG = None
BLOCKERS_FILE = None
# Seams for the blocked-search loop, swapped in tests: the site reader, Jev (None is live Jev),
# and the lesson ledger the loop records org hops into (None is team/gtme-lessons).
SITE_READ = next_move.read_site
NEXT_MOVE_JEV = None
NEXT_MOVE_LEDGER = None
# Moves the loop may run inside one brand's chain: one free read and up to three reruns.
NEXT_MOVE_STEPS = 4

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
    global WS, TABLE, VIEW, CLIENT_VIEW, CREATOR, RUN_LOG, ROWS_FILE, PEOPLE_SEARCH, PROVIDER, RECORDS_FILE, BLOCKERS_FILE
    global PICK_COLUMNS, WHY_COLUMN, READY, CLIENT_SLUG, PARENT_DOMAINS
    PROVIDER = gtm_provider.for_client(cfg, chain=sys.modules[__name__])
    WS, TABLE = str(cfg.get("ws", WS)), cfg.get("table", TABLE)
    VIEW = cfg.get("view", VIEW)
    CLIENT_VIEW = cfg.get("client_view") or cfg.get("view") or CLIENT_VIEW
    CREATOR = cfg.get("creator", CREATOR)
    base = os.path.dirname(os.path.abspath(cfg["_path"])) if cfg.get("_path") else HERE
    here = lambda key, default: os.path.join(base, os.path.expanduser(cfg.get(key, default)))
    CLIENT_SLUG = cfg.get("client_slug") or CLIENT_SLUG
    slug = CLIENT_SLUG or "client"
    # Per-client defaults: two client files in ~/.chewbacca/gtm/clients must not share a rows
    # file, or one client's brand row gets reused for the other's table.
    RUN_LOG, ROWS_FILE = here("run_log", f"{slug}.runs.jsonl"), here("rows", f"{slug}.rows.json")
    BLOCKERS_FILE = here("blockers", f"{slug}.blockers.jsonl")
    RECORDS_FILE = here("records", f"{slug}.records.json")
    PEOPLE_SEARCH = {**PEOPLE_SEARCH, **cfg.get("people_search", {})}
    PARENT_DOMAINS = verified_parents(here("parents", "")) if cfg.get("parents") else {}
    READY = cfg.get("ready_value") or READY
    given = cfg.get("columns") or {}
    PICK_COLUMNS = {role: given.get(role, name) for role, name in DEFAULT_PICK_COLUMNS.items()}
    WHY_COLUMN = PICK_COLUMNS["why"]
    # The client file is shared with the other client tools (spend_now, deliver, follow_buyers),
    # so it can name columns this chain never reads; only the roles below are looked up.
    names = {role: name for role, name in given.items() if role in ROLES}
    if names and PROVIDER.has_table:
        by_name = {c.get("name"): c["id"] for c in columns()}
        missing = [n for n in names.values() if n not in by_name]
        if missing and strict:
            raise ClayFailed(f"client table {TABLE} has no column named {missing}; run --setup or fix client.json")
        for role, name in names.items():
            if name in by_name:
                globals()[ROLES[role]] = by_name[name]


PARENT_DOMAINS = {}


# C4 Energy and Hoka, 2026-10-17: the search at c4energy.com and hoka.com returned staff who
# list their parent, and their valid @nutrabolt.com and @deckers.com addresses landed as
# "off-domain", though parents.json had both owners verified with a source link. A parent counts
# only when its row is "verified" and cites a source, the same bar as the security review's
# ownership sentence plus a link; an unverified guess stays off the allowlist.
def verified_parents(path):
    try:
        with open(os.path.expanduser(path)) as f:
            rows = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    out = {}
    for r in rows if isinstance(rows, list) else []:
        if r.get("parent_status") != "verified" or not r.get("parent_source_url"):
            continue
        domains = re.findall(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", (r.get("search_domain") or "").lower())
        if domains:
            out[_norm(r.get("brand"))] = domains
    return out


CLIENTS_DIR = os.path.expanduser("~/.chewbacca/gtm/clients")


def load_client(path):
    """A client file path, or a client slug like "acme" for ~/.chewbacca/gtm/clients/acme.json."""
    if path and os.sep not in path and not path.endswith(".json"):
        path = os.path.join(CLIENTS_DIR, path + ".json")
    if not path or not os.path.exists(path):
        return None
    with open(path) as f:
        cfg = json.load(f)
    cfg["_path"] = path
    return cfg


def prov():
    """The configured provider; Clay when no client file set one (the tests' fake Clay path)."""
    global PROVIDER
    if PROVIDER is None:
        PROVIDER = gtm_provider.ClayProvider(sys.modules[__name__])
    return PROVIDER


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


# ── blocked search ───────────────────────────────────────────────────────────

# Barebells, 2026-10-16: barebells.com returned 0 and the parent came from a parents.json row
# filled by hand after the miss, so nothing reasoned. Now the loop reads the brand's own site
# ("Barebells is part of Vitamin Well Group", linking career.vitaminwell.com), proposes every
# related domain plus the other moves, drops what breaks a boundary, and Jev ranks the rest.
def _norm(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def blocked_search(brand, brand_domain, row, log):
    """Run gtme next-move on an empty people search. Returns (people, domain, hops, trusted).

    trusted is True only when the brand's own site says it is part of that company and links
    its domain. Any weaker tie (a guessed name.com, a bare link, an email domain) still gets
    searched, but its emails stay off the allowlist, so the row lands as Needs work.
    """
    found = {"people": [], "domain": brand_domain, "trusted": False}
    hops = []

    def read(move, blocker):
        try:
            ev = SITE_READ(brand_domain)
        except Exception as e:
            return {"cleared": False, "credits": 0.0, "evidence": {"error": f"site read failed: {e}"}}
        return {"cleared": False, "credits": 0.0, "evidence": ev}

    def hop(move, blocker):
        domain = move["target"]
        log["steps"].append({"step": "parent fallback", "from": found["domain"], "to": domain,
                             "why": move["why"][:300]})
        print(f"next move: {brand_domain} returned no one, trying {domain}", file=sys.stderr, flush=True)
        people = search_people(row, domain, log)
        hops.append(domain)
        if people:
            found.update(people=people, domain=domain, trusted=move.get("trust") == "owned_and_linked")
        return {"cleared": bool(people), "credits": 0.5}

    blocker = {"client": CLIENT_SLUG or CREATOR or "brand-buyer", "step": "people_search",
               "goal": f"the person who decides which outside creators {brand} pays, with a verified email "
                       f"at {brand} or its parent",
               "persona": [k.strip() for k in PEOPLE_SEARCH.get("keywords", "").split(",") if k.strip()],
               "account": {"brand": brand, "domain": brand_domain},
               "failure": f"Clay people search returned 0 people at {brand_domain}",
               "evidence": {"filters": {"limit": PEOPLE_SEARCH.get("limit")}, "people": []},
               "tried": [f"org_hop:{brand_domain}"]}
    res = next_move.run(blocker, {"read_source:site_read": read, "org_hop": hop}, evaluate=NEXT_MOVE_JEV,
                        max_steps=NEXT_MOVE_STEPS, ledger=NEXT_MOVE_LEDGER)
    log["steps"].append({"step": "next move", "decision": res["decision"],
                         "moves": [{"move": t["move"], "p": t["p"], "cleared": t["cleared"]} for t in res["trace"]],
                         "next": (res.get("next") or {}).get("signature")})
    return found["people"], found["domain"], hops, found["trusted"]


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
    """Person, Title and Why: what the client reads. Caleb, 2026-10-16, on the first client's
    table: "We're not as goated as we pitched yet". The email showed and the person it belonged
    to did not. Names come from PICK_COLUMNS, so the client file can rename them.
    A provider with no table has no view to set up; the record file holds everything."""
    if not prov().has_table:
        return {}
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
    buyer keywords stopped the search returning athletes and ambassadors, and the first client's table
    showed emails with no name or reason next to them.
    """
    if not prov().has_table:
        raise ClayFailed(f"--setup prepares a Clay table; the {prov().name} provider has none to set up")
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
    p = prov()
    people = p.people_search(row, domain, PEOPLE_SEARCH)
    log["steps"].append({"step": f"{p.label} people search", "domain": domain, "found": len(people),
                         **getattr(p, "last_meta", {})})
    return people


def email_for(row, person, log):
    url = person.get("url") or person.get("profile_url") or person.get("profile")
    email = prov().find_email(row, {**person, "url": url})
    verdict = prov().verify_email(row, email) if email else None
    log["steps"].append({"step": "email", "person": person.get("name"), "email": email, "zerobounce": verdict})
    return url, email, verdict


def show(row, cells):
    """Write role-keyed cells to the provider's view; empty ids (no table) are dropped."""
    cells = {k: v for k, v in cells.items() if k}
    if cells:
        prov().show(row, cells)


def save_record(brand, domain, result, costs=(), lane="brand buyer"):
    """The brand's contact, in the client's record file, before any view is written from it."""
    if not RECORDS_FILE:
        return None
    rec = {"brand": brand, "domain": domain, "creator": CREATOR, "lane": lane, "provider": prov().name,
           "view_row": result.get("row"), "contact": {k: result.get(k) for k in (
               "person", "title", "email", "zerobounce", "profile", "domain", "why", "status", "reason")},
           "candidates": result.get("team") or [], "last_costs": list(costs)}
    return gtm_provider.save_record(RECORDS_FILE, _norm(brand), rec)


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
    # Caleb, 2026-10-16 ("do wtv is best"): a catch-all or unknown verdict is not verified. The
    # first client worried about sending too many emails, and a bounce from his domain costs more than one
    # missing contact. The same oracle grades the GTME lesson ledger, so the two can't drift.
    counts, _ = verified_email(at, verdict, brand, parents)
    return None if counts else "catch-all"


def status_for(email, problem, why):
    """Ready only with a usable email at the brand or parent and a reason; else Needs work: why."""
    if email and not problem and why:
        return READY
    if problem == "catch-all":
        return "catch-all, unverified, send after the valid ones"
    return f"Needs work: {problem or 'no email'}"


def contact_line(name, title, email, why):
    """The one column the client reads, the way a waterfall collapses into one email."""
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
    domain, hops, trusted = brand_domain, [], True
    people = search_people(row, domain, log)
    if not people:
        people, domain, hops, trusted = blocked_search(log["brand"], brand_domain, row, log)
    log["team"] = [(p.get("name"), p.get("title")) for p in people]
    if not people:
        tried = ", ".join(hops) or "no related company in the evidence"
        log["result"] = {"person": None, "row": row,
                         "reason": f"no people at {brand_domain}; next-move tried {tried}"}
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

    # Security review, 2026-10-16: a hop domain from a bare link or a guessed name could put a
    # stranger's email on the allowlist. Only an ownership sentence plus a link earns it.
    allowed = [brand_domain] + ([domain] if trusted else []) + PARENT_DOMAINS.get(_norm(log["brand"]), [])
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
    log["result"] = {"person": people[pick].get("name"), "title": people[pick].get("title"), "profile": url,
                     "email": email, "zerobounce": verdict, "domain": domain, "row": row, "why": why,
                     "status": status_for(email, problem, why)}
    return done(log, before, t0, cols)


def view_cells(result, cols):
    """The view's cells, written from the record: a pick, or why there is none."""
    if result.get("person") is not None:
        name, title, why = result["person"], result.get("title"), result.get("why")
        return {cols.get("why"): why, cols.get("person"): name, cols.get("title"): title,
                cols.get("status"): result.get("status"),
                cols.get("contact"): contact_line(name, title, result.get("email"), why)}
    if not cols.get("why"):
        return {}
    # Celsius, 2026-10-16: Jev stopped on a "Mentor" and the row said nothing about why.
    seen = ", ".join(f"{n} ({t or 'no title'})" for n, t in result.get("candidates") or [])
    why = f"No one picked: {result['reason']}" + (f"; the search returned {seen}." if seen else ".")
    return {cols.get("why"): why, cols.get("status"): f"Needs work: {result['reason']}"}


def done(log, before, t0, cols=None):
    result = log.get("result") or {}
    if result.get("person") is None and result.get("reason"):
        result.setdefault("status", f"Needs work: {result['reason']}")
    costs = prov().drain_costs()
    save_record(log["brand"], log.get("domain"), {**result, "team": log.get("team")}, costs,
                lane=log.get("lane", "brand buyer"))
    if result.get("row"):
        show(result["row"], view_cells(result, cols or {}))
    after = prov().balance()
    log["credits_observed"] = round(before - after, 2) if before is not None and after is not None else None
    log["costs"], log["cost"] = costs, gtm_provider.cost_total(costs)
    log["provider"] = prov().name
    log["seconds"] = round(time.time() - t0)
    emit(log)
    return log


def goal_for(brand):
    return f"the person who decides which outside creators {brand} pays, with a verified email at {brand} or its parent"


def blocked(step, brand, domain, failure, evidence=None, credits_left=None, flags=None):
    """A blocked step's record and next-move's pick, appended to the client's blockers file."""
    return next_move.on_blocked(
        step, {"brand": brand, "domain": domain}, failure, client=CLIENT_SLUG or "brand-buyer", goal=goal_for(brand),
        persona=[k.strip() for k in PEOPLE_SEARCH.get("keywords", "").split(",") if k.strip()],
        evidence=evidence, credits_left=credits_left, log_path=BLOCKERS_FILE, evaluate=NEXT_MOVE_JEV, flags=flags)


def provider_block(exc):
    """(step, credits_left) when exc is a provider step that can't run, else None.

    NotWired is a step with no adapter yet; a refusal carrying BLOCKED from `chewbacca clay` is
    the credit allowance. Either way an empty result would lie, so the row says blocked and why.
    """
    if isinstance(exc, gtm_provider.NotWired):
        return "provider_unwired", None
    if isinstance(exc, ClayFailed) and "BLOCKED" in str(exc):
        return "credit_budget", 0.0
    return None


def guarded_finish(brand_domain, row, log, t0, before, cols):
    try:
        return finish(brand_domain, row, log, t0, before, cols)
    except (gtm_provider.NotWired, ClayFailed) as exc:
        kind = provider_block(exc)
        if kind is None:
            raise
        rec = blocked(kind[0], log["brand"], brand_domain, str(exc), credits_left=kind[1], flags=["provider_down"])
        log["steps"].append({"step": "next move", "decision": rec["decision"], "next": (rec["next"] or {}).get("signature")})
        log["result"] = {"person": None, "row": row, "reason": next_move.next_line(rec), "blocked": rec}
        return done(log, before, t0, cols)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("brand", nargs="?")
    ap.add_argument("domain", nargs="?", help="the brand's own domain; an empty search goes to gtme next-move")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--client", default=CLIENT_FILE, help="client slug or client.json: table, columns by name, creator")
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
    p = prov()
    log["provider"] = p.name
    before = p.balance()
    if not p.has_table:
        log["people_limit"] = PEOPLE_SEARCH.get("limit")
    elif a.people_limit:
        log["people_limit"] = set_people_limit(a.people_limit, a.live)
    else:
        binding = people_limit_binding()[1]
        log["people_limit"] = json.loads(binding["formulaText"]) if binding and binding.get("formulaText") else None
    cols = ensure_pick_columns(a.live)
    row = a.row or (None if a.new_row else load_rows().get(_norm(a.brand)))
    if row:
        log["steps"].append({"step": "reuse row", "row": row})
    if row and a.live:
        return guarded_finish(a.domain, row, log, t0, before, cols)

    opened = p.open_account(a.brand, a.domain, CREATOR, a.live)
    log["steps"].append({"step": "add row", "ms": opened["receipt"].get("_ms")})
    if not a.live:
        print(json.dumps({"dry_run": opened["receipt"], "provider": p.name, "people_limit": log["people_limit"],
                          "pick_columns": {k: v or f"would add {PICK_COLUMNS[k]!r}" for k, v in cols.items()},
                          "if_empty": "gtme next-move: read the brand's site, rerun on the related company Jev rates best",
                          "next": ["people search", "next-move if 0", "Jev rank", "find email",
                                   "verify", "retry runner-up once if invalid", "write why"]}, indent=1))
        return log
    row = opened["ref"]
    print(f"row {row}", file=sys.stderr, flush=True)
    save_row(a.brand, row)
    return guarded_finish(a.domain, row, log, t0, before, cols)


if __name__ == "__main__":
    main()
