#!/usr/bin/env python3
"""Find free buying signals in public filings. `formd` lists recent SEC Form D raises.

A Form D is filed within 15 days of the first sale in a private offering, so it
often lands weeks before the press release. It says a company raised money and
who runs it. It does not say the company is buying anything.
"""

import argparse
import csv
from datetime import date, timedelta
import io
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ElementTree


SEARCH_URL = "https://efts.sec.gov/LATEST/search-index"
ARCHIVE_URL = "https://www.sec.gov/Archives/edgar/data"
DEFAULT_UA = "Chewbacca research caleb@bluemodernadvisory.com"
# SEC allows 10 requests a second per client (sec.gov/os/accessing-edgar-data).
# Five keeps half that headroom for anything else on this machine hitting EDGAR.
MIN_INTERVAL = 0.2
# Full-text search returned 100 hits per page on 2026-10-09 regardless of size,
# and Elasticsearch refuses `from` past 10,000.
PAGE_SIZE = 100
MAX_HITS = 10000
RETRY_CODES = (429, 500, 502, 503, 504)
ATTEMPTS = 4
FUND_GROUP = "Pooled Investment Fund"
FIELDS = ["issuer", "cik", "state", "city", "industry", "offering_amount", "amount_sold",
          "first_sale", "file_date", "is_amendment", "entity_type", "year_of_inc",
          "revenue_range", "people", "filing_url", "xml_url"]


class Fetcher:
    """Throttled HTTP GET with the descriptive User-Agent SEC requires."""

    def __init__(self, user_agent=None, interval=MIN_INTERVAL, sleep=time.sleep, clock=time.monotonic):
        self.user_agent = user_agent or os.environ.get("CHEWBACCA_SEC_UA") or DEFAULT_UA
        self.interval, self.sleep, self.clock = interval, sleep, clock
        self.last = None
        self.requests = 0

    def get(self, url):
        for attempt in range(ATTEMPTS):
            if self.last is not None:
                wait = self.interval - (self.clock() - self.last)
                if wait > 0:
                    self.sleep(wait)
            self.last = self.clock()
            self.requests += 1
            request = urllib.request.Request(url, headers={
                "User-Agent": self.user_agent, "Accept-Encoding": "identity"})
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    return response.read().decode("utf-8")
            except urllib.error.HTTPError as error:
                # The same full-text search URL returned 500 then 200 on retry
                # on 2026-10-09; 429 is SEC's rate limit.
                if error.code not in RETRY_CODES or attempt == ATTEMPTS - 1:
                    raise
                self.sleep(2 ** (attempt + 1))
        raise OSError("unreachable")


def accession_parts(cik, adsh):
    return int(cik), adsh.replace("-", "")


def xml_url(cik, adsh):
    number, folder = accession_parts(cik, adsh)
    return f"{ARCHIVE_URL}/{number}/{folder}/primary_doc.xml"


def filing_url(cik, adsh):
    number, folder = accession_parts(cik, adsh)
    return f"{ARCHIVE_URL}/{number}/{folder}/{adsh}-index.htm"


def search_page_url(since, until, offset):
    query = {"forms": "D", "dateRange": "custom", "startdt": since.isoformat(),
             "enddt": until.isoformat()}
    if offset:
        query["from"] = str(offset)
    return SEARCH_URL + "?" + urllib.parse.urlencode(query)


def parse_hits(document):
    """Reduce one full-text search page to the filings it lists."""
    hits = document.get("hits", {})
    total = hits.get("total", {}).get("value", 0)
    filings = []
    for hit in hits.get("hits", []):
        source = hit.get("_source", {})
        if not str(hit.get("_id", "")).endswith(":primary_doc.xml"):
            continue
        ciks = source.get("ciks") or []
        # Both end up in a URL and the accession number in a cache file name.
        if not ciks or not re.fullmatch(r"\d{1,10}", str(ciks[0])) \
                or not re.fullmatch(r"\d{10}-\d{2}-\d{6}", str(source.get("adsh", ""))):
            continue
        filings.append({
            "adsh": source["adsh"], "cik": ciks[0], "file_type": source.get("file_type", ""),
            "file_date": source.get("file_date", ""), "states": source.get("biz_states") or [],
            "name": (source.get("display_names") or [""])[0],
        })
    return filings, total


def search_filings(fetcher, since, until):
    """Yield every Form D primary document filed in the window, newest first."""
    offset, seen = 0, set()
    while offset < MAX_HITS:
        filings, total = parse_hits(json.loads(fetcher.get(search_page_url(since, until, offset))))
        for filing in filings:
            if filing["adsh"] not in seen:
                seen.add(filing["adsh"])
                yield filing
        offset += PAGE_SIZE
        if not filings or offset >= total:
            return


def text(node, path):
    found = node.find(path) if node is not None else None
    return found.text.strip() if found is not None and found.text else ""


def amount(value):
    return int(value) if re.fullmatch(r"\d+", value or "") else None


def person(info):
    first = text(info, "relatedPersonName/firstName")
    parts = [part for part in (first, text(info, "relatedPersonName/middleName"),
                               text(info, "relatedPersonName/lastName"))
             if part and part.lower() not in ("n/a", "na", "-")]
    # An entity as a related person often repeats its name in first and last
    # (Figueroa Heights LP, filed 2026-10-08), which printed it twice.
    if len(parts) > 1 and parts[0] == parts[-1]:
        parts = [parts[0]]
    titles = [node.text.strip() for node in info.findall("relatedPersonRelationshipList/relationship")
              if node.text and node.text.strip()]
    clarification = text(info, "relationshipClarification")
    if clarification:
        titles.append(clarification)
    return {"name": " ".join(parts), "titles": titles,
            "state": text(info, "relatedPersonAddress/stateOrCountry")}


def parse_primary_doc(xml_text, cik="", adsh=""):
    """Read issuer, money, dates and related persons from one primary_doc.xml."""
    if re.search(r"<!(DOCTYPE|ENTITY)", xml_text, flags=re.IGNORECASE):
        raise ValueError("Form D XML with a DTD or entity is refused")
    root = ElementTree.fromstring(xml_text)
    issuer = root.find("primaryIssuer")
    offering = root.find("offeringData")
    cik = cik or text(issuer, "cik")
    first_sale = text(offering, "typeOfFiling/dateOfFirstSale/value")
    if not first_sale and text(offering, "typeOfFiling/dateOfFirstSale/yetToOccur") == "true":
        first_sale = "yet to occur"
    offered = text(offering, "offeringSalesAmounts/totalOfferingAmount")
    people = [person(info) for info in root.findall("relatedPersonsList/relatedPersonInfo")]
    year = text(issuer, "yearOfInc/value")
    if not year and text(issuer, "yearOfInc/overFiveYears") == "true":
        year = "over five years"
    return {
        "issuer": text(issuer, "entityName"), "cik": str(int(cik)) if cik else "",
        "state": text(issuer, "issuerAddress/stateOrCountry"),
        "city": text(issuer, "issuerAddress/city").title(),
        "industry": text(offering, "industryGroup/industryGroupType"),
        "fund_type": text(offering, "industryGroup/investmentFundInfo/investmentFundType"),
        "offering_amount": amount(offered), "offering_indefinite": offered.lower() == "indefinite",
        "amount_sold": amount(text(offering, "offeringSalesAmounts/totalAmountSold")),
        "first_sale": first_sale,
        "is_amendment": text(offering, "typeOfFiling/newOrAmendment/isAmendment") == "true",
        "entity_type": text(issuer, "entityType"), "year_of_inc": year,
        "revenue_range": text(offering, "issuerSize/revenueRange"),
        "signed": text(offering, "signatureBlock/signature/signatureDate"),
        "people": [entry for entry in people if entry["name"]],
        "filing_url": filing_url(cik, adsh) if cik and adsh else "",
        "xml_url": xml_url(cik, adsh) if cik and adsh else "",
    }


def load_doc(fetcher, cache_dir, filing):
    """Return the primary document, from the cache when an earlier run saved it."""
    path = cache_dir / f"{filing['adsh']}.xml"
    if path.is_file():
        return path.read_text(encoding="utf-8")
    body = fetcher.get(xml_url(filing["cik"], filing["adsh"]))
    cache_dir.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(body, encoding="utf-8")
    os.replace(temporary, path)
    return body


def biggest(row):
    values = [value for value in (row.get("offering_amount"), row.get("amount_sold")) if value is not None]
    return max(values) if values else None


def keep(row, industry=None, min_amount=None, state=None, include_funds=False):
    if not include_funds and row["industry"] == FUND_GROUP:
        return False
    if industry and industry.lower() not in row["industry"].lower():
        return False
    if state and row["state"].upper() != state.upper():
        return False
    if min_amount is not None and (biggest(row) is None or biggest(row) < min_amount):
        return False
    return True


def formd(fetcher, cache_dir, since, until, industry=None, min_amount=None, state=None,
          limit=50, include_amendments=False, include_funds=False, warn=None):
    """One row per issuer, newest filing first, stopping once `limit` rows match."""
    rows, issuers = [], set()
    for filing in search_filings(fetcher, since, until):
        if filing["file_type"] != "D" and not include_amendments:
            continue
        if state and filing["states"] and state.upper() not in [s.upper() for s in filing["states"]]:
            continue
        if filing["cik"] in issuers:
            continue
        try:
            row = parse_primary_doc(load_doc(fetcher, cache_dir, filing), filing["cik"], filing["adsh"])
        except (ElementTree.ParseError, ValueError, urllib.error.HTTPError) as error:
            if warn:
                warn(f"skipped {filing['adsh']}: {error}")
            continue
        row["file_date"] = filing["file_date"]
        if not keep(row, industry, min_amount, state, include_funds):
            continue
        issuers.add(filing["cik"])
        rows.append(row)
        if len(rows) >= limit:
            break
    return rows


def people_text(row):
    return "; ".join(f"{p['name']} ({', '.join(p['titles'])})" if p["titles"] else p["name"]
                     for p in row["people"])


def money(value):
    return "" if value is None else f"${value:,}"


def render_csv(rows):
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(dict(row, people=people_text(row)))
    return out.getvalue()


def render_table(rows):
    lines = []
    for row in rows:
        offered = "indefinite" if row.get("offering_indefinite") else money(row["offering_amount"])
        lines.append(f"{row['file_date']}  {row['issuer']}  ({row['city']}, {row['state']})")
        lines.append(f"  {row['industry'] or 'industry not stated'}; offering {offered or 'n/a'}, "
                     f"sold {money(row['amount_sold']) or 'n/a'}; first sale {row['first_sale'] or 'n/a'}")
        if row["people"]:
            lines.append(f"  people: {people_text(row)}")
        lines.append(f"  {row['filing_url']}")
    lines.append(f"{len(rows)} issuer(s). A Form D is a funding signal, not proof of intent to buy.")
    return "\n".join(lines)


def parse_day(value):
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{value!r} is not a YYYY-MM-DD date") from None


def main(argv=None, fetcher=None, today=None):
    today = today or date.today()
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("formd", help="Recent SEC Form D private raises, one row per issuer")
    command.add_argument("--since", type=parse_day, help="First filing date (default: 7 days ago)")
    command.add_argument("--until", type=parse_day, help="Last filing date (default: today)")
    command.add_argument("--industry", help='Substring of the industry group, e.g. "Technology"')
    command.add_argument("--min-amount", type=int,
                         help="Minimum dollars, compared with the larger of offered and sold")
    command.add_argument("--state", help="Two-letter issuer state, e.g. CA")
    command.add_argument("--limit", type=int, default=50, help="Stop after this many issuers (default 50)")
    command.add_argument("--include-amendments", action="store_true", help="Also read D/A filings")
    command.add_argument("--include-funds", action="store_true",
                         help="Keep pooled investment funds, dropped by default")
    command.add_argument("--cache-dir", type=Path, default=Path(os.environ.get(
        "CHEWBACCA_FORMD_CACHE", str(Path.home() / ".cache" / "chewbacca" / "formd"))),
        help="Where raw XML is kept so re-runs cost no requests")
    output = command.add_mutually_exclusive_group()
    output.add_argument("--json", action="store_true")
    output.add_argument("--csv", action="store_true")
    args = parser.parse_args(argv)
    since = args.since or today - timedelta(days=7)
    until = args.until or today
    try:
        if since > until:
            raise ValueError("--since is after --until")
        if args.limit < 1:
            raise ValueError("--limit must be at least 1")
        if args.min_amount is not None and args.min_amount < 0:
            raise ValueError("--min-amount cannot be negative")
        fetcher = fetcher or Fetcher()
        rows = formd(fetcher, args.cache_dir.expanduser(), since, until, args.industry,
                     args.min_amount, args.state, args.limit, args.include_amendments,
                     args.include_funds, warn=lambda message: print(message, file=sys.stderr))
        if args.json:
            print(json.dumps({"since": since.isoformat(), "until": until.isoformat(),
                              "requests": fetcher.requests, "rows": rows,
                              "note": "A Form D shows a raise, not intent to buy."}, indent=2))
        elif args.csv:
            sys.stdout.write(render_csv(rows))
        else:
            print(render_table(rows))
        return 0
    except (ValueError, OSError, json.JSONDecodeError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
