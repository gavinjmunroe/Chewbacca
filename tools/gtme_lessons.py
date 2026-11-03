#!/usr/bin/env python3
"""gtme lesson: the GTM experiment ledger, and the lessons a new campaign starts from.

    chewbacca gtme lesson plan "what you're about to build" [--client X] [--exclude-client X]
                                [--stage S] [--limit N] [--json]
    chewbacca gtme lesson add FILE|-          validate one lesson and write it to the ledger
    chewbacca gtme lesson record ID --result TEXT --verdict V [--next TEXT] [--oracle JSON]
    chewbacca gtme lesson list [--client X] [--stage S] [--json]
    chewbacca gtme lesson show ID
    chewbacca gtme lesson audit [--json]      exit 1 on a bad lesson, a broken check, private data
    chewbacca gtme lesson oracles             every oracle, what it trusts and its floor
    chewbacca gtme lesson verified-email --email-domain D --status S --brand-domain B [--parent P ...]
    chewbacca gtme lesson template            a blank lesson to fill in

Built 2026-10-16 from REA's Touhou essays (docs/plans/GTME-MEMORY.md): the repo
is the working memory, oracles decide claims and are tested with cases they
must reject, and one client's lessons become checks the next client runs. The
ledger is team/gtme-lessons/, one JSON file per experiment, kept in git so every
tab and teammate reads the same one. Evidence is a path or a commit, never a
copy of client data. Retrieval is deterministic: no model, no network.
"""
import argparse
import datetime as dt
import json
import math
import os
import re
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
LEDGER = Path(os.environ.get("GTME_LESSONS_DIR", KIT / "team" / "gtme-lessons"))

STAGES = ("list", "enrich", "verify", "copy", "send", "deliverability", "reply", "meeting", "ops")
VERDICTS = ("pending", "observed", "inconclusive", "confirmed", "refuted")
# What a verdict is worth when ranking. A refuted lesson ranks with the wins:
# a failed variation tells the next agent what not to retry (REA keeps them on
# purpose). Pending has no result yet, so it ranks last. Guessed, never measured.
VERDICT_WEIGHT = {"confirmed": 1.0, "refuted": 0.95, "observed": 0.9, "inconclusive": 0.75, "pending": 0.5}

# Each oracle: kind, the sources it trusts, the sample floor for confirmed or
# refuted, and a version. Raise the version when the rules tighten, and every
# lesson judged under the old version shows REVISIT, the way REA re-audited
# 1,548 float references after the comparator learned to read constants.
#   outcome     a business result; can confirm or refute
#   mechanical  a deterministic property (a row size); one clean case can confirm
#   proxy       a score that predicts an outcome; never confirms or refutes alone
#   observation one case seen and written down (a read, a run log); can't confirm either
ORACLES = {
    "reply_rate": {
        "kind": "outcome", "version": 1, "units": ("people", "sends"),
        "sources": ("clay_campaign_stats", "gtm_funnel", "togari", "provider_api"),
        # demand-gen-playbooks.md: under 500 sends per arm is "don't know yet".
        "min_n": 500,
        "about": "replies over people or sends emailed; say which"},
    "positive_reply_rate": {
        "kind": "outcome", "version": 1, "units": ("people", "sends"),
        # Ruling 2026-10-05 (Caleb): never call a lead interested from a Clay
        # category. 73 of 87 Zeutara replies were read as cut-off HTML until
        # 65f7991d, so a category built on them was a guess.
        "sources": ("reply_text", "togari_reply_kind", "gtme_reply_intent"),
        "refuse_sources": ("clay_category", "reply_category", "snippet"),
        "min_n": 500,
        "about": "replies a person or gtme-reply read as positive, from the whole reply text"},
    "bounce_rate": {
        "kind": "outcome", "version": 1, "units": ("sends",),
        "sources": ("clay_campaign_stats", "gtm_funnel", "provider_api", "togari"),
        "min_n": 200,  # guessed, never measured: at 3% that's 6 bounces
        "about": "bounces over sends"},
    "verified_email_rate": {
        "kind": "outcome", "version": 1, "units": ("contacts",),
        "sources": ("zerobounce", "neverbounce", "findymail", "provider_api"),
        # Sabo 2026-10-16: ZeroBounce called an email at another company valid.
        # A verified email counts only after its domain matched the account.
        "requires": ("domain_checked",),
        "min_n": 20,  # guessed, never measured
        "about": "deliverable emails at the target account's own or parent domain, over contacts tried"},
    "buyer_hit_rate": {
        "kind": "outcome", "version": 1, "units": ("accounts",),
        "sources": ("human_review", "client_confirmed", "reply_text"),
        # A Jev pick named a Celsius "Mentor" scoring 0.03 of 2: the pick is a
        # proxy, a person or the reply decides whether it was the buyer.
        "refuse_sources": ("jev_choice", "title_match"),
        "min_n": 20,  # guessed, never measured
        "about": "accounts where the person found is the one who buys, over accounts searched"},
    "meetings": {
        "kind": "outcome", "version": 1, "units": ("people", "sends", "positive_replies"),
        # Zeutara 2026-10-11: 0 meetings on Google Calendar, but Jonah books his
        # own calls, so the zero was blindness, not a result.
        "sources": ("calendar", "booking_link", "client_confirmed"),
        "refuse_sources": ("inferred", "reply_category"),
        "min_n": 500,
        "about": "meetings booked over people emailed or positive replies"},
    "credits_per_verified": {
        "kind": "outcome", "version": 1, "units": ("verified",),
        "sources": ("credit_ledger", "clay_credits", "provider_invoice"),
        "refuse_units": ("attempted", "rows"),
        "min_n": 10,  # guessed, never measured
        "about": "credits spent over verified usable results, never over rows attempted"},
    "row_chars": {
        "kind": "mechanical", "version": 1, "units": ("rows",),
        "sources": ("clay_row_read", "provider_api"), "min_n": 1,
        "about": "characters in one stored row, against a read cap"},
    "grade_score": {
        "kind": "proxy", "version": 1, "units": ("drafts",), "sources": ("gtme_grade",), "min_n": 1,
        "about": "gtme-grade copy rubric; not validated against replies (Zeutara 2026-10-11)"},
    "spam_score": {
        "kind": "proxy", "version": 1, "units": ("drafts",), "sources": ("clay_spam_check",), "min_n": 1,
        "about": "the send platform's spam check"},
    "observation": {
        "kind": "observation", "version": 1, "units": ("cases",),
        "sources": ("ui_read", "api_read", "run_log", "human_review"), "min_n": 1,
        "about": "a specific case seen with evidence, with no rate behind it"},
    "fit_score": {
        "kind": "proxy", "version": 1, "units": ("contacts", "accounts"),
        "sources": ("jev", "gtme_score", "human_review"), "min_n": 1,
        "about": "how many on a list fit the ICP, as scored"},
}

REQUIRED = ("id", "title", "client", "date", "stage", "applies_to", "hypothesis", "change",
            "oracle", "result", "verdict", "next_decision", "check", "evidence")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+")
PHONE = re.compile(r"\+?\d[\d\s().-]{8,}\d")
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)+$")
NEED = "[NEED"


class LessonError(ValueError):
    pass


# ---------------------------------------------------------------- oracles

def oracle_errors(o, verdict):
    """Why this oracle record can't carry this verdict. Empty means it can."""
    errs = []
    if not isinstance(o, dict):
        return ["oracle must be an object"]
    metric = o.get("metric")
    spec = ORACLES.get(metric)
    if spec is None:
        return [f"unknown oracle metric {metric!r}; one of {', '.join(ORACLES)}"]
    src = o.get("source")
    if src in spec.get("refuse_sources", ()):
        errs.append(f"{metric} never trusts source {src!r}: {spec['about']}")
    elif src not in spec["sources"]:
        errs.append(f"{metric} source must be one of {', '.join(spec['sources'])}, got {src!r}")
    for flag in spec.get("requires", ()):
        if o.get(flag) is not True:
            errs.append(f"{metric} needs {flag}: true before it counts")
    unit = o.get("unit")
    if unit in spec.get("refuse_units", ()):
        errs.append(f"{metric} is never measured per {unit!r}: {spec['about']}")
    if verdict in ("confirmed", "refuted"):
        if spec["kind"] in ("proxy", "observation"):
            errs.append(f"{metric} is a {spec['kind']} and can't {verdict[:-1]} a claim; record the outcome it predicts")
        if unit not in spec["units"]:
            errs.append(f"{verdict} needs a unit from {', '.join(spec['units'])}, got {unit!r}")
        n = o.get("denominator")
        if not isinstance(n, (int, float)) or isinstance(n, bool) or n < spec["min_n"]:
            errs.append(f"{verdict} needs a denominator of at least {spec['min_n']} for {metric}, got {n!r}")
        if spec["kind"] != "mechanical" and not o.get("baseline"):
            errs.append(f"{verdict} needs a baseline: what it was compared against")
    num, den = o.get("numerator"), o.get("denominator")
    if isinstance(num, (int, float)) and isinstance(den, (int, float)) and not isinstance(num, bool):
        if num < 0 or den < 0:
            errs.append("numerator and denominator can't be negative")
        elif metric.endswith("_rate") and den and num > den:
            errs.append(f"{metric} numerator {num} is larger than its denominator {den}")
    return errs


def domain_of(value):
    v = (value or "").strip().lower()
    v = v.rsplit("@", 1)[-1]
    v = re.sub(r"^https?://", "", v).split("/", 1)[0].split(":", 1)[0].rstrip(".")
    return v[4:] if v.startswith("www.") else v


def same_org(email_domain, account_domain):
    """True when the email domain is the account domain or one of its subdomains."""
    e, a = domain_of(email_domain), domain_of(account_domain)
    return bool(e and a) and (e == a or e.endswith("." + a))


def verified_email(email_domain, status, brand_domain, parents=()):
    """The row-level oracle for verified_email_rate: (counts, why)."""
    if (status or "").strip().lower() != "valid":
        return False, f"verifier said {status or 'nothing'}; only valid counts (catch-all and unknown don't)"
    for d in (brand_domain, *parents):
        if same_org(email_domain, d):
            return True, f"valid at {domain_of(email_domain)}, which is {domain_of(d)}"
    targets = ", ".join(domain_of(d) for d in (brand_domain, *parents) if d)
    return False, (f"valid but at {domain_of(email_domain)}, not {targets}: a valid email at another "
                   "company is the wrong person (Sabo, Gymshark, 2026-10-16)")


# ---------------------------------------------------------------- validation

def all_text(lesson):
    out = []

    def walk(v):
        if isinstance(v, str):
            out.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(lesson)
    return "\n".join(out)


def privacy_errors(lesson):
    text = all_text(lesson)
    errs = []
    if EMAIL.search(text):
        errs.append(f"holds an email address ({EMAIL.search(text).group(0)}); evidence is a path, not client data")
    for m in PHONE.finditer(text):
        digits = re.sub(r"\D", "", m.group(0))
        # Dates and counts like 2026-10-16 or 1,548 aren't phones; ten or more
        # digits in one run is.
        if len(digits) >= 10 and not re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", m.group(0).strip()):
            errs.append("holds what looks like a phone number")
            break
    return errs


def lesson_errors(lesson):
    if not isinstance(lesson, dict):
        return ["a lesson is a JSON object"]
    errs = [f"missing {k}" for k in REQUIRED if k not in lesson or lesson[k] in ("", None, [])]
    if errs:
        return errs
    if not ID_RE.match(lesson["id"]):
        errs.append("id is lowercase words joined by hyphens, client first (zeutara-list-fit-before-copy)")
    if lesson["stage"] not in STAGES:
        errs.append(f"stage must be one of {', '.join(STAGES)}")
    if lesson["verdict"] not in VERDICTS:
        errs.append(f"verdict must be one of {', '.join(VERDICTS)}")
    try:
        dt.date.fromisoformat(lesson["date"])
    except (TypeError, ValueError):
        errs.append("date is YYYY-MM-DD")
    if not isinstance(lesson["applies_to"], list) or not all(isinstance(t, str) for t in lesson["applies_to"]):
        errs.append("applies_to is a list of tags")
    if not isinstance(lesson["evidence"], list):
        errs.append("evidence is a list of paths, commits or files")
    if lesson["verdict"] != "pending" and NEED in lesson["result"]:
        errs.append("a result with a [NEED] marker is still pending")
    errs += oracle_errors(lesson["oracle"], lesson["verdict"])
    errs += privacy_errors(lesson)
    # The title and the check are the portable part: `gtme start` shows them
    # to whoever plans the next campaign, possibly for someone else's client.
    # The client name stays in result, evidence and scope.
    name = str(lesson["client"]).strip().lower()
    for field in ("title", "check"):
        if name and re.search(r"\b" + re.escape(name) + r"\b", str(lesson[field]).lower()):
            errs.append(f"{field} names the client {lesson['client']}; keep it in result or scope so the check travels")
    return errs


def check_ref_state(ref):
    """Same contract as gtme-rules: path::needle must exist and hold the needle."""
    path, _, needle = str(ref).partition("::")
    target = Path(path).expanduser() if path.startswith(("~", "/")) else KIT / path.removeprefix("kit:")
    if not target.is_file():
        return f"{path} does not exist"
    if needle and needle not in target.read_text(errors="replace"):
        return f"{path} no longer contains {needle!r}"
    return ""


# ---------------------------------------------------------------- storage

def load_all(ledger=None):
    d = Path(ledger or LEDGER)
    out = []
    if not d.is_dir():
        return out
    for f in sorted(d.glob("*.json")):
        try:
            lesson = json.loads(f.read_text())
        except (OSError, ValueError) as err:
            lesson = {"id": f.stem, "_load_error": str(err)}
        lesson["_file"] = str(f)
        out.append(lesson)
    return out


def write(lesson, ledger=None, replace=False):
    errs = lesson_errors(lesson)
    if errs:
        raise LessonError("; ".join(errs))
    d = Path(ledger or LEDGER)
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"{lesson['id']}.json"
    if f.exists() and not replace:
        raise LessonError(f"{lesson['id']} already exists; use `gtme lesson record` to add a result")
    lesson.setdefault("history", [])
    lesson["oracle"]["version"] = ORACLES[lesson["oracle"]["metric"]]["version"]
    clean = {k: v for k, v in lesson.items() if not k.startswith("_")}
    f.write_text(json.dumps(clean, indent=2, ensure_ascii=False) + "\n")
    return f


def record(lesson_id, result, verdict, next_decision=None, oracle=None, when=None, ledger=None):
    """Append the current state to history, then set the new result. Never erases."""
    f = Path(ledger or LEDGER) / f"{lesson_id}.json"
    if not f.is_file():
        raise LessonError(f"no lesson {lesson_id}")
    lesson = json.loads(f.read_text())
    lesson.setdefault("history", []).append({
        "date": lesson["date"], "result": lesson["result"], "verdict": lesson["verdict"],
        "next_decision": lesson["next_decision"], "oracle": lesson["oracle"]})
    lesson["date"] = when or dt.date.today().isoformat()
    lesson["result"], lesson["verdict"] = result, verdict
    if next_decision:
        lesson["next_decision"] = next_decision
    if oracle:
        lesson["oracle"] = oracle
    return write(lesson, ledger, replace=True)


# ---------------------------------------------------------------- retrieval

STOP = set("""a an and are as at be been but by can do does for from get go got has have how i if in into is it
its just make of on or our out so that the their them then there they this to up us use was we what when where
which who why will with you your each every first new about after before over per than any all one two
next last""".split())
# "next" and "last" joined the list on 2026-11-02: once a lesson named `gtme next-move`, the
# held-out "book a dentist appointment next tuesday" matched it on "next" plus book=meeting.

# Words that mean the same thing in GTM work. Each word maps to its group, and
# a group counts as one matched idea. Written from the playbook and the
# ledger's own fields, not from the held-out queries, which were sealed first.
CONCEPTS = {
    "email": "email emails mailbox address addresses",
    "verify": "verify verified verifier valid invalid zerobounce neverbounce findymail deliverable catchall",
    "bounce": "bounce bounces bounced bouncing",
    "deliverability": "deliverability inbox inboxes sender senders warmup spam domain domains",
    "contact": "contact contacts person people buyer buyers decision maker owner owners partnerships partner who",
    "list": "list lists audience audiences lead leads prospect prospects target targets table rows row segment",
    "fit": "fit fits icp sector niche relevant relevance match matches thesis qualify qualified",
    "copy": "copy sequence sequences opener subject message messages variant variants write rewrite email1 wording",
    "reply": "reply replies replied respond responded response wrote answer answers answered",
    "interest": "interest interested positive warm intent",
    "campaign": "campaign campaigns send sends sending sent launch outbound cold",
    "pause": "pause paused pauses stop stopped halt",
    "resume": "resume resumed restart relaunch unpause recover recovery",
    "meeting": "meeting meetings call calls booked booking book calendar",
    "cost": "credit credits cost costs spend spent price budget",
    "compliance": "optout unsubscribe canspam compliance footer",
    "search": "search find finding found lookup discover",
    "brand": "brand brands company companies firm firms account accounts business businesses",
    "creator": "creator creators influencer influencers athlete athletes ambassador ambassadors sponsor sponsors sponsorship",
    "investor": "investor investors vc vcs fund funds angel angels raise",
    "parent": "parent parents subsidiary holding",
    "test": "test tests split experiment arm arms",
    "measure": "measure measured metric metrics rate rates denominator sample",
    "grade": "grade grader rubric score scores scored scoring",
}
WORD_TO_CONCEPT = {w: c for c, words in CONCEPTS.items() for w in words.split()}
# The stage each idea belongs to. A plan usually spans stages ("pick who to
# send to and write the sequence" is list plus copy), and on 2026-10-16 pure
# score ranking let one heavy word ("email") fill the top five with verify
# lessons while the copy lessons sat at sixth. So each stage the query touches
# gets its best lesson first, then the rest fill by score.
CONCEPT_STAGE = {
    "email": "verify", "verify": "verify", "bounce": "deliverability", "deliverability": "deliverability",
    "pause": "deliverability", "resume": "deliverability", "contact": "list", "list": "list", "fit": "list",
    "search": "list", "parent": "list", "copy": "copy", "grade": "copy", "test": "copy", "reply": "reply",
    "interest": "reply", "campaign": "send", "compliance": "send", "meeting": "meeting", "cost": "enrich",
}

FIELD_WEIGHTS = {"title": 2.0, "applies_to": 2.0, "stage": 1.5, "hypothesis": 1.0, "change": 1.0,
                 "result": 1.0, "check": 1.5, "next_decision": 0.5, "scope": 0.5}
# A lesson must share at least two distinct ideas with the query: one shared
# word ("email", "campaign") matches half the ledger and says nothing. H5 (an
# off-topic query) is the case that pins this.
MIN_CONCEPTS = 2
MIN_SCORE = 1.0  # guessed, never measured; set against the held-out cases in tests


def stem(w):
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            base = w[: -len(suf)]
            if base in WORD_TO_CONCEPT:
                return base
    return w


def terms(text):
    words = re.findall(r"[a-z0-9]+", (text or "").lower().replace("opt-out", "optout").replace("can-spam", "canspam"))
    out = []
    for w in words:
        if w in STOP or len(w) < 2:
            continue
        w = w if w in WORD_TO_CONCEPT else stem(w)
        out.append(WORD_TO_CONCEPT.get(w, w))
    return out


def lesson_fields(lesson):
    return {"title": lesson.get("title", ""), "applies_to": " ".join(lesson.get("applies_to", [])),
            "stage": lesson.get("stage", ""), "hypothesis": lesson.get("hypothesis", ""),
            "change": lesson.get("change", ""), "result": lesson.get("result", ""),
            "check": lesson.get("check", ""), "next_decision": lesson.get("next_decision", ""),
            "scope": lesson.get("scope", "")}


def rank(query, lessons, client=None, exclude_client=None, stage=None, limit=5):
    pool = [x for x in lessons if "_load_error" not in x]
    if exclude_client:
        pool = [x for x in pool if x.get("client", "").lower() != exclude_client.lower()]
    if not pool:
        return []
    docs = []
    for x in pool:
        bag = {}
        for field, text in lesson_fields(x).items():
            for t in terms(text):
                bag[t] = bag.get(t, 0.0) + FIELD_WEIGHTS[field]
        docs.append(bag)
    n = len(docs)
    avg = sum(sum(b.values()) for b in docs) / n
    df = {}
    for b in docs:
        for t in b:
            df[t] = df.get(t, 0) + 1
    q = set(terms(query))
    k1, bb = 1.2, 0.75
    hits = []
    for x, bag in zip(pool, docs):
        length = sum(bag.values())
        score, matched = 0.0, []
        for t in q:
            tf = bag.get(t, 0.0)
            if not tf:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            score += idf * tf * (k1 + 1) / (tf + k1 * (1 - bb + bb * length / avg))
            matched.append(t)
        if len(matched) < MIN_CONCEPTS or score < MIN_SCORE:
            continue
        score *= VERDICT_WEIGHT.get(x.get("verdict"), 0.5)
        if stage and x.get("stage") == stage:
            score *= 1.5
        hits.append({"score": round(score, 3), "matched": sorted(matched), "lesson": x,
                     "transfer": bool(client) and x.get("client", "").lower() != client.lower()})
    hits.sort(key=lambda h: (-h["score"], h["lesson"]["id"]))
    wanted = [stage] if stage else []
    for t in terms(query):
        s = CONCEPT_STAGE.get(t)
        if s and s not in wanted:
            wanted.append(s)
    first, seen = [], set()
    for s in wanted:
        best = next((h for h in hits if h["lesson"].get("stage") == s), None)
        if best and best["lesson"]["id"] not in seen:
            first.append(best)
            seen.add(best["lesson"]["id"])
    first.sort(key=lambda h: (-h["score"], h["lesson"]["id"]))
    rest = [h for h in hits if h["lesson"]["id"] not in seen]
    return (first + rest)[:limit]


# ---------------------------------------------------------------- audit

def audit(lessons):
    rows = []
    ids = {x.get("id") for x in lessons}
    for x in lessons:
        if "_load_error" in x:
            rows.append({"id": x["id"], "state": "BROKEN", "detail": f"not JSON: {x['_load_error']}"})
            continue
        errs = lesson_errors(x)
        if Path(x["_file"]).stem != x.get("id"):
            errs.append(f"file is {Path(x['_file']).name} but id is {x.get('id')}")
        for ref in x.get("check_ref") or []:
            why = check_ref_state(ref)
            if why:
                errs.append(f"check_ref broken: {why}")
        for parent in x.get("derived_from") or []:
            if parent not in ids:
                errs.append(f"derived_from names {parent}, which isn't in the ledger")
        # Evidence in this kit must exist. Evidence in a client repo or
        # Downloads lives on one person's Mac, so its absence is noted, not fatal.
        away = []
        for ref in x.get("evidence") if isinstance(x.get("evidence"), list) else []:
            path = str(ref).split("::", 1)[0]
            if re.fullmatch(r"[0-9a-f]{7,40}", path):
                continue
            if path.startswith(("~", "/")):
                if not Path(path).expanduser().exists():
                    away.append(path)
            elif not (KIT / path).exists():
                errs.append(f"evidence {path} isn't in the kit")
        if errs:
            rows.append({"id": x["id"], "state": "BROKEN", "detail": "; ".join(errs)})
            continue
        spec = ORACLES[x["oracle"]["metric"]]
        if x["oracle"].get("version", 0) < spec["version"]:
            rows.append({"id": x["id"], "state": "REVISIT",
                         "detail": f"judged under {x['oracle']['metric']} v{x['oracle'].get('version', 0)}, "
                                   f"now v{spec['version']}: recheck the verdict"})
        elif not x.get("check_ref"):
            rows.append({"id": x["id"], "state": "PROSE",
                         "detail": "its check is words only; give it a check_ref when code enforces it"})
        else:
            rows.append({"id": x["id"], "state": "CHECKED", "detail": ", ".join(x["check_ref"])})
        if away:
            rows[-1]["detail"] += f" (evidence not on this Mac: {', '.join(away)})"
    return rows


# ---------------------------------------------------------------- cli

def show_hit(h, i):
    x = h["lesson"]
    origin = f"from {x['client']}" + (", check it applies here" if h["transfer"] else "")
    lines = [f"{i}. [{x['verdict']}] {x['title']}  ({origin}, {x['date']}, {x['stage']})",
             f"   check: {x['check']}",
             f"   result: {x['result']}",
             f"   next: {x['next_decision']}"]
    if x.get("scope"):
        lines.append(f"   held where: {x['scope']}")
    lines.append(f"   evidence: {'; '.join(x['evidence'])}   id: {x['id']}")
    return "\n".join(lines)


def load_input(path):
    raw = sys.stdin.read() if path == "-" else Path(path).read_text()
    return json.loads(raw)


def template():
    return {"id": "client-short-slug", "title": "", "client": "", "date": dt.date.today().isoformat(),
            "stage": "list", "applies_to": [], "hypothesis": "", "change": "",
            "oracle": {"metric": "reply_rate", "numerator": None, "denominator": None, "unit": "people",
                       "source": "gtm_funnel", "baseline": ""},
            "result": "[NEED: result]", "verdict": "pending", "next_decision": "", "check": "",
            "check_ref": [], "evidence": [], "scope": "", "derived_from": []}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="chewbacca gtme lesson", description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan", help="the lessons that apply to what you're about to build")
    p.add_argument("query", nargs="+")
    p.add_argument("--client")
    p.add_argument("--exclude-client")
    p.add_argument("--stage", choices=STAGES)
    p.add_argument("--limit", type=int, default=5)
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("add", help="validate a lesson and write it to the ledger")
    p.add_argument("file")
    p = sub.add_parser("record", help="add a new result to a lesson; the old one moves to history")
    p.add_argument("id")
    p.add_argument("--result", required=True)
    p.add_argument("--verdict", required=True, choices=VERDICTS)
    p.add_argument("--next", dest="next_decision")
    p.add_argument("--oracle", help="the new oracle record as JSON")
    p = sub.add_parser("list")
    p.add_argument("--client")
    p.add_argument("--stage", choices=STAGES)
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("show")
    p.add_argument("id")
    p = sub.add_parser("audit")
    p.add_argument("--json", action="store_true")
    sub.add_parser("oracles")
    p = sub.add_parser("verified-email", help="does this email count as verified for this account")
    p.add_argument("--email-domain", required=True, help="the domain after the @ (or the whole address)")
    p.add_argument("--status", required=True, help="what the verifier said")
    p.add_argument("--brand-domain", required=True)
    p.add_argument("--parent", action="append", default=[])
    sub.add_parser("template")
    a = ap.parse_args(argv)

    try:
        if a.cmd == "plan":
            hits = rank(" ".join(a.query), load_all(), a.client, a.exclude_client, a.stage, a.limit)
            if a.json:
                print(json.dumps([{"id": h["lesson"]["id"], "score": h["score"], "matched": h["matched"],
                                   "transfer": h["transfer"],
                                   **{k: v for k, v in h["lesson"].items() if not k.startswith("_")}}
                                  for h in hits], indent=2))
            elif not hits:
                print("No lesson in the ledger covers this. When it's done, record what you learned:"
                      " chewbacca gtme lesson template")
            else:
                print("\n\n".join(show_hit(h, i) for i, h in enumerate(hits, 1)))
            return 0
        if a.cmd == "add":
            f = write(load_input(a.file))
            print(f"wrote {f}")
            return 0
        if a.cmd == "record":
            f = record(a.id, a.result, a.verdict, a.next_decision, json.loads(a.oracle) if a.oracle else None)
            print(f"recorded {f}")
            return 0
        if a.cmd == "list":
            rows = [x for x in load_all() if "_load_error" not in x
                    and (not a.client or x.get("client", "").lower() == a.client.lower())
                    and (not a.stage or x.get("stage") == a.stage)]
            if a.json:
                print(json.dumps([{k: v for k, v in x.items() if not k.startswith("_")} for x in rows], indent=2))
            else:
                for x in rows:
                    print(f"{x['id']:<46} {x['verdict']:<12} {x['stage']:<14} {x['title']}")
            return 0
        if a.cmd == "show":
            f = LEDGER / f"{a.id}.json"
            if not f.is_file():
                raise LessonError(f"no lesson {a.id}")
            print(f.read_text(), end="")
            return 0
        if a.cmd == "audit":
            rows = audit(load_all())
            if a.json:
                print(json.dumps(rows, indent=2))
            else:
                for r in rows:
                    print(f"{r['state']:<8} {r['id']:<46} {r['detail']}")
                counts = {}
                for r in rows:
                    counts[r["state"]] = counts.get(r["state"], 0) + 1
                print(", ".join(f"{v} {k}" for k, v in sorted(counts.items())) or "ledger is empty")
            return 1 if any(r["state"] == "BROKEN" for r in rows) else 0
        if a.cmd == "oracles":
            for name, s in ORACLES.items():
                trusts = ", ".join(s["sources"])
                print(f"{name:<22} {s['kind']:<10} v{s['version']}  n>={s['min_n']:<4} {s['about']}. Trusts: {trusts}")
            return 0
        if a.cmd == "verified-email":
            ok, why = verified_email(a.email_domain, a.status, a.brand_domain, a.parent)
            print(("COUNTS " if ok else "DOESN'T COUNT ") + why)
            return 0 if ok else 1
        if a.cmd == "template":
            print(json.dumps(template(), indent=2))
            return 0
    except (LessonError, OSError, ValueError) as err:
        print(f"gtme lesson: {err}", file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    sys.exit(main())
