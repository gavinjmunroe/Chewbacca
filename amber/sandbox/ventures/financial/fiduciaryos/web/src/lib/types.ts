export interface FinancialProfile {
  age: number;
  retirementAge: number;
  baseSalary: number;
  bonus: number;
  rsuValue: number;
  rent: number;
  utilities: number;
  otherExpenses: number;
  healthPremium: number;
  hsaMonthly: number;
  balance401k: number;
  balanceMegaBackdoor: number;
  balanceRothIRA: number;
  balanceBrokerage: number;
  balanceHYSA: number;
  returnHYSA: number;
  returnBrokerage: number;
  returnRetirement: number;
  returnRSU: number;
  inflation: number;
  brokerageTaxDrag: number;
  retirementMarginalRate: number;
  emergencyFundTarget: number;
  annualRaiseRate: number;
  promotionEveryYears: number;
  promotionBump: number;
  otherEmployerContribs: number;
}

export const DEFAULT_PROFILE: FinancialProfile = {
  age: 22,
  retirementAge: 59.5,
  baseSalary: 120000,
  bonus: 0,
  rsuValue: 0,
  rent: 2500,
  utilities: 150,
  otherExpenses: 800,
  healthPremium: 200,
  hsaMonthly: 0,
  balance401k: 0,
  balanceMegaBackdoor: 0,
  balanceRothIRA: 35000,
  balanceBrokerage: 60000,
  balanceHYSA: 5000,
  returnHYSA: 0.035,
  returnBrokerage: 0.10,
  returnRetirement: 0.10,
  returnRSU: 0.15,
  inflation: 0.03,
  brokerageTaxDrag: 0.015,
  retirementMarginalRate: 0.22,
  emergencyFundTarget: 30000,
  annualRaiseRate: 0.03,
  promotionEveryYears: 3,
  promotionBump: 0.10,
  otherEmployerContribs: 0,
};

// Sources: IRS Rev. Proc. 2025-22 (2026 limits), SSA COLA announcement, CA FTB Schedule X
export const TAX_LIMITS_2026 = {
  employee401kLimit: 23500,      // IRS 2026 elective deferral limit
  irsLimit415c: 70000,           // IRC 415(c) annual additions limit
  iraLimit: 7000,                // IRA contribution limit (under age 50)
  iraLimitCatchUp: 8000,         // IRA limit age 50+
  rothIraPhaseOutLower: 150000,  // Roth IRA phase-out start (single, 2026)
  rothIraPhaseOutUpper: 165000,  // Roth IRA phase-out end (single, 2026)
  ssWageBase: 176100,            // Social Security wage base 2026
  additionalMedicareThreshold: 200000,
  federalStandardDeduction: 15750,  // Est. 2026 (inflation-adjusted from $15,000)
  caStandardDeduction: 5706,        // CA FTB Schedule X, single
};

export interface MonthlyAllocation {
  gross: number;
  pretax401k: number;
  employerMatch: number;
  megaBackdoor: number;
  rothIRA: number;
  brokerage: number;
  hysa: number;
  federalTax: number;
  caTax: number;
  ssTax: number;
  medicareTax: number;
  caSDI: number;
  healthPremium: number;
  hsaMonthly: number;
  expenses: number;
  netTakeHome: number;
  investableCash: number;
}

export interface ProjectionYear {
  year: number;
  age: number;
  salary: number;
  balance401k: number;
  balanceMegaBackdoor: number;
  balanceRothIRA: number;
  balanceBrokerage: number;
  balanceHYSA: number;
  balanceRSU: number;
  totalNominal: number;
  totalReal: number;
  contrib401k: number;
  contribMegaBackdoor: number;
  contribRothIRA: number;
  contribBrokerage: number;
  contribHYSA: number;
}

export interface RetirementSummary {
  totalNominal: number;
  totalReal: number;
  by401k: number;
  byMegaBackdoor: number;
  byRothIRA: number;
  byBrokerage: number;
  byHYSA: number;
  byRSU: number;
  taxDue401k: number;
  taxDueBrokerage: number;
  afterTaxTotal: number;
  safeWithdrawalAnnual: number;
  safeWithdrawalMonthly: number;
}

export interface MonteCarloResult {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  runs: number;
  yearData: { year: number; p10: number; p25: number; p50: number; p75: number; p90: number }[];
}

export type Scenario = "conservative" | "baseline" | "aggressive";
export type ProjectionMode = "deterministic" | "monte_carlo";

export const SCENARIO_RETURNS: Record<Scenario, { equity: number; vol: number }> = {
  conservative: { equity: 0.06, vol: 0.12 },
  baseline: { equity: 0.10, vol: 0.15 },
  aggressive: { equity: 0.14, vol: 0.20 },
};

export interface AppAlert {
  type: "approaching_limit" | "limit_change" | "balance_drop";
  severity: "info" | "warning" | "critical";
  message: string;
}
