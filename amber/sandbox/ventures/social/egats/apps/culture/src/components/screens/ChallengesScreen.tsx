"use client";
import React, { useState, useEffect, useCallback } from "react";
import type { CultureChallenge } from "@/lib/types";

interface Props {
  dispatch: React.Dispatch<{ type: "GO_BACK" } | { type: "SET_TAB"; tab: "create" } | { type: "OPEN_CHALLENGE_CREATE"; challenge: CultureChallenge }>;
  style: React.CSSProperties;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHALLENGE_COLORS = [
  "#7C3AED", "#DB2777", "#059669", "#D97706",
  "#0891B2", "#DC2626", "#BE185D", "#EA580C",
];

function getChallengeColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return CHALLENGE_COLORS[Math.abs(hash) % CHALLENGE_COLORS.length];
}

function daysRemaining(endDate: string | null): number | null {
  if (!endDate) return null;
  const now = Date.now();
  const end = new Date(endDate).getTime();
  const diff = Math.floor((end - now) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ChallengeSkeleton() {
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, overflow: "hidden" }}>
      <div style={{ height: 6, background: "rgba(255,255,255,0.07)" }} />
      <div style={{ padding: "16px 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ width: 180, height: 18, borderRadius: 6, background: "rgba(255,255,255,0.07)" }} />
        <div style={{ width: "90%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.05)" }} />
        <div style={{ width: "70%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.05)" }} />
        <div style={{ height: 60, borderRadius: 10, background: "rgba(255,255,255,0.05)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ width: 80, height: 12, borderRadius: 6, background: "rgba(255,255,255,0.05)" }} />
          <div style={{ width: 70, height: 32, borderRadius: 20, background: "rgba(255,255,255,0.07)" }} />
        </div>
      </div>
    </div>
  );
}

// ─── Challenge Card ───────────────────────────────────────────────────────────

function ChallengeCard({
  challenge,
  color,
  submitting,
  onSubmitEntry,
}: {
  challenge: CultureChallenge;
  color: string;
  submitting: boolean;
  onSubmitEntry: () => void;
}) {
  const days = daysRemaining(challenge.end_date);
  const urgent = days !== null && days <= 3;

  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, overflow: "hidden" }}>
      <div style={{ height: 6, background: color }} />
      <div style={{ padding: "16px 16px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 4 }}>{challenge.title}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{challenge.description}</div>
          </div>
          <div style={{ flexShrink: 0, textAlign: "right" }}>
            {days !== null && (
              <div style={{ fontSize: 11, fontWeight: 700, color: urgent ? "#EF4444" : "rgba(255,255,255,0.4)" }}>
                {days === 0 ? "Ends today" : `${days}d left`}
              </div>
            )}
            {challenge.prize && (
              <div style={{ fontSize: 10, color: "#EAB308", marginTop: 2 }}>
                {challenge.prize}
              </div>
            )}
          </div>
        </div>

        <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: color, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>The Challenge</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
            Two clips required: your performance + an explanation of your inspiration, influences, and credits.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            {(challenge.entry_count ?? 0).toLocaleString()} entries
          </span>
          <button
            onClick={onSubmitEntry}
            disabled={submitting}
            style={{
              padding: "8px 16px", borderRadius: 20,
              background: submitting ? "rgba(255,255,255,0.1)" : color,
              border: "none", color: submitting ? "rgba(255,255,255,0.4)" : "#fff",
              fontSize: 12, fontWeight: 700,
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.7 : 1,
            }}>
            {submitting ? "Opening…" : "Submit Entry"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Challenges Screen ────────────────────────────────────────────────────────

export default function ChallengesScreen({ dispatch, style }: Props) {
  const [challenges, setChallenges] = useState<CultureChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const loadChallenges = useCallback(async () => {
    try {
      const r = await fetch("/api/culture/challenges?active=true");
      const json = await r.json();
      if (json.error) setError(json.error);
      else setChallenges(json.challenges);
    } catch {
      setError("Failed to load challenges");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChallenges();
  }, [loadChallenges]);

  function handleSubmitEntry(challenge: CultureChallenge) {
    setSubmittingId(challenge.id);
    // Pass challenge to CreateScreen via the parent AppShell dispatcher
    dispatch({ type: "OPEN_CHALLENGE_CREATE", challenge });
    // Reset submitting state after brief delay (navigation will happen)
    setTimeout(() => setSubmittingId(null), 500);
  }

  return (
    <div style={{ ...style, background: "#050507", overflowY: "auto" }}>
      <div style={{ padding: "52px 14px 12px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 4 }}>
          <button
            onClick={() => dispatch({ type: "GO_BACK" })}
            style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
          </button>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>Challenges</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Every challenge requires an explanation clip</div>
          </div>
        </div>

        {/* EGATS Culture Rule banner */}
        <div style={{ background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 12, padding: "12px 14px", marginBottom: 20, marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#A855F7", marginBottom: 4 }}>The EGATS Culture Rule</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
            All challenges require two clips. Posting just a dance is not allowed. Context, credit, and explanation are the point.
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#EF4444" }}>{error}</div>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span className="sr-only" aria-live="polite">Loading challenges...</span>
            <ChallengeSkeleton />
            <ChallengeSkeleton />
            <ChallengeSkeleton />
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && challenges.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 6 }}>No active challenges</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Check back soon for new community challenges.</div>
          </div>
        )}

        {/* Challenge cards */}
        {!loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {challenges.map((ch) => (
              <ChallengeCard
                key={ch.id}
                challenge={ch}
                color={getChallengeColor(ch.id)}
                submitting={submittingId === ch.id}
                onSubmitEntry={() => handleSubmitEntry(ch)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
