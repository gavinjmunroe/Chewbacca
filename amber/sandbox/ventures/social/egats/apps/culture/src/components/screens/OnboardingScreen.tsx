"use client";
import React, { useState } from "react";

interface Props { dispatch: React.Dispatch<{ type: "FINISH_ONBOARDING" }>; style: React.CSSProperties; }

const SLIDES = [
  {
    icon: (
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#A855F7" strokeWidth="1.5">
        <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
        <path d="M12 19v3M8 21h8M6 8a6 6 0 0 0 12 0"/>
      </svg>
    ),
    title: "Every Great Artist\nTakes Space.",
    sub: "EGATS Culture is where dance lives as craft, not content. Lineage. Context. Credit.",
    bg: "linear-gradient(160deg, #1a0a2e 0%, #050507 100%)",
  },
  {
    icon: (
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#A855F7" strokeWidth="1.5">
        <rect x="2" y="2" width="20" height="20" rx="4"/>
        <path d="M10 8l6 4-6 4V8z" fill="#A855F7"/>
      </svg>
    ),
    title: "Two clips.\nEvery post.",
    sub: "Show the dance. Then explain the inspiration, the influences, who taught you, what you want people to notice.",
    bg: "linear-gradient(160deg, #0f0a1e 0%, #050507 100%)",
  },
  {
    icon: (
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#EC4899" strokeWidth="1.5">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <path d="M9 12l2 2 4-4"/>
      </svg>
    ),
    title: "Credit the\nlineage.",
    sub: "Every move came from somewhere. Naming your influences builds respect — and keeps culture alive.",
    bg: "linear-gradient(160deg, #150520 0%, #050507 100%)",
  },
  {
    icon: (
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#5E5CE6" strokeWidth="1.5">
        <circle cx="12" cy="5" r="2"/>
        <circle cx="5" cy="19" r="2"/>
        <circle cx="19" cy="19" r="2"/>
        <path d="M12 7v4M10 19H7M17 19h-3M12 11l-5 6M12 11l5 6"/>
      </svg>
    ),
    title: "Circles for\nyour community.",
    sub: "Join crews, city scenes, and style communities. Circles are where the real conversations happen.",
    bg: "linear-gradient(160deg, #0a1020 0%, #050507 100%)",
  },
];

export default function OnboardingScreen({ dispatch, style }: Props) {
  const [slide, setSlide] = useState(0);
  const current = SLIDES[slide];
  const last = slide === SLIDES.length - 1;

  return (
    <div style={{ ...style, background: current.bg, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "60px 28px 28px" }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/egatslogocropped.png" alt="EGATS" style={{ width: 28, height: 28, borderRadius: 6 }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: -0.3 }}>EGATS Culture</span>
      </div>

      {/* Content */}
      <div>
        <div style={{ marginBottom: 24 }}>{current.icon}</div>
        <h1 style={{
          fontSize: 30, fontWeight: 800, color: "#fff", lineHeight: 1.2, marginBottom: 14,
          whiteSpace: "pre-line", letterSpacing: -0.5,
        }}>
          {current.title}
        </h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.7 }}>{current.sub}</p>
      </div>

      {/* Nav */}
      <div>
        <div style={{ display: "flex", gap: 6, marginBottom: 20, justifyContent: "center" }}>
          {SLIDES.map((_, i) => (
            <div key={`dot-${i}`} style={{
              height: 4, borderRadius: 2,
              width: i === slide ? 24 : 8,
              background: i === slide ? "#A855F7" : "rgba(255,255,255,0.2)",
              transition: "all 0.3s ease",
            }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {slide > 0 && (
            <button
              onClick={() => setSlide((s) => s - 1)}
              style={{ flex: 1, padding: "14px 0", borderRadius: 14, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Back
            </button>
          )}
          <button
            onClick={() => last ? dispatch({ type: "FINISH_ONBOARDING" }) : setSlide((s) => s + 1)}
            style={{ flex: 2, padding: "14px 0", borderRadius: 14, background: last ? "linear-gradient(135deg, #7C3AED, #EC4899)" : "#7C3AED", border: "none", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 20px rgba(124,58,237,0.4)" }}>
            {last ? "Start Exploring" : "Next"}
          </button>
        </div>
        {slide === 0 && (
          <button
            onClick={() => dispatch({ type: "FINISH_ONBOARDING" })}
            style={{ width: "100%", marginTop: 12, background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 13, cursor: "pointer", padding: 8 }}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
