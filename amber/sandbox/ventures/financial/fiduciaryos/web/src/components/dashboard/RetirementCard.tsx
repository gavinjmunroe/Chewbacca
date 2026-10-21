import { RetirementSummary } from "@/lib/types";
import { fmt$, fmtCompact } from "@/lib/format";

interface Props {
  summary: RetirementSummary;
  retirementAge: number;
}

export default function RetirementCard({ summary: s, retirementAge }: Props) {
  const rows = [
    { label: "401(k)", value: s.by401k, note: `−${fmt$(s.taxDue401k)} est. tax` },
    { label: "Mega Backdoor Roth", value: s.byMegaBackdoor, note: "Tax-free" },
    { label: "Roth IRA", value: s.byRothIRA, note: "Tax-free" },
    { label: "Brokerage", value: s.byBrokerage, note: `−${fmt$(s.taxDueBrokerage)} est. LTCG` },
    { label: "HYSA", value: s.byHYSA, note: "Liquid" },
    { label: "RSU (hold)", value: s.byRSU, note: "Mark-to-market" },
  ].filter((r) => r.value > 0);

  return (
    <div className="glass" style={{ padding: "20px 20px" }}>
      <p className="t-caption1" style={{ color: "var(--label-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>
        At age {retirementAge}
      </p>

      <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: "0.5px solid var(--separator)" }}>
        <p className="t-footnote" style={{ color: "var(--label-3)", marginBottom: 4 }}>Safe withdrawal · 4% rule</p>
        <p style={{ fontSize: 28, fontWeight: 700, color: "var(--label)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
          {fmt$(s.safeWithdrawalMonthly)}<span className="t-footnote" style={{ color: "var(--label-3)", fontWeight: 400 }}>/mo</span>
        </p>
        <p className="t-caption2" style={{ color: "var(--label-3)", marginTop: 4 }}>
          {fmtCompact(s.safeWithdrawalAnnual)}/yr · after estimated taxes
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {rows.map((r, i) => (
          <div
            key={r.label}
            style={{
              display: "flex", alignItems: "center",
              padding: "9px 0",
              borderBottom: i < rows.length - 1 ? "0.5px solid var(--separator)" : "none",
            }}
          >
            <div style={{ flex: 1 }}>
              <p className="t-footnote" style={{ color: "var(--label-2)" }}>{r.label}</p>
              <p className="t-caption2" style={{ color: "var(--label-3)" }}>{r.note}</p>
            </div>
            <p className="t-footnote" style={{ color: "var(--label)", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
              {fmtCompact(r.value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
