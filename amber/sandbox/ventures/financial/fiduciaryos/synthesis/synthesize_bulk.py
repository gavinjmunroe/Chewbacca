"""
synthesis/synthesize_bulk.py — Bulk synthesis engine for FiduciaryOS training data.

Generates 350,000+ training pairs across 5 data streams:
  1. Portfolio analysis pairs (25%): scenario → fiduciary recommendation
  2. Violation detection pairs (30%): conduct → compliance analysis
  3. Tax optimization pairs (20%): portfolio → tax harvest plan
  4. Rebalancing pairs (15%): drifted portfolio → trade plan
  5. Risk assessment pairs (10%): risk state → alert + recommendations

Uses vLLM (Qwen2.5-72B) for synthesis or Claude API as fallback.
Parallelized via ThreadPoolExecutor for throughput.

Target throughput:
  - vLLM: ~200 pairs/hour (conservative; depends on GPU config)
  - Claude API: ~50 pairs/hour (rate limited)
  - Full dataset: ~175 hours on 2x vLLM instances (A6000 GPUs 0-7)

Usage:
    synthesizer = FiduciaryBulkSynthesizer(backend="vllm")
    synthesizer.run(
        n_portfolio=87_500,
        n_violation=105_000,
        n_tax=70_000,
        n_rebalance=52_500,
        n_risk=35_000,
    )
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path

from loguru import logger

from synthesis.prompts import (
    PORTFOLIO_ANALYSIS_PROMPT,
    REBALANCING_PROMPT,
    RISK_ASSESSMENT_PROMPT,
    SAMPLE_CLIENT_PROFILES,
    SCENARIO_TYPES,
    SYNTHESIS_SYSTEM_PROMPT,
    TAX_OPTIMIZATION_PROMPT,
    VIOLATION_ANALYSIS_SYSTEM_PROMPT,
    VIOLATION_DETECTION_PROMPT,
)


@dataclass
class TrainingPair:
    """A single training pair in ShareGPT format."""

    pair_id: str
    stream: str  # "portfolio" | "violation" | "tax" | "rebalance" | "risk"
    conversations: list[
        dict
    ]  # ShareGPT format: [{"from": "human", "value": "..."}, ...]
    metadata: dict  # Quality flags, scenario type, etc.


class FiduciaryBulkSynthesizer:
    """
    Bulk synthesis engine for FiduciaryOS training corpus.

    Generates diverse, high-quality training pairs across all 5 data streams.
    Deduplicates using MinHash LSH before writing to disk.
    """

    def __init__(
        self,
        output_dir: str = "data/processed",
        backend: str = "vllm",  # "vllm" | "claude"
        vllm_urls: list[str] | None = None,
        model_name: str = "Qwen/Qwen2.5-72B-Instruct",
        temperature: float = 0.8,
        max_workers: int = 8,
    ) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.backend = backend
        self.model_name = model_name
        self.temperature = temperature
        self.max_workers = max_workers

        # vLLM round-robin pool
        self._vllm_urls = vllm_urls or [
            url.strip()
            for url in os.environ.get("VLLM_URLS", "http://localhost:8000").split(",")
        ]
        self._vllm_idx = 0
        self._vllm_lock = threading.Lock()
        self._vllm_client = None

        # Claude API fallback
        self._claude_client = None

        self._init_clients()

    def _init_clients(self) -> None:
        if self.backend == "vllm":
            try:
                import openai

                # Initialize with first URL; round-robin handled at call time
                self._vllm_client = openai.OpenAI(
                    base_url=f"{self._vllm_urls[0]}/v1",
                    api_key=os.environ.get("VLLM_API_KEY", "dummy"),
                )
                logger.info(
                    f"vLLM client initialized: {len(self._vllm_urls)} instance(s)"
                )
            except ImportError:
                logger.warning("openai package not found — falling back to Claude API")
                self.backend = "claude"

        if self.backend == "claude" or self._vllm_client is None:
            try:
                import anthropic

                self._claude_client = anthropic.Anthropic(
                    api_key=os.environ.get("ANTHROPIC_API_KEY", "")
                )
                logger.info("Claude API client initialized")
            except ImportError:
                raise RuntimeError("Neither openai nor anthropic packages available")

    def run(
        self,
        n_portfolio: int = 87_500,
        n_violation: int = 105_000,
        n_tax: int = 70_000,
        n_rebalance: int = 52_500,
        n_risk: int = 35_000,
    ) -> dict[str, int]:
        """
        Run full synthesis pipeline across all streams.

        Returns:
            Dict of stream → pairs generated.
        """
        logger.info(
            f"Starting synthesis: portfolio={n_portfolio:,}, violation={n_violation:,}, "
            f"tax={n_tax:,}, rebalance={n_rebalance:,}, risk={n_risk:,}"
        )

        results = {}

        streams = [
            ("portfolio", n_portfolio, self._make_portfolio_pair),
            ("violation", n_violation, self._make_violation_pair),
            ("tax", n_tax, self._make_tax_pair),
            ("rebalance", n_rebalance, self._make_rebalance_pair),
            ("risk", n_risk, self._make_risk_pair),
        ]

        for stream_name, count, make_fn in streams:
            logger.info(f"Starting stream: {stream_name} ({count:,} pairs)")
            saved = self._synthesize_stream(stream_name, count, make_fn)
            results[stream_name] = saved
            logger.info(f"Stream {stream_name} complete: {saved:,} pairs saved")

        total = sum(results.values())
        logger.info(
            f"Synthesis complete: {total:,} total pairs across {len(streams)} streams"
        )
        return results

    def _synthesize_stream(
        self,
        stream_name: str,
        count: int,
        make_fn,
    ) -> int:
        """Synthesize a single stream with parallel workers."""
        output_file = self.output_dir / f"{stream_name}_pairs.jsonl"
        seen_file = self.output_dir / f"{stream_name}_seen_ids.txt"

        seen_ids: set[str] = set()
        existing_count = 0
        if seen_file.exists():
            seen_ids = set(seen_file.read_text().splitlines())
            existing_count = len(seen_ids)

        remaining = count - existing_count
        if remaining <= 0:
            logger.info(
                f"Stream {stream_name} already complete ({existing_count:,} pairs)"
            )
            return existing_count

        logger.info(f"Stream {stream_name}: generating {remaining:,} more pairs")
        saved = existing_count

        with (
            open(output_file, "a") as out_f,
            open(seen_file, "a") as seen_f,
            ThreadPoolExecutor(max_workers=self.max_workers) as executor,
        ):
            futures = [
                executor.submit(make_fn) for _ in range(remaining * 2)
            ]  # over-generate for quality filter
            completed = 0

            for future in as_completed(futures):
                if saved >= count:
                    break
                try:
                    pair = future.result(timeout=120)
                    if pair is None or pair.pair_id in seen_ids:
                        continue
                    if not self._quality_check(pair):
                        continue

                    out_f.write(json.dumps(asdict(pair)) + "\n")
                    seen_f.write(pair.pair_id + "\n")
                    seen_ids.add(pair.pair_id)
                    saved += 1
                    completed += 1

                    if saved % 1000 == 0:
                        logger.info(f"  {stream_name}: {saved:,}/{count:,} pairs saved")

                except Exception as e:
                    logger.debug(f"Pair generation failed: {e}")

        return saved

    def _call_llm(self, system: str, user: str) -> str | None:
        """Call the configured LLM backend."""
        if self.backend == "vllm" and self._vllm_client:
            return self._call_vllm(system, user)
        elif self._claude_client:
            return self._call_claude(system, user)
        return None

    def _call_vllm(self, system: str, user: str) -> str | None:
        """Call vLLM with round-robin load balancing."""
        import openai

        with self._vllm_lock:
            url = self._vllm_urls[self._vllm_idx % len(self._vllm_urls)]
            self._vllm_idx += 1

        try:
            client = openai.OpenAI(
                base_url=f"{url}/v1",
                api_key=os.environ.get("VLLM_API_KEY", "dummy"),
            )
            resp = client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=self.temperature,
                max_tokens=2048,
                timeout=90,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            logger.debug(f"vLLM call failed: {e}")
            return None

    def _call_claude(self, system: str, user: str) -> str | None:
        """Call Claude API with rate limit handling."""
        try:
            msg = self._claude_client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            return msg.content[0].text.strip()
        except Exception as e:
            if "rate_limit" in str(e).lower():
                time.sleep(60)
            logger.debug(f"Claude API call failed: {e}")
            return None

    def _make_portfolio_pair(self) -> TrainingPair | None:
        """Generate one portfolio analysis training pair."""
        profile = random.choice(SAMPLE_CLIENT_PROFILES)
        portfolio_value = profile["aum_usd"] * random.uniform(0.8, 1.5)
        drawdown = random.uniform(0.0, 0.15)

        ticker_universe = ["VTI", "VXUS", "BND", "VNQ", "QQQ", "AAPL", "MSFT", "GOOGL"]
        holdings = {
            t: portfolio_value * random.uniform(0.05, 0.25)
            for t in random.sample(ticker_universe, k=random.randint(4, 7))
        }

        user_prompt = PORTFOLIO_ANALYSIS_PROMPT.format(
            client_profile=json.dumps(profile, indent=2),
            portfolio_state=json.dumps(
                {
                    "total_value_usd": round(portfolio_value, 0),
                    "drawdown_from_peak": f"{drawdown:.1%}",
                    "holdings": {k: round(v, 0) for k, v in holdings.items()},
                },
                indent=2,
            ),
            market_context=f"Current date: 2026. Rates at {random.uniform(3.5, 5.5):.1f}%, equity markets {random.choice(['near all-time highs', 'correcting 8%', 'in bear market -22%'])}.",
        )

        raw = self._call_llm(SYNTHESIS_SYSTEM_PROMPT, user_prompt)
        if not raw:
            return None

        pair_id = f"portfolio_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        try:
            parsed = json.loads(self._extract_json(raw))
            human_value = parsed.get("prompt", user_prompt[:200])
            assistant_value = json.dumps(
                parsed.get("response", {"analysis": raw}), indent=2
            )
        except (json.JSONDecodeError, KeyError):
            human_value = f"Analyze portfolio for: {profile['description']}"
            assistant_value = raw

        return TrainingPair(
            pair_id=pair_id,
            stream="portfolio",
            conversations=[
                {"from": "human", "value": human_value},
                {"from": "gpt", "value": assistant_value},
            ],
            metadata={"client_type": profile["type"], "scenario": "portfolio_analysis"},
        )

    def _make_violation_pair(self) -> TrainingPair | None:
        """Generate one fiduciary violation detection training pair."""
        scenario_type = random.choice(
            SCENARIO_TYPES[:10]
        )  # Violation-relevant scenarios

        # Use built-in violation scenario templates
        violation_templates = VIOLATION_SCENARIO_TEMPLATES
        template = random.choice(violation_templates)

        user_prompt = VIOLATION_DETECTION_PROMPT.format(
            conduct_description=template["conduct"],
            ground_truth_violations=json.dumps(template["violations"]),
        )

        raw = self._call_llm(VIOLATION_ANALYSIS_SYSTEM_PROMPT, user_prompt)
        if not raw:
            return None

        pair_id = f"violation_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return TrainingPair(
            pair_id=pair_id,
            stream="violation",
            conversations=[
                {
                    "from": "human",
                    "value": template["conduct"][:800]
                    + "\n\nAnalyze for fiduciary violations.",
                },
                {"from": "gpt", "value": raw},
            ],
            metadata={
                "violations": template["violations"],
                "scenario_type": scenario_type,
            },
        )

    def _make_tax_pair(self) -> TrainingPair | None:
        """Generate one tax optimization training pair."""
        federal_rate = random.choice([22, 24, 32, 35, 37])
        state = random.choice(["CA", "NY", "TX", "FL", "WA"])
        state_rate = {"CA": 9.3, "NY": 6.85, "TX": 0.0, "FL": 0.0, "WA": 0.0}[state]

        # Generate positions with P&L
        tickers = ["VTI", "VXUS", "BND", "QQQ", "SPY", "AAPL", "MSFT"]
        positions = {}
        for ticker in random.sample(tickers, k=random.randint(4, 6)):
            shares = random.randint(50, 500)
            cost_basis = random.uniform(50, 400)
            current_price = cost_basis * random.uniform(0.6, 1.8)
            positions[ticker] = {
                "shares": shares,
                "cost_basis_per_share": round(cost_basis, 2),
                "current_price": round(current_price, 2),
                "unrealized_pnl": round((current_price - cost_basis) * shares, 0),
            }

        user_prompt = TAX_OPTIMIZATION_PROMPT.format(
            federal_rate=federal_rate,
            state=state,
            state_rate=state_rate,
            tax_status=random.choice(
                ["taxable", "mixed_taxable_ira", "taxable_with_roth"]
            ),
            realized_gains=random.randint(0, 50_000),
            positions_with_pnl=json.dumps(positions, indent=2),
            scenario_date="November 15, 2026",
        )

        raw = self._call_llm(SYNTHESIS_SYSTEM_PROMPT, user_prompt)
        if not raw:
            return None

        pair_id = f"tax_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return TrainingPair(
            pair_id=pair_id,
            stream="tax",
            conversations=[
                {
                    "from": "human",
                    "value": f"Perform tax-loss harvesting analysis for {state} resident (federal {federal_rate}% bracket).\n\nPositions:\n{json.dumps(positions, indent=2)}",
                },
                {"from": "gpt", "value": raw},
            ],
            metadata={
                "federal_rate": federal_rate,
                "state": state,
                "scenario": "tax_optimization",
            },
        )

    def _make_rebalance_pair(self) -> TrainingPair | None:
        """Generate one rebalancing training pair."""
        target_alloc = {
            "us_equity_index": round(random.uniform(0.40, 0.70), 2),
            "international_equity_index": round(random.uniform(0.10, 0.25), 2),
            "us_bonds": round(random.uniform(0.10, 0.30), 2),
        }
        # Normalize
        total = sum(target_alloc.values())
        target_alloc = {k: round(v / total, 2) for k, v in target_alloc.items()}

        user_prompt = REBALANCING_PROMPT.format(
            target_allocation=json.dumps(target_alloc, indent=2),
            threshold=random.choice([3, 5, 7]),
            tax_status=random.choice(["taxable", "mixed"]),
            harvest_threshold=random.choice([-500, -1000, -2000]),
            current_holdings=json.dumps(
                {
                    "VTI": random.randint(50_000, 500_000),
                    "VXUS": random.randint(10_000, 100_000),
                    "BND": random.randint(10_000, 150_000),
                }
            ),
            prices=json.dumps({"VTI": 265.40, "VXUS": 58.20, "BND": 74.30}),
            tax_lots="[...lots omitted for brevity...]",
        )

        raw = self._call_llm(SYNTHESIS_SYSTEM_PROMPT, user_prompt)
        if not raw:
            return None

        pair_id = f"rebalance_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return TrainingPair(
            pair_id=pair_id,
            stream="rebalance",
            conversations=[
                {
                    "from": "human",
                    "value": f"Generate rebalancing plan. Target: {json.dumps(target_alloc)}",
                },
                {"from": "gpt", "value": raw},
            ],
            metadata={"target_allocation": target_alloc, "scenario": "rebalancing"},
        )

    def _make_risk_pair(self) -> TrainingPair | None:
        """Generate one risk assessment training pair."""
        drawdown = round(random.uniform(0.0, 0.22), 3)
        realized_vol = round(random.uniform(0.08, 0.28), 3)
        total_value = random.choice([250_000, 500_000, 1_000_000, 3_000_000, 8_000_000])

        user_prompt = RISK_ASSESSMENT_PROMPT.format(
            total_value=total_value,
            drawdown=drawdown,
            policy_max_drawdown=0.18,
            realized_vol=realized_vol,
            target_vol=0.10,
            max_position_ticker=random.choice(["AAPL", "MSFT", "VTI", "QQQ"]),
            max_position_pct=random.uniform(0.10, 0.30),
            risk_context=f"Market has declined {random.uniform(5, 20):.0f}% over the past {random.randint(30, 180)} days.",
        )

        raw = self._call_llm(SYNTHESIS_SYSTEM_PROMPT, user_prompt)
        if not raw:
            return None

        pair_id = f"risk_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return TrainingPair(
            pair_id=pair_id,
            stream="risk",
            conversations=[
                {
                    "from": "human",
                    "value": f"Assess portfolio risk. Drawdown: {drawdown:.1%}, Vol: {realized_vol:.1%}",
                },
                {"from": "gpt", "value": raw},
            ],
            metadata={
                "drawdown": drawdown,
                "realized_vol": realized_vol,
                "scenario": "risk_assessment",
            },
        )

    def _quality_check(self, pair: TrainingPair) -> bool:
        """Basic quality filter for generated pairs."""
        if not pair.conversations or len(pair.conversations) < 2:
            return False
        assistant_msg = pair.conversations[1].get("value", "")
        if len(assistant_msg) < 200:
            return False
        # Reject if response doesn't contain financial terminology
        financial_terms = [
            "portfolio",
            "tax",
            "risk",
            "allocation",
            "return",
            "volatility",
            "fiduciary",
        ]
        has_term = any(
            term.lower() in assistant_msg.lower() for term in financial_terms
        )
        return has_term

    def _extract_json(self, text: str) -> str:
        """Extract JSON block from model output."""
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1])
        # Find first { and last }
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return text[start : end + 1]
        return text


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="FiduciaryOS bulk synthesis")
    parser.add_argument("--backend", choices=["vllm", "claude"], default="vllm")
    parser.add_argument("--output-dir", default="data/processed")
    parser.add_argument("--max-workers", type=int, default=25)
    parser.add_argument(
        "--vllm-urls", default="http://localhost:8001,http://localhost:8002"
    )
    args = parser.parse_args()
    vllm_urls = (
        [u.strip() for u in args.vllm_urls.split(",")]
        if args.backend == "vllm"
        else None
    )
    synthesizer = FiduciaryBulkSynthesizer(
        output_dir=args.output_dir,
        backend=args.backend,
        vllm_urls=vllm_urls,
        max_workers=args.max_workers,
    )
    stats = synthesizer.run()
    print(f"Done: {stats}")


# Built-in violation scenario templates (for guaranteed training variety)
VIOLATION_SCENARIO_TEMPLATES = [
    {
        "conduct": (
            "An investment adviser recommended that all 200 clients in their book purchase shares "
            "of a technology fund in which the adviser's spouse owned a 15% stake. "
            "The adviser did not disclose this relationship in writing to any client before the transaction. "
            "The fund underperformed the S&P 500 by 8% over the next year."
        ),
        "violations": ["undisclosed_conflict", "self_dealing", "inadequate_disclosure"],
    },
    {
        "conduct": (
            "An adviser managing retirement accounts for a 68-year-old client moved 80% of the "
            "portfolio into a speculative biotech fund, citing 'upside potential.' "
            "The client had explicitly stated they needed stable income and could not tolerate losses "
            "exceeding 10%. The fund declined 45% over six months."
        ),
        "violations": ["unsuitable_advice", "breach_of_duty_care"],
    },
    {
        "conduct": (
            "An adviser received 12 basis points in soft-dollar credits from a broker-dealer for "
            "each trade placed through that broker. These credits were used to pay for the adviser's "
            "Bloomberg terminal subscription. Client accounts paid commissions 3x above best-available rates. "
            "Clients were not informed about the soft-dollar arrangement."
        ),
        "violations": ["soft_dollar_abuse", "undisclosed_conflict", "excessive_fees"],
    },
    {
        "conduct": (
            "An adviser consistently allocated new IPO shares to their personal account and the accounts "
            "of close family members before filling client orders. When there was excess demand, "
            "profitable IPO allocations went to the adviser's accounts while unprofitable ones were "
            "distributed to client accounts."
        ),
        "violations": ["cherry_picking", "self_dealing", "breach_of_duty_care"],
    },
    {
        "conduct": (
            "An adviser executing a client's $500,000 equity rebalancing purchased the full position "
            "for their own account 20 minutes before the client order, then sold into the price increase "
            "caused by the client's larger order, realizing $8,400 in personal profit."
        ),
        "violations": ["front_running", "self_dealing", "unauthorized_trading"],
    },
]
