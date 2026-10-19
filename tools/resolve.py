#!/usr/bin/env python3
"""chewbacca resolve: answer a fact question from every source on hand, before asking a person.

    chewbacca resolve "city and zip for 2849 Summerdale Dr" --about "Gavin Munroe"
    chewbacca resolve "Caleb's mailing address" --about "Caleb Newton"
    chewbacca resolve "phone for Cliff Temple Baptist Church Dallas"

Caleb, 2026-10-11: "Never ask humans things that you don't need a human for",
after an agent asked him for the city and zip of 2849 Summerdale Dr ("1 search
online away"), then asked for his own address, which was in his own contact
card the whole time. Asking was the cheapest move the agent had. This makes
looking it up cheaper: one call runs the person's own records, the second
brain, a US address completion and a Maps place search, and prints each answer
with where it came from. Nothing found means ask, and say what was checked.

Read only. Nothing here writes, sends or signs in.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HOME = Path.home()
BRAIN = Path(os.environ.get("CHEWBACCA_BRAIN") or HOME / "second-brain")
TIMEOUT = 20
STREET = re.compile(r"\b\d{1,6}\s+[A-Z0-9][\w.'-]*(?:\s+[\w.'-]+){0,4}?\s+"
                    r"(?:St|Street|Ave|Avenue|Dr|Drive|Rd|Road|Blvd|Boulevard|Ln|Lane|Way|Ct|Court|Pl|Place|"
                    r"Pkwy|Parkway|Cir|Circle|Ter|Terrace|Hwy|Highway)\b\.?", re.I)
STATES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
          "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
          "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
          "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
          "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
          "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
          "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
          "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
          "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
          "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"}
# Metro names people say instead of a state. Only cities this kit's people
# have actually been from; extend when a lookup misses one.
CITIES = {"dallas": "TX", "dfw": "TX", "fort worth": "TX", "austin": "TX", "houston": "TX", "hurst": "TX",
          "los angeles": "CA", "usc": "CA", "san marino": "CA", "pasadena": "CA",
          "phoenix": "AZ", "seattle": "WA", "boston": "MA", "chicago": "IL", "new york": "NY"}


def run(argv: list[str]) -> str:
    if not shutil.which(argv[0]):
        return ""
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=TIMEOUT).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "chewbacca-resolve"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read())
    except (OSError, ValueError):
        return None


def states_in(text: str) -> list[str]:
    """US states a block of text points at, by code, name or a known city, in order."""
    out = []
    low = (text or "").lower()
    for code, name in STATES.items():
        # A bare " UT" is the University of Texas as often as Utah, so a code
        # counts only in address shape: ", TX" or "TX 76054".
        if re.search(rf"\b{name.lower()}\b", low) or re.search(rf",\s*{code}\b|\b{code}\s+\d{{5}}\b", text or ""):
            out.append(code)
    for city, code in CITIES.items():
        if re.search(rf"\b{re.escape(city)}\b", low):
            out.append(code)
    return list(dict.fromkeys(out))


def street_in(text: str) -> str:
    m = STREET.search(text or "")
    return m.group(0).strip().rstrip(".") if m else ""


def complete_address(street: str, states: list[str], fetch=fetch_json) -> list[dict]:
    """US Census geocoder: a street plus a state comes back as one exact postal address."""
    found = []
    for st in states or [""]:
        q = f"{street}, {st}" if st else street
        url = ("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current"
               "&format=json&address=" + urllib.parse.quote(q))
        d = fetch(url) or {}
        want = street.lower().split()[:2]  # house number and the street's first word
        for m in ((d.get("result") or {}).get("addressMatches") or [])[:3]:
            addr = m.get("matchedAddress")
            # The geocoder fuzzes: "Summerdale Dr, CA" came back as 2849
            # Summerdays Ct, San Jose. Only the same number and street count.
            if not addr or addr.lower().split()[:2] != want:
                continue
            if addr not in {f["answer"] for f in found}:
                found.append({"answer": addr.title().replace(", Tx,", ", TX").replace(", Ca,", ", CA"),
                              "source": f"US Census geocoder for \"{q}\""})
    return found


# Where facts about people live in the brain: the contacts export, the core
# notes, memory, domains, projects and the people store, about 35 MB. The
# whole repo is 3 GB of mail cache and raw imports, and a grep over it took
# 43 s and timed out (2026-10-11); these read in well under a second.
FACT_STORES = ("chewbacca/agents/contacts.csv", "core", "memory", "domains", "projects", "chewbacca/people")
TEXT = (".md", ".csv", ".json", ".jsonl", ".txt", ".yaml", ".yml")


def brain_lines(terms: list[str], limit: int = 8, keep=None) -> list[str]:
    """Lines in the brain's fact stores that mention every term."""
    rows = []
    low_terms = [t.lower() for t in terms if t]
    for rel in FACT_STORES:
        base = BRAIN / rel
        files = [base] if base.is_file() else sorted(base.rglob("*")) if base.is_dir() else []
        for f in files:
            if not f.is_file() or f.suffix not in TEXT or f.stat().st_size > 5_000_000:
                continue
            try:
                for line in f.read_text(errors="replace").splitlines():
                    low = line.lower()
                    if all(t in low for t in low_terms) and (keep is None or keep(line)):
                        rows.append(line[:400])
                        if len(rows) >= limit:
                            return rows
            except OSError:
                continue
    return rows


def contact_card(name: str) -> list[dict]:
    raw = run(["mac", "contacts", "find", name, "--json"])
    try:
        cards = json.loads(raw) if raw.strip() else []
    except ValueError:
        return []
    out = []
    for c in cards if isinstance(cards, list) else []:
        for k in ("emails", "phones", "addresses"):
            for v in c.get(k) or []:
                out.append({"answer": f"{k[:-1] if k != 'addresses' else 'address'}: {v}",
                            "source": f"Contacts card \"{c.get('name')}\""})
    return out


def places(query: str) -> list[dict]:
    # The kit's own command when PATH has none: a runtime-only install puts
    # no `chewbacca` on PATH (a stranger's install, rehearsed 2026-10-13).
    cli = shutil.which("chewbacca") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "bin", "chewbacca")
    raw = run([cli,
               "api", "call", "google-maps", "searchPlaces", f"query={query}"])
    try:
        d = json.loads(raw.splitlines()[0]) if raw.strip() else {}
    except (ValueError, IndexError):
        return []
    out = []
    for p in (d.get("data") or [])[:3]:
        bits = [p.get(k) for k in ("name", "address", "phone", "website") if p.get(k)]
        out.append({"answer": " | ".join(bits), "source": f"Google Maps for \"{query}\""})
    return out


def resolve(question: str, about: str = "", fetch=fetch_json, context: str = "") -> dict:
    answers, checked = [], []
    about = " ".join((about or "").split())
    if about:
        # Only name a source that actually ran: with mac and people missing,
        # the reply still said "Checked: Contacts, people brief" (break-it,
        # 2026-10-19).
        if shutil.which("mac"):
            checked.append("Contacts")
            answers += contact_card(about)
        if shutil.which("people"):
            checked.append("people brief")
            context += run(["people", "brief", about])
        checked.append("second brain")
        # The whole name, in order. Any line holding both words in any order
        # answered "Gavin Munroe" with Zed Munroe's address from a line that
        # named both (break-it, 2026-10-19).
        # contacts.csv keeps first and last name in separate leading fields,
        # so a row whose first field is the first name and one of the next
        # three is the last name counts too.
        parts = about.split()
        named = re.compile(r"\b" + r"\s+".join(map(re.escape, parts)) + r"\b", re.I)

        def names_them(line):
            if named.search(line):
                return True
            if len(parts) > 1 and "," in line:
                fields = [f.strip().strip('"').lower() for f in line.split(",")[:4]]
                return fields[0] == parts[0].lower() and parts[-1].lower() in fields[1:]
            return False

        context += "\n".join(brain_lines([parts[-1], parts[0]], keep=names_them))
        for r in brain_lines([parts[-1], parts[0]], limit=3,
                             keep=lambda l: names_them(l) and bool(street_in(l))):
            m = re.search(STREET.pattern + r"[^|\n\"]{0,40}?\b\d{5}\b", r, re.I)
            answers.append({"answer": (m.group(0) if m else street_in(r)).strip(), "source": "second brain"})
    street = street_in(question)
    loose = re.search(r"\b(\d{2,6}\s+[A-Z][a-z]+)\b(?!\s+(?:St|Street|Ave|Dr|Rd|Ln|Ct|Way|Blvd)\b)", question)
    states = list(dict.fromkeys(states_in(question) + states_in(context)))
    if street:
        checked.append("US Census geocoder")
        answers += complete_address(street, states, fetch)
    elif loose:
        # "2849 Summerdale" with no Dr: the 10-11 question as typed. Try the
        # common suffixes; only an exact number and street name counts.
        checked.append("US Census geocoder")
        hits = []
        for st in states[:4]:
            for suffix in ("Dr", "St", "Ave", "Rd", "Ln", "Ct", "Way", "Blvd"):
                hits = complete_address(f"{loose.group(1)} {suffix}", [st], fetch)
                if hits:
                    break
            if hits:
                answers += hits
                break
    elif not about:
        checked.append("Google Maps")
        answers += places(question)
    return {"question": question, "about": about, "answers": answers, "checked": checked}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="chewbacca resolve", description=__doc__.splitlines()[0])
    ap.add_argument("question")
    ap.add_argument("--about", default="", help="the person or organization it's about")
    ap.add_argument("--context", default="", help="surrounding text to mine for a state or a name")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    r = resolve(a.question, a.about, context=a.context)
    if a.json:
        print(json.dumps(r, indent=1))
    else:
        for x in r["answers"]:
            print(f"{x['answer']}\n  from {x['source']}")
        if not r["answers"]:
            print(f"Nothing found. Checked: {', '.join(r['checked']) or 'nothing applied'}. Ask, and say that.")
    return 0 if r["answers"] else 1


if __name__ == "__main__":
    sys.exit(main())
