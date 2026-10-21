"use client";

import { useState, useEffect } from "react";
import Nav from "@/components/nav";
import { computeFullTaxProjection, computeEquityCompTax, computeRothConversionLadder } from "@/lib/tax-engine-v2";
import type { TaxInput, TaxResult, EquityCompResult } from "@/lib/tax-engine-v2";

const CARD: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "1.5rem",
};

const BADGE = (color: string): React.CSSProperties => ({
  display: "inline-block",
  background: color + "22",
  color,
  borderRadius: 6,
  padding: "2px 10px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.3,
});

function fmt$(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(n: number) {
  return (n * 100).toFixed(1) + "%";
}

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--text-2)", fontSize: 14 }}>{label}</span>
      <span style={{ fontWeight: 600, color: highlight ? "var(--accent)" : "var(--text-1)", fontSize: 15 }}>{value}</span>
    </div>
  );
}

function QuarterCard({ label, dueDate, amount }: { label: string; dueDate: string; amount: number }) {
  return (
    <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "1rem", textAlign: "center" }}>
      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>{fmt$(amount)}</div>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Due {dueDate}</div>
    </div>
  );
}

export default function TaxPage() {
  const [profile, setProfile] = useState<TaxInput>({
    filingStatus: "single",
    w2Income: 200000,
    isoSpread: 50000,
    nsoW2Income: 0,
    rsuShares: 100,
    rsuFmv: 150,
    shortTermGains: 5000,
    longTermGains: 30000,
    qualifiedDividends: 3000,
    ordinaryDividends: 3500,
    itemizedDeductions: 0,
    traditionalIraContrib: 0,
    k401Contrib: 23500,
    stateCode: "CA",
    priorYearTax: 80000,
    w2Withholding: 50000,
  });

  const [result, setResult] = useState<TaxResult | null>(null);
  const [equityResult, setEquityResult] = useState<EquityCompResult | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "equity" | "roth" | "quarterly">("overview");

  useEffect(() => {
    const r = computeFullTaxProjection(profile);
    setResult(r);
    const eq = computeEquityCompTax({
      filingStatus: profile.filingStatus,
      baseW2: profile.w2Income,
      isoExercises: profile.isoSpread ? [{ shares: 1000, strike: 10, fmv: 10 + profile.isoSpread / 1000 }] : [],
      rsuVesting: profile.rsuShares && profile.rsuFmv ? [{ shares: profile.rsuShares, fmvAtVest: profile.rsuFmv }] : [],
      stateCode: profile.stateCode,
    });
    setEquityResult(eq);
  }, [profile]);

  const rothLadder = computeRothConversionLadder({
    filingStatus: profile.filingStatus,
    currentTaxableIncome: result?.taxableIncome ?? 0,
    tradIraBalance: 300000,
    yearsToRetirement: 25,
  });

  const tabs = ["overview", "equity", "roth", "quarterly"] as const;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <Nav />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem" }}>
        {/* Header */}
        <div style={{ marginBottom: "2rem" }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Tax Planning</h1>
          <p style={{ color: "var(--text-2)", marginTop: 6, fontSize: 15 }}>
            CPA-grade AMT, NIIT, equity compensation & retirement tax analysis — powered by FiduciaryOS v2.
          </p>
        </div>

        {result && (
          <>
            {/* Alert Banner */}
            {result.amtTriggered && (
              <div style={{ background: "#ef444420", border: "1px solid #ef4444", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.5rem", fontSize: 14, color: "#ef4444" }}>
                ⚠ AMT triggered — {fmt$(result.amtOwed)} Alternative Minimum Tax owed above regular tax. Review ISO exercise timing.
              </div>
            )}

            {/* Summary Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
              {[
                { label: "Total Federal", value: fmt$(result.totalFederal), color: "#ef4444" },
                { label: "State Tax", value: fmt$(result.stateTax), color: "#f97316" },
                { label: "Total Tax", value: fmt$(result.totalTax), color: "#dc2626" },
                { label: "Effective Rate", value: fmtPct(result.effectiveRate), color: "#6366f1" },
                { label: "Marginal Rate", value: fmtPct(result.marginalRate), color: "#8b5cf6" },
                { label: "NIIT", value: fmt$(result.niit), color: "#ec4899" },
              ].map((c) => (
                <div key={c.label} style={{ ...CARD, textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 6 }}>{c.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: c.color }}>{c.value}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 8, marginBottom: "1.5rem" }}>
              {tabs.map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: activeTab === t ? "var(--accent)" : "var(--surface-1)",
                    color: activeTab === t ? "#000" : "var(--text-1)",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontSize: 13,
                    textTransform: "capitalize",
                  }}
                >
                  {t === "roth" ? "Roth Ladder" : t}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            {activeTab === "overview" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
                <div style={CARD}>
                  <h3 style={{ marginTop: 0, marginBottom: "1rem", fontSize: 16 }}>Tax Breakdown</h3>
                  <StatRow label="AGI" value={fmt$(result.agi)} />
                  <StatRow label="Taxable Income" value={fmt$(result.taxableIncome)} />
                  <StatRow label="Regular Tax" value={fmt$(result.regularTax)} />
                  {result.amtTriggered && <StatRow label="AMT" value={fmt$(result.amtOwed)} highlight />}
                  {result.niit > 0 && <StatRow label="NIIT (§1411)" value={fmt$(result.niit)} highlight />}
                  {result.additionalMedicare > 0 && <StatRow label="Add'l Medicare (0.9%)" value={fmt$(result.additionalMedicare)} />}
                  <StatRow label="State Tax ({profile.stateCode})" value={fmt$(result.stateTax)} />
                  <StatRow label="Total Tax" value={fmt$(result.totalTax)} highlight />
                </div>

                <div style={CARD}>
                  <h3 style={{ marginTop: 0, marginBottom: "1rem", fontSize: 16 }}>Schedule D</h3>
                  <StatRow label="Short-Term Gains" value={fmt$(result.scheduleD.netShortTerm)} />
                  <StatRow label="Long-Term Gains" value={fmt$(result.scheduleD.netLongTerm)} />
                  {result.scheduleD.carryForward > 0 && (
                    <StatRow label="Loss Carry-Forward" value={fmt$(result.scheduleD.carryForward)} />
                  )}
                  <div style={{ marginTop: "1.5rem" }}>
                    <h4 style={{ margin: "0 0 0.75rem", fontSize: 14, color: "var(--text-2)" }}>Recommendations</h4>
                    {result.recommendations.map((r, i) => (
                      <div key={i} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)", fontSize: 13, color: "var(--text-1)", lineHeight: 1.5 }}>
                        → {r}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "equity" && equityResult && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
                <div style={CARD}>
                  <h3 style={{ marginTop: 0, marginBottom: "1rem", fontSize: 16 }}>Equity Compensation Summary</h3>
                  <StatRow label="ISO AMT Preference" value={fmt$(equityResult.isoAMTPreference)} highlight={equityResult.amtRisk} />
                  <StatRow label="NSO W-2 Income" value={fmt$(equityResult.nsoW2Income)} />
                  <StatRow label="RSU W-2 Income" value={fmt$(equityResult.rsuW2Income)} />
                  <StatRow label="ESPP Ordinary Income" value={fmt$(equityResult.esppOrdinaryIncome)} />
                  <StatRow label="ESPP LTCG" value={fmt$(equityResult.esppLTCG)} />
                  <StatRow label="Total Additional W-2" value={fmt$(equityResult.totalW2Addition)} />
                  <div style={{ marginTop: "1rem" }}>
                    <span style={BADGE(equityResult.amtRisk ? "#ef4444" : "#30d158")}>
                      {equityResult.amtRisk ? `AMT Risk: ${fmt$(equityResult.amtEstimate)}` : "No AMT Risk"}
                    </span>
                  </div>
                </div>

                <div style={CARD}>
                  <h3 style={{ marginTop: 0, marginBottom: "1rem", fontSize: 16 }}>Equity Tax Guidance</h3>
                  {equityResult.recommendations.map((r, i) => (
                    <div key={i} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)", fontSize: 13, lineHeight: 1.5 }}>
                      → {r}
                    </div>
                  ))}
                  <div style={{ marginTop: "1.5rem", background: "var(--surface-2)", borderRadius: 8, padding: "1rem", fontSize: 13 }}>
                    <strong>ISO Exercise Strategy:</strong> ISOs create AMT preference income — no regular tax at exercise, but the spread is added back for AMT purposes (Form 6251). Exercise ISOs up to the point where tentative minimum tax = regular tax to avoid triggering AMT.
                  </div>
                </div>
              </div>
            )}

            {activeTab === "roth" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
                <div style={CARD}>
                  <h3 style={{ marginTop: 0, marginBottom: "1rem", fontSize: 16 }}>Roth Conversion Ladder</h3>
                  <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 0 }}>
                    Annual conversions filling 22% bracket headroom. Total: {fmt$(rothLadder.totalConverted)} over {rothLadder.conversions.length} years.
                  </p>
                  <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    {rothLadder.conversions.slice(0, 10).map((c) => (
                      <div key={c.year} style={{ display: "flex", justifyContent: "space-between", padding: "0.4rem 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                        <span style={{ color: "var(--text-2)" }}>Year {c.year}</span>
                        <span style={{ fontWeight: 600 }}>{fmt$(c.amount)}</span>
                        <span style={{ color: "var(--text-3)", fontSize: 12 }}>@ {fmtPct(c.marginalRate)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={CARD}>
                  <h3 style={{ marginTop: 0, marginBottom: "1rem", fontSize: 16 }}>Backdoor Roth Pro-Rata Rule</h3>
                  <p style={{ fontSize: 13, color: "var(--text-2)", margin: "0 0 1rem" }}>
                    If you have pre-tax IRA balances, a Roth conversion is partially taxable even if you contributed non-deductible funds. The pro-rata rule treats all IRAs as one pool.
                  </p>
                  <div style={{ background: "var(--surface-2)", borderRadius: 8, padding: "1rem", fontSize: 13 }}>
                    <strong>Example:</strong> $90k pre-tax IRA + $10k non-deductible basis = 10% tax-free. Converting $10k → $9k taxable, $1k tax-free (not $0 taxable). Eliminate pre-tax IRA via reverse rollover to 401k to enable clean backdoor Roth.
                  </div>
                </div>
              </div>
            )}

            {activeTab === "quarterly" && (
              <div style={CARD}>
                <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: 16 }}>2026 Quarterly Estimated Payments</h3>
                <p style={{ fontSize: 13, color: "var(--text-2)", margin: "0 0 1.5rem" }}>
                  Safe harbor: 110% of prior year tax (AGI &gt; $150k). Payments cover tax not withheld from W-2.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
                  {result.quarterlyEstimates.map((q) => (
                    <QuarterCard key={q.label} {...q} />
                  ))}
                </div>
                <div style={{ marginTop: "1.5rem", background: "var(--surface-2)", borderRadius: 8, padding: "1rem", fontSize: 13, lineHeight: 1.6 }}>
                  <strong>Underpayment Penalty (Form 2210):</strong> Applies if you pay less than the safe harbor amount. The IRS charges the federal short-term rate + 3% on the underpaid amount for each day short. Avoid by ensuring quarterly payments cover 110% of prior year tax ({fmt$(Math.round((profile.priorYearTax ?? 0) * 1.1 / 4))}/quarter).
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
