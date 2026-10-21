"use client";
import React, { useState, useEffect, useCallback } from "react";
import type { CulturePost } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

interface Props {
  dispatch: React.Dispatch<{ type: "OPEN_POST"; postId: string }>;
  style: React.CSSProperties;
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function PostSkeleton() {
  return (
    <div style={{ marginBottom: 1, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 8px" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.07)", flexShrink: 0 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ width: 120, height: 12, borderRadius: 6, background: "rgba(255,255,255,0.07)" }} />
          <div style={{ width: 80, height: 10, borderRadius: 6, background: "rgba(255,255,255,0.05)" }} />
        </div>
      </div>
      <div style={{ aspectRatio: "1", background: "rgba(255,255,255,0.05)" }} />
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ width: 50, height: 16, borderRadius: 6, background: "rgba(255,255,255,0.07)" }} />
          <div style={{ width: 40, height: 16, borderRadius: 6, background: "rgba(255,255,255,0.07)" }} />
        </div>
        <div style={{ width: "80%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.05)" }} />
        <div style={{ width: "60%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.05)" }} />
      </div>
    </div>
  );
}

// ─── Post Card ────────────────────────────────────────────────────────────────

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

function PostCard({ post, onOpen, currentUserId }: { post: CulturePost; onOpen: () => void; currentUserId: string | null }) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes_count ?? 0);
  const [showExplanation, setShowExplanation] = useState(false);
  const [liking, setLiking] = useState(false);

  const displayName = post.profiles?.display_name || "Unknown Dancer";
  const avatarUrl = post.profiles?.avatar_url;
  const styles: string[] = post.styles || [];

  async function handleLike() {
    if (!currentUserId || liking) return;
    setLiking(true);

    // Optimistic update — update UI immediately before API call
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikeCount((c) => wasLiked ? Math.max(0, c - 1) : c + 1);

    const supabase = createClient();
    if (wasLiked) {
      // Unlike
      await supabase
        .from("culture_post_likes")
        .delete()
        .eq("post_id", post.id)
        .eq("user_id", currentUserId);

      await supabase
        .from("culture_posts")
        .update({ likes_count: Math.max(0, likeCount - 1) })
        .eq("id", post.id);
    } else {
      // Like
      await supabase
        .from("culture_post_likes")
        .upsert({ post_id: post.id, user_id: currentUserId });

      await supabase
        .from("culture_posts")
        .update({ likes_count: likeCount + 1 })
        .eq("id", post.id);
    }
    setLiking(false);
  }

  // Check if user already liked
  useEffect(() => {
    if (!currentUserId) return;
    const supabase = createClient();
    supabase
      .from("culture_post_likes")
      .select("post_id")
      .eq("post_id", post.id)
      .eq("user_id", currentUserId)
      .single()
      .then(({ data }) => {
        if (data) setLiked(true);
      });
  }, [post.id, currentUserId]);

  return (
    <div style={{ marginBottom: 1, background: "#050507", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 8px" }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%", overflow: "hidden",
          border: "2px solid #7C3AED",
          flexShrink: 0, background: "rgba(124,58,237,0.2)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={displayName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
              <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{displayName}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{timeAgo(post.created_at)}</div>
        </div>
      </div>

      {/* Media / dual-clip toggle */}
      <div style={{ position: "relative", aspectRatio: "1", background: "#111", overflow: "hidden" }}>
        {post.media_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.media_url}
            alt={showExplanation ? "Explanation" : "Performance"}
            style={{ width: "100%", height: "100%", objectFit: "cover", opacity: showExplanation ? 0.5 : 1, filter: showExplanation ? "saturate(0.3)" : "none", transition: "all 0.3s ease" }}
          />
        ) : (
          <div style={{
            width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(236,72,153,0.1))",
            gap: 12,
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.5)" strokeWidth="1.5">
              <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>No video attached</span>
          </div>
        )}

        {/* Explanation overlay */}
        {showExplanation && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end",
            background: "linear-gradient(to top, rgba(5,5,7,0.95) 0%, rgba(5,5,7,0.7) 50%, transparent 100%)",
            padding: "16px 14px",
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#A855F7", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              Story
            </div>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", lineHeight: 1.6 }}>{post.content}</p>
          </div>
        )}

        {/* Toggle pill */}
        <div style={{ position: "absolute", top: 10, right: 10, display: "flex", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)", borderRadius: 20, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowExplanation(false); }}
            style={{ padding: "5px 10px", background: !showExplanation ? "rgba(168,85,247,0.8)" : "transparent", border: "none", color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg> Dance
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setShowExplanation(true); }}
            style={{ padding: "5px 10px", background: showExplanation ? "rgba(168,85,247,0.8)" : "transparent", border: "none", color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> Story
          </button>
        </div>

        {/* Tap to expand */}
        <button onClick={onOpen} style={{ position: "absolute", inset: 0, background: "none", border: "none", cursor: "pointer" }} />
      </div>

      {/* Actions */}
      <div style={{ padding: "10px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <button
            onClick={handleLike}
            disabled={!currentUserId}
            style={{ background: "none", border: "none", cursor: currentUserId ? "pointer" : "default", display: "flex", alignItems: "center", gap: 5, opacity: liking ? 0.6 : 1 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill={liked ? "#EC4899" : "none"} stroke={liked ? "#EC4899" : "rgba(255,255,255,0.5)"} strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            <span style={{ fontSize: 13, color: liked ? "#EC4899" : "rgba(255,255,255,0.5)" }}>
              {likeCount.toLocaleString()}
            </span>
          </button>
          <button onClick={onOpen} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>{(post.comments_count ?? 0).toLocaleString()}</span>
          </button>
          <button style={{ background: "none", border: "none", cursor: "pointer" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
        </div>

        {/* Caption */}
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, marginBottom: 6 }}>
          <span style={{ fontWeight: 700, color: "#fff" }}>{displayName} </span>
          {post.content}
        </p>

        {/* Styles */}
        {styles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {styles.map((s) => (
              <span key={s} style={{ fontSize: 10, color: "#A855F7", background: "rgba(168,85,247,0.1)", borderRadius: 20, padding: "2px 8px" }}>
                #{s.toLowerCase().replace(/ /g, "")}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyFeed() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 24px", gap: 16 }}>
      <div style={{ width: 64, height: 64, borderRadius: 20, background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.6)" strokeWidth="1.5">
          <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
        </svg>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 6 }}>No posts yet</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
          Be the first to share your craft with the EGATS Culture community.
        </div>
      </div>
    </div>
  );
}

// ─── Feed Screen ──────────────────────────────────────────────────────────────

const FILTERS = ["For You", "Following", "Hip-Hop", "Breaking", "Waacking", "House"];

export default function FeedScreen({ dispatch, style }: Props) {
  const [posts, setPosts] = useState<CulturePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPosts = useCallback(async (styleFilter?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (styleFilter) params.set("style", styleFilter);
      const res = await fetch(`/api/culture/posts?${params.toString()}`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setPosts(json.posts);
      }
    } catch {
      setError("Failed to load posts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Get current user
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setCurrentUserId(data.user.id);
        // Get avatar
        supabase
          .from("profiles")
          .select("avatar_url")
          .eq("id", data.user.id)
          .single()
          .then(({ data: profile }) => {
            if (profile?.avatar_url) setCurrentUserAvatar(profile.avatar_url);
          });
      }
    });
    fetchPosts();
  }, [fetchPosts]);

  function handleFilterChange(index: number) {
    setActiveFilter(index);
    const filter = FILTERS[index];
    const styleFilters = ["Hip-Hop", "Breaking", "Waacking", "House"];
    if (styleFilters.includes(filter)) {
      fetchPosts(filter);
    } else {
      fetchPosts();
    }
  }

  return (
    <div style={{ ...style, background: "#050507", overflowY: "auto" }}>
      {/* Header */}
      <div style={{
        padding: "52px 14px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 10, background: "rgba(5,5,7,0.9)", backdropFilter: "blur(20px)",
      }}>
        <div style={{ fontSize: 20, fontWeight: 800, background: "linear-gradient(135deg, #A855F7, #EC4899)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          EGATS Culture
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ background: "none", border: "none", cursor: "pointer" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </button>
          <div style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", border: "2px solid #A855F7", background: "rgba(168,85,247,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {currentUserAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentUserAvatar} alt="You" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
                <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
              </svg>
            )}
          </div>
        </div>
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 8, padding: "0 14px 12px", overflowX: "auto" }}>
        {FILTERS.map((f, i) => (
          <button key={f} onClick={() => handleFilterChange(i)} style={{
            flexShrink: 0, padding: "6px 14px", borderRadius: 20,
            background: i === activeFilter ? "#7C3AED" : "rgba(255,255,255,0.06)",
            border: i === activeFilter ? "none" : "1px solid rgba(255,255,255,0.1)",
            color: i === activeFilter ? "#fff" : "rgba(255,255,255,0.5)",
            fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>{f}</button>
        ))}
      </div>

      {/* No auth notice */}
      {!currentUserId && (
        <div style={{ margin: "0 14px 12px", background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Log in to like and post</div>
          <a href={process.env.NEXT_PUBLIC_PLATFORM_URL || "#"} style={{ fontSize: 11, fontWeight: 700, color: "#A855F7", textDecoration: "none" }}>Sign In →</a>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{ margin: "0 14px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "10px 14px" }}>
          <div style={{ fontSize: 12, color: "#EF4444" }}>Failed to load posts: {error}</div>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <>
          <span className="sr-only" aria-live="polite">Loading posts...</span>
          <PostSkeleton />
          <PostSkeleton />
          <PostSkeleton />
        </>
      )}

      {/* Posts */}
      {!loading && posts.length === 0 && !error && <EmptyFeed />}
      {!loading && posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          currentUserId={currentUserId}
          onOpen={() => dispatch({ type: "OPEN_POST", postId: post.id })}
        />
      ))}
    </div>
  );
}
