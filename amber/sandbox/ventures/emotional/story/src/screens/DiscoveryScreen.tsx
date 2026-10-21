"use client";

import { useState } from "react";
import { NavProps, STORIES, ALL_CIRCLE_MEMBER_IDS, CIRCLES } from "@/types";
import StatusBar from "@/components/StatusBar";
import Avatar from "@/components/Avatar";
import Image from "next/image";

const WAVEFORM_SM = [3,6,4,9,6,11,8,5,10,7,4,9,6,8,11,5,7,9,4,6,10,7,5,8,11,6,4,7];

function MiniWaveform() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 1.5, height: 14 }}>
      {WAVEFORM_SM.slice(0, 18).map((h, barPos) => (
        <div key={`wave-sm-pos-${barPos}-h-${h}`} style={{
          width: 2, borderRadius: 1,
          height: `${Math.max(2, h * 1.1)}px`,
          backgroundColor: "rgba(245,158,11,0.5)",
        }} />
      ))}
    </div>
  );
}

const discoveryStories = [...STORIES.filter(s => s.isDiscovery)].sort((a, b) => {
  const aR = a.reactions.think + a.reactions.changed + a.reactions.felt + a.reactions.door;
  const bR = b.reactions.think + b.reactions.changed + b.reactions.felt + b.reactions.door;
  return bR - aR;
});

export default function DiscoveryScreen({ navigate, navActive }: NavProps) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? discoveryStories.filter(s =>
        s.preview.toLowerCase().includes(search.toLowerCase()) ||
        s.user.name.toLowerCase().includes(search.toLowerCase()) ||
        s.user.campus?.toLowerCase().includes(search.toLowerCase()) ||
        (s.promptText?.toLowerCase().includes(search.toLowerCase()) ?? false)
      )
    : discoveryStories;

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100%", backgroundColor: "#0f0c0a", position: "relative",
    }}>
      <StatusBar />

      <div className="inner-scroll" style={{
        flex: 1, overflowY: "auto",
        paddingTop: 52, paddingBottom: 80,
      }}>
        {/* Header */}
        <div style={{ padding: "22px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <h1 style={{
              fontSize: 26, fontWeight: 800, color: "#ffffff",
              fontFamily: "var(--font-dm-sans)", letterSpacing: "-0.02em", margin: 0,
            }}>
              Discovery
            </h1>
            <div style={{
              backgroundColor: "rgba(52,211,153,0.06)",
              border: "1px solid rgba(52,211,153,0.14)",
              borderRadius: 8, padding: "4px 9px",
              display: "flex", alignItems: "center", gap: 5, marginTop: 3,
            }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "#34d399", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#34d399", fontFamily: "var(--font-inter)", fontWeight: 600 }}>
                Unlocked
              </span>
            </div>
          </div>
          <p style={{
            fontSize: 13, color: "rgba(255,255,255,0.38)", margin: "8px 0 0",
            fontFamily: "var(--font-inter)", lineHeight: 1.6,
          }}>
            Voices from outside your Circles. Editorially curated, not algorithmic.
            Sorted by resonance, not recency.
          </p>
        </div>

        {/* Context pill — Discovery unlocks after Circle loop */}
        <div style={{ padding: "10px 16px 0" }}>
          <div style={{
            backgroundColor: "rgba(52,211,153,0.04)",
            border: "1px solid rgba(52,211,153,0.1)",
            borderRadius: 8, padding: "8px 12px",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "#34d399", flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: "rgba(52,211,153,0.75)", fontFamily: "var(--font-inter)", lineHeight: 1.4 }}>
              You completed your Circle loop today. Discovery is unlocked.
            </span>
          </div>
        </div>

        {/* Search bar */}
        <div style={{ padding: "14px 16px 0" }}>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or theme..."
              style={{
                width: "100%",
                backgroundColor: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 10,
                padding: search ? "10px 36px 10px 14px" : "10px 14px",
                color: "#fff",
                fontSize: 13,
                fontFamily: "var(--font-inter)",
                outline: "none",
                boxSizing: "border-box" as const,
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{
                  position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none",
                  color: "rgba(255,255,255,0.38)", fontSize: 14,
                  cursor: "pointer", padding: "0 4px", lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Story cards */}
        <div style={{ padding: "14px 16px 0" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "40px 16px", textAlign: "center" as const }}>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)" }}>
                No voices found for &ldquo;{search}&rdquo;
              </p>
            </div>
          )}
          {filtered.map((story) => {
            const totalResonated = story.reactions.think + story.reactions.changed + story.reactions.felt + story.reactions.door;
            return (
              <div
                key={story.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate("story", "forward", story.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { navigate("story", "forward", story.id); e.preventDefault(); } }}
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 14, marginBottom: 10, cursor: "pointer",
                  overflow: "hidden",
                }}
              >
                {/* Photo banner */}
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
                    <div style={{
                      position: "absolute", bottom: 7, right: 10,
                      fontSize: 10, color: "rgba(255,255,255,0.32)",
                      fontFamily: "var(--font-inter)",
                    }}>
                      ◎ photo
                    </div>
                  </div>
                )}

                <div style={{ padding: "12px 14px" }}>
                  {/* Author row */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); navigate("user-profile", "forward", story.user.id); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); navigate("user-profile", "forward", story.user.id); } }}
                    style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}
                  >
                    <Avatar userId={story.user.id} color={story.user.color} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 13, color: "#fff", fontWeight: 600, fontFamily: "var(--font-inter)" }}>
                          {story.user.name}
                        </span>
                        <span style={{ fontSize: 10, color: "#34d399", fontWeight: 700 }}>✓</span>
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "var(--font-inter)", marginTop: 1 }}>
                        {story.user.campus}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", fontFamily: "var(--font-inter)", flexShrink: 0 }}>
                      {story.timeAgo}
                    </span>
                  </div>

                  {/* Prompt context */}
                  {story.promptText && (
                    <div style={{
                      marginTop: 9, fontSize: 10, color: "rgba(245,158,11,0.45)",
                      fontStyle: "italic", fontFamily: "var(--font-inter)",
                      whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {story.promptText}
                    </div>
                  )}

                  {/* Audio pill */}
                  {story.mediaType === "audio" && story.audioDuration && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      backgroundColor: "rgba(245,158,11,0.06)",
                      border: "1px solid rgba(245,158,11,0.1)",
                      borderRadius: 8, padding: "7px 10px", marginTop: 9,
                    }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: "50%",
                        backgroundColor: "rgba(245,158,11,0.16)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        <div style={{
                          width: 0, height: 0,
                          borderTop: "4px solid transparent",
                          borderBottom: "4px solid transparent",
                          borderLeft: "7px solid rgba(245,158,11,0.9)",
                          marginLeft: 2,
                        }} />
                      </div>
                      <MiniWaveform />
                      <span style={{ fontSize: 11, color: "rgba(245,158,11,0.65)", fontFamily: "var(--font-inter)", flexShrink: 0 }}>
                        {story.audioDuration}
                      </span>
                    </div>
                  )}

                  {/* Preview */}
                  <p style={{
                    fontSize: 12.5, color: "rgba(255,255,255,0.68)", lineHeight: 1.55,
                    margin: "9px 0 0", fontFamily: "var(--font-inter)",
                    display: "-webkit-box", WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical" as const, overflow: "hidden",
                  }}>
                    {story.preview}
                  </p>

                  {/* Footer */}
                  {totalResonated > 0 && (
                    <div style={{ marginTop: 9 }}>
                      <span style={{ fontSize: 10, color: "rgba(245,158,11,0.45)", fontFamily: "var(--font-inter)" }}>
                        {totalResonated} resonated
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer note */}
        <div style={{
          margin: "4px 16px 16px",
          padding: "12px 14px",
          backgroundColor: "rgba(255,255,255,0.015)",
          border: "1px solid rgba(255,255,255,0.04)",
          borderRadius: 12,
        }}>
          <p style={{
            fontSize: 11, color: "rgba(255,255,255,0.32)", lineHeight: 1.55,
            margin: 0, fontFamily: "var(--font-inter)", textAlign: "center" as const,
          }}>
            Verified voices. No engagement bait. No outrage loops. No AI content.
          </p>
        </div>
      </div>

    </div>
  );
}
