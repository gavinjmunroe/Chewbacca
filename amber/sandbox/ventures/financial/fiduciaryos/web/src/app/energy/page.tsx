"use client";

import { useState } from "react";
import Nav from "@/components/nav";

interface EnergyRecommendation {
  action: string;
  savings: number;
  difficulty: "Easy" | "Medium" | "Hard";
  roi: string;
}

interface ApplianceBreakdown {
  appliance: string;
  estimatedKwh: number;
  estimatedCost: number;
  percentage: number;
}

interface EnergyAnalysis {
  efficiencyScore: number;
  estimatedWaste: number;
  recommendations: EnergyRecommendation[];
  breakdown: ApplianceBreakdown[];
  summary: string;
}

function fmt$(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

const DIFFICULTY_COLORS: Record<string, string> = {
  Easy: "var(--green)",
  Medium: "#ff9f0a",
  Hard: "var(--red)",
};

const BILL_EXAMPLE = `Southern California Edison
Account: 1234-5678
Service Period: March 1 - March 31, 2026
Total kWh Used: 820
Current Charges: $147.60
Rate: TOU-D-PRIME
Baseline: 264 kWh at $0.10/kWh
Tier 2: 556 kWh at $0.22/kWh`;

export default function EnergyPage() {
  const [billText, setBillText] = useState("");
  const [monthlyKwh, setMonthlyKwh] = useState("");
  const [rate, setRate] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<EnergyAnalysis | null>(null);
  const [error, setError] = useState("");

  const inputStyle = {
    background: "var(--surface-1)",
    border: "0.5px solid var(--separator)",
    color: "var(--label)",
    padding: "10px 14px",
    borderRadius: 10,
    width: "100%",
    fontSize: 14,
    fontFamily: "var(--font)",
    outline: "none",
  };

  async function analyze() {
    if (!billText.trim()) {
      setError("Paste your bill text first.");
      return;
    }
    setError("");
    setIsAnalyzing(true);
    setAnalysis(null);

    try {
      const res = await fetch("/api/energy/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billText,
          monthlyKwh: monthlyKwh ? parseFloat(monthlyKwh) : undefined,
          rate: rate ? parseFloat(rate) : undefined,
        }),
      });
      const data = (await res.json()) as EnergyAnalysis;
      setAnalysis(data);
      localStorage.setItem("fidos_energy", JSON.stringify(data));
    } catch {
      setError("Analysis failed. Try again.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  const gaugeColor = analysis
    ? analysis.efficiencyScore >= 70
      ? "var(--green)"
      : analysis.efficiencyScore >= 50
        ? "#ff9f0a"
        : "var(--red)"
    : "var(--label-3)";

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
            Energy
          </h1>
          <p
            className="t-subhead"
            style={{ color: "var(--label-3)", marginTop: 4 }}
          >
            Paste your electricity or gas bill to find waste and savings
          </p>
        </div>

        {/* Input */}
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
              marginBottom: 12,
            }}
          >
            Bill Details
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <p
                className="t-footnote"
                style={{ color: "var(--label-2)", marginBottom: 6 }}
              >
                Bill Text
              </p>
              <textarea
                style={{
                  ...inputStyle,
                  fontFamily: "monospace",
                  fontSize: 13,
                  minHeight: 140,
                  resize: "vertical" as const,
                }}
                placeholder={BILL_EXAMPLE}
                value={billText}
                onChange={(e) => setBillText(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <p
                  className="t-footnote"
                  style={{ color: "var(--label-2)", marginBottom: 6 }}
                >
                  Monthly kWh{" "}
                  <span style={{ color: "var(--label-3)" }}>(optional)</span>
                </p>
                <input
                  style={inputStyle}
                  type="number"
                  placeholder="820"
                  value={monthlyKwh}
                  onChange={(e) => setMonthlyKwh(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <p
                  className="t-footnote"
                  style={{ color: "var(--label-2)", marginBottom: 6 }}
                >
                  Rate $/kWh{" "}
                  <span style={{ color: "var(--label-3)" }}>(optional)</span>
                </p>
                <input
                  style={inputStyle}
                  type="number"
                  step="0.01"
                  placeholder="0.18"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="t-footnote" style={{ color: "var(--red)" }}>
                {error}
              </p>
            )}

            <button
              onClick={analyze}
              disabled={isAnalyzing}
              style={{
                background: isAnalyzing ? "var(--surface-2)" : "var(--green)",
                color: isAnalyzing ? "var(--label-3)" : "#000",
                fontWeight: 600,
                padding: "10px 20px",
                borderRadius: 10,
                cursor: isAnalyzing ? "not-allowed" : "pointer",
                border: "none",
                fontSize: 14,
                fontFamily: "var(--font)",
                alignSelf: "flex-start",
                transition: "background 0.15s",
              }}
            >
              {isAnalyzing ? "Analyzing..." : "Analyze Bill"}
            </button>
          </div>
        </div>

        {/* Loading */}
        {isAnalyzing && (
          <div className="glass fade-up" style={{ padding: "24px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[0.6, 0.9, 0.4, 0.7].map((w, i) => (
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
            {/* Score + waste */}
            <div
              className="glass fade-up"
              style={{
                padding: "24px 20px",
                marginBottom: 12,
                display: "flex",
                gap: 28,
                flexWrap: "wrap",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <p
                  className="t-title1"
                  style={{
                    color: gaugeColor,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {analysis.efficiencyScore}
                </p>
                <p className="t-caption1" style={{ color: "var(--label-3)" }}>
                  Efficiency Score
                </p>
              </div>
              <div
                style={{
                  width: 1,
                  background: "var(--separator)",
                  alignSelf: "stretch",
                  flexShrink: 0,
                }}
              />
              <div style={{ textAlign: "center" }}>
                <p
                  className="t-title1"
                  style={{
                    color: "var(--red)",
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmt$(analysis.estimatedWaste)}
                </p>
                <p className="t-caption1" style={{ color: "var(--label-3)" }}>
                  Monthly Waste
                </p>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <p
                  className="t-subhead"
                  style={{ color: "var(--label-2)", lineHeight: 1.5 }}
                >
                  {analysis.summary}
                </p>
              </div>
            </div>

            {/* Recommendations */}
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
                Recommendations
              </p>
              {analysis.recommendations.map((rec, i) => (
                <div
                  key={i}
                  style={{
                    padding: "12px 0",
                    borderBottom:
                      i < analysis.recommendations.length - 1
                        ? "0.5px solid var(--separator)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                    }}
                  >
                    <p
                      className="t-subhead"
                      style={{ color: "var(--label)", flex: 1 }}
                    >
                      {rec.action}
                    </p>
                    <p
                      className="t-subhead"
                      style={{
                        color: "var(--green)",
                        fontVariantNumeric: "tabular-nums",
                        flexShrink: 0,
                      }}
                    >
                      {fmt$(rec.savings)}/mo
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color:
                          DIFFICULTY_COLORS[rec.difficulty] ?? "var(--label-3)",
                        background: `${DIFFICULTY_COLORS[rec.difficulty] ?? "var(--surface-2)"}18`,
                        padding: "2px 8px",
                        borderRadius: 20,
                        border: `1px solid ${DIFFICULTY_COLORS[rec.difficulty] ?? "var(--separator)"}40`,
                      }}
                    >
                      {rec.difficulty}
                    </span>
                    <p
                      className="t-footnote"
                      style={{ color: "var(--label-3)" }}
                    >
                      ROI in {rec.roi}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Appliance Breakdown */}
            <div
              className="glass fade-up delay-2"
              style={{ padding: "20px 20px" }}
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
                Appliance Breakdown
              </p>
              {analysis.breakdown.map((item, i) => (
                <div
                  key={i}
                  style={{
                    padding: "10px 0",
                    borderBottom:
                      i < analysis.breakdown.length - 1
                        ? "0.5px solid var(--separator)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 5,
                    }}
                  >
                    <p className="t-subhead" style={{ color: "var(--label)" }}>
                      {item.appliance}
                    </p>
                    <div style={{ textAlign: "right" }}>
                      <p
                        className="t-subhead"
                        style={{
                          color: "var(--label)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {fmt$(item.estimatedCost)}
                      </p>
                      <p
                        className="t-caption2"
                        style={{ color: "var(--label-3)" }}
                      >
                        {item.estimatedKwh} kWh
                      </p>
                    </div>
                  </div>
                  <div
                    style={{
                      height: 4,
                      background: "var(--surface-2)",
                      borderRadius: 2,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(item.percentage, 100)}%`,
                        background: "var(--blue)",
                        borderRadius: 2,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
