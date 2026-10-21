"use client";
import React, { useState, useEffect, useCallback } from "react";
import type { CulturePost } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

interface Props {
  dispatch: React.Dispatch<{ type: "OPEN_POST"; postId: string }>;
  style: React.CSSProperties;
}

const STYLE_TAGS = [
  "Hip-Hop", "Breaking", "Waacking", "Voguing", "House",
  "Krump", "Contemporary", "Popping", "Locking", "Afrobeats",
];

interface TrendingProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string | null;
}

interface ActiveCircle {
  id: string;
  name: string;
  handle: string;
  avatar_url: string | null;
  member_count: number;
}

export default function ExploreScreen({ dispatch, style }: Props) {
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [posts, setPosts] = useState<CulturePost[]>([]);
  const [allPosts, setAllPosts] = useState<CulturePost[]>([]);
  const [profiles, setProfiles] = useState<TrendingProfile[]>([]);
  const [circles, setCircles] = useState<ActiveCircle[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPosts = useCallback(async (styleTag?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (styleTag) params.set("style", styleTag);
      const res = await fetch(`/api/culture/posts?${params.toString()}`);
      const json = await res.json();
      if (json.posts) {
        setPosts(json.posts);
        if (!styleTag) setAllPosts(json.posts);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPosts();

    const supabase = createClient();

    // Load featured dancer profiles (verified users)
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url, role")
      .eq("is_verified_identity", true)
      .limit(12)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setProfiles(data);
        } else {
          // Fallback to any profiles if none verified
          supabase
            .from("profiles")
            .select("id, display_name, avatar_url, role")
            .limit(12)
            .then(({ data: fallback }) => { if (fallback) setProfiles(fallback); });
        }
      });

    // Load active circles sorted by member_count
    supabase
      .from("culture_circles")
      .select("id, name, handle, avatar_url, member_count")
      .eq("is_private", false)
      .order("member_count", { ascending: false })
      .limit(8)
      .then(({ data }) => { if (data) setCircles(data); });
  }, [loadPosts]);

  function handleTagToggle(tag: string) {
    if (activeTag === tag) {
      setActiveTag(null);
      setPosts(allPosts);
    } else {
      setActiveTag(tag);
      loadPosts(tag);
    }
  }

  const filtered = search
    ? posts.filter((p) => {
        const q = search.toLowerCase();
        return (
          p.content?.toLowerCase().includes(q) ||
          p.profiles?.display_name?.toLowerCase().includes(q) ||
          (p.styles || []).some((s) => s.toLowerCase().includes(q))
        );
      })
    : posts;

  return (
    <div style={{ ...style, background: "#050507", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ padding: "52px 14px 12px", position: "sticky", top: 0, zIndex: 10, background: "rgba(5,5,7,0.92)", backdropFilter: "blur(20px)" }}>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search dancers, styles, posts..."
            style={{ width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 12px 10px 36px", color: "#fff", fontSize: 13, outline: "none", boxSizing: "border-box" }}
          />
        </div>
        {/* Style tags */}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
          {STYLE_TAGS.map((tag) => (
            <button key={tag} onClick={() => handleTagToggle(tag)} style={{
              flexShrink: 0, padding: "5px 12px", borderRadius: 20,
              background: activeTag === tag ? "#7C3AED" : "rgba(255,255,255,0.06)",
              border: activeTag === tag ? "none" : "1px solid rgba(255,255,255,0.08)",
              color: activeTag === tag ? "#fff" : "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>{tag}</button>
          ))}
        </div>
      </div>

      {/* Featured Dancers */}
      {profiles.length > 0 && (
        <div style={{ padding: "16px 14px 8px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Featured Dancers</div>
          <div style={{ display: "flex", gap: 14, overflowX: "auto" }}>
            {profiles.map((u) => (
              <div key={u.id} style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{ width: 58, height: 58, borderRadius: "50%", overflow: "hidden", border: "2px solid #7C3AED", background: "rgba(124,58,237,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {u.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.avatar_url} alt={u.display_name || "Dancer"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.6)" strokeWidth="2">
                      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                    </svg>
                  )}
                </div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.7)", maxWidth: 60, textAlign: "center", lineHeight: 1.3 }}>
                  {(u.display_name || "Dancer").split(" ")[0]}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Circles */}
      {circles.length > 0 && (
        <div style={{ padding: "8px 14px 8px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Active Circles</div>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 2 }}>
            {circles.map((circle) => (
              <div key={circle.id} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "8px 12px", minWidth: 140 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", background: "rgba(124,58,237,0.25)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {circle.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={circle.avatar_url} alt={circle.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.6)" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>
                    </svg>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.85)", lineHeight: 1.3 }}>{circle.name}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{circle.member_count} member{circle.member_count !== 1 ? "s" : ""}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Posts grid */}
      <div style={{ padding: "8px 14px 16px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
          {activeTag ? `${activeTag} Posts` : search ? "Search Results" : "Trending Posts"}
        </div>

        {loading && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{ aspectRatio: "1", background: "rgba(255,255,255,0.05)" }} />
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "30px 0", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
            {search ? "No posts match your search" : "No posts yet"}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>
            {filtered.map((p) => (
              <button key={p.id} onClick={() => dispatch({ type: "OPEN_POST", postId: p.id })}
                style={{ aspectRatio: "1", overflow: "hidden", position: "relative", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                {p.media_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.media_url} alt={p.content} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(236,72,153,0.1))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.4)" strokeWidth="2">
                      <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                    </svg>
                  </div>
                )}
                <div style={{ position: "absolute", bottom: 4, left: 4, fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.8)", background: "rgba(0,0,0,0.5)", borderRadius: 10, padding: "2px 6px" }}>
                  {(p.likes_count ?? 0) >= 1000 ? `${((p.likes_count ?? 0) / 1000).toFixed(1)}k` : (p.likes_count ?? 0)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
