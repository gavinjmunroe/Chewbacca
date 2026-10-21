"use client";
import React, { useState, useEffect } from "react";
import type { CulturePost, Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

interface Props {
  dispatch: React.Dispatch<{ type: "OPEN_POST"; postId: string }>;
  style: React.CSSProperties;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div style={{ padding: "0 14px 20px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 14 }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
        <div style={{ display: "flex", gap: 20 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ width: 40, height: 18, borderRadius: 6, background: "rgba(255,255,255,0.07)" }} />
              <div style={{ width: 40, height: 11, borderRadius: 6, background: "rgba(255,255,255,0.05)" }} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ width: 120, height: 14, borderRadius: 6, background: "rgba(255,255,255,0.07)", marginBottom: 6 }} />
      <div style={{ width: 80, height: 12, borderRadius: 6, background: "rgba(255,255,255,0.05)" }} />
    </div>
  );
}

// ─── Profile Screen ───────────────────────────────────────────────────────────

export default function ProfileScreen({ dispatch, style }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<CulturePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"posts" | "clips">("posts");
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [postCount, setPostCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        setIsLoggedIn(false);
        setLoading(false);
        return;
      }
      setIsLoggedIn(true);

      try {
        // Load profile
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url, role")
          .eq("id", data.user.id)
          .single();
        if (profileError) {
          setError("Failed to load profile");
        } else {
          setProfile(profileData);
        }

        // Load posts by this user
        const { data: postsData, error: postsError } = await supabase
          .from("culture_posts")
          .select("id, user_id, content, media_url, styles, likes_count, comments_count, circle_id, created_at")
          .eq("user_id", data.user.id)
          .order("created_at", { ascending: false })
          .limit(12);

        if (postsError) {
          setError((prev) => prev || "Failed to load posts");
        } else if (postsData) {
          setPosts(postsData);
          setPostCount(postsData.length);
        }
      } catch {
        setError("Failed to load profile");
      }
      setLoading(false);
    });
  }, []);

  // Not logged in
  if (isLoggedIn === false) {
    return (
      <div style={{ ...style, background: "#050507", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: "0 28px" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#A855F7" strokeWidth="1.5">
            <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
          </svg>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", marginBottom: 8 }}>Your Profile</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.7 }}>
            Sign in to see your posts, circles, and recruiting profile.
          </div>
        </div>
        <a href={process.env.NEXT_PUBLIC_PLATFORM_URL || "#"}
          style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: "linear-gradient(135deg, #7C3AED, #EC4899)", border: "none", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", textDecoration: "none", textAlign: "center", display: "block" }}>
          Sign In / Sign Up →
        </a>
      </div>
    );
  }

  const displayName = profile?.display_name || "Dancer";
  const avatarUrl = profile?.avatar_url;
  const role = profile?.role || "Community Member";

  return (
    <div style={{ ...style, background: "#050507", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ padding: "52px 14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{displayName}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 14px", color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Edit Profile</button>
          <button style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && !loading && (
        <div style={{ margin: "0 14px 16px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "10px 14px" }}>
          <div style={{ fontSize: 12, color: "#EF4444" }}>{error}</div>
        </div>
      )}

      {/* Profile info */}
      {loading ? (
        <ProfileSkeleton />
      ) : (
        <div style={{ padding: "0 14px 20px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 14 }}>
            <div style={{ position: "relative" }}>
              <div style={{ width: 80, height: 80, borderRadius: "50%", overflow: "hidden", border: "3px solid #7C3AED", background: "rgba(124,58,237,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt={displayName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.7)" strokeWidth="1.5">
                    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                  </svg>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 20 }}>
              {[
                { label: "Posts", value: postCount },
                { label: "Joined", value: "2026" },
              ].map((s) => (
                <div key={s.label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{displayName}</div>
            <div style={{ fontSize: 12, color: "#A855F7", fontWeight: 600 }}>{role}</div>
          </div>

          {/* Platform link */}
          <a href={process.env.NEXT_PUBLIC_PLATFORM_URL || "#"}
            style={{ display: "block", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 12, padding: "10px 14px", textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#A855F7" }}>EGATS Recruiting Profile</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>View your full profile on the platform</div>
              </div>
              <div style={{ fontSize: 10, color: "#A855F7" }}>View →</div>
            </div>
          </a>
        </div>
      )}

      {/* Tab switcher */}
      <div style={{ display: "flex", borderTop: "1px solid rgba(255,255,255,0.07)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        {(["posts", "clips"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "12px 0", background: "none", border: "none", borderBottom: tab === t ? "2px solid #A855F7" : "2px solid transparent", color: tab === t ? "#A855F7" : "rgba(255,255,255,0.3)", fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>
            {t === "posts"
              ? <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="M10 8l6 4-6 4V8z" fill="currentColor"/></svg>Posts</span>
              : <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>Featured</span>
            }
          </button>
        ))}
      </div>

      {/* Posts grid */}
      {!loading && posts.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>No posts yet</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", textAlign: "center" }}>
            Share your first dance with context and credits.
          </div>
        </div>
      )}

      {!loading && posts.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2, padding: 2 }}>
          {posts.map((p) => (
            <button key={p.id} onClick={() => dispatch({ type: "OPEN_POST", postId: p.id })}
              style={{ aspectRatio: "1", overflow: "hidden", background: "none", border: "none", cursor: "pointer", padding: 0, position: "relative" }}>
              {p.media_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.media_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(236,72,153,0.1))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.5)" strokeWidth="2">
                    <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                  </svg>
                </div>
              )}
              <div style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "3px 6px", display: "flex", alignItems: "center", gap: 3 }}>
                <svg width="7" height="7" viewBox="0 0 24 24" fill="rgba(255,255,255,0.8)"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
