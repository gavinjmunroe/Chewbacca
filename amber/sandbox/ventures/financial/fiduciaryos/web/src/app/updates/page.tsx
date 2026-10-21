"use client";

import { useState, useCallback } from "react";
import Nav from "@/components/nav";

interface EmailSections {
  greeting: string;
  tldr: string;
  metrics: string;
  wins: string;
  challenges: string;
  asks: string;
  outlook: string;
  closing: string;
}

interface GenerateResult {
  subject: string;
  email: EmailSections;
  fullEmail: string;
  toneNotes: string;
  whatToIncludeNext: string[];
}

interface FormData {
  companyName: string;
  period: string;
  mrr: string;
  mrrGrowth: string;
  userCount: string;
  wins: string;
  challenge: string;
  asks: string;
  goals: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
      style={{
        padding: "4px 10px",
        background: "var(--surface-2)",
        border: "0.5px solid var(--separator)",
        borderRadius: 6,
        color: copied ? "var(--green)" : "var(--label-3)",
        fontFamily: "var(--font)",
        fontSize: 12,
        cursor: "pointer",
        transition: "color 0.15s",
        flexShrink: 0,
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CollapsibleSection({
  label,
  content,
  accentColor,
}: {
  label: string;
  content: string;
  accentColor: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        border: "0.5px solid var(--separator)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: open ? "var(--surface-1)" : "transparent",
          border: "none",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: accentColor,
              flexShrink: 0,
            }}
          />
          <span
            className="t-footnote"
            style={{ color: "var(--label-2)", fontWeight: 500 }}
          >
            {label}
          </span>
        </div>
        <span
          style={{
            color: "var(--label-4)",
            fontSize: 14,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.2s",
            display: "inline-block",
          }}
        >
          &#8964;
        </span>
      </button>
      {open && (
        <div
          style={{
            padding: "10px 16px 14px",
            borderTop: "0.5px solid var(--separator)",
          }}
        >
          <p
            className="t-caption1"
            style={{
              color: "var(--label-2)",
              lineHeight: 1.6,
              whiteSpace: "pre-line",
            }}
          >
            {content}
          </p>
        </div>
      )}
    </div>
  );
}

export default function UpdatesPage() {
  const [form, setForm] = useState<FormData>({
    companyName: "",
    period: "",
    mrr: "",
    mrrGrowth: "",
    userCount: "",
    wins: "",
    challenge: "",
    asks: "",
    goals: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);

  const handleChange = useCallback(
    (field: keyof FormData) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setForm((prev) => ({ ...prev, [field]: e.target.value }));
      },
    [],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!form.companyName.trim() || !form.period.trim()) {
        setError("Company name and period are required.");
        return;
      }
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const res = await fetch("/api/updates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });

        const json = (await res.json()) as
          | { data: GenerateResult }
          | { error: string };

        if (!res.ok || "error" in json) {
          setError(
            "error" in json ? json.error : "Something went wrong. Try again.",
          );
          return;
        }

        setResult(json.data);
      } catch {
        setError("Network error. Check your connection and try again.");
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

  const sectionDot: Record<string, string> = {
    TLdr: "var(--blue)",
    Metrics: "var(--green)",
    Wins: "var(--purple)",
    Challenges: "var(--orange)",
    Asks: "var(--red)",
    Outlook: "var(--blue)",
  };

  return (
    <>
      <Nav />
      <main
        className="app-bg"
        style={{ minHeight: "100dvh", paddingTop: 68, paddingBottom: 60 }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 24px" }}>
          {/* Header */}
          <div className="fade-up" style={{ marginBottom: 28, paddingTop: 28 }}>
            <p
              className="t-footnote"
              style={{ color: "var(--label-3)", marginBottom: 4 }}
            >
              Investor Relations
            </p>
            <h1
              className="t-large-title"
              style={{ color: "var(--label)", marginBottom: 6 }}
            >
              Updates
            </h1>
            <p className="t-body" style={{ color: "var(--label-2)" }}>
              Metrics, wins, challenges, asks. Get a polished investor update
              that builds trust and drives action.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate>
            {/* Basics */}
            <div
              className="glass fade-up delay-1"
              style={{ padding: 20, marginBottom: 12 }}
            >
              <p
                className="t-caption2"
                style={{
                  color: "var(--label-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 14,
                }}
              >
                The basics
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div>
                  <label htmlFor="companyName" style={labelStyle}>
                    Company name *
                  </label>
                  <input
                    id="companyName"
                    value={form.companyName}
                    onChange={handleChange("companyName")}
                    placeholder="Acme Inc."
                    style={inputStyle}
                    aria-required="true"
                  />
                </div>
                <div>
                  <label htmlFor="period" style={labelStyle}>
                    Period *
                  </label>
                  <input
                    id="period"
                    value={form.period}
                    onChange={handleChange("period")}
                    placeholder="April 2026 / Q1 2026"
                    style={inputStyle}
                    aria-required="true"
                  />
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div
              className="glass fade-up delay-1"
              style={{ padding: 20, marginBottom: 12 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <p
                  className="t-caption2"
                  style={{
                    color: "var(--label-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Key metrics
                </p>
                <p className="t-caption2" style={{ color: "var(--label-4)" }}>
                  All optional
                </p>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 12,
                }}
              >
                <div>
                  <label htmlFor="mrr" style={labelStyle}>
                    MRR ($)
                  </label>
                  <input
                    id="mrr"
                    value={form.mrr}
                    onChange={handleChange("mrr")}
                    placeholder="42,000"
                    style={inputStyle}
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label htmlFor="mrrGrowth" style={labelStyle}>
                    MoM growth (%)
                  </label>
                  <input
                    id="mrrGrowth"
                    value={form.mrrGrowth}
                    onChange={handleChange("mrrGrowth")}
                    placeholder="18"
                    style={inputStyle}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <label htmlFor="userCount" style={labelStyle}>
                    Active users
                  </label>
                  <input
                    id="userCount"
                    value={form.userCount}
                    onChange={handleChange("userCount")}
                    placeholder="1,240"
                    style={inputStyle}
                    inputMode="numeric"
                  />
                </div>
              </div>
            </div>

            {/* Story */}
            <div
              className="glass fade-up delay-2"
              style={{ padding: 20, marginBottom: 12 }}
            >
              <p
                className="t-caption2"
                style={{
                  color: "var(--label-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 14,
                }}
              >
                The story
              </p>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <div>
                  <label htmlFor="wins" style={labelStyle}>
                    Top 3 wins this period
                  </label>
                  <textarea
                    id="wins"
                    value={form.wins}
                    onChange={handleChange("wins")}
                    placeholder={
                      "Signed first enterprise customer ($8K ARR)\nShipped mobile app to 500 beta users\nHired VP of Sales from Stripe"
                    }
                    style={{
                      ...inputStyle,
                      minHeight: 88,
                      resize: "none",
                      lineHeight: 1.5,
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="challenge" style={labelStyle}>
                    Main challenge
                  </label>
                  <textarea
                    id="challenge"
                    value={form.challenge}
                    onChange={handleChange("challenge")}
                    placeholder="Churn is higher than expected at 8% MoM. Root cause: onboarding drop-off in the first 48 hours."
                    style={{
                      ...inputStyle,
                      minHeight: 72,
                      resize: "none",
                      lineHeight: 1.5,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Asks and goals */}
            <div
              className="glass fade-up delay-2"
              style={{ padding: 20, marginBottom: 16 }}
            >
              <p
                className="t-caption2"
                style={{
                  color: "var(--label-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 14,
                }}
              >
                Asks and outlook
              </p>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <div>
                  <label htmlFor="asks" style={labelStyle}>
                    What you need from investors
                  </label>
                  <textarea
                    id="asks"
                    value={form.asks}
                    onChange={handleChange("asks")}
                    placeholder={
                      "Intros to B2B SaaS operators at Series A stage\nPortfolio companies that struggled with onboarding we can learn from"
                    }
                    style={{
                      ...inputStyle,
                      minHeight: 72,
                      resize: "none",
                      lineHeight: 1.5,
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="goals" style={labelStyle}>
                    Next period goals
                  </label>
                  <textarea
                    id="goals"
                    value={form.goals}
                    onChange={handleChange("goals")}
                    placeholder={
                      "Hit $55K MRR\nReduce churn to under 4%\nLaunch self-serve onboarding flow"
                    }
                    style={{
                      ...inputStyle,
                      minHeight: 72,
                      resize: "none",
                      lineHeight: 1.5,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  padding: "12px 14px",
                  background: "var(--red-dim)",
                  border: "0.5px solid rgba(255,69,58,0.3)",
                  borderRadius: 8,
                  marginBottom: 12,
                }}
                role="alert"
              >
                <p className="t-subhead" style={{ color: "var(--red)" }}>
                  {error}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="fade-up delay-2"
              style={{
                width: "100%",
                padding: "13px 20px",
                background: loading ? "var(--surface-2)" : "var(--blue)",
                color: loading ? "var(--label-3)" : "#fff",
                border: "none",
                borderRadius: 10,
                fontFamily: "var(--font)",
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "background 0.15s, color 0.15s",
                marginBottom: 32,
              }}
            >
              {loading ? "Writing your update..." : "Write Update"}
            </button>
          </form>

          {/* Results */}
          {result && (
            <div
              className="fade-up"
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div
                style={{
                  height: "0.5px",
                  background: "var(--separator)",
                  marginBottom: 4,
                }}
              />

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--blue)",
                  }}
                />
                <p className="t-headline" style={{ color: "var(--label)" }}>
                  Your investor update
                </p>
              </div>

              {/* Subject line */}
              <div className="glass" style={{ padding: "16px 18px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <p
                    className="t-caption2"
                    style={{
                      color: "var(--label-3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Subject line
                  </p>
                  <CopyButton text={result.subject} />
                </div>
                <p
                  className="t-subhead"
                  style={{
                    color: "var(--label)",
                    fontFamily: "monospace",
                    lineHeight: 1.5,
                  }}
                >
                  {result.subject}
                </p>
              </div>

              {/* Full email */}
              <div className="glass" style={{ padding: "16px 18px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <p
                    className="t-caption2"
                    style={{
                      color: "var(--label-3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Complete email
                  </p>
                  <CopyButton text={result.fullEmail} />
                </div>
                <pre
                  style={{
                    fontFamily: "var(--font)",
                    fontSize: 13,
                    color: "var(--label-2)",
                    lineHeight: 1.65,
                    whiteSpace: "pre-wrap",
                    margin: 0,
                    wordBreak: "break-word",
                  }}
                >
                  {result.fullEmail}
                </pre>
              </div>

              {/* Section breakdown */}
              <div>
                <p
                  className="t-caption2"
                  style={{
                    color: "var(--label-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 8,
                  }}
                >
                  Section breakdown
                </p>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  {(
                    [
                      {
                        label: "TL;DR",
                        content: result.email.tldr,
                        key: "TLdr",
                      },
                      {
                        label: "Metrics",
                        content: result.email.metrics,
                        key: "Metrics",
                      },
                      {
                        label: "Wins",
                        content: result.email.wins,
                        key: "Wins",
                      },
                      {
                        label: "Challenges",
                        content: result.email.challenges,
                        key: "Challenges",
                      },
                      {
                        label: "Asks",
                        content: result.email.asks,
                        key: "Asks",
                      },
                      {
                        label: "Outlook",
                        content: result.email.outlook,
                        key: "Outlook",
                      },
                    ] as const
                  ).map((s) => (
                    <CollapsibleSection
                      key={s.key}
                      label={s.label}
                      content={s.content}
                      accentColor={sectionDot[s.key] ?? "var(--blue)"}
                    />
                  ))}
                </div>
              </div>

              {/* Tone notes */}
              <div className="glass" style={{ padding: "14px 16px" }}>
                <p
                  className="t-caption2"
                  style={{
                    color: "var(--label-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 8,
                  }}
                >
                  Tone notes
                </p>
                <p
                  className="t-caption1"
                  style={{
                    color: "var(--label-3)",
                    fontStyle: "italic",
                    lineHeight: 1.6,
                  }}
                >
                  {result.toneNotes}
                </p>
              </div>

              {/* What to include next */}
              {result.whatToIncludeNext.length > 0 && (
                <div>
                  <p
                    className="t-caption2"
                    style={{
                      color: "var(--label-3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      marginBottom: 8,
                    }}
                  >
                    Add to your next update
                  </p>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {result.whatToIncludeNext.map((item, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          gap: 12,
                          padding: "12px 14px",
                          background: "rgba(255,159,10,0.06)",
                          border: "0.5px solid rgba(255,159,10,0.2)",
                          borderRadius: 8,
                          alignItems: "flex-start",
                        }}
                      >
                        <span
                          style={{
                            color: "var(--orange)",
                            fontSize: 11,
                            fontWeight: 700,
                            flexShrink: 0,
                            marginTop: 1,
                            fontFamily: "var(--font)",
                          }}
                        >
                          {i + 1}
                        </span>
                        <p
                          className="t-caption1"
                          style={{ color: "var(--label-2)", lineHeight: 1.5 }}
                        >
                          {item}
                        </p>
                      </div>
                    ))}
                  </div>
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
                Generated for {form.companyName} &bull; {form.period}
              </p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
