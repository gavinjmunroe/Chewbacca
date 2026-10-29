#!/usr/bin/env python3
"""Togari's lead-scoring rubrics, offline: does this person belong to that company,
how good is this inbound lead, which contact at a company is the one to email,
and which tier a scored company lands in.

  gtme-score affiliation --email jane@acme.com --company "Acme Inc" --website acme.com
  gtme-score lead --name "Jane Smith" --email jane@acme.com --company Acme --domain acme.com \\
                  --brief "multi-site dental groups in the Midwest" --title "Founder / CEO"
  gtme-score contact contacts.csv [--titles "CEO,Founder"] [--company-col company_domain]
  gtme-score tier company.json         {"fit_score": 82, "has_primary_contact": true,
                                         "company": {...}, "criteria": {"revenue_range": {...}}}
  gtme-score quality contacts.csv      completeness 0 to 100, and who still needs an email or phone
  gtme-score fit-share leads.csv       fits over total before any copy work; exit 1 under half

Ported from togari-platform at 6ef088b, rule for rule:
  affiliation  src/agents/scoring/affiliationScoring.ts  calculateAffiliation
  lead         src/routes/website/index.ts               scoreIcpLead, isWorkEmail
  contact      src/enrichment/primary-contact-resolver.ts scoreCandidate, resolvePrimaryContact
  tier         src/enrichment/tier-assigner.ts           ruleBasedTier, isBorderline
  quality      src/agents/scoring/qualityScoring.ts      calculateQualityScore, isContactComplete
tests/test_gtme_score.py carries every case from the TypeScript tests (qualityScoring
has none upstream, so its cases are worked from the source).

Where Togari asks Claude (a primary-contact tie within 5 points, a fit score
within 5 of a tier line), this says so and stops: `tie` / `borderline` is true
and the rule-based answer is labelled as the fallback Togari itself uses when
the model call fails. No model is called here. Stdlib only, nothing is sent.
"""
import argparse
import csv
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

# ── affiliation (affiliationScoring.ts) ──────────────────────────────────────

PERSONAL_EMAIL_DOMAINS = {
    "gmail.com", "yahoo.com", "aol.com", "hotmail.com", "outlook.com", "icloud.com", "me.com", "live.com",
    "msn.com", "mail.com", "protonmail.com", "proton.me", "ymail.com", "rocketmail.com",
    "comcast.net", "att.net", "verizon.net", "bellsouth.net", "sbcglobal.net", "cox.net", "charter.net",
    "flash.net", "frontiernet.net", "frontier.com", "earthlink.net", "peoplepc.com", "windstream.net",
    "centurylink.net", "centurytel.net", "embarqmail.com", "netzero.net", "juno.com", "optonline.net",
    "optimum.net", "suddenlink.net", "twc.com", "roadrunner.com", "rr.com", "cfl.rr.com", "wi.rr.com",
    "ny.rr.com", "nc.rr.com", "tx.rr.com", "consolidated.net", "snet.net", "swbell.net", "pacbell.net",
    "ameritech.net", "nvbell.net", "cableone.net", "mediacombb.net", "wowway.com", "wccs.net", "mchsi.com",
    "q.com", "lisco.com", "epix.net", "windstream.com", "hotmail.co.uk", "live.co.uk", "yahoo.co.uk",
    "googlemail.com",
}


def extract_domain_from_url(url):
    if not url:
        return None
    d = url.strip().lower()
    d = re.sub(r"^https?://", "", d)
    d = d.split("/")[0]
    d = d.split("?")[0]
    d = d.split("#")[0]
    d = re.sub(r"^www\.", "", d)
    if "." not in d or " " in d:
        return None
    return d or None


def extract_domain_from_email(email):
    if not email:
        return None
    t = email.strip().lower()
    at = t.find("@")
    if at == -1 or at == len(t) - 1:
        return None
    d = t[at + 1:]
    if "." not in d or " " in d:
        return None
    return d


def is_personal_email_domain(domain):
    return bool(domain) and domain.lower() in PERSONAL_EMAIL_DOMAINS


def jaro_winkler(s1, s2):
    """The TypeScript jaroWinklerSimilarity, step for step (including its match window)."""
    if s1 == s2:
        return 1.0
    if not s1 or not s2:
        return 0.0
    window = max(len(s1), len(s2)) // 2 - 1
    m1, m2 = [False] * len(s1), [False] * len(s2)
    matches = 0
    for i in range(len(s1)):
        start, end = max(0, i - window), min(i + window + 1, len(s2))
        for j in range(start, end):
            if m2[j] or s1[i] != s2[j]:
                continue
            m1[i] = m2[j] = True
            matches += 1
            break
    if matches == 0:
        return 0.0
    k = transpositions = 0
    for i in range(len(s1)):
        if not m1[i]:
            continue
        while not m2[k]:
            k += 1
        if s1[i] != s2[k]:
            transpositions += 1
        k += 1
    jaro = (matches / len(s1) + matches / len(s2) + (matches - transpositions / 2) / matches) / 3
    prefix = 0
    for i in range(min(4, len(s1), len(s2))):
        if s1[i] == s2[i]:
            prefix += 1
        else:
            break
    return jaro + prefix * 0.1 * (1 - jaro)


SUFFIXES = [
    re.compile(r"\s+(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|company|incorporated|corporation)\.?\s*$", re.I),
    re.compile(r"\s+(& associates|and associates|associates)\.?\s*$", re.I),
    re.compile(r"\s+(services|solutions|consulting|group)\.?\s*$", re.I),
]


def normalize_company_name(name):
    n = name.lower().strip()
    for s in SUFFIXES:
        n = s.sub("", n, count=1)
    n = re.sub(r"[.,'\"!?&-]", " ", n)
    return re.sub(r"\s+", " ", n).strip()


INDUSTRY_MISMATCHES = [
    (r"\bequipment\b", "equipment", r"\bequipment\b"),
    (r"\barchitectural\b|\belements\b", "architecture", r"\barchitectural\b"),
    (r"\bcapital\b|\bpartners\b|\bholdings\b|\bequity\b|\binvestment\b", "finance", r"\bcapital\b|\bpartners\b"),
    (r"\blaw\s*(firm|office|group)?\b", "legal", r"\blaw\b"),
    (r"\binsurance\b", "insurance", r"\binsurance\b"),
    (r"\breal\s*estate\b", "real estate", r"\breal\s*estate\b"),
]
DOMAIN_INDUSTRIES = [
    (r"doctor|medical|health|care", "healthcare"),
    (r"equip|machine|tool", "equipment"),
    (r"architect|design|build", "architecture"),
    (r"law|legal|attorney", "legal"),
]


def detect_obvious_mismatch(contact_company, contact_domain, target_name, target_website):
    cc = (contact_company or "").lower()
    cd = (contact_domain or "").lower()
    tl = target_name.lower()
    for pattern, industry, not_for in INDUSTRY_MISMATCHES:
        if re.search(pattern, cc, re.I) and not re.search(not_for, tl, re.I):
            return f'Contact is from {industry} industry, not "{target_name}"'
    tw = [w for w in normalize_company_name(target_name).split(" ") if len(w) > 2]
    cw = [w for w in normalize_company_name(cc).split(" ") if len(w) > 2]
    if tw and cw:
        tc, ccore = tw[0], cw[0]
        if len(tc) > 3 and len(ccore) > 3 and jaro_winkler(tc, ccore) < 0.5:
            if target_website and cd:
                if jaro_winkler(extract_domain_from_url(target_website) or "", cd) < 0.4:
                    return f'Contact\'s company "{contact_company}" doesn\'t match "{target_name}"'
    if cd and target_website:
        td = extract_domain_from_url(target_website)
        if td and not is_personal_email_domain(cd):
            base = lambda d: ".".join(d.split(".")[:-1])  # noqa: E731
            tb, cb = base(td), base(cd)
            if tb and cb:
                sim = jaro_winkler(tb, cb)
                if sim < 0.4:
                    for pattern, industry in DOMAIN_INDUSTRIES:
                        if re.search(pattern, cd, re.I) and not re.search(pattern, td, re.I):
                            return f'Email domain "{cd}" suggests {industry}, not target company'
                    if sim < 0.3:
                        return f'Email domain "{cd}" doesn\'t match company domain "{td}"'
    return None


def js_round(x):
    """Math.round: halves go up, also for negatives."""
    import math
    return int(math.floor(x + 0.5))


def calculate_affiliation(email, company_name, target_name, target_website):
    ced = extract_domain_from_email(email)
    twd = extract_domain_from_url(target_website)
    reason = detect_obvious_mismatch(company_name, ced, target_name, target_website)
    if reason:
        return {"score": 0, "emailDomainType": "company-mismatch", "companyNameSimilarity": 0,
                "autoReject": True, "warning": reason}
    kind, dscore = "unknown", 0
    if ced:
        if is_personal_email_domain(ced):
            kind, dscore = "personal", 50
        elif twd:
            td = extract_domain_from_url(twd)
            if td and ced == td:
                kind, dscore = "company-match", 100
            elif td:
                if ".".join(td.split(".")[-2:]) == ".".join(ced.split(".")[-2:]):
                    kind, dscore = "company-match", 90
                else:
                    sim = jaro_winkler(td, ced)
                    if sim > 0.8:
                        kind, dscore = "company-match", js_round(sim * 100)
                    elif sim > 0.5:
                        kind, dscore = "unknown", js_round(sim * 60)
                    else:
                        kind, dscore = "company-mismatch", 20
    if company_name and target_name:
        name_sim = jaro_winkler(normalize_company_name(company_name), normalize_company_name(target_name))
    elif not company_name:
        name_sim = 0.5
    else:
        name_sim = 0
    score = js_round(dscore * 0.6 + name_sim * 100 * 0.4)
    warning = None
    if kind == "personal":
        warning = f"Personal email domain ({ced}) - cannot verify company affiliation"
    elif kind == "unknown" and score < 70:
        warning = f"Low affiliation confidence ({score}%) - verify this contact belongs to {target_name}"
    elif kind == "company-mismatch":
        warning = "Email domain doesn't match company website - verify affiliation"
    return {"score": score, "emailDomainType": kind, "companyNameSimilarity": name_sim,
            "autoReject": False, "warning": warning}


# ── inbound lead (routes/website/index.ts) ───────────────────────────────────

def is_work_email(email):
    d = extract_domain_from_email(email)
    return bool(d) and not is_personal_email_domain(d)


def score_icp_lead(full_name, email, company, company_domain, icp_description, target_titles):
    score, why = 0, []
    if full_name.strip():
        score += 10
        why.append("+10 name")
    if "@" in email:
        score += 10
        why.append("+10 email")
    if is_work_email(email):
        score += 20
        why.append("+20 work email")
    aff = calculate_affiliation(email, company, company, company_domain)
    if aff["emailDomainType"] == "company-match":
        score += 20
        why.append("+20 email domain is the company's")
    elif aff["emailDomainType"] == "unknown":
        score += 5
        why.append("+5 email domain unclear")
    brief = len(icp_description.strip())
    if brief >= 20:
        score += 20
        why.append("+20 specific brief")
    elif brief > 0:
        score += 10
        why.append("+10 thin brief")
    if target_titles:
        score += 20
        why.append("+20 named target titles")
    return {"score": min(score, 100), "work_email": is_work_email(email), "affiliation": aff["emailDomainType"], "why": why}


# ── primary contact (primary-contact-resolver.ts) ────────────────────────────

DEFAULT_OWNER_TARGET_TITLES = ["CEO", "Chief Executive Officer", "Founder", "Co-Founder", "Owner", "President",
                               "Managing Partner"]
FORMER_TITLE = re.compile(r"\b(former|ex-?|interim|advisor)\b", re.I)
TIEBREAK_THRESHOLD = 5


def _truthy(v):
    if isinstance(v, bool):
        return v
    return str(v or "").strip().lower() in ("true", "1", "yes", "y", "valid", "verified")


def _parse_time(v):
    if not v:
        return None
    try:
        t = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def score_candidate(c, titles, now=None):
    now = now or datetime.now(timezone.utc)
    reasons, score = [], 0
    title = c.get("title") or ""
    if FORMER_TITLE.search(title):
        score -= 20
        reasons.append("-20 former/ex- title")
    hit = next((kw for kw in titles if kw.lower() in title.lower()), None)
    if hit:
        score += 40
        reasons.append(f"+40 title matches {hit}")
    if c.get("email") and _truthy(c.get("email_verified")):
        score += 20
        reasons.append("+20 verified email")
    if c.get("mobile_phone"):
        score += 15
        reasons.append("+15 mobile phone")
    if c.get("linkedin_url"):
        score += 10
        reasons.append("+10 LinkedIn profile")
    t = _parse_time(c.get("last_activity_at"))
    if t and t >= now - timedelta(days=90):
        score += 10
        reasons.append("+10 active in last 90 days")
    tenure = c.get("tenure_years")
    try:
        if tenure not in (None, "") and float(tenure) >= 10:
            score += 5
            reasons.append("+5 10+ year tenure")
    except ValueError:
        pass
    return {"contact_id": c.get("contact_id") or c.get("email") or c.get("full_name"), "score": score, "reasons": reasons}


def resolve_primary(candidates, titles=None, now=None):
    if not candidates:
        raise ValueError("no candidates supplied")
    titles = titles or DEFAULT_OWNER_TARGET_TITLES
    scored = sorted((score_candidate(c, titles, now) for c in candidates), key=lambda s: -s["score"])
    top = scored[0]
    second = scored[1] if len(scored) > 1 else None
    tie = bool(second and top["score"] - second["score"] <= TIEBREAK_THRESHOLD)
    out = {"primary_contact_id": top["contact_id"], "primary_score": top["score"],
           "primary_reason": ", ".join(top["reasons"]) or "highest rule-based score",
           "alternates": [{"contact_id": s["contact_id"], "score": s["score"]} for s in scored[1:]], "tie": tie}
    if tie:
        out["tied"] = [s["contact_id"] for s in scored if top["score"] - s["score"] <= TIEBREAK_THRESHOLD]
        out["needs"] = ("Togari asks Claude to break a tie within 5 points; this is the rule-based "
                        "winner its fallback uses. A person picks among `tied`.")
    return out


# ── contact quality (qualityScoring.ts) ──────────────────────────────────────

IDENTITY_SCORE_THRESHOLD = 70


def _prov(c):
    p = c.get("provenance")
    if isinstance(p, str):
        try:
            p = json.loads(p)
        except ValueError:
            p = None
    return p if isinstance(p, dict) else {}


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def quality_score(c):
    """calculateQualityScore with its breakdown: 75 base for completeness, 25 for cross-source proof."""
    name = str(c.get("name") or c.get("full_name") or "").strip()
    email = str(c.get("email") or "")
    phone = re.sub(r"\D", "", str(c.get("phone") or c.get("mobile_phone") or ""))
    p = _prov(c)
    enf = p.get("enformion") if isinstance(p.get("enformion"), dict) else {}
    addr, ident = _num(enf.get("address_match_score")), _num(enf.get("identity_score"))
    parts = [("Name", 15, bool(name)), ("Title", 10, bool(str(c.get("title") or "").strip())),
             ("Email", 25, "@" in email), ("Phone", 25, len(phone) >= 10),
             ("Cross-source verified", 10, bool(p.get("cross_source_verified"))),
             ("Address match", 5, addr is not None and addr >= 50),
             ("Identity confidence", 5, ident is not None and ident >= IDENTITY_SCORE_THRESHOLD),
             ("Business role verified", 5, bool(p.get("business_role")))]
    score = min(sum(pts for _f, pts, on in parts if on), 100)
    return {"score": score, "complete": bool(name) and ("@" in email or len(phone) >= 10),
            "needs_enrichment": "@" not in email or len(phone) < 10,
            "breakdown": [{"factor": f, "points": pts, "applied": on} for f, pts, on in parts]}


def quality_summary(rows):
    scored = [quality_score(r) for r in rows]
    n = len(scored)
    return {"totalContacts": n, "completeContacts": sum(s["complete"] for s in scored),
            "averageScore": js_round(sum(s["score"] for s in scored) / n) if n else 0,
            "needingEnrichment": sum(s["needs_enrichment"] for s in scored)}


# ── tier (tier-assigner.ts) ──────────────────────────────────────────────────

TIER_1, TIER_2, BAND = 80, 60, 5


def _in_range(v, rng):
    """inRange: no value is off-band; a value with no bound on a side passes that side."""
    if v is None:
        return False
    rng = rng if isinstance(rng, dict) else {}
    lo, hi = rng.get("min"), rng.get("max")
    if lo is not None and v < lo:
        return False
    if hi is not None and v > hi:
        return False
    return True


def assign_tier(fit_score, has_primary_contact, company, criteria):
    rev = _in_range(company.get("estimated_revenue"), criteria.get("revenue_range") or {})
    head = _in_range(company.get("estimated_headcount"), criteria.get("headcount_range") or {})
    if fit_score >= TIER_1 and has_primary_contact and (rev or head):
        tier = 1
    elif fit_score >= TIER_2:
        tier = 2
    else:
        tier = 3
    borderline = abs(fit_score - TIER_1) <= BAND or abs(fit_score - TIER_2) <= BAND
    fit = f"fit score {fit_score}/100"
    reach = "with a reachable primary" if has_primary_contact else "no primary contact yet"
    band = "revenue on-band" if rev else "headcount on-band" if head else "size signals off-band"
    rationale = {1: f"Tier 1: {fit}, {reach}, {band}.",
                 2: f"Tier 2: {fit}, {reach}, {band}; partial match worth a call.",
                 3: f"Tier 3: {fit} below threshold or signals off-band; adjacent / nurture."}[tier]
    out = {"tier": tier, "rationale": rationale, "borderline": borderline}
    if borderline:
        out["needs"] = ("within 5 of a tier line, where Togari asks Claude for the final call; "
                        "this is the rule-based tier its fallback uses")
    return out


# ── cli ──────────────────────────────────────────────────────────────────────

def _rows(path):
    if path == "-":
        text = sys.stdin.read()
    else:
        with open(path, encoding="utf-8-sig") as fh:
            text = fh.read()
    s = text.lstrip()
    if s.startswith("[") or s.startswith("{"):
        data = json.loads(s)
        return data if isinstance(data, list) else data.get("candidates") or data.get("contacts") or [data]
    return list(csv.DictReader(text.splitlines()))


# Signal strength, 1 to 10, with HOLD under 6: references/bma/scoring.md
# section 4, which was prose only until 2026-10-11 (the togari-gtm-os map,
# row 5), so nothing stopped an email going out on "they are in digital health".
SIGNAL_HOLD = 6


def score_signal(sig: dict, today) -> tuple[int, str]:
    """One signal's score and why. A signal with no source or no date counts
    for nothing: the rubric's tiers are about timing, and an unsourced claim
    is not a signal."""
    from datetime import date
    if not str(sig.get("source") or "").strip():
        return 0, "no source"
    scope = str(sig.get("scope") or "").lower()
    when = sig.get("date")
    try:
        age = (today - date.fromisoformat(str(when)[:10])).days if when else None
    except ValueError:
        age = None
    if scope == "company" and age is not None and age <= 30:
        return 9, f"company-specific, {age} days old"
    if scope == "company" and age is not None and age <= 60:
        return 8, f"company-specific, {age} days old"
    if scope == "industry" and sig.get("company_match") and age is not None and age <= 60:
        return 7, f"industry signal that matches the company, {age} days old"
    if scope in ("company", "industry", "category"):
        return 5, "relevant, but no timing trigger in the last 60 days"
    if scope == "tangential":
        return 3, "tangential, weak timing"
    return 1, "no real signal"


def signal_strength(signals: list, today=None, org=None, about=None) -> dict:
    """Why-now strength. Pass `org` ({name, city, state, website}) and Jev checks
    every signal is about that org before it counts, by default. A check that
    didn't run isn't a pass, so no Jev answer means HOLD."""
    from datetime import date
    dropped = []
    if org and os.environ.get("GTME_JEV_SIGNALS", "1") != "0":
        if about is None:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from gtme_jev import signals_about as about
        split = about(org, signals)
        if split is None:
            return {"score": 1, "hold": True, "top": [], "dropped": [],
                    "next": "Hold: Jev couldn't check these signals are about this org, so none count yet"}
        signals, dropped = split
    if today is None:
        pinned = os.environ.get("GTME_TODAY")
        today = date.fromisoformat(pinned) if pinned else date.today()
    scored = sorted(({**s, "score": sc, "why": why} for s in signals for sc, why in [score_signal(s, today)]),
                    key=lambda s: -s["score"])
    top = [s for s in scored if s["score"] > 0][:3]
    best = top[0]["score"] if top else 1
    # Two strong, sourced signals at once make the "why now" stronger than either.
    if sum(1 for s in top if s["score"] >= 8) >= 2:
        best = min(10, best + 1)
    return {"score": best, "hold": best < SIGNAL_HOLD, "top": top, "dropped": dropped,
            "next": "Hold: find a company-specific signal from the last 30 days (funding, an executive hire, a "
                    "launch, a filing) before writing" if best < SIGNAL_HOLD else "Write it, leading with the top signal"}


# Fit share before copy. On 2026-10-03 Zeutara's low replies looked like a copy
# problem until Jev scored the lists: Qube 10 fits of 481, Vertocol 13 of 355,
# Ivy 59 of 214 (lesson zeutara-list-fit-before-copy). No rewrite fixes an
# email to the wrong investor, so under half fitting means fix the list first.
# An unscored row counts against the share: a list nobody scored has not passed.
FIT_SHARE_MIN = 0.5
FIT_COLUMNS = ("fit", "sector_fit", "fit_label", "fit_score")
FIT_YES = {"fit", "strong", "strong fit", "sector fit", "yes", "true", "1"}
FIT_NO = {"weak", "weak fit", "no fit", "none", "no", "false", "0", "not a fit"}


def fit_share(rows, column=None, min_score=TIER_2):
    cols = [column] if column else list(FIT_COLUMNS)
    fits = weak = unscored = 0
    for r in rows:
        val = next((r.get(c) for c in cols if str(r.get(c) if r.get(c) is not None else "").strip()), None)
        label = str(val).strip().lower() if val is not None else ""
        if not label:
            unscored += 1
        elif label in FIT_YES:
            fits += 1
        elif label in FIT_NO:
            weak += 1
        else:
            try:
                if float(label) >= min_score:
                    fits += 1
                else:
                    weak += 1
            except ValueError:
                unscored += 1
    total = len(rows)
    share = fits / total if total else 0.0
    ok = total > 0 and share >= FIT_SHARE_MIN
    return {"fits": fits, "not_fit": weak, "unscored": unscored, "total": total, "share": round(share, 4),
            "min_share": FIT_SHARE_MIN, "ok": ok,
            "next": "list fits; copy work can start" if ok else
                    "fix the list first: under half fit, and no copy makes the wrong investor relevant"}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="gtme-score", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("affiliation", help="does this person belong to that company (0 to 100, auto-reject)")
    a.add_argument("--email", default="")
    a.add_argument("--company", default="", help="the company the contact record names")
    a.add_argument("--target", help="the company you meant (defaults to --company)")
    a.add_argument("--website", default="")
    l = sub.add_parser("lead", help="score an inbound ICP request the way BMA's website funnel does")
    l.add_argument("--name", default="")
    l.add_argument("--email", required=True)
    l.add_argument("--company", required=True)
    l.add_argument("--domain", required=True)
    l.add_argument("--brief", default="")
    l.add_argument("--title", action="append", default=[])
    c = sub.add_parser("contact", help="pick the primary contact per company from a CSV or JSON of candidates")
    c.add_argument("file", help="CSV or JSON; - reads stdin")
    c.add_argument("--titles", help="comma list of target title keywords (default CEO, Founder, Owner, ...)")
    c.add_argument("--company-col", default="company_id", help="column that groups candidates (default company_id)")
    t = sub.add_parser("tier", help="tier 1/2/3 from a fit score, reachability and the size band")
    t.add_argument("file", help="JSON: fit_score, has_primary_contact, company, criteria; - reads stdin")
    q = sub.add_parser("quality", help="how complete each contact is (0 to 100) and which still need an email or phone")
    q.add_argument("file", help="CSV or JSON of contacts; - reads stdin")
    s = sub.add_parser("signal", help="why-now strength 1 to 10 for one account, HOLD under 6")
    s.add_argument("file", help="JSON list of signals: what, date, scope (company|industry|category|tangential), "
                                "company_match, source; or {org: {name, city, state, website}, signals: [...]} "
                                "and Jev checks each signal is about that org; - reads stdin")
    f = sub.add_parser("fit-share", help="fits over total before any copy work; exit 1 under half")
    f.add_argument("file", help="CSV or JSON of leads with a fit, sector_fit, fit_label or fit_score column; - reads stdin")
    f.add_argument("--column", help="the fit column, when it has another name")
    f.add_argument("--min-score", type=float, default=TIER_2, help=f"numeric fit at or above this counts (default {TIER_2})")
    for p in (a, l, c, t, q, s, f):
        p.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    if args.cmd == "fit-share":
        out = fit_share(_rows(args.file), args.column, args.min_score)
        line = (f"{out['fits']} of {out['total']} fit ({out['share']:.0%}), {out['not_fit']} not, "
                f"{out['unscored']} unscored\n{out['next']}")
        print(json.dumps(out) if args.json else line)
        return 0 if out["ok"] else 1

    if args.cmd == "signal":
        text = sys.stdin.read() if args.file == "-" else open(args.file).read()
        data = json.loads(text)
        org = data.get("org") if isinstance(data, dict) else None
        out = signal_strength(data if isinstance(data, list) else data.get("signals") or [], org=org)
        line = (f"{out['score']}/10" + (" HOLD" if out["hold"] else "") + "\n" +
                "\n".join(f"  {x['score']} {x.get('what', '')} ({x['why']}) {x.get('source')}" for x in out["top"]) +
                f"\n{out['next']}")
        print(json.dumps(out) if args.json else line)
        return 0

    if args.cmd == "affiliation":
        out = calculate_affiliation(args.email, args.company, args.target or args.company, args.website)
        line = f"{out['score']} {out['emailDomainType']}" + (" AUTO-REJECT" if out["autoReject"] else "") + \
               (f": {out['warning']}" if out["warning"] else "")
    elif args.cmd == "lead":
        out = score_icp_lead(args.name, args.email, args.company, args.domain, args.brief, args.title)
        line = f"{out['score']}/100 ({', '.join(out['why'])})"
    elif args.cmd == "contact":
        rows = _rows(args.file)
        titles = [x.strip() for x in args.titles.split(",")] if args.titles else None
        groups = {}
        for r in rows:
            groups.setdefault(r.get(args.company_col) or "(no company)", []).append(r)
        out = {co: resolve_primary(cands, titles) for co, cands in groups.items()}
        line = "\n".join(f"{co}: {r['primary_contact_id']} {r['primary_score']}"
                         + (f" TIE with {', '.join(x for x in r['tied'] if x != r['primary_contact_id'])}" if r["tie"] else "")
                         + f" ({r['primary_reason']})" for co, r in out.items())
    elif args.cmd == "quality":
        rows = _rows(args.file)
        out = {"summary": quality_summary(rows),
               "contacts": [{"contact": r.get("email") or r.get("name") or r.get("full_name"), **quality_score(r)} for r in rows]}
        sm = out["summary"]
        line = "\n".join(f"{x['score']:3d} {x['contact']}" + ("  needs email or phone" if x["needs_enrichment"] else "")
                         for x in out["contacts"]) + \
            f"\n# {sm['completeContacts']} of {sm['totalContacts']} complete, average {sm['averageScore']}, " \
            f"{sm['needingEnrichment']} still need an email or phone"
    else:
        d = _rows(args.file)[0] if args.file == "-" else json.loads(open(args.file).read())
        out = assign_tier(float(d["fit_score"]), bool(d.get("has_primary_contact")), d.get("company") or {},
                          d.get("criteria") or (d.get("thesis") or {}).get("criteria") or {})
        line = out["rationale"] + (" BORDERLINE: " + out["needs"] if out["borderline"] else "")
    print(json.dumps(out) if args.json else line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
