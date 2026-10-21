"use client";
import React, { useState, useEffect, useCallback } from "react";
import type { CultureCircle } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

interface Props {
  dispatch: React.Dispatch<{ type: "OPEN_CIRCLE"; circleId: string } | { type: "OPEN_CHALLENGES" }>;
  style: React.CSSProperties;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CIRCLE_COLORS = [
  "#7C3AED", "#DB2777", "#EA580C", "#DC2626",
  "#BE185D", "#0891B2", "#D97706", "#059669",
];

function getCircleColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return CIRCLE_COLORS[Math.abs(hash) % CIRCLE_COLORS.length];
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function CircleIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <circle cx="9" cy="12" r="4"/><circle cx="17" cy="8" r="3"/><circle cx="17" cy="16" r="3"/>
    </svg>
  );
}

function UsersIcon() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}

function TrophyIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="8 21 12 17 16 21"/><line x1="12" y1="17" x2="12" y2="11"/><path d="M7 4H4a2 2 0 0 0-2 2v3c0 1.5.5 3 2 4h16c1.5-1 2-2.5 2-4V6a2 2 0 0 0-2-2h-3"/><rect x="7" y="2" width="10" height="5" rx="1"/></svg>;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CircleSkeleton() {
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(255,255,255,0.07)", flexShrink: 0 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ width: 140, height: 14, borderRadius: 6, background: "rgba(255,255,255,0.07)" }} />
        <div style={{ width: 200, height: 10, borderRadius: 6, background: "rgba(255,255,255,0.05)" }} />
        <div style={{ width: 80, height: 10, borderRadius: 6, background: "rgba(255,255,255,0.05)" }} />
      </div>
    </div>
  );
}

// ─── Circle Card ──────────────────────────────────────────────────────────────

function CircleCard({
  circle,
  color,
  onOpen,
  joined,
  onJoin,
  joining,
}: {
  circle: CultureCircle;
  color: string;
  onOpen: () => void;
  joined: boolean;
  onJoin: () => void;
  joining: boolean;
}) {
  return (
    <button
      onClick={onOpen}
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "14px 16px", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 14, width: "100%" }}
    >
      <div style={{ width: 48, height: 48, borderRadius: 14, background: color + "33", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <CircleIcon color={color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 3 }}>{circle.name}</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {circle.description || "A community of dancers"}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", display: "flex", alignItems: "center", gap: 3 }}>
            <UsersIcon /> {(circle.member_count ?? 0).toLocaleString()} members
          </span>
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onJoin(); }}
        disabled={joining || joined}
        style={{
          flexShrink: 0, padding: "6px 14px", borderRadius: 20,
          background: joined ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.08)",
          border: joined ? "1px solid rgba(168,85,247,0.4)" : "1px solid rgba(255,255,255,0.1)",
          color: joined ? "#A855F7" : "rgba(255,255,255,0.6)",
          fontSize: 11, fontWeight: 600, cursor: joining || joined ? "default" : "pointer",
          opacity: joining ? 0.6 : 1,
        }}>
        {joined ? "Joined" : joining ? "..." : "Join"}
      </button>
    </button>
  );
}

// ─── Circles Screen ───────────────────────────────────────────────────────────

export default function CirclesScreen({ dispatch, style }: Props) {
  const [circles, setCircles] = useState<CultureCircle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joinedCircles, setJoinedCircles] = useState<Set<string>>(new Set());
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const loadCircles = useCallback(async () => {
    try {
      const r = await fetch("/api/culture/circles");
      const json = await r.json();
      if (json.error) setError(json.error);
      else setCircles(json.circles);
    } catch {
      setError("Failed to load circles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Get user
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setCurrentUserId(data.user.id);
        // Load joined circles
        supabase
          .from("culture_circle_members")
          .select("circle_id")
          .eq("user_id", data.user.id)
          .then(({ data: memberships }) => {
            if (memberships) {
              setJoinedCircles(new Set(memberships.map((m) => m.circle_id)));
            }
          });
      }
    });

    loadCircles();
  }, [loadCircles]);

  async function handleJoin(circleId: string) {
    if (!currentUserId || joiningId) return;
    setJoiningId(circleId);
    try {
      const res = await fetch(`/api/culture/circles/${circleId}/join`, { method: "POST" });
      if (res.ok) {
        setJoinedCircles((prev) => new Set([...prev, circleId]));
        setCircles((prev) =>
          prev.map((c) => c.id === circleId ? { ...c, member_count: (c.member_count ?? 0) + 1 } : c)
        );
      }
    } finally {
      setJoiningId(null);
    }
  }

  // "My circles" = first 3 joined or first 3 total if none joined
  const myCircles = circles.filter((c) => joinedCircles.has(c.id)).slice(0, 3);
  const displayMyCircles = myCircles.length > 0 ? myCircles : circles.slice(0, 3);

  return (
    <div style={{ ...style, background: "#050507", overflowY: "auto" }}>
      <div style={{ padding: "52px 14px 12px" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 4 }}>Circles</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 20 }}>Crews, cities, and style communities</div>

        {/* Challenges CTA */}
        <button
          onClick={() => dispatch({ type: "OPEN_CHALLENGES" })}
          style={{ width: "100%", background: "linear-gradient(135deg, rgba(124,58,237,0.3), rgba(236,72,153,0.2))", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 16, padding: "16px 18px", marginBottom: 24, textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#A855F7" }}><TrophyIcon /></span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Active Challenges</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Post to challenges that require explanation clips</div>
            </div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>

        {/* My Circles row */}
        {!loading && displayMyCircles.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
              {joinedCircles.size > 0 ? "Your Circles" : "Featured Circles"}
            </div>
            <div style={{ display: "flex", gap: 14, overflowX: "auto" }}>
              {displayMyCircles.map((circle) => {
                const color = getCircleColor(circle.id);
                return (
                  <button key={circle.id} onClick={() => dispatch({ type: "OPEN_CIRCLE", circleId: circle.id })}
                    style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer" }}>
                    <div style={{ width: 64, height: 64, borderRadius: 18, background: color + "33", border: "2px solid " + color + "66", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <CircleIcon color={color} />
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.6)", maxWidth: 70, textAlign: "center", lineHeight: 1.3 }}>{circle.name}</div>
                  </button>
                );
              })}
              <button style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer" }}>
                <div style={{ width: 64, height: 64, borderRadius: 18, background: "rgba(255,255,255,0.05)", border: "2px dashed rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: "rgba(255,255,255,0.3)" }}>+</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>New Circle</div>
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#EF4444" }}>{error}</div>
          </div>
        )}

        {/* Discover Circles */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Discover Circles</div>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="sr-only" aria-live="polite">Loading circles...</span>
            <CircleSkeleton />
            <CircleSkeleton />
            <CircleSkeleton />
          </div>
        ) : circles.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
            No circles yet. Be the first to create one.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {circles.map((circle) => {
              const color = getCircleColor(circle.id);
              return (
                <CircleCard
                  key={circle.id}
                  circle={circle}
                  color={color}
                  onOpen={() => dispatch({ type: "OPEN_CIRCLE", circleId: circle.id })}
                  joined={joinedCircles.has(circle.id)}
                  onJoin={() => handleJoin(circle.id)}
                  joining={joiningId === circle.id}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
