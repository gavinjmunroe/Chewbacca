/**
 * tax-engine-v2.ts — CPA-replacement tax engine for FiduciaryOS v2.
 *
 * Covers: AMT (Form 6251), NIIT (§1411), equity compensation (ISO/NSO/RSU/ESPP),
 * Schedule D, backdoor Roth pro-rata rule, QSBS §1202, Roth conversion ladder,
 * quarterly safe harbor estimates.
 *
 * All values use 2026 IRS limits (Rev. Proc. 2025-22).
 */

// ── 2026 IRS Constants ────────────────────────────────────────────────────────

const IRS_2026 = {
  // Standard deductions
  stdDed_single: 15750,
  stdDed_mfj: 31500,
  // AMT exemptions
  amt_exemption_single: 137000,
  amt_exemption_mfj: 220700,
  amt_phaseout_single: 1156300,
  amt_phaseout_mfj: 1545200,
  // AMT rates
  amt_rate_lower: 0.26,
  amt_rate_upper: 0.28,
  amt_rate_threshold: 220700,
  // NIIT thresholds
  niit_threshold_single: 200000,
  niit_threshold_mfj: 250000,
  niit_rate: 0.038,
  // LTCG brackets (single)
  ltcg_0pct_single: 47025,
  ltcg_15pct_single: 518900,
  ltcg_0pct_mfj: 94050,
  ltcg_15pct_mfj: 583750,
  // Medicare surtax
  add_medicare_threshold_single: 200000,
  add_medicare_threshold_mfj: 250000,
  add_medicare_rate: 0.009,
  // Roth IRA phase-out (single)
  roth_phaseout_lower_single: 150000,
  roth_phaseout_upper_single: 165000,
  roth_phaseout_lower_mfj: 236000,
  roth_phaseout_upper_mfj: 246000,
  // Contribution limits
  ira_limit: 7000,
  k401_limit: 23500,
  k401_catchup_50: 31000,
  k401_415c: 70000,
  ss_wage_base: 176100,
};

const FEDERAL_BRACKETS_SINGLE_2026 = [
  { rate: 0.10, upTo: 11925 },
  { rate: 0.12, upTo: 48475 },
  { rate: 0.22, upTo: 103350 },
  { rate: 0.24, upTo: 197300 },
  { rate: 0.32, upTo: 250525 },
  { rate: 0.35, upTo: 626350 },
  { rate: 0.37, upTo: Infinity },
];

const FEDERAL_BRACKETS_MFJ_2026 = [
  { rate: 0.10, upTo: 23850 },
  { rate: 0.12, upTo: 96950 },
  { rate: 0.22, upTo: 206700 },
  { rate: 0.24, upTo: 394600 },
  { rate: 0.32, upTo: 501050 },
  { rate: 0.35, upTo: 751600 },
  { rate: 0.37, upTo: Infinity },
];

// ── Helper ────────────────────────────────────────────────────────────────────

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

function getMarginalRate(taxable: number, brackets: { rate: number; upTo: number }[]): number {
  let marginal = brackets[0].rate;
  for (const b of brackets) {
    marginal = b.rate;
    if (taxable <= b.upTo) break;
  }
  return marginal;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TaxInput {
  filingStatus: "single" | "mfj";
  w2Income: number;
  // Equity comp
  isoSpread?: number;         // ISO exercise spread (AMT preference item only)
  nsoW2Income?: number;       // NSO/RSU ordinary income already in W-2
  rsuShares?: number;
  rsuFmv?: number;
  // Investment income
  shortTermGains?: number;
  longTermGains?: number;
  qualifiedDividends?: number;
  ordinaryDividends?: number;
  // Deductions
  itemizedDeductions?: number;
  traditionalIraContrib?: number;
  k401Contrib?: number;
  // State
  stateCode?: string;         // "CA" | "NY" | "TX" | "FL" | "WA" | other
  // Prior year
  priorYearTax?: number;
  w2Withholding?: number;
  // QSBS
  qsbsGain?: number;
  qsbsExclusion?: number;     // 0.5 | 1.0
}

export interface TaxResult {
  regularTax: number;
  amtTentative: number;
  amtOwed: number;
  amtTriggered: boolean;
  niit: number;
  additionalMedicare: number;
  totalFederal: number;
  stateTax: number;
  totalTax: number;
  effectiveRate: number;
  marginalRate: number;
  taxableIncome: number;
  agi: number;
  quarterlyEstimates: { label: string; dueDate: string; amount: number }[];
  recommendations: string[];
  scheduleD: { netShortTerm: number; netLongTerm: number; carryForward: number };
}

// ── AMT Computation ───────────────────────────────────────────────────────────

function computeAmt(
  regularTaxableIncome: number,
  isoSpread: number,
  itemizedDeductions: number,
  stateTax: number,
  filingStatus: "single" | "mfj"
): { tentative: number; owed: number; exemption: number; amti: number } {
  const exemption = filingStatus === "mfj" ? IRS_2026.amt_exemption_mfj : IRS_2026.amt_exemption_single;
  const phaseout = filingStatus === "mfj" ? IRS_2026.amt_phaseout_mfj : IRS_2026.amt_phaseout_single;

  // AMTI = regular taxable income + ISO preference + add back state tax deduction
  const amti = regularTaxableIncome + isoSpread + stateTax;

  // Exemption phase-out: reduces by $0.25 for each $1 over threshold
  const phaseoutReduction = Math.max(0, (amti - phaseout) * 0.25);
  const effectiveExemption = Math.max(0, exemption - phaseoutReduction);

  const amtBase = Math.max(0, amti - effectiveExemption);

  // AMT: 26% on first $220,700; 28% above
  let tentative = 0;
  if (amtBase <= IRS_2026.amt_rate_threshold) {
    tentative = amtBase * IRS_2026.amt_rate_lower;
  } else {
    tentative =
      IRS_2026.amt_rate_threshold * IRS_2026.amt_rate_lower +
      (amtBase - IRS_2026.amt_rate_threshold) * IRS_2026.amt_rate_upper;
  }

  return { tentative, owed: 0, exemption: effectiveExemption, amti };
}

// ── NIIT ──────────────────────────────────────────────────────────────────────

function computeNiit(
  magi: number,
  netInvestmentIncome: number,
  filingStatus: "single" | "mfj"
): number {
  const threshold =
    filingStatus === "mfj" ? IRS_2026.niit_threshold_mfj : IRS_2026.niit_threshold_single;
  const excess = Math.max(0, magi - threshold);
  return Math.min(excess, netInvestmentIncome) * IRS_2026.niit_rate;
}

// ── LTCG preferred rate ───────────────────────────────────────────────────────

function computeLtcgTax(
  ltcg: number,
  qualDividends: number,
  ordinaryTaxable: number,
  filingStatus: "single" | "mfj"
): number {
  const preferredIncome = ltcg + qualDividends;
  if (preferredIncome <= 0) return 0;

  const limit0 = filingStatus === "mfj" ? IRS_2026.ltcg_0pct_mfj : IRS_2026.ltcg_0pct_single;
  const limit15 = filingStatus === "mfj" ? IRS_2026.ltcg_15pct_mfj : IRS_2026.ltcg_15pct_single;

  // Stack LTCG on top of ordinary income
  const stackBase = ordinaryTaxable;
  let tax = 0;

  const in0pct = Math.max(0, Math.min(preferredIncome, limit0 - stackBase));
  const in15pct = Math.max(
    0,
    Math.min(preferredIncome - in0pct, limit15 - Math.max(stackBase, limit0))
  );
  const in20pct = preferredIncome - in0pct - in15pct;

  tax = in15pct * 0.15 + in20pct * 0.20;
  return tax;
}

// ── State Tax ─────────────────────────────────────────────────────────────────

const CA_BRACKETS = [
  { rate: 0.01,  upTo: 10756 },
  { rate: 0.02,  upTo: 25499 },
  { rate: 0.04,  upTo: 40245 },
  { rate: 0.06,  upTo: 55866 },
  { rate: 0.08,  upTo: 70606 },
  { rate: 0.093, upTo: 360659 },
  { rate: 0.103, upTo: 432787 },
  { rate: 0.113, upTo: 721314 },
  { rate: 0.123, upTo: 1000000 },
  { rate: 0.133, upTo: Infinity },  // CA mental health surtax
];

function computeStateTax(agi: number, ltcg: number, stateCode: string): number {
  switch (stateCode?.toUpperCase()) {
    case "CA":
      // CA taxes LTCG as ordinary income (no LTCG preference)
      return applyBrackets(agi, CA_BRACKETS);
    case "NY":
      // NY top rate 10.9% (simplified brackets)
      return applyBrackets(agi, [
        { rate: 0.04,  upTo: 17150 },
        { rate: 0.045, upTo: 23600 },
        { rate: 0.0525, upTo: 27900 },
        { rate: 0.0585, upTo: 161550 },
        { rate: 0.0625, upTo: 323200 },
        { rate: 0.0685, upTo: 2155350 },
        { rate: 0.0965, upTo: 5000000 },
        { rate: 0.103,  upTo: 25000000 },
        { rate: 0.109,  upTo: Infinity },
      ]);
    case "TX":
    case "FL":
    case "NV":
    case "WY":
    case "SD":
    case "AK":
      return 0;
    case "WA":
      // WA 7% capital gains tax on LTCG > $262,000
      return Math.max(0, ltcg - 262000) * 0.07;
    default:
      // Rough estimate for other states: 4% effective rate
      return agi * 0.04;
  }
}

// ── Quarterly Estimates ───────────────────────────────────────────────────────

export function computeQuarterlyEstimates(input: {
  annualTax: number;
  priorYearTax: number;
  w2Withholding: number;
  priorYearAgi?: number;
}): { quarterlyEstimates: { label: string; dueDate: string; amount: number }[] } {
  const { annualTax, priorYearTax, w2Withholding, priorYearAgi = 0 } = input;

  // Safe harbor: 100% of prior year (110% if prior AGI > $150k)
  const safeHarborPct = priorYearAgi > 150000 ? 1.10 : 1.00;
  const safeHarborTotal = priorYearTax * safeHarborPct;

  // Use lesser of safe harbor and 90% of current year
  const currentYear90 = annualTax * 0.90;
  const requiredTotal = Math.min(safeHarborTotal, currentYear90);

  const remainingAfterWithholding = Math.max(0, requiredTotal - w2Withholding);
  const perQuarter = Math.ceil(remainingAfterWithholding / 4);

  return {
    quarterlyEstimates: [
      { label: "Q1 2026", dueDate: "April 15, 2026", amount: perQuarter },
      { label: "Q2 2026", dueDate: "June 16, 2026", amount: perQuarter },
      { label: "Q3 2026", dueDate: "September 15, 2026", amount: perQuarter },
      { label: "Q4 2026", dueDate: "January 15, 2027", amount: perQuarter },
    ],
  };
}

// ── Equity Comp ───────────────────────────────────────────────────────────────

export interface EquityCompInput {
  filingStatus: "single" | "mfj";
  baseW2: number;
  isoExercises?: { shares: number; strike: number; fmv: number }[];
  nsoExercises?: { shares: number; strike: number; fmv: number }[];
  rsuVesting?: { shares: number; fmvAtVest: number }[];
  esppSales?: { purchasePrice: number; fmvAtPurchase: number; salePrice: number; shares: number; holdingDays: number }[];
  stateCode?: string;
}

export interface EquityCompResult {
  isoAMTPreference: number;
  nsoW2Income: number;
  rsuW2Income: number;
  esppOrdinaryIncome: number;
  esppLTCG: number;
  totalW2Addition: number;
  amtRisk: boolean;
  amtEstimate: number;
  recommendations: string[];
}

export function computeEquityCompTax(input: EquityCompInput): EquityCompResult {
  const isoSpread = (input.isoExercises ?? []).reduce(
    (sum, ex) => sum + ex.shares * (ex.fmv - ex.strike),
    0
  );

  const nsoIncome = (input.nsoExercises ?? []).reduce(
    (sum, ex) => sum + ex.shares * (ex.fmv - ex.strike),
    0
  );

  const rsuIncome = (input.rsuVesting ?? []).reduce(
    (sum, r) => sum + r.shares * r.fmvAtVest,
    0
  );

  let esppOrdinary = 0;
  let esppLTCG = 0;
  for (const sale of input.esppSales ?? []) {
    const discount = sale.fmvAtPurchase - sale.purchasePrice;
    const appreciation = sale.salePrice - sale.fmvAtPurchase;
    if (sale.holdingDays >= 730) {
      // Qualifying disposition: ordinary income = lesser of discount or total gain
      const totalGain = (sale.salePrice - sale.purchasePrice) * sale.shares;
      esppOrdinary += Math.min(discount * sale.shares, totalGain);
      esppLTCG += Math.max(0, appreciation * sale.shares);
    } else {
      // Disqualifying disposition: full spread is ordinary income
      esppOrdinary += (sale.fmvAtPurchase - sale.purchasePrice) * sale.shares;
      esppLTCG += appreciation * sale.shares;
    }
  }

  const totalW2Addition = nsoIncome + rsuIncome + esppOrdinary;
  const totalW2 = input.baseW2 + totalW2Addition;

  // Estimate AMT risk
  const brackets = input.filingStatus === "mfj" ? FEDERAL_BRACKETS_MFJ_2026 : FEDERAL_BRACKETS_SINGLE_2026;
  const stdDed = input.filingStatus === "mfj" ? IRS_2026.stdDed_mfj : IRS_2026.stdDed_single;
  const regularTaxable = Math.max(0, totalW2 - stdDed);
  const stateTax = computeStateTax(totalW2, 0, input.stateCode ?? "");
  const { tentative: amtTentative } = computeAmt(regularTaxable, isoSpread, 0, stateTax, input.filingStatus);
  const regularTax = applyBrackets(regularTaxable, brackets);
  const amtOwed = Math.max(0, amtTentative - regularTax);
  const amtRisk = amtOwed > 0;

  const recs: string[] = [];
  if (amtRisk) {
    recs.push(`AMT triggered: ~$${Math.round(amtOwed).toLocaleString()} owed above regular tax due to ISO spread of $${Math.round(isoSpread).toLocaleString()}.`);
    recs.push("Consider staggering ISO exercises across tax years to stay within AMT headroom.");
  } else if (isoSpread > 0) {
    recs.push(`ISO spread of $${Math.round(isoSpread).toLocaleString()} is below AMT threshold — no AMT triggered this year.`);
  }
  if (rsuIncome > 0) {
    recs.push(`RSU income of $${Math.round(rsuIncome).toLocaleString()} is ordinary income — ensure adequate supplemental withholding (22% federal + state).`);
  }
  if (esppLTCG > 0) {
    recs.push("ESPP qualifying disposition achieved — discount taxed as ordinary income, appreciation as LTCG.");
  }

  return {
    isoAMTPreference: isoSpread,
    nsoW2Income: nsoIncome,
    rsuW2Income: rsuIncome,
    esppOrdinaryIncome: esppOrdinary,
    esppLTCG,
    totalW2Addition,
    amtRisk,
    amtEstimate: amtOwed,
    recommendations: recs,
  };
}

// ── Roth Conversion Ladder ────────────────────────────────────────────────────

export function computeRothConversionLadder(input: {
  filingStatus: "single" | "mfj";
  currentTaxableIncome: number;
  tradIraBalance: number;
  yearsToRetirement: number;
  targetBracketTop?: number;
}): { conversions: { year: number; amount: number; marginalRate: number }[]; totalConverted: number } {
  const brackets = input.filingStatus === "mfj" ? FEDERAL_BRACKETS_MFJ_2026 : FEDERAL_BRACKETS_SINGLE_2026;
  const targetTop = input.targetBracketTop ?? (input.filingStatus === "mfj" ? 206700 : 103350); // 22% bracket top

  const headroom = Math.max(0, targetTop - input.currentTaxableIncome);
  const maxConversionPerYear = Math.min(headroom, input.tradIraBalance / Math.max(input.yearsToRetirement, 1));

  const conversions = [];
  let remaining = input.tradIraBalance;
  for (let year = 1; year <= Math.min(input.yearsToRetirement, 20); year++) {
    const amount = Math.min(maxConversionPerYear, remaining);
    if (amount <= 0) break;
    const marginalRate = getMarginalRate(input.currentTaxableIncome + amount, brackets);
    conversions.push({ year, amount: Math.round(amount), marginalRate });
    remaining -= amount;
  }

  return { conversions, totalConverted: conversions.reduce((s, c) => s + c.amount, 0) };
}

// ── Backdoor Roth Pro-Rata ────────────────────────────────────────────────────

export function computeBackdoorRothProRata(input: {
  tradIraBalance: number;
  nondeductibleBasis: number;
  conversionAmount: number;
}): { taxableConversion: number; taxFreeConversion: number; proRataRate: number } {
  const totalBalance = input.tradIraBalance;
  if (totalBalance <= 0) {
    return { taxableConversion: 0, taxFreeConversion: input.conversionAmount, proRataRate: 0 };
  }
  const taxFreeRate = input.nondeductibleBasis / totalBalance;
  const taxFreeConversion = input.conversionAmount * taxFreeRate;
  const taxableConversion = input.conversionAmount - taxFreeConversion;
  return {
    taxableConversion: Math.round(taxableConversion),
    taxFreeConversion: Math.round(taxFreeConversion),
    proRataRate: taxFreeRate,
  };
}

// ── Full Tax Projection ───────────────────────────────────────────────────────

export function computeFullTaxProjection(input: TaxInput): TaxResult {
  const isMfj = input.filingStatus === "mfj";
  const brackets = isMfj ? FEDERAL_BRACKETS_MFJ_2026 : FEDERAL_BRACKETS_SINGLE_2026;
  const stdDed = isMfj ? IRS_2026.stdDed_mfj : IRS_2026.stdDed_single;

  const isoSpread = input.isoSpread ?? 0;
  const nsoIncome = input.nsoW2Income ?? 0;
  const rsuIncome = (input.rsuShares ?? 0) * (input.rsuFmv ?? 0);
  const stcg = input.shortTermGains ?? 0;
  const ltcg = Math.max(0, (input.longTermGains ?? 0) - (input.qsbsGain ?? 0) * (input.qsbsExclusion ?? 1));
  const qualDiv = input.qualifiedDividends ?? 0;
  const ordDiv = Math.max(0, (input.ordinaryDividends ?? 0) - qualDiv);

  // AGI
  const grossIncome = input.w2Income + nsoIncome + rsuIncome + stcg + ltcg + ordDiv + qualDiv;
  const aboveLineDeductions = (input.traditionalIraContrib ?? 0) + (input.k401Contrib ?? 0);
  const agi = Math.max(0, grossIncome - aboveLineDeductions);

  // Taxable income
  const deduction = Math.max(stdDed, input.itemizedDeductions ?? 0);
  const taxableIncome = Math.max(0, agi - deduction);

  // Regular tax: ordinary income brackets + LTCG preferred rates
  const ordinaryTaxable = Math.max(0, taxableIncome - ltcg - qualDiv);
  const regularOrdinary = applyBrackets(ordinaryTaxable, brackets);
  const ltcgTax = computeLtcgTax(ltcg, qualDiv, ordinaryTaxable, input.filingStatus);
  const regularTax = regularOrdinary + ltcgTax;

  // State tax (for AMT add-back)
  const stateTax = computeStateTax(agi, ltcg, input.stateCode ?? "");

  // AMT
  const itemized = input.itemizedDeductions ?? 0;
  const { tentative: amtTentative } = computeAmt(
    taxableIncome, isoSpread, itemized, stateTax, input.filingStatus
  );
  const amtOwed = Math.max(0, amtTentative - regularTax);
  const amtTriggered = amtOwed > 0;

  // NIIT
  const netInvestmentIncome = ltcg + qualDiv + ordDiv + stcg;
  const niit = computeNiit(agi, netInvestmentIncome, input.filingStatus);

  // Additional Medicare surtax (0.9% on wages > threshold)
  const medThreshold = isMfj
    ? IRS_2026.add_medicare_threshold_mfj
    : IRS_2026.add_medicare_threshold_single;
  const additionalMedicare = Math.max(0, input.w2Income - medThreshold) * IRS_2026.add_medicare_rate;

  const totalFederal = regularTax + amtOwed + niit + additionalMedicare;
  const totalTax = totalFederal + stateTax;

  // Schedule D
  const scheduleD = {
    netShortTerm: stcg,
    netLongTerm: ltcg,
    carryForward: Math.max(0, -(stcg + ltcg)),
  };

  // Quarterly estimates
  const priorYearTax = input.priorYearTax ?? totalTax;
  const w2Withholding = input.w2Withholding ?? (input.w2Income * 0.22);
  const { quarterlyEstimates } = computeQuarterlyEstimates({
    annualTax: totalTax,
    priorYearTax,
    w2Withholding,
    priorYearAgi: agi,
  });

  // Recommendations
  const recs: string[] = [];
  const marginal = getMarginalRate(ordinaryTaxable, brackets);

  if (amtTriggered) {
    recs.push(`AMT triggered ($${Math.round(amtOwed).toLocaleString()} owed). Consider deferring ISO exercises to next year.`);
  }
  if (niit > 0) {
    recs.push(`NIIT of $${Math.round(niit).toLocaleString()} (§1411) applies — consider tax-exempt municipal bonds to reduce net investment income.`);
  }
  if (ltcg > 0 && marginal >= 0.32) {
    recs.push(`LTCG taxed at 20% + 3.8% NIIT = 23.8% effective rate. Harvest losses on short-term positions to offset.`);
  }
  if (agi > IRS_2026.roth_phaseout_upper_single && !isMfj) {
    recs.push("Roth IRA direct contribution phased out — use backdoor Roth (non-deductible Traditional IRA → convert).");
  }
  if (marginal <= 0.22) {
    const headroom = Math.max(0, (isMfj ? 206700 : 103350) - taxableIncome);
    if (headroom > 5000) {
      recs.push(`$${Math.round(headroom).toLocaleString()} of 22% bracket headroom — consider Roth conversion to fill bracket.`);
    }
  }

  return {
    regularTax: Math.round(regularTax),
    amtTentative: Math.round(amtTentative),
    amtOwed: Math.round(amtOwed),
    amtTriggered,
    niit: Math.round(niit),
    additionalMedicare: Math.round(additionalMedicare),
    totalFederal: Math.round(totalFederal),
    stateTax: Math.round(stateTax),
    totalTax: Math.round(totalTax),
    effectiveRate: grossIncome > 0 ? totalTax / grossIncome : 0,
    marginalRate: marginal,
    taxableIncome: Math.round(taxableIncome),
    agi: Math.round(agi),
    quarterlyEstimates,
    recommendations: recs,
    scheduleD,
  };
}
