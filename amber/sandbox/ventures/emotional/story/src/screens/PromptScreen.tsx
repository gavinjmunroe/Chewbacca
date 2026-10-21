"use client";

import { NavProps, CIRCLES, ALL_CIRCLE_MEMBERS, ALL_CIRCLE_MEMBER_IDS, TOTAL_CONNECTIONS, DAILY_PROMPT, STORIES, USERS } from "@/types";
import StatusBar from "@/components/StatusBar";
import Avatar from "@/components/Avatar";

const todayStories = STORIES.filter(
  s => !s.isDiscovery && s.dayLabel === "Today" && s.id !== "caleb-today" &&
    ALL_CIRCLE_MEMBER_IDS.includes(s.user.id)
);
const calebToday = STORIES.find(s => s.id === "caleb-today");
const RESPONDED_USER_IDS = todayStories.map(s => s.user.id);
const totalMembers = TOTAL_CONNECTIONS;

export default function PromptScreen({ navigate, goBack, posted, navActive }: NavProps) {
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  const responseList = posted && calebToday
    ? [calebToday, ...todayStories]
    : todayStories;
  const respondedCount = responseList.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#0f0c0a", position: "relative" }}>
      <StatusBar />

      <div style={{
        flexShrink: 0,
        paddingTop: 52, padding: "52px 16px 10px",
        display: "flex", flexDirection: "row", alignItems: "center",
        backgroundColor: "#0f0c0a",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        <button
          onClick={() => goBack?.()}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 20, cursor: "pointer", padding: "0 8px 0 0", lineHeight: 1, minWidth: 36 }}
        >
          ←
        </button>
        <div style={{ flex: 1, textAlign: "center" }}>
          <span style={{ color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: "var(--font-dm-sans)" }}>
            Today&apos;s Prompt
          </span>
        </div>
        <div style={{ minWidth: 36, textAlign: "right" as const, color: "rgba(255,255,255,0.22)", fontSize: 11, fontFamily: "var(--font-inter)" }}>
          {dateLabel.split(",")[0]}
        </div>
      </div>

      <div className="inner-scroll" style={{ flex: 1, overflowY: "auto", paddingBottom: 76 }}>

        {/* Prompt hero */}
        <div style={{
          margin: "18px 16px 0",
          paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#f59e0b", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "rgba(245,158,11,0.85)", fontWeight: 600, fontFamily: "var(--font-inter)" }}>
              Daily prompt
            </span>
          </div>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.9)", lineHeight: 1.7, fontWeight: 500, margin: 0, fontFamily: "var(--font-inter)" }}>
            {DAILY_PROMPT}
          </p>
        </div>

        {/* Responded avatars */}
        <div style={{ margin: "18px 16px 0", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* Show Caleb first, then circle members */}
            {[USERS.caleb, ...ALL_CIRCLE_MEMBERS].slice(0, 10).map((u, i) => {
              const hasResponded = u.id === "caleb" ? !!posted : RESPONDED_USER_IDS.includes(u.id);
              return (
                <div key={u.id} style={{ marginLeft: i === 0 ? 0 : -6, position: "relative", zIndex: 10 - i }}>
                  <Avatar userId={u.id} color={u.color} size={22} border={hasResponded ? "2px solid #0f0c0a" : "2px solid rgba(255,255,255,0.05)"} />
                  {!hasResponded && (
                    <div style={{
                      position: "absolute", inset: 0, borderRadius: "50%",
                      backgroundColor: "rgba(15,12,10,0.5)",
                      pointerEvents: "none",
                    }} />
                  )}
                </div>
              );
            })}
            {TOTAL_CONNECTIONS > 10 && (
              <div style={{ marginLeft: 4, fontSize: 10, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)" }}>
                +{TOTAL_CONNECTIONS - 10}
              </div>
            )}
          </div>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-inter)" }}>
            {respondedCount} of {totalMembers} responded
          </span>
        </div>

        {/* Circle destination pills */}
        <div style={{ margin: "12px 16px 0", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-inter)" }}>
            Shared with:
          </span>
          {CIRCLES.map(c => (
            <span key={c.id} style={{
              fontSize: 10, color: "rgba(245,158,11,0.7)",
              backgroundColor: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.15)",
              borderRadius: 6, padding: "2px 8px",
              fontFamily: "var(--font-inter)", fontWeight: 600,
            }}>
              {c.name}
            </span>
          ))}
        </div>

        {/* Write CTA */}
        {!posted && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => navigate("compose", "forward")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { navigate("compose", "forward"); e.preventDefault(); } }}
            style={{
              margin: "16px 16px 24px",
              backgroundColor: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.22)",
              borderRadius: 12, padding: "14px 16px",
              display: "flex", flexDirection: "row", alignItems: "center", cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 14, color: "rgba(255,255,255,0.88)", fontWeight: 600, flex: 1, fontFamily: "var(--font-inter)" }}>
              Add your voice →
            </span>
          </div>
        )}

        {posted && (
          <div style={{
            margin: "16px 16px 24px",
            backgroundColor: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.18)",
            borderRadius: 12, padding: "12px 14px",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 13, color: "#34d399", fontWeight: 600, fontFamily: "var(--font-inter)" }}>✓ You responded today</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)" }}>Shared with your Circles</span>
          </div>
        )}

        {/* Section label */}
        <div style={{ padding: "0 16px 12px", fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: 600, fontFamily: "var(--font-inter)" }}>
          Responses from your circles
        </div>

        {/* Story list */}
        <div style={{ padding: "0 16px" }}>
          {responseList.map((story) => {
            const isOwn = story.id === "caleb-today";
            return (
              <div
                key={story.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate("story", "forward", story.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { navigate("story", "forward", story.id); e.preventDefault(); } }}
                style={{
                  display: "flex", flexDirection: "row", gap: 12,
                  padding: isOwn ? "12px 10px" : "12px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  cursor: "pointer", alignItems: "flex-start",
                  backgroundColor: isOwn ? "rgba(245,158,11,0.04)" : "transparent",
                  borderRadius: isOwn ? 10 : 0,
                  marginBottom: isOwn ? 2 : 0,
                }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); navigate("user-profile", "forward", story.user.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); navigate("user-profile", "forward", story.user.id); } }}
                  style={{ cursor: "pointer", flexShrink: 0 }}
                >
                  <Avatar userId={story.user.id} color={story.user.color} size={38} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); navigate("user-profile", "forward", story.user.id); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); navigate("user-profile", "forward", story.user.id); } }}
                      style={{ fontSize: 13, color: "#fff", fontWeight: 600, fontFamily: "var(--font-inter)", cursor: "pointer" }}
                    >
                      {story.user.name}
                    </span>
                    {isOwn && (
                      <span style={{
                        fontSize: 9, color: "#f59e0b",
                        backgroundColor: "rgba(245,158,11,0.12)",
                        borderRadius: 4, padding: "1px 5px",
                        marginLeft: 6, fontFamily: "var(--font-inter)", fontWeight: 600, letterSpacing: "0.04em",
                      }}>
                        You
                      </span>
                    )}
                    {story.mediaType === "audio" && (
                      <span style={{
                        fontSize: 9, color: "rgba(245,158,11,0.65)",
                        backgroundColor: "rgba(245,158,11,0.08)",
                        border: "1px solid rgba(245,158,11,0.18)",
                        borderRadius: 4, padding: "1px 5px",
                        marginLeft: 6, fontFamily: "var(--font-inter)", letterSpacing: "0.03em",
                      }}>
                        ▶ {story.audioDuration}
                      </span>
                    )}
                    {story.mediaType === "photo" && (
                      <span style={{
                        fontSize: 9, color: "rgba(255,255,255,0.35)",
                        backgroundColor: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 4, padding: "1px 5px",
                        marginLeft: 6, fontFamily: "var(--font-inter)",
                      }}>
                        ◎ photo
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", marginLeft: "auto", fontFamily: "var(--font-inter)" }}>
                      {story.timeAgo}
                    </span>
                  </div>
                  <p style={{
                    fontSize: 12.5, color: "rgba(255,255,255,0.65)", lineHeight: 1.5,
                    marginTop: 4, marginBottom: 0,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden",
                    fontFamily: "var(--font-inter)",
                  }}>
                    {story.preview}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
