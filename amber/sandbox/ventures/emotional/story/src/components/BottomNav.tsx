"use client";

import { Screen } from "@/types";

interface BottomNavProps {
  active: "home" | "compose" | "discovery" | "profile";
  navigate: (screen: Screen, direction?: "forward" | "back") => void;
}

const tabs: { id: "home" | "compose" | "discovery" | "profile"; screen: Screen; label: string; ariaLabel: string }[] = [
  { id: "home",      screen: "home",      label: "Home",     ariaLabel: "Home feed" },
  { id: "compose",   screen: "compose",   label: "Respond",  ariaLabel: "Respond to today's prompt" },
  { id: "discovery", screen: "discovery", label: "Discover", ariaLabel: "Discover voices" },
  { id: "profile",   screen: "profile",   label: "Profile",  ariaLabel: "Your profile" },
];

const TAB_ORDER = ["home", "compose", "discovery", "profile"];

function HomeIcon({ active }: { active: boolean }) {
  const c = active ? "#f59e0b" : "rgba(255,255,255,0.35)";
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path d="M3 9.5L11 3l8 6.5V19a1 1 0 0 1-1 1H14v-5H8v5H4a1 1 0 0 1-1-1V9.5z"
        fill={active ? "rgba(245,158,11,0.15)" : "none"}
        stroke={c} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

function WriteIcon({ active }: { active: boolean }) {
  const c = active ? "#f59e0b" : "rgba(255,255,255,0.35)";
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path d="M15.5 3.5a2.121 2.121 0 0 1 3 3L7 18l-4 1 1-4L15.5 3.5z"
        stroke={c} strokeWidth="1.5" strokeLinejoin="round"
        fill={active ? "rgba(245,158,11,0.12)" : "none"}/>
    </svg>
  );
}

function DiscoverIcon({ active }: { active: boolean }) {
  const c = active ? "#f59e0b" : "rgba(255,255,255,0.35)";
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="8" stroke={c} strokeWidth="1.5"
        fill={active ? "rgba(245,158,11,0.08)" : "none"}/>
      <path d="M14 8l-2.5 5.5L6 14l2.5-5.5L14 8z" stroke={c} strokeWidth="1.3"
        strokeLinejoin="round" fill={active ? "rgba(245,158,11,0.25)" : "none"}/>
    </svg>
  );
}

function ProfileIcon({ active }: { active: boolean }) {
  const c = active ? "#f59e0b" : "rgba(255,255,255,0.35)";
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="7.5" r="3.5" stroke={c} strokeWidth="1.5"
        fill={active ? "rgba(245,158,11,0.15)" : "none"}/>
      <path d="M3.5 19c0-4.142 3.358-7.5 7.5-7.5s7.5 3.358 7.5 7.5"
        stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export default function BottomNav({ active, navigate }: BottomNavProps) {
  const currentIdx = TAB_ORDER.indexOf(active);

  return (
    <div style={{
      position: "absolute",
      bottom: 0, left: 0, right: 0,
      height: "76px",
      background: "linear-gradient(to top, rgba(15,12,10,1) 55%, rgba(15,12,10,0.0))",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-around",
      paddingTop: "10px",
      zIndex: 20,
    }}>
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        const targetIdx = TAB_ORDER.indexOf(tab.id);
        const dir: "forward" | "back" = targetIdx >= currentIdx ? "forward" : "back";
        return (
          <button
            key={tab.id}
            aria-label={tab.ariaLabel}
            aria-current={isActive ? "page" : undefined}
            onClick={() => navigate(tab.screen, dir)}
            style={{
              display: "flex", flexDirection: "column",
              alignItems: "center", gap: "3px",
              background: "none", border: "none", cursor: "pointer",
              padding: "6px 16px",
              minHeight: "44px",
              position: "relative",
            }}
          >
            {/* Notification badge — only on Home when not active */}
            {tab.id === "home" && !isActive && (
              <div style={{
                position: "absolute",
                top: 2, right: "calc(50% - 20px)",
                minWidth: 16, height: 16, borderRadius: 999,
                backgroundColor: "#f59e0b",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "0 4px",
              }}>
                <span style={{ fontSize: 9, color: "#fff", fontWeight: 700, fontFamily: "var(--font-inter)", lineHeight: 1 }}>
                  4
                </span>
              </div>
            )}
            {tab.id === "home"      && <HomeIcon active={isActive} />}
            {tab.id === "compose"   && <WriteIcon active={isActive} />}
            {tab.id === "discovery" && <DiscoverIcon active={isActive} />}
            {tab.id === "profile"   && <ProfileIcon active={isActive} />}
            <span style={{
              fontSize: "10px",
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "#f59e0b" : "rgba(255,255,255,0.3)",
              letterSpacing: "0.02em",
              fontFamily: "var(--font-inter), sans-serif",
              transition: "color 0.2s ease",
            }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
