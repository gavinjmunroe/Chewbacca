"""
synthesis/portfolio_synthesizer.py — Synthesize fiduciary reasoning training pairs
for FiduciaryOS using market scenarios and LLM generation.

Generates:
  1. Portfolio construction scenarios (asset allocation given client profile)
  2. Tax optimization decisions (TLH, asset location, Roth conversion)
  3. Fiduciary conflict detection (identify violations and explain remediation)
  4. Rebalancing decisions (when/how to rebalance given drift thresholds)
  5. Risk assessment scenarios (risk capacity vs risk tolerance mismatches)

Each pair: {"prompt": ..., "chosen": ..., "rejected": ...}
  chosen = correct fiduciary response with clear reasoning
  rejected = response with errors (violation, wrong tax treatment, etc.)

Usage:
    python synthesis/portfolio_synthesizer.py \
        --output data/synthesized/portfolio_pairs.jsonl \
        --count 50000 \
        --backend vllm
"""

from __future__ import annotations

import json
import os
import random
from pathlib import Path
from typing import Any

import requests
from loguru import logger

try:
    import anthropic  # noqa: F401

    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

try:
    from tenacity import retry, stop_after_attempt, wait_exponential

    HAS_TENACITY = True
except ImportError:
    HAS_TENACITY = False

    def retry(*args, **kwargs):
        def decorator(fn):
            return fn

        return decorator

    def stop_after_attempt(n):
        return None

    def wait_exponential(**kwargs):
        return None


ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
VLLM_URLS = os.environ.get(
    "VLLM_URLS",
    "http://localhost:8001,http://localhost:8002,http://localhost:8003,http://localhost:8004",
).split(",")
VLLM_API_KEY = os.environ.get("VLLM_API_KEY", "fiduciaryos-secret")
VLLM_MODEL = os.environ.get("VLLM_MODEL", "Qwen/Qwen2.5-72B-Instruct")

SYSTEM_PROMPT_FIDUCIARY = """\
You are a highly knowledgeable Registered Investment Adviser (RIA) with deep expertise
in fiduciary duty, portfolio management, tax optimization, and financial planning.

Your responses must:
1. Demonstrate strict adherence to fiduciary duty (best interest of the client)
2. Cite relevant regulatory standards (SEC, FINRA, IRC sections where applicable)
3. Show explicit reasoning with quantitative analysis where appropriate
4. Identify and disclose any potential conflicts of interest
5. Always recommend lowest-cost options consistent with client goals
6. Consider tax implications of all recommendations

Return responses as structured JSON with fields:
  recommendation: the fiduciary recommendation
  reasoning: step-by-step analysis
  conflicts: any conflicts of interest to disclose
  alternatives: alternatives considered and why rejected
  regulatory_basis: relevant regulatory/legal basis
  risk_warnings: material risks to disclose
"""


# ─────────────────────────────────────────────────────────────────────────────
# Client profile templates for scenario generation
# ─────────────────────────────────────────────────────────────────────────────

CLIENT_PROFILES: list[dict[str, Any]] = [
    {
        "type": "young_professional",
        "age_range": (25, 35),
        "income_range": (80000, 200000),
        "investable_assets_range": (50000, 300000),
        "risk_tolerance": "aggressive",
        "time_horizon": "30+ years",
        "tax_bracket": ["22%", "24%"],
        "account_types": ["401(k)", "Roth IRA", "taxable brokerage"],
        "goals": ["retirement", "home purchase (5-10 years)"],
        "special_considerations": ["student loans", "RSU vesting", "startup equity"],
    },
    {
        "type": "mid_career",
        "age_range": (40, 55),
        "income_range": (150000, 500000),
        "investable_assets_range": (500000, 3000000),
        "risk_tolerance": "moderate",
        "time_horizon": "15-20 years",
        "tax_bracket": ["32%", "35%", "37%"],
        "account_types": ["401(k)", "IRA", "taxable", "529"],
        "goals": ["retirement", "college funding", "wealth transfer"],
        "special_considerations": [
            "concentrated stock position",
            "executive compensation",
            "deferred comp",
        ],
    },
    {
        "type": "pre_retiree",
        "age_range": (55, 65),
        "income_range": (100000, 400000),
        "investable_assets_range": (1000000, 5000000),
        "risk_tolerance": "moderate-conservative",
        "time_horizon": "5-10 years to retirement",
        "tax_bracket": ["24%", "32%", "35%"],
        "account_types": ["401(k)", "IRA", "Roth", "taxable", "HSA"],
        "goals": ["retirement income", "sequence of returns risk management"],
        "special_considerations": [
            "Roth conversion ladder",
            "Medicare planning",
            "catch-up contributions",
        ],
    },
    {
        "type": "retiree",
        "age_range": (65, 80),
        "income_range": (50000, 200000),
        "investable_assets_range": (500000, 3000000),
        "risk_tolerance": "conservative",
        "time_horizon": "20-25 years",
        "tax_bracket": ["12%", "22%", "24%"],
        "account_types": ["IRA", "Roth", "taxable", "annuity"],
        "goals": ["income", "capital preservation", "legacy"],
        "special_considerations": [
            "RMDs",
            "Social Security optimization",
            "Medicare surcharges (IRMAA)",
            "LTC planning",
        ],
    },
    {
        "type": "high_net_worth",
        "age_range": (45, 70),
        "income_range": (500000, 5000000),
        "investable_assets_range": (5000000, 50000000),
        "risk_tolerance": "moderate",
        "time_horizon": "multi-generational",
        "tax_bracket": ["37%"],
        "account_types": ["taxable", "IRA", "trust", "charitable vehicles"],
        "goals": ["wealth preservation", "estate planning", "philanthropy"],
        "special_considerations": [
            "estate tax planning",
            "grantor trusts",
            "QOZ investing",
            "direct indexing",
        ],
    },
]

# Scenario categories and sub-scenarios
SCENARIO_TEMPLATES: list[dict[str, Any]] = [
    # ── Asset Allocation ────────────────────────────────────────────────────
    {
        "category": "asset_allocation",
        "prompt_template": (
            "Client profile: {profile_summary}\n"
            "Current portfolio: {current_allocation}\n"
            "Question: Is this allocation appropriate? What changes, if any, do you recommend?"
        ),
    },
    {
        "category": "asset_allocation",
        "prompt_template": (
            "A {age}-year-old client with ${assets:,} investable assets, {risk_tolerance} risk tolerance, "
            "and a {time_horizon} time horizon is asking how to allocate their portfolio. "
            "They are in the {tax_bracket} federal tax bracket. What is the fiduciary-appropriate "
            "asset allocation recommendation?"
        ),
    },
    # ── Tax Optimization ────────────────────────────────────────────────────
    {
        "category": "tax_optimization",
        "prompt_template": (
            "Client situation: {profile_summary}\n"
            "The client has ${unrealized_loss:,} in unrealized losses in their taxable account "
            "in {losing_positions}. Should they harvest these losses? What are the wash sale "
            "rule implications if they want to maintain equity exposure?"
        ),
    },
    {
        "category": "tax_optimization",
        "prompt_template": (
            "A {age}-year-old client with a traditional IRA of ${ira_balance:,} and "
            "expected taxable income of ${income:,} this year. They are asking whether "
            "to do a Roth conversion and if so, how much to convert. "
            "Current tax bracket: {tax_bracket}. Expected bracket in retirement: {retirement_bracket}."
        ),
    },
    {
        "category": "asset_location",
        "prompt_template": (
            "Client has ${taxable:,} in taxable account and ${tax_deferred:,} in traditional 401(k). "
            "They want to hold a diversified portfolio including: US equities, international equities, "
            "high-yield bonds, REITs, and treasury bonds. "
            "What is the optimal asset location strategy from a tax efficiency standpoint?"
        ),
    },
    # ── Rebalancing ─────────────────────────────────────────────────────────
    {
        "category": "rebalancing",
        "prompt_template": (
            "A client's target allocation is 60% equities / 40% bonds. "
            "After a {market_move} market move, the portfolio has drifted to {current_equity}% equities. "
            "The client is in the {tax_bracket} tax bracket and has ${taxable_gains:,} in unrealized "
            "gains in taxable accounts. How should you approach rebalancing?"
        ),
    },
    # ── Conflict of Interest ────────────────────────────────────────────────
    {
        "category": "conflict_of_interest",
        "prompt_template": (
            "An adviser is recommending {product} which pays a {compensation} commission "
            "compared to an equivalent {alternative} that pays no commission but has a "
            "${cost_difference:,}/year lower cost to the client. "
            "Analyze this recommendation from a fiduciary standpoint."
        ),
    },
    {
        "category": "conflict_of_interest",
        "prompt_template": (
            "An adviser recommends rolling over a client's ${balance:,} 401(k) into an IRA "
            "managed by the adviser's firm. The 401(k) has institutional share class funds "
            "with expense ratios averaging 0.03%. The IRA would use retail mutual funds "
            "averaging 0.65% plus a 1% advisory fee. "
            "What fiduciary analysis is required for this rollover recommendation?"
        ),
    },
    # ── Risk Assessment ─────────────────────────────────────────────────────
    {
        "category": "risk_assessment",
        "prompt_template": (
            "A 62-year-old client says they want an 'aggressive' portfolio because they "
            "are comfortable with risk. Their liquid net worth is ${assets:,}, they have "
            "no pension, minimal Social Security ({ss_income}/month), and plan to retire in "
            "2 years. They have ${annual_expenses:,} in annual expenses. "
            "How do you reconcile stated risk tolerance with objective risk capacity?"
        ),
    },
    # ── Concentrated Position ───────────────────────────────────────────────
    {
        "category": "concentrated_position",
        "prompt_template": (
            "A client has {pct_in_single_stock}% of their ${total_assets:,} portfolio in "
            "employer stock ({company_type}) with a ${cost_basis:,} cost basis "
            "(current value: ${current_value:,}). "
            "What are the fiduciary-appropriate strategies for managing this concentration risk?"
        ),
    },
    # ── Retirement Income ───────────────────────────────────────────────────
    {
        "category": "retirement_income",
        "prompt_template": (
            "A client retiring at 65 has ${portfolio:,} in investable assets "
            "({traditional_pct}% traditional IRA, {roth_pct}% Roth IRA, {taxable_pct}% taxable). "
            "They need ${monthly_income:,}/month. Social Security: ${ss:,}/month starting at {ss_age}. "
            "What is the optimal withdrawal sequencing strategy?"
        ),
    },
]


def _random_profile() -> dict[str, Any]:
    """Generate a random client profile."""
    profile_type = random.choice(CLIENT_PROFILES)
    age = random.randint(*profile_type["age_range"])
    income = random.randint(*profile_type["income_range"])
    assets = random.randint(*profile_type["investable_assets_range"])

    return {
        "type": profile_type["type"],
        "age": age,
        "income": income,
        "assets": assets,
        "risk_tolerance": profile_type["risk_tolerance"],
        "time_horizon": profile_type["time_horizon"],
        "tax_bracket": random.choice(profile_type["tax_bracket"]),
        "goals": profile_type["goals"],
        "special_considerations": profile_type["special_considerations"],
        "account_types": profile_type["account_types"],
    }


def _build_scenario_prompt(template: dict[str, Any]) -> str:
    """Fill in a scenario template with random realistic values."""
    profile = _random_profile()
    assets = profile["assets"]
    income = profile["income"]
    age = profile["age"]

    # Fill template variables
    try:
        filled = template["prompt_template"].format(
            age=age,
            assets=assets,
            income=income,
            risk_tolerance=profile["risk_tolerance"],
            time_horizon=profile["time_horizon"],
            tax_bracket=profile["tax_bracket"],
            profile_summary=(
                f"{age}-year-old {profile['type'].replace('_', ' ')} with "
                f"${assets:,} investable assets, ${income:,} annual income, "
                f"{profile['risk_tolerance']} risk tolerance, goals: {', '.join(profile['goals'])}"
            ),
            current_allocation=f"{random.randint(40, 90)}% equities / {random.randint(10, 50)}% bonds / "
            f"{random.randint(0, 10)}% alternatives",
            unrealized_loss=random.randint(10000, min(assets // 5, 500000)),
            losing_positions=random.choice(
                [
                    "S&P 500 ETF and bond index funds",
                    "international equity ETF and REIT position",
                    "growth equity ETF and emerging markets ETF",
                    "individual tech stocks and sector ETFs",
                ]
            ),
            ira_balance=random.randint(100000, min(assets, 2000000)),
            retirement_bracket=random.choice(["12%", "22%", "24%"]),
            taxable=int(assets * 0.6),
            tax_deferred=int(assets * 0.4),
            market_move=random.choice(
                ["strong equity bull", "equity correction", "bond sell-off"]
            ),
            current_equity=random.randint(55, 80),
            taxable_gains=random.randint(50000, 500000),
            product=random.choice(
                [
                    "variable annuity",
                    "whole life insurance",
                    "non-traded REIT",
                    "equity-indexed annuity",
                ]
            ),
            compensation=random.choice(["6%", "7%", "8%"]),
            alternative=random.choice(
                [
                    "term life + index fund",
                    "low-cost index fund",
                    "publicly traded REIT ETF",
                ]
            ),
            cost_difference=random.randint(2000, 15000),
            balance=random.randint(100000, 2000000),
            ss_income=random.randint(1500, 3500),
            annual_expenses=random.randint(60000, 200000),
            pct_in_single_stock=random.choice([30, 40, 50, 60, 70]),
            total_assets=assets,
            company_type=random.choice(
                [
                    "publicly traded tech company",
                    "large financial institution",
                    "employer S-corp",
                ]
            ),
            cost_basis=random.randint(10000, int(assets * 0.3)),
            current_value=random.randint(int(assets * 0.2), int(assets * 0.5)),
            portfolio=assets,
            traditional_pct=random.randint(40, 70),
            roth_pct=random.randint(15, 35),
            taxable_pct=random.randint(10, 25),
            monthly_income=random.randint(5000, 15000),
            ss=random.randint(1200, 3500),
            ss_age=random.choice([62, 65, 67, 70]),
        )
    except KeyError:
        # Some template variables may not apply to this template.
        # Replace only the missing keys individually rather than replacing all vars.
        # Re-attempt the format call, catching one missing key at a time and
        # substituting only the failing placeholder with "[value]".
        filled = template["prompt_template"]
        # Iterate until no more unresolved placeholders remain.
        for _ in range(50):  # safety bound
            try:
                filled = filled.format(
                    age=age,
                    assets=assets,
                    income=income,
                    risk_tolerance=profile["risk_tolerance"],
                    time_horizon=profile["time_horizon"],
                    tax_bracket=profile["tax_bracket"],
                    profile_summary=(
                        f"{age}-year-old {profile['type'].replace('_', ' ')} with "
                        f"${assets:,} investable assets, ${income:,} annual income, "
                        f"{profile['risk_tolerance']} risk tolerance, goals: {', '.join(profile['goals'])}"
                    ),
                    current_allocation=f"{random.randint(40, 90)}% equities / {random.randint(10, 50)}% bonds / "
                    f"{random.randint(0, 10)}% alternatives",
                    unrealized_loss=random.randint(10000, min(assets // 5, 500000)),
                    losing_positions=random.choice(
                        [
                            "S&P 500 ETF and bond index funds",
                            "international equity ETF and REIT position",
                            "growth equity ETF and emerging markets ETF",
                            "individual tech stocks and sector ETFs",
                        ]
                    ),
                    ira_balance=random.randint(100000, min(assets, 2000000)),
                    retirement_bracket=random.choice(["12%", "22%", "24%"]),
                    taxable=int(assets * 0.6),
                    tax_deferred=int(assets * 0.4),
                    market_move=random.choice(
                        ["strong equity bull", "equity correction", "bond sell-off"]
                    ),
                    current_equity=random.randint(55, 80),
                    taxable_gains=random.randint(50000, 500000),
                    product=random.choice(
                        [
                            "variable annuity",
                            "whole life insurance",
                            "non-traded REIT",
                            "equity-indexed annuity",
                        ]
                    ),
                    compensation=random.choice(["6%", "7%", "8%"]),
                    alternative=random.choice(
                        [
                            "term life + index fund",
                            "low-cost index fund",
                            "publicly traded REIT ETF",
                        ]
                    ),
                    cost_difference=random.randint(2000, 15000),
                    balance=random.randint(100000, 2000000),
                    ss_income=random.randint(1500, 3500),
                    annual_expenses=random.randint(60000, 200000),
                    pct_in_single_stock=random.choice([30, 40, 50, 60, 70]),
                    total_assets=assets,
                    company_type=random.choice(
                        [
                            "publicly traded tech company",
                            "large financial institution",
                            "employer S-corp",
                        ]
                    ),
                    cost_basis=random.randint(10000, int(assets * 0.3)),
                    current_value=random.randint(int(assets * 0.2), int(assets * 0.5)),
                    portfolio=assets,
                    traditional_pct=random.randint(40, 70),
                    roth_pct=random.randint(15, 35),
                    taxable_pct=random.randint(10, 25),
                    monthly_income=random.randint(5000, 15000),
                    ss=random.randint(1200, 3500),
                    ss_age=random.choice([62, 65, 67, 70]),
                )
                break  # format succeeded; all placeholders resolved
            except KeyError as exc:
                # exc.args[0] is the exact missing key name; replace only that one.
                missing_key = exc.args[0]
                filled = filled.replace("{" + missing_key + "}", "[value]")

    return filled


def _build_violation_prompt(scenario: str) -> str:
    """Build a prompt asking for an intentionally bad (violating) response."""
    return (
        f"{scenario}\n\n"
        "Provide a response that a conflicted, non-fiduciary adviser might give — "
        "one that prioritizes adviser compensation over client best interest, "
        "ignores tax implications, or omits material disclosures. "
        "This is for training a model to DETECT such violations."
    )


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
def call_vllm(
    prompt: str, system: str = SYSTEM_PROMPT_FIDUCIARY, max_tokens: int = 1200
) -> str:
    url = random.choice(VLLM_URLS)
    payload = {
        "model": VLLM_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.8,
        "top_p": 0.95,
    }
    resp = requests.post(
        f"{url}/v1/chat/completions",
        json=payload,
        headers={"Authorization": f"Bearer {VLLM_API_KEY}"},
        timeout=90,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
def call_claude(
    prompt: str, system: str = SYSTEM_PROMPT_FIDUCIARY, max_tokens: int = 1200
) -> str:
    if not HAS_ANTHROPIC:
        raise RuntimeError("anthropic package not installed")
    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    msg = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text.strip()


def call_llm(prompt: str, use_claude_ratio: float = 0.2, **kwargs: Any) -> str:
    if random.random() < use_claude_ratio and ANTHROPIC_API_KEY:
        try:
            return call_claude(prompt, **kwargs)
        except Exception as exc:
            logger.debug(f"Claude fallback: {exc}")
    try:
        return call_vllm(prompt, **kwargs)
    except Exception as exc:
        logger.debug(f"vLLM failed, using Claude: {exc}")
        return call_claude(prompt, **kwargs)


class PortfolioSynthesizer:
    """
    Synthesizes fiduciary reasoning training pairs (chosen/rejected) from
    market scenarios and client profiles.
    """

    def __init__(self, output_path: str | Path) -> None:
        self.output_path = Path(output_path)
        self.output_path.parent.mkdir(parents=True, exist_ok=True)

    def synthesize(
        self,
        count: int = 50000,
        batch_size: int = 100,
        backend: str = "vllm",
    ) -> int:
        """Generate `count` fiduciary reasoning pairs. Returns actual count generated."""
        logger.info(f"Synthesizing {count} fiduciary reasoning pairs...")

        generated = 0
        batch: list[dict] = []

        with self.output_path.open("w") as out_fh:
            while generated < count:
                # Pick random scenario template
                template = random.choice(SCENARIO_TEMPLATES)
                scenario_prompt = _build_scenario_prompt(template)

                pair = self._generate_pair(
                    scenario_prompt, template["category"], backend
                )
                if pair is None:
                    continue

                batch.append(pair)
                if len(batch) >= batch_size:
                    for item in batch:
                        out_fh.write(json.dumps(item) + "\n")
                    out_fh.flush()
                    generated += len(batch)
                    if generated % 1000 == 0 or generated >= count:
                        logger.info(f"  Generated {generated}/{count} pairs")
                    batch = []

            if batch:
                for item in batch:
                    out_fh.write(json.dumps(item) + "\n")
                generated += len(batch)

        logger.success(
            f"Portfolio synthesis complete: {generated} pairs → {self.output_path}"
        )
        return generated

    def _generate_pair(
        self,
        scenario: str,
        category: str,
        backend: str = "vllm",
    ) -> dict[str, Any] | None:
        """Generate a (chosen, rejected) pair for a scenario. Returns None on failure."""
        try:
            # Generate chosen (correct fiduciary) response
            chosen_raw = call_llm(scenario, use_claude_ratio=0.2)

            # Generate rejected (violating) response
            violation_prompt = _build_violation_prompt(scenario)
            rejected_raw = call_llm(
                violation_prompt,
                use_claude_ratio=0.15,
                system=(
                    "You are generating examples of BAD fiduciary advice to train "
                    "a model to detect violations. Generate a response that a "
                    "conflicted broker might give — prioritizing commissions over "
                    "client best interest."
                ),
            )

            # Validate both have content
            if not chosen_raw or len(chosen_raw) < 50:
                return None
            if not rejected_raw or len(rejected_raw) < 50:
                return None

            return {
                "prompt": scenario,
                "chosen": chosen_raw,
                "rejected": rejected_raw,
                "category": category,
                "type": "fiduciary_reasoning_pair",
            }

        except Exception as exc:
            logger.debug(f"  Pair generation failed: {exc}")
            return None


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Synthesize fiduciary reasoning training pairs"
    )
    parser.add_argument(
        "--output",
        default="data/synthesized/portfolio_pairs.jsonl",
        help="Output path for training pairs",
    )
    parser.add_argument("--count", type=int, default=50000)
    parser.add_argument("--backend", choices=["vllm", "claude"], default="vllm")
    args = parser.parse_args()

    synthesizer = PortfolioSynthesizer(output_path=args.output)
    n = synthesizer.synthesize(count=args.count, backend=args.backend)
    logger.info(f"Synthesized {n} pairs → {args.output}")
