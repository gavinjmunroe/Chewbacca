"""
discovery/sec_filings.py — SEC EDGAR filing crawler for FiduciaryOS training data.

Crawls SEC EDGAR for investment adviser filings:
  - Form ADV (adviser registration, fee disclosures, conflict of interest)
  - Form 13F (quarterly holdings reports — 100M+ AUM managers)
  - No-action letters (SEC guidance on fiduciary edge cases)
  - Investment Company Act filings (mutual fund disclosures)

These filings form the foundation of the FiduciaryOS training corpus —
they represent real-world fiduciary decision-making at scale.

Target: 50,000+ filing sections per data stream.

Usage:
    crawler = SECFilingCrawler(output_dir="data/raw/sec_filings")
    crawler.crawl_adv_part2(max_advisers=5000)
    crawler.crawl_no_action_letters(max_letters=2000)
    crawler.crawl_13f_holdings(max_filings=1000)
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import requests
from loguru import logger


# SEC EDGAR base URLs
EDGAR_BASE = "https://data.sec.gov"
EFTS_BASE = "https://efts.sec.gov/LATEST/search-index"
FULL_TEXT_BASE = "https://efts.sec.gov/LATEST/search-index"


@dataclass
class SECFiling:
    """A parsed SEC filing section relevant for training."""

    filing_id: str
    form_type: str  # "ADV", "13F-HR", "NO-ACTION"
    entity_name: str
    cik: str
    filed_date: str
    section_title: str
    section_text: str
    fiduciary_relevance: str  # "HIGH" | "MEDIUM" | "LOW"
    tags: list[str]

    # For no-action letters
    question_summary: str = ""
    answer_summary: str = ""


class SECFilingCrawler:
    """
    Crawl SEC EDGAR for investment adviser and fund filings.

    Rate limits:
    - EDGAR Full-Text Search: 10 req/s
    - EDGAR data.sec.gov: 10 req/s
    - Always set User-Agent header per EDGAR fair-access policy
    """

    RATE_LIMIT_DELAY = 0.12  # 100ms = ~10 req/s
    MAX_RETRIES = 3

    # Sections of ADV Part 2A most relevant for fiduciary training
    ADV_RELEVANT_ITEMS = {
        "Item 4": "Advisory Business",
        "Item 5": "Fees and Compensation",
        "Item 6": "Performance-Based Fees and Side-By-Side Management",
        "Item 8": "Methods of Analysis, Investment Strategies and Risk of Loss",
        "Item 10": "Other Financial Industry Activities and Affiliations",
        "Item 11": "Code of Ethics, Participation or Interest in Client Transactions",
        "Item 12": "Brokerage Practices",
        "Item 13": "Review of Accounts",
        "Item 14": "Client Referrals and Other Compensation",
        "Item 17": "Voting Client Securities",
    }

    def __init__(
        self,
        output_dir: str = "data/raw/sec_filings",
        user_agent: str | None = None,
    ) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.user_agent = user_agent or os.environ.get(
            "SEC_USER_AGENT", "FiduciaryOS Research calebnewtonusc@github.com"
        )
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": self.user_agent})

    def run(self, max_actions: int = 30_000) -> int:
        """Run all SEC crawlers and return total count."""
        total = 0
        total += self.crawl_adv_part2()
        total += self.crawl_no_action_letters()
        total += self.crawl_13f_holdings()
        return total

    def crawl_adv_part2(
        self,
        max_advisers: int = 5000,
        min_aum_millions: float = 100.0,
    ) -> int:
        """
        Crawl Form ADV Part 2A brochures from large investment advisers.

        ADV Part 2A contains detailed fiduciary disclosures:
        - Fee structure and conflicts of interest
        - Investment strategy descriptions
        - Brokerage practices and soft dollars
        - Client account review policies

        Args:
            max_advisers: Maximum number of advisers to crawl.
            min_aum_millions: Minimum AUM filter (focus on larger, more sophisticated advisers).

        Returns:
            Number of filing sections saved.
        """
        output_file = self.output_dir / "adv_part2_sections.jsonl"
        seen_ids_file = self.output_dir / "adv_seen_ciks.txt"

        seen_ciks: set[str] = set()
        if seen_ids_file.exists():
            seen_ciks = set(seen_ids_file.read_text().splitlines())
        logger.info(f"ADV Part 2 crawl: {len(seen_ciks)} already seen")

        total_saved = 0
        advisers_processed = 0

        # Step 1: Get list of large RIAs from EDGAR company search
        cik_list = self._get_ria_cik_list(
            max_advisers * 2
        )  # over-fetch, many won't have ADV

        with open(output_file, "a") as out_f, open(seen_ids_file, "a") as seen_f:
            for cik in cik_list:
                if advisers_processed >= max_advisers:
                    break
                if cik in seen_ciks:
                    continue

                try:
                    filings = self._get_adv_filings_for_cik(cik)
                    if not filings:
                        continue

                    # Take the most recent ADV Part 2A
                    latest = filings[0]
                    sections = self._parse_adv_part2(cik, latest)

                    # Filter: only keep sections with fiduciary relevance
                    relevant = [
                        s
                        for s in sections
                        if s.fiduciary_relevance in ("HIGH", "MEDIUM")
                    ]

                    for section in relevant:
                        out_f.write(json.dumps(asdict(section)) + "\n")
                        total_saved += 1

                    seen_f.write(cik + "\n")
                    seen_ciks.add(cik)
                    advisers_processed += 1

                    if advisers_processed % 100 == 0:
                        logger.info(
                            f"ADV Part 2: processed {advisers_processed} advisers, {total_saved} sections"
                        )

                    time.sleep(self.RATE_LIMIT_DELAY)

                except Exception as e:
                    logger.debug(f"Failed to process CIK {cik}: {e}")
                    continue

        logger.info(
            f"ADV Part 2 crawl complete: {total_saved} sections from {advisers_processed} advisers"
        )
        return total_saved

    def crawl_no_action_letters(
        self,
        max_letters: int = 2000,
        start_year: int = 2000,
    ) -> int:
        """
        Crawl SEC no-action letters from the Investment Management division.

        No-action letters are gold for fiduciary training:
        - Real edge cases with SEC staff guidance
        - Format: company asks "Is action X permissible?" → SEC answers
        - Covers fiduciary duty nuances, conflicts, fee arrangements

        Args:
            max_letters: Maximum number of letters to fetch.
            start_year: Only fetch letters from this year forward.

        Returns:
            Number of letters saved.
        """
        output_file = self.output_dir / "no_action_letters.jsonl"
        seen_ids_file = self.output_dir / "no_action_seen_ids.txt"

        seen_ids: set[str] = set()
        if seen_ids_file.exists():
            seen_ids = set(seen_ids_file.read_text().splitlines())

        total_saved = 0

        # Search EDGAR full-text for Investment Management no-action letters

        offset = 0

        while total_saved < max_letters:
            try:
                resp = self._get_with_retry(
                    f"https://efts.sec.gov/LATEST/search-index"
                    f"?q=%22fiduciary%22+%22investment+adviser%22"
                    f"&forms=NO-ACTION&dateRange=custom&startdt={start_year}-01-01"
                    f"&from={offset}&hits.hits._source=file_date,entity_name,file_num,form_type"
                )
                if not resp:
                    break

                data = resp.json()
                hits = data.get("hits", {}).get("hits", [])
                if not hits:
                    break

                for hit in hits:
                    if total_saved >= max_letters:
                        break

                    hit.get("_source", {})
                    file_id = hit.get("_id", "")

                    if file_id in seen_ids:
                        continue

                    letter = self._parse_no_action_letter(hit)
                    if letter and letter.question_summary:
                        with open(output_file, "a") as f:
                            f.write(json.dumps(asdict(letter)) + "\n")
                        with open(seen_ids_file, "a") as f:
                            f.write(file_id + "\n")
                        seen_ids.add(file_id)
                        total_saved += 1

                    time.sleep(self.RATE_LIMIT_DELAY)

                offset += len(hits)
                if len(hits) < 10:
                    break

                logger.info(f"No-action letters: {total_saved} saved")

            except Exception as e:
                logger.warning(f"No-action letter fetch error at offset {offset}: {e}")
                break

        logger.info(f"No-action letter crawl complete: {total_saved} letters")
        return total_saved

    def crawl_13f_holdings(
        self,
        max_filings: int = 1000,
        min_year: int = 2020,
    ) -> int:
        """
        Crawl Form 13F quarterly holdings reports from large managers.

        13F reports show real portfolio construction decisions from managers
        with $100M+ AUM — useful for learning institutional allocation patterns.

        Args:
            max_filings: Maximum number of quarterly 13F reports to fetch.
            min_year: Only fetch from this year forward.

        Returns:
            Number of holdings snapshots saved.
        """
        output_file = self.output_dir / "13f_holdings.jsonl"
        seen_ids_file = self.output_dir / "13f_seen_ids.txt"

        seen_ids: set[str] = set()
        if seen_ids_file.exists():
            seen_ids = set(seen_ids_file.read_text().splitlines())

        total_saved = 0

        # Search EDGAR for 13F-HR filings
        url_template = (
            f"https://efts.sec.gov/LATEST/search-index"
            f"?forms=13F-HR&dateRange=custom&startdt={min_year}-01-01"
            f"&from={{offset}}"
        )
        offset = 0

        while total_saved < max_filings:
            try:
                resp = self._get_with_retry(url_template.format(offset=offset))
                if not resp:
                    break

                data = resp.json()
                hits = data.get("hits", {}).get("hits", [])
                if not hits:
                    break

                for hit in hits:
                    if total_saved >= max_filings:
                        break
                    file_id = hit.get("_id", "")
                    if file_id in seen_ids:
                        continue

                    # Parse 13F to extract top holdings and portfolio context
                    holdings_snapshot = self._parse_13f_filing(hit)
                    if holdings_snapshot:
                        with open(output_file, "a") as f:
                            f.write(json.dumps(holdings_snapshot) + "\n")
                        with open(seen_ids_file, "a") as f:
                            f.write(file_id + "\n")
                        seen_ids.add(file_id)
                        total_saved += 1

                    time.sleep(self.RATE_LIMIT_DELAY)

                offset += len(hits)
                if len(hits) < 10:
                    break

                logger.info(f"13F filings: {total_saved} saved")

            except Exception as e:
                logger.warning(f"13F fetch error at offset {offset}: {e}")
                break

        logger.info(f"13F holdings crawl complete: {total_saved} snapshots")
        return total_saved

    def _get_ria_cik_list(self, max_ciks: int) -> list[str]:
        """Fetch list of registered investment adviser CIKs from EDGAR."""
        ciks: list[str] = []
        url = (
            "https://efts.sec.gov/LATEST/search-index"
            "?forms=ADV&dateRange=custom&startdt=2023-01-01&hits.hits.total.value=true"
        )
        offset = 0

        while len(ciks) < max_ciks:
            try:
                resp = self._get_with_retry(f"{url}&from={offset}")
                if not resp:
                    break
                data = resp.json()
                hits = data.get("hits", {}).get("hits", [])
                if not hits:
                    break
                for hit in hits:
                    source = hit.get("_source", {})
                    cik = source.get("entity_id", hit.get("_id", "")).split(":")[-1]
                    if cik:
                        ciks.append(cik)
                offset += len(hits)
                time.sleep(self.RATE_LIMIT_DELAY)
                if len(hits) < 10:
                    break
            except Exception as e:
                logger.debug(f"CIK list fetch error: {e}")
                break

        logger.info(f"Fetched {len(ciks)} RIA CIKs")
        return ciks[:max_ciks]

    def _get_adv_filings_for_cik(self, cik: str) -> list[dict]:
        """Fetch ADV filings list for a given CIK."""
        url = f"{EDGAR_BASE}/submissions/CIK{cik.zfill(10)}.json"
        resp = self._get_with_retry(url)
        if not resp:
            return []

        data = resp.json()
        filings = data.get("filings", {}).get("recent", {})
        forms = filings.get("form", [])
        dates = filings.get("filingDate", [])
        accessions = filings.get("accessionNumber", [])

        adv_filings = []
        for form, date, accession in zip(forms, dates, accessions):
            if form in ("ADV", "ADV-E", "ADV-H", "ADV-W"):
                adv_filings.append(
                    {"form": form, "date": date, "accession": accession, "cik": cik}
                )

        adv_filings.sort(key=lambda x: x["date"], reverse=True)
        return adv_filings

    def _parse_adv_part2(self, cik: str, filing: dict) -> list[SECFiling]:
        """
        Download and parse ADV Part 2A, extracting relevant sections.
        """
        accession = filing["accession"].replace("-", "")
        filing_index_url = f"{EDGAR_BASE}/Archives/edgar/data/{cik}/{accession}/{filing['accession']}-index.json"
        resp = self._get_with_retry(filing_index_url)
        if not resp:
            return []

        try:
            index_data = resp.json()
        except Exception:
            return []

        # Find the primary document (usually .htm or .txt)
        documents = index_data.get("documents", [])
        primary_doc = next(
            (
                d
                for d in documents
                if d.get("type") in ("ADV", "ADV-PART2A")
                and d.get("documentUrl", "").endswith((".htm", ".html", ".txt"))
            ),
            None,
        )
        if not primary_doc:
            primary_doc = next(
                (
                    d
                    for d in documents
                    if d.get("documentUrl", "").endswith((".htm", ".html"))
                ),
                None,
            )
        if not primary_doc:
            return []

        doc_url = primary_doc.get("documentUrl", "")
        if not doc_url.startswith("http"):
            doc_url = f"https://www.sec.gov{doc_url}"

        resp = self._get_with_retry(doc_url)
        if not resp:
            return []

        text = self._html_to_text(resp.text)
        sections = self._extract_adv_sections(cik, filing, text)
        return sections

    def _extract_adv_sections(
        self, cik: str, filing: dict, text: str
    ) -> list[SECFiling]:
        """Extract relevant Item sections from ADV Part 2A text."""
        sections: list[SECFiling] = []

        for item_key, item_title in self.ADV_RELEVANT_ITEMS.items():
            # Find section boundaries
            pattern = rf"{re.escape(item_key)}\s*[.\-–—]\s*{re.escape(item_title)}"
            match = re.search(pattern, text, re.IGNORECASE)
            if not match:
                # Try simpler pattern
                match = re.search(rf"{re.escape(item_key)}\b", text, re.IGNORECASE)
            if not match:
                continue

            start = match.start()
            # Find next item or end
            next_item_match = re.search(
                r"\bItem\s+\d+\b", text[start + len(item_key) + 5 :], re.IGNORECASE
            )
            end = (
                start
                + len(item_key)
                + 5
                + (next_item_match.start() if next_item_match else 3000)
            )
            section_text = text[start:end].strip()

            # Filter out very short or very long sections
            if len(section_text) < 100 or len(section_text) > 10000:
                continue

            # Classify relevance
            relevance = self._classify_adv_relevance(item_key, section_text)

            sections.append(
                SECFiling(
                    filing_id=f"{cik}_{filing['accession']}_{item_key.replace(' ', '_')}",
                    form_type="ADV",
                    entity_name=filing.get("entity_name", ""),
                    cik=cik,
                    filed_date=filing.get("date", ""),
                    section_title=f"{item_key}: {item_title}",
                    section_text=section_text[:5000],  # Cap at 5k chars
                    fiduciary_relevance=relevance,
                    tags=self._tag_section(section_text),
                )
            )

        return sections

    def _classify_adv_relevance(self, item_key: str, text: str) -> str:
        """Classify how relevant an ADV section is for fiduciary training."""
        high_relevance_items = {"Item 5", "Item 6", "Item 10", "Item 11", "Item 12"}
        medium_relevance_items = {"Item 8", "Item 13", "Item 14", "Item 17"}

        if item_key in high_relevance_items:
            return "HIGH"
        elif item_key in medium_relevance_items:
            return "MEDIUM"
        return "LOW"

    def _tag_section(self, text: str) -> list[str]:
        """Extract relevant tags from section text."""
        tags = []
        tag_keywords = {
            "fees": ["fee", "compensation", "asset-based", "hourly", "flat fee"],
            "conflicts": ["conflict", "interest", "affiliated", "related party"],
            "soft_dollars": ["soft dollar", "research", "brokerage", "directed"],
            "fiduciary": ["fiduciary", "duty", "best interest", "Reg BI"],
            "trading": ["trade", "execution", "best execution", "aggregation"],
        }
        text_lower = text.lower()
        for tag, keywords in tag_keywords.items():
            if any(kw in text_lower for kw in keywords):
                tags.append(tag)
        return tags

    def _parse_no_action_letter(self, hit: dict) -> SECFiling | None:
        """Parse a no-action letter hit from EDGAR search."""
        source = hit.get("_source", {})
        file_id = hit.get("_id", "")
        entity_name = source.get("entity_name", "")
        file_date = source.get("file_date", "")

        # Get the actual letter text
        doc_urls = source.get("file_urls", [source.get("file_url", "")])
        if not doc_urls:
            return None

        text = ""
        for url in doc_urls if isinstance(doc_urls, list) else [doc_urls]:
            if not url:
                continue
            resp = self._get_with_retry(
                url if url.startswith("http") else f"https://www.sec.gov{url}"
            )
            if resp:
                text = self._html_to_text(resp.text)
                break

        if not text or len(text) < 200:
            return None

        # Extract Q&A structure
        question = self._extract_question(text)
        answer = self._extract_answer(text)

        return SECFiling(
            filing_id=file_id,
            form_type="NO-ACTION",
            entity_name=entity_name,
            cik="",
            filed_date=file_date,
            section_title="No-Action Letter",
            section_text=text[:6000],
            fiduciary_relevance="HIGH",
            tags=self._tag_section(text),
            question_summary=question[:500],
            answer_summary=answer[:500],
        )

    def _extract_question(self, text: str) -> str:
        """Extract the question/request portion of a no-action letter."""
        # Common patterns in no-action request letters
        patterns = [
            r"(?:We request|We respectfully request|This letter requests)[^\n]{20,500}",
            r"(?:whether|if)\s+[^\n]{50,400}would constitute[^\n]{20,200}",
            r"Facts and Representations[^\n\n]{100,1000}",
        ]
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE | re.DOTALL)
            if m:
                return m.group(0)[:500].strip()
        return text[:300]

    def _extract_answer(self, text: str) -> str:
        """Extract the SEC staff response/answer."""
        patterns = [
            r"(?:Based on|It is the position of the staff|The staff will not recommend)[^\n]{50,500}",
            r"Response[:\s]+[^\n]{50,500}",
        ]
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                return m.group(0)[:500].strip()
        return ""

    def _parse_13f_filing(self, hit: dict) -> dict | None:
        """Parse a 13F-HR holding report, extracting real holdings from the XML InfoTable."""
        import xml.etree.ElementTree as ET

        source = hit.get("_source", {})
        entity_name = source.get("entity_name", "")
        file_date = source.get("file_date", "")
        file_id = hit.get("_id", "")

        # Try to find and fetch the InfoTable XML from the filing package
        file_urls = source.get("file_urls", [source.get("file_url", "")])
        if isinstance(file_urls, str):
            file_urls = [file_urls]

        infotable_text = ""
        for url in file_urls:
            if not url:
                continue
            full_url = url if url.startswith("http") else f"https://www.sec.gov{url}"
            index_resp = self._get_with_retry(full_url)
            if not index_resp:
                continue
            content = index_resp.text
            # Find InfoTable XML link in the index page
            infotable_match = re.search(
                r'href="([^"]+(?:infotable|primary_doc|13f)[^"]*\.xml)"',
                content, re.IGNORECASE,
            )
            if infotable_match:
                xml_url = infotable_match.group(1)
                if not xml_url.startswith("http"):
                    xml_url = f"https://www.sec.gov{xml_url}"
                xml_resp = self._get_with_retry(xml_url)
                if xml_resp:
                    infotable_text = xml_resp.text
                    break
            elif content.strip().startswith("<?xml") or "<informationTable" in content:
                infotable_text = content
                break

        holdings: list[dict] = []
        total_value_usd = 0

        if infotable_text:
            try:
                # Strip XML namespaces for simpler XPath
                clean_xml = re.sub(r'\sxmlns[^"]*"[^"]*"', "", infotable_text)
                clean_xml = re.sub(r"<(/?)[\w]+:", r"<\1", clean_xml)
                root = ET.fromstring(clean_xml)

                for entry in root.findall(".//infoTable"):
                    def _text(tag: str) -> str:
                        el = entry.find(tag)
                        return el.text.strip() if el is not None and el.text else ""

                    name = _text("nameOfIssuer")
                    cusip = _text("cusip")
                    share_type = _text(".//sshPrnamtType") or "SH"
                    try:
                        value_usd = float(_text("value") or 0) * 1000  # values in thousands
                    except ValueError:
                        value_usd = 0
                    try:
                        shares = float(_text(".//sshPrnamt") or 0)
                    except ValueError:
                        shares = 0

                    if name and value_usd > 0:
                        holdings.append({
                            "name": name,
                            "cusip": cusip,
                            "value_usd": value_usd,
                            "shares": shares,
                            "share_type": share_type,
                        })
                        total_value_usd += value_usd

                # Sort by value, keep top 50 for training utility
                holdings.sort(key=lambda x: x["value_usd"], reverse=True)
                holdings = holdings[:50]

            except ET.ParseError as e:
                logger.debug(f"13F XML parse error for {file_id}: {e}")

        if not holdings:
            return None  # Skip filings we couldn't parse any holdings from

        return {
            "filing_id": file_id,
            "entity_name": entity_name,
            "filed_date": file_date,
            "form_type": "13F-HR",
            "holdings": holdings,
            "total_value_usd": total_value_usd,
            "holding_count": len(holdings),
        }

    def _html_to_text(self, html: str) -> str:
        """Basic HTML → text stripping."""
        # Remove scripts and styles
        html = re.sub(
            r"<(script|style)[^>]*>.*?</(script|style)>",
            "",
            html,
            flags=re.DOTALL | re.IGNORECASE,
        )
        # Remove tags
        text = re.sub(r"<[^>]+>", " ", html)
        # Normalize whitespace
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    def _get_with_retry(self, url: str) -> requests.Response | None:
        """HTTP GET with retry and rate limiting."""
        for attempt in range(self.MAX_RETRIES):
            try:
                resp = self.session.get(url, timeout=30)
                if resp.status_code == 200:
                    return resp
                elif resp.status_code == 429:
                    wait = 2 ** (attempt + 1)
                    logger.debug(f"Rate limited — waiting {wait}s")
                    time.sleep(wait)
                elif resp.status_code in (403, 404):
                    return None
                else:
                    time.sleep(1)
            except requests.RequestException as e:
                logger.debug(f"Request error (attempt {attempt + 1}): {e}")
                time.sleep(1)
        return None
