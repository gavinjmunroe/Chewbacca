#!/usr/bin/env python3
"""Turn an audited church list into gtme leads and opening lines for one region.

    python3 ops/lists/to_gtme.py dfw ops/lists/dfw-2026-10-11.csv

Writes ops/gtme/<region>/leads.csv and ops/gtme/<region>/lines.json. The
audit's hook is written for us ("sits 1785px down on a phone"); a pastor
reads the line here, so each hook shape is rewritten in plain words with the
page it came from as the source. A hook shape with no rewrite gets no line,
and gtme holds that church because the plan requires one.

A contact goes in only with a published email on the church's own domain.
Anything else (a denomination's site, a staffer's university address) would
email the wrong organization.
"""
import csv
import json
import math
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent.parent
# The audit measured at a 390x844 iPhone viewport, so one screen is 844px.
SCREEN_PX = 844


def domain(url_or_email: str) -> str:
    s = (url_or_email or "").strip().lower()
    host = s.split("@", 1)[1] if "@" in s and "://" not in s else urlparse(s if "://" in s else "http://" + s).hostname or ""
    parts = host.removeprefix("www.").split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def first_url(text: str) -> str:
    m = re.search(r"https?://\S+", text or "")
    return m.group(0).rstrip('.,)"') if m else ""


def line_for(row: dict):
    """(line, source) in words a pastor reads, or (None, None) for a shape we haven't written."""
    hook, site, name = row.get("hook") or "", row.get("website") or "", row.get("name") or "your church"
    m = re.match(r"The first service time sits (\d+)px down on a phone", hook)
    if m:
        screens = max(2, math.ceil(int(m.group(1)) / SCREEN_PX))
        return (f"On a phone, a guest has to scroll about {screens} screens down {name}'s homepage before "
                "they see a service time.", site)
    if hook.startswith("The first service time never appears on the homepage"):
        return f"{name}'s homepage doesn't show its service times, so a guest has to go looking for when to come.", site
    if hook.startswith("The address is not on the first phone screen"):
        return f"On a phone, {name}'s address isn't on the first screen of the homepage.", site
    if hook.startswith("No viewport tag"):
        return (f"On a phone, {name}'s site loads the desktop layout shrunk down, so the text is tiny and hard "
                "to tap.", site)
    if hook.startswith("No plan-a-visit form"):
        src = first_url(hook) or site
        return (f"A first-time guest on {name}'s site can't tell you they're coming. There's no plan a visit "
                "form, just information.", src)
    if hook.startswith("The newcomer page leaves first-time families guessing about"):
        topics = hook.split("guessing about", 1)[1].strip().rstrip(".")
        return f"{name}'s newcomer page doesn't answer {topics}, which first-time families usually want to know.", site
    if hook.startswith('A link on the homepage leads to "'):
        return f"One of the links on {name}'s homepage goes to a page not found.", first_url(hook) or site
    if hook.startswith("The homepage links to a spam page"):
        return (f"A link on {name}'s homepage points to an online casino page, which usually means someone "
                "got into the site.", site)
    if hook.startswith("Template placeholder text is live"):
        return f"One of {name}'s pages still shows placeholder text from the website template.", first_url(hook) or site
    if hook.startswith("No connect card"):
        return f"The only next step on {name}'s site is an email link, so a guest who wants to connect has to write in.", site
    return None, None


def main(region: str, src: str) -> int:
    rows = list(csv.DictReader(open(src)))
    out_dir = ROOT / "ops" / "gtme" / region
    leads, lines, skipped = [], {}, {"no_email": 0, "off_domain": 0, "no_line": 0}
    for r in rows:
        email = (r.get("contact_email") or "").strip().lower()
        role = ""
        if not email and (r.get("role_email") or "").strip():
            # A church with no named buyer email gets its own published role
            # inbox, greeted as "<church> team" (gtme's role_inbox).
            email, role = r["role_email"].strip().lower(), "1"
        if not email:
            skipped["no_email"] += 1
            continue
        if domain(email) != domain(r.get("website") or ""):
            skipped["off_domain"] += 1
            continue
        line, source = line_for(r)
        if not line:
            skipped["no_line"] += 1
            continue
        leads.append({"company": r["name"], "website": r["website"], "name": r.get("contact_name") or "",
                      "title": r.get("contact_title") or "", "linkedin": "", "email": email,
                      "location": r.get("address") or "", "source": r.get("contact_source_url") or "",
                      "why": r.get("fix") or "", "role_inbox": role})
        lines[email] = {"line": line, "source": source}
    with (out_dir / "leads.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(leads[0]) if leads else ["company", "website", "name", "title",
                                                                       "linkedin", "email", "location", "source",
                                                                       "why", "role_inbox"])
        w.writeheader()
        w.writerows(leads)
    (out_dir / "lines.json").write_text(json.dumps(lines, indent=1) + "\n")
    print(json.dumps({"region": region, "rows": len(rows), "leads": len(leads), "skipped": skipped}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
