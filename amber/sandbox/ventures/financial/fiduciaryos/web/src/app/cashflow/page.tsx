"use client";

import { useState } from "react";
import Nav from "@/components/nav";
import { DEFAULT_PROFILE } from "@/lib/types";
import { calcMonthlyAllocation } from "@/lib/finance-engine";
import { fmt$, fmtPct } from "@/lib/format";
import { calcFederalTax, calcCATax, calcPayrollTaxes } from "@/lib/tax-engine";
import { TAX_LIMITS_2026 } from "@/lib/types";

interface Row { label: string; value: number; note?: string; color?: string; indent?: boolean }

function Line({ row, last }: { row: Row; last?: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center",
      padding: "11px 0",
      borderBottom: last ? "none" : "0.5px solid var(--separator)",
    }}>
      <p
        className="t-subhead"
        style={{
          flex: 1,
          color: row.color ?? "var(--label-2)",
          paddingLeft: row.indent ? 16 : 0,
        }}
      >
        {row.label}
        {row.note && (
          <span className="t-caption2" style={{ color: "var(--label-3)", marginLeft: 6 }}>{row.note}</span>
        )}
      </p>
      <p
        className="t-subhead"
        style={{
          color: row.value < 0 ? "var(--red)" : row.color ?? "var(--label)",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 500,
        }}
      >
        {row.value < 0 ? `(${fmt$(Math.abs(row.value))})` : fmt$(row.value)}
      </p>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="glass" style={{ padding: "20px 20px", marginBottom: 12 }}>
      <p className="t-caption1" style={{ color: "var(--label-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>{title}</p>
      {rows.map((r, i) => <Line key={r.label} row={r} last={i === rows.length - 1} />)}
    </div>
  );
}

function loadProfile() {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try { const s = localStorage.getItem("fiduciary_profile"); return s ? JSON.parse(s) : DEFAULT_PROFILE; } catch { return DEFAULT_PROFILE; }
}

export default function CashflowPage() {
  const [profile] = useState(loadProfile);
  const a = calcMonthlyAllocation(profile);
  const L = TAX_LIMITS_2026;
  const annualPretaxFed = L.employee401kLimit + profile.healthPremium * 12 + profile.hsaMonthly * 12;
  const annualPretaxCA = L.employee401kLimit + profile.healthPremium * 12;
  const fed = calcFederalTax(profile.baseSalary, annualPretaxFed);
  const ca = calcCATax(profile.baseSalary, annualPretaxCA);
  const pr = calcPayrollTaxes(profile.baseSalary);

  const effectiveTotal = (fed.tax + ca.tax + pr.total) / profile.baseSalary;

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "68px 24px 40px", background: "var(--bg)", minHeight: "100dvh" }}>

        <div className="fade-up" style={{ marginBottom: 28 }}>
          <h1 className="t-large-title" style={{ color: "var(--label)" }}>Cash Flow</h1>
          <p className="t-subhead" style={{ color: "var(--label-3)", marginTop: 4 }}>Monthly statement · based on ${(profile.baseSalary / 1000).toFixed(0)}K base salary</p>
        </div>

        <div className="glass fade-up delay-1" style={{ padding: "18px 20px", marginBottom: 16, display: "flex", gap: 32, flexWrap: "wrap" }}>
          {[
            { label: "Gross Monthly", val: fmt$(a.gross) },
            { label: "Total Tax Rate", val: fmtPct(effectiveTotal) },
            { label: "Investable Cash", val: fmt$(a.investableCash) },
            { label: "Take-Home", val: fmt$(a.netTakeHome) },
          ].map((s) => (
            <div key={s.label}>
              <p className="t-caption2" style={{ color: "var(--label-3)" }}>{s.label}</p>
              <p className="t-title3" style={{ color: "var(--label)", fontVariantNumeric: "tabular-nums" }}>{s.val}</p>
            </div>
          ))}
        </div>

        <div className="fade-up delay-2">
          <Section title="Income" rows={[
            { label: "Base Salary", value: a.gross, color: "var(--label)" },
          ]} />

          <Section title="Pre-Tax Deductions" rows={[
            { label: "401(k) Employee Contribution", value: -a.pretax401k, note: "Reduces taxable income", indent: true },
            { label: "Health Insurance Premium", value: -a.healthPremium, indent: true },
            { label: "HSA Contribution", value: -a.hsaMonthly, indent: true },
          ].filter((r) => r.value !== 0)} />

          <Section title="Taxes" rows={[
            { label: "Federal Income Tax", value: -a.federalTax, note: `${fmtPct(fed.effectiveRate)} eff. · ${fmtPct(fed.marginal)} marginal`, indent: true },
            { label: "California State Tax", value: -a.caTax, note: `${fmtPct(ca.effectiveRate)} eff.`, indent: true },
            { label: "Social Security (6.2%)", value: -a.ssTax, indent: true },
            { label: "Medicare (1.45% + 0.9%)", value: -a.medicareTax, indent: true },
            { label: "California SDI (1.1%)", value: -a.caSDI, indent: true },
          ]} />

          <Section title="Living Expenses" rows={[
            { label: "Rent", value: -profile.rent, indent: true },
            { label: "Utilities", value: -profile.utilities, indent: true },
            { label: "Other Expenses", value: -profile.otherExpenses, indent: true },
          ]} />

          <Section title="Investments" rows={[
            { label: "Mega Backdoor Roth", value: -a.megaBackdoor, note: "After-tax → Roth 401k", indent: true },
            { label: "Roth IRA", value: -a.rothIRA, indent: true },
            { label: "Brokerage", value: -a.brokerage, indent: true },
            { label: "HYSA", value: -a.hysa, indent: true },
          ].filter((r) => r.value !== 0)} />

          <div className="glass" style={{ padding: "18px 20px", border: "1px solid rgba(48,209,88,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p className="t-headline" style={{ color: "var(--label)" }}>Remaining Cash</p>
                <p className="t-footnote" style={{ color: "var(--label-3)" }}>After all allocations · should be near $0</p>
              </div>
              <p className="t-title3" style={{ color: Math.abs(a.investableCash - a.megaBackdoor - a.rothIRA - a.brokerage - a.hysa) < 5 ? "var(--green)" : "var(--orange)", fontVariantNumeric: "tabular-nums" }}>
                {fmt$(Math.max(0, a.investableCash - a.megaBackdoor - a.rothIRA - a.brokerage - a.hysa))}
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
