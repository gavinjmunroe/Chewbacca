"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { FinancialProfile } from "@/lib/types";
import { RiskLevel, TaxHarvestCandidate } from "@/lib/unified-types";

function renderMd(text: string): ReactNode[] {
  return text.split("\n").map((line, li) => {
    const isBullet = /^[-*]\s/.test(line);
    const content = isBullet ? line.replace(/^[-*]\s/, "") : line;
    const parts: ReactNode[] = [];
    let rest = content;
    let key = 0;
    while (rest) {
      const m = rest.match(/\*\*(.+?)\*\*/);
      if (!m || m.index === undefined) { parts.push(rest); break; }
      if (m.index > 0) parts.push(rest.slice(0, m.index));
      parts.push(<strong key={key++} style={{ fontWeight: 600, color: "inherit" }}>{m[1]}</strong>);
      rest = rest.slice(m.index + m[0].length);
    }
    if (isBullet) return <div key={li} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><span style={{ color: "var(--label-3)", flexShrink: 0, marginTop: 1 }}>·</span><span>{parts}</span></div>;
    if (!content.trim()) return <div key={li} style={{ height: 6 }} />;
    return <div key={li}>{parts}</div>;
  });
}

const SUGGESTED = [
  "What should I contribute each month?",
  "Am I optimizing my tax strategy?",
  "How do my tax harvest opportunities affect my returns?",
  "What is my risk level and what does it mean?",
];

interface Props {
  profile: FinancialProfile;
  riskLevel?: RiskLevel;
  riskAlerts?: string[];
  harvestCandidates?: TaxHarvestCandidate[];
  portfolioTotalUsd?: number;
}

interface Message {
  role: "user" | "assistant";
  text: string;
}

export default function AgentPanel({ profile, riskLevel, riskAlerts, harvestCandidates, portfolioTotalUsd }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, profile, riskLevel, riskAlerts, harvestCandidates, portfolioTotalUsd }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "assistant", text: data.answer ?? "Unable to get a response." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Network error — please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 className="t-headline" style={{ color: "var(--label)" }}>Ask the Fiduciary Advisor</h2>

      {messages.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {SUGGESTED.map((q) => (
            <button
              key={q}
              onClick={() => ask(q)}
              style={{
                textAlign: "left", padding: "10px 14px",
                background: "var(--surface-2)", border: "1px solid var(--separator)",
                borderRadius: 10, color: "var(--label-2)", fontSize: 14,
                fontFamily: "var(--font)", cursor: "pointer",
                transition: "border-color 0.15s, color 0.15s",
                letterSpacing: "-0.24px",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(10,132,255,0.4)"; e.currentTarget.style.color = "var(--label)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--separator)"; e.currentTarget.style.color = "var(--label-2)"; }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 320, overflowY: "auto" }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div
                className="t-subhead"
                style={{
                  padding: "9px 13px",
                  borderRadius: m.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                  background: m.role === "user" ? "var(--blue)" : "var(--surface-2)",
                  color: m.role === "user" ? "#fff" : "var(--label)",
                  maxWidth: "88%",
                  lineHeight: 1.6,
                }}
              >
                {m.role === "assistant" ? renderMd(m.text) : m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ alignSelf: "flex-start" }}>
              <div style={{ padding: "9px 13px", borderRadius: "12px 12px 12px 4px", background: "var(--surface-2)" }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--label-3)", animation: `typingBounce 1.2s ease ${i * 0.2}s infinite` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your fiduciary advisor…"
          style={{
            flex: 1, padding: "10px 14px",
            background: "var(--surface-2)", border: "1px solid var(--separator)",
            borderRadius: 10, color: "var(--label)", fontSize: 14,
            fontFamily: "var(--font)", outline: "none", letterSpacing: "-0.24px",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => (e.target.style.borderColor = "rgba(10,132,255,0.5)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--separator)")}
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          style={{
            padding: "10px 16px", borderRadius: 10,
            background: input.trim() && !loading ? "var(--blue)" : "var(--surface-2)",
            color: input.trim() && !loading ? "#fff" : "var(--label-3)",
            border: "none", cursor: input.trim() && !loading ? "pointer" : "not-allowed",
            fontSize: 14, fontWeight: 600, fontFamily: "var(--font)",
            transition: "background 0.15s, color 0.15s",
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
