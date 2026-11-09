#!/usr/bin/env python3
"""Score the large DFW and SoCal churches for Medrano Partners (John Knox), five checks.

Reads the FF site audit (audit_site.py batch output) and writes one CSV row per church.
Read-only: nothing is fetched here and no email is guessed. Why-now is filled in by hand
research for the top rows and read from whynow.csv when present.

    python3 score.py audit-full.jsonl churches-above.json [whynow.csv] > ../medrano-leads.csv
"""
import csv
import json
import re
import sys

# Gloo takes gigachurches (5,000+ a week, John on 10/27). Our only size signals are campuses,
# service counts, named staff and Google reviews; these cutoffs are guessed, never measured.
# Reviews: in-band DFW churches topped out at 218 and Watermark (well over 5,000) has 892.
GIGA_CAMPUSES = 5
GIGA_STAFF = 120
GIGA_REVIEWS = 800

KNOWN_CHMS = ("Planning Center", "Rock", "Pushpay", "Ministry Platform", "MinistryPlatform", "CCB",
              "Church Community Builder", "Breeze", "Elvanto", "Fellowship One", "Realm",
              "ShelbyNext", "Subsplash", "Churchteams", "Tithely", "TouchPoint", "ACS")

BUYER = re.compile(r"executive pastor|operations|chief of staff|business administrator|church administrator|"
                   r"technology|\bit\b|information|digital|director of finance|administrative pastor", re.I)


def buyer_of(contacts):
    ranked = []
    for c in contacts or []:
        t = c.get("title", "")
        if not BUYER.search(t):
            continue
        # executive pastor first, then operations, then technology
        rank = 0 if re.search(r"executive pastor|chief of staff", t, re.I) else 1 if re.search(r"operat|admin", t, re.I) else 2
        ranked.append((rank, c))
    ranked.sort(key=lambda x: x[0])
    return ranked[0][1] if ranked else None


def main():
    audit = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
    src = {c["site_key"]: c for c in json.load(open(sys.argv[2]))}
    why = {}
    if len(sys.argv) > 3:
        why = {r["site_key"]: r for r in csv.DictReader(open(sys.argv[3]))}
    out = csv.writer(sys.stdout)
    out.writerow(["tier", "checks_passed", "church", "region", "website", "address", "phone",
                  "fit", "size_evidence", "stack", "buyer_name", "buyer_title", "buyer_email",
                  "role_inbox", "reach", "why_now", "why_now_source", "staff_page"])
    rows = []
    for a in audit:
        if a.get("status") != "ok":
            continue
        s = src.get(a.get("site_key"), {})
        campuses = max(a.get("campuses_stated") or 0, s.get("locations_merged") or 0)
        staff = a.get("staff_count") or 0
        reviews = s.get("review_count") or 0
        giga = campuses >= GIGA_CAMPUSES or staff >= GIGA_STAFF or reviews >= GIGA_REVIEWS
        fit = "giga (Gloo's)" if giga else "1,000 to 5,000 est."
        chms = (a.get("chms") or "").strip()
        stack_ok = any(k.lower() in chms.lower() for k in KNOWN_CHMS)
        b = buyer_of(a.get("contacts"))
        email = (b or {}).get("email", "")
        key = a.get("site_key", "")
        dom = key.split("/")[0]
        mails = [e.get("email", "") for e in a.get("page_emails") or []]
        inbox = next((m for m in mails if m.lower().endswith("@" + dom.removeprefix("www.")) and
                      re.match(r"(info|office|hello|contact|admin|connect)@", m, re.I)), "")
        reach = "buyer email" if email else ("role inbox" if inbox else "none published")
        w = why.get(key, {})
        checks = [not giga, stack_ok, bool(b), reach != "none published", bool(w.get("why_now"))]
        n = sum(checks)
        if giga:
            tier = "out (Gloo)"
        elif all(checks):
            tier = "A"
        elif checks[0] and checks[1] and checks[2]:
            tier = "B"
        else:
            tier = "C"
        rows.append([tier, n, s.get("name") or a.get("title"), s.get("region", ""), a.get("final_url") or a.get("input_url"),
                     s.get("address", ""), s.get("phone", ""), fit, a.get("attendance_evidence", ""),
                     chms or "not found", (b or {}).get("name", ""), (b or {}).get("title", ""), email, inbox, reach,
                     w.get("why_now", ""), w.get("source", ""), a.get("staff_url", "")])
    order = {"A": 0, "B": 1, "C": 2, "out (Gloo)": 3}
    rows.sort(key=lambda r: (order[r[0]], -r[1], r[2] or ""))
    out.writerows(rows)


if __name__ == "__main__":
    main()
