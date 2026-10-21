"use client";

import { useState, useEffect, useCallback } from "react";
import Nav from "@/components/nav";

interface StatisticalSignificance {
  significant: boolean;
  pValue: string;
  confidence: string;
  zScore: string;
}

interface EffectSize {
  relative: string;
  absolute: string;
  practicallySignificant: boolean;
  practicalNote: string;
}

interface NextTest {
  hypothesis: string;
  rationale: string;
}

interface InterpretationResult {
  verdict:
    | "Ship Variant B"
    | "Keep Control"
    | "Inconclusive"
    | "Need More Data";
  verdictReason: string;
  statisticalSignificance: StatisticalSignificance;
  effectSize: EffectSize;
  sampleSizeAdequacy: "Adequate" | "Underpowered" | "Overpowered";
  sampleSizeNote: string;
  timeWarnings: string[];
  segmentSuggestions: string[];
  nextTests: NextTest[];
  pitfalls: string[];
  summary: string;
}

interface TestInput {
  whatWasTested: string;
  controlSampleSize: number;
  controlConversionRate: number;
  variantSampleSize: number;
  variantConversionRate: number;
  testDuration: string;
  metricName: string;
}

interface SavedTest {
  id: string;
  input: TestInput;
  result: InterpretationResult;
  createdAt: string;
}

const STORAGE_KEY = "fiduciary_split_history";

function verdictColor(verdict: string): string {
  if (verdict === "Ship Variant B") return "var(--green)";
  if (verdict === "Keep Control") return "var(--red)";
  if (verdict === "Inconclusive") return "var(--yellow)";
  return "var(--blue)";
}

function verdictBg(verdict: string): string {
  if (verdict === "Ship Variant B") return "var(--green-dim)";
  if (verdict === "Keep Control") return "var(--red-dim)";
  if (verdict === "Inconclusive") return "rgba(255,214,10,0.08)";
  return "var(--blue-dim)";
}

function adequacyColor(v: string): string {
  if (v === "Adequate") return "var(--green)";
  if (v === "Underpowered") return "var(--red)";
  return "var(--yellow)";
}

export default function SplitPage() {
  const [form, setForm] = useState<TestInput>({
    whatWasTested: "",
    controlSampleSize: 0,
    controlConversionRate: 0,
    variantSampleSize: 0,
    variantConversionRate: 0,
    testDuration: "",
    metricName: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InterpretationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SavedTest[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setHistory(parsed as SavedTest[]);
      }
    } catch {
      // storage unavailable
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const res = await fetch("/api/split", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });

        const json: unknown = await res.json();
        if (!res.ok) {
          const errJson = json as { error?: string };
          throw new Error(errJson.error ?? "Request failed");
        }

        const dataJson = json as { data: InterpretationResult };
        setResult(dataJson.data);

        const entry: SavedTest = {
          id: Date.now().toString(),
          input: form,
          result: dataJson.data,
          createdAt: new Date().toISOString(),
        };
        setHistory((prev) => {
          const updated = [entry, ...prev].slice(0, 10);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          } catch {
            // storage unavailable
          }
          return updated;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [form],
  );

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--surface-1)",
    border: "0.5px solid var(--separator)",
    borderRadius: 8,
    color: "var(--label)",
    fontFamily: "var(--font)",
    fontSize: 14,
    padding: "9px 12px",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    color: "var(--label-3)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 6,
    fontFamily: "var(--font)",
  };

  return (
    <>
      <Nav />
      <main
        className="app-bg"
        style={{ minHeight: "100dvh", paddingTop: 68, paddingBottom: 60 }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px" }}>
          {/* Header */}
          <div className="fade-up" style={{ marginBottom: 28, paddingTop: 28 }}>
            <p
              className="t-footnote"
              style={{ color: "var(--label-3)", marginBottom: 4 }}
            >
              Experimentation
            </p>
            <h1
              className="t-large-title"
              style={{ color: "var(--label)", marginBottom: 6 }}
            >
              Split
            </h1>
            <p className="t-body" style={{ color: "var(--label-2)" }}>
              Enter your A/B test results. Get a clear verdict, statistical
              confidence, and what to test next.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div
              className="glass fade-up delay-1"
              style={{
                padding: 20,
                marginBottom: 16,
                display: "flex",
                flexDirection: "column",
                gap: 18,
              }}
            >
              {/* What was tested */}
              <div>
                <label style={labelStyle}>What did you test?</label>
                <textarea
                  placeholder="e.g. Changed the CTA button copy from 'Sign Up' to 'Get Started Free' on the homepage hero section"
                  style={{
                    ...inputStyle,
                    minHeight: 80,
                    resize: "none",
                    lineHeight: 1.5,
                  }}
                  value={form.whatWasTested}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, whatWasTested: e.target.value }))
                  }
                  required
                />
              </div>

              {/* Metric name */}
              <div>
                <label style={labelStyle}>
                  Metric name{" "}
                  <span
                    style={{
                      color: "var(--label-4)",
                      textTransform: "none",
                      letterSpacing: 0,
                    }}
                  >
                    (optional)
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. signup rate, click-through rate"
                  style={inputStyle}
                  value={form.metricName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, metricName: e.target.value }))
                  }
                />
              </div>

              {/* Control vs Variant */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                {/* Control */}
                <div
                  style={{
                    background: "var(--surface-1)",
                    border: "0.5px solid var(--separator)",
                    borderRadius: 10,
                    padding: "14px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "var(--label-3)",
                        flexShrink: 0,
                      }}
                    />
                    <span
                      className="t-footnote"
                      style={{ color: "var(--label-2)", fontWeight: 600 }}
                    >
                      Control (A)
                    </span>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, marginBottom: 4 }}>
                      Sample size
                    </label>
                    <input
                      type="number"
                      placeholder="10000"
                      min={1}
                      style={inputStyle}
                      value={form.controlSampleSize || ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          controlSampleSize: parseInt(e.target.value) || 0,
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, marginBottom: 4 }}>
                      Conversion rate (%)
                    </label>
                    <input
                      type="number"
                      placeholder="4.2"
                      min={0}
                      max={100}
                      step={0.01}
                      style={inputStyle}
                      value={form.controlConversionRate || ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          controlConversionRate:
                            parseFloat(e.target.value) || 0,
                        }))
                      }
                      required
                    />
                  </div>
                </div>

                {/* Variant */}
                <div
                  style={{
                    background: "var(--green-dim)",
                    border: "0.5px solid rgba(48,209,88,0.2)",
                    borderRadius: 10,
                    padding: "14px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "var(--green)",
                        flexShrink: 0,
                      }}
                    />
                    <span
                      className="t-footnote"
                      style={{ color: "var(--label-2)", fontWeight: 600 }}
                    >
                      Variant (B)
                    </span>
                  </div>
                  <div>
                    <label style={{ ...labelStyle, marginBottom: 4 }}>
                      Sample size
                    </label>
                    <input
                      type="number"
                      placeholder="10000"
                      min={1}
                      style={inputStyle}
                      value={form.variantSampleSize || ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          variantSampleSize: parseInt(e.target.value) || 0,
                        }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, marginBottom: 4 }}>
                      Conversion rate (%)
                    </label>
                    <input
                      type="number"
                      placeholder="4.7"
                      min={0}
                      max={100}
                      step={0.01}
                      style={inputStyle}
                      value={form.variantConversionRate || ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          variantConversionRate:
                            parseFloat(e.target.value) || 0,
                        }))
                      }
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Test duration */}
              <div>
                <label style={labelStyle}>Test duration</label>
                <input
                  type="text"
                  placeholder="e.g. 14 days, 3 weeks"
                  style={inputStyle}
                  value={form.testDuration}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, testDuration: e.target.value }))
                  }
                  required
                />
              </div>

              {/* Error */}
              {error && (
                <div
                  style={{
                    padding: "12px 14px",
                    background: "var(--red-dim)",
                    border: "0.5px solid rgba(255,69,58,0.3)",
                    borderRadius: 8,
                  }}
                >
                  <p className="t-subhead" style={{ color: "var(--red)" }}>
                    {error}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "12px 20px",
                  background: loading ? "var(--surface-2)" : "var(--green)",
                  color: loading ? "var(--label-3)" : "#000",
                  border: "none",
                  borderRadius: 10,
                  fontFamily: "var(--font)",
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                {loading ? "Analyzing your test..." : "Interpret Results"}
              </button>
            </div>
          </form>

          {/* Results */}
          {result && (
            <div
              className="fade-up"
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              {/* Verdict */}
              <div
                className="glass"
                style={{
                  padding: "20px 24px",
                  borderColor: verdictColor(result.verdict) + "40",
                  background: verdictBg(result.verdict),
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    className="t-title2"
                    style={{ color: verdictColor(result.verdict) }}
                  >
                    {result.verdict}
                  </span>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: "var(--surface-2)",
                      fontSize: 11,
                      color: "var(--label-3)",
                      fontFamily: "var(--font)",
                    }}
                  >
                    Verdict
                  </span>
                </div>
                <p className="t-callout" style={{ color: "var(--label-2)" }}>
                  {result.verdictReason}
                </p>
              </div>

              {/* Stats row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 10,
                }}
              >
                {[
                  {
                    label: "p-value",
                    value: result.statisticalSignificance.pValue,
                    sub: result.statisticalSignificance.significant
                      ? "Significant"
                      : "Not significant",
                    color: result.statisticalSignificance.significant
                      ? "var(--green)"
                      : "var(--label-2)",
                  },
                  {
                    label: "Confidence",
                    value: result.statisticalSignificance.confidence,
                    sub: `z = ${result.statisticalSignificance.zScore}`,
                    color: "var(--label)",
                  },
                  {
                    label: "Relative lift",
                    value: result.effectSize.relative,
                    sub: `Absolute: ${result.effectSize.absolute}`,
                    color: result.effectSize.relative.startsWith("+")
                      ? "var(--green)"
                      : result.effectSize.relative.startsWith("-")
                        ? "var(--red)"
                        : "var(--label)",
                  },
                  {
                    label: "Sample size",
                    value: result.sampleSizeAdequacy,
                    sub: null,
                    color: adequacyColor(result.sampleSizeAdequacy),
                    isTag: true,
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="glass"
                    style={{ padding: "14px 16px" }}
                  >
                    <p
                      className="t-caption2"
                      style={{ color: "var(--label-3)", marginBottom: 6 }}
                    >
                      {stat.label}
                    </p>
                    <p
                      className="t-title3"
                      style={{
                        color: stat.color,
                        marginBottom: stat.sub ? 4 : 0,
                      }}
                    >
                      {stat.value}
                    </p>
                    {stat.sub && (
                      <p
                        className="t-caption2"
                        style={{ color: "var(--label-3)" }}
                      >
                        {stat.sub}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Practical significance */}
              <div className="glass" style={{ padding: "16px 20px" }}>
                <p
                  className="t-caption2"
                  style={{
                    color: "var(--label-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 8,
                  }}
                >
                  Practical Significance
                </p>
                <p
                  className="t-subhead"
                  style={{ color: "var(--label-2)", lineHeight: 1.6 }}
                >
                  {result.effectSize.practicalNote}
                </p>
              </div>

              {/* Time warnings */}
              {result.timeWarnings.length > 0 && (
                <div
                  className="glass"
                  style={{
                    padding: "16px 20px",
                    borderColor: "rgba(255,159,10,0.25)",
                  }}
                >
                  <p
                    className="t-caption2"
                    style={{
                      color: "var(--orange)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      marginBottom: 10,
                    }}
                  >
                    Timing Flags
                  </p>
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {result.timeWarnings.map((w, i) => (
                      <li
                        key={i}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                        }}
                      >
                        <span
                          style={{
                            color: "var(--orange)",
                            fontSize: 10,
                            marginTop: 3,
                            flexShrink: 0,
                          }}
                        >
                          &#9650;
                        </span>
                        <p
                          className="t-caption1"
                          style={{ color: "var(--label-2)" }}
                        >
                          {w}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Next tests */}
              {result.nextTests.length > 0 && (
                <div className="glass" style={{ padding: "16px 20px" }}>
                  <p
                    className="t-caption2"
                    style={{
                      color: "var(--label-3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      marginBottom: 12,
                    }}
                  >
                    What to Test Next
                  </p>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {result.nextTests.map((t, i) => (
                      <div
                        key={i}
                        style={{
                          background: "var(--surface-1)",
                          borderRadius: 8,
                          padding: "12px 14px",
                          display: "flex",
                          gap: 12,
                          alignItems: "flex-start",
                        }}
                      >
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            background: "var(--green-dim)",
                            borderRadius: 5,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            color: "var(--green)",
                            fontWeight: 700,
                            flexShrink: 0,
                            fontFamily: "var(--font)",
                          }}
                        >
                          {i + 1}
                        </span>
                        <div>
                          <p
                            className="t-footnote"
                            style={{
                              color: "var(--label)",
                              fontWeight: 600,
                              marginBottom: 3,
                            }}
                          >
                            {t.hypothesis}
                          </p>
                          <p
                            className="t-caption1"
                            style={{ color: "var(--label-3)" }}
                          >
                            {t.rationale}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary */}
              <div className="glass" style={{ padding: "16px 20px" }}>
                <p
                  className="t-caption2"
                  style={{
                    color: "var(--label-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 8,
                  }}
                >
                  Stakeholder Summary
                </p>
                <p
                  className="t-subhead"
                  style={{ color: "var(--label-2)", lineHeight: 1.6 }}
                >
                  {result.summary}
                </p>
              </div>
            </div>
          )}

          {/* History */}
          {history.length > 0 && !result && (
            <div
              className="glass fade-up delay-2"
              style={{ padding: "16px 20px", marginTop: 16 }}
            >
              <p
                className="t-caption2"
                style={{
                  color: "var(--label-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 12,
                }}
              >
                Recent Tests
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {history.slice(0, 5).map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      setForm(h.input);
                      setResult(h.result);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      background: "var(--surface-1)",
                      border: "0.5px solid var(--separator)",
                      borderRadius: 8,
                      cursor: "pointer",
                      textAlign: "left",
                      gap: 12,
                    }}
                  >
                    <p
                      className="t-caption1"
                      style={{
                        color: "var(--label-2)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "70%",
                      }}
                    >
                      {h.input.whatWasTested}
                    </p>
                    <span
                      style={{
                        fontSize: 11,
                        color: verdictColor(h.result.verdict),
                        fontFamily: "var(--font)",
                        flexShrink: 0,
                      }}
                    >
                      {h.result.verdict}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
