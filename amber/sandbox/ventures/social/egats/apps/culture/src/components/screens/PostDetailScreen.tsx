"use client";
import React, { useState, useEffect } from "react";
import type { CulturePost } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

interface Props {
  postId: string;
  dispatch: React.Dispatch<{ type: "GO_BACK" }>;
  style: React.CSSProperties;
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

export default function PostDetailScreen({ postId, dispatch, style }: Props) {
  const [post, setPost] = useState<CulturePost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [comment, setComment] = useState("");
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [liking, setLiking] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // Get user
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setCurrentUserId(data.user.id);
        // Check if liked
        supabase
          .from("culture_post_likes")
          .select("post_id")
          .eq("post_id", postId)
          .eq("user_id", data.user.id)
          .single()
          .then(({ data: like }) => { if (like) setLiked(true); });
      }
    });

    // Load post
    supabase
      .from("culture_posts")
      .select(`
        id, user_id, content, media_url, styles, likes_count, comments_count, circle_id, created_at,
        profiles (id, display_name, avatar_url, role)
      `)
      .eq("id", postId)
      .single()
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          setError("Failed to load post");
        } else if (data) {
          // Supabase returns profiles as array on join; normalize to single object
          const normalized = {
            ...data,
            profiles: Array.isArray(data.profiles) ? data.profiles[0] ?? null : data.profiles,
          } as CulturePost;
          setPost(normalized);
          setLikeCount(data.likes_count ?? 0);
        } else {
          setError("Post not found");
        }
        setLoading(false);
      });
  }, [postId]);

  async function handleLike() {
    if (!currentUserId || liking || !post) return;
    setLiking(true);
    const supabase = createClient();
    if (liked) {
      await supabase.from("culture_post_likes").delete().eq("post_id", postId).eq("user_id", currentUserId);
      await supabase.from("culture_posts").update({ likes_count: Math.max(0, likeCount - 1) }).eq("id", postId);
      setLikeCount((c) => Math.max(0, c - 1));
      setLiked(false);
    } else {
      await supabase.from("culture_post_likes").upsert({ post_id: postId, user_id: currentUserId });
      await supabase.from("culture_posts").update({ likes_count: likeCount + 1 }).eq("id", postId);
      setLikeCount((c) => c + 1);
      setLiked(true);
    }
    setLiking(false);
  }

  async function handleComment() {
    if (!comment.trim() || !currentUserId || !post || submittingComment) return;
    setSubmittingComment(true);
    const supabase = createClient();
    await supabase.from("culture_post_comments").insert({
      post_id: postId,
      user_id: currentUserId,
      content: comment.trim(),
    });
    // Increment comment count
    await supabase.from("culture_posts").update({ comments_count: (post.comments_count ?? 0) + 1 }).eq("id", postId);
    setPost((p) => p ? { ...p, comments_count: (p.comments_count ?? 0) + 1 } : p);
    setComment("");
    setSubmittingComment(false);
  }

  if (loading) {
    return (
      <div style={{ ...style, background: "#050507", display: "flex", flexDirection: "column" }} aria-busy="true">
        <span className="sr-only" aria-live="polite">Loading post...</span>
        <div style={{ padding: "52px 14px 12px", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => dispatch({ type: "GO_BACK" })} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
          </button>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ width: 100, height: 13, borderRadius: 6, background: "rgba(255,255,255,0.07)" }} />
            <div style={{ width: 70, height: 10, borderRadius: 6, background: "rgba(255,255,255,0.05)" }} />
          </div>
        </div>
        <div style={{ aspectRatio: "1", background: "rgba(255,255,255,0.05)", margin: "0 14px", borderRadius: 16 }} />
        <div style={{ padding: "14px 14px 0", display: "flex", flexDirection: "column", gap: 10 }}>
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

  if (error) {
    return (
      <div style={{ ...style, background: "#050507", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 24px" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 6 }}>Could not load post</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>{error}</div>
        </div>
        <button onClick={() => dispatch({ type: "GO_BACK" })} style={{ padding: "10px 24px", borderRadius: 20, background: "#7C3AED", border: "none", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Go Back</button>
      </div>
    );
  }

  if (!post) {
    return (
      <div style={{ ...style, background: "#050507", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>Post not found</div>
        <button onClick={() => dispatch({ type: "GO_BACK" })} style={{ padding: "10px 20px", borderRadius: 20, background: "#7C3AED", border: "none", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Go Back</button>
      </div>
    );
  }

  const displayName = post.profiles?.display_name || "Unknown Dancer";
  const avatarUrl = post.profiles?.avatar_url;
  const styles: string[] = post.styles || [];

  return (
    <div style={{ ...style, background: "#050507", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ padding: "52px 14px 12px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, background: "rgba(5,5,7,0.95)", backdropFilter: "blur(20px)", zIndex: 10 }}>
        <button onClick={() => dispatch({ type: "GO_BACK" })} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
        </button>
        <div style={{ width: 36, height: 36, borderRadius: "50%", overflow: "hidden", border: "2px solid #A855F7", background: "rgba(168,85,247,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={displayName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          )}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{displayName}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{timeAgo(post.created_at)}</div>
        </div>
        <button style={{ marginLeft: "auto", padding: "6px 14px", borderRadius: 20, background: "linear-gradient(135deg, #7C3AED, #EC4899)", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          Follow
        </button>
      </div>

      {/* Dual clip toggle */}
      <div style={{ display: "flex", gap: 2, padding: "0 14px 10px" }}>
        {[
          { key: false, label: "Performance", icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> },
          { key: true, label: "Explanation", icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> },
        ].map(({ key, label, icon }) => (
          <button key={String(key)} onClick={() => setShowExplanation(key)}
            style={{ flex: 1, padding: "10px 0", borderRadius: 12, background: showExplanation === key ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.06)", border: "1px solid " + (showExplanation === key ? "rgba(168,85,247,0.5)" : "rgba(255,255,255,0.08)"), color: showExplanation === key ? "#A855F7" : "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            {icon}{label}
          </button>
        ))}
      </div>

      {/* Media */}
      <div style={{ position: "relative", aspectRatio: "1", background: "#111", margin: "0 14px", borderRadius: 16, overflow: "hidden" }}>
        {post.media_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.media_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: showExplanation ? "saturate(0.3)" : "none", transition: "filter 0.3s ease" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(236,72,153,0.1))" }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.4)" strokeWidth="1.5">
              <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
          </div>
        )}

        {showExplanation && (
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(5,5,7,0.97) 0%, rgba(5,5,7,0.8) 50%, transparent 100%)", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#A855F7", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
              Story & Context
            </div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", lineHeight: 1.7 }}>{post.content}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ padding: "14px 14px 0" }}>
        <div style={{ display: "flex", gap: 18, marginBottom: 12 }}>
          <button
            onClick={handleLike}
            disabled={!currentUserId || liking}
            style={{ background: "none", border: "none", cursor: currentUserId ? "pointer" : "default", display: "flex", alignItems: "center", gap: 6, opacity: liking ? 0.6 : 1 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill={liked ? "#EC4899" : "none"} stroke={liked ? "#EC4899" : "rgba(255,255,255,0.6)"} strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            <span style={{ fontSize: 14, color: liked ? "#EC4899" : "rgba(255,255,255,0.6)" }}>{likeCount.toLocaleString()}</span>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.4)", fontSize: 14 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            {(post.comments_count ?? 0).toLocaleString()}
          </div>
        </div>

        {/* Styles */}
        {styles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {styles.map((s) => (
              <span key={s} style={{ fontSize: 11, color: "#A855F7", background: "rgba(168,85,247,0.12)", borderRadius: 20, padding: "3px 10px" }}>#{s.toLowerCase()}</span>
            ))}
          </div>
        )}

        {/* Caption */}
        {!showExplanation && (
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, marginBottom: 16 }}>
            <span style={{ fontWeight: 700, color: "#fff" }}>{displayName} </span>
            {post.content}
          </p>
        )}

        {/* Comment input */}
        {currentUserId ? (
          <div style={{ display: "flex", gap: 10, paddingBottom: 20 }}>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleComment(); } }}
              placeholder="Add a comment..."
              style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, padding: "10px 14px", color: "#fff", fontSize: 13, outline: "none" }} />
            <button
              onClick={handleComment}
              disabled={!comment.trim() || submittingComment}
              style={{ padding: "8px 16px", borderRadius: 20, background: comment.trim() ? "#7C3AED" : "rgba(255,255,255,0.06)", border: "none", color: "#fff", fontSize: 12, fontWeight: 600, cursor: comment.trim() ? "pointer" : "default", opacity: submittingComment ? 0.6 : 1 }}>
              Post
            </button>
          </div>
        ) : (
          <div style={{ paddingBottom: 20, fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
            <a href={process.env.NEXT_PUBLIC_PLATFORM_URL || "#"} style={{ color: "#A855F7", textDecoration: "none" }}>Sign in</a> to comment
          </div>
        )}
      </div>
    </div>
  );
}
