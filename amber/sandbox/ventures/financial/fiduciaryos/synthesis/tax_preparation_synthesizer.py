"""
synthesis/tax_preparation_synthesizer.py — Stream 7: CPA-grade tax preparation.

Generates 60,000 high-quality training pairs covering advanced individual tax
topics: AMT/ISO planning, RSU/ESPP strategies, Roth conversion ladders, multi-state
nexus, QSBS, Schedule D optimization, estimated payments, and backdoor Roth.

This stream teaches the model to:
  1. Compute AMT liability from ISO exercises and advise on exercise timing
  2. Analyze equity compensation dispositions (qualifying vs. disqualifying)
  3. Optimize Roth conversion amounts for bracket-filling
  4. Calculate capital gain/loss harvesting with carryforward offsets
  5. Allocate income and deductions across multiple state returns
  6. Calculate safe-harbor estimated payments (90%/110% methods)
  7. Explain the pro-rata rule trap and backdoor Roth mechanics
  8. Evaluate IRC §1202 QSBS eligibility and optimize exit timing

All tax calculations are deterministic Python — the LLM only writes the
natural-language explanation wrapper around ground-truth computed results.

Target: 60,000 CPA-grade training pairs (Stream 7 of FiduciaryOS corpus).

Usage:
    synthesizer = TaxPreparationSynthesizer(backend="vllm")
    synthesizer.run(n_pairs=60_000)

2026 IRS limits used throughout:
    - 401(k) employee contribution: $23,500
    - IRA limit: $7,000
    - Roth IRA phase-out: $150,000–$165,000 (single)
    - Standard deduction (MFJ): $31,500 | (single): $15,750
    - AMT exemption (single): $88,100 | phase-out starts: $626,350
    - Long-term capital gains 0%/15%/20% breakpoints (single): $48,350/$533,400
    - NIIT threshold (single): $200,000
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
from dataclasses import asdict, dataclass
from pathlib import Path

from loguru import logger

# ---------------------------------------------------------------------------
# 2026 IRS constants
# ---------------------------------------------------------------------------

IRS_2026 = {
    # Retirement
    "employee_401k_limit": 23_500,
    "irs_limit_415c": 70_000,
    "ira_limit": 7_000,
    "ira_limit_catch_up": 8_000,  # age 50+
    "roth_ira_phase_out_lower": 150_000,   # single
    "roth_ira_phase_out_upper": 165_000,
    # Social Security / Medicare
    "ss_wage_base": 176_100,
    "additional_medicare_threshold_single": 200_000,
    # Standard deductions
    "federal_std_ded_single": 15_750,
    "federal_std_ded_mfj": 31_500,
    # AMT (single)
    "amt_exemption_single": 88_100,
    "amt_phase_out_start_single": 626_350,
    "amt_phase_out_rate": 0.25,
    "amt_rate_1": 0.26,      # on first $232,600 of AMTI above exemption
    "amt_rate_2": 0.28,      # above $232,600
    "amt_rate_threshold": 232_600,
    # Capital gains brackets (single)
    "ltcg_0pct_top": 48_350,
    "ltcg_15pct_top": 533_400,
    # NIIT
    "niit_threshold_single": 200_000,
    "niit_rate": 0.038,
    # QSBS
    "qsbs_gain_exclusion_pct": 1.00,   # post-2010 C-corp stock: 100%
    "qsbs_max_gain_per_issuer": 10_000_000,  # or 10x basis
}

# Federal ordinary income brackets (single filer, 2026)
FEDERAL_BRACKETS_SINGLE = [
    (0.10,  11_925),
    (0.12,  48_475),
    (0.22, 103_350),
    (0.24, 197_300),
    (0.32, 250_525),
    (0.35, 626_350),
    (0.37, float("inf")),
]

# California state income tax brackets (single, 2026)
CA_BRACKETS = [
    (0.010,  10_756),
    (0.020,  25_499),
    (0.040,  40_245),
    (0.060,  55_866),
    (0.080,  70_606),
    (0.093, 360_659),
    (0.103, 432_787),
    (0.113, 721_314),
    (0.123, float("inf")),
]

# New York state income tax brackets (single, 2026 — approximate)
NY_BRACKETS = [
    (0.040,  17_150),
    (0.045,  23_600),
    (0.0525, 27_900),
    (0.0585, 161_550),
    (0.0625, 323_200),
    (0.0685, 2_155_350),
    (0.0965, float("inf")),
]

# ---------------------------------------------------------------------------
# Client archetypes — the "who" behind each scenario
# ---------------------------------------------------------------------------

CLIENT_ARCHETYPES = [
    {
        "id": "tech_rsu",
        "description": "Tech employee with heavy RSU vesting",
        "salary": 180_000,
        "rsu_annual": 120_000,
        "state": "CA",
        "filing_status": "single",
        "age": 32,
    },
    {
        "id": "startup_iso",
        "description": "Pre-IPO startup employee with ISO options",
        "salary": 160_000,
        "rsu_annual": 0,
        "iso_strike": 1.00,
        "iso_fmv_at_exercise": 45.00,
        "iso_shares": 50_000,
        "state": "CA",
        "filing_status": "single",
        "age": 29,
    },
    {
        "id": "consultant_state_change",
        "description": "High-income consultant switching states CA → TX mid-year",
        "salary": 320_000,
        "rsu_annual": 0,
        "state_first_half": "CA",
        "state_second_half": "TX",
        "filing_status": "single",
        "age": 41,
    },
    {
        "id": "physician_scorp",
        "description": "Physician with S-corp income + backdoor Roth",
        "w2_salary": 180_000,    # reasonable salary from S-corp
        "scorp_distribution": 220_000,  # distributions (no SE tax)
        "state": "CA",
        "filing_status": "single",
        "age": 44,
        "has_trad_ira_balance": True,
        "trad_ira_balance": 0,  # rolled into 401k to avoid pro-rata
    },
    {
        "id": "early_retiree_roth_ladder",
        "description": "Early retiree doing Roth conversion ladder",
        "age": 58,
        "trad_ira_balance": 800_000,
        "roth_balance": 120_000,
        "annual_spend": 85_000,
        "state": "TX",
        "filing_status": "single",
        "other_income": 18_000,  # part-time / dividends
    },
    {
        "id": "espp_participant",
        "description": "ESPP participant with qualifying and disqualifying dispositions",
        "salary": 140_000,
        "espp_purchase_price": 42.00,    # 85% of lower of grant/purchase FMV
        "espp_fmv_at_purchase": 58.00,   # FMV at purchase date
        "espp_fmv_at_sale_qualifying": 71.00,   # held > 1yr + 2yr from grant
        "espp_fmv_at_sale_disqualifying": 66.00,  # sold early
        "espp_shares_qualifying": 500,
        "espp_shares_disqualifying": 300,
        "state": "CA",
        "filing_status": "single",
        "age": 35,
    },
    {
        "id": "qsbs_holder",
        "description": "QSBS holder approaching 5-year mark",
        "qsbs_basis": 200_000,
        "qsbs_fmv_now": 2_200_000,
        "qsbs_gain": 2_000_000,
        "months_held": 55,          # 5 months to go
        "state": "CA",
        "filing_status": "single",
        "age": 38,
        "salary": 0,
        "other_ordinary_income": 50_000,
    },
    {
        "id": "remote_multistate",
        "description": "Remote worker with multi-state nexus: NY + CA + WA",
        "salary": 250_000,
        "days_ny": 120,
        "days_ca": 90,
        "days_wa": 80,
        "days_other": 75,   # total = 365
        "state_domicile": "NY",
        "filing_status": "single",
        "age": 36,
    },
]


# ---------------------------------------------------------------------------
# Core tax math engines (all deterministic Python)
# ---------------------------------------------------------------------------


def _apply_brackets(income: float, brackets: list[tuple[float, float]]) -> float:
    """Apply progressive tax brackets to income. Returns total tax owed."""
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


def _marginal_rate(taxable: float, brackets: list[tuple[float, float]]) -> float:
    """Return the marginal rate for a given taxable income."""
    for rate, up_to in brackets:
        if taxable <= up_to:
            return rate
    return brackets[-1][0]


def calc_federal_ordinary_tax(taxable_income: float) -> dict:
    """Compute federal tax on ordinary taxable income (single filer)."""
    taxable_income = max(0.0, taxable_income)
    tax = _apply_brackets(taxable_income, FEDERAL_BRACKETS_SINGLE)
    marginal = _marginal_rate(taxable_income, FEDERAL_BRACKETS_SINGLE)
    effective = tax / taxable_income if taxable_income > 0 else 0.0
    return {
        "taxable_income": round(taxable_income),
        "tax": round(tax),
        "marginal_rate": marginal,
        "effective_rate": round(effective, 4),
    }


def calc_amt(amti_before_exemption: float) -> dict:
    """
    Compute AMT liability.

    amti_before_exemption = regular taxable income
        + ISO bargain element (FMV – strike at exercise)
        + other AMT preferences
        - standard deduction (add back, AMT doesn't allow it)

    Returns AMT tax and whether AMT applies over regular tax.
    """
    exemption = IRS_2026["amt_exemption_single"]
    phase_out_start = IRS_2026["amt_phase_out_start_single"]

    # Phase-out: exemption reduced by 25 cents per dollar above threshold
    if amti_before_exemption > phase_out_start:
        reduction = (amti_before_exemption - phase_out_start) * IRS_2026["amt_phase_out_rate"]
        exemption = max(0.0, exemption - reduction)

    amti = max(0.0, amti_before_exemption - exemption)
    threshold = IRS_2026["amt_rate_threshold"]
    if amti <= threshold:
        amt_tax = amti * IRS_2026["amt_rate_1"]
    else:
        amt_tax = threshold * IRS_2026["amt_rate_1"] + (amti - threshold) * IRS_2026["amt_rate_2"]

    return {
        "amti_before_exemption": round(amti_before_exemption),
        "amt_exemption_applied": round(exemption),
        "amti_after_exemption": round(amti),
        "amt_tax": round(amt_tax),
    }


def calc_ltcg_tax(
    ltcg: float,
    ordinary_taxable_income: float,
    gross_income: float,
    filing_status: str = "single",
) -> dict:
    """
    Compute federal long-term capital gains tax using stacking rules.
    LTCG is stacked on top of ordinary income for bracket determination.
    """
    ltcg = max(0.0, ltcg)
    top_of_ordinary = ordinary_taxable_income

    # Stack LTCG on top of ordinary income
    ltcg_0pct_top = IRS_2026["ltcg_0pct_top"]
    ltcg_15pct_top = IRS_2026["ltcg_15pct_top"]

    # Amount of LTCG in 0% bucket
    in_0pct = max(0.0, min(ltcg, max(0.0, ltcg_0pct_top - top_of_ordinary)))
    # Remaining LTCG
    remaining = ltcg - in_0pct
    # Amount in 15% bucket
    in_15pct = max(0.0, min(remaining, max(0.0, ltcg_15pct_top - max(top_of_ordinary, ltcg_0pct_top))))
    # Anything left goes at 20%
    in_20pct = max(0.0, ltcg - in_0pct - in_15pct)

    ltcg_tax = in_0pct * 0.0 + in_15pct * 0.15 + in_20pct * 0.20

    # Net Investment Income Tax (3.8%)
    niit_threshold = IRS_2026["niit_threshold_single"]
    niit_base = max(0.0, min(ltcg, gross_income - niit_threshold))
    niit = niit_base * IRS_2026["niit_rate"]

    return {
        "ltcg": round(ltcg),
        "in_0pct_bucket": round(in_0pct),
        "in_15pct_bucket": round(in_15pct),
        "in_20pct_bucket": round(in_20pct),
        "ltcg_federal_tax": round(ltcg_tax),
        "niit": round(niit),
        "total_ltcg_tax": round(ltcg_tax + niit),
        "blended_ltcg_rate": round((ltcg_tax + niit) / ltcg, 4) if ltcg > 0 else 0.0,
    }


def calc_ca_tax(taxable_income: float) -> dict:
    """Compute California state income tax (single filer)."""
    taxable_income = max(0.0, taxable_income)
    ca_std = 5_706  # 2026 CA standard deduction
    taxable_ca = max(0.0, taxable_income - ca_std)
    tax = _apply_brackets(taxable_ca, CA_BRACKETS)
    # CA Mental Health Services Tax: 1% on income over $1M
    mhst = max(0.0, taxable_ca - 1_000_000) * 0.01
    total = tax + mhst
    return {
        "taxable_ca": round(taxable_ca),
        "ca_tax": round(tax),
        "mhst": round(mhst),
        "total_ca_tax": round(total),
        "ca_effective_rate": round(total / taxable_income, 4) if taxable_income > 0 else 0.0,
    }


def calc_ny_tax(taxable_income: float) -> dict:
    """Compute New York state income tax (single filer, approximate)."""
    taxable_income = max(0.0, taxable_income)
    tax = _apply_brackets(taxable_income, NY_BRACKETS)
    # NYC resident surtax (~3.876% on income, simplified)
    return {
        "taxable_ny": round(taxable_income),
        "ny_state_tax": round(tax),
        "ny_effective_rate": round(tax / taxable_income, 4) if taxable_income > 0 else 0.0,
    }


def calc_roth_phase_out(magi: float) -> float:
    """Return allowed Roth IRA contribution for single filer given MAGI."""
    lower = IRS_2026["roth_ira_phase_out_lower"]
    upper = IRS_2026["roth_ira_phase_out_upper"]
    limit = IRS_2026["ira_limit"]
    if magi <= lower:
        return limit
    if magi >= upper:
        return 0.0
    phase = (magi - lower) / (upper - lower)
    # Round to nearest $10, minimum $200 if not fully phased out
    allowed = limit * (1 - phase)
    rounded = max(200.0, round(allowed / 10) * 10) if allowed > 0 else 0.0
    return rounded


def calc_amt_iso_analysis(
    salary: float,
    iso_shares: int,
    strike: float,
    fmv: float,
    k401_pretax: float = 0.0,
) -> dict:
    """
    Full AMT analysis for ISO exercise.
    Returns regular tax, AMT tax, which applies, and break-even analysis.
    """
    bargain_element = (fmv - strike) * iso_shares

    # Regular tax: salary only (ISOs not taxable on exercise for regular tax)
    std_ded = IRS_2026["federal_std_ded_single"]
    regular_taxable = max(0.0, salary - k401_pretax - std_ded)
    regular = calc_federal_ordinary_tax(regular_taxable)

    # AMT: add bargain element back in (AMT preference item)
    # AMT doesn't allow standard deduction — add it back
    amti_before_exemption = regular_taxable + bargain_element + std_ded
    amt_result = calc_amt(amti_before_exemption)

    amt_applies = amt_result["amt_tax"] > regular["tax"]
    incremental_amt = max(0.0, amt_result["amt_tax"] - regular["tax"])
    effective_cost_per_share = (incremental_amt / iso_shares) if iso_shares > 0 else 0.0

    # AMT credit carryforward (if stock is later sold at disqualifying disposition,
    # the AMT credit becomes usable in future years)
    amt_credit_carryforward = incremental_amt  # simplified: full AMT paid becomes credit

    return {
        "salary": round(salary),
        "iso_shares": iso_shares,
        "strike_price": round(strike, 2),
        "fmv_at_exercise": round(fmv, 2),
        "bargain_element_total": round(bargain_element),
        "bargain_element_per_share": round(fmv - strike, 2),
        "regular_taxable_income": regular["taxable_income"],
        "regular_tax": regular["tax"],
        "amti_before_exemption": amt_result["amti_before_exemption"],
        "amt_exemption_applied": amt_result["amt_exemption_applied"],
        "amti_after_exemption": amt_result["amti_after_exemption"],
        "amt_tax": amt_result["amt_tax"],
        "amt_applies": amt_applies,
        "incremental_amt_owed": round(incremental_amt),
        "effective_cost_per_share_from_amt": round(effective_cost_per_share, 2),
        "amt_credit_carryforward": round(amt_credit_carryforward),
        "total_tax_if_exercise": round(regular["tax"] + incremental_amt),
        "total_tax_if_no_exercise": regular["tax"],
    }


def calc_roth_conversion_optimal(
    trad_ira_balance: float,
    other_income: float,
    target_bracket_top: float,
    bracket_name: str,
) -> dict:
    """
    Calculate the optimal Roth conversion amount to fill a given bracket.
    Accounts for the fact that conversion income shifts subsequent LTCG stacking.
    """
    std_ded = IRS_2026["federal_std_ded_single"]
    current_taxable = max(0.0, other_income - std_ded)
    room_in_bracket = max(0.0, target_bracket_top - current_taxable)

    # Conversion amount: fill to top of target bracket
    conversion = min(room_in_bracket, trad_ira_balance)
    new_taxable = current_taxable + conversion

    tax_before = calc_federal_ordinary_tax(current_taxable)
    tax_after = calc_federal_ordinary_tax(new_taxable)
    incremental_tax = tax_after["tax"] - tax_before["tax"]
    effective_conversion_rate = incremental_tax / conversion if conversion > 0 else 0.0

    # Future tax avoided: assume converted amount grows to 2× over 20yr @ 3.5% real
    # and that future marginal rate would be same bracket (conservative)
    growth_factor = 2.0
    future_value_converted = conversion * growth_factor
    future_tax_avoided = future_value_converted * tax_after["marginal_rate"]
    npv_benefit = future_tax_avoided / (1.035 ** 20) - incremental_tax

    return {
        "trad_ira_balance": round(trad_ira_balance),
        "other_income": round(other_income),
        "current_taxable_income": round(current_taxable),
        "room_in_bracket": round(room_in_bracket),
        "optimal_conversion_amount": round(conversion),
        "new_taxable_income_after_conversion": round(new_taxable),
        "tax_before_conversion": tax_before["tax"],
        "tax_after_conversion": tax_after["tax"],
        "incremental_tax_on_conversion": round(incremental_tax),
        "effective_conversion_rate": round(effective_conversion_rate, 4),
        "target_bracket": bracket_name,
        "marginal_rate_in_bracket": tax_after["marginal_rate"],
        "npv_benefit_rough_estimate": round(npv_benefit),
        "remaining_trad_ira": round(trad_ira_balance - conversion),
    }


def calc_schedule_d(positions: list[dict]) -> dict:
    """
    Compute Schedule D with tax-loss harvesting optimization.

    Each position: {ticker, shares, cost_basis_per_share, current_price,
                    holding_days, unrealized_pnl}

    Returns: sorted harvest candidates, net short/long positions, carryforward.
    """
    st_gains, lt_gains, st_losses, lt_losses = 0.0, 0.0, 0.0, 0.0
    harvest_candidates: list[dict] = []

    for pos in positions:
        pnl = pos["unrealized_pnl"]
        is_long_term = pos.get("holding_days", 0) >= 366

        if pnl < 0:
            harvest_candidates.append({
                "ticker": pos["ticker"],
                "unrealized_loss": round(abs(pnl)),
                "holding_days": pos.get("holding_days", 0),
                "is_long_term": is_long_term,
                "tax_savings_at_37pct_st": round(abs(pnl) * 0.37) if not is_long_term else 0,
                "tax_savings_at_23_8pct_lt": round(abs(pnl) * 0.238) if is_long_term else 0,
            })
            if is_long_term:
                lt_losses += abs(pnl)
            else:
                st_losses += abs(pnl)
        else:
            if is_long_term:
                lt_gains += pnl
            else:
                st_gains += pnl

    # Netting rules: ST losses first offset ST gains, then LT gains
    net_st = st_gains - st_losses
    net_lt = lt_gains - lt_losses

    # If net_st is negative, it offsets net_lt
    if net_st < 0:
        net_lt += net_st  # reduces LT gains or creates LT carryforward
        final_st = 0.0
        final_lt = max(0.0, net_lt)
        st_carryforward = 0.0
        lt_carryforward = max(0.0, -net_lt)
    else:
        final_st = net_st
        if net_lt < 0:
            # LT losses offset LT carryforward
            final_lt = 0.0
            lt_carryforward = abs(net_lt)
        else:
            final_lt = net_lt
            lt_carryforward = 0.0
        st_carryforward = 0.0

    # Up to $3,000 of excess loss offsets ordinary income
    ordinary_offset = min(3_000, st_carryforward + lt_carryforward)
    total_carryforward = max(0.0, st_carryforward + lt_carryforward - ordinary_offset)

    harvest_candidates.sort(key=lambda x: x["unrealized_loss"], reverse=True)

    return {
        "short_term_gains": round(st_gains),
        "short_term_losses": round(st_losses),
        "long_term_gains": round(lt_gains),
        "long_term_losses": round(lt_losses),
        "net_short_term": round(net_st),
        "net_long_term": round(net_lt),
        "taxable_st_gain": round(final_st),
        "taxable_lt_gain": round(final_lt),
        "ordinary_income_offset": round(ordinary_offset),
        "loss_carryforward_to_next_year": round(total_carryforward),
        "harvest_candidates": harvest_candidates[:5],  # top 5 by loss magnitude
    }


def calc_multi_state_allocation(
    salary: float,
    days_ny: int,
    days_ca: int,
    days_wa: int,
    days_other: int,
    domicile: str = "NY",
) -> dict:
    """
    Allocate W-2 income across NY, CA, WA for a remote worker.
    NY taxes all income of domiciliaries PLUS sourced income of non-domiciliaries.
    CA taxes California-sourced income (days worked in CA / total days).
    WA has no income tax.
    """
    total_days = days_ny + days_ca + days_wa + days_other
    ca_pct = days_ca / total_days
    ny_pct = days_ny / total_days

    # NY resident: all worldwide income taxable (credit given for CA taxes paid)
    ny_income_as_resident = salary  # domiciliary taxed on everything
    ny_income_sourced = salary * ny_pct

    # CA: only CA-sourced income
    ca_income = salary * ca_pct

    ny_result = calc_ny_tax(ny_income_as_resident)
    ca_result = calc_ca_tax(ca_income)

    # NY credit for taxes paid to CA (prevents double taxation)
    # Credit = lesser of: CA tax paid OR (NY tax × CA income / NY total income)
    ny_credit_limit = ny_result["ny_state_tax"] * (ca_income / salary) if salary > 0 else 0
    ny_credit = min(ca_result["total_ca_tax"], ny_credit_limit)
    ny_net_after_credit = ny_result["ny_state_tax"] - ny_credit

    total_state_tax = ny_net_after_credit + ca_result["total_ca_tax"]
    effective_combined_state_rate = total_state_tax / salary if salary > 0 else 0

    return {
        "salary": round(salary),
        "total_working_days": total_days,
        "days_ny": days_ny,
        "days_ca": days_ca,
        "days_wa": days_wa,
        "ca_allocation_pct": round(ca_pct * 100, 1),
        "ny_allocation_pct": round(ny_pct * 100, 1),
        "ny_taxable_income": round(ny_income_as_resident),
        "ca_taxable_income": round(ca_income),
        "ny_state_tax_gross": ny_result["ny_state_tax"],
        "ca_state_tax": ca_result["total_ca_tax"],
        "ny_credit_for_ca_taxes": round(ny_credit),
        "ny_net_after_credit": round(ny_net_after_credit),
        "total_state_tax_burden": round(total_state_tax),
        "effective_combined_state_rate": round(effective_combined_state_rate, 4),
        "wa_tax": 0,  # no income tax
    }


def calc_estimated_payments(
    prior_year_tax: float,
    current_year_income: float,
    current_year_withholding: float,
    prior_year_agi: float,
) -> dict:
    """
    Calculate quarterly estimated tax payments using safe harbor rules.

    Safe Harbor Methods (single filer):
      Method A: 90% of current year tax
      Method B: 100% of prior year tax (110% if prior AGI > $150k)

    Quarterly due dates: April 15, June 15, Sept 15, Jan 15 (following year).
    """
    # Estimate current year tax
    std_ded = IRS_2026["federal_std_ded_single"]
    current_taxable = max(0.0, current_year_income - std_ded)
    current_tax_result = calc_federal_ordinary_tax(current_taxable)
    current_year_tax = current_tax_result["tax"]

    # Safe Harbor A: 90% of current year
    safe_harbor_a = current_year_tax * 0.90

    # Safe Harbor B: 100% or 110% of prior year
    multiplier = 1.10 if prior_year_agi > 150_000 else 1.00
    safe_harbor_b = prior_year_tax * multiplier

    # Minimum required = lesser of A or B (use whichever avoids penalty)
    min_required = min(safe_harbor_a, safe_harbor_b)

    # Net payment needed after withholding
    net_needed = max(0.0, min_required - current_year_withholding)
    quarterly_payment = net_needed / 4

    # If withholding already exceeds safe harbor — no estimated payments required
    withholding_covers = current_year_withholding >= min_required

    return {
        "prior_year_tax": round(prior_year_tax),
        "prior_year_agi": round(prior_year_agi),
        "current_year_income": round(current_year_income),
        "current_year_estimated_tax": round(current_year_tax),
        "current_year_withholding": round(current_year_withholding),
        "safe_harbor_a_amount": round(safe_harbor_a),  # 90% current
        "safe_harbor_b_multiplier": multiplier,
        "safe_harbor_b_amount": round(safe_harbor_b),  # 100%/110% prior
        "minimum_required_payment": round(min_required),
        "remaining_after_withholding": round(net_needed),
        "quarterly_payment_recommended": round(quarterly_payment),
        "withholding_covers_safe_harbor": withholding_covers,
        "quarters": ["April 15", "June 15", "September 15", "January 15 (next year)"],
    }


def calc_espp_dispositions(
    purchase_price: float,
    fmv_at_purchase: float,
    fmv_at_sale_q: float,   # qualifying disposition price
    fmv_at_sale_disq: float,  # disqualifying disposition price
    shares_qualifying: int,
    shares_disqualifying: int,
    salary: float,
    discount_pct: float = 0.15,
) -> dict:
    """
    ESPP tax analysis for both qualifying and disqualifying dispositions.

    Qualifying Disposition: held > 2 years from grant date AND > 1 year from purchase date.
      - Ordinary income = lesser of: (a) actual gain, (b) discount at grant date FMV
      - Remainder = LTCG

    Disqualifying Disposition: sold before the above holding periods.
      - Ordinary income = FMV at purchase - purchase price (the discount element)
      - Remainder = STCG or STCL
    """
    # --- Qualifying Disposition ---
    q_gain_per_share = fmv_at_sale_q - purchase_price
    q_ordinary_per_share = min(q_gain_per_share, fmv_at_purchase * discount_pct)
    q_ltcg_per_share = max(0.0, q_gain_per_share - q_ordinary_per_share)

    q_ordinary_total = q_ordinary_per_share * shares_qualifying
    q_ltcg_total = q_ltcg_per_share * shares_qualifying

    # --- Disqualifying Disposition ---
    disq_ordinary_per_share = fmv_at_purchase - purchase_price   # discount element
    disq_stcg_per_share = fmv_at_sale_disq - fmv_at_purchase     # appreciation from purchase to sale

    disq_ordinary_total = disq_ordinary_per_share * shares_disqualifying
    disq_stcg_total = disq_stcg_per_share * shares_disqualifying

    # Tax on ordinary income components (stacked on salary)
    # Marginal rate on ordinary ESPP income
    std_ded = IRS_2026["federal_std_ded_single"]
    base_taxable = max(0.0, salary - std_ded)
    fed_base = calc_federal_ordinary_tax(base_taxable)
    marginal_ordinary = fed_base["marginal_rate"]

    tax_q_ordinary = q_ordinary_total * marginal_ordinary
    tax_disq_ordinary = disq_ordinary_total * marginal_ordinary
    # LTCG from qualifying (use 15% for simplicity if income not super high)
    ltcg_rate = 0.15 if (salary + q_ordinary_total + q_ltcg_total) < IRS_2026["ltcg_15pct_top"] else 0.20
    tax_q_ltcg = q_ltcg_total * ltcg_rate
    # STCG from disqualifying = ordinary rate
    tax_disq_stcg = disq_stcg_total * marginal_ordinary

    return {
        "qualifying_disposition": {
            "shares": shares_qualifying,
            "purchase_price": round(purchase_price, 2),
            "sale_price": round(fmv_at_sale_q, 2),
            "gain_per_share": round(q_gain_per_share, 2),
            "ordinary_income_per_share": round(q_ordinary_per_share, 2),
            "ltcg_per_share": round(q_ltcg_per_share, 2),
            "ordinary_income_total": round(q_ordinary_total),
            "ltcg_total": round(q_ltcg_total),
            "estimated_federal_tax": round(tax_q_ordinary + tax_q_ltcg),
        },
        "disqualifying_disposition": {
            "shares": shares_disqualifying,
            "purchase_price": round(purchase_price, 2),
            "sale_price": round(fmv_at_sale_disq, 2),
            "ordinary_income_per_share": round(disq_ordinary_per_share, 2),
            "stcg_per_share": round(disq_stcg_per_share, 2),
            "ordinary_income_total": round(disq_ordinary_total),
            "stcg_total": round(disq_stcg_total),
            "estimated_federal_tax": round(tax_disq_ordinary + tax_disq_stcg),
        },
        "marginal_ordinary_rate_applied": marginal_ordinary,
        "ltcg_rate_applied": ltcg_rate,
        "tax_difference_qualifying_vs_disqualifying": round(
            (tax_q_ordinary + tax_q_ltcg) - (tax_disq_ordinary + tax_disq_stcg)
        ),
    }


def calc_qsbs_analysis(
    basis: float,
    fmv_now: float,
    months_held: int,
    salary_other: float,
    state: str = "CA",
) -> dict:
    """
    IRC §1202 QSBS analysis.
    Post-2010 stock: 100% federal exclusion on gain up to $10M or 10x basis.
    CA does NOT conform to §1202 — gains fully taxable at CA rates.

    Returns tax comparison: sell now (no exclusion) vs. wait for 60-month mark.
    """
    gain = fmv_now - basis
    potential_exclusion = min(gain, IRS_2026["qsbs_max_gain_per_issuer"])
    exclusion_pct = IRS_2026["qsbs_gain_exclusion_pct"]
    federally_excluded_gain = potential_exclusion * exclusion_pct
    taxable_gain_federal = max(0.0, gain - federally_excluded_gain)

    # Federal tax if sold NOW (no QSBS — less than 60 months)
    ltcg_result_now = calc_ltcg_tax(gain, salary_other, salary_other + gain)
    federal_tax_now = ltcg_result_now["total_ltcg_tax"]

    # Federal tax if sold AFTER 60 months (QSBS applies)
    ltcg_after = calc_ltcg_tax(taxable_gain_federal, salary_other, salary_other + taxable_gain_federal)
    federal_tax_qsbs = ltcg_after["total_ltcg_tax"]

    # California taxes the FULL gain regardless
    ca_result = calc_ca_tax(salary_other + gain)
    ca_result_base = calc_ca_tax(salary_other)
    ca_tax_on_gain = ca_result["total_ca_tax"] - ca_result_base["total_ca_tax"]

    federal_savings = federal_tax_now - federal_tax_qsbs
    months_to_wait = max(0, 60 - months_held)
    qualified = months_held >= 60

    return {
        "basis": round(basis),
        "fmv_now": round(fmv_now),
        "total_gain": round(gain),
        "months_held": months_held,
        "months_to_60_month_mark": months_to_wait,
        "qsbs_qualified": qualified,
        "exclusion_pct": f"{exclusion_pct*100:.0f}%",
        "federally_excluded_gain": round(federally_excluded_gain),
        "taxable_gain_federal_if_qsbs": round(taxable_gain_federal),
        "federal_tax_if_sold_now_no_qsbs": round(federal_tax_now),
        "federal_tax_if_sold_after_60mo": round(federal_tax_qsbs),
        "federal_tax_savings_from_waiting": round(federal_savings),
        "ca_tax_on_gain_regardless": round(ca_tax_on_gain),
        "note_ca": "California does not conform to §1202. CA will tax full gain regardless of holding period.",
    }


def calc_backdoor_roth(
    trad_ira_balance_at_year_end: float,
    nondeductible_contribution: float,
    conversion_amount: float,
    salary: float,
) -> dict:
    """
    Pro-rata rule calculation for backdoor Roth.

    Pro-rata rule: when converting, the taxable portion =
        (pre-tax IRA funds / total IRA funds) × conversion amount

    To avoid the trap: roll pre-tax IRA funds into employer 401(k) first.
    """
    total_ira = trad_ira_balance_at_year_end + nondeductible_contribution
    pretax_ira = trad_ira_balance_at_year_end  # assuming all existing is pre-tax
    aftertax_basis = nondeductible_contribution

    # Pro-rata fraction of after-tax dollars across all IRA assets
    if total_ira > 0:
        aftertax_pct = aftertax_basis / total_ira
        pretax_pct = pretax_ira / total_ira
    else:
        aftertax_pct = 1.0
        pretax_pct = 0.0

    # Taxable portion of conversion
    taxable_conversion = conversion_amount * pretax_pct
    nontaxable_conversion = conversion_amount * aftertax_pct

    # Tax owed on taxable conversion amount
    std_ded = IRS_2026["federal_std_ded_single"]
    base_taxable = max(0.0, salary - std_ded)
    base_tax = calc_federal_ordinary_tax(base_taxable)
    marginal = base_tax["marginal_rate"]
    tax_on_conversion = taxable_conversion * marginal

    # Clean scenario: pre-tax IRA balance = 0 (rolled to 401k)
    clean_taxable_conversion = 0.0
    clean_nontaxable = conversion_amount
    clean_tax = 0.0

    pro_rata_applies = pretax_ira > 0

    return {
        "trad_ira_pretax_balance": round(pretax_ira),
        "nondeductible_contribution": round(nondeductible_contribution),
        "total_ira_balance": round(total_ira),
        "conversion_amount": round(conversion_amount),
        "pro_rata_rule_applies": pro_rata_applies,
        "aftertax_percentage": round(aftertax_pct * 100, 1),
        "pretax_percentage": round(pretax_pct * 100, 1),
        "taxable_portion_of_conversion": round(taxable_conversion),
        "nontaxable_portion_of_conversion": round(nontaxable_conversion),
        "marginal_rate": marginal,
        "tax_owed_on_conversion_with_pro_rata": round(tax_on_conversion),
        "clean_backdoor_tax_owed": round(clean_tax),
        "extra_tax_due_to_pro_rata": round(tax_on_conversion - clean_tax),
        "recommendation": (
            "Roll pre-tax IRA balance into employer 401(k) before year-end to eliminate "
            "pro-rata exposure and execute a clean backdoor Roth conversion."
            if pro_rata_applies
            else "No pre-tax IRA balance. Backdoor Roth is clean — proceed with conversion."
        ),
    }


# ---------------------------------------------------------------------------
# Training pair dataclass (JSONL output format)
# ---------------------------------------------------------------------------


@dataclass
class TaxPreparationPair:
    pair_id: str
    system: str
    user: str
    assistant: str
    metadata: dict = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


# ---------------------------------------------------------------------------
# Synthesizer
# ---------------------------------------------------------------------------


class TaxPreparationSynthesizer:
    """
    Stream 7: CPA-grade tax preparation training data generator.

    Generates 60,000 training pairs across 8 tax topics. All math is computed
    deterministically in Python; the LLM writes the explanation wrapper only.

    Output: data/processed/tax_preparation_pairs.jsonl
    Format: JSONL with fields: pair_id, system, user, assistant, metadata
    """

    PAIR_TYPES = [
        "amt_analysis",
        "equity_comp",
        "roth_conversion",
        "schedule_d",
        "multi_state",
        "quarterly_tax",
        "backdoor_roth",
        "qsbs_planning",
    ]

    _CPA_SYSTEM = (
        "You are a licensed CPA and tax advisor with deep expertise in individual federal and state "
        "income tax planning. You provide precise, calculation-backed tax advice. Always show your "
        "work with specific dollar figures. Cite relevant IRC sections where applicable. Be direct "
        "and educational — clients trust you to be their expert, not to hedge every sentence."
    )

    def __init__(
        self,
        output_dir: str = "data/processed",
        backend: str = "vllm",
        vllm_urls: list[str] | None = None,
        max_workers: int = 8,
    ) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.backend = backend
        self.max_workers = max_workers
        self._vllm_urls = vllm_urls or [
            u.strip()
            for u in os.environ.get("VLLM_URLS", "http://localhost:8001").split(",")
        ]
        self._llm = None
        self._init_llm()

    def _init_llm(self) -> None:
        if self.backend == "vllm":
            try:
                import openai
                self._llm = openai.OpenAI(
                    base_url=f"{self._vllm_urls[0]}/v1",
                    api_key=os.environ.get("VLLM_API_KEY", "dummy"),
                )
                logger.info("TaxPreparationSynthesizer: vLLM client initialized")
            except ImportError:
                self.backend = "claude"
        if self.backend == "claude":
            try:
                import anthropic
                self._llm = anthropic.Anthropic(
                    api_key=os.environ.get("ANTHROPIC_API_KEY", "")
                )
                logger.info("TaxPreparationSynthesizer: Claude API client initialized")
            except ImportError:
                raise RuntimeError("Neither openai nor anthropic package available")

    def _call_llm(self, system: str, user: str, max_tokens: int = 1200) -> str | None:
        try:
            if self.backend == "vllm":
                import openai
                url = self._vllm_urls[0]
                client = openai.OpenAI(base_url=f"{url}/v1", api_key="dummy")
                resp = client.chat.completions.create(
                    model="Qwen/Qwen2.5-72B-Instruct",
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
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

    def run(self, n_pairs: int = 60_000) -> dict[str, int]:
        """
        Generate tax preparation training pairs.

        Returns:
            dict mapping pair_type → count of pairs generated for that type.
        """
        output_file = self.output_dir / "tax_preparation_pairs.jsonl"
        seen_file = self.output_dir / "tax_preparation_seen_ids.txt"

        seen_ids: set[str] = set()
        existing = 0
        if seen_file.exists():
            seen_ids = set(seen_file.read_text().splitlines())
            existing = len(seen_ids)

        remaining = n_pairs - existing
        if remaining <= 0:
            logger.info(f"Tax preparation stream already complete ({existing:,} pairs)")
            return {t: 0 for t in self.PAIR_TYPES}

        logger.info(f"Tax preparation stream: generating {remaining:,} pairs")

        pair_fns = [
            self._make_amt_analysis_pair,
            self._make_equity_comp_pair,
            self._make_roth_conversion_pair,
            self._make_schedule_d_pair,
            self._make_multi_state_pair,
            self._make_quarterly_tax_pair,
            self._make_backdoor_roth_pair,
            self._make_qsbs_planning_pair,
        ]
        type_counts: dict[str, int] = {t: 0 for t in self.PAIR_TYPES}
        saved = existing

        with open(output_file, "a") as out_f, open(seen_file, "a") as seen_f:
            while saved < n_pairs:
                make_fn = random.choice(pair_fns)
                try:
                    pair = make_fn()
                    if pair is None or pair.pair_id in seen_ids:
                        continue
                    if not self._quality_check(pair):
                        continue
                    out_f.write(json.dumps(asdict(pair)) + "\n")
                    seen_f.write(pair.pair_id + "\n")
                    seen_ids.add(pair.pair_id)
                    saved += 1
                    pair_type = pair.metadata.get("type", "unknown")
                    if pair_type in type_counts:
                        type_counts[pair_type] += 1
                    if saved % 1000 == 0:
                        logger.info(f"  tax_preparation: {saved:,}/{n_pairs:,}")
                except Exception as e:
                    logger.debug(f"Tax preparation pair failed: {e}")

        logger.info(f"Tax preparation stream complete: {saved:,} pairs")
        logger.info(f"  Breakdown: {type_counts}")
        return type_counts

    def _quality_check(self, pair: TaxPreparationPair) -> bool:
        """Reject pairs with thin LLM explanations or missing financial content."""
        if not pair.assistant or len(pair.assistant) < 250:
            return False
        tax_terms = [
            "tax", "income", "deduction", "bracket", "capital", "AMT",
            "conversion", "basis", "ordinary", "gain", "federal",
        ]
        return any(t.lower() in pair.assistant.lower() for t in tax_terms)

    # -----------------------------------------------------------------------
    # Pair maker: AMT Analysis (ISO exercise timing)
    # -----------------------------------------------------------------------

    def _make_amt_analysis_pair(self) -> TaxPreparationPair | None:
        archetype = next(a for a in CLIENT_ARCHETYPES if a["id"] == "startup_iso")
        # Randomize the numbers modestly so pairs vary
        salary = int(archetype["salary"] * random.uniform(0.80, 1.25))
        iso_shares = random.choice([10_000, 25_000, 50_000, 75_000, 100_000])
        strike = round(random.uniform(0.50, 5.00), 2)
        fmv = round(strike * random.uniform(8, 60), 2)
        k401 = IRS_2026["employee_401k_limit"]

        result = calc_amt_iso_analysis(salary, iso_shares, strike, fmv, k401)

        # Partial exercise scenario: what if only exercising N shares to stay under AMT?
        # Find share count that keeps AMT below regular tax
        partial_max_shares = iso_shares
        for trial_shares in range(1_000, iso_shares, 1_000):
            trial = calc_amt_iso_analysis(salary, trial_shares, strike, fmv, k401)
            if not trial["amt_applies"]:
                partial_max_shares = trial_shares

        user_prompt = (
            f"I have {iso_shares:,} ISO options at a strike of ${strike:.2f}. Current FMV is ${fmv:.2f}/share. "
            f"My salary is ${salary:,}/year and I'm maxing my 401(k) at ${k401:,}. "
            f"I'm considering exercising all options this year. What's my AMT exposure and should I "
            f"exercise all shares now, wait until after IPO, or exercise partially?"
        )

        context = (
            f"Client ISO Exercise — AMT Analysis\n\n"
            f"Computed ground-truth results:\n{json.dumps(result, indent=2)}\n\n"
            f"Partial exercise note: Client can exercise up to ~{partial_max_shares:,} shares "
            f"before triggering incremental AMT (based on current-year income).\n\n"
            f"Write a detailed CPA-quality answer showing:\n"
            f"1. The AMT bargain element calculation\n"
            f"2. Exact AMT liability if all shares exercised vs. partial exercise\n"
            f"3. Whether AMT applies and by how much\n"
            f"4. The AMT credit carryforward mechanism\n"
            f"5. A recommendation: exercise now, partially, or wait\n"
            f"Use the exact dollar figures above. Show your work."
        )
        explanation = self._call_llm(self._CPA_SYSTEM, context, max_tokens=1100)
        if not explanation or len(explanation) < 250:
            return None

        pair_id = f"tax_amt_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return TaxPreparationPair(
            pair_id=pair_id,
            system=self._CPA_SYSTEM,
            user=user_prompt,
            assistant=explanation,
            metadata={
                "type": "amt_analysis",
                "archetype": "startup_iso",
                "result": result,
                "partial_max_shares": partial_max_shares,
            },
        )

    # -----------------------------------------------------------------------
    # Pair maker: Equity Comp — RSU vesting tax strategy
    # -----------------------------------------------------------------------

    def _make_equity_comp_pair(self) -> TaxPreparationPair | None:
        archetype = next(a for a in CLIENT_ARCHETYPES if a["id"] == "tech_rsu")
        salary = int(archetype["salary"] * random.uniform(0.85, 1.20))
        rsu_vest = int(archetype["rsu_annual"] * random.uniform(0.70, 1.50))
        state = random.choice(["CA", "TX", "NY"])

        # Tax on RSU vest (ordinary income at vesting)
        gross = salary + rsu_vest
        k401 = IRS_2026["employee_401k_limit"]
        std_ded = IRS_2026["federal_std_ded_single"]
        taxable = max(0.0, gross - k401 - std_ded)
        fed_result = calc_federal_ordinary_tax(taxable)

        # Scenario: sell immediately vs. hold 1 year
        # If held 1 year: RSU basis = FMV at vest; appreciation taxed at LTCG rates
        assumed_growth_pct = random.uniform(0.05, 0.25)
        fmv_at_vest = rsu_vest  # basis = income already recognized
        fmv_after_1yr = fmv_at_vest * (1 + assumed_growth_pct)
        appreciation = fmv_after_1yr - fmv_at_vest

        ltcg_result = calc_ltcg_tax(appreciation, taxable, gross + appreciation)

        # Sell immediately: no additional tax on RSU value (already ordinary income)
        # but also no additional gain/loss (basis = FMV at vest)
        sell_immediately_total_tax = fed_result["tax"]
        hold_1yr_additional_tax = ltcg_result["total_ltcg_tax"]
        hold_1yr_additional_gain = round(appreciation)

        # State tax on RSU ordinary income
        if state == "CA":
            state_result = calc_ca_tax(taxable)
            state_tax_on_rsu = state_result["total_ca_tax"]
            state_label = "California"
        elif state == "NY":
            ny_result = calc_ny_tax(taxable)
            state_tax_on_rsu = ny_result["ny_state_tax"]
            state_label = "New York"
        else:
            state_tax_on_rsu = 0
            state_label = "Texas (no state income tax)"

        user_prompt = (
            f"I have ${rsu_vest:,} in RSUs vesting this year on top of my ${salary:,} salary. "
            f"I live in {state_label}. Should I sell RSUs immediately when they vest, "
            f"or hold them for long-term capital gains treatment? What's the actual tax difference?"
        )

        context = (
            f"RSU Vesting Tax Strategy Analysis\n\n"
            f"Salary: ${salary:,} | RSU vest: ${rsu_vest:,} | State: {state_label}\n"
            f"Federal taxable income: ${taxable:,}\n"
            f"Federal tax on combined income: ${fed_result['tax']:,} "
            f"(marginal: {fed_result['marginal_rate']*100:.0f}%, "
            f"effective: {fed_result['effective_rate']*100:.1f}%)\n"
            f"State tax on vesting income ({state}): ${state_tax_on_rsu:,}\n\n"
            f"Hold 1-year scenario (assumed {assumed_growth_pct*100:.0f}% appreciation):\n"
            f"  Additional gain after 1 year: ${hold_1yr_additional_gain:,}\n"
            f"  LTCG + NIIT on that gain: ${hold_1yr_additional_tax:,}\n"
            f"  LTCG detail: {json.dumps(ltcg_result, indent=2)}\n\n"
            f"Write a CPA-quality answer explaining:\n"
            f"1. Why RSU vesting is ordinary income regardless of when you sell\n"
            f"2. The tax math for sell-immediately vs. hold for LTCG\n"
            f"3. The concentration risk argument for diversifying immediately\n"
            f"4. State-specific considerations ({state})\n"
            f"5. Your recommendation given these specific numbers"
        )
        explanation = self._call_llm(self._CPA_SYSTEM, context, max_tokens=1100)
        if not explanation or len(explanation) < 250:
            return None

        pair_id = f"tax_rsu_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return TaxPreparationPair(
            pair_id=pair_id,
            system=self._CPA_SYSTEM,
            user=user_prompt,
            assistant=explanation,
            metadata={
                "type": "equity_comp",
                "archetype": "tech_rsu",
                "salary": salary,
                "rsu_vest": rsu_vest,
                "state": state,
                "fed_marginal_rate": fed_result["marginal_rate"],
                "hold_additional_ltcg_tax": hold_1yr_additional_tax,
            },
        )

    # -----------------------------------------------------------------------
    # Pair maker: Roth Conversion — bracket-filling optimization
    # -----------------------------------------------------------------------

    def _make_roth_conversion_pair(self) -> TaxPreparationPair | None:
        archetype = next(a for a in CLIENT_ARCHETYPES if a["id"] == "early_retiree_roth_ladder")
        trad_balance = int(archetype["trad_ira_balance"] * random.uniform(0.70, 1.40))
        other_income = int(archetype["other_income"] * random.uniform(0.70, 1.50))
        age = random.randint(55, 63)

        # Offer two strategies: fill to top of 22% bracket vs. 24% bracket
        bracket_22_top = 103_350
        bracket_24_top = 197_300

        result_22 = calc_roth_conversion_optimal(
            trad_balance, other_income, bracket_22_top, "22%"
        )
        result_24 = calc_roth_conversion_optimal(
            trad_balance, other_income, bracket_24_top, "24%"
        )

        # RMD analysis: at 73, RMDs kick in. Estimate RMD at 73 given current balance.
        years_to_73 = max(0, 73 - age)
        # Assume 7% growth
        projected_balance_at_73 = trad_balance * (1.07 ** years_to_73)
        # Uniform lifetime table divisor at 73 ≈ 26.5
        rmd_at_73 = projected_balance_at_73 / 26.5

        user_prompt = (
            f"I'm {age} years old with ${trad_balance:,} in my traditional IRA. "
            f"I'm retired with ${other_income:,} in other income (part-time work/dividends). "
            f"No employer withholding. How much should I convert to Roth this year to "
            f"minimize lifetime taxes? Should I fill to the top of the 22% or 24% bracket?"
        )

        context = (
            f"Roth Conversion Ladder Optimization\n\n"
            f"Client: age {age}, trad IRA ${trad_balance:,}, other income ${other_income:,}/yr\n\n"
            f"Strategy A — Fill to top of 22% bracket:\n{json.dumps(result_22, indent=2)}\n\n"
            f"Strategy B — Fill to top of 24% bracket:\n{json.dumps(result_24, indent=2)}\n\n"
            f"RMD pressure analysis:\n"
            f"  Years until RMDs (age 73): {years_to_73}\n"
            f"  Projected IRA balance at 73 (7% growth): ${projected_balance_at_73:,.0f}\n"
            f"  Estimated first RMD at 73: ${rmd_at_73:,.0f}/year\n\n"
            f"Write a CPA-quality answer covering:\n"
            f"1. The bracket-filling math for both strategies (use exact dollar amounts above)\n"
            f"2. The RMD time bomb argument — why converting now prevents higher forced income later\n"
            f"3. State tax considerations (TX: no income tax on conversion)\n"
            f"4. Medicare IRMAA surcharge thresholds to avoid (IRMAA cliff at $106,000 for singles in 2026)\n"
            f"5. Specific recommendation with conversion amount"
        )
        explanation = self._call_llm(self._CPA_SYSTEM, context, max_tokens=1200)
        if not explanation or len(explanation) < 250:
            return None

        pair_id = f"tax_roth_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return TaxPreparationPair(
            pair_id=pair_id,
            system=self._CPA_SYSTEM,
            user=user_prompt,
            assistant=explanation,
            metadata={
                "type": "roth_conversion",
                "archetype": "early_retiree_roth_ladder",
                "trad_balance": trad_balance,
                "other_income": other_income,
                "age": age,
                "result_22_bracket": result_22,
                "result_24_bracket": result_24,
                "projected_rmd_at_73": round(rmd_at_73),
            },
        )

    # -----------------------------------------------------------------------
    # Pair maker: Schedule D — capital gains/loss harvesting
    # -----------------------------------------------------------------------

    def _make_schedule_d_pair(self) -> TaxPreparationPair | None:
        archetype = random.choice(CLIENT_ARCHETYPES)
        salary = archetype.get("salary", 150_000)
        if salary == 0:
            salary = archetype.get("other_ordinary_income", 80_000)

        # Generate a realistic portfolio with gains and losses
        tickers = ["VTI", "VXUS", "QQQ", "AAPL", "MSFT", "NVDA", "BND", "AMZN", "TSLA", "META"]
        n_positions = random.randint(5, 9)
        selected = random.sample(tickers, n_positions)

        positions = []
        for ticker in selected:
            shares = random.randint(20, 300)
            cost_basis = random.uniform(40, 500)
            # Mix of gains and losses
            if random.random() < 0.45:
                # Loss position
                current_price = cost_basis * random.uniform(0.55, 0.90)
            else:
                # Gain position
                current_price = cost_basis * random.uniform(1.10, 2.50)
            holding_days = random.choice([180, 240, 370, 400, 500, 730])
            pnl = (current_price - cost_basis) * shares
            positions.append({
                "ticker": ticker,
                "shares": shares,
                "cost_basis_per_share": round(cost_basis, 2),
                "current_price": round(current_price, 2),
                "holding_days": holding_days,
                "unrealized_pnl": round(pnl),
            })

        result = calc_schedule_d(positions)
        prior_carryforward = random.choice([0, 5_000, 12_000, 25_000])

        user_prompt = (
            f"It's November and I want to do tax-loss harvesting before year-end. "
            f"My salary is ${salary:,} and I have a portfolio with both gains and losses. "
            f"I also have ${prior_carryforward:,} in capital loss carryforwards from prior years. "
            f"Here are my positions:\n"
            + "\n".join(
                f"  {p['ticker']}: {p['shares']} shares, basis ${p['cost_basis_per_share']:.2f}, "
                f"current ${p['current_price']:.2f}, held {p['holding_days']} days "
                f"(P&L: ${p['unrealized_pnl']:,})"
                for p in positions
            )
            + f"\n\nWhich positions should I harvest and what's the tax impact?"
        )

        context = (
            f"Schedule D Tax-Loss Harvesting Analysis\n\n"
            f"Salary: ${salary:,} | Prior carryforward: ${prior_carryforward:,}\n\n"
            f"Schedule D computation:\n{json.dumps(result, indent=2)}\n\n"
            f"After applying ${prior_carryforward:,} prior carryforward:\n"
            f"  Adjusted net LT gain: ${max(0, result['taxable_lt_gain'] - prior_carryforward):,}\n"
            f"  Additional carryforward: ${max(0, prior_carryforward - result['taxable_lt_gain']):,}\n\n"
            f"Write a CPA-quality harvest plan covering:\n"
            f"1. Which specific positions to harvest and in what order (by tax savings)\n"
            f"2. The netting rules: ST losses offset ST gains first, then LT gains\n"
            f"3. The $3,000 ordinary income offset limit\n"
            f"4. Wash-sale rule warning (30-day window on re-purchases)\n"
            f"5. Exact tax savings in dollars from the recommended harvests\n"
            f"Use the exact figures from the computation above."
        )
        explanation = self._call_llm(self._CPA_SYSTEM, context, max_tokens=1200)
        if not explanation or len(explanation) < 250:
            return None

        pair_id = f"tax_sched_d_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return TaxPreparationPair(
            pair_id=pair_id,
            system=self._CPA_SYSTEM,
            user=user_prompt,
            assistant=explanation,
            metadata={
                "type": "schedule_d",
                "salary": salary,
                "positions": positions,
                "result": result,
                "prior_carryforward": prior_carryforward,
            },
        )

    # -----------------------------------------------------------------------
    # Pair maker: Multi-state nexus allocation
    # -----------------------------------------------------------------------

    def _make_multi_state_pair(self) -> TaxPreparationPair | None:
        archetype = next(a for a in CLIENT_ARCHETYPES if a["id"] == "remote_multistate")
        salary = int(archetype["salary"] * random.uniform(0.80, 1.30))
        days_ny = random.randint(80, 160)
        days_ca = random.randint(50, 120)
        days_wa = random.randint(40, 100)
        days_other = 365 - days_ny - days_ca - days_wa
        if days_other < 0:
            # Trim to fit 365
            days_ca = max(20, days_ca + days_other)
            days_other = 365 - days_ny - days_ca - days_wa
        if days_other < 0:
            days_wa = max(10, days_wa + days_other)
            days_other = 365 - days_ny - days_ca - days_wa

        result = calc_multi_state_allocation(salary, days_ny, days_ca, days_wa, days_other)

        user_prompt = (
            f"I work remotely for a NY-based company on a ${salary:,} salary. "
            f"This year I worked {days_ny} days in New York, {days_ca} days in California visiting "
            f"family/working from a co-working space, and {days_wa} days in Washington state. "
            f"I'm domiciled in New York. How many state returns do I file and what do I owe each state?"
        )

        context = (
            f"Multi-State Income Allocation — Remote Worker\n\n"
            f"Salary: ${salary:,} | Domicile: NY\n"
            f"Working day breakdown:\n"
            f"  NY: {days_ny} days | CA: {days_ca} days | WA: {days_wa} days | Other: {days_other} days\n"
            f"  Total: {days_ny + days_ca + days_wa + days_other} days\n\n"
            f"Allocation computation:\n{json.dumps(result, indent=2)}\n\n"
            f"Write a CPA-quality answer explaining:\n"
            f"1. Which states require returns and why (nexus rules, domicile vs. statutory residency)\n"
            f"2. The income allocation calculation for each state (exact dollar amounts above)\n"
            f"3. The NY resident credit for taxes paid to CA — how it prevents double taxation\n"
            f"4. Why Washington requires no state return (no income tax)\n"
            f"5. Important caveat about CA's aggressive sourcing rules for CA-employer relationships\n"
            f"6. Practical tip: how to document work location for audit support"
        )
        explanation = self._call_llm(self._CPA_SYSTEM, context, max_tokens=1100)
        if not explanation or len(explanation) < 250:
            return None

        pair_id = f"tax_multistate_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return TaxPreparationPair(
            pair_id=pair_id,
            system=self._CPA_SYSTEM,
            user=user_prompt,
            assistant=explanation,
            metadata={
                "type": "multi_state",
                "archetype": "remote_multistate",
                "salary": salary,
                "days_ny": days_ny,
                "days_ca": days_ca,
                "days_wa": days_wa,
                "result": result,
            },
        )

    # -----------------------------------------------------------------------
    # Pair maker: Quarterly estimated tax payments
    # -----------------------------------------------------------------------

    def _make_quarterly_tax_pair(self) -> TaxPreparationPair | None:
        archetype = random.choice([
            a for a in CLIENT_ARCHETYPES
            if a["id"] in ("tech_rsu", "consultant_state_change", "physician_scorp")
        ])

        salary = archetype.get("salary", 0) or archetype.get("w2_salary", 0)
        scorp_dist = archetype.get("scorp_distribution", 0)
        rsu_vest = archetype.get("rsu_annual", 0)

        # Vary the scenario
        salary = int(salary * random.uniform(0.85, 1.20))
        rsu_vest = int(rsu_vest * random.uniform(0.70, 1.40)) if rsu_vest else 0
        scorp_dist = int(scorp_dist * random.uniform(0.80, 1.20)) if scorp_dist else 0

        current_year_income = salary + rsu_vest + scorp_dist
        # W-2 withholding covers salary; RSU/S-corp distributions have little to no withholding
        withholding = int(salary * random.uniform(0.22, 0.30))

        prior_year_agi = int(current_year_income * random.uniform(0.75, 1.10))
        prior_year_tax = int(calc_federal_ordinary_tax(
            max(0, prior_year_agi - IRS_2026["federal_std_ded_single"])
        )["tax"])

        result = calc_estimated_payments(
            prior_year_tax,
            current_year_income,
            withholding,
            prior_year_agi,
        )

        user_prompt = (
            f"My income this year includes ${salary:,} W-2 salary"
            + (f", ${rsu_vest:,} in RSU vesting" if rsu_vest else "")
            + (f", and ${scorp_dist:,} in S-corp distributions" if scorp_dist else "")
            + f". My employer withholds ${withholding:,} in federal taxes from my paycheck. "
            f"Last year my AGI was ${prior_year_agi:,} and I paid ${prior_year_tax:,} in federal tax. "
            f"Do I need to make estimated tax payments this year, and if so how much per quarter?"
        )

        context = (
            f"Quarterly Estimated Tax — Safe Harbor Analysis\n\n"
            f"Current year income: ${current_year_income:,} | W-2 withholding: ${withholding:,}\n"
            f"Prior year AGI: ${prior_year_agi:,} | Prior year tax: ${prior_year_tax:,}\n\n"
            f"Computation:\n{json.dumps(result, indent=2)}\n\n"
            f"Write a CPA-quality answer covering:\n"
            f"1. Both safe harbor methods and which one applies here\n"
            f"2. The exact quarterly payment amount and due dates\n"
            f"3. Why S-corp distributions and RSU vesting usually have zero withholding\n"
            f"4. The underpayment penalty calculation if estimated payments are skipped (IRC §6654)\n"
            f"5. Tip: can also increase W-2 withholding to cover shortfall instead of quarterly payments\n"
            f"Show all dollar amounts from the computation."
        )
        explanation = self._call_llm(self._CPA_SYSTEM, context, max_tokens=1100)
        if not explanation or len(explanation) < 250:
            return None

        pair_id = f"tax_qrtly_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return TaxPreparationPair(
            pair_id=pair_id,
            system=self._CPA_SYSTEM,
            user=user_prompt,
            assistant=explanation,
            metadata={
                "type": "quarterly_tax",
                "current_year_income": current_year_income,
                "withholding": withholding,
                "result": result,
            },
        )

    # -----------------------------------------------------------------------
    # Pair maker: Backdoor Roth — pro-rata rule trap
    # -----------------------------------------------------------------------

    def _make_backdoor_roth_pair(self) -> TaxPreparationPair | None:
        archetype = next(a for a in CLIENT_ARCHETYPES if a["id"] == "physician_scorp")
        salary = int((archetype["w2_salary"] + archetype["scorp_distribution"]) * random.uniform(0.85, 1.15))

        # Two scenarios: with pre-tax IRA balance (trap) and without (clean)
        has_existing_trad_ira = random.random() < 0.60
        existing_trad_balance = (
            random.randint(30_000, 250_000) if has_existing_trad_ira else 0
        )
        contribution = IRS_2026["ira_limit"]  # $7,000

        result = calc_backdoor_roth(
            trad_ira_balance_at_year_end=existing_trad_balance,
            nondeductible_contribution=contribution,
            conversion_amount=contribution,
            salary=salary,
        )

        # Clean scenario comparison
        clean_result = calc_backdoor_roth(
            trad_ira_balance_at_year_end=0,
            nondeductible_contribution=contribution,
            conversion_amount=contribution,
            salary=salary,
        )

        user_prompt = (
            f"I earn ${salary:,}/year and I'm above the Roth IRA income limit. "
            f"I want to do a backdoor Roth contribution for 2026 (${contribution:,})."
            + (
                f" I currently have ${existing_trad_balance:,} sitting in a traditional IRA "
                f"from an old job rollover. Is the backdoor Roth still a good idea, "
                f"and what's the pro-rata rule trap?"
                if has_existing_trad_ira
                else " I have no existing traditional IRA balance. Walk me through the backdoor Roth steps."
            )
        )

        context = (
            f"Backdoor Roth — Pro-Rata Rule Analysis\n\n"
            f"Salary: ${salary:,} | Contribution: ${contribution:,}\n"
            f"Existing trad IRA balance: ${existing_trad_balance:,}\n\n"
            f"With existing IRA (pro-rata applies):\n{json.dumps(result, indent=2)}\n\n"
            f"Clean scenario (no existing IRA):\n{json.dumps(clean_result, indent=2)}\n\n"
            f"Write a CPA-quality answer covering:\n"
            f"1. The exact pro-rata calculation using the numbers above (Form 8606)\n"
            f"2. What Form 8606 is and why it's critical to file every year\n"
            f"3. The solution: rolling pre-tax IRA into employer 401(k) or solo 401(k) before Dec 31\n"
            f"4. Step-by-step backdoor Roth instructions (contribute nondeductible → wait → convert)\n"
            f"5. California warning: CA taxes the conversion if there's any pre-tax component\n"
            f"Use the exact dollar figures from the computation above."
        )
        explanation = self._call_llm(self._CPA_SYSTEM, context, max_tokens=1200)
        if not explanation or len(explanation) < 250:
            return None

        pair_id = f"tax_bdr_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return TaxPreparationPair(
            pair_id=pair_id,
            system=self._CPA_SYSTEM,
            user=user_prompt,
            assistant=explanation,
            metadata={
                "type": "backdoor_roth",
                "archetype": "physician_scorp",
                "salary": salary,
                "existing_trad_ira": existing_trad_balance,
                "pro_rata_applies": result["pro_rata_rule_applies"],
                "result": result,
            },
        )

    # -----------------------------------------------------------------------
    # Pair maker: QSBS Planning — IRC §1202
    # -----------------------------------------------------------------------

    def _make_qsbs_planning_pair(self) -> TaxPreparationPair | None:
        archetype = next(a for a in CLIENT_ARCHETYPES if a["id"] == "qsbs_holder")

        # Randomize the scenario
        basis = int(archetype["qsbs_basis"] * random.uniform(0.40, 2.50))
        gain_multiple = random.uniform(5, 25)
        fmv_now = int(basis * gain_multiple)
        gain = fmv_now - basis
        months_held = random.randint(42, 72)   # some before, some after 60-month mark
        other_income = int(archetype["other_ordinary_income"] * random.uniform(0.70, 1.50))

        result = calc_qsbs_analysis(basis, fmv_now, months_held, other_income)

        qualified = months_held >= 60
        scenario_label = (
            f"already qualified ({months_held} months held)"
            if qualified
            else f"NOT yet qualified — {60 - months_held} months remaining"
        )

        user_prompt = (
            f"I invested ${basis:,} in a qualifying C-corp startup (Section 1202 stock) "
            f"and it's now worth ${fmv_now:,}. I've held it {months_held} months. "
            f"I live in California and have ${other_income:,} in other income. "
            f"I'm thinking about selling — what are my tax consequences? "
            f"Should I wait for the 5-year mark?"
        )

        context = (
            f"IRC §1202 QSBS Analysis\n\n"
            f"Basis: ${basis:,} | FMV: ${fmv_now:,} | Total gain: ${gain:,}\n"
            f"Months held: {months_held} ({scenario_label})\n"
            f"Other income: ${other_income:,} | State: CA\n\n"
            f"Computation:\n{json.dumps(result, indent=2)}\n\n"
            f"Write a CPA-quality answer covering:\n"
            f"1. IRC §1202 qualification requirements (C-corp, original issuance, active business, <$50M assets at issuance)\n"
            f"2. The 100% federal exclusion mechanics and the $10M / 10× basis cap\n"
            f"3. Exact federal tax if sold now vs. after 60 months (use numbers above)\n"
            f"4. California's non-conformity: FULL CA tax on the gain regardless ({result['ca_tax_on_gain_regardless']:,} estimated)\n"
            f"5. If NOT yet qualified: the exact number of months to wait and what it saves federally\n"
            f"6. Alternative: §1045 rollover if selling before 60 months (reinvest in another QSBS within 60 days)\n"
            f"7. Recommendation: sell now or wait?\n"
            f"Use exact dollar amounts from the computation."
        )
        explanation = self._call_llm(self._CPA_SYSTEM, context, max_tokens=1200)
        if not explanation or len(explanation) < 250:
            return None

        pair_id = f"tax_qsbs_{int(hashlib.md5(user_prompt.encode(), usedforsecurity=False).hexdigest(), 16) % 10**10:010d}"
        return TaxPreparationPair(
            pair_id=pair_id,
            system=self._CPA_SYSTEM,
            user=user_prompt,
            assistant=explanation,
            metadata={
                "type": "qsbs_planning",
                "archetype": "qsbs_holder",
                "basis": basis,
                "fmv": fmv_now,
                "gain": gain,
                "months_held": months_held,
                "qsbs_qualified": qualified,
                "result": result,
            },
        )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="FiduciaryOS Stream 7: Tax preparation synthesis")
    parser.add_argument("--backend", choices=["vllm", "claude"], default="vllm")
    parser.add_argument("--output-dir", default="data/processed")
    parser.add_argument("--n-pairs", type=int, default=60_000)
    parser.add_argument("--max-workers", type=int, default=8)
    parser.add_argument(
        "--vllm-urls",
        default="http://localhost:8001,http://localhost:8002",
    )
    args = parser.parse_args()

    vllm_urls = (
        [u.strip() for u in args.vllm_urls.split(",")]
        if args.backend == "vllm"
        else None
    )
    synthesizer = TaxPreparationSynthesizer(
        output_dir=args.output_dir,
        backend=args.backend,
        vllm_urls=vllm_urls,
        max_workers=args.max_workers,
    )
    stats = synthesizer.run(n_pairs=args.n_pairs)
    total = sum(stats.values())
    print(f"Stream 7 complete: {total:,} pairs")
    for pair_type, count in stats.items():
        print(f"  {pair_type}: {count:,}")
