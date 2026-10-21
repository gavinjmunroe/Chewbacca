import { MonthlyAllocation } from "@/lib/types";
import { fmt$ } from "@/lib/format";

interface Props {
  allocation: MonthlyAllocation;
}

interface Row {
  label: string;
  monthly: number;
  annual: number;
  note?: string;
}

export default function ContributionPlan({ allocation: a }: Props) {
  const rows: Row[] = [
    { label: "401(k) Employee", monthly: a.pretax401k, annual: a.pretax401k * 12, note: "Pre-tax" },
    { label: "Employer Match", monthly: a.employerMatch, annual: a.employerMatch * 12, note: "Free money" },
    { label: "Mega Backdoor Roth", monthly: a.megaBackdoor, annual: a.megaBackdoor * 12, note: "After-tax → Roth" },
    { label: "Roth IRA", monthly: a.rothIRA, annual: a.rothIRA * 12, note: "Tax-free growth" },
    { label: "Brokerage", monthly: a.brokerage, annual: a.brokerage * 12, note: "Taxable" },
    { label: "HYSA", monthly: a.hysa, annual: a.hysa * 12, note: "Emergency fund" },
  ].filter((r) => r.monthly > 0);

  const totalMonthly = rows.reduce((s, r) => s + r.monthly, 0);
  const totalAnnual = totalMonthly * 12;

  return (
    <div className="glass" style={{ padding: "20px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h2 className="t-headline" style={{ color: "var(--label)" }}>Monthly Contributions</h2>
        <span className="t-footnote" style={{ color: "var(--label-3)" }}>Next month</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {rows.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "11px 0",
              borderBottom: i < rows.length - 1 ? "0.5px solid var(--separator)" : "none",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="t-subhead" style={{ color: "var(--label)" }}>{row.label}</p>
              {row.note && <p className="t-caption2" style={{ color: "var(--label-3)" }}>{row.note}</p>}
            </div>
            <div style={{ textAlign: "right" }}>
              <p className="t-subhead" style={{ color: "var(--label)", fontVariantNumeric: "tabular-nums" }}>{fmt$(row.monthly)}</p>
              <p className="t-caption2" style={{ color: "var(--label-3)", fontVariantNumeric: "tabular-nums" }}>{fmt$(row.annual)}/yr</p>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 14, paddingTop: 14,
        borderTop: "0.5px solid var(--separator)",
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
      }}>
        <span className="t-footnote" style={{ color: "var(--label-2)", fontWeight: 600 }}>Total invested</span>
        <div style={{ textAlign: "right" }}>
          <span className="t-headline" style={{ color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>{fmt$(totalMonthly)}/mo</span>
          <p className="t-caption2" style={{ color: "var(--label-3)" }}>{fmt$(totalAnnual)}/yr</p>
        </div>
      </div>
    </div>
  );
}
