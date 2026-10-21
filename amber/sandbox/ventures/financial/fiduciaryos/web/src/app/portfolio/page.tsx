"use client";

import { useState } from "react";
import Nav from "@/components/nav";

interface Position {
  ticker: string;
  shares: string;
  value: string;
}

interface PortfolioAnalysis {
  offline?: boolean;
  risk_level?: number;
  risk_alerts?: string[];
  harvest_candidates?: string[];
  recommendations?: string[];
  allocation?: Array<{ ticker: string; value: number; percentage: number }>;
  riskScore?: number;
  suggestions?: string[];
  totalValue?: number;
}

function fmt$(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

const DEFAULT_POSITIONS: Position[] = [
  { ticker: "AAPL", shares: "50", value: "9200" },
  { ticker: "VTI", shares: "100", value: "24800" },
  { ticker: "BND", shares: "75", value: "6100" },
];

const BAR_COLORS = [
  "var(--blue)",
  "var(--green)",
  "#ff9f0a",
  "var(--red)",
  "#bf5af2",
  "#32ade6",
  "#ff6961",
];

export default function PortfolioPage() {
  const [positions, setPositions] = useState<Position[]>(DEFAULT_POSITIONS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [error, setError] = useState("");

  const cellStyle = {
    background: "var(--surface-1)",
    border: "0.5px solid var(--separator)",
    color: "var(--label)",
    padding: "8px 12px",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "var(--font)",
    outline: "none",
    width: "100%",
  };

  function updatePosition(index: number, field: keyof Position, val: string) {
    setPositions((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: val } : p)),
    );
  }

  function addPosition() {
    setPositions((prev) => [...prev, { ticker: "", shares: "", value: "" }]);
  }

  function removePosition(index: number) {
    setPositions((prev) => prev.filter((_, i) => i !== index));
  }

  const totalValue = positions.reduce(
    (sum, p) => sum + (parseFloat(p.value) || 0),
    0,
  );

  async function analyze() {
    const valid = positions.filter((p) => p.ticker && parseFloat(p.value) > 0);
    if (valid.length === 0) {
      setError("Add at least one position with a ticker and value.");
      return;
    }
    setError("");
    setIsAnalyzing(true);
    setAnalysis(null);

    try {
      const res = await fetch("/api/portfolio/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positions: valid.map((p) => ({
            ticker: p.ticker.toUpperCase(),
            shares: parseFloat(p.shares) || 0,
            value: parseFloat(p.value) || 0,
          })),
        }),
      });
      const data = (await res.json()) as PortfolioAnalysis;

      // Build local allocation from positions if API doesn't return it
      const allocation = valid.map((p) => ({
        ticker: p.ticker.toUpperCase(),
        value: parseFloat(p.value) || 0,
        percentage:
          totalValue > 0 ? ((parseFloat(p.value) || 0) / totalValue) * 100 : 0,
      }));

      setAnalysis({ ...data, allocation, totalValue });
    } catch {
      setError("Analysis failed. Try again.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <>
      <Nav />
      <main
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "68px 24px 40px",
          background: "var(--bg)",
          minHeight: "100dvh",
        }}
      >
        <div className="fade-up" style={{ marginBottom: 28 }}>
          <h1 className="t-large-title" style={{ color: "var(--label)" }}>
            Portfolio
          </h1>
          <p
            className="t-subhead"
            style={{ color: "var(--label-3)", marginTop: 4 }}
          >
            Enter your positions to get allocation analysis and AI
            recommendations
          </p>
        </div>

        {/* Positions Table */}
        <div
          className="glass fade-up delay-1"
          style={{ padding: "20px 20px", marginBottom: 16 }}
        >
          <p
            className="t-caption1"
            style={{
              color: "var(--label-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 14,
            }}
          >
            Positions
          </p>

          {/* Header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "100px 1fr 1fr 32px",
              gap: 8,
              marginBottom: 8,
            }}
          >
            {["Ticker", "Shares", "Value ($)", ""].map((h) => (
              <p
                key={h}
                className="t-caption2"
                style={{ color: "var(--label-3)" }}
              >
                {h}
              </p>
            ))}
          </div>

          {positions.map((pos, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "100px 1fr 1fr 32px",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <input
                style={{
                  ...cellStyle,
                  textTransform: "uppercase" as const,
                  fontWeight: 600,
                }}
                placeholder="AAPL"
                value={pos.ticker}
                onChange={(e) => updatePosition(i, "ticker", e.target.value)}
              />
              <input
                style={cellStyle}
                type="number"
                placeholder="50"
                value={pos.shares}
                onChange={(e) => updatePosition(i, "shares", e.target.value)}
              />
              <input
                style={cellStyle}
                type="number"
                placeholder="9200"
                value={pos.value}
                onChange={(e) => updatePosition(i, "value", e.target.value)}
              />
              <button
                onClick={() => removePosition(i)}
                style={{
                  background: "transparent",
                  border: "0.5px solid var(--separator)",
                  color: "var(--label-3)",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "var(--red)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--label-3)")
                }
              >
                ×
              </button>
            </div>
          ))}

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 12,
              alignItems: "center",
            }}
          >
            <button
              onClick={addPosition}
              style={{
                background: "var(--surface-2)",
                border: "0.5px solid var(--separator)",
                color: "var(--label-2)",
                padding: "8px 16px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "var(--font)",
                transition: "background 0.15s",
              }}
            >
              + Add Position
            </button>

            <div style={{ flex: 1 }} />

            <p className="t-footnote" style={{ color: "var(--label-3)" }}>
              Total:{" "}
              <span style={{ color: "var(--label)", fontWeight: 600 }}>
                {fmt$(totalValue)}
              </span>
            </p>
          </div>

          {error && (
            <p
              className="t-footnote"
              style={{ color: "var(--red)", marginTop: 8 }}
            >
              {error}
            </p>
          )}

          <button
            onClick={analyze}
            disabled={isAnalyzing}
            style={{
              background: isAnalyzing ? "var(--surface-2)" : "var(--blue)",
              color: "white",
              fontWeight: 600,
              padding: "10px 20px",
              borderRadius: 10,
              cursor: isAnalyzing ? "not-allowed" : "pointer",
              border: "none",
              fontSize: 14,
              fontFamily: "var(--font)",
              marginTop: 14,
              transition: "background 0.15s",
            }}
          >
            {isAnalyzing ? "Analyzing..." : "Analyze Portfolio"}
          </button>
        </div>

        {/* Loading */}
        {isAnalyzing && (
          <div className="glass fade-up" style={{ padding: "24px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[0.8, 0.5, 0.7, 0.4].map((w, i) => (
                <div
                  key={i}
                  className="animate-pulse"
                  style={{
                    height: 14,
                    background: "var(--surface-2)",
                    borderRadius: 6,
                    width: `${w * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {analysis && (
          <>
            {/* Total + Risk */}
            <div
              className="glass fade-up"
              style={{
                padding: "20px 20px",
                marginBottom: 12,
                display: "flex",
                gap: 32,
                flexWrap: "wrap",
              }}
            >
              <div>
                <p className="t-caption2" style={{ color: "var(--label-3)" }}>
                  Portfolio Value
                </p>
                <p
                  className="t-title3"
                  style={{
                    color: "var(--label)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmt$(analysis.totalValue ?? totalValue)}
                </p>
              </div>
              {analysis.risk_level !== undefined && (
                <div>
                  <p className="t-caption2" style={{ color: "var(--label-3)" }}>
                    Risk Level
                  </p>
                  <p
                    className="t-title3"
                    style={{
                      color:
                        analysis.risk_level >= 7
                          ? "var(--red)"
                          : analysis.risk_level >= 4
                            ? "#ff9f0a"
                            : "var(--green)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {analysis.risk_level}/10
                  </p>
                </div>
              )}
              {analysis.riskScore !== undefined && (
                <div>
                  <p className="t-caption2" style={{ color: "var(--label-3)" }}>
                    Risk Score
                  </p>
                  <p
                    className="t-title3"
                    style={{
                      color:
                        analysis.riskScore >= 7
                          ? "var(--red)"
                          : analysis.riskScore >= 4
                            ? "#ff9f0a"
                            : "var(--green)",
                    }}
                  >
                    {analysis.riskScore}/10
                  </p>
                </div>
              )}
              {analysis.offline && (
                <p
                  className="t-footnote"
                  style={{ color: "var(--label-3)", alignSelf: "center" }}
                >
                  Analysis engine offline. Showing local calculations.
                </p>
              )}
            </div>

            {/* Allocation bars */}
            {analysis.allocation && analysis.allocation.length > 0 && (
              <div
                className="glass fade-up delay-1"
                style={{ padding: "20px 20px", marginBottom: 12 }}
              >
                <p
                  className="t-caption1"
                  style={{
                    color: "var(--label-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 14,
                  }}
                >
                  Allocation
                </p>

                {/* Stacked bar */}
                <div
                  style={{
                    display: "flex",
                    height: 12,
                    borderRadius: 6,
                    overflow: "hidden",
                    marginBottom: 16,
                  }}
                >
                  {analysis.allocation.map((a, i) => (
                    <div
                      key={a.ticker}
                      style={{
                        width: `${a.percentage}%`,
                        background: BAR_COLORS[i % BAR_COLORS.length],
                        transition: "width 0.5s ease",
                      }}
                    />
                  ))}
                </div>

                {analysis.allocation.map((a, i) => (
                  <div
                    key={a.ticker}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 0",
                      borderBottom:
                        i < (analysis.allocation?.length ?? 0) - 1
                          ? "0.5px solid var(--separator)"
                          : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: BAR_COLORS[i % BAR_COLORS.length],
                        flexShrink: 0,
                      }}
                    />
                    <p
                      className="t-subhead"
                      style={{
                        color: "var(--label)",
                        fontWeight: 600,
                        width: 60,
                      }}
                    >
                      {a.ticker}
                    </p>
                    <div
                      style={{
                        flex: 1,
                        height: 4,
                        background: "var(--surface-2)",
                        borderRadius: 2,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${a.percentage}%`,
                          background: BAR_COLORS[i % BAR_COLORS.length],
                          borderRadius: 2,
                        }}
                      />
                    </div>
                    <p
                      className="t-subhead"
                      style={{
                        color: "var(--label-2)",
                        fontVariantNumeric: "tabular-nums",
                        width: 80,
                        textAlign: "right",
                      }}
                    >
                      {fmt$(a.value)}
                    </p>
                    <p
                      className="t-caption1"
                      style={{
                        color: "var(--label-3)",
                        fontVariantNumeric: "tabular-nums",
                        width: 42,
                        textAlign: "right",
                      }}
                    >
                      {a.percentage.toFixed(1)}%
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Suggestions / Recommendations */}
            {((analysis.suggestions && analysis.suggestions.length > 0) ||
              (analysis.recommendations &&
                analysis.recommendations.length > 0)) && (
              <div
                className="glass fade-up delay-2"
                style={{ padding: "20px 20px", marginBottom: 12 }}
              >
                <p
                  className="t-caption1"
                  style={{
                    color: "var(--label-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 14,
                  }}
                >
                  AI Suggestions
                </p>
                {(analysis.suggestions ?? analysis.recommendations ?? []).map(
                  (s, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: 10,
                        padding: "10px 0",
                        borderBottom:
                          i <
                          (
                            analysis.suggestions ??
                            analysis.recommendations ??
                            []
                          ).length -
                            1
                            ? "0.5px solid var(--separator)"
                            : "none",
                      }}
                    >
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "var(--blue)",
                          marginTop: 6,
                          flexShrink: 0,
                        }}
                      />
                      <p
                        className="t-subhead"
                        style={{ color: "var(--label-2)" }}
                      >
                        {s}
                      </p>
                    </div>
                  ),
                )}
              </div>
            )}

            {/* Risk alerts */}
            {analysis.risk_alerts && analysis.risk_alerts.length > 0 && (
              <div
                className="glass fade-up delay-3"
                style={{ padding: "20px 20px" }}
              >
                <p
                  className="t-caption1"
                  style={{
                    color: "var(--red)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 14,
                  }}
                >
                  Risk Alerts
                </p>
                {analysis.risk_alerts.map((alert, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "10px 0",
                      borderBottom:
                        i < (analysis.risk_alerts?.length ?? 0) - 1
                          ? "0.5px solid var(--separator)"
                          : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--red)",
                        marginTop: 6,
                        flexShrink: 0,
                      }}
                    />
                    <p
                      className="t-subhead"
                      style={{ color: "var(--label-2)" }}
                    >
                      {alert}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
