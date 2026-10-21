"use client";

import { useState, useRef } from "react";
import Nav from "@/components/nav";

interface KeyFinding {
  category: string;
  finding: string;
  severity: "Info" | "Caution" | "Warning" | "Red Flag";
  plainEnglish: string;
  quote: string;
}

interface ContractAnalysis {
  documentType: string;
  company: string;
  overallVerdict: "Safe" | "Caution" | "Red Flags" | "Concerning";
  verdictReason: string;
  readingLevel: string;
  keyFindings: KeyFinding[];
  dataCollected: string[];
  dataSharedWith: string[];
  yourRights: string[];
  howToCancel: string;
  autoRenewal: boolean;
  arbitrationClause: boolean;
  contentOwnership: string;
  redFlags: string[];
  tldr: string;
}

const DOC_TYPES = [
  "Terms of Service",
  "Privacy Policy",
  "EULA",
  "Subscription Agreement",
];

function verdictColor(verdict: string): string {
  if (verdict === "Safe") return "var(--green)";
  if (verdict === "Caution") return "var(--orange)";
  if (verdict === "Red Flags" || verdict === "Concerning") return "var(--red)";
  return "var(--label-2)";
}

function verdictBg(verdict: string): string {
  if (verdict === "Safe") return "var(--green-dim)";
  if (verdict === "Caution") return "rgba(255,159,10,0.12)";
  if (verdict === "Red Flags" || verdict === "Concerning")
    return "var(--red-dim)";
  return "var(--surface-1)";
}

function severityColor(severity: string): string {
  if (severity === "Red Flag") return "var(--red)";
  if (severity === "Warning") return "var(--orange)";
  if (severity === "Caution") return "var(--yellow)";
  return "var(--label-3)";
}

export default function ContractsPage() {
  const [text, setText] = useState("");
  const [docType, setDocType] = useState("Terms of Service");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<ContractAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const charCount = text.length;

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setIsAnalyzing(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, docType }),
      });

      if (!res.ok) throw new Error("Analysis failed. Please try again.");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
      }

      const cleaned = accumulated
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "");

      const parsed = JSON.parse(cleaned) as ContractAnalysis;
      setResult(parsed);

      setTimeout(() => {
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Try again.",
      );
    } finally {
      setIsAnalyzing(false);
    }
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
              Legal Intelligence
            </p>
            <h1
              className="t-large-title"
              style={{ color: "var(--label)", marginBottom: 6 }}
            >
              Contracts
            </h1>
            <p className="t-body" style={{ color: "var(--label-2)" }}>
              Paste any Terms of Service, Privacy Policy, or legal document. Get
              a plain-English breakdown of what you are actually agreeing to.
            </p>
          </div>

          {/* Input card */}
          <div
            className="glass fade-up delay-1"
            style={{ padding: 20, marginBottom: 16 }}
          >
            {/* Doc type selector */}
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="docType"
                className="t-caption1"
                style={{
                  color: "var(--label-3)",
                  display: "block",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Document type
              </label>
              <select
                id="docType"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                style={{
                  background: "var(--surface-2)",
                  border: "0.5px solid var(--separator)",
                  borderRadius: 8,
                  color: "var(--label)",
                  fontFamily: "var(--font)",
                  fontSize: 14,
                  padding: "8px 12px",
                  cursor: "pointer",
                  outline: "none",
                  width: "100%",
                  maxWidth: 240,
                }}
              >
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Text area */}
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="docText"
                className="t-caption1"
                style={{
                  color: "var(--label-3)",
                  display: "block",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Document text
              </label>
              <textarea
                id="docText"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the full Terms of Service or Privacy Policy text here..."
                style={{
                  width: "100%",
                  minHeight: 200,
                  background: "var(--surface-1)",
                  border: "0.5px solid var(--separator)",
                  borderRadius: 10,
                  color: "var(--label-2)",
                  fontFamily: "var(--font)",
                  fontSize: 14,
                  lineHeight: 1.6,
                  padding: "12px 14px",
                  resize: "vertical",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <p
                className="t-caption2"
                style={{ color: "var(--label-4)", marginTop: 6 }}
              >
                {charCount.toLocaleString()} characters
                {charCount > 5000 && charCount < 50000 && (
                  <span style={{ color: "var(--green)", marginLeft: 8 }}>
                    good length
                  </span>
                )}
                {charCount >= 50000 && (
                  <span style={{ color: "var(--orange)", marginLeft: 8 }}>
                    very long, will be trimmed
                  </span>
                )}
              </p>
            </div>

            {/* Analyze button */}
            <button
              onClick={handleAnalyze}
              disabled={!text.trim() || isAnalyzing}
              style={{
                width: "100%",
                padding: "12px 20px",
                background:
                  isAnalyzing || !text.trim()
                    ? "var(--surface-2)"
                    : "var(--green)",
                color: isAnalyzing || !text.trim() ? "var(--label-3)" : "#000",
                border: "none",
                borderRadius: 10,
                fontFamily: "var(--font)",
                fontSize: 15,
                fontWeight: 600,
                cursor: isAnalyzing || !text.trim() ? "not-allowed" : "pointer",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {isAnalyzing ? "Analyzing..." : "Analyze Document"}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div
              className="glass fade-up"
              style={{
                padding: "14px 18px",
                marginBottom: 16,
                borderColor: "rgba(255,69,58,0.3)",
              }}
            >
              <p className="t-subhead" style={{ color: "var(--red)" }}>
                {error}
              </p>
              <button
                onClick={() => setError(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--label-3)",
                  cursor: "pointer",
                  fontFamily: "var(--font)",
                  fontSize: 12,
                  marginTop: 4,
                  padding: 0,
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Results */}
          <div ref={resultsRef}>
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
                    borderColor: verdictColor(result.overallVerdict) + "40",
                    background: verdictBg(result.overallVerdict),
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
                      style={{ color: verdictColor(result.overallVerdict) }}
                    >
                      {result.overallVerdict}
                    </span>
                    {result.company && result.company !== "Unknown" && (
                      <span
                        className="t-subhead"
                        style={{ color: "var(--label-3)" }}
                      >
                        {result.company}
                      </span>
                    )}
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
                      {result.documentType}
                    </span>
                  </div>
                  <p
                    className="t-callout"
                    style={{ color: "var(--label-2)", marginBottom: 10 }}
                  >
                    {result.verdictReason}
                  </p>
                  <p
                    className="t-subhead"
                    style={{ color: "var(--label-2)", lineHeight: 1.6 }}
                  >
                    {result.tldr}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      marginTop: 14,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <p
                        className="t-caption2"
                        style={{ color: "var(--label-3)" }}
                      >
                        Reading level
                      </p>
                      <p
                        className="t-footnote"
                        style={{ color: "var(--label-2)" }}
                      >
                        {result.readingLevel}
                      </p>
                    </div>
                    <div>
                      <p
                        className="t-caption2"
                        style={{ color: "var(--label-3)" }}
                      >
                        Auto-renewal
                      </p>
                      <p
                        className="t-footnote"
                        style={{
                          color: result.autoRenewal
                            ? "var(--orange)"
                            : "var(--green)",
                        }}
                      >
                        {result.autoRenewal ? "Yes" : "No"}
                      </p>
                    </div>
                    <div>
                      <p
                        className="t-caption2"
                        style={{ color: "var(--label-3)" }}
                      >
                        Arbitration clause
                      </p>
                      <p
                        className="t-footnote"
                        style={{
                          color: result.arbitrationClause
                            ? "var(--orange)"
                            : "var(--green)",
                        }}
                      >
                        {result.arbitrationClause ? "Yes" : "No"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Red flags */}
                {result.redFlags.length > 0 && (
                  <div
                    className="glass"
                    style={{
                      padding: "18px 20px",
                      borderColor: "rgba(255,69,58,0.25)",
                    }}
                  >
                    <p
                      className="t-footnote"
                      style={{
                        color: "var(--red)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        marginBottom: 12,
                      }}
                    >
                      Red Flags
                    </p>
                    <ul
                      style={{
                        listStyle: "none",
                        padding: 0,
                        margin: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {result.redFlags.map((flag, i) => (
                        <li
                          key={i}
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                          }}
                        >
                          <span
                            style={{
                              color: "var(--red)",
                              fontSize: 12,
                              marginTop: 2,
                              flexShrink: 0,
                            }}
                          >
                            &#9679;
                          </span>
                          <p
                            className="t-subhead"
                            style={{ color: "var(--label-2)" }}
                          >
                            {flag}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Key findings */}
                {result.keyFindings.length > 0 && (
                  <div className="glass" style={{ padding: "18px 20px" }}>
                    <p
                      className="t-footnote"
                      style={{
                        color: "var(--label-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        marginBottom: 14,
                      }}
                    >
                      Key Findings
                    </p>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {result.keyFindings.map((f, i) => (
                        <div
                          key={i}
                          style={{
                            padding: "14px 16px",
                            background: "var(--surface-1)",
                            borderRadius: 10,
                            borderLeft: `3px solid ${severityColor(f.severity)}`,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 6,
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              className="t-headline"
                              style={{ color: "var(--label)" }}
                            >
                              {f.category}
                            </span>
                            <span
                              style={{
                                padding: "1px 7px",
                                borderRadius: 5,
                                background: "var(--surface-2)",
                                fontSize: 11,
                                color: severityColor(f.severity),
                                fontFamily: "var(--font)",
                              }}
                            >
                              {f.severity}
                            </span>
                          </div>
                          <p
                            className="t-subhead"
                            style={{ color: "var(--label-2)", marginBottom: 6 }}
                          >
                            {f.plainEnglish}
                          </p>
                          {f.quote && (
                            <p
                              className="t-caption1"
                              style={{
                                color: "var(--label-3)",
                                fontStyle: "italic",
                                lineHeight: 1.5,
                              }}
                            >
                              &ldquo;{f.quote}&rdquo;
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Data + Rights */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  {result.dataCollected.length > 0 && (
                    <div className="glass" style={{ padding: "16px 18px" }}>
                      <p
                        className="t-footnote"
                        style={{
                          color: "var(--label-3)",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          marginBottom: 10,
                        }}
                      >
                        Data Collected
                      </p>
                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          margin: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        {result.dataCollected.map((d, i) => (
                          <li
                            key={i}
                            className="t-caption1"
                            style={{ color: "var(--label-2)" }}
                          >
                            {d}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.yourRights.length > 0 && (
                    <div className="glass" style={{ padding: "16px 18px" }}>
                      <p
                        className="t-footnote"
                        style={{
                          color: "var(--label-3)",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          marginBottom: 10,
                        }}
                      >
                        Your Rights
                      </p>
                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          margin: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        {result.yourRights.map((r, i) => (
                          <li
                            key={i}
                            className="t-caption1"
                            style={{ color: "var(--label-2)" }}
                          >
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* How to cancel */}
                {result.howToCancel && (
                  <div className="glass" style={{ padding: "16px 18px" }}>
                    <p
                      className="t-footnote"
                      style={{
                        color: "var(--label-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        marginBottom: 8,
                      }}
                    >
                      How to Cancel
                    </p>
                    <p
                      className="t-subhead"
                      style={{ color: "var(--label-2)", lineHeight: 1.6 }}
                    >
                      {result.howToCancel}
                    </p>
                  </div>
                )}

                {/* Content ownership */}
                {result.contentOwnership && (
                  <div className="glass" style={{ padding: "16px 18px" }}>
                    <p
                      className="t-footnote"
                      style={{
                        color: "var(--label-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        marginBottom: 8,
                      }}
                    >
                      Content Ownership
                    </p>
                    <p
                      className="t-subhead"
                      style={{ color: "var(--label-2)", lineHeight: 1.6 }}
                    >
                      {result.contentOwnership}
                    </p>
                  </div>
                )}

                <p
                  className="t-caption2"
                  style={{
                    color: "var(--label-4)",
                    textAlign: "center",
                    paddingBottom: 12,
                  }}
                >
                  Not legal advice. Powered by Claude AI. Know before you agree.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
