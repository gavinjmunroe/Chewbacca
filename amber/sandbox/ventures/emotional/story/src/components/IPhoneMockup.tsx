"use client";
import { ReactNode } from "react";

export default function IPhoneMockup({ children }: { children: ReactNode }) {
  return (
    <div style={{
      width: "345px", height: "740px",
      borderRadius: "56px",
      background: "linear-gradient(160deg, #2e2e30 0%, #1a1a1c 40%, #101012 100%)",
      padding: "13px",
      position: "relative",
      flexShrink: 0,
      boxShadow: `
        0 0 0 1px #3a3a3c,
        0 0 0 2.5px #1c1c1e,
        0 50px 100px rgba(0,0,0,0.6),
        0 25px 50px rgba(0,0,0,0.4),
        inset 0 1px 0 rgba(255,255,255,0.1),
        inset 0 0 0 1px rgba(255,255,255,0.04)
      `,
    }}>
      {/* Power button */}
      <div style={{ position: "absolute", right: "-5px", top: "130px", width: "5px", height: "70px", background: "linear-gradient(to right, #1a1a1c, #3a3a3c)", borderRadius: "0 4px 4px 0" }} />
      {/* Mute */}
      <div style={{ position: "absolute", left: "-5px", top: "100px", width: "5px", height: "36px", background: "linear-gradient(to left, #1a1a1c, #3a3a3c)", borderRadius: "4px 0 0 4px" }} />
      {/* Vol up */}
      <div style={{ position: "absolute", left: "-5px", top: "152px", width: "5px", height: "70px", background: "linear-gradient(to left, #1a1a1c, #3a3a3c)", borderRadius: "4px 0 0 4px" }} />
      {/* Vol down */}
      <div style={{ position: "absolute", left: "-5px", top: "238px", width: "5px", height: "70px", background: "linear-gradient(to left, #1a1a1c, #3a3a3c)", borderRadius: "4px 0 0 4px" }} />
      {/* Screen */}
      <div style={{ width: "100%", height: "100%", borderRadius: "44px", overflow: "hidden", background: "#000", position: "relative" }}>
        {/* Dynamic Island */}
        <div style={{ position: "absolute", top: "13px", left: "50%", transform: "translateX(-50%)", width: "118px", height: "34px", background: "#000", borderRadius: "20px", zIndex: 30, boxShadow: "0 0 0 1.5px #1a1a1c", pointerEvents: "none" }} />
        {/* Content */}
        <div style={{ width: "100%", height: "100%", position: "relative", zIndex: 10 }}>
          {children}
        </div>
        {/* Glare */}
        <div style={{ position: "absolute", inset: 0, borderRadius: "44px", background: "linear-gradient(145deg, rgba(255,255,255,0.045) 0%, transparent 40%)", pointerEvents: "none", zIndex: 20 }} />
      </div>
    </div>
  );
}
