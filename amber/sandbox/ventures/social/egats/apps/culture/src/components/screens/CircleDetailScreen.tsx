"use client";
import React, { useState, useEffect, useCallback } from "react";
import type { CultureCircle, CulturePost } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

interface Props {
  circleId: string;
  dispatch: React.Dispatch<{ type: "GO_BACK" } | { type: "OPEN_POST"; postId: string }>;
  style: React.CSSProperties;
}

const CIRCLE_COLORS = [
  "#7C3AED", "#DB2777", "#EA580C", "#DC2626",
  "#BE185D", "#0891B2", "#D97706", "#059669",
];

function getCircleColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return CIRCLE_COLORS[Math.abs(hash) % CIRCLE_COLORS.length];
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
}

export default function CircleDetailScreen({ circleId, dispatch, style }: Props) {
  const [circle, setCircle] = useState<CultureCircle | null>(null);
  const [posts, setPosts] = useState<CulturePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const loadCirclePosts = useCallback(async () => {
    try {
      const r = await fetch(`/api/culture/posts?circle_id=${circleId}`);
      const json = await r.json();
      if (json.error) setError(json.error);
      else if (json.posts) setPosts(json.posts.slice(0, 6));
    } catch {
      setError("Failed to load circle posts");
    } finally {
      setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    const supabase = createClient();

    // Get user
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setCurrentUserId(data.user.id);
        // Check membership
        supabase
          .from("culture_circle_members")
          .select("circle_id")
          .eq("circle_id", circleId)
          .eq("user_id", data.user.id)
          .single()
          .then(({ data: m }) => { if (m) setJoined(true); });
      }
    });

    // Load circle
    supabase
      .from("culture_circles")
      .select("id, name, description, cover_url, member_count, created_by, created_at")
      .eq("id", circleId)
      .single()
      .then(({ data, error: circleError }) => {
        if (circleError) setError("Failed to load circle");
        else if (data) setCircle(data);
      });

    loadCirclePosts();
  }, [circleId, loadCirclePosts]);

  async function handleJoin() {
    if (!currentUserId || joining || joined) return;
    setJoining(true);
    try {
      const res = await fetch(`/api/culture/circles/${circleId}/join`, { method: "POST" });
      if (res.ok) {
        setJoined(true);
        setCircle((c) => c ? { ...c, member_count: (c.member_count ?? 0) + 1 } : c);
      }
    } finally {
      setJoining(false);
    }
  }

  const color = getCircleColor(circleId);

  return (
    <div style={{ ...style, background: "#050507", overflowY: "auto" }}>
      {/* Back button */}
      <div style={{ padding: "52px 14px 0", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => dispatch({ type: "GO_BACK" })} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
        </button>
      </div>

      {/* Banner */}
      {circle ? (
        <div style={{ margin: "16px 14px 0", borderRadius: 16, overflow: "hidden", background: color + "22", border: "1px solid " + color + "44", padding: "20px 18px" }}>
          <div style={{ marginBottom: 10, color }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="9" cy="12" r="4"/><circle cx="17" cy="8" r="3"/><circle cx="17" cy="16" r="3"/>
            </svg>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 4 }}>{circle.name}</h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.6, marginBottom: 16 }}>
            {circle.description || "A community of dancers"}
          </p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", display: "flex", alignItems: "center", gap: 5 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              {(circle.member_count ?? 0).toLocaleString()} members
            </div>
            {currentUserId && (
              <button
                onClick={handleJoin}
                disabled={joining || joined}
                style={{ padding: "8px 20px", borderRadius: 20, background: joined ? "rgba(168,85,247,0.2)" : color, border: joined ? "1px solid rgba(168,85,247,0.4)" : "none", color: joined ? "#A855F7" : "#fff", fontSize: 13, fontWeight: 700, cursor: joining || joined ? "default" : "pointer", opacity: joining ? 0.6 : 1 }}>
                {joined ? "Joined" : joining ? "Joining..." : "Join Circle"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ margin: "16px 14px 0", borderRadius: 16, height: 160, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }} />
      )}

      {/* Posts from this circle */}
      <div style={{ padding: "20px 14px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Circle Posts</div>

        {/* Error state */}
        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#EF4444" }}>{error}</div>
          </div>
        )}

        {loading && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ aspectRatio: "1", borderRadius: 12, background: "rgba(255,255,255,0.05)" }} />
            ))}
          </div>
        )}

        {!loading && posts.length === 0 && (
          <div style={{ textAlign: "center", padding: "30px 0", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
            No posts in this circle yet.
          </div>
        )}

        {!loading && posts.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {posts.map((p) => (
              <button key={p.id} onClick={() => dispatch({ type: "OPEN_POST", postId: p.id })}
                style={{ aspectRatio: "1", overflow: "hidden", background: "none", border: "none", cursor: "pointer", padding: 0, borderRadius: 12, position: "relative" }}>
                {p.media_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.media_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(236,72,153,0.1))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.4)" strokeWidth="2">
                      <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                    </svg>
                  </div>
                )}
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.7))", padding: "8px 8px 6px" }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.8)", fontWeight: 600, display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {p.profiles?.display_name || "Unknown"}
                  </div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{timeAgo(p.created_at)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
