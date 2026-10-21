"""
discovery/tax_optimization.py — Collect tax optimization knowledge for FiduciaryOS.

Sources:
  - IRS publications (direct PDF/text download)
  - Tax-loss harvesting research papers
  - Wash sale rule guidance
  - Asset location (tax-advantaged vs taxable account placement)
  - Tax bracket and capital gains rate schedules
  - Municipal bond tax treatment
  - Qualified opportunity zone investing

Output:
  data/raw/tax_data/irs_publications.jsonl  — IRS pub summaries
  data/raw/tax_data/tax_rates.json          — Current tax rate schedules
  data/raw/tax_data/tlh_rules.json          — Tax-loss harvesting rules
  data/raw/tax_data/asset_location.json     — Asset location guidance

Usage:
    python discovery/tax_optimization.py \
        --output data/raw/tax_data
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import requests
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

IRS_BASE = "https://www.irs.gov"

# IRS publications relevant to wealth management and tax optimization
IRS_PUBLICATIONS: list[dict[str, Any]] = [
    {
        "pub_num": "550",
        "title": "Investment Income and Expenses",
        "relevance": "capital_gains_dividends",
        "key_topics": [
            "capital gains and losses",
            "qualified dividends",
            "wash sale rule",
            "investment interest expense",
            "at-risk rules",
        ],
    },
    {
        "pub_num": "544",
        "title": "Sales and Other Dispositions of Assets",
        "relevance": "asset_disposition",
        "key_topics": [
            "capital asset definition",
            "holding period rules",
            "like-kind exchanges (1031)",
            "installment sales",
        ],
    },
    {
        "pub_num": "590-A",
        "title": "Contributions to Individual Retirement Arrangements (IRAs)",
        "relevance": "retirement_accounts",
        "key_topics": [
            "IRA contribution limits",
            "deductibility rules",
            "Roth IRA eligibility",
            "rollover rules",
            "backdoor Roth",
        ],
    },
    {
        "pub_num": "590-B",
        "title": "Distributions from Individual Retirement Arrangements (IRAs)",
        "relevance": "retirement_accounts",
        "key_topics": [
            "Required Minimum Distributions (RMD)",
            "10% early withdrawal penalty",
            "Roth conversion",
            "inherited IRA rules",
            "qualified charitable distributions",
        ],
    },
    {
        "pub_num": "575",
        "title": "Pension and Annuity Income",
        "relevance": "retirement_income",
        "key_topics": [
            "401(k) distributions",
            "annuity taxation",
            "NUA (net unrealized appreciation)",
            "defined benefit plan income",
        ],
    },
    {
        "pub_num": "946",
        "title": "How to Depreciate Property",
        "relevance": "real_estate",
        "key_topics": [
            "MACRS depreciation",
            "bonus depreciation",
            "Section 179 expensing",
            "real property depreciation schedules",
        ],
    },
    {
        "pub_num": "523",
        "title": "Selling Your Home",
        "relevance": "real_estate",
        "key_topics": [
            "primary residence exclusion ($250k/$500k)",
            "basis calculation",
            "home office deduction impact",
        ],
    },
    {
        "pub_num": "525",
        "title": "Taxable and Nontaxable Income",
        "relevance": "income_planning",
        "key_topics": [
            "tax-exempt interest",
            "municipal bond treatment",
            "imputed interest",
            "employer benefits",
        ],
    },
    {
        "pub_num": "529",
        "title": "Miscellaneous Deductions",
        "relevance": "deductions",
        "key_topics": [
            "investment expenses (pre-TCJA)",
            "SALT deduction limits",
            "casualty losses",
        ],
    },
    {
        "pub_num": "560",
        "title": "Retirement Plans for Small Business (SEP, SIMPLE, Qualified Plans)",
        "relevance": "small_business_retirement",
        "key_topics": [
            "SEP-IRA",
            "SIMPLE IRA",
            "Solo 401(k)",
            "defined benefit plan",
            "plan contribution limits",
        ],
    },
]


# Tax rate schedules (2024 / 2025 data)
TAX_RATE_SCHEDULES: dict[str, Any] = {
    "year": 2024,
    "ordinary_income": {
        "single": [
            {"rate": 0.10, "min": 0, "max": 11600},
            {"rate": 0.12, "min": 11600, "max": 47150},
            {"rate": 0.22, "min": 47150, "max": 100525},
            {"rate": 0.24, "min": 100525, "max": 191950},
            {"rate": 0.32, "min": 191950, "max": 243725},
            {"rate": 0.35, "min": 243725, "max": 609350},
            {"rate": 0.37, "min": 609350, "max": None},
        ],
        "married_filing_jointly": [
            {"rate": 0.10, "min": 0, "max": 23200},
            {"rate": 0.12, "min": 23200, "max": 94300},
            {"rate": 0.22, "min": 94300, "max": 201050},
            {"rate": 0.24, "min": 201050, "max": 383900},
            {"rate": 0.32, "min": 383900, "max": 487450},
            {"rate": 0.35, "min": 487450, "max": 731200},
            {"rate": 0.37, "min": 731200, "max": None},
        ],
    },
    "long_term_capital_gains": {
        "single": [
            {"rate": 0.00, "min": 0, "max": 47025},
            {"rate": 0.15, "min": 47025, "max": 518900},
            {"rate": 0.20, "min": 518900, "max": None},
        ],
        "married_filing_jointly": [
            {"rate": 0.00, "min": 0, "max": 94050},
            {"rate": 0.15, "min": 94050, "max": 583750},
            {"rate": 0.20, "min": 583750, "max": None},
        ],
    },
    "net_investment_income_tax": {
        "rate": 0.038,
        "threshold_single": 200000,
        "threshold_mfj": 250000,
    },
    "standard_deduction": {
        "single": 14600,
        "married_filing_jointly": 29200,
        "head_of_household": 21900,
    },
    "gift_tax": {
        "annual_exclusion": 18000,
        "lifetime_exemption": 13610000,
        "rate": 0.40,
    },
    "estate_tax": {
        "exemption": 13610000,
        "rate": 0.40,
    },
    "retirement_account_limits": {
        "401k_employee_deferral": 23000,
        "401k_employee_deferral_catchup_50plus": 30500,
        "ira_contribution": 7000,
        "ira_contribution_catchup_50plus": 8000,
        "sep_ira": 69000,
        "simple_ira": 16000,
        "hsa_individual": 4150,
        "hsa_family": 8300,
    },
}

# Tax-loss harvesting rules
TAX_LOSS_HARVESTING_RULES: dict[str, Any] = {
    "wash_sale_rule": {
        "statute": "IRC Section 1091",
        "window_days": 30,
        "direction": "both",
        "description": (
            "A wash sale occurs when you sell a security at a loss and "
            "buy a 'substantially identical' security within 30 days before "
            "or after the sale (61-day window total)."
        ),
        "substantially_identical": [
            "Same stock or bond",
            "Option to buy the same security",
            "Convertible preferred stock (usually)",
            "Futures contracts on the same commodity",
        ],
        "not_substantially_identical": [
            "ETF tracking same index as individual stocks (usually)",
            "Two ETFs tracking similar but different indices",
            "Bonds with different issuers, maturities, or coupons",
            "Stock in different company in same industry",
        ],
        "treatment": "Disallowed loss is added to cost basis of replacement security",
        "ira_accounts": "Wash sale applies across all accounts including IRAs — IRA purchases can trigger wash sale on taxable account losses",
    },
    "short_term_vs_long_term": {
        "short_term_holding_period_days": 365,
        "short_term_rate": "ordinary income rates",
        "long_term_rate": "0%, 15%, or 20% depending on income",
        "strategy": (
            "Harvest short-term losses first (offset short-term gains taxed as ordinary income). "
            "Long-term losses offset long-term gains first. "
            "Net short-term loss can offset net long-term gain."
        ),
    },
    "loss_carryforward": {
        "annual_limit_vs_ordinary_income": 3000,
        "carryforward_period": "indefinite",
        "treatment": (
            "Capital losses in excess of capital gains are limited to $3,000/year offset against "
            "ordinary income. Unused losses carry forward indefinitely."
        ),
    },
    "direct_indexing": {
        "description": (
            "Direct indexing holds individual securities (rather than index ETFs), "
            "enabling systematic tax-loss harvesting on individual losers while "
            "maintaining market exposure via replacement securities."
        ),
        "minimum_account_size": 250000,
        "typical_tax_alpha": "0.5% to 1.5% annually",
        "providers": [
            "Parametric",
            "Aperio",
            "Direct Index",
            "Vanguard Personalized Indexing",
        ],
    },
    "optimal_realization": {
        "long_term_gain_vs_0_bracket": (
            "Taxpayers in 0% LTCG bracket should harvest gains (not losses) "
            "to step up cost basis at 0% tax cost."
        ),
        "gain_timing": (
            "If expecting lower income next year, defer gain realization. "
            "If expecting higher rates next year, accelerate gain realization."
        ),
        "nii_planning": (
            "For taxpayers above $200k/$250k MAGI, LTCG subject to additional 3.8% NIIT. "
            "Effective LTCG rate becomes 23.8% at top bracket."
        ),
    },
}

# Asset location guidance (which accounts hold which assets)
ASSET_LOCATION_GUIDANCE: dict[str, Any] = {
    "principle": (
        "Asset location places tax-inefficient assets in tax-advantaged accounts "
        "(401k, IRA) and tax-efficient assets in taxable accounts to maximize "
        "after-tax returns."
    ),
    "taxable_account_preferred": {
        "rationale": "Tax-efficient assets belong in taxable accounts",
        "asset_types": [
            {
                "asset": "Individual stocks held long-term",
                "reason": "Qualify for 0%/15%/20% LTCG rates; no annual distributions",
            },
            {
                "asset": "Tax-managed equity funds / direct indexing",
                "reason": "Designed to minimize capital gain distributions; enable TLH",
            },
            {
                "asset": "Municipal bonds",
                "reason": "Interest is federally tax-exempt; no benefit from tax-deferred shelter",
            },
            {
                "asset": "I-Bonds / TIPS (if in taxable)",
                "reason": "I-Bond interest can be deferred until redemption",
            },
            {
                "asset": "Equity ETFs (index funds)",
                "reason": "In-kind redemption mechanism minimizes capital gain distributions",
            },
        ],
    },
    "tax_advantaged_preferred": {
        "rationale": "Tax-inefficient assets belong in tax-deferred/Roth accounts",
        "asset_types": [
            {
                "asset": "High-yield bonds / corporate bonds",
                "reason": "Interest income taxed as ordinary income; shelter from tax",
            },
            {
                "asset": "REITs",
                "reason": "REIT dividends mostly taxed as ordinary income; high distribution yield",
            },
            {
                "asset": "Actively managed funds with high turnover",
                "reason": "Generate frequent capital gain distributions",
            },
            {
                "asset": "Treasury bonds / TIPS (if in tax-advantaged)",
                "reason": "Interest taxed as ordinary income; shelter provides max benefit",
            },
            {
                "asset": "Commodities / futures",
                "reason": "Mark-to-market taxation of futures; complex tax treatment",
            },
        ],
    },
    "roth_vs_traditional": {
        "roth_preferred": "Highest-growth assets (small cap, emerging markets) — tax-free compounding most valuable",
        "traditional_preferred": "Bonds and stable assets — tax deferral benefit lower for slower-growing assets",
    },
}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _fetch_irs_publication_page(pub_num: str) -> str:
    """Fetch an IRS publication landing page."""
    url = f"https://www.irs.gov/pub/irs-pdf/p{pub_num}.pdf"
    # We just record the URL and metadata; don't actually parse PDFs
    resp = requests.head(url, timeout=15, allow_redirects=True)
    if resp.status_code == 200:
        return url
    # Try alternate URL format
    alt_url = f"https://www.irs.gov/forms-pubs/about-publication-{pub_num}"
    return alt_url


def collect_irs_publications(
    publications: list[dict],
    output_dir: Path,
) -> list[dict]:
    """
    Collect IRS publication metadata and build structured knowledge records.
    Returns list of publication knowledge records.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []

    for pub in publications:
        pub_num = pub["pub_num"]
        logger.debug(f"  IRS Pub {pub_num}: {pub['title']}")

        try:
            url = _fetch_irs_publication_page(pub_num)
        except Exception:
            url = f"https://www.irs.gov/pub/irs-pdf/p{pub_num}.pdf"

        record = {
            "publication_number": pub_num,
            "title": pub["title"],
            "relevance_category": pub["relevance"],
            "key_topics": pub["key_topics"],
            "pdf_url": f"https://www.irs.gov/pub/irs-pdf/p{pub_num}.pdf",
            "web_url": f"https://www.irs.gov/forms-pubs/about-publication-{pub_num}",
            "scraped_url": url,
            "source": "irs",
        }
        records.append(record)
        time.sleep(0.5)

    # Save
    output_path = output_dir / "irs_publications.jsonl"
    with output_path.open("w") as fh:
        for r in records:
            fh.write(json.dumps(r) + "\n")
    logger.info(f"  IRS publications: {len(records)} → {output_path}")
    return records


class TaxOptimizationCollector:
    """
    Collects and organizes tax optimization knowledge for FiduciaryOS training.
    """

    def __init__(self, output_dir: str | Path) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def run(self) -> dict[str, int]:
        """Run all collection tasks and return item counts."""
        logger.info("Collecting tax optimization knowledge...")

        # IRS Publications
        irs_records = collect_irs_publications(IRS_PUBLICATIONS, self.output_dir)
        logger.info(f"  IRS publications: {len(irs_records)}")

        # Tax rate schedules
        self._save_json("tax_rates.json", TAX_RATE_SCHEDULES)
        logger.info("  Tax rate schedules saved")

        # TLH rules
        self._save_json("tlh_rules.json", TAX_LOSS_HARVESTING_RULES)
        logger.info("  Tax-loss harvesting rules saved")

        # Asset location guidance
        self._save_json("asset_location.json", ASSET_LOCATION_GUIDANCE)
        logger.info("  Asset location guidance saved")

        # Build consolidated training knowledge records
        knowledge_records = self._build_training_records(
            irs_records,
            TAX_RATE_SCHEDULES,
            TAX_LOSS_HARVESTING_RULES,
            ASSET_LOCATION_GUIDANCE,
        )
        self._save_jsonl("tax_knowledge.jsonl", knowledge_records)
        logger.info(f"  Training knowledge records: {len(knowledge_records)}")

        return {
            "irs_publications": len(irs_records),
            "tax_knowledge_records": len(knowledge_records),
        }

    def _build_training_records(
        self,
        irs_records: list[dict],
        tax_rates: dict,
        tlh_rules: dict,
        asset_location: dict,
    ) -> list[dict]:
        """Convert structured tax data into training knowledge records."""
        records: list[dict] = []

        # IRS publication Q&A pairs
        for pub in irs_records:
            records.append(
                {
                    "type": "tax_publication",
                    "question": f"What does IRS Publication {pub['publication_number']} cover?",
                    "answer": (
                        f"IRS Publication {pub['publication_number']}, '{pub['title']}', covers: "
                        + "; ".join(pub["key_topics"])
                        + "."
                    ),
                    "category": pub["relevance_category"],
                    "source": "irs",
                }
            )
            for topic in pub["key_topics"]:
                records.append(
                    {
                        "type": "tax_topic",
                        "question": f"Where can I find IRS guidance on {topic}?",
                        "answer": f"IRS Publication {pub['publication_number']}, '{pub['title']}', addresses {topic}.",
                        "category": pub["relevance_category"],
                        "source": "irs",
                    }
                )

        # Tax rate Q&A
        ltcg_rates = tax_rates.get("long_term_capital_gains", {})
        for filing_status, brackets in ltcg_rates.items():
            for bracket in brackets:
                records.append(
                    {
                        "type": "tax_rate",
                        "question": (
                            f"What is the long-term capital gains rate for a {filing_status.replace('_', ' ')} "
                            f"filer with income up to ${bracket['max']:,}?"
                            if bracket["max"]
                            else f"What is the top long-term capital gains rate for a {filing_status.replace('_', ' ')} filer?"
                        ),
                        "answer": f"{bracket['rate'] * 100:.0f}%",
                        "category": "capital_gains",
                        "source": "irs_schedule",
                        "year": tax_rates["year"],
                    }
                )

        # TLH rule Q&A
        wash_sale = tlh_rules.get("wash_sale_rule", {})
        records.append(
            {
                "type": "tax_rule",
                "question": "What is the wash sale rule and how does it affect tax-loss harvesting?",
                "answer": wash_sale.get("description", "")
                + " "
                + wash_sale.get("treatment", ""),
                "category": "tax_loss_harvesting",
                "source": "irc_1091",
            }
        )

        records.append(
            {
                "type": "tax_rule",
                "question": "How many days does the wash sale window cover?",
                "answer": (
                    f"The wash sale rule covers a {wash_sale.get('window_days', 30)}-day window "
                    "on both sides of the sale date, creating a 61-day blackout period total."
                ),
                "category": "tax_loss_harvesting",
                "source": "irc_1091",
            }
        )

        # Asset location Q&A
        for asset_type in asset_location.get("taxable_account_preferred", {}).get(
            "asset_types", []
        ):
            records.append(
                {
                    "type": "asset_location",
                    "question": f"Should {asset_type['asset']} be held in a taxable or tax-advantaged account?",
                    "answer": f"Taxable account. Reason: {asset_type['reason']}",
                    "category": "asset_location",
                    "source": "tax_efficiency_framework",
                }
            )

        for asset_type in asset_location.get("tax_advantaged_preferred", {}).get(
            "asset_types", []
        ):
            records.append(
                {
                    "type": "asset_location",
                    "question": f"Should {asset_type['asset']} be held in a taxable or tax-advantaged account?",
                    "answer": f"Tax-advantaged account (401k/IRA). Reason: {asset_type['reason']}",
                    "category": "asset_location",
                    "source": "tax_efficiency_framework",
                }
            )

        return records

    def _save_json(self, filename: str, data: Any) -> None:
        path = self.output_dir / filename
        path.write_text(json.dumps(data, indent=2))

    def _save_jsonl(self, filename: str, records: list[dict]) -> None:
        path = self.output_dir / filename
        with path.open("w") as fh:
            for r in records:
                fh.write(json.dumps(r) + "\n")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Collect tax optimization knowledge for FiduciaryOS"
    )
    parser.add_argument("--output", default="data/raw/tax_data")
    args = parser.parse_args()

    collector = TaxOptimizationCollector(output_dir=args.output)
    stats = collector.run()
    logger.info(f"Tax optimization collection complete: {stats}")
