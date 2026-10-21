"use client";

import { useState } from "react";
import Nav from "@/components/nav";

interface SpendingCategory {
  name: string;
  amount: number;
  percentage: number;
  insight: string;
}

interface SpendingAnalysis {
  score: number;
  grade: string;
  categories: SpendingCategory[];
  topInsights: string[];
  actionPlan: string[];
  savingsOpportunity: number;
}

function fmt$(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const color =
    score >= 70 ? "var(--green)" : score >= 40 ? "#ff9f0a" : "var(--red)";

  return (
    <div style={{ position: "relative", width: 120, height: 120 }}>
      <svg width={120} height={120} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={60}
          cy={60}
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={8}
        />
        <circle
          cx={60}
          cy={60}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p
          className="t-title2"
          style={{ color, fontWeight: 700, lineHeight: 1 }}
        >
          {score}
        </p>
        <p className="t-caption2" style={{ color: "var(--label-3)" }}>
          Grade {grade}
        </p>
      </div>
    </div>
  );
}

const EXAMPLE = `Whole Foods - $142
Netflix - $17
Uber - $38
Spotify - $11
Amazon - $89
Starbucks - $64
Gym membership - $45
Electricity - $110
Phone bill - $85
Dining out - $230
Gas - $75
Target - $120`;

export default function SpendingPage() {
  const [transactions, setTransactions] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<SpendingAnalysis | null>(null);
  const [error, setError] = useState("");

  const inputStyle = {
    background: "var(--surface-1)",
    border: "0.5px solid var(--separator)",
    color: "var(--label)",
    padding: "10px 14px",
    borderRadius: 10,
    width: "100%",
    fontSize: 13,
    fontFamily: "monospace",
    outline: "none",
    resize: "vertical" as const,
    minHeight: 180,
  };

  async function analyze() {
    if (!transactions.trim()) {
      setError("Paste some transactions first.");
      return;
    }
    setError("");
    setIsAnalyzing(true);
    setAnalysis(null);

    try {
      const res = await fetch("/api/spending/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions }),
      });
      const data = (await res.json()) as SpendingAnalysis;
      setAnalysis(data);
      localStorage.setItem("fidos_spending", JSON.stringify(data));
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
            Spending
          </h1>
          <p
            className="t-subhead"
            style={{ color: "var(--label-3)", marginTop: 4 }}
          >
            Paste your transactions and get an AI spending health score
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
            Transactions
          </p>
          <textarea
            style={inputStyle}
            placeholder={EXAMPLE}
            value={transactions}
            onChange={(e) => setTransactions(e.target.value)}
          />
          <p
            className="t-caption2"
            style={{ color: "var(--label-3)", marginTop: 6 }}
          >
            One per line. Format: Merchant - $amount
          </p>

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
            {isAnalyzing ? "Analyzing..." : "Analyze Spending"}
          </button>
        </div>

        {/* Loading skeleton */}
        {isAnalyzing && (
          <div className="glass fade-up" style={{ padding: "24px 20px" }}>
            <div
              style={{
                display: "flex",
                gap: 24,
                alignItems: "center",
                marginBottom: 24,
              }}
            >
              <div
                className="animate-pulse"
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: "50%",
                  background: "var(--surface-2)",
                }}
              />
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {[0.7, 0.5, 0.8].map((w, i) => (
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
          </div>
        )}

        {/* Results */}
        {analysis && (
          <>
            {/* Score + savings */}
            <div
              className="glass fade-up"
              style={{
                padding: "24px 20px",
                marginBottom: 12,
                display: "flex",
                gap: 28,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <ScoreRing score={analysis.score} grade={analysis.grade} />
              <div style={{ flex: 1 }}>
                <p
                  className="t-title3"
                  style={{ color: "var(--label)", marginBottom: 4 }}
                >
                  Spending Health:{" "}
                  <span
                    style={{
                      color:
                        analysis.score >= 70
                          ? "var(--green)"
                          : analysis.score >= 40
                            ? "#ff9f0a"
                            : "var(--red)",
                    }}
                  >
                    {analysis.score >= 70
                      ? "Healthy"
                      : analysis.score >= 40
                        ? "Needs Work"
                        : "Concerning"}
                  </span>
                </p>
                <p className="t-subhead" style={{ color: "var(--label-3)" }}>
                  Estimated savings opportunity:{" "}
                  <span style={{ color: "var(--green)", fontWeight: 600 }}>
                    {fmt$(analysis.savingsOpportunity)}/mo
                  </span>
                </p>
              </div>
            </div>

            {/* Categories */}
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
                Category Breakdown
              </p>
              {analysis.categories.map((cat, i) => (
                <div
                  key={i}
                  style={{
                    paddingBottom: 14,
                    marginBottom: 14,
                    borderBottom:
                      i < analysis.categories.length - 1
                        ? "0.5px solid var(--separator)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <p className="t-subhead" style={{ color: "var(--label)" }}>
                      {cat.name}
                    </p>
                    <div style={{ textAlign: "right" }}>
                      <p
                        className="t-subhead"
                        style={{
                          color: "var(--label)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {fmt$(cat.amount)}
                      </p>
                      <p
                        className="t-caption2"
                        style={{ color: "var(--label-3)" }}
                      >
                        {cat.percentage}%
                      </p>
                    </div>
                  </div>
                  {/* Bar */}
                  <div
                    style={{
                      height: 4,
                      background: "var(--surface-2)",
                      borderRadius: 2,
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(cat.percentage, 100)}%`,
                        background: "var(--blue)",
                        borderRadius: 2,
                        transition: "width 0.5s ease",
                      }}
                    />
                  </div>
                  <p className="t-footnote" style={{ color: "var(--label-3)" }}>
                    {cat.insight}
                  </p>
                </div>
              ))}
            </div>

            {/* Insights */}
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
                Top Insights
              </p>
              {analysis.topInsights.map((insight, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "10px 0",
                    borderBottom:
                      i < analysis.topInsights.length - 1
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
                  <p className="t-subhead" style={{ color: "var(--label-2)" }}>
                    {insight}
                  </p>
                </div>
              ))}
            </div>

            {/* Action Plan */}
            <div
              className="glass fade-up delay-3"
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
                Action Plan
              </p>
              {analysis.actionPlan.map((action, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "10px 0",
                    borderBottom:
                      i < analysis.actionPlan.length - 1
                        ? "0.5px solid var(--separator)"
                        : "none",
                    alignItems: "flex-start",
                  }}
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "var(--surface-2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <p
                      className="t-caption2"
                      style={{ color: "var(--label-3)" }}
                    >
                      {i + 1}
                    </p>
                  </div>
                  <p className="t-subhead" style={{ color: "var(--label-2)" }}>
                    {action}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
