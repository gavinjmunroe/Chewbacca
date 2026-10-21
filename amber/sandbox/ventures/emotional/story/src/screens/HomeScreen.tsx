"use client";

import type { NavProps } from "@/types";
import { CIRCLES, ALL_CIRCLE_MEMBERS, ALL_CIRCLE_MEMBER_IDS, TOTAL_CONNECTIONS, DAILY_PROMPT, STORIES } from "@/types";
import StatusBar from "@/components/StatusBar";
import Avatar from "@/components/Avatar";
import Image from "next/image";

const PREVIEW_USERS = ALL_CIRCLE_MEMBERS.slice(0, 8);

const WAVEFORMS = [
  [3,7,5,9,6,11,8,14,10,7,13,9,5,12,8,6,11,7,4,9,12,6,8,10,5,7,13,9,6,8],
  [5,9,7,12,4,8,11,6,14,9,5,10,7,13,8,4,11,6,9,7,12,5,8,10,6,14,7,9,5,8],
  [4,8,6,11,9,7,13,5,10,8,4,12,6,9,11,5,7,10,8,6,13,4,9,7,11,6,8,12,5,9],
  [6,10,8,13,5,9,7,11,4,12,8,6,10,7,13,5,9,6,11,8,4,10,7,12,6,9,5,11,8,7],
];
function getWaveform(id: string) { return WAVEFORMS[id.charCodeAt(0) % WAVEFORMS.length]; }

function AudioWaveform({ duration, storyId }: { duration: string; storyId: string }) {
  const bars = getWaveform(storyId);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      backgroundColor: "rgba(245,158,11,0.06)",
      border: "1px solid rgba(245,158,11,0.12)",
      borderRadius: 10, padding: "8px 12px", marginTop: 10,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        backgroundColor: "rgba(245,158,11,0.15)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <div style={{
          width: 0, height: 0,
          borderTop: "5px solid transparent",
          borderBottom: "5px solid transparent",
          borderLeft: "8px solid rgba(245,158,11,0.85)",
          marginLeft: 2,
        }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, height: 20 }}>
        {bars.map((h, barPos) => (
          <div key={`home-audio-bar-h${h}-pos${barPos}`} style={{
            width: 2, borderRadius: 1,
            height: `${Math.max(3, h * 1.2)}px`,
            backgroundColor: barPos < 10 ? "rgba(245,158,11,0.65)" : "rgba(245,158,11,0.2)",
          }} />
        ))}
      </div>
      <span style={{
        fontSize: 11, color: "rgba(245,158,11,0.7)",
        fontFamily: "var(--font-inter)", flexShrink: 0,
      }}>
        {duration}
      </span>
    </div>
  );
}

const todayCircleStories = STORIES.filter(
  s => !s.isDiscovery && s.dayLabel === "Today" && s.id !== "caleb-today" &&
    ALL_CIRCLE_MEMBER_IDS.includes(s.user.id)
);

export default function HomeScreen({ navigate, posted, navActive }: NavProps) {
  const now = new Date();
  const hours = now.getHours();
  const greeting = hours < 12 ? "Good morning" : hours < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  const respondedCount = posted ? 6 : 5;
  const feedStories = posted
    ? [STORIES.find(s => s.id === "caleb-today")!, ...todayCircleStories]
    : todayCircleStories;

  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", flexDirection: "column",
      background: "#0f0c0a", overflow: "hidden", position: "relative",
    }}>
      <StatusBar />

      <div className="inner-scroll" style={{ paddingTop: 52, paddingBottom: 76, overflowY: "auto", flex: 1 }}>

        {/* Greeting */}
        <div style={{ padding: "22px 20px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 22, fontWeight: 700,
              color: "#ffffff", letterSpacing: "-0.02em", lineHeight: 1.2,
            }}>
              {greeting}
            </div>
            <div style={{
              fontFamily: "var(--font-inter)",
              fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 4,
            }}>
              {dateLabel}
            </div>
          </div>
          <button
            onClick={() => navigate("notifications", "forward")}
            style={{
              background: "none", border: "none", cursor: "pointer",
              position: "relative", padding: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              marginTop: 2,
            }}
            aria-label="Notifications"
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M11 2.5a6.5 6.5 0 0 1 6.5 6.5v3l1.5 2.5H3L4.5 12V9A6.5 6.5 0 0 1 11 2.5z" stroke="rgba(255,255,255,0.55)" strokeWidth="1.4" strokeLinejoin="round"/>
              <path d="M9 17.5a2 2 0 0 0 4 0" stroke="rgba(255,255,255,0.55)" strokeWidth="1.4"/>
            </svg>
            {/* Badge */}
            <div style={{
              position: "absolute", top: 2, right: 2,
              minWidth: 16, height: 16, borderRadius: 999,
              backgroundColor: "#f59e0b",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "0 4px",
            }}>
              <span style={{ fontSize: 9, color: "#fff", fontWeight: 700, fontFamily: "var(--font-inter)", lineHeight: 1 }}>4</span>
            </div>
          </button>
        </div>

        {/* Today's Prompt — Hero section */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate("prompt", "forward")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { navigate("prompt", "forward"); e.preventDefault(); } }}
          style={{
            margin: "20px 16px 0",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 18, padding: "20px 18px 16px", cursor: "pointer",
          }}
        >
          {/* Label row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#f59e0b", flexShrink: 0,
              }} />
              <span style={{
                fontFamily: "var(--font-inter)",
                fontSize: 11, color: "rgba(245,158,11,0.85)",
                fontWeight: 600,
              }}>
                Today&apos;s prompt
              </span>
            </div>
            <span style={{ fontFamily: "var(--font-inter)", fontSize: 11, color: "rgba(255,255,255,0.22)" }}>
              {respondedCount} / {TOTAL_CONNECTIONS}
            </span>
          </div>

          {/* The prompt — editorial size */}
          <div style={{
            fontFamily: "var(--font-inter)",
            fontSize: 16, fontWeight: 500,
            color: "rgba(255,255,255,0.9)", lineHeight: 1.65, marginBottom: 18,
          }}>
            {DAILY_PROMPT}
          </div>

          {/* Avatar stack */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {PREVIEW_USERS.map((u, i) => (
                <div key={u.id} style={{ marginLeft: i === 0 ? 0 : -7, zIndex: 5 - i, position: "relative" }}>
                  <Avatar userId={u.id} color={u.color} size={22} border="2px solid #0f0c0a" />
                </div>
              ))}
            </div>
            <span style={{
              fontFamily: "var(--font-inter)",
              fontSize: 11, color: "rgba(255,255,255,0.35)", flex: 1,
            }}>
              {respondedCount} of {TOTAL_CONNECTIONS} responded
            </span>
          </div>

          {/* Status pill */}
          <div style={{
            backgroundColor: posted ? "rgba(52,211,153,0.07)" : "rgba(245,158,11,0.07)",
            border: posted ? "1px solid rgba(52,211,153,0.2)" : "1px solid rgba(245,158,11,0.2)",
            borderRadius: 10, padding: "9px 12px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            {posted ? (
              <>
                <span style={{ fontSize: 12, color: "#34d399", fontFamily: "var(--font-inter)", fontWeight: 600 }}>
                  You responded today
                </span>
                <span style={{ fontSize: 13, color: "#34d399" }}>✓</span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", fontFamily: "var(--font-inter)", fontWeight: 500 }}>
                  Your circles are waiting
                </span>
                <span style={{ fontSize: 13, color: "#f59e0b", fontFamily: "var(--font-inter)", fontWeight: 700 }}>
                  Respond →
                </span>
              </>
            )}
          </div>
        </div>

        {/* Section header */}
        <div style={{ padding: "24px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{
            fontFamily: "var(--font-inter)",
            fontSize: 13, color: "rgba(255,255,255,0.5)", fontWeight: 600,
          }}>
            From your circles today
          </span>
          <button
            onClick={() => navigate("feed", "forward")}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 12, color: "rgba(245,158,11,0.8)",
              fontFamily: "var(--font-inter)", padding: 0, lineHeight: 1,
              flexShrink: 0,
            }}
          >
            See all →
          </button>
        </div>

        {/* Story Preview Cards */}
        <div style={{ padding: "0 16px" }}>
          {feedStories.map((story) => {
            const isOwn = story.id === "caleb-today";
            return (
              <div
                key={story.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate("story", "forward", story.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { navigate("story", "forward", story.id); e.preventDefault(); } }}
                style={{
                  background: isOwn ? "rgba(245,158,11,0.04)" : "rgba(255,255,255,0.03)",
                  border: isOwn ? "1px solid rgba(245,158,11,0.15)" : "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 16,
                  marginBottom: 12, cursor: "pointer",
                  overflow: "hidden",
                }}
              >
                {story.mediaType === "photo" && (story.photoUrl || story.photoGradient) && (
                  <div style={{ width: "100%", height: 90, position: "relative", overflow: "hidden" }}>
                    {story.photoUrl ? (
                      <>
                        <Image
                          src={story.photoUrl}
                          alt=""
                          width={400}
                          height={90}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 40%, rgba(15,12,10,0.6) 100%)" }} />
                      </>
                    ) : (
                      <>
                        <div style={{
                          width: "100%", height: "100%",
                          background: `linear-gradient(135deg, ${story.photoGradient![0]} 0%, ${story.photoGradient![1]} 100%)`,
                        }} />
                        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 30% 40%, rgba(255,255,255,0.04) 0%, transparent 60%)" }} />
                      </>
                    )}
                  </div>
                )}

                <div style={{ padding: "14px 16px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); navigate("user-profile", "forward", story.user.id); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); navigate("user-profile", "forward", story.user.id); } }}
                      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                    >
                      <Avatar userId={story.user.id} color={story.user.color} size={36} />
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ fontFamily: "var(--font-inter)", fontSize: 13, fontWeight: 600, color: "#fff" }}>
                            {story.user.name}
                          </span>
                          {isOwn && (
                            <span style={{
                              fontSize: 9, color: "#f59e0b",
                              backgroundColor: "rgba(245,158,11,0.1)",
                              borderRadius: 4, padding: "1px 5px",
                              fontFamily: "var(--font-inter)", fontWeight: 600,
                            }}>
                              You
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.32)", fontFamily: "var(--font-inter)" }}>
                          {story.timeAgo}
                        </span>
                      </div>
                    </div>
                  </div>

                  {story.mediaType === "audio" && story.audioDuration && (
                    <AudioWaveform duration={story.audioDuration} storyId={story.id} />
                  )}

                  <div style={{
                    fontFamily: "var(--font-inter)",
                    fontSize: 14, color: "rgba(255,255,255,0.72)", lineHeight: 1.6,
                    marginTop: 10,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                  } as React.CSSProperties}>
                    {story.preview}
                  </div>

                  {(() => {
                    const total = story.reactions.think + story.reactions.changed + story.reactions.felt + story.reactions.door;
                    if (total === 0) return null;
                    return (
                      <div style={{ marginTop: 10 }}>
                        <span style={{ fontSize: 10, color: "rgba(245,158,11,0.45)", fontFamily: "var(--font-inter)" }}>
                          {total} resonated
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
