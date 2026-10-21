import { TaxHarvestCandidate } from "@/lib/unified-types";
import { fmt$ } from "@/lib/format";

interface Props {
  candidates: TaxHarvestCandidate[];
  offline?: boolean;
}

export default function TaxHarvestOpportunities({ candidates, offline }: Props) {
  const totalSavings = candidates.reduce((s, c) => s + c.tax_savings_estimate_usd, 0);

  return (
    <div className="glass" style={{ padding: "20px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 className="t-headline" style={{ color: "var(--label)" }}>Tax Harvest Opportunities</h2>
        {!offline && candidates.length > 0 && (
          <span className="t-footnote" style={{ color: "var(--green)" }}>
            {fmt$(totalSavings)} potential savings
          </span>
        )}
      </div>

      {offline ? (
        <p className="t-footnote" style={{ color: "var(--label-3)" }}>Python backend offline. Start the server to enable TLH detection.</p>
      ) : candidates.length === 0 ? (
        <p className="t-footnote" style={{ color: "var(--label-3)" }}>No harvest opportunities detected. All positions are above cost basis or wash-sale windows are active.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {candidates.map((c, i) => (
            <div
              key={c.ticker}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "11px 0",
                borderBottom: i < candidates.length - 1 ? "0.5px solid var(--separator)" : "none",
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: "var(--surface-2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <span className="t-caption1" style={{ color: "var(--label-2)", fontFamily: "monospace", fontWeight: 600 }}>
                  {c.ticker.slice(0, 3)}
                </span>
              </div>
              <div style={{ flex: 1 }}>
                <p className="t-subhead" style={{ color: "var(--label)" }}>{c.ticker}</p>
                <p className="t-caption2" style={{ color: "var(--label-3)" }}>
                  Replace with: {c.replacement_tickers.join(", ") || "—"}
                  {" · "}
                  <span style={{ color: c.wash_sale_safe ? "var(--green)" : "var(--orange)" }}>
                    {c.wash_sale_safe ? "Wash-sale safe" : "Wash-sale risk"}
                  </span>
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p className="t-subhead" style={{ color: "var(--red)", fontVariantNumeric: "tabular-nums" }}>
                  ({fmt$(Math.abs(c.unrealized_loss_usd))})
                </p>
                <p className="t-caption2" style={{ color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>
                  +{fmt$(c.tax_savings_estimate_usd)} saved
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
