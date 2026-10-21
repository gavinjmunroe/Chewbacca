"use client";

import type { NavProps } from "@/types";
import StatusBar from "@/components/StatusBar";
import Avatar from "@/components/Avatar";
import { CIRCLES, TOTAL_CONNECTIONS, STORIES, USERS } from "@/types";
import Image from "next/image";

function dateLabel(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function parseDayLabel(label?: string): string {
  if (!label) return "";
  if (label === "Today") return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (label === "Yesterday") return dateLabel(1);
  const m = label.match(/^(\d+)d ago$/);
  if (m) return dateLabel(parseInt(m[1], 10));
  return label;
}

const PROFILE_STORY_IDS = ["caleb-1", "caleb-2", "caleb-3"];

const METRICS = [
  { value: "91%",  label: "Reciprocity",  sub: "read every post"       },
  { value: "47",   label: "Responses",    sub: "total stories shared"  },
  { value: "142",  label: "Resonances",   sub: "across your stories"   },
];

const PRACTICE_STATS = [
  { label: "Completion rate", value: "94%" },
  { label: "Avg reply depth", value: "Active" },
  { label: "Stories / week", value: "7" },
];

interface ProfileStoryCardProps {
  story: typeof STORIES[number];
  navigate: NavProps["navigate"];
}

function ProfileStoryCard({ story, navigate }: ProfileStoryCardProps) {
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
          <span style={{ marginLeft: 6, fontSize: 10, color: story.mediaType === "audio" ? "rgba(245,158,11,0.55)" : "rgba(255,255,255,0.25)", fontFamily: "var(--font-inter)" }}>
            {story.mediaType === "audio" ? `▶ ${story.audioDuration}` : story.mediaType}
          </span>
          <span style={{ fontSize: 10, color: "rgba(245,158,11,0.4)", fontFamily: "var(--font-inter)", marginLeft: "auto", letterSpacing: "0.03em" }}>
            {story.reactions.think + story.reactions.changed + story.reactions.felt + story.reactions.door} resonated
          </span>
        </div>
        {story.promptText && (
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontStyle: "italic", lineHeight: 1.4, margin: "5px 0 0", fontFamily: "var(--font-inter)", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>
            {story.promptText}
          </p>
        )}
        <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.62)", lineHeight: 1.5, margin: "5px 0 0", fontFamily: "var(--font-inter)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>
          {story.preview}
        </p>
      </div>
    </div>
  );
}

interface CircleRowProps {
  circle: typeof CIRCLES[number];
  navigate: NavProps["navigate"];
}

function CircleRow({ circle, navigate }: CircleRowProps) {
  const members = circle.memberIds.map(memberId => USERS[memberId]).filter(Boolean);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate("circle-manage", "forward", circle.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { navigate("circle-manage", "forward", circle.id); e.preventDefault(); } }}
      style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, padding: "12px 14px", cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <span style={{ fontSize: 13, color: "#fff", fontWeight: 600, fontFamily: "var(--font-inter)" }}>{circle.name}</span>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", fontFamily: "var(--font-inter)", marginTop: 2 }}>{circle.description}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "rgba(245,158,11,0.55)", fontFamily: "var(--font-inter)", flexShrink: 0 }}>{circle.memberIds.length + 1} people</span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.22)" }}>›</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        {members.slice(0, 7).map((u, memberPos) => (
          <div key={u.id} style={{ marginLeft: memberPos === 0 ? 0 : -6, zIndex: 7 - memberPos, position: "relative" }}>
            <Avatar userId={u.id} color={u.color} size={28} border="2px solid #0f0c0a" />
          </div>
        ))}
        {members.length > 7 && (
          <span style={{ marginLeft: 6, fontSize: 10, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)" }}>+{members.length - 7}</span>
        )}
      </div>
    </div>
  );
}

export default function ProfileScreen({ navigate, navActive: _navActive }: NavProps) {
  const profileStories = PROFILE_STORY_IDS.map(storyId => STORIES.find(s => s.id === storyId)).filter(Boolean) as typeof STORIES;
  const caleb = USERS.caleb;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#0f0c0a", position: "relative" }}>
      <StatusBar />

      <div className="inner-scroll" style={{ flex: 1, overflowY: "auto", paddingTop: 52, paddingBottom: 80 }}>
        <div style={{ padding: "16px 16px 0", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={() => navigate("settings", "forward")} style={{ background: "none", border: "none", cursor: "pointer", width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.04)" }} aria-label="Settings">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="2.5" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4"/>
              <path d="M9 1.5v1.3M9 15.2v1.3M1.5 9h1.3M15.2 9h1.3M3.6 3.6l.9.9M13.5 13.5l.9.9M14.4 3.6l-.9.9M4.5 13.5l-.9.9" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div style={{ padding: "8px 20px 0", textAlign: "center" as const }}>
          <div style={{ position: "relative", display: "inline-block", marginBottom: 14 }}>
            <Avatar userId={caleb.id} color={caleb.color} size={72} border="2px solid rgba(52,211,153,0.8)" />
          </div>
          <h1 style={{ fontSize: 22, color: "#fff", fontWeight: 700, fontFamily: "var(--font-dm-sans)", letterSpacing: "-0.02em", margin: 0 }}>{caleb.name}</h1>
          <p style={{ fontSize: 12, color: "#34d399", fontWeight: 600, margin: "4px 0 0", fontFamily: "var(--font-inter)" }}>✓ Verified Human</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.38)", margin: "3px 0 0", fontFamily: "var(--font-inter)" }}>{caleb.campus}</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.28)", margin: "2px 0 0", fontFamily: "var(--font-inter)" }}>CS + Philosophy &apos;27</p>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" as const }}>
            {CIRCLES.map(c => (
              <span key={c.id} role="button" tabIndex={0} onClick={() => navigate("circle-manage", "forward", c.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { navigate("circle-manage", "forward", c.id); e.preventDefault(); } }} style={{ display: "inline-block", backgroundColor: "rgba(245,158,11,0.08)", color: "rgba(245,158,11,0.75)", fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 999, fontFamily: "var(--font-inter)", border: "1px solid rgba(245,158,11,0.15)", cursor: "pointer" }}>
                {c.name}
              </span>
            ))}
          </div>
        </div>

        <div style={{ margin: "20px 16px 0", backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.055)", borderRadius: 14, padding: "16px 0", display: "flex" }}>
          {METRICS.map((m, metricPos) => (
            <div key={m.label} style={{ flex: 1, textAlign: "center" as const, borderRight: metricPos < 2 ? "1px solid rgba(255,255,255,0.055)" : "none", padding: "0 8px" }}>
              <p style={{ fontSize: 20, color: "#fff", fontWeight: 700, fontFamily: "var(--font-dm-sans)", margin: 0 }}>{m.value}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.52)", fontFamily: "var(--font-inter)", margin: "5px 0 0" }}>{m.label}</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", fontFamily: "var(--font-inter)", margin: "3px 0 0" }}>{m.sub}</p>
            </div>
          ))}
        </div>

        <div style={{ margin: "10px 16px 0", backgroundColor: "rgba(52,211,153,0.03)", border: "1px solid rgba(52,211,153,0.1)", borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "#34d399", fontFamily: "var(--font-inter)", fontWeight: 600, letterSpacing: "0.03em" }}>Your Practice</span>
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            {PRACTICE_STATS.map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 15, color: "#fff", fontWeight: 700, fontFamily: "var(--font-dm-sans)" }}>{value}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-inter)", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ margin: "14px 16px 0" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: 600, fontFamily: "var(--font-inter)", marginBottom: 10 }}>Your circles</div>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
            {CIRCLES.map(circle => <CircleRow key={circle.id} circle={circle} navigate={navigate} />)}
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: "rgba(255,255,255,0.28)", fontFamily: "var(--font-inter)" }}>
            {TOTAL_CONNECTIONS} people across {CIRCLES.length} circles
          </div>
        </div>

        <div style={{ margin: "18px 0 0", padding: "0 16px" }}>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: 600, fontFamily: "var(--font-inter)", margin: "0 0 12px" }}>Your stories</p>
          {profileStories.map((story) => <ProfileStoryCard key={story.id} story={story} navigate={navigate} />)}
        </div>

        <div style={{ margin: "8px 16px 0", padding: 14, backgroundColor: "rgba(255,255,255,0.012)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 12 }}>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.32)", lineHeight: 1.55, textAlign: "center" as const, fontFamily: "var(--font-inter)", margin: 0 }}>
            No public follower count. No engagement score. No performance anxiety.
            {" Your stories reach your Circle. That\u2019s it."}
          </p>
        </div>
      </div>
    </div>
  );
}
