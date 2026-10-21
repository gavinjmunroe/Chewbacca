"""
core/irs_limits_2026.py — 2026 IRS contribution limits and tax brackets.

Sources:
  - IRS Rev. Proc. 2025-22 (2026 limits)
  - SSA COLA announcement (SS wage base)
  - CA FTB Schedule X (CA brackets, standard deduction)

Canonical Python mirror of web/src/lib/types.ts TAX_LIMITS_2026.
Import this in any Python module that needs IRS limits to keep them in sync.
"""

IRS_LIMITS_2026 = {
    "employee_401k_limit": 23500,        # IRS 2026 elective deferral limit
    "irs_limit_415c": 70000,             # IRC 415(c) annual additions limit
    "ira_limit": 7000,                   # IRA contribution limit (under age 50)
    "ira_limit_catch_up": 8000,          # IRA limit age 50+
    "roth_ira_phase_out_lower": 150000,  # Roth IRA phase-out start (single, 2026)
    "roth_ira_phase_out_upper": 165000,  # Roth IRA phase-out end (single, 2026)
    "ss_wage_base": 176100,              # Social Security wage base 2026
    "additional_medicare_threshold": 200000,
    "federal_standard_deduction": 15750,  # Est. 2026 (inflation-adjusted)
    "ca_standard_deduction": 5706,        # CA FTB Schedule X, single
}

# 2026 Federal income tax brackets — single filer
# Source: IRS Rev. Proc. 2025-22
FEDERAL_BRACKETS_2026_SINGLE = [
    (0.10, 11925),
    (0.12, 48475),
    (0.22, 103350),
    (0.24, 197300),
    (0.32, 250525),
    (0.35, 626350),
    (0.37, float("inf")),
]

# 2026 California Schedule X — single filer
CA_BRACKETS_2026_SINGLE = [
    (0.01,  10756),
    (0.02,  25499),
    (0.04,  40245),
    (0.06,  55866),
    (0.08,  70606),
    (0.093, 360659),
    (0.103, 432787),
    (0.113, 721314),
    (0.123, float("inf")),
]


def calc_federal_tax(gross_annual: float, pretax_annual: float, std_ded: float | None = None) -> dict:
    """Calculate federal income tax for a single filer.

    Args:
        gross_annual: Gross annual income.
        pretax_annual: Total pre-tax deductions (401k + health + HSA).
        std_ded: Standard deduction override (defaults to 2026 value).

    Returns:
        dict with taxable, tax, effective_rate, marginal_rate.
    """
    if std_ded is None:
        std_ded = IRS_LIMITS_2026["federal_standard_deduction"]
    taxable = max(0.0, gross_annual - pretax_annual - std_ded)
    tax = _apply_brackets(taxable, FEDERAL_BRACKETS_2026_SINGLE)
    marginal = 0.10
    for rate, up_to in FEDERAL_BRACKETS_2026_SINGLE:
        marginal = rate
        if taxable <= up_to:
            break
    return {
        "taxable": taxable,
        "tax": tax,
        "effective_rate": tax / gross_annual if gross_annual > 0 else 0,
        "marginal_rate": marginal,
    }


def calc_ca_tax(gross_annual: float, pretax_annual_ca: float, std_ded: float | None = None) -> dict:
    """Calculate CA state tax (HSA NOT deductible in CA).

    Args:
        gross_annual: Gross annual income.
        pretax_annual_ca: Pre-tax deductions excluding HSA (CA doesn't allow HSA deduction).
        std_ded: CA standard deduction override.

    Returns:
        dict with taxable, tax, effective_rate.
    """
    if std_ded is None:
        std_ded = IRS_LIMITS_2026["ca_standard_deduction"]
    taxable = max(0.0, gross_annual - pretax_annual_ca - std_ded)
    tax = _apply_brackets(taxable, CA_BRACKETS_2026_SINGLE)
    return {
        "taxable": taxable,
        "tax": tax,
        "effective_rate": tax / gross_annual if gross_annual > 0 else 0,
    }


def calc_payroll_taxes(gross_annual: float) -> dict:
    """Calculate FICA + CA SDI payroll taxes."""
    ss = min(gross_annual, IRS_LIMITS_2026["ss_wage_base"]) * 0.062
    medicare = gross_annual * 0.0145
    addl_medicare = max(0, gross_annual - IRS_LIMITS_2026["additional_medicare_threshold"]) * 0.009
    ca_sdi = gross_annual * 0.011  # CA SDI: 1.1% in 2026, no wage ceiling
    return {
        "ss": ss,
        "medicare": medicare,
        "addl_medicare": addl_medicare,
        "ca_sdi": ca_sdi,
        "total": ss + medicare + addl_medicare + ca_sdi,
    }


def _apply_brackets(income: float, brackets: list[tuple[float, float]]) -> float:
    if income <= 0:
        return 0.0
    tax = 0.0
    prev = 0.0
    for rate, up_to in brackets:
        slice_ = min(income, up_to) - prev
        if slice_ <= 0:
            break
        tax += slice_ * rate
        prev = up_to
        if income <= up_to:
            break
    return tax
