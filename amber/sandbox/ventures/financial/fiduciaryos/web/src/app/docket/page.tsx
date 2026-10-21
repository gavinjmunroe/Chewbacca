"use client";

import { useState, useRef } from "react";
import Nav from "@/components/nav";

interface ClauseAnalysis {
  clauseType: string;
  plainEnglish: string;
  meansForYou: string;
  redFlags: string[];
  standardVsNonStandard: {
    rating: "standard" | "slightly unusual" | "unusual" | "highly unusual";
    explanation: string;
  };
  questionsForLawyer: string[];
  negotiationLeverage: string;
}

const EXAMPLE_CLAUSES = [
  {
    label: "IP Assignment",
    text: "Employee hereby assigns to Company all right, title, and interest in and to any and all inventions, original works of authorship, developments, concepts, improvements, designs, discoveries, ideas, trademarks or trade secrets, whether or not patentable or registrable under copyright or similar laws, which Employee may solely or jointly conceive or develop or reduce to practice, or cause to be conceived or developed or reduced to practice, during the period of time Employee is in the employ of the Company.",
  },
  {
    label: "Non-Compete",
    text: "During the term of this Agreement and for a period of two (2) years following the termination of this Agreement for any reason, Employee shall not, directly or indirectly, engage in, own, manage, operate, control, be employed by, provide services to, participate in, or be connected with any business or enterprise that competes with the Company's business within the United States.",
  },
  {
    label: "Indemnification",
    text: "You agree to indemnify, defend, and hold harmless Company and its officers, directors, employees, agents, and successors from and against any and all losses, damages, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or relating to your use of the Service, your violation of these Terms, or your violation of any rights of a third party.",
  },
];

function ratingColor(rating: string): string {
  if (rating === "standard") return "var(--green)";
  if (rating === "slightly unusual") return "var(--yellow)";
  if (rating === "unusual") return "var(--orange)";
  return "var(--red)";
}

type AppState = "idle" | "loading" | "result" | "error";

export default function DocketPage() {
  const [clauseText, setClauseText] = useState("");
  const [appState, setAppState] = useState<AppState>("idle");
  const [analysis, setAnalysis] = useState<ClauseAnalysis | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const resultsRef = useRef<HTMLDivElement>(null);

  const handleAnalyze = async () => {
    if (!clauseText.trim()) return;
    setAppState("loading");
    setAnalysis(null);
    setErrorMessage("");

    try {
      const res = await fetch("/api/docket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clause: clauseText }),
      });

      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
      }

      const parsed = JSON.parse(accumulated) as ClauseAnalysis;
      setAnalysis(parsed);
      setAppState("result");

      setTimeout(() => {
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    } catch {
      setErrorMessage(
        "Could not analyze this clause. Check your connection and try again.",
      );
      setAppState("error");
    }
  };

  return (
    <>
      <Nav />
      <main
        className="app-bg"
        style={{ minHeight: "100dvh", paddingTop: 68, paddingBottom: 60 }}
      >
        <div style={{ maxWidth: 1020, margin: "0 auto", padding: "0 24px" }}>
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
              Docket
            </h1>
            <p className="t-body" style={{ color: "var(--label-2)" }}>
              Paste any contract clause and get a plain-English breakdown of
              what you are actually agreeing to.
            </p>
          </div>

          {/* Two-column layout */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
              gap: 16,
              alignItems: "start",
            }}
          >
            {/* Left: Input */}
            <div
              className="fade-up delay-1"
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div className="glass" style={{ padding: 20 }}>
                <p
                  className="t-footnote"
                  style={{
                    color: "var(--label-3)",
                    marginBottom: 12,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Paste your clause
                </p>
                <textarea
                  value={clauseText}
                  onChange={(e) => setClauseText(e.target.value)}
                  placeholder="Paste any legal clause, contract section, NDA provision, IP assignment, non-compete, or terms of service text here..."
                  aria-label="Legal clause input"
                  style={{
                    width: "100%",
                    minHeight: 220,
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
                    marginBottom: 12,
                  }}
                />
                <button
                  onClick={handleAnalyze}
                  disabled={!clauseText.trim() || appState === "loading"}
                  style={{
                    width: "100%",
                    padding: "12px 20px",
                    background:
                      !clauseText.trim() || appState === "loading"
                        ? "var(--surface-2)"
                        : "var(--blue)",
                    color:
                      !clauseText.trim() || appState === "loading"
                        ? "var(--label-3)"
                        : "#fff",
                    border: "none",
                    borderRadius: 10,
                    fontFamily: "var(--font)",
                    fontSize: 15,
                    fontWeight: 600,
                    cursor:
                      !clauseText.trim() || appState === "loading"
                        ? "not-allowed"
                        : "pointer",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  {appState === "loading"
                    ? "Analyzing clause..."
                    : "Explain This Clause"}
                </button>
              </div>

              {/* Examples */}
              <div className="glass" style={{ padding: "16px 18px" }}>
                <p
                  className="t-caption2"
                  style={{
                    color: "var(--label-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 10,
                  }}
                >
                  Try an example
                </p>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {EXAMPLE_CLAUSES.map((ex) => (
                    <button
                      key={ex.label}
                      onClick={() => {
                        setClauseText(ex.text);
                        setAppState("idle");
                        setAnalysis(null);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        background: "var(--surface-1)",
                        border: "0.5px solid var(--separator)",
                        borderRadius: 8,
                        color: "var(--label-2)",
                        fontFamily: "var(--font)",
                        fontSize: 14,
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "background 0.15s, color 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--surface-2)";
                        e.currentTarget.style.color = "var(--label)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "var(--surface-1)";
                        e.currentTarget.style.color = "var(--label-2)";
                      }}
                    >
                      <span>{ex.label} clause</span>
                      <span style={{ color: "var(--label-4)", fontSize: 12 }}>
                        &#8250;
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <p
                className="t-caption2"
                style={{
                  color: "var(--label-4)",
                  textAlign: "center",
                  fontStyle: "italic",
                }}
              >
                Not legal advice. For educational purposes only.
              </p>
            </div>

            {/* Right: Output */}
            <div className="fade-up delay-2" ref={resultsRef}>
              {appState === "idle" && (
                <div
                  className="glass"
                  style={{
                    padding: "60px 24px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    minHeight: 360,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      background: "var(--surface-2)",
                      borderRadius: 14,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 16,
                      fontSize: 22,
                    }}
                  >
                    &#x2696;
                  </div>
                  <p
                    className="t-headline"
                    style={{ color: "var(--label-2)", marginBottom: 6 }}
                  >
                    Paste a clause to decode it
                  </p>
                  <p
                    className="t-footnote"
                    style={{ color: "var(--label-3)", maxWidth: 240 }}
                  >
                    Supports NDAs, employment agreements, consulting contracts,
                    IP assignments, non-competes, and more.
                  </p>
                </div>
              )}

              {appState === "loading" && (
                <div className="glass" style={{ padding: 20, minHeight: 360 }}>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    {[120, 80, 100, 60, 90, 70].map((w, i) => (
                      <div
                        key={i}
                        className="skeleton"
                        style={{ height: 14, borderRadius: 6, width: `${w}%` }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {appState === "error" && (
                <div
                  className="glass"
                  style={{
                    padding: "48px 24px",
                    textAlign: "center",
                    borderColor: "rgba(255,69,58,0.3)",
                    minHeight: 360,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <p
                    className="t-headline"
                    style={{ color: "var(--label-2)", marginBottom: 8 }}
                  >
                    Analysis failed
                  </p>
                  <p
                    className="t-subhead"
                    style={{
                      color: "var(--label-3)",
                      marginBottom: 16,
                      maxWidth: 280,
                    }}
                  >
                    {errorMessage}
                  </p>
                  <button
                    onClick={handleAnalyze}
                    style={{
                      padding: "8px 20px",
                      background: "var(--surface-2)",
                      border: "0.5px solid var(--separator)",
                      borderRadius: 8,
                      color: "var(--label-2)",
                      fontFamily: "var(--font)",
                      fontSize: 14,
                      cursor: "pointer",
                    }}
                  >
                    Try again
                  </button>
                </div>
              )}

              {appState === "result" && analysis && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {/* Clause type + rating */}
                  <div className="glass" style={{ padding: "16px 20px" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        className="t-title3"
                        style={{ color: "var(--label)" }}
                      >
                        {analysis.clauseType}
                      </span>
                      <span
                        style={{
                          padding: "2px 9px",
                          borderRadius: 6,
                          background: "var(--surface-2)",
                          fontSize: 12,
                          color: ratingColor(
                            analysis.standardVsNonStandard.rating,
                          ),
                          fontFamily: "var(--font)",
                          fontWeight: 500,
                          textTransform: "capitalize",
                        }}
                      >
                        {analysis.standardVsNonStandard.rating}
                      </span>
                    </div>
                    <p
                      className="t-caption1"
                      style={{ color: "var(--label-3)", lineHeight: 1.5 }}
                    >
                      {analysis.standardVsNonStandard.explanation}
                    </p>
                  </div>

                  {/* Plain English */}
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
                      Plain English
                    </p>
                    <p
                      className="t-subhead"
                      style={{ color: "var(--label-2)", lineHeight: 1.6 }}
                    >
                      {analysis.plainEnglish}
                    </p>
                  </div>

                  {/* Means for you */}
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
                      What This Means for You
                    </p>
                    <p
                      className="t-subhead"
                      style={{ color: "var(--label-2)", lineHeight: 1.6 }}
                    >
                      {analysis.meansForYou}
                    </p>
                  </div>

                  {/* Red flags */}
                  {analysis.redFlags.length > 0 && (
                    <div
                      className="glass"
                      style={{
                        padding: "16px 20px",
                        borderColor: "rgba(255,69,58,0.25)",
                      }}
                    >
                      <p
                        className="t-caption2"
                        style={{
                          color: "var(--red)",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          marginBottom: 10,
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
                          gap: 6,
                        }}
                      >
                        {analysis.redFlags.map((flag, i) => (
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
                                color: "var(--red)",
                                fontSize: 10,
                                marginTop: 3,
                                flexShrink: 0,
                              }}
                            >
                              &#9679;
                            </span>
                            <p
                              className="t-caption1"
                              style={{ color: "var(--label-2)" }}
                            >
                              {flag}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Questions for lawyer */}
                  {analysis.questionsForLawyer.length > 0 && (
                    <div className="glass" style={{ padding: "16px 20px" }}>
                      <p
                        className="t-caption2"
                        style={{
                          color: "var(--label-3)",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          marginBottom: 10,
                        }}
                      >
                        Ask Your Lawyer
                      </p>
                      <ol
                        style={{
                          margin: 0,
                          paddingLeft: 18,
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        {analysis.questionsForLawyer.map((q, i) => (
                          <li
                            key={i}
                            className="t-caption1"
                            style={{ color: "var(--label-2)", lineHeight: 1.5 }}
                          >
                            {q}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Negotiation leverage */}
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
                      Negotiation Leverage
                    </p>
                    <p
                      className="t-caption1"
                      style={{ color: "var(--label-2)", lineHeight: 1.6 }}
                    >
                      {analysis.negotiationLeverage}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
