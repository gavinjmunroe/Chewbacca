"""
synthesis/fiduciary_pairs.py — Curated fiduciary training pair templates.

This module provides hand-crafted, high-quality training pair templates that
seed the bulk synthesizer. Unlike auto-generated pairs, these are:
  - Verified for legal accuracy
  - Diverse across scenario types and client profiles
  - Balanced across complaint (positive) and violation (negative) examples
  - Suitable for DPO preference pairs (chosen vs rejected)

Use these as quality anchors when evaluating bulk synthesis output.

These 50 templates represent the "gold standard" — the synthesis engine
is expected to match this quality level for the full 350k corpus.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FiduciaryPairTemplate:
    """A hand-crafted, high-quality training pair template."""

    template_id: str
    scenario_type: str
    client_profile_summary: str
    human_message: str
    ideal_response: str
    rejection_example: str  # What a bad/non-fiduciary response looks like
    rejection_failure_reason: str


# ---------------------------------------------------------------------------
# Tax-loss harvesting templates
# ---------------------------------------------------------------------------

TEMPLATES: list[FiduciaryPairTemplate] = [
    FiduciaryPairTemplate(
        template_id="tlh_001",
        scenario_type="TAX_LOSS_HARVEST_OPPORTUNITY",
        client_profile_summary="High-income earner, 37% federal bracket, California resident, taxable account",
        human_message=(
            "My client is in the 37% federal bracket in California (9.3% marginal state rate). "
            "They hold 500 shares of VTI purchased at $280/share (current price: $241). "
            "They also hold 200 shares of AAPL purchased at $195 (current: $213). "
            "The year ends in 6 weeks. Should we harvest the VTI loss?"
        ),
        ideal_response=(
            "Yes — the VTI position presents a compelling tax-loss harvesting opportunity. Here is the analysis:\n\n"
            "**Loss Calculation**\n"
            "Unrealized loss: 500 × ($241 − $280) = **−$19,500**\n"
            "Holding period: need to confirm purchase date, but if >365 days, qualifies as long-term loss.\n\n"
            "**Tax Savings Estimate**\n"
            "- If long-term loss: $19,500 × 15% LTCG = $2,925 federal + $19,500 × 9.3% state = $1,814 = **$4,739 total**\n"
            "- If short-term loss: $19,500 × (37% + 9.3%) = **$9,029 total** (significantly more valuable)\n\n"
            "**Wash-Sale Compliance (IRC §1091)**\n"
            "VTI is in the US Total Market ETF group. The following are substantially identical and must be avoided "
            "for 30 days before and after the sale:\n"
            "- ITOT (iShares Core S&P Total US Stock Market ETF)\n"
            "- SCHB (Schwab US Broad Market ETF)\n"
            "- SPTM (SPDR Portfolio S&P 1500 Composite)\n\n"
            "**Replacement Security**\n"
            "ITOT and SCHB both track US total market indices and are substantially identical to VTI — "
            "all three must be avoided. Safe wash-sale replacement: **VXF** (Vanguard Extended Market ETF, "
            "mid/small cap tilt, not substantially identical to total market funds). "
            "Hold VXF for 31 days, then return to VTI if desired.\n\n"
            "**Transaction Cost**\n"
            "$241 × 500 × 0.05% (round trip) = **$120** — negligible vs $4,739+ savings.\n\n"
            "**Net Benefit: $4,619 – $9,029** (depending on holding period)\n\n"
            "**Fiduciary Note**: The AAPL position (unrealized gain) should NOT be sold unless there's a "
            "rebalancing reason — realizing gains reduces the net benefit of this harvest."
        ),
        rejection_example=(
            "You should probably harvest the VTI loss to save on taxes. "
            "Just sell VTI and buy a similar ETF. The savings will be significant."
        ),
        rejection_failure_reason=(
            "Rejects on specificity, accuracy, and completeness. Fails to: (1) calculate actual dollar savings, "
            "(2) identify which specific ETFs are substantially identical under the wash-sale rule, "
            "(3) distinguish long-term vs short-term tax treatment, (4) account for transaction costs."
        ),
    ),
    FiduciaryPairTemplate(
        template_id="rebalance_001",
        scenario_type="PORTFOLIO_DRIFT_REBALANCE",
        client_profile_summary="Moderate risk, balanced portfolio, policy threshold 5% drift, taxable account",
        human_message=(
            "Client policy: 60% US equity / 30% bonds / 10% international. "
            "Rebalance threshold: 5% drift. Current allocation: US equity 72%, bonds 19%, international 9%. "
            "Portfolio value: $850,000. Should we rebalance? If so, what trades?"
        ),
        ideal_response=(
            "**Drift Analysis**\n"
            "- US equity: 72% vs 60% target → **+12% over-weight** (exceeds 5% threshold)\n"
            "- Bonds: 19% vs 30% target → **-11% under-weight** (exceeds threshold)\n"
            "- International: 9% vs 10% → -1% (within threshold)\n\n"
            "**Rebalance Required**: Yes — US equity and bond allocations both exceed the 5% trigger.\n\n"
            "**Proposed Trades (tax-minimizing order)**\n\n"
            "*Sells (execute first to fund buys):*\n"
            "1. Sell US equity equivalent of **$102,000** (reduce from $612,000 to $510,000)\n"
            "   - Select lots: prioritize lots with losses or smallest gains first\n"
            "   - Check: any lots near the 1-year mark? Defer sells of <365-day lots if possible\n\n"
            "*Buys (after sell proceeds settle):*\n"
            "2. Buy bonds equivalent of **$93,500** (increase from $161,500 to $255,000)\n"
            "   - BND or AGG for core bond exposure\n\n"
            "*Note*: International ($76,500) is 1% under-weight. "
            "If any sell proceeds remain, deploy to international. "
            "Otherwise, defer — cost-benefit of trading for 1% drift is marginal.\n\n"
            "**Tax Impact Estimate**\n"
            "If the US equity being sold has unrealized gains, the client will owe capital gains tax. "
            "For a $850k portfolio: even $50k in gains × 15-23.8% LTCG = $7,500–$11,900 in taxes. "
            "Consider harvesting any losses in bonds/international first to offset, "
            "or rebalancing new contributions to bonds rather than selling equities.\n\n"
            "**Fiduciary Recommendation**: Proceed with rebalance. The 12% drift materially increases "
            "portfolio risk beyond the client's policy risk tolerance."
        ),
        rejection_example=(
            "Yes, the portfolio needs rebalancing. Sell some equities and buy bonds to get back to target."
        ),
        rejection_failure_reason=(
            "Completely non-specific. Fails to calculate trade sizes, consider tax impact, suggest lot selection strategy, or provide any actionable trade details. Would require follow-up questions that burden the client."
        ),
    ),
    FiduciaryPairTemplate(
        template_id="conflict_001",
        scenario_type="UNDISCLOSED_CONFLICT_OF_INTEREST",
        client_profile_summary="General adviser-client scenario",
        human_message=(
            "Our advisory firm receives a 50bps referral fee from a third-party financial planning firm "
            "when we refer clients for estate planning services. We believe this firm provides excellent "
            "service. Do we need to disclose this arrangement, and if so, how?"
        ),
        ideal_response=(
            "**Yes — disclosure is legally required and must be made before the referral.**\n\n"
            "**Legal Basis**\n"
            "Under Investment Advisers Act §206(3) and Rule 206(4)-3 (Cash Solicitation Rule), "
            "any cash payment for client referrals must be disclosed to clients. "
            "Additionally, under your fiduciary duty, you must disclose all material conflicts of interest "
            "— and a 50bps fee that influences your referral recommendations is clearly material.\n\n"
            "**What Must Be Disclosed**\n"
            "1. That you receive a referral fee (50bps)\n"
            "2. The amount or basis for calculating the fee\n"
            "3. That this creates a conflict of interest — you have a financial incentive to refer to this "
            "firm regardless of whether it is the best option for the client\n"
            "4. Any alternatives you considered and why this firm was selected\n\n"
            "**Form ADV Part 2A Obligation**\n"
            "This arrangement must be disclosed in Item 14 (Client Referrals and Other Compensation) "
            "of your ADV Part 2A brochure.\n\n"
            "**Timing**\n"
            "Disclosure must occur BEFORE or AT THE TIME of the referral — not after. "
            "Verbal disclosure is insufficient; written disclosure is required under Rule 206(4)-3.\n\n"
            "**Best Practice**\n"
            "Even if the firm genuinely provides excellent service, consider: (1) disclosing that you "
            "evaluated multiple firms before selecting this one, and (2) periodically reviewing "
            "whether the referred firm continues to provide best-in-class service for your clients. "
            "Document your due diligence. Mere receipt of the fee does not itself violate fiduciary duty — "
            "but the failure to disclose does."
        ),
        rejection_example=(
            "You should probably mention the arrangement to clients when you refer them. "
            "As long as the firm is good, it should be fine."
        ),
        rejection_failure_reason=(
            "Dangerously incomplete legal guidance. Fails to cite the specific rule (§206(3), Rule 206(4)-3), "
            "ADV Part 2A obligation, timing requirement, or written disclosure requirement. "
            'The reassurance "as long as the firm is good, it should be fine" is false — '
            "the disclosure obligation exists regardless of service quality."
        ),
    ),
    FiduciaryPairTemplate(
        template_id="drawdown_001",
        scenario_type="DRAWDOWN_BREACH_RESPONSE",
        client_profile_summary="Conservative investor, 18% max drawdown policy, currently at 17.2% drawdown",
        human_message=(
            "My conservative client has a maximum drawdown tolerance of 18% in their IPS. "
            "Their portfolio is currently at a 17.2% drawdown. "
            "The model recommends holding and 'riding it out.' What should I do?"
        ),
        ideal_response=(
            "**Do not simply hold without action. Here is the fiduciary analysis:**\n\n"
            "**Current Status**: 17.2% drawdown against 18% policy maximum = **only 0.8% of headroom remaining**.\n\n"
            "**Risk Guardian Assessment**: SAFE_MODE imminent. At 17.2%, you are 95.5% of the way to the "
            "policy breach threshold. Any single down day of >0.8% in absolute terms will breach the IPS.\n\n"
            "**Fiduciary Obligations at This Threshold**\n"
            "1. **Immediate client notification** — The client must be informed of their current drawdown "
            "relative to their stated tolerance. This is not optional; failure to notify could be a "
            "fiduciary breach in itself.\n"
            "2. **Re-consent or IPS revision** — If the client wants to 'hold,' you need written "
            "re-consent acknowledging they understand they may breach their stated maximum tolerance.\n"
            "3. **Protective action** — If the client cannot be reached, the fiduciary default is to "
            "protect capital, not hold for a rebound.\n\n"
            "**Recommended Actions (in order)**\n"
            "1. Call the client today. Explain the situation: 17.2% drawdown, 18% limit, current market conditions.\n"
            "2. Offer three options: (a) reduce equity exposure now to create buffer, "
            "(b) revise IPS max drawdown upward in writing, (c) hold with written acknowledgment of risk.\n"
            "3. Document the conversation and the client's decision.\n\n"
            "**On the Model Recommendation**\n"
            "The model's 'hold and ride it out' recommendation may be statistically reasonable for "
            "a long-term investor, but it ignores the client's explicitly documented risk tolerance. "
            "A fiduciary must follow the client's IPS constraints, not override them with model predictions. "
            "If the client's actual emotional tolerance is higher than 18%, update the IPS — "
            "but do not unilaterally decide the policy doesn't apply."
        ),
        rejection_example=(
            "The model is probably right that the market will recover. I would hold and not make "
            "any changes. Selling at a loss would lock in the decline."
        ),
        rejection_failure_reason=(
            "Fails the fiduciary duty entirely. Prioritizes the adviser's market view over the client's "
            "documented IPS policy. Fails to notify the client, ignores the proximity to the breach threshold, "
            "and does not distinguish between 'market recovery' and the client's documented risk tolerance."
        ),
    ),
]
