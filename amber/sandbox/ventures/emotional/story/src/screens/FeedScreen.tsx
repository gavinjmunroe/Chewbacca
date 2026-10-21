"use client";

import { useState } from "react";
import { CIRCLES, ALL_CIRCLE_MEMBER_IDS, TOTAL_CONNECTIONS, NavProps, STORIES } from "@/types";
import StatusBar from "@/components/StatusBar";
import Avatar from "@/components/Avatar";
import Image from "next/image";

const WAVEFORMS = [
  [3,7,5,9,6,11,8,14,10,7,13,9,5,12,8,6,11,7,4,9,12,6,8,10,5,7,13,9,6,8],
  [5,9,7,12,4,8,11,6,14,9,5,10,7,13,8,4,11,6,9,7,12,5,8,10,6,14,7,9,5,8],
  [4,8,6,11,9,7,13,5,10,8,4,12,6,9,11,5,7,10,8,6,13,4,9,7,11,6,8,12,5,9],
  [6,10,8,13,5,9,7,11,4,12,8,6,10,7,13,5,9,6,11,8,4,10,7,12,6,9,5,11,8,7],
];
function getWaveform(id: string) { return WAVEFORMS[id.charCodeAt(0) % WAVEFORMS.length]; }

function MiniWaveform({ storyId }: { storyId: string }) {
  const bars = getWaveform(storyId);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 1.5, height: 12 }}>
      {bars.map((h, barPos) => (
        <div key={`feed-wave-pos-${barPos}-h-${h}`} style={{
          width: 2, borderRadius: 1,
          height: `${Math.max(2, h * 0.85)}px`,
          backgroundColor: "rgba(245,158,11,0.45)",
        }} />
      ))}
    </div>
  );
}

// Circle stories = stories from all circle members (not Discovery, not Caleb's own)
const circleStories = STORIES.filter(
  s => !s.isDiscovery && s.id !== "caleb-today" &&
    (ALL_CIRCLE_MEMBER_IDS.includes(s.user.id) || s.user.id === "caleb")
);

const DAY_ORDER = ["Today", "Yesterday", "2d ago", "3d ago", "4d ago", "5d ago", "6d ago", "7d ago", "14d ago", "21d ago"];

function getGroupedStories(stories: typeof circleStories) {
  const grouped: Record<string, typeof circleStories> = {};
  for (const story of stories) {
    const key = story.dayLabel ?? "Earlier";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(story);
  }
  const keys = Object.keys(grouped).sort((a, b) => {
    const ai = DAY_ORDER.indexOf(a);
    const bi = DAY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return keys.map(k => ({ label: k, stories: grouped[k] }));
}

export default function FeedScreen({ navigate, goBack, navActive }: NavProps) {
  const [visibleCount, setVisibleCount] = useState(10);
  const [activeCircle, setActiveCircle] = useState<string>("all");

  const filteredCircleStories = activeCircle === "all"
    ? circleStories
    : circleStories.filter(s =>
        CIRCLES.find(c => c.id === activeCircle)?.memberIds.includes(s.user.id) ?? false
      );

  const groups = getGroupedStories(filteredCircleStories);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#0f0c0a", position: "relative" }}>
      <StatusBar />

      <div style={{
        flexShrink: 0,
        paddingTop: 52, padding: "52px 16px 12px",
        display: "flex", alignItems: "center",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        backgroundColor: "#0f0c0a",
      }}>
        <button
          onClick={() => goBack?.()}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 20, padding: "0 10px 0 0", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}
        >
          ←
        </button>
        <div style={{ flex: 1, textAlign: "center" as const }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", fontFamily: "var(--font-dm-sans)" }}>
            Your circles
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-inter)", marginTop: 2 }}>
            {TOTAL_CONNECTIONS} people across {CIRCLES.length} circles
          </div>
        </div>
        <div style={{ width: 36 }} />
      </div>

      {/* Circle filter tabs */}
      <div style={{ display: "flex", gap: 6, padding: "10px 16px 0", overflowX: "auto" as const, flexShrink: 0 }}>
        {[
          { id: "all", label: "All" },
          ...CIRCLES.map(c => ({ id: c.id, label: c.name })),
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveCircle(tab.id); setVisibleCount(10); }}
            style={{
              flexShrink: 0,
              backgroundColor: activeCircle === tab.id ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.03)",
              border: activeCircle === tab.id ? "1px solid rgba(245,158,11,0.28)" : "1px solid rgba(255,255,255,0.07)",
              borderRadius: 20, padding: "5px 14px",
              color: activeCircle === tab.id ? "#f59e0b" : "rgba(255,255,255,0.45)",
              fontSize: 12, fontFamily: "var(--font-inter)", fontWeight: activeCircle === tab.id ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="inner-scroll" style={{ flex: 1, overflowY: "auto", paddingTop: 14, paddingBottom: 76 }}>
        {(() => {
          let seen = 0;
          return groups.map(({ label, stories }) => {
            if (seen >= visibleCount) return null;
            const sliced = stories.slice(0, visibleCount - seen);
            seen += sliced.length;
            return (
          <div key={label}>
            {/* Day group label */}
            <div style={{
              padding: "4px 16px 10px",
              fontSize: 12, color: "rgba(255,255,255,0.4)",
              fontFamily: "var(--font-inter)", fontWeight: 600,
            }}>
              {label}
            </div>

            {sliced.map((story) => {
              return (
                <div
                  key={story.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate("story", "forward", story.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { navigate("story", "forward", story.id); e.preventDefault(); } }}
                  style={{
                    margin: "0 16px 14px",
                    backgroundColor: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 16, cursor: "pointer",
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
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); navigate("user-profile", "forward", story.user.id); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); navigate("user-profile", "forward", story.user.id); } }}
                      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                    >
                      <Avatar userId={story.user.id} color={story.user.color} size={38} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", fontFamily: "var(--font-inter)" }}>
                          {story.user.name}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.32)", fontFamily: "var(--font-inter)", flexShrink: 0 }}>
                        {story.timeAgo}
                      </span>
                    </div>

                    {story.mediaType === "audio" && story.audioDuration && (
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8,
                        backgroundColor: "rgba(245,158,11,0.05)",
                        border: "1px solid rgba(245,158,11,0.1)",
                        borderRadius: 8, padding: "7px 10px", marginTop: 10,
                      }}>
                        <div style={{
                          width: 24, height: 24, borderRadius: "50%",
                          backgroundColor: "rgba(245,158,11,0.14)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0,
                        }}>
                          <div style={{
                            width: 0, height: 0,
                            borderTop: "4px solid transparent",
                            borderBottom: "4px solid transparent",
                            borderLeft: "7px solid rgba(245,158,11,0.85)",
                            marginLeft: 2,
                          }} />
                        </div>
                        <MiniWaveform storyId={story.id} />
                        <span style={{ fontSize: 11, color: "rgba(245,158,11,0.65)", fontFamily: "var(--font-inter)", flexShrink: 0 }}>
                          {story.audioDuration}
                        </span>
                      </div>
                    )}

                    <p style={{
                      fontSize: 14, color: "rgba(255,255,255,0.68)", lineHeight: 1.6,
                      marginTop: 10, marginBottom: 0,
                      display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const, overflow: "hidden",
                      fontFamily: "var(--font-inter)",
                    }}>
                      {story.preview}
                    </p>

                    {(() => {
                      const total = story.reactions.think + story.reactions.changed + story.reactions.felt + story.reactions.door;
                      if (total === 0) return null;
                      return (
                        <div style={{ marginTop: 10 }}>
                          <span style={{ fontSize: 10, color: "rgba(245,158,11,0.42)", fontFamily: "var(--font-inter)" }}>
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
            );
          });
        })()}
        {filteredCircleStories.length > visibleCount && (
          <button
            onClick={() => setVisibleCount(v => v + 10)}
            style={{
              display: "block", width: "calc(100% - 32px)", margin: "0 16px 8px",
              backgroundColor: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12, padding: "10px 20px",
              color: "rgba(255,255,255,0.45)", fontSize: 12,
              fontFamily: "var(--font-inter)", cursor: "pointer",
            }}
          >
            Load more
          </button>
        )}
      </div>

    </div>
  );
}
