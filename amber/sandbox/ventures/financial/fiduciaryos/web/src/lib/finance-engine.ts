import { FinancialProfile, MonthlyAllocation, ProjectionYear, RetirementSummary, TAX_LIMITS_2026, AppAlert } from "./types";
import { calcFederalTax, calcCATax, calcPayrollTaxes, calcMAGI, calcRothIRAAllowed } from "./tax-engine";

export function calcEmployerMatch(employeeAnnual: number, limit = TAX_LIMITS_2026.employee401kLimit) {
  // 100% match up to 50% of the annual employee deferral limit
  return Math.min(employeeAnnual, 0.5 * limit);
}

export function calcMegaBackdoorMax(employeeAnnual: number, matchAnnual: number, other = 0) {
  return Math.max(0, TAX_LIMITS_2026.irsLimit415c - employeeAnnual - matchAnnual - other);
}

// Correct monthly rate from annual: (1+r)^(1/12) - 1
function monthlyRate(annualRate: number): number {
  return Math.pow(1 + annualRate, 1 / 12) - 1;
}

export function calcMonthlyAllocation(profile: FinancialProfile): MonthlyAllocation {
  const L = TAX_LIMITS_2026;

  const annual401k = L.employee401kLimit;
  const monthly401k = annual401k / 12;
  const annualMatch = calcEmployerMatch(annual401k);
  const monthlyMatch = annualMatch / 12;

  // Federal: 401k + health + HSA all reduce taxable income
  const annualPretaxFed = annual401k + profile.healthPremium * 12 + profile.hsaMonthly * 12;
  // CA: HSA is NOT deductible in California
  const annualPretaxCA = annual401k + profile.healthPremium * 12;

  const fed = calcFederalTax(profile.baseSalary, annualPretaxFed);
  const ca = calcCATax(profile.baseSalary, annualPretaxCA);
  const payroll = calcPayrollTaxes(profile.baseSalary);

  const gross = profile.baseSalary / 12;
  const netTakeHome =
    gross -
    monthly401k -
    profile.healthPremium -
    profile.hsaMonthly -
    fed.tax / 12 -
    ca.tax / 12 -
    payroll.ss / 12 -
    (payroll.medicare + payroll.addlMedicare) / 12 -
    payroll.caSDI / 12;

  const expenses = profile.rent + profile.utilities + profile.otherExpenses;
  const investableCash = Math.max(0, netTakeHome - expenses);
  let remaining = investableCash;

  const megaMax = calcMegaBackdoorMax(annual401k, annualMatch, profile.otherEmployerContribs) / 12;
  const megaBackdoor = Math.min(remaining, megaMax);
  remaining -= megaBackdoor;

  const magi = calcMAGI(profile.baseSalary, annual401k);
  const rothIRAMax = calcRothIRAAllowed(magi, L.iraLimit) / 12;
  const rothIRA = Math.min(remaining, rothIRAMax);
  remaining -= rothIRA;

  let hysa = 0;
  if (profile.balanceHYSA < profile.emergencyFundTarget) {
    hysa = Math.min(remaining * 0.2, (profile.emergencyFundTarget - profile.balanceHYSA) / 12);
    remaining -= hysa;
  }

  const brokerage = remaining;

  return {
    gross,
    pretax401k: monthly401k,
    employerMatch: monthlyMatch,
    megaBackdoor,
    rothIRA,
    brokerage,
    hysa,
    federalTax: fed.tax / 12,
    caTax: ca.tax / 12,
    ssTax: payroll.ss / 12,
    medicareTax: (payroll.medicare + payroll.addlMedicare) / 12,
    caSDI: payroll.caSDI / 12,
    healthPremium: profile.healthPremium,
    hsaMonthly: profile.hsaMonthly,
    expenses,
    netTakeHome,
    investableCash,
  };
}

export function calcSalaryForYear(p: FinancialProfile, yearsFromNow: number): number {
  let salary = p.baseSalary;
  for (let y = 1; y <= yearsFromNow; y++) {
    salary *= 1 + p.annualRaiseRate;
    if (y % p.promotionEveryYears === 0) salary *= 1 + p.promotionBump;
  }
  return salary;
}

export function runDeterministicProjection(profile: FinancialProfile): ProjectionYear[] {
  const years: ProjectionYear[] = [];
  const yearsToRetirement = Math.ceil(profile.retirementAge - profile.age);
  if (yearsToRetirement <= 0) return years;

  let b401k = profile.balance401k;
  let bMega = profile.balanceMegaBackdoor;
  let bRoth = profile.balanceRothIRA;
  let bBrok = profile.balanceBrokerage;
  let bHYSA = profile.balanceHYSA;
  let bRSU = profile.rsuValue;
  let inflFactor = 1;

  const rHYSA = monthlyRate(profile.returnHYSA);
  const rBrok = monthlyRate(profile.returnBrokerage - profile.brokerageTaxDrag);
  const rRet = monthlyRate(profile.returnRetirement);
  const rRSU = monthlyRate(profile.returnRSU);

  let currentSalary = profile.baseSalary;

  for (let y = 0; y < yearsToRetirement; y++) {
    if (y > 0) {
      currentSalary *= 1 + profile.annualRaiseRate;
      if (y % profile.promotionEveryYears === 0) currentSalary *= 1 + profile.promotionBump;
    }
    const alloc = calcMonthlyAllocation({ ...profile, baseSalary: currentSalary, balanceHYSA: bHYSA });
    inflFactor *= 1 + profile.inflation;

    for (let m = 0; m < 12; m++) {
      b401k = b401k * (1 + rRet) + alloc.pretax401k + alloc.employerMatch;
      bMega = bMega * (1 + rRet) + alloc.megaBackdoor;
      bRoth = bRoth * (1 + rRet) + alloc.rothIRA;
      bBrok = bBrok * (1 + rBrok) + alloc.brokerage;
      bHYSA = bHYSA * (1 + rHYSA) + alloc.hysa;
      bRSU = bRSU * (1 + rRSU);
    }

    const totalNominal = b401k + bMega + bRoth + bBrok + bHYSA + bRSU;
    years.push({
      year: new Date().getFullYear() + y + 1,
      age: profile.age + y + 1,
      salary: currentSalary,
      balance401k: b401k,
      balanceMegaBackdoor: bMega,
      balanceRothIRA: bRoth,
      balanceBrokerage: bBrok,
      balanceHYSA: bHYSA,
      balanceRSU: bRSU,
      totalNominal,
      totalReal: totalNominal / inflFactor,
      contrib401k: (alloc.pretax401k + alloc.employerMatch) * 12,
      contribMegaBackdoor: alloc.megaBackdoor * 12,
      contribRothIRA: alloc.rothIRA * 12,
      contribBrokerage: alloc.brokerage * 12,
      contribHYSA: alloc.hysa * 12,
    });
  }
  return years;
}

export function calcRetirementSummary(years: ProjectionYear[], marginalRate = 0.22): RetirementSummary {
  if (!years.length) {
    return { totalNominal: 0, totalReal: 0, by401k: 0, byMegaBackdoor: 0, byRothIRA: 0, byBrokerage: 0, byHYSA: 0, byRSU: 0, taxDue401k: 0, taxDueBrokerage: 0, afterTaxTotal: 0, safeWithdrawalAnnual: 0, safeWithdrawalMonthly: 0 };
  }
  const last = years[years.length - 1];
  const taxDue401k = last.balance401k * marginalRate;
  const taxDueBrokerage = last.balanceBrokerage * 0.5 * 0.15; // 50% basis assumption, 15% LTCG
  const afterTaxTotal =
    (last.balance401k - taxDue401k) +
    last.balanceMegaBackdoor +
    last.balanceRothIRA +
    (last.balanceBrokerage - taxDueBrokerage) +
    last.balanceHYSA +
    last.balanceRSU;
  const safeWithdrawalAnnual = afterTaxTotal * 0.04;
  return {
    totalNominal: last.totalNominal,
    totalReal: last.totalReal,
    by401k: last.balance401k,
    byMegaBackdoor: last.balanceMegaBackdoor,
    byRothIRA: last.balanceRothIRA,
    byBrokerage: last.balanceBrokerage,
    byHYSA: last.balanceHYSA,
    byRSU: last.balanceRSU,
    taxDue401k,
    taxDueBrokerage,
    afterTaxTotal,
    safeWithdrawalAnnual,
    safeWithdrawalMonthly: safeWithdrawalAnnual / 12,
  };
}

export function generateAlerts(profile: FinancialProfile, alloc: MonthlyAllocation): AppAlert[] {
  const alerts: AppAlert[] = [];
  const L = TAX_LIMITS_2026;
  const actual401kAnnual = alloc.pretax401k * 12;
  const magi = calcMAGI(profile.baseSalary, actual401kAnnual);

  if (actual401kAnnual >= L.employee401kLimit * 0.95)
    alerts.push({ type: "approaching_limit", severity: "info", message: `On track to max your 401(k) at $${L.employee401kLimit.toLocaleString()} this year.` });

  if (magi >= L.rothIraPhaseOutLower * 0.95 && magi < L.rothIraPhaseOutUpper)
    alerts.push({ type: "approaching_limit", severity: "warning", message: `Your MAGI ($${Math.round(magi).toLocaleString()}) is approaching the Roth IRA phase-out range ($${L.rothIraPhaseOutLower.toLocaleString()}–$${L.rothIraPhaseOutUpper.toLocaleString()}).` });

  if (alloc.investableCash < 500)
    alerts.push({ type: "balance_drop", severity: "critical", message: `Only $${Math.round(alloc.investableCash).toLocaleString()} investable cash per month. Review your expenses.` });

  return alerts;
}
