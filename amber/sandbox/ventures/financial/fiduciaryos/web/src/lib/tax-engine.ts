// 2026 Federal income tax brackets — single filer
// Source: IRS Rev. Proc. 2025-22
const FEDERAL_2026 = [
  { rate: 0.10, upTo: 11925 },
  { rate: 0.12, upTo: 48475 },
  { rate: 0.22, upTo: 103350 },
  { rate: 0.24, upTo: 197300 },
  { rate: 0.32, upTo: 250525 },
  { rate: 0.35, upTo: 626350 },
  { rate: 0.37, upTo: Infinity },
];

// 2026 California Schedule X — single filer
// Source: CA FTB
const CA_2026 = [
  { rate: 0.01,  upTo: 10756 },
  { rate: 0.02,  upTo: 25499 },
  { rate: 0.04,  upTo: 40245 },
  { rate: 0.06,  upTo: 55866 },
  { rate: 0.08,  upTo: 70606 },
  { rate: 0.093, upTo: 360659 },
  { rate: 0.103, upTo: 432787 },
  { rate: 0.113, upTo: 721314 },
  { rate: 0.123, upTo: Infinity },
];

function applyBrackets(income: number, brackets: { rate: number; upTo: number }[]): number {
  if (income <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    const slice = Math.min(income, b.upTo) - prev;
    if (slice <= 0) break;
    tax += slice * b.rate;
    prev = b.upTo;
    if (income <= b.upTo) break;
  }
  return tax;
}

export function calcFederalTax(grossAnnual: number, pretaxAnnual: number, stdDed = 15750) {
  const taxable = Math.max(0, grossAnnual - pretaxAnnual - stdDed);
  const tax = applyBrackets(taxable, FEDERAL_2026);
  let marginal = 0.10;
  for (const b of FEDERAL_2026) {
    marginal = b.rate;
    if (taxable <= b.upTo) break;
  }
  return { taxable, tax, effectiveRate: grossAnnual > 0 ? tax / grossAnnual : 0, marginal };
}

// CA does NOT allow HSA deduction — pass a separate pretaxAnnual for CA that excludes HSA
export function calcCATax(grossAnnual: number, pretaxAnnualCA: number, stdDed = 5706) {
  const taxable = Math.max(0, grossAnnual - pretaxAnnualCA - stdDed);
  const tax = applyBrackets(taxable, CA_2026);
  return { taxable, tax, effectiveRate: grossAnnual > 0 ? tax / grossAnnual : 0 };
}

export function calcPayrollTaxes(grossAnnual: number) {
  // SS: 6.2% up to $176,100 (2026 wage base)
  const ss = Math.min(grossAnnual, 176100) * 0.062;
  const medicare = grossAnnual * 0.0145;
  const addlMedicare = Math.max(0, grossAnnual - 200000) * 0.009;
  // CA SDI: 1.1% in 2026, no wage ceiling
  const caSDI = grossAnnual * 0.011;
  return { ss, medicare, addlMedicare, caSDI, total: ss + medicare + addlMedicare + caSDI };
}

// Simplified MAGI for Roth IRA eligibility (W-2 single filer)
// Subtracts traditional 401k only — adequate for this user profile
export function calcAGIApprox(grossAnnual: number, traditional401kAnnual: number) {
  return grossAnnual - traditional401kAnnual;
}

// Keep the old name as alias for backward compat within the codebase
export const calcMAGI = calcAGIApprox;

export function calcRothIRAAllowed(magi: number, limit = 7000, lower = 150000, upper = 165000) {
  if (magi <= lower) return limit;
  if (magi >= upper) return 0;
  return Math.floor((limit * (1 - (magi - lower) / (upper - lower))) / 10) * 10;
}
