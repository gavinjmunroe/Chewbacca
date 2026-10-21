"use client";

import { NavProps, USERS, STORIES, CIRCLES, StoryUser } from "@/types";
import StatusBar from "@/components/StatusBar";
import Avatar from "@/components/Avatar";
import Image from "next/image";

function parseDayLabel(label?: string): string {
  if (!label) return "";
  if (label === "Today") return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (label === "Yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  const m = label.match(/^(\d+)d ago$/);
  if (m) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(m[1], 10));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return label;
}

interface UserStoryCardProps {
  story: typeof STORIES[number];
  navigate: NavProps["navigate"];
}

function UserStoryCard({ story, navigate }: UserStoryCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate("story", "forward", story.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { navigate("story", "forward", story.id); e.preventDefault(); } }}
      style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, marginBottom: 8, overflow: "hidden", cursor: "pointer" }}
    >
      {story.mediaType === "photo" && (story.photoUrl || story.photoGradient) && (
        <div style={{ width: "100%", height: 70, position: "relative", overflow: "hidden" }}>
          {story.photoUrl ? (
            <>
              <Image src={story.photoUrl} alt="" width={400} height={70} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 40%, rgba(15,12,10,0.6) 100%)" }} />
            </>
          ) : (
            <>
              <div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, ${story.photoGradient![0]} 0%, ${story.photoGradient![1]} 100%)` }} />
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 30% 40%, rgba(255,255,255,0.04) 0%, transparent 60%)" }} />
            </>
          )}
        </div>
      )}
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)" }}>{parseDayLabel(story.dayLabel)}</span>
          <span style={{ marginLeft: 6, fontSize: 10, color: story.mediaType === "audio" ? "rgba(245,158,11,0.55)" : story.mediaType === "photo" ? "rgba(52,211,153,0.45)" : "rgba(255,255,255,0.22)", fontFamily: "var(--font-inter)" }}>
            {story.mediaType === "audio" ? `▶ ${story.audioDuration}` : story.mediaType}
          </span>
          <span style={{ fontSize: 10, color: "rgba(245,158,11,0.4)", fontFamily: "var(--font-inter)", marginLeft: "auto", letterSpacing: "0.03em" }}>
            {story.reactions.think + story.reactions.changed + story.reactions.felt + story.reactions.door} resonated
          </span>
        </div>
        {story.promptText && (
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontStyle: "italic", lineHeight: 1.4, margin: "5px 0 0", fontFamily: "var(--font-inter)", display: "-webkit-box" as const, WebkitLineClamp: 1, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>
            {story.promptText}
          </p>
        )}
        <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.62)", lineHeight: 1.5, margin: "5px 0 0", fontFamily: "var(--font-inter)", display: "-webkit-box" as const, WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>
          {story.preview}
        </p>
      </div>
    </div>
  );
}

interface UserHeroProps {
  user: StoryUser;
  sharedCircles: typeof CIRCLES;
  isDiscovery: boolean;
}

function UserHero({ user, sharedCircles, isDiscovery }: UserHeroProps) {
  return (
    <div style={{ padding: "8px 20px 0", textAlign: "center" as const }}>
      <div style={{ display: "inline-block", marginBottom: 12 }}>
        <Avatar userId={user.id} color={user.color} size={68} border={user.verified ? "2px solid rgba(52,211,153,0.6)" : "2px solid rgba(255,255,255,0.08)"} />
      </div>
      <h1 style={{ fontSize: 20, color: "#fff", fontWeight: 700, fontFamily: "var(--font-dm-sans)", letterSpacing: "-0.02em", margin: 0 }}>{user.name}</h1>
      {user.verified && <p style={{ fontSize: 12, color: "#34d399", fontWeight: 600, margin: "4px 0 0", fontFamily: "var(--font-inter)" }}>✓ Verified Human</p>}
      {user.campus && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.38)", margin: "3px 0 0", fontFamily: "var(--font-inter)" }}>{user.campus}</p>}
      {isDiscovery ? (
        <div style={{ marginTop: 12 }}>
          <span style={{ display: "inline-block", backgroundColor: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 999, fontFamily: "var(--font-inter)", border: "1px solid rgba(255,255,255,0.08)" }}>Discovery</span>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", margin: "8px 0 0", fontFamily: "var(--font-inter)", fontStyle: "italic" }}>You found this person through Discovery</p>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" as const }}>
          {sharedCircles.map((c) => (
            <span key={c.id} style={{ display: "inline-block", backgroundColor: "rgba(245,158,11,0.08)", color: "rgba(245,158,11,0.75)", fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 999, fontFamily: "var(--font-inter)", border: "1px solid rgba(245,158,11,0.15)" }}>{c.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UserProfileScreen({ navigate, goBack, storyId }: NavProps) {
  const userId = storyId;
  const user: StoryUser | undefined = userId ? USERS[userId] : undefined;
  const userStories = STORIES.filter((s) => s.user.id === userId && s.id !== "caleb-today");
  const sharedCircles = CIRCLES.filter((c) => userId && c.memberIds.includes(userId));
  const isDiscovery = sharedCircles.length === 0;
  const totalResonances = userStories.reduce((acc, s) => acc + s.reactions.think + s.reactions.changed + s.reactions.felt + s.reactions.door, 0);
  const latestStory = userStories.length > 0 ? userStories[0] : undefined;

  if (!user) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#0f0c0a" }}>
        <StatusBar />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 32px" }}>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.32)", fontFamily: "var(--font-inter)", textAlign: "center", margin: "0 0 24px" }}>User not found</p>
          <button onClick={() => goBack ? goBack() : navigate("home", "back")} style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.22)", borderRadius: 999, padding: "10px 24px", cursor: "pointer", fontSize: 13, color: "#f59e0b", fontFamily: "var(--font-inter)", fontWeight: 600 }}>Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#0f0c0a", position: "relative" }}>
      <StatusBar />

      <div style={{ position: "absolute", top: 44, left: 0, right: 0, height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px", zIndex: 10, backgroundColor: "#0f0c0a" }}>
        <button onClick={() => goBack ? goBack() : navigate("home", "back")} style={{ background: "none", border: "none", cursor: "pointer", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Go back">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12.5 5L7.5 10L12.5 15" stroke="rgba(255,255,255,0.65)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span style={{ fontSize: 15, color: "#fff", fontWeight: 600, fontFamily: "var(--font-inter)", letterSpacing: "-0.01em" }}>{user.name}</span>
        <div style={{ width: 44, flexShrink: 0 }} />
      </div>

      <div className="inner-scroll" style={{ flex: 1, overflowY: "auto", paddingTop: 92, paddingBottom: 80 }}>
        <UserHero user={user} sharedCircles={sharedCircles} isDiscovery={isDiscovery} />

        <div style={{ margin: "20px 16px 0", backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.055)", borderRadius: 14, padding: "16px 0", display: "flex" }}>
          {[
            { value: String(userStories.length), label: "Stories shared" },
            { value: String(totalResonances), label: "Resonances" },
            { value: latestStory?.dayLabel ?? "·", label: "Last active" },
          ].map((stat, statPos) => (
            <div key={stat.label} style={{ flex: 1, textAlign: "center" as const, borderRight: statPos < 2 ? "1px solid rgba(255,255,255,0.055)" : "none", padding: "0 8px" }}>
              <p style={{ fontSize: 20, color: "#fff", fontWeight: 700, fontFamily: "var(--font-dm-sans)", margin: 0 }}>{stat.value}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "var(--font-inter)", margin: "4px 0 0" }}>{stat.label}</p>
            </div>
          ))}
        </div>

        {sharedCircles.length > 0 && (
          <div style={{ margin: "18px 16px 0" }}>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: 600, fontFamily: "var(--font-inter)", margin: "0 0 10px" }}>Circles together</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: 8 }}>
              {sharedCircles.map((c) => (
                <span key={c.id} style={{ display: "inline-block", backgroundColor: "rgba(245,158,11,0.08)", color: "rgba(245,158,11,0.75)", fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 999, fontFamily: "var(--font-inter)", border: "1px solid rgba(245,158,11,0.15)" }}>{c.name}</span>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)", fontStyle: "italic", margin: 0 }}>You both post to these circles</p>
          </div>
        )}

        <div style={{ margin: "18px 16px 0" }}>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: 600, fontFamily: "var(--font-inter)", margin: "0 0 10px" }}>Stories</p>
          {userStories.length === 0 ? (
            <div style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, padding: "24px 16px", textAlign: "center" as const }}>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)", fontStyle: "italic", margin: 0 }}>No stories yet</p>
            </div>
          ) : (
            userStories.map((story) => <UserStoryCard key={story.id} story={story} navigate={navigate} />)
          )}
        </div>
      </div>
    </div>
  );
}
