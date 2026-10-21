"""
synthesis/prompts.py — Prompt templates for FiduciaryOS training data synthesis.

All synthesis prompts are versioned. When modifying prompts, increment
PROMPT_VERSION and update the changelog below.

Prompt version changelog:
  v1.0 — Initial prompts for SFT, GRPO, and DPO data synthesis
"""

from __future__ import annotations

PROMPT_VERSION = "1.0"

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

FIDUCIARY_SYSTEM_PROMPT = """\
You are FiduciaryOS, an expert fiduciary wealth management system trained on the full body \
of US investment adviser law, SEC/FINRA enforcement actions, and professional fiduciary standards. \
You reason like a CFA charterholder who is also a licensed attorney specializing in securities law. \

Your analysis must always:
1. Identify the client's actual financial interest (not the adviser's interest)
2. Apply the appropriate legal standard (fiduciary duty, suitability, or best interest)
3. Consider tax implications explicitly
4. Flag any conflicts of interest, even if they appear minor
5. Ground recommendations in the client's Policy Artifact constraints

You do NOT give generic financial advice. Every recommendation is specific, quantified, and \
tied to the client's situation."""


SYNTHESIS_SYSTEM_PROMPT = """\
You are a financial domain expert generating training data for FiduciaryOS, \
an AI fiduciary wealth manager. \
Generate high-quality, realistic training pairs that demonstrate expert fiduciary reasoning. \
All scenarios should be legally accurate, financially realistic, and educationally valuable. \
Use real ticker symbols, realistic dollar amounts, and plausible client profiles."""


VIOLATION_ANALYSIS_SYSTEM_PROMPT = """\
You are a securities law expert and former SEC enforcement attorney with 20 years of experience \
analyzing investment adviser violations. You have deep expertise in the Investment Advisers Act of 1940, \
particularly Sections 206(1), 206(2), and 206(4). \
When analyzing adviser conduct, you: \
1. Identify the specific statutory provision violated \
2. Explain the factual basis for the violation \
3. Compare to relevant enforcement precedents \
4. Specify what compliant conduct would have looked like"""


# ---------------------------------------------------------------------------
# SFT training pair prompts
# ---------------------------------------------------------------------------

PORTFOLIO_ANALYSIS_PROMPT = """\
Generate a realistic portfolio analysis scenario for FiduciaryOS training.

Client profile:
{client_profile}

Portfolio state:
{portfolio_state}

Market context:
{market_context}

Generate a training pair with:
1. A detailed portfolio analysis in the style of a CFA-level fiduciary adviser
2. 2-4 specific, actionable recommendations with reasoning
3. Tax impact estimation for each recommendation
4. Risk assessment referencing the client's policy constraints

Format as JSON:
{{
  "prompt": "... [portfolio analysis request] ...",
  "response": {{
    "analysis": "...",
    "recommendations": [
      {{
        "type": "BUY|SELL|HOLD|REBALANCE|HARVEST",
        "ticker": "...",
        "reasoning": "...",
        "amount_usd": 0,
        "pct_of_portfolio": 0.0,
        "tax_impact_usd": 0,
        "fiduciary_basis": "..."
      }}
    ],
    "risk_assessment": "...",
    "policy_compliance": "COMPLIANT|VIOLATION|EDGE_CASE"
  }}
}}"""


TAX_OPTIMIZATION_PROMPT = """\
Generate a realistic tax optimization scenario for FiduciaryOS training.

Client tax profile:
- Federal marginal rate: {federal_rate}%
- State: {state} (marginal rate: {state_rate}%)
- Tax status: {tax_status}  (taxable | IRA | Roth | 401k mix)
- Estimated capital gains this year: ${realized_gains:,}

Portfolio positions with unrealized P&L:
{positions_with_pnl}

Year-end date assumption: {scenario_date}

Generate a training pair demonstrating expert tax-loss harvesting analysis:
1. Identify harvest candidates (losses worth realizing)
2. Apply wash-sale rule analysis for each candidate
3. Identify suitable replacement securities
4. Estimate tax savings vs transaction costs
5. Recommend optimal lot selection strategy for any planned sells

Ensure the wash-sale analysis is legally accurate (IRC §1091, 30-day window)."""


FIDUCIARY_ANALYSIS_PROMPT = """\
Generate a realistic fiduciary duty analysis scenario for FiduciaryOS training.

Scenario type: {scenario_type}
  (CONFLICT_OF_INTEREST | SUITABILITY | DISCLOSURE | BEST_EXECUTION | FEE_REASONABLENESS)

Context:
{scenario_context}

Generate a training pair where FiduciaryOS:
1. Identifies whether a fiduciary duty issue exists
2. Cites the relevant legal standard (IA Act §206, Reg BI, ERISA §404 if applicable)
3. Explains the client impact
4. Recommends the appropriate compliant action

The response should be authoritative, specific, and defensible under examination."""


REBALANCING_PROMPT = """\
Generate a realistic portfolio rebalancing scenario for FiduciaryOS training.

Client policy:
- Target allocation: {target_allocation}
- Rebalance threshold: {threshold}% drift
- Tax status: {tax_status}
- Harvest threshold: ${harvest_threshold:,} minimum loss

Current portfolio (drifted from target):
{current_holdings}

Current prices:
{prices}

Tax lots:
{tax_lots}

Generate a training pair showing:
1. Drift calculation for each asset class
2. Tax-aware trade selection (minimize realized gains)
3. Wash-sale compliance check
4. Complete trade list with tax impact
5. Net cost (tax + transaction cost) vs benefit analysis"""


RISK_ASSESSMENT_PROMPT = """\
Generate a realistic portfolio risk assessment scenario for FiduciaryOS training.

Portfolio state:
- Total value: ${total_value:,}
- Current drawdown from peak: {drawdown:.1%}
- Policy maximum drawdown: {policy_max_drawdown:.1%}
- Realized 20-day volatility (annualized): {realized_vol:.1%}
- Policy volatility target: {target_vol:.1%}
- Largest single position: {max_position_ticker} at {max_position_pct:.1%} of portfolio

Historical context:
{risk_context}

Generate a risk assessment showing:
1. Alert level classification (SAFE/MONITORING/ALERT/SAFE_MODE/HALT)
2. Specific metrics that triggered each alert
3. Forward-looking tail risk assessment
4. Recommended risk-reduction actions with urgency
5. Fiduciary rationale for recommendations"""


# ---------------------------------------------------------------------------
# GRPO reward signal prompts (for policy optimization)
# ---------------------------------------------------------------------------

VIOLATION_DETECTION_PROMPT = """\
You are reviewing the following investment adviser conduct for fiduciary compliance:

{conduct_description}

Analyze this conduct and provide:
1. A verdict: COMPLIANT | VIOLATION | EDGE_CASE
2. If a violation: the specific IA Act provision violated (§206(1), §206(2), §206(4), etc.)
3. The fiduciary harm to the client
4. What compliant conduct would look like

Ground truth for scoring: {ground_truth_violations}"""


POLICY_CHECK_PROMPT = """\
You are verifying whether the following proposed portfolio action complies with the client's \
Policy Artifact.

Policy Artifact (signed, verified):
{policy_artifact_summary}

Proposed action:
{proposed_action}

Current portfolio state:
{portfolio_state}

Determine:
1. Whether each constraint in the Policy Artifact is satisfied
2. If any constraint is violated: which one, by how much, and why
3. Whether the action should be: APPROVED | BLOCKED | MODIFIED

Respond in JSON format:
{{
  "verdict": "APPROVED|BLOCKED|MODIFIED",
  "constraint_checks": [
    {{"constraint": "...", "status": "PASS|FAIL", "detail": "..."}}
  ],
  "blocking_reason": "..." (if BLOCKED),
  "modification_suggestion": "..." (if MODIFIED)
}}"""


COMPARATIVE_QUALITY_PROMPT = """\
Two FiduciaryOS responses to the same portfolio question are shown below.

Question: {question}

Portfolio context: {portfolio_context}

Response A:
{response_a}

Response B:
{response_b}

Evaluate which response better demonstrates fiduciary quality. Consider:
1. Accuracy of financial analysis
2. Completeness of tax consideration
3. Adherence to fiduciary duty standard
4. Specificity and actionability of recommendations
5. Risk-consciousness

Which response is better? Explain your reasoning and give each a score 1-10.

Format as JSON:
{{
  "better_response": "A|B|TIE",
  "score_a": 0,
  "score_b": 0,
  "reasoning": "..."
}}"""


# ---------------------------------------------------------------------------
# DPO preference pair prompts
# ---------------------------------------------------------------------------

DPO_PREFERENCE_CONTEXT = """\
You will be shown two portfolio management responses to the same scenario.
One response demonstrates high fiduciary quality (chosen).
One response demonstrates lower fiduciary quality or fiduciary failure (rejected).

Scenario:
{scenario}

Chosen (better) response:
{chosen}

Rejected (worse) response:
{rejected}

The rejected response fails because: {failure_reason}"""


# ---------------------------------------------------------------------------
# Scenario generation helpers
# ---------------------------------------------------------------------------

SCENARIO_TYPES = [
    "UNDISCLOSED_CONFLICT_OF_INTEREST",
    "TAX_LOSS_HARVEST_OPPORTUNITY",
    "PORTFOLIO_DRIFT_REBALANCE",
    "DRAWDOWN_BREACH_RESPONSE",
    "FEE_STRUCTURE_CONFLICT",
    "ESTATE_PLANNING_CONSIDERATION",
    "CONCENTRATED_POSITION_RISK",
    "LIQUIDITY_CRISIS_MANAGEMENT",
    "SOFT_DOLLAR_ARRANGEMENT",
    "DIRECTED_BROKERAGE",
    "CROSS_TRADING",
    "ALLOCATION_BETWEEN_ACCOUNTS",
    "PERFORMANCE_FEE_CONFLICT",
    "RMD_PLANNING",
    "ROTH_CONVERSION_ANALYSIS",
    "WASH_SALE_EDGE_CASE",
    "ALTERNATIVE_INVESTMENT_DUE_DILIGENCE",
    "MARGIN_CALL_RESPONSE",
]

# Realistic client profiles for training variety
SAMPLE_CLIENT_PROFILES = [
    {
        "type": "ACCUMULATOR",
        "description": "35-year-old software engineer, single, high income ($250k/yr), aggressive growth, 40-year horizon",
        "risk_tolerance": "aggressive",
        "tax_status": "taxable",
        "aum_usd": 450_000,
    },
    {
        "type": "PRE_RETIREE",
        "description": "58-year-old married couple, both working, mixed accounts (401k + taxable), 7-year horizon to retirement",
        "risk_tolerance": "moderate",
        "tax_status": "mixed",
        "aum_usd": 2_100_000,
    },
    {
        "type": "RETIREE",
        "description": "72-year-old retired physician, RMDs required, income-focused, low risk tolerance",
        "risk_tolerance": "conservative",
        "tax_status": "ira_heavy",
        "aum_usd": 5_800_000,
    },
    {
        "type": "BUSINESS_OWNER",
        "description": "45-year-old founder, concentrated stock in company, needs liquidity planning and diversification",
        "risk_tolerance": "moderate",
        "tax_status": "complex",
        "aum_usd": 8_200_000,
    },
    {
        "type": "YOUNG_PROFESSIONAL",
        "description": "27-year-old doctor in residency, high student debt ($320k), low current savings, 35-year horizon",
        "risk_tolerance": "aggressive",
        "tax_status": "roth_eligible",
        "aum_usd": 18_000,
    },
]
