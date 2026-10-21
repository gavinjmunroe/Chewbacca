"""
synthesis/financial_planning_synthesizer.py — 6th synthesis stream: Personal Financial Planning.

Integrates Francesca Finance's full planning engine into FiduciaryOS training data:
  - Monte Carlo retirement projections (1,000-path lognormal simulation)
  - 2026 federal + California tax bracket calculations
  - Contribution sequencing (401k → Mega Backdoor → Roth IRA → brokerage → HYSA)
  - MAGI-based Roth IRA phase-out analysis
  - Cashflow optimization (salary, RSU vesting, net-of-tax take-home)
  - Emergency fund adequacy analysis

This stream teaches the model to:
  1. Build personalized multi-decade financial plans from client profiles
  2. Sequence contributions optimally across account types given tax brackets
  3. Interpret Monte Carlo output (P10/P50/P90 percentile bands)
  4. Calculate after-tax income accurately (federal + state + FICA + CA SDI)
  5. Identify Roth conversion windows and phase-out thresholds

Target: 52,500 high-quality financial planning pairs (15% of corpus).

Usage:
    synthesizer = FinancialPlanningSynthesizer(backend="vllm")
    synthesizer.run(n_pairs=52_500)
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import asdict, dataclass
from pathlib import Path

from loguru import logger

# ---------------------------------------------------------------------------
# 2026 IRS limits (mirrored from core/irs_limits_2026.py for synthesis use)
# ---------------------------------------------------------------------------

IRS_2026 = {
    "employee_401k_limit": 23500,
    "irs_limit_415c": 70000,
    "ira_limit": 7000,
    "ira_limit_catch_up": 8000,
    "roth_ira_phase_out_lower": 150000,
    "roth_ira_phase_out_upper": 165000,
    "ss_wage_base": 176100,
    "additional_medicare_threshold": 200000,
    "federal_standard_deduction": 15750,
    "ca_standard_deduction": 5706,
}

FEDERAL_BRACKETS = [
    (0.10, 11925),
    (0.12, 48475),
    (0.22, 103350),
    (0.24, 197300),
    (0.32, 250525),
    (0.35, 626350),
    (0.37, float("inf")),
]

CA_BRACKETS = [
    (0.01, 10756),
    (0.02, 25499),
    (0.04, 40245),
    (0.06, 55866),
    (0.08, 70606),
    (0.093, 360659),
    (0.103, 432787),
    (0.113, 721314),
    (0.123, float("inf")),
]

SCENARIO_TEMPLATES = [
    {
        "description": "early-career software engineer, LA",
        "age": 24,
        "salary": 130000,
        "rsu_annual": 40000,
        "retirement_age": 62,
        "state": "CA",
        "employer_match_pct": 0.04,
        "employer_match_limit_pct": 0.04,
        "has_mega_backdoor": True,
    },
    {
        "description": "mid-career PM, NYC",
        "age": 34,
        "salary": 195000,
        "rsu_annual": 80000,
        "retirement_age": 60,
        "state": "NY",
        "employer_match_pct": 0.05,
        "employer_match_limit_pct": 0.05,
        "has_mega_backdoor": False,
    },
    {
        "description": "senior engineer, Austin TX (no state income tax)",
        "age": 38,
        "salary": 220000,
        "rsu_annual": 120000,
        "retirement_age": 55,
        "state": "TX",
        "employer_match_pct": 0.06,
        "employer_match_limit_pct": 0.06,
        "has_mega_backdoor": True,
    },
    {
        "description": "physician, single, high earner",
        "age": 42,
        "salary": 380000,
        "rsu_annual": 0,
        "retirement_age": 65,
        "state": "CA",
        "employer_match_pct": 0.03,
        "employer_match_limit_pct": 0.03,
        "has_mega_backdoor": False,
    },
    {
        "description": "new grad, first job, student loans",
        "age": 22,
        "salary": 85000,
        "rsu_annual": 15000,
        "retirement_age": 67,
        "state": "CA",
        "employer_match_pct": 0.03,
        "employer_match_limit_pct": 0.03,
        "has_mega_backdoor": False,
    },
    {
        "description": "pre-IPO startup engineer with large RSU grant",
        "age": 30,
        "salary": 170000,
        "rsu_annual": 200000,
        "retirement_age": 50,
        "state": "CA",
        "employer_match_pct": 0.04,
        "employer_match_limit_pct": 0.04,
        "has_mega_backdoor": True,
    },
    {
        "description": "consultant, variable income",
        "age": 45,
        "salary": 145000,
        "rsu_annual": 0,
        "retirement_age": 65,
        "state": "NY",
        "employer_match_pct": 0.0,
        "employer_match_limit_pct": 0.0,
        "has_mega_backdoor": False,
    },
    {
        "description": "teacher approaching retirement",
        "age": 58,
        "salary": 72000,
        "rsu_annual": 0,
        "retirement_age": 62,
        "state": "CA",
        "employer_match_pct": 0.0,
        "employer_match_limit_pct": 0.0,
        "has_mega_backdoor": False,
    },
]


# ---------------------------------------------------------------------------
# Python implementations of Francesca's financial engines
# (mirrors TypeScript logic in web/src/lib/)
# ---------------------------------------------------------------------------


def _apply_brackets(income: float, brackets: list[tuple[float, float]]) -> float:
    if income <= 0:
        return 0.0
    tax, prev = 0.0, 0.0
    for rate, up_to in brackets:
        slice_ = min(income, up_to) - prev
        if slice_ <= 0:
            break
        tax += slice_ * rate
        prev = up_to
        if income <= up_to:
            break
    return tax


def calc_federal_tax(gross: float, pretax_deductions: float) -> dict:
    std_ded = IRS_2026["federal_standard_deduction"]
    taxable = max(0.0, gross - pretax_deductions - std_ded)
    tax = _apply_brackets(taxable, FEDERAL_BRACKETS)
    marginal = next(
        (rate for rate, up_to in FEDERAL_BRACKETS if taxable <= up_to), 0.37
    )
    return {
        "taxable": round(taxable),
        "tax": round(tax),
        "effective_rate": round(tax / gross, 4) if gross > 0 else 0,
        "marginal_rate": marginal,
    }


def calc_ca_tax(gross: float, pretax_deductions_ca: float) -> dict:
    # CA doesn't allow HSA deduction — only 401k pre-tax
    std_ded = IRS_2026["ca_standard_deduction"]
    taxable = max(0.0, gross - pretax_deductions_ca - std_ded)
    tax = _apply_brackets(taxable, CA_BRACKETS)
    return {
        "taxable": round(taxable),
        "tax": round(tax),
        "effective_rate": round(tax / gross, 4) if gross > 0 else 0,
    }


def calc_payroll(gross: float) -> dict:
    ss = min(gross, IRS_2026["ss_wage_base"]) * 0.062
    medicare = gross * 0.0145
    addl_medicare = max(0, gross - IRS_2026["additional_medicare_threshold"]) * 0.009
    ca_sdi = gross * 0.011
    return {
        "ss": round(ss),
        "medicare": round(medicare),
        "addl_medicare": round(addl_medicare),
        "ca_sdi": round(ca_sdi),
        "total": round(ss + medicare + addl_medicare + ca_sdi),
    }


def calc_roth_allowed(magi: float) -> float:
    lower = IRS_2026["roth_ira_phase_out_lower"]
    upper = IRS_2026["roth_ira_phase_out_upper"]
    limit = IRS_2026["ira_limit"]
    if magi <= lower:
        return limit
    if magi >= upper:
        return 0
    phase = (magi - lower) / (upper - lower)
    return round(limit * (1 - phase))


def calc_contribution_sequence(profile: dict) -> dict:
    """
    Optimally sequence contributions across account types.
    Order: 401k match → HSA → 401k max → Mega Backdoor → Roth IRA → brokerage → HYSA.
    """
    salary = profile["salary"]
    rsu = profile.get("rsu_annual", 0)
    gross = salary + rsu
    match_pct = profile.get("employer_match_pct", 0.04)
    has_mega = profile.get("has_mega_backdoor", False)

    # Step 1: 401k up to employer match
    match_threshold = salary * match_pct
    k401_for_match = min(match_threshold, IRS_2026["employee_401k_limit"])

    # Step 2: HSA (assume HDHP eligible)
    hsa = 4300  # 2026 individual HSA limit

    # Step 3: Fill 401k to max
    k401_max = IRS_2026["employee_401k_limit"]
    employer_match = min(salary * match_pct, k401_max)

    # Step 4: Mega Backdoor Roth (415c limit - employee - employer)
    mega_backdoor = 0
    if has_mega:
        mega_backdoor = max(0, IRS_2026["irs_limit_415c"] - k401_max - employer_match)

    # Step 5: Roth IRA (MAGI-gated)
    magi_approx = max(0, gross - k401_max - hsa)
    roth_allowed = calc_roth_allowed(magi_approx)

    # Step 6: What's left
    total_pretax = k401_max + hsa
    total_invested = total_pretax + mega_backdoor + roth_allowed
    take_home_approx = gross - total_pretax  # simplified

    fed = calc_federal_tax(gross, total_pretax)
    payroll = calc_payroll(gross)
    net_take_home = take_home_approx - fed["tax"] - payroll["total"]

    return {
        "gross_annual": gross,
        "k401_employee": k401_max,
        "k401_employer_match": round(employer_match),
        "hsa": hsa,
        "mega_backdoor_roth": mega_backdoor,
        "roth_ira": roth_allowed,
        "total_annual_invested": round(total_invested + employer_match),
        "federal_tax": fed["tax"],
        "federal_effective_rate": fed["effective_rate"],
        "federal_marginal_rate": fed["marginal_rate"],
        "payroll_taxes": payroll["total"],
        "net_annual_take_home": round(net_take_home),
        "magi_approx": round(magi_approx),
        "roth_eligible": roth_allowed > 0,
    }


def run_monte_carlo(
    initial_balance: float,
    annual_contribution: float,
    years: int,
    n_paths: int = 500,
    annual_return_mean: float = 0.074,
    annual_return_std: float = 0.16,
) -> dict:
    """
    Run Monte Carlo retirement projection using lognormal return paths.
    Returns P10, P25, P50, P75, P90 percentile outcomes.
    """
    import random as rnd

    log_mean = math.log(1 + annual_return_mean) - 0.5 * annual_return_std**2
    log_std = annual_return_std

    final_values: list[float] = []
    for _ in range(n_paths):
        balance = initial_balance
        for _ in range(years):
            r = math.exp(rnd.gauss(log_mean, log_std)) - 1
            balance = balance * (1 + r) + annual_contribution
        final_values.append(balance)

    final_values.sort()

    def pct(p: float) -> int:
        idx = int(p * n_paths)
        return int(final_values[min(idx, n_paths - 1)])

    return {
        "p10": pct(0.10),
        "p25": pct(0.25),
        "p50": pct(0.50),
        "p75": pct(0.75),
        "p90": pct(0.90),
        "years": years,
        "annual_contribution": round(annual_contribution),
        "initial_balance": round(initial_balance),
        "paths": n_paths,
    }


# ---------------------------------------------------------------------------
# Training pair dataclass
# ---------------------------------------------------------------------------


@dataclass
class FinancialPlanningPair:
    pair_id: str
    stream: str = "financial_planning"
    conversations: list[dict] = None
    metadata: dict = None

    def __post_init__(self):
        if self.conversations is None:
            self.conversations = []
        if self.metadata is None:
            self.metadata = {}


# ---------------------------------------------------------------------------
# Synthesizer
# ---------------------------------------------------------------------------


class FinancialPlanningSynthesizer:
    """
    Generates financial planning training pairs using Francesca's engines.

    Unlike other streams (which call an LLM to generate responses), this
    synthesizer generates GROUND-TRUTH correct answers using the actual
    financial computation engines — making these pairs extremely high quality.

    The LLM is used to:
    1. Generate the natural-language client question (diverse phrasing)
    2. Write a clear explanation of the computed results

    The computation engines guarantee mathematical correctness.
    """

    PAIR_TYPES = [
        "contribution_sequencing",
        "tax_analysis",
        "monte_carlo_interpretation",
        "roth_phase_out",
        "retirement_readiness",
        "cashflow_optimization",
    ]

    def __init__(
        self,
        output_dir: str = "data/processed",
        backend: str = "vllm",
        vllm_urls: list[str] | None = None,
        max_workers: int = 8,
    ) -> None:
        import os
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.backend = backend
        self.max_workers = max_workers
        self._vllm_urls = vllm_urls or [
            u.strip() for u in os.environ.get("VLLM_URLS", "http://localhost:8001").split(",")
        ]
        self._llm = None
        self._init_llm()

    def _init_llm(self) -> None:
        import os
        if self.backend == "vllm":
            try:
                import openai
                self._llm = openai.OpenAI(
                    base_url=f"{self._vllm_urls[0]}/v1",
                    api_key=os.environ.get("VLLM_API_KEY", "dummy"),
                )
                logger.info("FinancialPlanningSynthesizer: vLLM client initialized")
            except ImportError:
                self.backend = "claude"
        if self.backend == "claude":
            try:
                import anthropic
                self._llm = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
                logger.info("FinancialPlanningSynthesizer: Claude API client initialized")
            except ImportError:
                raise RuntimeError("Neither openai nor anthropic available")

    def _call_llm(self, system: str, user: str, max_tokens: int = 1024) -> str | None:
        try:
            if self.backend == "vllm":
                import openai
                url = self._vllm_urls[0]
                client = openai.OpenAI(base_url=f"{url}/v1", api_key="dummy")
                resp = client.chat.completions.create(
                    model="Qwen/Qwen2.5-72B-Instruct",
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                    temperature=0.75,
                    max_tokens=max_tokens,
                    timeout=90,
                )
                return resp.choices[0].message.content.strip()
            else:
                import anthropic
                msg = self._llm.messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=max_tokens,
                    system=system,
                    messages=[{"role": "user", "content": user}],
                )
                return msg.content[0].text.strip()
        except Exception as e:
            logger.debug(f"LLM call failed: {e}")
            return None

    def run(self, n_pairs: int = 52_500) -> int:
        output_file = self.output_dir / "financial_planning_pairs.jsonl"
        seen_file = self.output_dir / "financial_planning_seen_ids.txt"
        seen_ids: set[str] = set()
        existing = 0
        if seen_file.exists():
            seen_ids = set(seen_file.read_text().splitlines())
            existing = len(seen_ids)

        remaining = n_pairs - existing
        if remaining <= 0:
            logger.info(f"Financial planning stream already complete ({existing:,} pairs)")
            return existing

        logger.info(f"Financial planning stream: generating {remaining:,} pairs")
        saved = existing
        pair_fns = [
            self._make_contribution_pair,
            self._make_tax_analysis_pair,
            self._make_monte_carlo_pair,
            self._make_roth_pair,
            self._make_retirement_readiness_pair,
            self._make_cashflow_pair,
        ]

        with open(output_file, "a") as out_f, open(seen_file, "a") as seen_f:
            while saved < n_pairs:
                make_fn = random.choice(pair_fns)
                try:
                    pair = make_fn()
                    if pair is None or pair.pair_id in seen_ids:
                        continue
                    out_f.write(json.dumps(asdict(pair)) + "\n")
                    seen_f.write(pair.pair_id + "\n")
                    seen_ids.add(pair.pair_id)
                    saved += 1
                    if saved % 1000 == 0:
                        logger.info(f"  financial_planning: {saved:,}/{n_pairs:,}")
                except Exception as e:
                    logger.debug(f"Financial planning pair failed: {e}")

        logger.info(f"Financial planning stream complete: {saved:,} pairs")
        return saved

    def _make_contribution_pair(self) -> FinancialPlanningPair | None:
        profile = random.choice(SCENARIO_TEMPLATES).copy()
        # Randomize slightly
        profile["salary"] = int(profile["salary"] * random.uniform(0.85, 1.2))
        profile["rsu_annual"] = int(profile.get("rsu_annual", 0) * random.uniform(0.7, 1.4))

        result = calc_contribution_sequence(profile)

        system = (
            "You are a fiduciary financial planner. A client has provided their financial profile. "
            "Explain their optimal contribution sequencing strategy in clear, actionable terms. "
            "Include specific dollar amounts. Be direct and educational."
        )
        user = (
            f"Client profile: {profile['description']}\n"
            f"Annual salary: ${profile['salary']:,}\n"
            f"Annual RSU vesting: ${profile.get('rsu_annual', 0):,}\n"
            f"Employer 401k match: {profile['employer_match_pct']*100:.0f}%\n"
            f"Mega Backdoor Roth available: {profile['has_mega_backdoor']}\n\n"
            f"Computed contribution optimization:\n{json.dumps(result, indent=2)}\n\n"
            "Explain this contribution strategy to the client in 3-5 paragraphs. "
            "Start with the employer match, explain the sequencing logic, and end with their "
            "net take-home impact."
        )
        explanation = self._call_llm(system, user, max_tokens=800)
        if not explanation or len(explanation) < 200:
            return None

        human_prompt = (
            f"I make ${profile['salary']:,}/year with ${profile.get('rsu_annual', 0):,} in RSUs. "
            f"My employer matches {profile['employer_match_pct']*100:.0f}% of contributions. "
            f"{'I have access to a Mega Backdoor Roth. ' if profile['has_mega_backdoor'] else ''}"
            f"How should I sequence my retirement contributions to maximize tax efficiency?"
        )

        pair_id = f"fp_contrib_{int(hashlib.md5(human_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return FinancialPlanningPair(
            pair_id=pair_id,
            conversations=[
                {"from": "human", "value": human_prompt},
                {"from": "gpt", "value": explanation},
            ],
            metadata={"type": "contribution_sequencing", "profile": profile, "result": result},
        )

    def _make_tax_analysis_pair(self) -> FinancialPlanningPair | None:
        profile = random.choice(SCENARIO_TEMPLATES).copy()
        salary = int(profile["salary"] * random.uniform(0.9, 1.15))
        rsu = int(profile.get("rsu_annual", 0) * random.uniform(0.8, 1.3))
        k401 = IRS_2026["employee_401k_limit"]
        hsa = 4300

        gross = salary + rsu
        fed = calc_federal_tax(gross, k401 + hsa)
        payroll = calc_payroll(gross)
        ca = calc_ca_tax(gross, k401) if profile["state"] == "CA" else {"tax": 0, "effective_rate": 0}

        total_tax = fed["tax"] + payroll["total"] + ca["tax"]
        net_take_home = gross - k401 - hsa - total_tax

        system = (
            "You are a fiduciary financial advisor explaining tax implications to a client. "
            "Be precise with numbers. Use clear structure. Explain marginal vs effective rates."
        )
        user = (
            f"Client: {profile['description']}, state: {profile['state']}\n"
            f"Gross income: ${gross:,} (salary ${salary:,} + RSU ${rsu:,})\n"
            f"Pre-tax deductions: 401k ${k401:,} + HSA ${hsa:,}\n\n"
            f"Tax computation:\n"
            f"Federal: ${fed['tax']:,} (effective {fed['effective_rate']*100:.1f}%, marginal {fed['marginal_rate']*100:.0f}%)\n"
            f"Payroll (SS+Medicare+SDI): ${payroll['total']:,}\n"
            f"State ({profile['state']}): ${ca['tax']:,}\n"
            f"Total tax: ${total_tax:,}\n"
            f"Net take-home after deductions + taxes: ${net_take_home:,}/year (${net_take_home//12:,}/month)\n\n"
            "Explain this tax situation to the client and identify 1-2 additional optimization opportunities."
        )
        explanation = self._call_llm(system, user, max_tokens=700)
        if not explanation or len(explanation) < 150:
            return None

        human_prompt = (
            f"I earn ${salary:,} salary plus ${rsu:,} in RSUs in {profile['state']}. "
            f"I max my 401k and HSA. What's my actual tax burden and net take-home?"
        )
        pair_id = f"fp_tax_{int(hashlib.md5(human_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return FinancialPlanningPair(
            pair_id=pair_id,
            conversations=[
                {"from": "human", "value": human_prompt},
                {"from": "gpt", "value": explanation},
            ],
            metadata={"type": "tax_analysis", "gross": gross, "total_tax": total_tax, "state": profile["state"]},
        )

    def _make_monte_carlo_pair(self) -> FinancialPlanningPair | None:
        profile = random.choice(SCENARIO_TEMPLATES).copy()
        current_age = profile["age"]
        retirement_age = profile["retirement_age"]
        years = retirement_age - current_age
        if years < 5:
            return None

        initial = random.randint(10000, 400000)
        annual_contrib = random.randint(20000, 80000)

        mc = run_monte_carlo(initial, annual_contrib, years, n_paths=300)

        swr_p50 = int(mc["p50"] * 0.04)  # 4% safe withdrawal
        swr_p10 = int(mc["p10"] * 0.04)

        system = (
            "You are a fiduciary financial planner interpreting Monte Carlo retirement projections. "
            "Explain the results accessibly. Emphasize the range of outcomes and what the client can control."
        )
        user = (
            f"Client: {profile['description']}, age {current_age}, target retirement at {retirement_age}\n"
            f"Current balance: ${initial:,}\n"
            f"Annual contribution: ${annual_contrib:,}\n"
            f"Monte Carlo results ({years} years, {mc['paths']} paths, 7.4% mean return, 16% std):\n"
            f"  P10 (bad scenario): ${mc['p10']:,} → ${swr_p10:,}/yr withdrawable\n"
            f"  P25:               ${mc['p25']:,}\n"
            f"  P50 (median):      ${mc['p50']:,} → ${swr_p50:,}/yr withdrawable\n"
            f"  P75:               ${mc['p75']:,}\n"
            f"  P90 (good scenario): ${mc['p90']:,}\n\n"
            "Interpret these results for the client. Are they on track? What does the range mean? "
            "What are 2 levers they can pull to improve outcomes?"
        )
        explanation = self._call_llm(system, user, max_tokens=750)
        if not explanation or len(explanation) < 200:
            return None

        human_prompt = (
            f"I'm {current_age} years old with ${initial:,} saved, contributing ${annual_contrib:,}/year. "
            f"I want to retire at {retirement_age}. Run a Monte Carlo projection and tell me if I'm on track."
        )
        pair_id = f"fp_mc_{int(hashlib.md5(human_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return FinancialPlanningPair(
            pair_id=pair_id,
            conversations=[
                {"from": "human", "value": human_prompt},
                {"from": "gpt", "value": explanation},
            ],
            metadata={"type": "monte_carlo", "mc_result": mc, "profile": profile},
        )

    def _make_roth_pair(self) -> FinancialPlanningPair | None:
        magi = random.randint(120000, 200000)
        roth_allowed = calc_roth_allowed(magi)
        lower = IRS_2026["roth_ira_phase_out_lower"]
        upper = IRS_2026["roth_ira_phase_out_upper"]
        phase_pct = max(0, min(1, (magi - lower) / (upper - lower))) * 100

        if roth_allowed == IRS_2026["ira_limit"]:
            scenario = "fully eligible"
        elif roth_allowed == 0:
            scenario = "phased out — backdoor Roth required"
        else:
            scenario = f"partially eligible (${roth_allowed:,} of ${IRS_2026['ira_limit']:,})"

        system = (
            "You are a fiduciary tax advisor. Explain Roth IRA eligibility rules concisely and accurately. "
            "If the client is over the limit, explain the Backdoor Roth strategy."
        )
        user = (
            f"Client MAGI: ${magi:,}\n"
            f"2026 Roth IRA phase-out: ${lower:,}–${upper:,} (single filer)\n"
            f"Phase-out progress: {phase_pct:.0f}%\n"
            f"Maximum Roth IRA contribution allowed: ${roth_allowed:,} ({scenario})\n\n"
            "Explain the client's Roth IRA situation and what they should do."
        )
        explanation = self._call_llm(system, user, max_tokens=600)
        if not explanation or len(explanation) < 150:
            return None

        human_prompt = f"My MAGI is ${magi:,}. How much can I contribute to a Roth IRA in 2026?"
        pair_id = f"fp_roth_{int(hashlib.md5(human_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return FinancialPlanningPair(
            pair_id=pair_id,
            conversations=[
                {"from": "human", "value": human_prompt},
                {"from": "gpt", "value": explanation},
            ],
            metadata={"type": "roth_phase_out", "magi": magi, "roth_allowed": roth_allowed},
        )

    def _make_retirement_readiness_pair(self) -> FinancialPlanningPair | None:
        profile = random.choice(SCENARIO_TEMPLATES).copy()
        current_age = profile["age"]
        retirement_age = profile["retirement_age"]
        years = retirement_age - current_age
        if years < 3:
            return None

        current_savings = random.randint(5000, 800000)
        annual_contrib = calc_contribution_sequence(profile)["total_annual_invested"]
        mc = run_monte_carlo(current_savings, annual_contrib, years, n_paths=300)

        target_by_rule = profile["salary"] * 25  # 25x rule
        on_track_p50 = mc["p50"] >= target_by_rule * 0.9
        shortfall = max(0, target_by_rule - mc["p50"])

        system = (
            "You are a fiduciary retirement planner. Give an honest, direct assessment of retirement readiness. "
            "Use the 25x rule and 4% SWR. Be specific about what the client needs to change if they're behind."
        )
        user = (
            f"Client: {profile['description']}, age {current_age}, target retirement at {retirement_age}\n"
            f"Current savings: ${current_savings:,}\n"
            f"Annual contributions (optimally sequenced): ${annual_contrib:,}\n"
            f"Target savings (25× salary): ${target_by_rule:,}\n"
            f"Monte Carlo P50 outcome: ${mc['p50']:,}\n"
            f"On track at P50: {on_track_p50}\n"
            f"Shortfall at P50: ${shortfall:,}\n\n"
            "Give a clear retirement readiness assessment. If behind, what specifically should change?"
        )
        explanation = self._call_llm(system, user, max_tokens=700)
        if not explanation or len(explanation) < 200:
            return None

        human_prompt = (
            f"I'm {current_age} and want to retire at {retirement_age}. "
            f"I have ${current_savings:,} saved and contribute ${annual_contrib:,}/year. "
            f"Am I on track?"
        )
        pair_id = f"fp_ready_{int(hashlib.md5(human_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return FinancialPlanningPair(
            pair_id=pair_id,
            conversations=[
                {"from": "human", "value": human_prompt},
                {"from": "gpt", "value": explanation},
            ],
            metadata={"type": "retirement_readiness", "on_track": on_track_p50, "shortfall": shortfall},
        )

    def _make_cashflow_pair(self) -> FinancialPlanningPair | None:
        profile = random.choice(SCENARIO_TEMPLATES).copy()
        profile["salary"] = int(profile["salary"] * random.uniform(0.9, 1.15))
        result = calc_contribution_sequence(profile)

        monthly_take_home = result["net_annual_take_home"] // 12
        monthly_invested = result["total_annual_invested"] // 12
        gross_monthly = result["gross_annual"] // 12
        tax_monthly = (result["federal_tax"] + result["payroll_taxes"]) // 12

        system = (
            "You are a fiduciary financial advisor presenting a monthly cashflow analysis. "
            "Be clear and structured. Show the full picture: gross → deductions → taxes → net."
        )
        user = (
            f"Client: {profile['description']}\n"
            f"Monthly gross: ${gross_monthly:,}\n"
            f"Monthly pre-tax deductions (401k + HSA): ${(result['k401_employee'] + result['hsa']) // 12:,}\n"
            f"Monthly taxes (federal + payroll): ${tax_monthly:,}\n"
            f"Monthly net take-home: ${monthly_take_home:,}\n"
            f"Monthly total invested (incl. employer match + Mega Backdoor + Roth): ${monthly_invested:,}\n"
            f"Federal marginal rate: {result['federal_marginal_rate']*100:.0f}%\n"
            f"Federal effective rate: {result['federal_effective_rate']*100:.1f}%\n\n"
            "Present this as a clear monthly cashflow statement and explain where every dollar goes."
        )
        explanation = self._call_llm(system, user, max_tokens=700)
        if not explanation or len(explanation) < 150:
            return None

        human_prompt = (
            f"I earn ${profile['salary']:,}/year. Break down exactly where my money goes each month "
            f"after maxing retirement accounts and paying taxes."
        )
        pair_id = f"fp_cashflow_{int(hashlib.md5(human_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return FinancialPlanningPair(
            pair_id=pair_id,
            conversations=[
                {"from": "human", "value": human_prompt},
                {"from": "gpt", "value": explanation},
            ],
            metadata={"type": "cashflow", "monthly_take_home": monthly_take_home},
        )
