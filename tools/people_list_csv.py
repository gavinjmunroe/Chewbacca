#!/usr/bin/env python3
"""Build a ranked, workable CSV of people from the people store for one goal.

Usage:
  people_list_csv.py --goal Dream --picks picks.json --out "~/Downloads/x.csv"

Picks are the hand-written top rows (Priority 1): a JSON list of objects with
store_name, name, title, organization, location, category, help, ask,
how_known, intro_path, source, relationship. Everything else comes from the
people store, tagged by title and location, with category-level reasons.
The column standard lives in .claude/rules/deliverables.md ("A list of people
or companies someone will work from").
"""
import argparse, collections, csv, json, os, re, sqlite3

DB = os.path.expanduser("~/.chewbacca/people/people.db")
COLS = ["Priority", "Group", "Name", "Title", "Organization", "Location", "Category", "Seniority",
        "How they help {goal}", "Suggested ask", "How Caleb knows them",
        "Relationship to Caleb", "Last contact", "Intro path", "LinkedIn",
        "Status", "Next step", "Next step date", "Notes", "Source"]
CATEGORIES = ["Mentor", "Advisor", "Investor", "Funder", "Pilot org (university)",
              "Pilot org (nonprofit)", "Pilot org (global)", "Connector",
              "Workforce / talent", "Accelerator / program", "Peer founder",
              "Operator at top company", "Contact"]
# Interns, students and members were most of the noise on the first pass of
# the Dream list (2026-11-03): a club member is not a pilot org.
NOISE = r"(intern|student|scholar|undergrad|class of|candidate|member\b|volunteer|work study|fellow\b|participant|cadet|midshipman|tutor|research assistant|ambassador|seasonal)"
# Word boundaries matter: without them `india` matched Indiana and `cto`
# matched Doctoral on that same pass.
EMERGING = r"\b(nigeria|ghana|kenya|india|pakistan|bangladesh|philippines|indonesia|vietnam|ethiopia|uganda|rwanda|south africa|egypt|brazil|colombia|peru|malawi|nepal|tanzania|lagos|nairobi|islāmābād|islamabad|manila|makati|quezon|delhi|bengaluru|kampala|naivasha)\b"
LEAD = r"\b(founder|co-founder|ceo|chief|director|partner|head|president|manager|lead|principal|coo|cto)\b"
RULES = [
    ("Investor", r"(venture capital|\bventures?\b|\bvc\b|general partner|managing partner|venture partner|angel investor|\binvestor\b|investment partner|venture scout|dorm room fund|praxis|capital partners)"),
    ("Pilot org (university)", r"(dean|provost|professor|lecturer|faculty|admission|academic advis|academic program|student affairs|career (center|services)|strategic partnerships)"),
    ("Pilot org (nonprofit)", r"(nonprofit|non-profit|foundation|executive director|ministry|community impact|social enterprise|impact)"),
    ("Workforce / talent", r"(talent|recruit|people ops|human resources|\bhr\b|workforce|career coach|learning and development)"),
    ("Accelerator / program", r"(accelerator|incubator|techstars|y combinator|google\.org|program manager|community manager)"),
    ("Peer founder", r"(founder|\bceo\b|co-founder|cofounder)"),
    ("Operator at top company", r"(google|meta\b|apple|amazon|microsoft|openai|anthropic|nvidia|stripe|linkedin|mckinsey|bain|bcg|goldman|jpmorgan|deloitte|salesforce|netflix|tesla|spacex|palantir|uber|airbnb)"),
]
HELP = {
    "Pilot org (global)": ("Leads or builds in an emerging market, the setting {goal} wants to lift people in.", "Ask what stops talented people around them from reaching the right people, and if they'd pilot {goal}"),
    "Investor": ("Invests in early companies. Fundraising or advice when {goal} is ready.", "Share a one-line {goal} update and ask for 15 min of feedback"),
    "Pilot org (university)": ("Works inside a university, where {goal}'s B2B pilots can start.", "Ask who at their school owns student outcomes and if a small pilot fits"),
    "Pilot org (nonprofit)": ("Runs or works at a mission org whose people could grow through {goal}.", "Ask if their community could pilot {goal}"),
    "Workforce / talent": ("Works in recruiting or talent, the other side of the people {goal} helps get seen.", "Ask what makes a candidate stand out to them and if they'd be a helper on {goal}"),
    "Accelerator / program": ("Runs programs for founders or students, a channel to many {goal} users at once.", "Ask if {goal} could plug into their program"),
    "Peer founder": ("Founder in Caleb's network. Peer advice, early users or partners.", "Ask for 15 min of feedback on {goal} and who they'd want to reach through it"),
    "Contact": ("Someone Caleb has emailed or met with. No title on file, so check who they are before reaching out.", "Ask Caleb who they are first"),
    "Operator at top company": ("Works at a top company, the kind of person {goal} users want to reach.", "Ask if they'd be an early helper on {goal}, taking one intro a month"),
}
# Seniority from the title alone. Langston (2026-11-03) wants to learn under
# people with decades of experience, so the sheet has to sort those to the top.
SENIOR = r"\b(president|ceo|chief|dean|provost|professor|managing partner|general partner|partner|executive director|founder & executive|vice president|vp\b|svp|evp|head of|managing director|principal)\b"
EARLY = r"\b(associate|analyst|coordinator|junior|assistant|specialist|engineer|designer|representative)\b"


def seniority(title):
    t = (title or "").lower()
    if re.search(SENIOR, t):
        return "Senior leader"
    if re.search(EARLY, t):
        return "Early career"
    return "Mid / founder"


# The long tail is grouped by who the reader can learn from first: senior
# people Caleb actually talks to, then senior people he only has on LinkedIn.
TAIL_GROUPS = ["Senior leaders Caleb knows", "Senior leaders, LinkedIn only",
               "Founders and operators Caleb knows",
               "Emailed or met with Caleb, no title on file", "Everyone else"]


def tail_group(sen, rel):
    if sen == "Senior leader":
        return TAIL_GROUPS[0] if rel != "LinkedIn only" else TAIL_GROUPS[1]
    return TAIL_GROUPS[2] if rel != "LinkedIn only" else TAIL_GROUPS[4]


REL_ORDER = {"Close": 0, "Know them": 1, "Via TTS": 1, "LinkedIn only": 2}


def cell(value):
    """A cell a spreadsheet won't run. Names and titles come from LinkedIn, which
    anyone can set to =HYPERLINK(...), so a leading = + - @ tab or CR gets a quote."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def load_people():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute("""
      select p.id, p.name, p.company, p.role, p.location, p.linkedin, p.how_we_met,
             p.li_connected_on, s.warmth, s.last_interaction_at as last,
             (select count(*) from messages m where m.person_id = p.id) as msgs
      from people p left join person_scores s on s.person_id = p.id
      where p.deleted_at is null""").fetchall()
    return [dict(r) for r in rows]


# Role inboxes that came through Caleb's sent mail on 2026-11-03: "Health
# Leave Team", "USC Club-Baseball", "USG Chief Financial Officer".
ROLE_INBOX = r"\b(team|club|office|officer|committee|department|dept|center|support|admissions|help|desk|usg|usc|ucla|council|board|staff|vice president|president|info)\b"


def merge_mail(people, mail):
    """Fold Gmail and Calendar correspondents into the people list.

    A correspondent already in the store (same email, or same full name) adds
    their counts to that record; anyone else becomes a new row with what the
    headers carry: name, the address's domain as the organization, counts."""
    by_email = {(p.get("email") or "").lower(): p for p in people if p.get("email")}
    by_name = {p["name"].lower(): p for p in people}
    for addr, m in mail.items():
        name = (m.get("name") or "").strip()
        hit = by_email.get(addr) or (by_name.get(name.lower()) if " " in name else None)
        touches = (m.get("emails") or 0) + (m.get("meetings") or 0)
        if hit:
            hit["msgs"] = (hit.get("msgs") or 0) + touches
            hit["last"] = max(hit.get("last") or "", m.get("last") or "")
            continue
        if " " not in name or re.search(ROLE_INBOX, name.lower()):
            continue  # a bare address, a list, a bot or a role inbox, not a person
        domain = addr.split("@")[-1]
        generic = domain in ("gmail.com", "yahoo.com", "icloud.com", "hotmail.com", "outlook.com", "me.com", "aol.com")
        people.append({"id": "mail:" + addr, "name": name, "company": "" if generic else domain,
                       "role": "", "location": "", "linkedin": "", "li_connected_on": "",
                       "how_we_met": f"Emailed {m.get('emails', 0)}x, met {m.get('meetings', 0)}x",
                       "warmth": 0, "msgs": touches, "last": m.get("last") or "", "touches": touches})
    return people


def relationship(p):
    warmth, msgs = p.get("warmth") or 0, p.get("msgs") or 0
    # 0.5 warmth or 50 messages: everyone Caleb would call close on the Dream
    # pass cleared it, and no LinkedIn-only contact did.
    if warmth >= 0.5 or msgs >= 50:
        return "Close"
    if msgs > 0 or warmth >= 0.15:
        return "Know them"
    return "LinkedIn only"


def categorize(p):
    role, comp = p.get("role") or "", p.get("company") or ""
    text, loc = f"{role} {comp}".lower(), (p.get("location") or "").lower()
    if not text.strip() or re.search(NOISE, role.lower()):
        return None
    if (re.search(EMERGING, loc) or re.search(EMERGING, comp.lower())) and re.search(LEAD, role.lower()):
        return "Pilot org (global)"
    for cat, rx in RULES:
        if re.search(rx, text):
            return cat
    return None


def build(goal, picks, people, exclude=()):
    help_col = f"How they help {goal}"
    by_name = {p["name"]: p for p in people}
    rows, seen = [], set()
    groups = []
    for pk in picks:
        g = pk.get("group") or "Hand-picked"
        if g not in groups:
            groups.append(g)
    picks = sorted(picks, key=lambda pk: groups.index(pk.get("group") or "Hand-picked"))
    for pk in picks:
        if pk["category"] not in CATEGORIES:
            raise SystemExit(f"pick {pk['name']}: category {pk['category']!r} is not one of {CATEGORIES}")
        p = by_name.get(pk.get("store_name") or "") or {}
        if p:
            seen.add(p["id"])
        g = pk.get("group") or "Hand-picked"
        rows.append({"Priority": str(groups.index(g) + 1), "Group": g, "Name": pk["name"], "Title": pk["title"],
                     "Organization": pk["organization"], "Location": pk["location"],
                     "Category": pk["category"], "Seniority": pk.get("seniority") or seniority(pk["title"]), help_col: pk["help"],
                     "Suggested ask": pk["ask"], "How Caleb knows them": pk["how_known"],
                     "Relationship to Caleb": pk["relationship"],
                     "Last contact": (p.get("last") or "")[:10],
                     "Intro path": pk["intro_path"], "LinkedIn": p.get("linkedin") or "",
                     "Status": "Not started", "Next step": "", "Next step date": "",
                     "Notes": "", "Source": pk["source"]})
    picked = {pk.get("store_name", "").lower() for pk in picks} | {pk["name"].lower() for pk in picks}
    tail = {}
    for p in people:
        if p["id"] in seen or p["name"].lower() in picked or any(x in p["name"].lower() for x in exclude):
            continue
        cat = categorize(p)
        if not cat and p.get("touches"):
            cat = "Contact"
        if not cat:
            continue
        rel = relationship(p)
        h, a = HELP[cat]
        name = p["name"].strip("'\" ")
        sen = seniority(p.get("role"))
        group = TAIL_GROUPS[3] if cat == "Contact" else tail_group(sen, rel)
        row = {"Priority": str(len(groups) + TAIL_GROUPS.index(group) + 1), "Group": group,
               "Name": name, "Title": p.get("role") or "",
               "Organization": p.get("company") or "", "Location": p.get("location") or "",
               "Category": cat, "Seniority": seniority(p.get("role")), help_col: h.format(goal=goal),
               "Suggested ask": a.format(goal=goal),
               "How Caleb knows them": p.get("how_we_met") or ("LinkedIn connection" if p.get("li_connected_on") else "Caleb's contacts"),
               "Relationship to Caleb": rel, "Last contact": (p.get("last") or "")[:10],
               "Intro path": "Caleb intro, ask him first", "LinkedIn": p.get("linkedin") or "",
               "Status": "Not started", "Next step": "", "Next step date": "", "Notes": "",
               "Source": "Caleb's people store (LinkedIn title)"}
        tail.setdefault((name.lower(), row["Organization"].lower()), row)
    rest = sorted(tail.values(), key=lambda r: (int(r["Priority"]), CATEGORIES.index(r["Category"]),
                                                 REL_ORDER.get(r["Relationship to Caleb"], 3), r["Name"]))
    return [c.format(goal=goal) for c in COLS], rows + rest


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--goal", required=True)
    ap.add_argument("--picks", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mail", help="JSON of everyone emailed or met with: {address: {name, emails, meetings, last}}")
    ap.add_argument("--exclude", action="append", default=[], help="drop names containing this (lowercase)")
    a = ap.parse_args()
    people = load_people()
    if a.mail:
        people = merge_mail(people, json.load(open(a.mail)))
    cols, rows = build(a.goal, json.load(open(a.picks)), people, tuple(a.exclude))
    with open(os.path.expanduser(a.out), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows({k: cell(v) for k, v in r.items()} for r in rows)
    print(len(rows), dict(collections.Counter(r["Priority"] for r in rows)))


if __name__ == "__main__":
    main()
