import type { ReactNode } from "react";
import { fmt$ } from "@/lib/format";

interface Props {
  label: string;
  balance: number;
  type: "tax-free" | "tax-deferred" | "taxable" | "cash";
  icon: ReactNode;
}

const TYPE_LABELS: Record<Props["type"], string> = {
  "tax-free": "Tax-free",
  "tax-deferred": "Tax-deferred",
  "taxable": "Taxable",
  "cash": "Cash",
};

export default function AccountCard({ label, balance, type, icon }: Props) {
  return (
    <div
      className="glass"
      style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: "var(--surface-2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--label-2)",
        }}>
          {icon}
        </div>
        <span className="t-caption1" style={{ color: "var(--label-3)", fontWeight: 500 }}>
          {TYPE_LABELS[type]}
        </span>
      </div>

      <div>
        <p className="t-footnote" style={{ color: "var(--label-3)", marginBottom: 2 }}>{label}</p>
        <p className="t-title3" style={{ color: "var(--label)", fontVariantNumeric: "tabular-nums" }}>
          {fmt$(balance)}
        </p>
      </div>
    </div>
  );
}
