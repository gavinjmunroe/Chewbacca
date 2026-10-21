"use client";

import { useState, useEffect } from "react";
import Image from "next/image";

export default function StatusBar() {
  const [time, setTime] = useState(() => {
    const now = new Date();
    const h = now.getHours() % 12 || 12;
    const m = String(now.getMinutes()).padStart(2, "0");
    const ampm = now.getHours() < 12 ? "AM" : "PM";
    return `${h}:${m} ${ampm}`;
  });

  useEffect(() => {
    const fmt = () => {
      const now = new Date();
      const h = now.getHours() % 12 || 12;
      const m = String(now.getMinutes()).padStart(2, "0");
      const ampm = now.getHours() < 12 ? "AM" : "PM";
      setTime(`${h}:${m} ${ampm}`);
    };
    fmt();
    const id = setInterval(fmt, 60000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      position: "absolute",
      top: 0, left: 0, right: 0,
      height: "52px",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      padding: "0 22px 8px",
      zIndex: 20,
      pointerEvents: "none",
      background: "#0a0a0a",
    }}>
      {/* Time */}
      <span style={{
        fontSize: "13px",
        fontWeight: 700,
        color: "rgba(255,255,255,0.9)",
        letterSpacing: "0.01em",
        fontFamily: "var(--font-inter), sans-serif",
      }}>
        {time}
      </span>

      {/* Logo — centered */}
      <Image
        src="/storycropped.png"
        alt="story"
        width={60}
        height={15}
        style={{
          position: "absolute",
          left: "50%",
          bottom: 9,
          transform: "translateX(-50%)",
          height: 15,
          width: "auto",
          objectFit: "contain",
          opacity: 0.75,
          filter: "brightness(0) saturate(100%) invert(74%) sepia(100%) saturate(276%) hue-rotate(0deg) brightness(82%)",
        }}
      />

      {/* Right icons */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        {/* Signal bars */}
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
          <rect x="0" y="7" width="3" height="4" rx="0.8" fill="rgba(255,255,255,0.9)"/>
          <rect x="4.5" y="4.5" width="3" height="6.5" rx="0.8" fill="rgba(255,255,255,0.9)"/>
          <rect x="9" y="2" width="3" height="9" rx="0.8" fill="rgba(255,255,255,0.9)"/>
          <rect x="13.5" y="0" width="3" height="11" rx="0.8" fill="rgba(255,255,255,0.55)"/>
        </svg>

        {/* WiFi */}
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <path d="M8 9.5a1.3 1.3 0 1 1 0 2.6A1.3 1.3 0 0 1 8 9.5z" fill="rgba(255,255,255,0.9)"/>
          <path d="M4.5 7.5C5.6 6.4 6.8 5.8 8 5.8s2.4.6 3.5 1.7" stroke="rgba(255,255,255,0.9)" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
          <path d="M1.5 4.5C3.2 2.8 5.5 1.8 8 1.8s4.8 1 6.5 2.7" stroke="rgba(255,255,255,0.9)" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
        </svg>

        {/* Battery */}
        <div style={{ display: "flex", alignItems: "center", gap: "1px" }}>
          <div style={{
            width: "22px",
            height: "11px",
            border: "1.2px solid rgba(255,255,255,0.7)",
            borderRadius: "3px",
            padding: "1.5px",
            display: "flex",
            alignItems: "center",
          }}>
            <div style={{
              width: "97%",
              height: "100%",
              background: "rgba(255,255,255,0.85)",
              borderRadius: "1.5px",
            }} />
          </div>
          <div style={{
            width: "2px",
            height: "5px",
            background: "rgba(255,255,255,0.7)",
            borderRadius: "0 1px 1px 0",
          }} />
        </div>
      </div>
    </div>
  );
}
