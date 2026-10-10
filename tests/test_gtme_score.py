"""gtme-score: Togari's scoring rubrics, ported, hermetic.

Every case from togari-platform's TypeScript tests for these functions
(routes/website/__tests__/website.test.ts scoreIcpLead and isWorkEmail,
enrichment/__tests__/primary-contact-resolver.test.ts, enrichment/__tests__/
tier-assigner.test.ts rule path), plus affiliation cases worked by hand from
affiliationScoring.ts. Where Togari calls Claude, the port must say so
(`tie`, `borderline`) rather than pretend it decided. No network, no model.
"""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.dont_write_bytecode = True
import gtme_score as s  # noqa: E402

TOOL = ROOT / "tools" / "gtme_score.py"
CHECKS = 0
NOW = datetime.now(timezone.utc).isoformat()


def ok(cond, msg=""):
    global CHECKS
    assert cond, msg
    CHECKS += 1


def test_lead_and_work_email():
    base = dict(full_name="Jane Smith", email="jane@acme.com", company="Acme", company_domain="acme.com",
                icp_description="multi-site dental groups in the Midwest", target_titles=["Founder / CEO"])
    top = s.score_icp_lead(**base)["score"]
    ok(top == 100, f"a complete brief from a matching work email scores 100, got {top}")
    ok(s.score_icp_lead(**{**base, "email": "jane@gmail.com"})["score"] < 80, "a personal-email lead scores lower")
    ok(s.score_icp_lead(**{**base, "email": "jane@totallyunrelated.io"})["score"] < top, "a mismatched work email scores lower")
    ok(s.score_icp_lead(**{**base, "icp_description": "SaaS", "target_titles": []})["score"] < top, "a thin brief scores lower")
    ok(not s.is_work_email("jane@gmail.com") and not s.is_work_email("jane@outlook.com"), "free providers are personal")
    ok(s.is_work_email("jane@acme.com"), "company domains are work addresses")


def test_affiliation():
    r = s.calculate_affiliation("jane@acme.com", "Acme Inc", "Acme", "https://www.acme.com/about")
    ok(r["emailDomainType"] == "company-match" and r["score"] == 100 and not r["autoReject"], f"exact domain match: {r}")
    r = s.calculate_affiliation("jane@mail.acme.com", "Acme", "Acme", "acme.com")
    ok(r["emailDomainType"] == "company-match" and r["score"] == 94, f"same registrable domain scores 90 on the domain half: {r}")
    r = s.calculate_affiliation("jane@gmail.com", "Acme", "Acme", "acme.com")
    ok(r["emailDomainType"] == "personal" and r["score"] == 70 and "Personal email" in r["warning"], f"personal: {r}")
    r = s.calculate_affiliation("bob@harbor-equipment.com", "Harbor Equipment", "Acme Landscaping", "acme.com")
    ok(r["autoReject"] and "equipment industry" in r["warning"], f"an industry mismatch auto-rejects: {r}")
    r = s.calculate_affiliation(None, None, "Acme", "acme.com")
    ok(r["emailDomainType"] == "unknown" and r["score"] == 20, f"nothing known gives the benefit of the doubt on name only: {r}")
    ok(abs(s.jaro_winkler("martha", "marhta") - 0.9611) < 0.001, "Jaro-Winkler matches the textbook value")
    ok(s.normalize_company_name("Acme Holdings, Inc.") == "acme holdings", "suffix and punctuation stripped")


def contact(**over):
    base = dict(contact_id="c", company_id="co-1", full_name="Jane Smith", title="CEO", email="jane@example.com",
                email_verified=True, mobile_phone="555-0100", linkedin_url="https://linkedin.com/in/x",
                last_activity_at=NOW, tenure_years=12)
    base.update(over)
    return base


def test_contact_rubric():
    T = s.DEFAULT_OWNER_TARGET_TITLES
    ok(s.score_candidate(contact(tenure_years=15), T)["score"] == 100, "CEO with every reach signal scores 100")
    r = s.score_candidate(contact(title="Director of Operations", email=None, email_verified=False, mobile_phone=None,
                                  last_activity_at=None, tenure_years=4), T)
    ok(r["score"] == 10, f"director with only LinkedIn scores 10, got {r}")
    r = s.score_candidate(contact(title="Former CEO", tenure_years=1), T)
    ok(r["score"] == 75 and any("former" in x for x in r["reasons"]), f"former CEO takes the -20: {r}")
    vp = dict(contact_id="x", company_id="co-1", title="VP Sales", email_verified=False, linkedin_url="https://x")
    a = s.score_candidate({**vp, "last_activity_at": NOW}, T)["score"]
    b = s.score_candidate({**vp, "last_activity_at": "2020-01-01T00:00:00Z"}, T)["score"]
    ok(a - b == 10, "recent activity is worth exactly 10")
    ok(s.score_candidate(contact(tenure_years=10, title="Manager"), T)["score"]
       - s.score_candidate(contact(tenure_years=9, title="Manager"), T)["score"] == 5, "tenure bonus only at 10+")
    ok(s.score_candidate(contact(title="Executive Assistant", email_verified=False, mobile_phone=None,
                                 linkedin_url=None, last_activity_at=None, tenure_years=0), T)["score"] == 0,
       "'Executive' is not 'ex-': no former penalty")


def test_resolve_primary():
    try:
        s.resolve_primary([])
        ok(False, "empty candidates must raise")
    except ValueError as e:
        ok("no candidates" in str(e), "empty candidates raise")
    ceo = contact(contact_id="ceo-1")
    ic = contact(contact_id="ic-1", title="Account Manager", email_verified=False, mobile_phone=None, tenure_years=1)
    r = s.resolve_primary([ic, ceo])
    ok(r["primary_contact_id"] == "ceo-1" and not r["tie"] and "title matches CEO" in r["primary_reason"]
       and "ic-1" in [x["contact_id"] for x in r["alternates"]], f"comfortable lead picks the rule winner: {r}")
    pres = contact(contact_id="pres-1", title="President", tenure_years=11)
    r = s.resolve_primary([ceo, pres])
    ok(r["tie"] and set(r["tied"]) == {"ceo-1", "pres-1"} and "Claude" in r["needs"],
       f"a tie within 5 says it needs the tiebreak instead of deciding: {r}")
    bare = dict(email_verified=False, mobile_phone=None, linkedin_url=None, last_activity_at=None, tenure_years=1)
    r = s.resolve_primary([contact(contact_id="ceo-1", **bare),
                           contact(contact_id="ops-1", title="Head of Plant Operations", **bare)],
                          ["Head of Plant Operations"])
    ok(r["primary_contact_id"] == "ops-1", "custom title keywords override the defaults")
    r = s.resolve_primary([contact(contact_id="a"),
                           contact(contact_id="b", title="VP Sales", email_verified=False, mobile_phone=None,
                                   last_activity_at=None, tenure_years=2),
                           contact(contact_id="c", title="Analyst", email_verified=False, mobile_phone=None,
                                   linkedin_url=None, last_activity_at=None, tenure_years=0)])
    ok([x["score"] for x in r["alternates"]] == sorted((x["score"] for x in r["alternates"]), reverse=True),
       "alternates in descending score order")


COMPANY = {"company_id": "co-1", "company_name": "Springdale Landscaping", "estimated_revenue": 18_000_000,
           "estimated_headcount": 75}
CRITERIA = {"revenue_range": {"min": 5_000_000, "max": 50_000_000}, "headcount_range": {"min": 25, "max": 250}}


def test_tier():
    ok(s.assign_tier(90, True, COMPANY, CRITERIA)["tier"] == 1, "high fit, reachable, on-band is tier 1")
    ok(s.assign_tier(70, True, COMPANY, CRITERIA)["tier"] == 2, "mid fit is tier 2")
    ok(s.assign_tier(40, False, COMPANY, CRITERIA)["tier"] == 3, "low fit is tier 3")
    ok(s.assign_tier(90, False, COMPANY, CRITERIA)["tier"] == 2, "no primary contact caps at tier 2")
    r = s.assign_tier(82, True, COMPANY, CRITERIA)
    ok(r["tier"] == 1 and r["borderline"] and "Claude" in r["needs"], "near a line it flags the model call Togari makes")
    r = s.assign_tier(78, True, COMPANY, CRITERIA)
    ok(r["borderline"] and r["tier"] == 2, "78 is borderline and the rule says 2")
    off = {**COMPANY, "estimated_revenue": 1, "estimated_headcount": 3}
    ok(s.assign_tier(95, True, off, CRITERIA)["tier"] == 2, "off-band size keeps a 95 out of tier 1")
    ok(s.assign_tier(95, True, {}, CRITERIA)["tier"] == 2, "an unknown size is off-band, not on")


def test_quality():
    full = {"name": "Jane Smith", "title": "CEO", "email": "jane@example.com", "phone": "(555) 010-0000"}
    ok(s.quality_score(full)["score"] == 75 and s.quality_score(full)["complete"], "the four base fields are 75")
    proven = {**full, "provenance": {"cross_source_verified": True, "business_role": "owner",
                                     "enformion": {"address_match_score": 50, "identity_score": 70}}}
    ok(s.quality_score(proven)["score"] == 100, "cross-source proof adds the last 25, thresholds inclusive")
    weak = {**full, "provenance": json.dumps({"enformion": {"address_match_score": 49, "identity_score": 69}})}
    ok(s.quality_score(weak)["score"] == 75, "just under each threshold adds nothing; provenance may arrive as a JSON string")
    ok(s.quality_score({"name": "Jane", "phone": "555-0100"})["score"] == 15, "a 7-digit phone is not a phone")
    r = s.quality_score({"name": "Jane", "email": "jane@example.com"})
    ok(r["complete"] and r["needs_enrichment"], "name plus email is complete but still needs a phone")
    ok(not s.quality_score({"email": "jane@example.com", "phone": "5550100000"})["complete"], "no name is never complete")
    sm = s.quality_summary([full, {"name": "Jane"}])
    ok(sm == {"totalContacts": 2, "completeContacts": 1, "averageScore": 45, "needingEnrichment": 1}, f"summary: {sm}")


def test_cli():
    p = subprocess.run([sys.executable, str(TOOL), "contact", "-", "--json"], capture_output=True, text=True, timeout=60,
                       input="contact_id,company_id,title,email,email_verified,linkedin_url\n"
                             "a,co-1,CEO,a@example.com,true,https://x\n"
                             "b,co-1,Analyst,b@example.com,false,\n"
                             "c,co-2,Founder,c@example.com,true,\n")
    out = json.loads(p.stdout)
    ok(p.returncode == 0 and out["co-1"]["primary_contact_id"] == "a" and out["co-2"]["primary_contact_id"] == "c",
       f"contact groups a CSV by company: {p.stdout[:300]} {p.stderr[-300:]}")
    p = subprocess.run([sys.executable, str(TOOL), "lead", "--name", "Jane", "--email", "jane@acme.com", "--company", "Acme",
                        "--domain", "acme.com", "--brief", "dental groups in Ohio", "--title", "CEO"],
                       capture_output=True, text=True, timeout=60)
    ok(p.returncode == 0 and p.stdout.startswith("100/100"), f"lead prints the score: {p.stdout}")


def main():
    for fn in (test_lead_and_work_email, test_affiliation, test_contact_rubric, test_resolve_primary, test_tier,
               test_quality, test_cli):
        fn()
    print(f"gtme-score: {CHECKS} checks passed")


if __name__ == "__main__":
    main()
