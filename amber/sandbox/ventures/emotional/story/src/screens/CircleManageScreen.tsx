"use client";

import { useState } from "react";
import { NavProps, CIRCLES, USERS } from "@/types";
import StatusBar from "@/components/StatusBar";
import Avatar from "@/components/Avatar";

const TODAY_RESPONSES: Record<string, string> = {
  marcus: "marcus-1",
  priya: "priya-1",
  daniel: "daniel-1",
  aisha: "aisha-1",
  sam: "sam-1",
  mom: "mom-1",
  maya_n: "maya-1",
  chris_m: "chris-1",
  kev: "kev-1",
};

const TODAY_PROMPT = "What are you afraid of that you rarely talk about?";

type CircleType = typeof CIRCLES[number];

interface CircleHeroProps {
  circle: CircleType;
  memberCount: number;
  isActiveToday: boolean;
}

function CircleHero({ circle, memberCount, isActiveToday }: CircleHeroProps) {
  return (
    <div style={{ margin: "16px 16px 0", background: "linear-gradient(145deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.03) 100%)", border: "1px solid rgba(245,158,11,0.14)", borderRadius: 18, padding: "22px 20px 18px" }}>
      <div style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: "rgba(245,158,11,0.16)", border: "1px solid rgba(245,158,11,0.22)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="9" cy="8" r="3" stroke="rgba(245,158,11,0.9)" strokeWidth="1.6"/>
          <circle cx="17" cy="8" r="3" stroke="rgba(245,158,11,0.6)" strokeWidth="1.6"/>
          <path d="M3 18c0-3.3 2.7-6 6-6h0c3.3 0 6 2.7 6 6" stroke="rgba(245,158,11,0.9)" strokeWidth="1.6" strokeLinecap="round"/>
          <path d="M17 12c1.5.3 3 1.5 3.7 3.2.3.8.3 1.8.3 2.8" stroke="rgba(245,158,11,0.55)" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: "#fff", fontFamily: "var(--font-dm-sans)", letterSpacing: "-0.03em", margin: "0 0 5px" }}>{circle.name}</h1>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.52)", fontFamily: "var(--font-inter)", margin: "0 0 14px", lineHeight: 1.45 }}>{circle.description}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontFamily: "var(--font-inter)", display: "flex", alignItems: "center", gap: 5 }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="5" cy="4.5" r="2" stroke="rgba(255,255,255,0.5)" strokeWidth="1.3"/>
            <path d="M1.5 10.5c0-1.9 1.6-3.5 3.5-3.5s3.5 1.6 3.5 3.5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="9.5" cy="4.5" r="1.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.1"/>
            <path d="M11 10.5c0-1.2.6-2.5 1.5-3" stroke="rgba(255,255,255,0.3)" strokeWidth="1.1" strokeLinecap="round"/>
          </svg>
          {memberCount} people · including you
        </span>
        {isActiveToday && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, backgroundColor: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.22)", borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 600, color: "#34d399", fontFamily: "var(--font-inter)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#34d399", boxShadow: "0 0 6px rgba(52,211,153,0.7)", display: "inline-block" }} />
            Active today
          </span>
        )}
      </div>
    </div>
  );
}

interface TodayActivityProps {
  respondedMembers: string[];
  pendingMembers: string[];
  navigate: NavProps["navigate"];
}

function TodayActivity({ respondedMembers, pendingMembers, navigate }: TodayActivityProps) {
  return (
    <div style={{ margin: "20px 16px 0" }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.45)", fontFamily: "var(--font-inter)", margin: "0 0 10px" }}>Today&apos;s prompt</p>
      <div style={{ backgroundColor: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.055)", borderRadius: 12, padding: "13px 15px", marginBottom: 14 }}>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", fontFamily: "var(--font-dm-sans)", fontStyle: "italic", margin: 0, lineHeight: 1.5, letterSpacing: "-0.01em" }}>&ldquo;{TODAY_PROMPT}&rdquo;</p>
      </div>
      {respondedMembers.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: "#34d399", fontFamily: "var(--font-inter)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" fill="rgba(52,211,153,0.15)" stroke="rgba(52,211,153,0.4)" strokeWidth="1"/><path d="M3.5 6L5.2 7.7L8.5 4.3" stroke="#34d399" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Responded ({respondedMembers.length})
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
            {respondedMembers.map((memberId) => {
              const user = USERS[memberId];
              if (!user) return null;
              const storyRef = TODAY_RESPONSES[memberId];
              return (
                <button key={memberId} onClick={() => storyRef && navigate("story", "forward", storyRef)} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(52,211,153,0.04)", border: "1px solid rgba(52,211,153,0.14)", borderRadius: 999, padding: "5px 12px 5px 6px", cursor: "pointer" }}>
                  <Avatar userId={user.id} color={user.color} size={22} />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontFamily: "var(--font-inter)", fontWeight: 500 }}>{user.name.split(" ")[0]}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {pendingMembers.length > 0 && (
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.32)", fontFamily: "var(--font-inter)", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="rgba(255,255,255,0.2)" strokeWidth="1"/><path d="M6 3.5V6.2L7.8 7.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Pending ({pendingMembers.length})
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
            {pendingMembers.map((memberId) => {
              const user = USERS[memberId];
              if (!user) return null;
              return (
                <div key={memberId} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 999, padding: "5px 12px 5px 6px" }}>
                  <Avatar userId={user.id} color={user.color} size={22} />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.38)", fontFamily: "var(--font-inter)", fontWeight: 500 }}>{user.name.split(" ")[0]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface CircleHealthProps {
  respondedCount: number;
  totalCount: number;
  responseRate: number;
}

function CircleHealth({ respondedCount, totalCount, responseRate }: CircleHealthProps) {
  const barWidth = `${responseRate}%`;
  return (
    <div style={{ margin: "22px 16px 0" }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.45)", fontFamily: "var(--font-inter)", margin: "0 0 10px" }}>Circle health</p>
      <div style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.055)", borderRadius: 14, padding: "16px" }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", fontFamily: "var(--font-inter)" }}>Today&apos;s activity</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "var(--font-dm-sans)" }}>{respondedCount}/{totalCount} responded</span>
          </div>
          <div style={{ height: 6, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 999, width: barWidth, background: "linear-gradient(90deg, #f59e0b, #34d399)", transition: "width 0.4s ease" }} />
          </div>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-inter)", margin: "5px 0 0" }}>{responseRate}% of circle active today</p>
        </div>
        <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.055)", margin: "0 0 14px" }} />
        <div style={{ display: "flex", gap: 0 }}>
          {[
            { value: "87%", label: "Reciprocity", sub: "avg response rate", color: "#f59e0b" },
            { value: String(respondedCount), label: "Today", sub: "stories shared", color: "#34d399" },
            { value: String(totalCount), label: "Members", sub: "in this circle", color: "rgba(255,255,255,0.75)" },
          ].map((stat, statPos) => (
            <div key={stat.label} style={{ flex: 1, textAlign: "center" as const }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: stat.color, fontFamily: "var(--font-dm-sans)", letterSpacing: "-0.02em", margin: 0 }}>{stat.value}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "var(--font-inter)", margin: "3px 0 0" }}>{stat.label}</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "var(--font-inter)", margin: "2px 0 0" }}>{stat.sub}</p>
              {statPos < 2 && <div style={{ position: "absolute" }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface MemberListProps {
  circle: CircleType;
  calebPosted: boolean;
  navigate: NavProps["navigate"];
}

function MemberList({ circle, calebPosted, navigate }: MemberListProps) {
  const caleb = USERS.caleb;
  return (
    <div style={{ margin: "24px 16px 0" }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.45)", fontFamily: "var(--font-inter)", margin: "0 0 10px" }}>Members</p>
      <div style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.055)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.045)" }}>
          <Avatar userId={caleb.id} color={caleb.color} size={40} border={calebPosted ? "2px solid rgba(52,211,153,0.6)" : "2px solid rgba(255,255,255,0.1)"} />
          <div style={{ flex: 1, marginLeft: 12 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "var(--font-inter)", margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
              {caleb.name}
              <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(245,158,11,0.7)", backgroundColor: "rgba(245,158,11,0.1)", borderRadius: 4, padding: "2px 7px", fontFamily: "var(--font-inter)" }}>You</span>
            </p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", fontFamily: "var(--font-inter)", margin: "2px 0 0" }}>{caleb.campus}</p>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: calebPosted ? "#34d399" : "rgba(255,255,255,0.28)", backgroundColor: calebPosted ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.04)", border: `1px solid ${calebPosted ? "rgba(52,211,153,0.22)" : "rgba(255,255,255,0.07)"}`, borderRadius: 999, padding: "3px 9px", fontFamily: "var(--font-inter)" }}>
            {calebPosted ? "responded" : "pending"}
          </span>
        </div>
        {circle.memberIds.map((memberId, memberPos) => {
          const user = USERS[memberId];
          if (!user) return null;
          const hasResponded = !!TODAY_RESPONSES[memberId];
          const targetStory = TODAY_RESPONSES[memberId];
          const isLast = memberPos === circle.memberIds.length - 1;
          return (
            <button key={memberId} onClick={() => targetStory && navigate("story", "forward", targetStory)} disabled={!hasResponded} style={{ width: "100%", display: "flex", alignItems: "center", padding: "12px 14px", borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.045)", background: "none", border: "none", borderBottomWidth: isLast ? 0 : 1, borderBottomStyle: "solid", borderBottomColor: "rgba(255,255,255,0.045)", cursor: hasResponded ? "pointer" : "default", textAlign: "left" as const, transition: "background 0.15s" }}>
              <Avatar userId={user.id} color={user.color} size={40} border={hasResponded ? "2px solid rgba(52,211,153,0.5)" : "2px solid rgba(255,255,255,0.08)"} />
              <div style={{ flex: 1, marginLeft: 12 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#fff", fontFamily: "var(--font-inter)", margin: 0 }}>{user.name}</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-inter)", margin: "2px 0 0" }}>{user.campus ?? "USC"}</p>
              </div>
              {hasResponded ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#34d399", backgroundColor: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.22)", borderRadius: 999, padding: "3px 9px", fontFamily: "var(--font-inter)" }}>responded</span>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="rgba(52,211,153,0.5)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.25)", backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 999, padding: "3px 9px", fontFamily: "var(--font-inter)" }}>pending</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function CircleManageScreen({ navigate, goBack, storyId, posted }: NavProps) {
  const circleId = storyId;
  const circle = CIRCLES.find((c) => c.id === circleId);
  const [inviteTapped, setInviteTapped] = useState(false);
  const [leaveTapped, setLeaveTapped] = useState(false);

  if (!circle) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#0f0c0a", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 32px" }}>
        <StatusBar />
        <p style={{ fontSize: 18, color: "rgba(255,255,255,0.65)", fontFamily: "var(--font-dm-sans)", textAlign: "center" }}>Circle not found</p>
        <button onClick={() => goBack ? goBack() : navigate("home", "back")} style={{ padding: "10px 24px", borderRadius: 999, backgroundColor: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b", fontSize: 14, fontWeight: 600, fontFamily: "var(--font-inter)", cursor: "pointer" }}>Go Back</button>
      </div>
    );
  }

  const memberCount = circle.memberIds.length + 1;
  const respondedMembers = circle.memberIds.filter((memberId) => TODAY_RESPONSES[memberId]);
  const pendingMembers = circle.memberIds.filter((memberId) => !TODAY_RESPONSES[memberId]);
  const isActiveToday = respondedMembers.length > 0;
  const calebPosted = !!posted;
  const respondedCount = respondedMembers.length + (calebPosted ? 1 : 0);
  const responseRate = Math.round((respondedCount / memberCount) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#0f0c0a", position: "relative" }}>
      <StatusBar />

      <div style={{ position: "absolute", top: 52, left: 0, right: 0, height: 44, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", pointerEvents: "none" }}>
        <button onClick={() => goBack ? goBack() : navigate("home", "back")} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px 4px 0", pointerEvents: "all", display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12.5 5L7.5 10L12.5 15" stroke="rgba(255,255,255,0.8)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.9)", fontFamily: "var(--font-inter)", letterSpacing: "-0.01em", pointerEvents: "none", whiteSpace: "nowrap" }}>{circle.name}</span>
        <div style={{ width: 32 }} />
      </div>

      <div className="inner-scroll" style={{ flex: 1, overflowY: "auto", paddingTop: 96, paddingBottom: 40 }}>
        <CircleHero circle={circle} memberCount={memberCount} isActiveToday={isActiveToday} />
        <TodayActivity respondedMembers={respondedMembers} pendingMembers={pendingMembers} navigate={navigate} />
        <MemberList circle={circle} calebPosted={calebPosted} navigate={navigate} />
        <CircleHealth respondedCount={respondedCount} totalCount={memberCount} responseRate={responseRate} />

        <div style={{ margin: "24px 16px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <button onClick={() => setInviteTapped(true)} style={{ width: "100%", padding: "14px 0", borderRadius: 999, backgroundColor: "transparent", border: "1.5px solid rgba(245,158,11,0.45)", color: "#f59e0b", fontSize: 15, fontWeight: 700, fontFamily: "var(--font-dm-sans)", cursor: "pointer", letterSpacing: "-0.01em", transition: "border-color 0.15s, background 0.15s" }}>
            Invite to {circle.name}
          </button>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontFamily: "var(--font-inter)", margin: 0, opacity: inviteTapped ? 1 : 0, transition: "opacity 0.2s" }}>Coming soon</p>
          <button onClick={() => setLeaveTapped(true)} style={{ background: "none", border: "none", cursor: "pointer", marginTop: 10, padding: "6px 0", fontSize: 12, fontWeight: 500, color: "rgba(239,68,68,0.45)", fontFamily: "var(--font-inter)" }}>Leave Circle</button>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontFamily: "var(--font-inter)", margin: 0, opacity: leaveTapped ? 1 : 0, transition: "opacity 0.2s" }}>Coming soon</p>
        </div>

        <div style={{ height: 32 }} />
      </div>
    </div>
  );
}

