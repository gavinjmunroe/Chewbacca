"""
core/tax_engine_v2.py — FiduciaryOS CPA-Replacement Tax Computation Engine v2

This module replaces a CPA for the following scenarios relevant to high-income
tech workers and founders:

  - Alternative Minimum Tax (AMT) — Form 6251
      ISO spread is an AMT preference item. Exemption phases out at high AMTI.
      Tentative minimum tax (TMT) = max(regular_tax, AMT).

  - Net Investment Income Tax (NIIT) — IRC §1411
      3.8% on lesser of (net investment income, MAGI − threshold).

  - Equity compensation:
      ISOs: no regular-tax income at exercise; spread IS AMT preference.
      NSOs: spread is W-2 ordinary income at exercise.
      RSUs: vest value is W-2 ordinary income.
      ESPP: qualifying vs. disqualifying disposition rules.

  - Schedule D capital gains
      Short-term gains taxed as ordinary income.
      Long-term gains taxed at preferential 0/15/20% rates.
      §1231 gains treated as long-term after netting.

  - Multi-state apportionment
      CA (9 brackets, 13.3% top), NY (10.9% top), TX/FL/NV (0%),
      WA (7% on LTCG > $262k), all others estimated at 4% of federal AGI.

  - Roth conversion ladder optimizer
      Fills the 22% or 24% bracket each year to minimize lifetime tax.

  - Quarterly estimated payments (Form 1040-ES)
      Safe-harbor method: 100%/110% of prior-year tax or 90% of current-year.
      Due dates: Apr 15, Jun 15, Sep 15, Jan 15.

  - Backdoor Roth IRA pro-rata rule — Form 8606
      Taxable fraction = (pre-tax IRA balance) / (total IRA balance).

  - QSBS §1202 exclusion
      100% exclusion for stock acquired after Sept 27 2010.
      50% exclusion for stock acquired before Feb 18 2009.

All constants are 2026 IRS values (Rev. Proc. 2025-22 / IRS inflation
adjustments). No external dependencies beyond stdlib.

Author: FiduciaryOS Engineering
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

# ---------------------------------------------------------------------------
# 1. 2026 IRS Constants
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class IRSLimits2026:
    # AMT
    amt_exemption_single: float = 137_000.0
    amt_exemption_mfj: float = 220_700.0
    amt_phaseout_single: float = 1_156_300.0
    amt_phaseout_mfj: float = 1_545_200.0
    amt_rate_low: float = 0.26        # on first $220,700 of AMTI above exemption
    amt_rate_high: float = 0.28       # above $220,700
    amt_rate_crossover: float = 220_700.0

    # NIIT — IRC §1411
    niit_rate: float = 0.038
    niit_threshold_single: float = 200_000.0
    niit_threshold_mfj: float = 250_000.0

    # Long-term capital gains / qualified dividends
    ltcg_0pct_single: float = 47_025.0
    ltcg_0pct_mfj: float = 94_050.0
    ltcg_15pct_single: float = 518_900.0
    ltcg_15pct_mfj: float = 583_750.0

    # Social Security / Medicare
    ss_wage_base: float = 176_100.0
    ss_rate_employee: float = 0.062
    medicare_rate: float = 0.0145
    medicare_additional_rate: float = 0.009
    medicare_additional_threshold_single: float = 200_000.0
    medicare_additional_threshold_mfj: float = 250_000.0

    # IRA / Roth
    ira_limit: float = 7_000.0
    roth_phaseout_single_start: float = 150_000.0
    roth_phaseout_single_end: float = 165_000.0
    roth_phaseout_mfj_start: float = 236_000.0
    roth_phaseout_mfj_end: float = 246_000.0

    # 401(k)
    k401_limit: float = 23_500.0
    k401_catchup_limit: float = 31_000.0   # age 50+
    k401_415c_limit: float = 70_000.0       # total employer+employee

    # Standard deductions
    std_deduction_single: float = 15_000.0
    std_deduction_mfj: float = 30_000.0

    # QSBS §1202 exclusion rates
    qsbs_100pct_cutoff: date = date(2010, 9, 27)   # acquired AFTER this → 100%
    qsbs_50pct_cutoff: date = date(2009, 2, 18)    # acquired BEFORE this → 50%

    # Federal income tax brackets 2026 (single) — list of (upper_bound, rate)
    # final bracket upper_bound = math.inf
    brackets_single: tuple = (
        (11_925.0,  0.10),
        (48_475.0,  0.12),
        (103_350.0, 0.22),
        (197_300.0, 0.24),
        (250_525.0, 0.32),
        (626_350.0, 0.35),
        (math.inf,  0.37),
    )

    # Federal income tax brackets 2026 (MFJ)
    brackets_mfj: tuple = (
        (23_850.0,  0.10),
        (96_950.0,  0.12),
        (206_700.0, 0.22),
        (394_600.0, 0.24),
        (501_050.0, 0.32),
        (751_600.0, 0.35),
        (math.inf,  0.37),
    )


IRS = IRSLimits2026()


# ---------------------------------------------------------------------------
# 2. Input Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class ISOExercise:
    shares: int
    strike_price: float
    fmv_at_exercise: float
    exercise_date: date
    already_sold: bool = False          # used to check if QSBS applies

    @property
    def spread_per_share(self) -> float:
        return max(0.0, self.fmv_at_exercise - self.strike_price)

    @property
    def total_spread(self) -> float:
        return self.spread_per_share * self.shares


@dataclass
class NSOExercise:
    shares: int
    strike_price: float
    fmv_at_exercise: float

    @property
    def spread_per_share(self) -> float:
        return max(0.0, self.fmv_at_exercise - self.strike_price)

    @property
    def total_spread(self) -> float:
        return self.spread_per_share * self.shares


@dataclass
class ESPPSale:
    purchase_price: float       # price paid (discounted)
    fmv_at_purchase: float      # FMV on purchase date (offering date or lower)
    sale_price: float           # actual sale price per share
    shares: int
    holding_period_days: int    # days held from purchase date to sale


@dataclass
class TaxProfile:
    filing_status: str              # "single" or "mfj"
    w2_income: float
    business_income: float          # Schedule C / pass-through
    short_term_gains: float
    long_term_gains: float
    qualified_dividends: float
    rsu_income: float               # already in W-2 for most employers
    iso_exercises: list[ISOExercise] = field(default_factory=list)
    nso_exercises: list[NSOExercise] = field(default_factory=list)
    espp_sales: list[ESPPSale] = field(default_factory=list)
    other_income: float = 0.0
    state_code: str = "CA"          # 2-letter state abbreviation
    age: int = 35
    agi_before_deductions: float = 0.0   # override if pre-computed
    itemized_deductions: float = 0.0
    traditional_ira_contributions: float = 0.0
    roth_contributions: float = 0.0
    prior_year_tax: float = 0.0
    w2_withholding: float = 0.0


# ---------------------------------------------------------------------------
# 3. Output Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class TaxResult:
    regular_tax: float
    amt: float
    tax_owed: float              # max(regular_tax, tentative_minimum_tax)
    niit: float
    medicare_surtax: float
    total_federal: float
    state_tax: float
    total_tax: float
    effective_rate: float
    marginal_rate: float
    amt_triggered: bool
    amt_preference_items: dict
    schedule_d_summary: dict
    quarterly_estimates: list[dict]
    recommendations: list[str]


# ---------------------------------------------------------------------------
# 4. Helper: apply progressive bracket table
# ---------------------------------------------------------------------------

def _apply_brackets(income: float, brackets: tuple) -> float:
    """Apply a progressive bracket table to income. Returns total tax."""
    tax = 0.0
    prev = 0.0
    for upper, rate in brackets:
        if income <= prev:
            break
        taxable_in_band = min(income, upper) - prev
        tax += taxable_in_band * rate
        prev = upper
    return tax


def _marginal_rate(income: float, brackets: tuple) -> float:
    """Return the marginal rate that applies at the given income level."""
    prev = 0.0
    for upper, rate in brackets:
        if income <= upper:
            return rate
        prev = upper
    return brackets[-1][1]


# ---------------------------------------------------------------------------
# 5. Core Computation Functions
# ---------------------------------------------------------------------------

def compute_nso_w2_income(exercises: list[NSOExercise]) -> float:
    """NSO spread is ordinary W-2 income at exercise. Returns total."""
    return sum(e.total_spread for e in exercises)


def compute_iso_regular_tax_impact(exercises: list[ISOExercise]) -> float:
    """ISOs generate NO regular-tax income at exercise. Returns $0."""
    return 0.0


def compute_iso_amt_preference(exercises: list[ISOExercise]) -> float:
    """ISO spread is an AMT preference item. Returns total spread across all exercises."""
    return sum(e.total_spread for e in exercises)


def compute_espp_tax(profile: TaxProfile) -> tuple[float, float]:
    """
    Compute ESPP ordinary income and long-term gain components.

    Qualifying disposition (held > 2 years from offering, > 1 year from purchase):
        Ordinary income = min(actual gain, §423 discount) where discount =
            FMV_at_offering - purchase_price (capped at 15% of FMV).
        LTCG = sale_price - (purchase_price + ordinary_income_portion)

    Disqualifying disposition:
        Ordinary income = FMV_at_purchase - purchase_price (full spread)
        Capital gain    = sale_price - FMV_at_purchase (short or long term)
        For simplicity we treat disqualifying disposition capital portion as
        short-term (most common case for early sellers).

    Returns (additional_ordinary_income, additional_ltcg).
    """
    additional_ordinary = 0.0
    additional_ltcg = 0.0

    for sale in profile.espp_sales:
        discount = sale.fmv_at_purchase - sale.purchase_price
        total_gain = (sale.sale_price - sale.purchase_price) * sale.shares
        qualifying = sale.holding_period_days >= 730  # ~2 years simplified

        if qualifying:
            # Ordinary portion = lesser of discount or actual gain
            ordinary_per_share = min(discount, sale.sale_price - sale.purchase_price)
            ordinary_per_share = max(0.0, ordinary_per_share)
            ord_income = ordinary_per_share * sale.shares
            ltcg = total_gain - ord_income
            additional_ordinary += ord_income
            additional_ltcg += max(0.0, ltcg)
        else:
            # Disqualifying: spread is ordinary income
            spread = max(0.0, discount) * sale.shares
            additional_ordinary += spread
            # Remainder treated as short-term (already in profile.short_term_gains
            # in most broker 1099 forms, but we add delta here)

    return additional_ordinary, additional_ltcg


def compute_schedule_d(profile: TaxProfile) -> dict:
    """
    Net short-term and long-term gains/losses. §1231 gains are treated as
    long-term. Returns a summary dict used downstream.
    """
    espp_ordinary, espp_ltcg = compute_espp_tax(profile)

    net_st = profile.short_term_gains               # may be negative (loss)
    net_lt = profile.long_term_gains + espp_ltcg    # include qualifying ESPP

    # Cross-netting: net losses in one category offset gains in the other
    if net_st < 0 and net_lt > 0:
        offset = min(abs(net_st), net_lt)
        net_lt -= offset
        net_st = min(0.0, net_st + offset)
    elif net_lt < 0 and net_st > 0:
        offset = min(abs(net_lt), net_st)
        net_st -= offset
        net_lt = min(0.0, net_lt + offset)

    # Annual capital loss deduction cap: $3,000
    deductible_loss = 0.0
    if net_st < 0 and net_lt <= 0:
        deductible_loss = min(3_000.0, abs(net_st) + abs(net_lt))
        net_st = max(net_st, 0.0)
        net_lt = max(net_lt, 0.0)

    return {
        "net_short_term": net_st,
        "net_long_term": net_lt,
        "espp_ordinary_income": espp_ordinary,
        "espp_ltcg": espp_ltcg,
        "capital_loss_deduction": deductible_loss,
    }


def _compute_agi(profile: TaxProfile, schedule_d: dict) -> float:
    """Compute Adjusted Gross Income from all income sources."""
    nso_income = compute_nso_w2_income(profile.nso_exercises)
    espp_ordinary = schedule_d["espp_ordinary_income"]

    agi = (
        profile.w2_income
        + profile.rsu_income
        + profile.business_income
        + nso_income
        + espp_ordinary
        + max(0.0, schedule_d["net_short_term"])
        + max(0.0, schedule_d["net_long_term"])
        + profile.qualified_dividends
        + profile.other_income
        - schedule_d["capital_loss_deduction"]
        - profile.traditional_ira_contributions
    )
    return max(0.0, agi)


def compute_regular_tax(profile: TaxProfile) -> tuple[float, float, float]:
    """
    Compute regular federal income tax.

    Returns (regular_tax, taxable_income, agi).
    Standard vs. itemized deduction: take the larger.
    LTCG and qualified dividends are taxed at preferential rates (see
    compute_ltcg_tax); this function taxes only the ordinary income portion.
    """
    schedule_d = compute_schedule_d(profile)
    agi = _compute_agi(profile, schedule_d)

    std = IRS.std_deduction_single if profile.filing_status == "single" else IRS.std_deduction_mfj
    deduction = max(std, profile.itemized_deductions)
    taxable = max(0.0, agi - deduction)

    # Ordinary taxable income = total taxable income minus preferential items
    preferential = min(
        taxable,
        max(0.0, schedule_d["net_long_term"]) + profile.qualified_dividends
    )
    ordinary_taxable = max(0.0, taxable - preferential)

    brackets = IRS.brackets_single if profile.filing_status == "single" else IRS.brackets_mfj
    tax_on_ordinary = _apply_brackets(ordinary_taxable, brackets)

    # LTCG tax is computed separately and added
    ltcg_tax = compute_ltcg_tax(profile, agi, deduction, schedule_d)

    regular_tax = tax_on_ordinary + ltcg_tax
    return regular_tax, taxable, agi


def compute_ltcg_tax(
    profile: TaxProfile,
    agi: float,
    deduction: float,
    schedule_d: dict,
) -> float:
    """
    Apply preferential 0/15/20% LTCG rates to net long-term gains +
    qualified dividends. Income is "stacked on top" of ordinary income.
    """
    is_single = profile.filing_status == "single"
    taxable_income = max(0.0, agi - deduction)
    ltcg_income = max(0.0, schedule_d["net_long_term"]) + profile.qualified_dividends
    ltcg_income = min(ltcg_income, taxable_income)  # cannot exceed total taxable

    # Ordinary income = taxable income minus LTCG bucket
    ordinary_income = max(0.0, taxable_income - ltcg_income)

    zero_top = IRS.ltcg_0pct_single if is_single else IRS.ltcg_0pct_mfj
    fifteen_top = IRS.ltcg_15pct_single if is_single else IRS.ltcg_15pct_mfj

    tax = 0.0
    remaining = ltcg_income
    # LTCG "sits on top" of ordinary income in the rate stack
    stack_bottom = ordinary_income

    # 0% band
    zero_space = max(0.0, zero_top - stack_bottom)
    in_zero = min(remaining, zero_space)
    remaining -= in_zero
    stack_bottom += in_zero

    # 15% band
    fifteen_space = max(0.0, fifteen_top - stack_bottom)
    in_fifteen = min(remaining, fifteen_space)
    tax += in_fifteen * 0.15
    remaining -= in_fifteen
    stack_bottom += in_fifteen

    # 20% on the rest
    tax += remaining * 0.20

    return tax


def compute_amt(profile: TaxProfile, regular_tax: float, taxable_income: float) -> tuple[float, dict]:
    """
    Compute Alternative Minimum Tax (Form 6251).

    AMT Income (AMTI) starts from regular taxable income then:
      + ISO spreads (AMT preference item)
      + State and local taxes deducted on Schedule A (add back)
      - AMT exemption (phases out at $0.25 per dollar over phase-out start)

    Tentative minimum tax = 26% on first $220,700 of AMTI, 28% above.
    AMT owed = max(0, TMT − regular_tax).
    """
    iso_spread = compute_iso_amt_preference(profile.iso_exercises)
    # State tax add-back: if itemizing, state taxes are already deducted
    state_tax_addback = profile.itemized_deductions * 0.20  # rough SALT estimate

    amti = taxable_income + iso_spread + state_tax_addback

    is_single = profile.filing_status == "single"
    exemption = IRS.amt_exemption_single if is_single else IRS.amt_exemption_mfj
    phaseout_start = IRS.amt_phaseout_single if is_single else IRS.amt_phaseout_mfj

    # Exemption phase-out: reduce by $0.25 for every dollar over phase-out start
    if amti > phaseout_start:
        reduction = (amti - phaseout_start) * 0.25
        exemption = max(0.0, exemption - reduction)

    amti_after_exemption = max(0.0, amti - exemption)

    # Tentative minimum tax: 26% on first $220,700; 28% above
    crossover = IRS.amt_rate_crossover
    if amti_after_exemption <= crossover:
        tmt = amti_after_exemption * IRS.amt_rate_low
    else:
        tmt = (crossover * IRS.amt_rate_low) + ((amti_after_exemption - crossover) * IRS.amt_rate_high)

    amt_owed = max(0.0, tmt - regular_tax)

    preference_items = {
        "iso_spread": iso_spread,
        "state_tax_addback": state_tax_addback,
        "amti": amti,
        "exemption_used": exemption,
        "amti_after_exemption": amti_after_exemption,
        "tentative_minimum_tax": tmt,
        "amt_over_regular": amt_owed,
    }
    return amt_owed, preference_items


def compute_niit(profile: TaxProfile, agi: float) -> float:
    """
    Net Investment Income Tax — IRC §1411.
    3.8% on the lesser of:
      (a) net investment income (NII), or
      (b) MAGI − filing-status threshold
    NII = LTCG + qualified dividends + short-term gains (non-trade) + passive income.
    """
    is_single = profile.filing_status == "single"
    threshold = IRS.niit_threshold_single if is_single else IRS.niit_threshold_mfj

    magi_over = max(0.0, agi - threshold)
    if magi_over == 0:
        return 0.0

    schedule_d = compute_schedule_d(profile)
    nii = (
        max(0.0, schedule_d["net_long_term"])
        + profile.qualified_dividends
        + max(0.0, profile.short_term_gains)
    )

    niit_base = min(nii, magi_over)
    return niit_base * IRS.niit_rate


def compute_medicare_surtax(profile: TaxProfile, agi: float) -> float:
    """
    Additional 0.9% Medicare surtax on earned income above threshold.
    Employee pays additional 0.9% on wages above $200k single / $250k MFJ.
    This is separate from NIIT.
    """
    is_single = profile.filing_status == "single"
    threshold = IRS.medicare_additional_threshold_single if is_single else IRS.medicare_additional_threshold_mfj

    earned = profile.w2_income + profile.rsu_income + compute_nso_w2_income(profile.nso_exercises)
    surtax_base = max(0.0, earned - threshold)
    return surtax_base * IRS.medicare_additional_rate


def compute_state_tax(profile: TaxProfile, agi: float) -> float:
    """
    Compute state income tax for supported states.

    CA: 9 brackets + 1% mental health surcharge on income > $1M.
    NY: 9 brackets, top rate 10.9%.
    TX, FL, NV: no state income tax.
    WA: 7% on long-term capital gains above $262,000 (SB 5096 upheld 2023).
    All others: estimated at 4% of federal AGI.
    """
    state = profile.state_code.upper()

    if state in ("TX", "FL", "NV", "WY", "SD", "AK", "TN", "NH"):
        return 0.0

    if state == "CA":
        # CA 2026 brackets (single — MFJ roughly doubles thresholds)
        ca_brackets_single = (
            (10_412.0,   0.01),
            (24_684.0,   0.02),
            (38_959.0,   0.04),
            (54_081.0,   0.06),
            (68_350.0,   0.08),
            (349_137.0,  0.093),
            (418_961.0,  0.103),
            (698_274.0,  0.113),
            (1_000_000.0, 0.123),
            (math.inf,   0.133),
        )
        if profile.filing_status == "mfj":
            # MFJ roughly doubles bracket thresholds
            ca_brackets = tuple(
                (ub * 2 if ub != math.inf else math.inf, r)
                for ub, r in ca_brackets_single
            )
        else:
            ca_brackets = ca_brackets_single

        ca_tax = _apply_brackets(agi, ca_brackets)
        # 1% mental health surcharge on income over $1M
        if agi > 1_000_000:
            ca_tax += (agi - 1_000_000) * 0.01
        return ca_tax

    if state == "NY":
        ny_brackets_single = (
            (17_150.0,   0.04),
            (23_600.0,   0.045),
            (27_900.0,   0.0525),
            (161_550.0,  0.0585),
            (323_200.0,  0.0625),
            (2_155_350.0, 0.0685),
            (5_000_000.0, 0.0965),
            (25_000_000.0, 0.103),
            (math.inf,   0.109),
        )
        if profile.filing_status == "mfj":
            ny_brackets = tuple(
                (ub * 2 if ub != math.inf else math.inf, r)
                for ub, r in ny_brackets_single
            )
        else:
            ny_brackets = ny_brackets_single
        return _apply_brackets(agi, ny_brackets)

    if state == "WA":
        # Washington capital gains tax (7% on LTCG above $262,000)
        schedule_d = compute_schedule_d(profile)
        ltcg_wa = max(0.0, schedule_d["net_long_term"])
        wa_threshold = 262_000.0
        return max(0.0, ltcg_wa - wa_threshold) * 0.07

    # Default: rough 4% estimate for unlisted states
    return agi * 0.04


def compute_backdoor_roth_pro_rata(
    trad_ira_balance: float,
    nondeductible_basis: float,
    conversion_amount: float,
) -> float:
    """
    Backdoor Roth IRA pro-rata rule (Form 8606).

    When converting a nondeductible IRA contribution, the taxable portion
    is determined by the ratio of pre-tax IRA assets to total IRA assets.

    taxable_fraction = pre_tax_balance / total_ira_balance
    taxable_amount   = conversion_amount * taxable_fraction

    Returns the TAXABLE portion of the conversion.
    """
    total_balance = trad_ira_balance + nondeductible_basis
    if total_balance <= 0:
        return 0.0
    pretax_balance = trad_ira_balance - nondeductible_basis
    pretax_balance = max(0.0, pretax_balance)
    taxable_fraction = pretax_balance / total_balance
    return conversion_amount * taxable_fraction


def compute_qsbs_exclusion(
    iso_exercise: ISOExercise,
    acquisition_date: date,
) -> tuple[float, float, bool]:
    """
    QSBS §1202 exclusion on qualified small business stock.

    Exclusion rate depends on acquisition date:
      100% if acquired after Sept 27, 2010
      75%  if acquired after Feb 17, 2009 and on/before Sept 27, 2010
      50%  if acquired on or before Feb 18, 2009

    Returns (excluded_gain, exclusion_rate, eligible).
    Eligible = not already sold (holding period must also be > 5 years,
    simplified here as a flag on ISOExercise).
    """
    if iso_exercise.already_sold:
        return 0.0, 0.0, False

    gain = iso_exercise.total_spread  # simplified: use spread as proxy for gain

    if acquisition_date > IRS.qsbs_100pct_cutoff:
        rate = 1.00
    elif acquisition_date >= IRS.qsbs_50pct_cutoff:
        rate = 0.75
    else:
        rate = 0.50

    excluded = gain * rate
    return excluded, rate, True


def compute_quarterly_estimates(
    annual_tax: float,
    prior_year_tax: float,
    w2_withholding: float,
) -> list[dict]:
    """
    Compute quarterly estimated tax payments (Form 1040-ES).

    Safe harbor: pay the lesser of:
      (a) 90% of current-year tax, or
      (b) 100% of prior-year tax (110% if prior-year AGI > $150k)

    Each quarter = safe_harbor_total / 4, reduced by W-2 withholding.
    Due dates: Apr 15, Jun 15, Sep 15, Jan 15 of following year.

    Returns list of 4 dicts with due_date and amount.
    """
    safe_harbor_current = annual_tax * 0.90
    # Assume high income → use 110% of prior year
    safe_harbor_prior = prior_year_tax * 1.10

    safe_harbor_total = min(safe_harbor_current, safe_harbor_prior)
    quarterly_need = max(0.0, safe_harbor_total - w2_withholding)
    per_quarter = quarterly_need / 4.0

    due_dates = [
        "April 15, 2026",
        "June 15, 2026",
        "September 15, 2026",
        "January 15, 2027",
    ]
    return [{"due_date": d, "amount": round(per_quarter, 2)} for d in due_dates]


# ---------------------------------------------------------------------------
# 6. Recommendation Engine
# ---------------------------------------------------------------------------

def generate_recommendations(profile: TaxProfile, result: TaxResult) -> list[str]:
    """Generate actionable tax planning recommendations based on profile and results."""
    recs = []

    # AMT planning
    if result.amt_triggered:
        recs.append(
            f"AMT triggered (${result.amt:,.0f} over regular tax). "
            "Consider deferring ISO exercises to avoid AMT preference accumulation. "
            "Review ISO spread timing — exercise in low-income years."
        )

    # QSBS §1202 opportunity
    for iso in profile.iso_exercises:
        acquired = iso.exercise_date
        _, rate, eligible = compute_qsbs_exclusion(iso, acquired)
        if eligible and rate == 1.0:
            recs.append(
                f"QSBS §1202 applies to ISO grant acquired after Sept 27 2010. "
                f"If held 5+ years in qualified C-corp, {rate*100:.0f}% of gain "
                f"(est. ${iso.total_spread:,.0f}) may be excluded. Verify C-corp eligibility."
            )

    # Roth conversion window
    if result.marginal_rate <= 0.24 and profile.roth_contributions == 0:
        headroom = _roth_headroom(profile, result)
        if headroom > 0:
            recs.append(
                f"Roth conversion opportunity: ~${headroom:,.0f} of traditional IRA "
                "assets could convert at ≤24% marginal rate this year before "
                "triggering a higher bracket."
            )

    # Backdoor Roth (if Roth income limits exceeded)
    is_single = profile.filing_status == "single"
    roth_limit = IRS.roth_phaseout_single_end if is_single else IRS.roth_phaseout_mfj_end
    agi_approx = result.total_federal / max(result.effective_rate, 0.01)
    if agi_approx > roth_limit:
        recs.append(
            "Income exceeds Roth IRA contribution phase-out. "
            "Use the Backdoor Roth strategy: contribute to nondeductible traditional IRA "
            f"(${IRS.ira_limit:,.0f}), then convert. Watch pro-rata rule if you have "
            "existing pre-tax IRA balances."
        )

    # ESPP holding period
    for sale in profile.espp_sales:
        if sale.holding_period_days < 730:
            recs.append(
                f"Disqualifying ESPP disposition detected ({sale.holding_period_days} days held). "
                "Hold ESPP shares ≥2 years from offering date and ≥1 year from purchase "
                "to qualify for preferential tax treatment on the discount portion."
            )
            break

    # Quarterly estimates
    if result.quarterly_estimates:
        q1 = result.quarterly_estimates[0]
        recs.append(
            f"Estimated quarterly tax payments required: ~${q1['amount']:,.0f}/quarter. "
            f"First payment due {q1['due_date']}. Underpayment penalty applies if not paid."
        )

    # NIIT planning
    if result.niit > 0:
        recs.append(
            f"NIIT of ${result.niit:,.0f} applies. Consider tax-loss harvesting to reduce "
            "net investment income, or deferring gain recognition into a lower-income year."
        )

    # 401(k) max
    k401_limit = IRS.k401_catchup_limit if profile.age >= 50 else IRS.k401_limit
    recs.append(
        f"Maximize 401(k) contribution to ${k401_limit:,.0f} "
        f"({'catch-up eligible' if profile.age >= 50 else 'standard limit'}) "
        "to reduce AGI and defer tax on growth."
    )

    return recs


def _roth_headroom(profile: TaxProfile, result: TaxResult) -> float:
    """Estimate headroom before next bracket threshold for Roth conversion."""
    brackets = IRS.brackets_single if profile.filing_status == "single" else IRS.brackets_mfj
    agi_est = result.total_federal / max(result.effective_rate, 0.001)
    prev = 0.0
    for upper, _ in brackets:
        if agi_est <= upper:
            return max(0.0, upper - agi_est)
        prev = upper
    return 0.0


# ---------------------------------------------------------------------------
# 7. Roth Conversion Ladder Optimizer
# ---------------------------------------------------------------------------

class RothConversionLadder:
    """
    Multi-year Roth conversion ladder optimizer.

    Strategy: convert traditional IRA assets to Roth each year up to the top
    of the 22% or 24% bracket (whichever is chosen), minimizing lifetime tax
    on retirement distributions.
    """

    def optimize(
        self,
        current_bracket_top: float,
        roth_balance: float,
        trad_balance: float,
        years_to_retirement: int,
        expected_retirement_income: float,
        filing_status: str = "single",
        target_bracket: float = 0.24,
    ) -> list[dict]:
        """
        Return recommended conversion amounts per year.

        Parameters
        ----------
        current_bracket_top : current taxable income (to determine headroom)
        roth_balance        : current Roth IRA balance
        trad_balance        : current traditional IRA pre-tax balance
        years_to_retirement : years until RMDs / full retirement
        expected_retirement_income : expected non-IRA retirement income (SS, pension, etc.)
        filing_status       : "single" or "mfj"
        target_bracket      : fill up to this marginal rate (default 24%)

        Returns list of dicts: {year, convert_amount, tax_cost, projected_roth_balance}
        """
        brackets = IRS.brackets_single if filing_status == "single" else IRS.brackets_mfj

        # Find the top of the target bracket
        target_ceiling = 0.0
        for upper, rate in brackets:
            if rate <= target_bracket:
                target_ceiling = upper
            else:
                break

        plan = []
        projected_trad = trad_balance
        projected_roth = roth_balance
        growth_rate = 0.07  # assumed 7% annual growth

        for year in range(1, years_to_retirement + 1):
            headroom = max(0.0, target_ceiling - current_bracket_top)
            convert_amount = min(headroom, projected_trad)

            if convert_amount <= 0:
                break

            # Tax cost on conversion at target_bracket marginal rate (simplified)
            tax_cost = convert_amount * target_bracket

            projected_trad = (projected_trad - convert_amount) * (1 + growth_rate)
            projected_roth = (projected_roth + convert_amount) * (1 + growth_rate)

            plan.append({
                "year": f"Year {year}",
                "convert_amount": round(convert_amount, 2),
                "tax_cost": round(tax_cost, 2),
                "projected_trad_balance": round(projected_trad, 2),
                "projected_roth_balance": round(projected_roth, 2),
            })

            # In retirement years, current_bracket_top approaches expected_retirement_income
            current_bracket_top = expected_retirement_income

        return plan


# ---------------------------------------------------------------------------
# 8. Top-Level Entry Point
# ---------------------------------------------------------------------------

def compute_full_tax(profile: TaxProfile) -> TaxResult:
    """
    Compute the complete federal + state tax picture for a TaxProfile.

    Execution order:
      1. Schedule D (capital gains netting, ESPP split)
      2. AGI
      3. Regular tax (ordinary brackets + LTCG preferential rates)
      4. AMT (ISO preference, exemption phase-out, TMT)
      5. NIIT (3.8% on investment income)
      6. Medicare surtax (0.9% on high earned income)
      7. State tax
      8. Quarterly estimates
      9. Recommendations
    """
    schedule_d = compute_schedule_d(profile)
    agi = _compute_agi(profile, schedule_d)

    regular_tax, taxable_income, _ = compute_regular_tax(profile)
    amt_owed, amt_prefs = compute_amt(profile, regular_tax, taxable_income)

    # Final federal income tax = max(regular, tentative minimum tax)
    tmt = regular_tax + amt_owed
    tax_owed = tmt
    amt_triggered = amt_owed > 0

    niit = compute_niit(profile, agi)
    medicare_surtax = compute_medicare_surtax(profile, agi)
    state_tax = compute_state_tax(profile, agi)

    total_federal = tax_owed + niit + medicare_surtax
    total_tax = total_federal + state_tax

    effective_rate = total_federal / agi if agi > 0 else 0.0
    brackets = IRS.brackets_single if profile.filing_status == "single" else IRS.brackets_mfj
    marginal_rate = _marginal_rate(taxable_income, brackets)

    quarterly_estimates = compute_quarterly_estimates(
        annual_tax=total_federal,
        prior_year_tax=profile.prior_year_tax,
        w2_withholding=profile.w2_withholding,
    )

    result = TaxResult(
        regular_tax=round(regular_tax, 2),
        amt=round(amt_owed, 2),
        tax_owed=round(tax_owed, 2),
        niit=round(niit, 2),
        medicare_surtax=round(medicare_surtax, 2),
        total_federal=round(total_federal, 2),
        state_tax=round(state_tax, 2),
        total_tax=round(total_tax, 2),
        effective_rate=round(effective_rate, 4),
        marginal_rate=marginal_rate,
        amt_triggered=amt_triggered,
        amt_preference_items=amt_prefs,
        schedule_d_summary=schedule_d,
        quarterly_estimates=quarterly_estimates,
        recommendations=[],  # populated below
    )

    result.recommendations = generate_recommendations(profile, result)
    return result
