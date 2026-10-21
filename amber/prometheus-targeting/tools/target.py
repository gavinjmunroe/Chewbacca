#!/usr/bin/env python3
"""Turn the 1.04M-row prometheus file into a targeted, Clay-ready list.

    target.py --profile vc-ai --limit 500
    target.py --org-type VC,Angel --sector ai,software --limit 300 --out lists/x.csv
    target.py --audit                 what the file can and cannot segment on

Sagar, 2026-09-20: "figure out how to do a people search for each of the 5
companies we're fundraising. scoring and prioritizing this 220mb file is tough,
and we need subset lists to target."

The file is an INVESTOR database. That is the thing that makes it tractable:
org_type is filled on 100% of rows, so VC / Angel / Family Office / LP / PE
segmentation always works. sectors_norm is blank or "unknown" on 43% of the
usable pool, so sector filtering silently drops nearly half the list. Both
numbers are printed on every run rather than buried, because a list that looks
short is usually a filter that quietly ate it.
"""
import argparse, csv, os, re, sqlite3, sys

DB = os.path.expanduser("~/Downloads/One-Pagers/prometheus.db")

# Rank order: who can write a check, reachable, and confidently identified.
SENIORITY_RANK = {"A_founder_cxo": 3, "B_vp_director": 2, "D_other_titled": 1,
                  "C_manager_ic": 1, "unknown": 0}
GRADE_RANK = {"A": 2, "B": 1}

# Named profiles, so a company maps to a list without re-deriving the SQL.
PROFILES = {
    "vc-ai":        dict(org_type="VC,Investor", sector="ai,software", desc="AI or software VCs"),
    "vc-any":       dict(org_type="VC,Investor", sector="", desc="Every VC, sector unfiltered"),
    "angel":        dict(org_type="Angel", sector="", desc="Angels, smallest checks, fastest yes"),
    "family-office":dict(org_type="Family Office", sector="", desc="Family offices"),
    "lp":           dict(org_type="LP,Pension,Endowment", sector="", desc="LPs, for fund raises not company raises"),
    "pe":           dict(org_type="PE", sector="", desc="Private equity"),
    "crypto":       dict(org_type="VC,Angel,Investor", sector="crypto", desc="Crypto-exposed investors"),
    "fintech":      dict(org_type="VC,Angel,Investor,Family Office", sector="fintech,financial services,banking", desc="Fintech and financial services"),
    "realestate":   dict(org_type="VC,PE,Family Office", sector="real estate,construction", desc="Real estate and construction"),
    "healthcare":   dict(org_type="VC,Investor", sector="healthcare", desc="Healthcare"),
}

# Role inboxes are not people. 984 of the 52,350 are info@, contact@ and the
# like, attached to a real person's name so they look fine in a spreadsheet.
# Sending a personalised founder email to info@ is how a sending domain gets
# burned, which matters more than the 1.9% of volume it costs.
ROLE_PREFIXES = ("info@","contact@","hello@","admin@","support@","sales@",
                 "team@","office@","inquiries@","enquiries@","general@","ir@",
                 "press@","marketing@","careers@","jobs@","help@","noreply@",
                 "no-reply@","mail@","email@","hi@")

# The organization column is junk on 48% of the pool, in four distinct ways,
# and `chewbacca list-audit` found this after a hand-rolled audit missed it:
#   9,526  the literal string "Person", the entity type leaked into the column
#   8,259  blank
#   4,894  "Unknown", plus 985 "Company"/"company"
#   1,289  Airtable image attachments, e.g. 11283.jpg (https://dl.airtable.com/...)
# Personalising {{company}} against any of those sends a broken email. Worse,
# "Person" and "Unknown" look like data in a spreadsheet, so they survive an
# eyeball check and only surface after the send.
COMPANY_JUNK = ("person", "company", "unknown", "n/a", "none", "-", "null")

BASE = """
  entity_kind='Person'
  AND email IS NOT NULL AND email != ''
  AND grade IN ('A','B')
  AND """ + "(" + " AND ".join(
      f"lower(email) NOT LIKE '{p}%'" for p in ROLE_PREFIXES) + ")"

# Applied unless --any-company. Default on, because the default should be the
# list you can actually send.
COMPANY_OK = (" AND organization IS NOT NULL AND trim(organization) != ''"
              " AND lower(trim(organization)) NOT IN (%s)"
              " AND organization NOT LIKE '%%dl.airtable.com%%'"
              " AND organization NOT LIKE '%%.jpg%%'"
              " AND organization NOT LIKE '%%.png%%'"
              " AND organization NOT LIKE 'http%%'"
              % ",".join(f"'{c}'" for c in COMPANY_JUNK))

def connect():
    if not os.path.exists(DB):
        sys.exit(f"no prometheus.db at {DB}")
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True)

def audit(con):
    q = lambda s: con.execute(s).fetchone()[0]
    total = q("select count(*) from contacts")
    people = q("select count(*) from contacts where entity_kind='Person'")
    pool = q(f"select count(*) from contacts where {BASE}")
    print(f"  {total:>9,}  rows in the file")
    print(f"  {people:>9,}  are people ({total-people:,} are organizations, not humans)")
    print(f"  {pool:>9,}  people with an email and grade A or B  <- the real pool, {pool/total*100:.1f}%")
    print()
    print("  Segmentable on (fill rate within that pool):")
    for col in ("org_type","seniority_tier","region","title","organization",
                "linkedin","city","sectors_norm","aum","check_size"):
        n = q(f"select count(*) from contacts where {BASE} and {col} is not null and {col} != '' and lower({col}) != 'unknown'")
        bar = "#" * int(n/pool*28)
        print(f"    {col:<16} {n:>7,}  {n/pool*100:5.1f}%  {bar}")
    print()
    print("  org_type is the axis that always works:")
    for ot, c in con.execute(f"select org_type, count(*) from contacts where {BASE} group by org_type order by 2 desc").fetchall():
        print(f"    {ot or '(blank)':<22} {c:>7,}")

def build(con, org_types, sectors, regions, seniority_only, limit, any_company=False):
    where = [BASE if any_company else BASE + COMPANY_OK]
    params = []
    if org_types:
        where.append("org_type IN (%s)" % ",".join("?"*len(org_types))); params += org_types
    if sectors:
        where.append("(" + " OR ".join(["lower(sectors_norm) LIKE ?"]*len(sectors)) + ")")
        params += [f"%{s.lower()}%" for s in sectors]
    if regions:
        where.append("(" + " OR ".join(["lower(region) LIKE ?"]*len(regions)) + ")")
        params += [f"%{r.lower()}%" for r in regions]
    if seniority_only:
        where.append("seniority_tier = 'A_founder_cxo'")
    sql = f"""select record_id, full_name, title, organization, org_type, email,
                     linkedin, city, region, sectors_norm, aum, check_size,
                     grade, grade_score, seniority_tier
              from contacts where {' AND '.join(where)}"""
    rows = con.execute(sql, params).fetchall()
    # Rank in python so the ordering is inspectable rather than buried in SQL.
    def score(r):
        return (SENIORITY_RANK.get(r[14], 0), GRADE_RANK.get(r[12], 0),
                float(r[13] or 0), 1 if r[6] else 0)
    rows.sort(key=score, reverse=True)
    # One person per email. The file has the same human under several records.
    seen, out = set(), []
    for r in rows:
        e = (r[5] or "").strip().lower()
        if not e or e in seen:
            continue
        r = list(r)
        # Blank a LinkedIn slug that cannot be vouched for, keep the row.
        if r[6] and not linkedin_matches(r[1], r[6]):
            r[6] = ""
        seen.add(e); out.append(r)
        if limit and len(out) >= limit:
            break
    return out, len(rows)

def linkedin_matches(name, slug):
    """Does the slug plausibly belong to this person?

    list-audit found that where a slug shares no token with the name, 89.7%
    are confirmed wrong when triangulated against the email domain. Christopher
    Hehmeyer's row carried /in/shannon-collins-thackray. Personalising off a
    stranger's profile is worse than not personalising, because it is specific
    and wrong, so a slug that cannot be vouched for is dropped rather than
    passed to Clay.
    """
    if not slug or not name:
        return False
    slug_l = slug.lower()
    parts = [w for w in re.split(r"[^a-z]+", name.lower()) if len(w) > 2]
    if not parts:
        return False
    # Slugs are usually first-last, sometimes with a hash suffix.
    return any(w in slug_l for w in parts)


COLS = ["record_id","full_name","title","organization","org_type","email",
        "linkedin","city","region","sector","aum","check_size","grade",
        "grade_score","seniority"]

def main():
    ap = argparse.ArgumentParser(description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", choices=sorted(PROFILES))
    ap.add_argument("--org-type", default="")
    ap.add_argument("--sector", default="")
    ap.add_argument("--region", default="")
    ap.add_argument("--any-company", action="store_true",
                    help="keep rows whose company name is junk (Person, Unknown, an image URL). "
                         "Off by default: {{company}} breaks on 48%% of the file")
    ap.add_argument("--all-seniority", action="store_true",
                    help="include below founder/CXO (default: founders and CXOs only)")
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--out")
    ap.add_argument("--audit", action="store_true")
    a = ap.parse_args()

    con = connect()
    if a.audit:
        audit(con); return 0

    ot, sec = a.org_type, a.sector
    if a.profile:
        p = PROFILES[a.profile]
        ot = ot or p["org_type"]; sec = sec or p["sector"]

    org_types = [x.strip() for x in ot.split(",") if x.strip()]
    sectors   = [x.strip() for x in sec.split(",") if x.strip()]
    regions   = [x.strip() for x in a.region.split(",") if x.strip()]

    rows, before_dedupe = build(con, org_types, sectors, regions,
                                not a.all_seniority, a.limit, a.any_company)
    print(f"  org_type : {org_types or 'any'}")
    print(f"  sector   : {sectors or 'any'}"
          + ("   <- WARNING: sectors_norm is empty or unknown on 43% of the pool,"
             " so this filter drops them silently" if sectors else ""))
    print(f"  seniority: {'founder/CXO only' if not a.all_seniority else 'all tiers'}")
    print(f"  company  : {'ANY, including junk' if a.any_company else 'real company name required'}")
    print(f"  matched {before_dedupe:,}, {len(rows):,} after one-per-email dedupe")
    if a.out:
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        with open(a.out, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh); w.writerow(COLS); w.writerows(rows)
        print(f"  wrote {a.out}")
    else:
        for r in rows[:12]:
            print(f"    {(r[1] or '?')[:26]:<27} {(r[2] or '')[:26]:<27} {(r[3] or '')[:24]:<25} {r[5]}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
