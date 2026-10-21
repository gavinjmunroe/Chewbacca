interface Recommendation {
  action: string;
  ticker?: string;
  rationale: string;
  policy_check_passed: boolean;
  confidence?: number;
}

interface Props {
  recommendations: Recommendation[];
  offline?: boolean;
  modelVersion?: string;
}

export default function PortfolioAnalysisPanel({ recommendations, offline, modelVersion }: Props) {
  return (
    <div className="glass" style={{ padding: "20px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 className="t-headline" style={{ color: "var(--label)" }}>Portfolio Analysis</h2>
        <span className="t-footnote" style={{ color: "var(--label-3)" }}>
          {offline ? "Backend offline" : modelVersion ? `Model: ${modelVersion}` : "Fiduciary model"}
        </span>
      </div>

      {offline ? (
        <div style={{ padding: "16px", borderRadius: 12, background: "var(--surface-2)", textAlign: "center" }}>
          <p className="t-footnote" style={{ color: "var(--label-3)", marginBottom: 8 }}>Portfolio analysis requires the Python backend.</p>
          <p className="t-caption2" style={{ color: "var(--label-4)" }}>
            Start with: <code style={{ color: "var(--green)", fontFamily: "monospace" }}>uvicorn backend.main:app --port 8000</code>
          </p>
        </div>
      ) : recommendations.length === 0 ? (
        <p className="t-footnote" style={{ color: "var(--label-3)" }}>
          No recommendations at this time. Portfolio is within policy parameters.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {recommendations.map((rec, i) => (
            <div
              key={i}
              style={{
                padding: "14px 16px",
                borderRadius: 12,
                background: "var(--surface-2)",
                border: `1px solid ${rec.policy_check_passed ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.2)"}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span
                  className="t-caption1"
                  style={{
                    padding: "2px 8px", borderRadius: 6,
                    background: rec.policy_check_passed ? "rgba(48,209,88,0.12)" : "rgba(255,69,58,0.12)",
                    color: rec.policy_check_passed ? "var(--green)" : "var(--red)",
                    fontWeight: 600,
                  }}
                >
                  {rec.action}
                </span>
                {rec.ticker && (
                  <span className="t-caption1" style={{ color: "var(--label-2)", fontFamily: "monospace" }}>{rec.ticker}</span>
                )}
                {rec.confidence !== undefined && (
                  <span className="t-caption2" style={{ color: "var(--label-3)", marginLeft: "auto" }}>
                    {(rec.confidence * 100).toFixed(0)}% confidence
                  </span>
                )}
              </div>
              <p className="t-footnote" style={{ color: "var(--label-2)", lineHeight: 1.5 }}>{rec.rationale}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
