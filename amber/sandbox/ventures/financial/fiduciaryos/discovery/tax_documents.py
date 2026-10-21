"""
discovery/tax_documents.py — IRS + Tax Court data discovery module.

Crawls official government tax publications to build training data for the
CPA-replacement model within FiduciaryOS v2. Covers the core tax rules that
advisers must apply correctly when advising on equity compensation, retirement
accounts, and investment taxation.

Sources:
  1. IRS Publications — structured guidance (Pub 17, 550, 590-A/B, 946, etc.)
  2. US Tax Court Opinions — case law on contested tax positions
  3. IRS Revenue Rulings (Internal Revenue Bulletins) — administrative guidance
  4. IRS Private Letter Rulings (PLRs) — taxpayer-specific guidance letters

Each document is parsed into a TaxDocument record that captures:
    - Key dollar limits and thresholds (regex-extracted)
    - Topic classification for retrieval
    - Effective dates for temporal accuracy

Target: 10,000+ authoritative tax documents feeding the CPA-replacement model.

Usage:
    crawler = TaxDocumentCrawler(output_dir="data/raw/tax")
    total = crawler.run(max_docs=10_000)
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from loguru import logger


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class TaxDocument:
    """A single authoritative tax document or section."""

    doc_id: str
    source: str  # "irs_publication" | "tax_court" | "revenue_ruling" | "plr"
    title: str
    publication_number: str | None  # e.g. "17", "550", "590-A"
    year: int
    topic: str  # "capital_gains" | "equity_compensation" | "roth_ira" | etc.
    url: str
    content_summary: str
    key_rules: list[str]  # extracted rules / limits
    effective_date: str
    crawled_at: str


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# IRS publications that are most relevant for a CPA-replacement model focused
# on investment, retirement, and equity-compensation taxation.
IRS_PUBLICATIONS: list[tuple[str, str]] = [
    ("17",    "Your Federal Income Tax"),
    ("550",   "Investment Income and Expenses"),
    ("590-A", "Contributions to Individual Retirement Arrangements"),
    ("590-B", "Distributions from Individual Retirement Arrangements"),
    ("946",   "How To Depreciate Property"),
    ("544",   "Sales and Other Dispositions of Assets"),
    ("551",   "Basis of Assets"),
    ("505",   "Tax Withholding and Estimated Tax"),
    ("525",   "Taxable and Nontaxable Income"),
    ("969",   "Health Savings Accounts and Other Tax-Favored Health Plans"),
]

# Revenue ruling topics of interest (used as keyword filters)
RELEVANT_RULING_KEYWORDS: list[str] = [
    "roth conversion",
    "roth ira",
    "qualified small business stock",
    "qsbs",
    "section 1202",
    "incentive stock option",
    "iso",
    "nonqualified stock option",
    "nqso",
    "restricted stock unit",
    "rsu",
    "capital gain",
    "net investment income",
    "individual retirement",
    "401(k)",
    "required minimum distribution",
    "rmd",
    "backdoor roth",
    "wash sale",
    "carried interest",
    "stock option",
    "equity compensation",
    "cost basis",
    "like-kind exchange",
    "1031",
    "opportunity zone",
    "section 83(b)",
    "nonresident alien",
    "alternative minimum tax",
    "amt",
    "passive activity",
]

# Fine-grained topic taxonomy for classification
TOPIC_TAXONOMY: dict[str, list[str]] = {
    "capital_gains": [
        "capital gain", "capital loss", "holding period", "long-term", "short-term",
        "section 1221", "wash sale", "loss harvesting", "tax-loss", "basis step-up",
        "inherited", "stepped-up basis",
    ],
    "equity_compensation": [
        "stock option", "incentive stock option", "iso", "nonqualified stock option",
        "nqso", "restricted stock", "rsu", "restricted stock unit", "section 83",
        "83(b) election", "vesting", "equity compensation", "employee stock purchase",
        "espp",
    ],
    "roth_ira": [
        "roth ira", "roth conversion", "backdoor roth", "mega backdoor", "roth 401",
        "designated roth", "qualified distribution", "5-year rule",
    ],
    "traditional_ira": [
        "traditional ira", "deductible ira", "nondeductible ira", "ira contribution",
        "ira deduction", "required minimum distribution", "rmd", "stretch ira",
        "inherited ira", "beneficiary ira",
    ],
    "retirement_accounts": [
        "401(k)", "403(b)", "457", "sep ira", "simple ira", "solo 401k",
        "defined benefit", "pension", "profit sharing", "rollover", "distribution",
        "early withdrawal", "10% penalty", "hardship", "loan from 401",
    ],
    "qsbs": [
        "qualified small business stock", "qsbs", "section 1202", "section 1045",
        "rollover of qsbs", "exclusion", "gain exclusion", "active business",
        "c corporation",
    ],
    "real_estate_tax": [
        "like-kind exchange", "1031 exchange", "opportunity zone", "section 121",
        "home sale exclusion", "rental property", "passive activity", "real estate",
        "depreciation recapture", "section 1250",
    ],
    "investment_income": [
        "dividend", "interest income", "qualified dividend", "ordinary dividend",
        "net investment income tax", "niit", "section 1411", "investment interest",
        "margin interest",
    ],
    "withholding_estimated_tax": [
        "withholding", "estimated tax", "form 1040-es", "underpayment penalty",
        "safe harbor", "quarterly payment",
    ],
    "amt": [
        "alternative minimum tax", "amt", "form 6251", "iso and amt",
        "adjusted current earnings", "tentative minimum tax",
    ],
    "hsa": [
        "health savings account", "hsa", "high-deductible health plan", "hdhp",
        "qualified medical expense",
    ],
    "depreciation": [
        "depreciation", "section 179", "bonus depreciation", "macrs",
        "listed property", "placed in service", "cost recovery",
    ],
    "general": [],  # fallback
}


# ---------------------------------------------------------------------------
# Crawler
# ---------------------------------------------------------------------------


class TaxDocumentCrawler:
    """
    Crawl and process tax documents from IRS and US Tax Court sources.

    Architecture:
    1. Fetch raw HTML from government websites
    2. Parse with BeautifulSoup — extract section headings + body text
    3. Classify into topic taxonomy
    4. Extract dollar limits / key rules via regex
    5. Persist as JSONL in subdirectories
    """

    RATE_LIMIT_DELAY = 0.25   # seconds between requests — polite to government servers
    MAX_RETRIES = 3
    MIN_CONTENT_LENGTH = 150  # discard stubs shorter than this

    def __init__(self, output_dir: str = "data/raw/tax") -> None:
        self.output_dir = Path(output_dir)
        self.irs_dir = self.output_dir / "irs"
        self.tax_court_dir = self.output_dir / "tax_court"

        self.irs_dir.mkdir(parents=True, exist_ok=True)
        self.tax_court_dir.mkdir(parents=True, exist_ok=True)

        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "FiduciaryOS Research / Tax Document Corpus Builder "
                    "calebnewtonusc@github.com"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            }
        )

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def run(self, max_docs: int = 10_000) -> int:
        """
        Run all four crawl sources in sequence.

        Args:
            max_docs: Approximate cap on total documents to collect across
                      all sources (evenly split between sources).

        Returns:
            Total number of TaxDocument records saved.
        """
        per_source = max(1, max_docs // 4)
        total = 0

        logger.info(f"TaxDocumentCrawler starting — target {max_docs} docs total")

        total += self._crawl_irs_publications(max_docs=per_source)
        logger.info(f"Progress: {total} docs after IRS publications")

        total += self._crawl_revenue_rulings(max_docs=per_source)
        logger.info(f"Progress: {total} docs after revenue rulings")

        total += self._crawl_tax_court_decisions(max_docs=per_source)
        logger.info(f"Progress: {total} docs after tax court decisions")

        total += self._crawl_private_letter_rulings(max_docs=per_source)
        logger.info(f"Progress: {total} docs after private letter rulings")

        logger.info(f"TaxDocumentCrawler complete: {total} total documents saved")
        return total

    # ------------------------------------------------------------------
    # Source 1: IRS Publications
    # ------------------------------------------------------------------

    def _crawl_irs_publications(self, max_docs: int = 2_500) -> int:
        """
        Crawl IRS.gov publications page by page, extracting individual sections.

        IRS publications are structured HTML documents. Each top-level chapter
        or named section becomes one TaxDocument record — this granularity is
        ideal for retrieval-augmented generation (each chunk is self-contained).

        URL pattern: https://www.irs.gov/publications/p{num}
        The IRS also mirrors PDF-HTML versions at the same path.

        Args:
            max_docs: Maximum TaxDocument records to save from this source.

        Returns:
            Number of records saved.
        """
        output_file = self.irs_dir / "irs_publications.jsonl"
        seen_file = self.irs_dir / "pub_seen_ids.txt"
        seen_ids = self._load_seen_ids(seen_file)

        total_saved = 0

        for pub_num, pub_title in IRS_PUBLICATIONS:
            if total_saved >= max_docs:
                break

            url = f"https://www.irs.gov/publications/p{pub_num.lower().replace('-', '')}"
            logger.debug(f"Fetching IRS Pub {pub_num}: {url}")

            resp = self._get_with_retry(url)
            if not resp:
                # Try alternate URL form with hyphen (e.g. p590-a)
                alt_url = f"https://www.irs.gov/publications/p{pub_num.lower()}"
                resp = self._get_with_retry(alt_url)
                if not resp:
                    logger.debug(f"Could not fetch IRS Pub {pub_num}")
                    continue

            soup = BeautifulSoup(resp.text, "html.parser")
            current_year = self._extract_pub_year(soup, resp.text)

            # Extract sections: <h2> and <h3> headings with following paragraphs
            sections = self._extract_publication_sections(soup, pub_num)

            for section_title, section_text in sections:
                if total_saved >= max_docs:
                    break

                doc_id = self._make_doc_id(
                    "pub", pub_num, section_title
                )
                if doc_id in seen_ids:
                    continue
                if not self._is_relevant(section_title, section_text):
                    continue
                if len(section_text) < self.MIN_CONTENT_LENGTH:
                    continue

                topic = self._classify_topic(section_title, section_text)
                key_rules = self._extract_dollar_limits(section_text)

                doc = TaxDocument(
                    doc_id=doc_id,
                    source="irs_publication",
                    title=f"IRS Publication {pub_num}: {section_title}",
                    publication_number=pub_num,
                    year=current_year,
                    topic=topic,
                    url=resp.url,
                    content_summary=section_text[:2000],
                    key_rules=key_rules,
                    effective_date=str(current_year),
                    crawled_at=datetime.utcnow().isoformat(),
                )

                self._append_doc(output_file, seen_file, doc)
                seen_ids.add(doc_id)
                total_saved += 1

            time.sleep(self.RATE_LIMIT_DELAY)

            if total_saved % 100 == 0 and total_saved > 0:
                logger.info(f"IRS publications: {total_saved} sections saved")

        logger.info(f"IRS publications crawl complete: {total_saved} sections")
        return total_saved

    def _extract_publication_sections(
        self, soup: BeautifulSoup, pub_num: str
    ) -> list[tuple[str, str]]:
        """
        Extract (heading, body_text) pairs from an IRS publication page.

        IRS publication HTML uses a mix of <h2>/<h3>/<h4> for section headers.
        We collect the text that follows each heading up to the next heading at
        the same or higher level.
        """
        sections: list[tuple[str, str]] = []

        # Remove nav, header, footer, sidebar noise
        for tag in soup.find_all(["nav", "header", "footer", "aside", "script", "style"]):
            tag.decompose()

        # Find the main content area
        content = (
            soup.find("div", {"id": "main-content"})
            or soup.find("main")
            or soup.find("article")
            or soup.find("div", class_=re.compile(r"content|article|publication", re.I))
            or soup.body
        )
        if not content:
            return sections

        # Walk all heading + text blocks
        current_heading = f"Publication {pub_num} Overview"
        current_paragraphs: list[str] = []

        for element in content.find_all(["h1", "h2", "h3", "h4", "p", "li", "table"]):
            tag = element.name
            if tag in ("h1", "h2", "h3", "h4"):
                # Flush current section
                body = " ".join(current_paragraphs).strip()
                if body:
                    sections.append((current_heading, body))
                current_heading = element.get_text(separator=" ", strip=True)
                current_paragraphs = []
            else:
                text = element.get_text(separator=" ", strip=True)
                if text and len(text) > 20:
                    current_paragraphs.append(text)

        # Flush last section
        body = " ".join(current_paragraphs).strip()
        if body:
            sections.append((current_heading, body))

        return sections

    def _extract_pub_year(self, soup: BeautifulSoup, html: str) -> int:
        """Detect publication year from page content."""
        # IRS publications usually state "For use in preparing [year] returns"
        year_match = re.search(r"(?:for use in preparing|tax year)\s+(\d{4})", html, re.I)
        if year_match:
            return int(year_match.group(1))

        # Fallback: look for 4-digit year in page title
        title_tag = soup.find("title")
        if title_tag:
            m = re.search(r"(20\d{2})", title_tag.get_text())
            if m:
                return int(m.group(1))

        return datetime.now().year

    # ------------------------------------------------------------------
    # Source 2: US Tax Court Decisions
    # ------------------------------------------------------------------

    def _crawl_tax_court_decisions(self, max_docs: int = 2_500) -> int:
        """
        Crawl US Tax Court opinions from the public opinions archive.

        The Tax Court publishes opinions at:
          https://www.ustaxcourt.gov/USTCInOP/OpinionSearch.aspx  (search UI)

        For bulk access, we use the opinions RSS feed and direct HTML pages.
        Focus areas: equity compensation, IRA issues, capital gains, fiduciary.

        We target T.C. Memo and Regular opinions from 2010 onward. Each
        opinion is one TaxDocument record.

        Args:
            max_docs: Maximum records to save.

        Returns:
            Number of records saved.
        """
        output_file = self.tax_court_dir / "tax_court_opinions.jsonl"
        seen_file = self.tax_court_dir / "court_seen_ids.txt"
        seen_ids = self._load_seen_ids(seen_file)

        total_saved = 0

        # Tax Court opinion search API (undocumented JSON endpoint used by the
        # public search UI) — returns paginated results
        search_terms = [
            "stock option",
            "IRA distribution",
            "Roth conversion",
            "capital gains",
            "restricted stock",
            "equity compensation",
            "fiduciary",
            "section 83",
            "QSBS",
            "wash sale",
            "retirement account",
            "section 1202",
        ]

        per_term = max(1, max_docs // len(search_terms))

        for term in search_terms:
            if total_saved >= max_docs:
                break

            saved_for_term = self._crawl_tax_court_term(
                term=term,
                max_per_term=per_term,
                output_file=output_file,
                seen_file=seen_file,
                seen_ids=seen_ids,
            )
            total_saved += saved_for_term
            logger.debug(f"Tax court '{term}': {saved_for_term} opinions, total={total_saved}")

        logger.info(f"Tax Court crawl complete: {total_saved} opinions")
        return total_saved

    def _crawl_tax_court_term(
        self,
        term: str,
        max_per_term: int,
        output_file: Path,
        seen_file: Path,
        seen_ids: set[str],
    ) -> int:
        """Search Tax Court opinions for a single keyword term."""
        saved = 0

        # Use the public search endpoint
        search_url = "https://www.ustaxcourt.gov/USTCInOP/OpinionSearch.aspx"

        # Attempt JSON-style search (the court website uses a hidden ASPX form;
        # we fall back to scraping the search results page HTML)
        try:
            params = {
                "Search": term,
                "tbStartDate": "01/01/2010",
                "tbEndDate": datetime.now().strftime("%m/%d/%Y"),
                "rbOpinionTypes": "T",  # T.C. regular opinions
            }
            resp = self._get_with_retry(search_url, params=params)
            if not resp:
                return 0

            soup = BeautifulSoup(resp.text, "html.parser")

            # Opinion links in the results table
            opinion_links = soup.find_all(
                "a",
                href=re.compile(r"OpinionViewer\.aspx\?ID=", re.I),
            )

            for link in opinion_links:
                if saved >= max_per_term:
                    break

                opinion_id = re.search(r"ID=(\w+)", link.get("href", ""))
                if not opinion_id:
                    continue
                doc_id = f"taxcourt_{opinion_id.group(1)}"
                if doc_id in seen_ids:
                    continue

                opinion_url = (
                    f"https://www.ustaxcourt.gov/USTCInOP/{link['href'].lstrip('/')}"
                )
                opinion_resp = self._get_with_retry(opinion_url)
                if not opinion_resp:
                    continue

                doc = self._parse_tax_court_opinion(
                    doc_id=doc_id,
                    html=opinion_resp.text,
                    url=opinion_url,
                )
                if doc:
                    self._append_doc(output_file, seen_file, doc)
                    seen_ids.add(doc_id)
                    saved += 1

                time.sleep(self.RATE_LIMIT_DELAY)

        except Exception as e:
            logger.debug(f"Tax court search error for term '{term}': {e}")

        # Also try T.C. Memo opinions separately
        try:
            params["rbOpinionTypes"] = "M"
            resp = self._get_with_retry(search_url, params=params)
            if resp:
                soup = BeautifulSoup(resp.text, "html.parser")
                memo_links = soup.find_all(
                    "a",
                    href=re.compile(r"OpinionViewer\.aspx\?ID=", re.I),
                )
                for link in memo_links:
                    if saved >= max_per_term:
                        break
                    opinion_id = re.search(r"ID=(\w+)", link.get("href", ""))
                    if not opinion_id:
                        continue
                    doc_id = f"taxcourt_memo_{opinion_id.group(1)}"
                    if doc_id in seen_ids:
                        continue
                    opinion_url = (
                        f"https://www.ustaxcourt.gov/USTCInOP/{link['href'].lstrip('/')}"
                    )
                    opinion_resp = self._get_with_retry(opinion_url)
                    if not opinion_resp:
                        continue
                    doc = self._parse_tax_court_opinion(
                        doc_id=doc_id,
                        html=opinion_resp.text,
                        url=opinion_url,
                    )
                    if doc:
                        self._append_doc(output_file, seen_file, doc)
                        seen_ids.add(doc_id)
                        saved += 1
                    time.sleep(self.RATE_LIMIT_DELAY)

        except Exception as e:
            logger.debug(f"Tax court memo search error for term '{term}': {e}")

        return saved

    def _parse_tax_court_opinion(
        self, doc_id: str, html: str, url: str
    ) -> TaxDocument | None:
        """Parse a single Tax Court opinion HTML page."""
        soup = BeautifulSoup(html, "html.parser")

        # Remove nav/header noise
        for tag in soup.find_all(["nav", "header", "footer", "script", "style"]):
            tag.decompose()

        # Extract case title from <title> or first <h1>/<h2>
        title = ""
        title_tag = soup.find("title")
        if title_tag:
            title = title_tag.get_text(strip=True)
        if not title:
            h = soup.find(["h1", "h2"])
            if h:
                title = h.get_text(strip=True)
        if not title:
            title = f"Tax Court Opinion {doc_id}"

        # Full text
        body = soup.get_text(separator=" ", strip=True)
        body = re.sub(r"\s+", " ", body)

        if len(body) < self.MIN_CONTENT_LENGTH:
            return None

        if not self._is_relevant(title, body):
            return None

        # Extract year from title or docket (e.g. "T.C. Memo. 2021-45")
        year_match = re.search(r"(20\d{2}|19\d{2})", title + " " + body[:500])
        year = int(year_match.group(1)) if year_match else datetime.now().year

        # Extract docket number
        docket_match = re.search(r"Docket\s+No\.?\s+([\d\-]+)", body, re.I)
        docket = docket_match.group(1) if docket_match else ""

        topic = self._classify_topic(title, body)
        key_rules = self._extract_dollar_limits(body)

        # Build a concise summary: case caption + first substantive paragraph
        summary = self._extract_court_summary(body)

        return TaxDocument(
            doc_id=doc_id,
            source="tax_court",
            title=title,
            publication_number=docket or None,
            year=year,
            topic=topic,
            url=url,
            content_summary=summary,
            key_rules=key_rules,
            effective_date=str(year),
            crawled_at=datetime.utcnow().isoformat(),
        )

    def _extract_court_summary(self, body: str, max_chars: int = 2000) -> str:
        """Pull the holdings / findings paragraph from opinion text."""
        # Tax court opinions typically start with a "FINDINGS OF FACT" or "HELD:"
        markers = ["HELD:", "We hold", "held that", "OPINION", "FINDINGS OF FACT"]
        for marker in markers:
            idx = body.find(marker)
            if idx >= 0:
                return body[idx: idx + max_chars].strip()
        return body[:max_chars].strip()

    # ------------------------------------------------------------------
    # Source 3: IRS Revenue Rulings
    # ------------------------------------------------------------------

    def _crawl_revenue_rulings(self, max_docs: int = 2_500) -> int:
        """
        Crawl IRS Revenue Rulings from the Internal Revenue Bulletins (IRB).

        The IRB index at https://www.irs.gov/irb/ lists all bulletins by year.
        Each bulletin is an HTML page containing revenue rulings, notices, and
        announcements. We filter to revenue rulings ("Rev. Rul. YYYY-NN") on
        topics relevant to investment and retirement taxation.

        Args:
            max_docs: Maximum records to save.

        Returns:
            Number of records saved.
        """
        output_file = self.irs_dir / "revenue_rulings.jsonl"
        seen_file = self.irs_dir / "ruling_seen_ids.txt"
        seen_ids = self._load_seen_ids(seen_file)

        total_saved = 0
        current_year = datetime.now().year

        for year in range(current_year, current_year - 11, -1):
            if total_saved >= max_docs:
                break

            # IRB index for the year
            irb_index_url = f"https://www.irs.gov/irb/{year}-index"
            resp = self._get_with_retry(irb_index_url)

            if not resp:
                # Try alternate URL format
                irb_index_url = f"https://www.irs.gov/irb/irb{str(year)[2:]}-index.htm"
                resp = self._get_with_retry(irb_index_url)

            if not resp:
                logger.debug(f"Could not fetch IRB index for {year}")
                # Attempt direct bulletin number enumeration
                saved = self._crawl_irb_year_direct(
                    year, max_docs - total_saved, output_file, seen_file, seen_ids
                )
                total_saved += saved
                continue

            soup = BeautifulSoup(resp.text, "html.parser")

            # Find links to individual bulletin pages
            bulletin_links = soup.find_all(
                "a", href=re.compile(r"/irb/.*irb\d+", re.I)
            )

            for link in bulletin_links:
                if total_saved >= max_docs:
                    break

                bulletin_url = link.get("href", "")
                if not bulletin_url.startswith("http"):
                    bulletin_url = f"https://www.irs.gov{bulletin_url}"

                bull_resp = self._get_with_retry(bulletin_url)
                if not bull_resp:
                    continue

                rulings = self._extract_revenue_rulings_from_bulletin(
                    html=bull_resp.text,
                    url=bulletin_url,
                    year=year,
                )

                for doc in rulings:
                    if total_saved >= max_docs:
                        break
                    if doc.doc_id in seen_ids:
                        continue
                    self._append_doc(output_file, seen_file, doc)
                    seen_ids.add(doc.doc_id)
                    total_saved += 1

                time.sleep(self.RATE_LIMIT_DELAY)

            if total_saved % 100 == 0 and total_saved > 0:
                logger.info(f"Revenue rulings: {total_saved} saved (through {year})")

        logger.info(f"Revenue rulings crawl complete: {total_saved} rulings")
        return total_saved

    def _crawl_irb_year_direct(
        self,
        year: int,
        max_docs: int,
        output_file: Path,
        seen_file: Path,
        seen_ids: set[str],
    ) -> int:
        """Enumerate IRB bulletins directly by issue number (fallback for index failures)."""
        saved = 0
        # Each year typically has 50-52 bulletins
        for issue_num in range(1, 53):
            if saved >= max_docs:
                break
            # IRS URL pattern: /irb/YYYY-NN_IRB (zero-padded)
            padded = str(issue_num).zfill(2)
            url = f"https://www.irs.gov/irb/{year}-{padded}_IRB"
            resp = self._get_with_retry(url)
            if not resp:
                continue

            rulings = self._extract_revenue_rulings_from_bulletin(
                html=resp.text, url=url, year=year
            )
            for doc in rulings:
                if saved >= max_docs:
                    break
                if doc.doc_id in seen_ids:
                    continue
                self._append_doc(output_file, seen_file, doc)
                seen_ids.add(doc.doc_id)
                saved += 1

            time.sleep(self.RATE_LIMIT_DELAY)

        return saved

    def _extract_revenue_rulings_from_bulletin(
        self, html: str, url: str, year: int
    ) -> list[TaxDocument]:
        """
        Parse an IRB HTML page and extract individual revenue rulings as TaxDocuments.

        IRB pages contain multiple items: Rev. Rul., Rev. Proc., Notices, etc.
        We focus on "Rev. Rul." items.
        """
        docs: list[TaxDocument] = []
        soup = BeautifulSoup(html, "html.parser")

        # Remove nav noise
        for tag in soup.find_all(["nav", "header", "footer", "script", "style"]):
            tag.decompose()

        full_text = soup.get_text(separator="\n", strip=True)

        # Split by "Rev. Rul." markers
        # Pattern: "Rev. Rul. 2021-15, 2021-32 I.R.B. ..."
        ruling_pattern = re.compile(
            r"(Rev\.\s*Rul\.\s*\d{4}[-–]\d+.*?)(?=Rev\.\s*Rul\.\s*\d{4}[-–]\d+|\Z)",
            re.DOTALL | re.IGNORECASE,
        )

        for match in ruling_pattern.finditer(full_text):
            block = match.group(1).strip()
            if len(block) < self.MIN_CONTENT_LENGTH:
                continue

            # Extract ruling identifier "Rev. Rul. 2021-15"
            id_match = re.search(r"Rev\.\s*Rul\.\s*(\d{4}[-–]\d+)", block, re.I)
            if not id_match:
                continue
            ruling_id = id_match.group(1).replace("–", "-")
            doc_id = f"revrul_{ruling_id.replace('-', '_')}"

            if not self._is_relevant("", block):
                continue

            # Extract the "Held:" section if present
            held_match = re.search(r"(?:Held:|Holding:)(.*?)(?:\n\n|$)", block, re.I | re.DOTALL)
            summary = held_match.group(1).strip()[:2000] if held_match else block[:2000]

            topic = self._classify_topic(f"Rev. Rul. {ruling_id}", block)
            key_rules = self._extract_dollar_limits(block)

            docs.append(
                TaxDocument(
                    doc_id=doc_id,
                    source="revenue_ruling",
                    title=f"Rev. Rul. {ruling_id}",
                    publication_number=None,
                    year=year,
                    topic=topic,
                    url=url,
                    content_summary=summary,
                    key_rules=key_rules,
                    effective_date=str(year),
                    crawled_at=datetime.utcnow().isoformat(),
                )
            )

        return docs

    # ------------------------------------------------------------------
    # Source 4: Private Letter Rulings
    # ------------------------------------------------------------------

    def _crawl_private_letter_rulings(self, max_docs: int = 2_500) -> int:
        """
        Crawl IRS Private Letter Rulings (PLRs) from the IRS website.

        PLRs are fact-specific rulings issued to individual taxpayers. While
        they cannot be cited as precedent, they reveal IRS positions on edge
        cases in equity compensation and IRA transactions.

        The IRS provides PLRs at:
          https://www.irs.gov/tax-professionals/private-letter-rulings

        PLRs follow a file naming convention: PLRYYYYNNNNNN.pdf / .html

        Args:
            max_docs: Maximum records to save.

        Returns:
            Number of records saved.
        """
        output_file = self.irs_dir / "private_letter_rulings.jsonl"
        seen_file = self.irs_dir / "plr_seen_ids.txt"
        seen_ids = self._load_seen_ids(seen_file)

        total_saved = 0
        current_year = datetime.now().year

        # PLR index pages by year
        for year in range(current_year, current_year - 6, -1):
            if total_saved >= max_docs:
                break

            index_url = f"https://www.irs.gov/tax-professionals/private-letter-rulings-{year}"
            resp = self._get_with_retry(index_url)

            if not resp:
                # Try alternate index form
                index_url = (
                    f"https://www.irs.gov/pub/irs-drop/"
                    f"plr-{str(year)[2:]}-index.htm"
                )
                resp = self._get_with_retry(index_url)

            if not resp:
                logger.debug(f"Could not fetch PLR index for {year}")
                # Fall through to direct enumeration below
                saved = self._crawl_plr_year_direct(
                    year, max_docs - total_saved, output_file, seen_file, seen_ids
                )
                total_saved += saved
                continue

            soup = BeautifulSoup(resp.text, "html.parser")

            # Find links to individual PLR HTML pages
            plr_links = soup.find_all(
                "a",
                href=re.compile(r"plr|private.letter", re.I),
            )

            for link in plr_links:
                if total_saved >= max_docs:
                    break

                plr_url = link.get("href", "")
                if not plr_url.startswith("http"):
                    plr_url = f"https://www.irs.gov{plr_url}"

                # Skip PDF links — we want HTML
                if plr_url.lower().endswith(".pdf"):
                    continue

                plr_id = re.search(r"plr[-_]?(\d+)", plr_url, re.I)
                doc_id = f"plr_{plr_id.group(1)}" if plr_id else f"plr_{hash(plr_url) & 0xFFFFFF}"
                if doc_id in seen_ids:
                    continue

                plr_resp = self._get_with_retry(plr_url)
                if not plr_resp:
                    continue

                doc = self._parse_plr(
                    doc_id=doc_id, html=plr_resp.text, url=plr_url, year=year
                )
                if doc:
                    self._append_doc(output_file, seen_file, doc)
                    seen_ids.add(doc_id)
                    total_saved += 1

                time.sleep(self.RATE_LIMIT_DELAY)

            if total_saved % 100 == 0 and total_saved > 0:
                logger.info(f"PLRs: {total_saved} saved (through {year})")

        logger.info(f"PLR crawl complete: {total_saved} rulings")
        return total_saved

    def _crawl_plr_year_direct(
        self,
        year: int,
        max_docs: int,
        output_file: Path,
        seen_file: Path,
        seen_ids: set[str],
    ) -> int:
        """
        Enumerate PLRs directly from IRS pub/irs-drop directory.

        PLR file names: plrYYNNNNNN (year 2-digit + 6-digit sequence).
        We attempt common starting IDs and work forward.
        """
        saved = 0
        yr2 = str(year)[2:]

        # PLRs are numbered roughly 001-600+ per year; sample at intervals
        for seq in range(1, 650, 3):  # step=3 to stay under rate limits
            if saved >= max_docs:
                break
            padded_seq = str(seq).zfill(6)
            plr_name = f"plr{yr2}{padded_seq}"
            url = f"https://www.irs.gov/pub/irs-drop/{plr_name}.html"

            resp = self._get_with_retry(url)
            if not resp:
                # Try with hyphen variant
                url = f"https://www.irs.gov/pub/irs-drop/{plr_name}.htm"
                resp = self._get_with_retry(url)
            if not resp:
                continue

            doc_id = f"plr_{plr_name}"
            if doc_id in seen_ids:
                continue

            doc = self._parse_plr(doc_id=doc_id, html=resp.text, url=url, year=year)
            if doc:
                self._append_doc(output_file, seen_file, doc)
                seen_ids.add(doc_id)
                saved += 1

            time.sleep(self.RATE_LIMIT_DELAY)

        return saved

    def _parse_plr(
        self, doc_id: str, html: str, url: str, year: int
    ) -> TaxDocument | None:
        """Parse a single PLR HTML page into a TaxDocument."""
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup.find_all(["nav", "header", "footer", "script", "style"]):
            tag.decompose()

        body = soup.get_text(separator=" ", strip=True)
        body = re.sub(r"\s+", " ", body)

        if len(body) < self.MIN_CONTENT_LENGTH:
            return None
        if not self._is_relevant("", body):
            return None

        # Extract PLR number from body
        plr_num_match = re.search(r"PLR[-\s]?(\d{6,10})", body, re.I)
        plr_num = plr_num_match.group(1) if plr_num_match else doc_id

        # Extract "Held:" or "Conclusion:" section
        conclusion_match = re.search(
            r"(?:Held:|Conclusion:|Ruling:|We rule)(.*?)(?:\n\n|\Z)", body, re.I | re.DOTALL
        )
        summary = conclusion_match.group(1).strip()[:2000] if conclusion_match else body[:2000]

        topic = self._classify_topic(f"PLR {plr_num}", body)
        key_rules = self._extract_dollar_limits(body)

        return TaxDocument(
            doc_id=doc_id,
            source="plr",
            title=f"Private Letter Ruling {plr_num}",
            publication_number=None,
            year=year,
            topic=topic,
            url=url,
            content_summary=summary,
            key_rules=key_rules,
            effective_date=str(year),
            crawled_at=datetime.utcnow().isoformat(),
        )

    # ------------------------------------------------------------------
    # Helper: Extract dollar limits
    # ------------------------------------------------------------------

    def _extract_dollar_limits(self, text: str) -> list[str]:
        """
        Extract dollar limits and contribution/threshold rules from text.

        Captures patterns like:
          - "$6,500 ($7,500 if you are age 50 or older)"
          - "the annual limit is $23,000"
          - "$1 million limitation on compensation"

        Returns a deduplicated list of up to 20 extracted rule strings,
        each containing the dollar figure plus surrounding context (up to
        120 characters) to make the rule self-explanatory.
        """
        # Patterns for dollar amounts with optional multiplier words
        dollar_pattern = re.compile(
            r"""
            (?:                        # optional leading context
                (?:limit|maximum|minimum|threshold|amount|cap|
                   annual|contribution|deduction|exclusion|
                   income|phase.out|floor|ceiling)
                \s{0,30}
            )?
            \$                         # dollar sign
            (\d{1,3}(?:,\d{3})*)       # amount with commas
            (?:\.\d{1,2})?             # optional cents
            (?:\s*(?:million|billion|thousand|M|K|B))?  # optional multiplier
            """,
            re.VERBOSE | re.IGNORECASE,
        )

        rules: list[str] = []
        seen_snippets: set[str] = set()

        for match in dollar_pattern.finditer(text):
            start = max(0, match.start() - 60)
            end = min(len(text), match.end() + 60)
            snippet = text[start:end].strip()
            # Normalize whitespace
            snippet = re.sub(r"\s+", " ", snippet)

            # Deduplicate
            key = snippet[:80]
            if key not in seen_snippets:
                seen_snippets.add(key)
                rules.append(snippet)

            if len(rules) >= 20:
                break

        return rules

    # ------------------------------------------------------------------
    # Helper: Classify topic
    # ------------------------------------------------------------------

    def _classify_topic(self, title: str, text: str) -> str:
        """
        Classify a tax document into a topic category.

        Uses keyword matching against the TOPIC_TAXONOMY. The topic with the
        most keyword hits wins. Falls back to "general" when no keywords match.

        Args:
            title: Document or section title.
            text:  Body text (may be long — only first 3000 chars examined).

        Returns:
            Topic string from TOPIC_TAXONOMY keys.
        """
        combined = (title + " " + text[:3000]).lower()
        best_topic = "general"
        best_score = 0

        for topic, keywords in TOPIC_TAXONOMY.items():
            if topic == "general":
                continue
            score = sum(1 for kw in keywords if kw in combined)
            if score > best_score:
                best_score = score
                best_topic = topic

        return best_topic

    # ------------------------------------------------------------------
    # Helper: Relevance filter
    # ------------------------------------------------------------------

    def _is_relevant(self, title: str, text: str) -> bool:
        """
        Return True if the document is relevant to investment / retirement / tax topics.

        Filters out administrative boilerplate, forms guidance unrelated to
        investment planning, and procedural IRS content.
        """
        combined = (title + " " + text[:2000]).lower()

        # Must contain at least one relevant keyword
        for kw in RELEVANT_RULING_KEYWORDS:
            if kw in combined:
                return True

        # Additional broad relevance terms
        broad_terms = [
            "capital gain", "capital loss",
            "individual retirement", "ira",
            "stock", "option", "equity",
            "investment", "dividend",
            "roth", "401(k)", "403(b)",
            "basis", "depreciation",
            "net investment income",
            "schedule d", "form 8949",
            "fiduciary",
        ]
        return any(t in combined for t in broad_terms)

    # ------------------------------------------------------------------
    # Internal utilities
    # ------------------------------------------------------------------

    def _make_doc_id(self, prefix: str, pub_num: str, section_title: str) -> str:
        """Create a stable, collision-resistant document ID."""
        slug = re.sub(r"[^a-z0-9]+", "_", section_title.lower())[:50]
        pub_slug = re.sub(r"[^a-z0-9]+", "_", pub_num.lower())
        return f"{prefix}_{pub_slug}_{slug}"

    def _load_seen_ids(self, seen_file: Path) -> set[str]:
        """Load previously seen document IDs to enable resumption."""
        if seen_file.exists():
            return set(seen_file.read_text().splitlines())
        return set()

    def _append_doc(
        self, output_file: Path, seen_file: Path, doc: TaxDocument
    ) -> None:
        """Append a TaxDocument to the JSONL output file and record its ID."""
        with open(output_file, "a") as f:
            f.write(json.dumps(asdict(doc)) + "\n")
        with open(seen_file, "a") as f:
            f.write(doc.doc_id + "\n")

    def _get_with_retry(
        self,
        url: str,
        params: dict | None = None,
    ) -> requests.Response | None:
        """
        HTTP GET with exponential-backoff retry.

        Respects 429 rate-limiting and skips 403/404 permanent failures.
        Returns None if all retries are exhausted or if a permanent error
        (403/404) is received.
        """
        for attempt in range(self.MAX_RETRIES):
            try:
                resp = self.session.get(url, params=params, timeout=30)
                if resp.status_code == 200:
                    return resp
                elif resp.status_code == 429:
                    wait = 2 ** (attempt + 2)  # 4, 8, 16 seconds
                    logger.debug(f"Rate-limited on {url} — waiting {wait}s")
                    time.sleep(wait)
                elif resp.status_code in (403, 404):
                    return None  # Permanent — don't retry
                else:
                    time.sleep(1)
            except requests.RequestException as e:
                logger.debug(f"Request error (attempt {attempt + 1}) for {url}: {e}")
                time.sleep(1)
        return None


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="FiduciaryOS — IRS + Tax Court document corpus builder"
    )
    parser.add_argument(
        "--output-dir",
        default="data/raw/tax",
        help="Root directory for JSONL output files (default: data/raw/tax)",
    )
    parser.add_argument(
        "--max-docs",
        type=int,
        default=10_000,
        help="Approximate maximum documents to collect across all sources (default: 10000)",
    )
    parser.add_argument(
        "--source",
        choices=["all", "publications", "rulings", "court", "plr"],
        default="all",
        help="Which source to crawl (default: all)",
    )
    args = parser.parse_args()

    # Configure loguru to show INFO and above to stderr
    logger.remove()
    logger.add(
        lambda msg: print(msg, end=""),
        level="INFO",
        format="{time:HH:mm:ss} | {level:<7} | {message}",
    )

    crawler = TaxDocumentCrawler(output_dir=args.output_dir)

    if args.source == "all":
        total = crawler.run(max_docs=args.max_docs)
    elif args.source == "publications":
        total = crawler._crawl_irs_publications(max_docs=args.max_docs)
    elif args.source == "rulings":
        total = crawler._crawl_revenue_rulings(max_docs=args.max_docs)
    elif args.source == "court":
        total = crawler._crawl_tax_court_decisions(max_docs=args.max_docs)
    elif args.source == "plr":
        total = crawler._crawl_private_letter_rulings(max_docs=args.max_docs)
    else:
        total = 0

    print(f"\nDone — {total} documents saved to {args.output_dir}")
