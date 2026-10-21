"""
discovery/financial_papers.py — Crawl financial economics and wealth management
papers from Semantic Scholar and SSRN for FiduciaryOS training data.

Targets:
  - Fiduciary duty and investment adviser regulation research
  - Portfolio optimization and modern portfolio theory papers
  - Tax-loss harvesting and tax-efficient investing research
  - Behavioral finance and investor bias literature
  - ESG / sustainable investing frameworks
  - Factor investing and risk premium research

Usage:
    python discovery/financial_papers.py \
        --output data/raw/financial_papers \
        --max-papers 8000
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

import requests
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
SEMANTIC_SCHOLAR_API_KEY = os.environ.get("SEMANTIC_SCHOLAR_API_KEY", "")
SSRN_API_KEY = os.environ.get("SSRN_API_KEY", "")

S2_BASE = "https://api.semanticscholar.org/graph/v1"
SSRN_BASE = "https://api.ssrn.com/content/v1"

FIELDS = [
    "paperId",
    "title",
    "abstract",
    "year",
    "citationCount",
    "authors",
    "venue",
    "externalIds",
    "tldr",
    "fieldsOfStudy",
]

# Semantic Scholar queries targeting fiduciary / wealth management literature
S2_QUERIES: list[dict[str, Any]] = [
    {
        "query": "fiduciary duty investment adviser SEC regulation",
        "category": "fiduciary_law",
        "limit": 600,
    },
    {
        "query": "portfolio optimization mean-variance efficient frontier",
        "category": "portfolio_theory",
        "limit": 600,
    },
    {
        "query": "tax-loss harvesting tax-efficient portfolio management",
        "category": "tax_optimization",
        "limit": 500,
    },
    {
        "query": "asset allocation retirement planning wealth management",
        "category": "wealth_management",
        "limit": 600,
    },
    {
        "query": "behavioral finance investor bias overconfidence loss aversion",
        "category": "behavioral_finance",
        "limit": 500,
    },
    {
        "query": "ESG sustainable investing socially responsible portfolio",
        "category": "esg",
        "limit": 400,
    },
    {
        "query": "factor investing value momentum quality risk premia",
        "category": "factor_investing",
        "limit": 500,
    },
    {
        "query": "Sharpe ratio risk-adjusted return portfolio performance",
        "category": "performance_measurement",
        "limit": 400,
    },
    {
        "query": "Black-Litterman portfolio construction investor views",
        "category": "portfolio_construction",
        "limit": 300,
    },
    {
        "query": "Monte Carlo simulation retirement income sequence of returns",
        "category": "retirement_planning",
        "limit": 400,
    },
    {
        "query": "suitability best interest regulation broker dealer",
        "category": "regulation",
        "limit": 400,
    },
    {
        "query": "conflict of interest financial adviser compensation",
        "category": "conflicts",
        "limit": 400,
    },
    {
        "query": "rebalancing portfolio drift threshold band",
        "category": "rebalancing",
        "limit": 300,
    },
    {
        "query": "alternative investments hedge funds private equity institutional",
        "category": "alternatives",
        "limit": 300,
    },
    {
        "query": "insurance annuity risk management personal finance",
        "category": "risk_management",
        "limit": 300,
    },
]

# SSRN financial paper categories (eLibrary API)
SSRN_NETWORKS = [
    "Financial Economics Network",
    "Law & Economics Network",
    "Accounting Research Network",
]


def _s2_headers() -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if SEMANTIC_SCHOLAR_API_KEY:
        headers["x-api-key"] = SEMANTIC_SCHOLAR_API_KEY
    return headers


@retry(stop=stop_after_attempt(5), wait=wait_exponential(min=2, max=30))
def _s2_search(query: str, offset: int = 0, limit: int = 100) -> dict[str, Any]:
    resp = requests.get(
        f"{S2_BASE}/paper/search",
        params={
            "query": query,
            "offset": offset,
            "limit": min(limit, 100),
            "fields": ",".join(FIELDS),
        },
        headers=_s2_headers(),
        timeout=30,
    )
    if resp.status_code == 429:
        logger.warning("S2 rate limited — sleeping 60s")
        time.sleep(60)
        resp.raise_for_status()
    resp.raise_for_status()
    return resp.json()


def _ssrn_search(query: str, limit: int = 100) -> list[dict]:
    """
    Fetch SSRN paper metadata.
    Uses the SSRN public eLibrary search endpoint (no auth needed for metadata).
    """
    try:
        url = "https://papers.ssrn.com/sol3/results.cfm"
        params = {
            "RequestTimeout": 50000,
            "new_pack": "no",
            "form_name": "journalBrowse",
            "journal_id": 10,
            "Network_id": 0,
            "txtSearchTerm": query,
            "strSearch": "ABST",
            "orderby": "ab_approval_date",
            "order_dir": "desc",
            "lim": min(limit, 100),
        }
        resp = requests.get(
            url,
            params=params,
            timeout=20,
            headers={"User-Agent": "FiduciaryOS-Research/1.0"},
        )
        resp.raise_for_status()

        from bs4 import BeautifulSoup

        soup = BeautifulSoup(resp.text, "html.parser")

        papers = []
        for result in soup.find_all(
            "div", class_=["result-item", "abstract-list-item"]
        )[:limit]:
            title_el = result.find("a", class_="title")
            abstract_el = result.find(
                "div", class_=["abstract-paragraph", "abstract-text"]
            )
            date_el = result.find("span", class_=["date", "posted-date"])

            title = title_el.get_text(strip=True) if title_el else ""
            abstract = abstract_el.get_text(strip=True) if abstract_el else ""
            date = date_el.get_text(strip=True) if date_el else ""
            url_path = title_el.get("href", "") if title_el else ""

            if title:
                papers.append(
                    {
                        "source": "ssrn",
                        "title": title,
                        "abstract": abstract,
                        "date": date,
                        "url": f"https://papers.ssrn.com{url_path}" if url_path else "",
                    }
                )
        return papers
    except Exception as exc:
        logger.debug(f"SSRN search failed: {exc}")
        return []


def _extract_fiduciary_concepts(abstract: str) -> list[str]:
    """Extract key fiduciary concepts mentioned in the abstract."""
    if not abstract:
        return []

    concept_patterns = {
        "best_interest": r"best interest|suitability|best execution",
        "duty_of_care": r"duty of care|prudent investor|prudent man",
        "duty_of_loyalty": r"duty of loyalty|conflict of interest|self-dealing",
        "disclosure": r"disclose|disclosure|transparency|informed consent",
        "diversification": r"diversi[fy]|concentration risk|systematic risk",
        "tax_efficiency": r"tax[\s-]?loss|tax[\s-]?efficient|after[\s-]?tax return",
        "risk_assessment": r"risk tolerance|risk profile|risk capacity",
        "performance": r"alpha|risk[\s-]?adjusted|Sharpe|benchmark",
    }

    found = []
    abstract_lower = abstract.lower()
    for concept, pattern in concept_patterns.items():
        if re.search(pattern, abstract_lower, re.IGNORECASE):
            found.append(concept)
    return found


def _score_paper(paper: dict) -> float:
    """Score paper relevance for FiduciaryOS training data (0.0–1.0)."""
    score = 0.0
    text = ((paper.get("title") or "") + " " + (paper.get("abstract") or "")).lower()

    high_value = [
        "fiduciary",
        "investment adviser",
        "best interest",
        "suitability",
        "portfolio optimization",
        "tax-loss harvesting",
        "rebalancing",
        "conflict of interest",
        "duty of care",
        "prudent investor",
    ]
    medium_value = [
        "portfolio",
        "wealth",
        "retirement",
        "risk management",
        "asset allocation",
        "performance measurement",
        "diversification",
        "financial planning",
    ]

    for term in high_value:
        if term in text:
            score += 0.15
    for term in medium_value:
        if term in text:
            score += 0.05

    citations = paper.get("citationCount", 0) or 0
    if citations > 200:
        score += 0.2
    elif citations > 50:
        score += 0.1

    year = paper.get("year", 0) or 0
    if year >= 2018:
        score += 0.1

    return min(score, 1.0)


class FinancialPaperCrawler:
    """
    Crawls financial economics and law papers from Semantic Scholar and SSRN.

    Output:
      data/raw/financial_papers/papers.jsonl          — all papers
      data/raw/financial_papers/high_value.jsonl      — top-scored (for training)
      data/raw/financial_papers/fiduciary_concepts.jsonl — concept-tagged papers
    """

    def __init__(self, output_dir: str | Path) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._seen_ids: set[str] = set()

    def run(self, max_papers: int = 8000) -> dict[str, int]:
        all_papers: list[dict] = []

        # Semantic Scholar
        per_query = max_papers // len(S2_QUERIES)
        for query_def in S2_QUERIES:
            papers = self._crawl_s2_query(
                query_def["query"],
                query_def["category"],
                min(query_def["limit"], per_query),
            )
            all_papers.extend(papers)
            logger.info(f"  S2 '{query_def['category']}': {len(papers)} papers")
            time.sleep(1.0)

        # SSRN for key fiduciary queries
        ssrn_queries = [
            ("fiduciary duty investment adviser", "fiduciary_law"),
            ("portfolio optimization wealth management", "portfolio_theory"),
            ("tax loss harvesting investing", "tax_optimization"),
        ]
        for query, category in ssrn_queries:
            papers = _ssrn_search(query, limit=200)
            for p in papers:
                p["category"] = category
                p["paperId"] = f"ssrn_{hash(p['title'])}"
                p["citationCount"] = 0
                all_papers.append(p)
            logger.info(f"  SSRN '{category}': {len(papers)} papers")
            time.sleep(2.0)

        # Score and classify
        for paper in all_papers:
            paper["relevance_score"] = _score_paper(paper)
            paper["fiduciary_concepts"] = _extract_fiduciary_concepts(
                paper.get("abstract", "")
            )

        high_value = [p for p in all_papers if p["relevance_score"] >= 0.4]
        high_value.sort(key=lambda p: p["relevance_score"], reverse=True)

        concept_tagged = [p for p in all_papers if p["fiduciary_concepts"]]

        self._save_jsonl("papers.jsonl", all_papers)
        self._save_jsonl("high_value.jsonl", high_value[:3000])
        self._save_jsonl("fiduciary_concepts.jsonl", concept_tagged)

        stats = {
            "total": len(all_papers),
            "high_value": len(high_value),
            "concept_tagged": len(concept_tagged),
        }
        logger.info(f"Financial papers: {stats}")
        return stats

    def _crawl_s2_query(self, query: str, category: str, limit: int) -> list[dict]:
        papers: list[dict] = []
        offset = 0
        while len(papers) < limit:
            batch_limit = min(100, limit - len(papers))
            try:
                result = _s2_search(query, offset=offset, limit=batch_limit)
                batch = result.get("data", [])
                if not batch:
                    break
                for paper in batch:
                    pid = paper.get("paperId")
                    if not pid or pid in self._seen_ids:
                        continue
                    self._seen_ids.add(pid)
                    papers.append(
                        {
                            "paperId": pid,
                            "title": paper.get("title", ""),
                            "abstract": paper.get("abstract", ""),
                            "year": paper.get("year"),
                            "citationCount": paper.get("citationCount", 0),
                            "authors": [
                                a.get("name", "")
                                for a in (paper.get("authors") or [])[:5]
                            ],
                            "venue": paper.get("venue", ""),
                            "tldr": (paper.get("tldr") or {}).get("text", ""),
                            "category": category,
                            "source": "semantic_scholar",
                        }
                    )
                offset += len(batch)
                if offset >= result.get("total", 0):
                    break
                time.sleep(0.3)
            except Exception as exc:
                logger.warning(f"  S2 query error at offset {offset}: {exc}")
                break
        return papers

    def _save_jsonl(self, filename: str, records: list[dict]) -> None:
        path = self.output_dir / filename
        with path.open("w") as fh:
            for r in records:
                fh.write(json.dumps(r) + "\n")
        logger.debug(f"  Saved {len(records)} → {path}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Crawl financial papers for FiduciaryOS"
    )
    parser.add_argument("--output", default="data/raw/financial_papers")
    parser.add_argument("--max-papers", type=int, default=8000)
    args = parser.parse_args()

    crawler = FinancialPaperCrawler(output_dir=args.output)
    stats = crawler.run(max_papers=args.max_papers)
    logger.info(f"Done: {stats}")
