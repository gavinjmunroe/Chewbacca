import { FinancialProfile, MonteCarloResult, SCENARIO_RETURNS, Scenario } from "./types";
import { calcMonthlyAllocation, calcSalaryForYear } from "./finance-engine";

function randn(): number {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
}

export function runMonteCarlo(profile: FinancialProfile, scenario: Scenario = "baseline", runs = 1000): MonteCarloResult {
  const { equity, vol } = SCENARIO_RETURNS[scenario];
  const years = Math.ceil(profile.retirementAge - profile.age);
  const meanLog = Math.log(1 + equity) - 0.5 * vol ** 2;
  // RSU uses a higher volatility (2× market vol) and its own return assumption
  const rsuVol = vol * 2;
  const rsuMeanLog = Math.log(1 + profile.returnRSU) - 0.5 * rsuVol ** 2;
  const yearTotals: number[][] = Array.from({ length: years }, () => []);

  for (let r = 0; r < runs; r++) {
    let b401k = profile.balance401k;
    let bMega = profile.balanceMegaBackdoor;
    let bRoth = profile.balanceRothIRA;
    let bBrok = profile.balanceBrokerage;
    let bHYSA = profile.balanceHYSA;
    let bRSU = profile.rsuValue;
    let infl = 1;

    for (let y = 0; y < years; y++) {
      const salary = calcSalaryForYear(profile, y);
      const alloc = calcMonthlyAllocation({ ...profile, baseSalary: salary, balanceHYSA: bHYSA });
      const ret = Math.exp(meanLog + vol * randn()) - 1;
      const retRSU = Math.exp(rsuMeanLog + rsuVol * randn()) - 1;
      infl *= 1 + profile.inflation;

      b401k = b401k * (1 + ret) + (alloc.pretax401k + alloc.employerMatch) * 12;
      bMega = bMega * (1 + ret) + alloc.megaBackdoor * 12;
      bRoth = bRoth * (1 + ret) + alloc.rothIRA * 12;
      bBrok = bBrok * (1 + ret - profile.brokerageTaxDrag) + alloc.brokerage * 12;
      bHYSA = bHYSA * (1 + profile.returnHYSA) + alloc.hysa * 12;
      bRSU = bRSU * (1 + retRSU);

      yearTotals[y].push((b401k + bMega + bRoth + bBrok + bHYSA + bRSU) / infl);
    }
  }

  yearTotals.forEach((a) => a.sort((x, y) => x - y));
  const yearData = yearTotals.map((arr, i) => ({
    year: new Date().getFullYear() + i + 1,
    p10: pct(arr, 0.1), p25: pct(arr, 0.25), p50: pct(arr, 0.5), p75: pct(arr, 0.75), p90: pct(arr, 0.9),
  }));

  const fin = yearTotals[yearTotals.length - 1];
  return { p10: pct(fin, 0.1), p25: pct(fin, 0.25), p50: pct(fin, 0.5), p75: pct(fin, 0.75), p90: pct(fin, 0.9), runs, yearData };
}
