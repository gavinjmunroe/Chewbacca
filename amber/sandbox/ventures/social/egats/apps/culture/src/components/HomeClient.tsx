"use client";
import { useEffect, useState } from "react";
import IPhoneMockup from "@/components/IPhoneMockup";
import AppShell from "@/components/AppShell";

export default function HomeClient() {
  const [scale, setScale] = useState(1);
  const [mounted, setMounted] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);

  useEffect(() => {
    setMounted(true);
    const calc = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const wide = vw > 820;
      setShowSidebar(wide);

      const phoneW = 345;
      const phoneH = 740;
      const pad = 32;

      if (wide) {
        // Account for sidebar width + gap so phone doesn't overlap it
        const sidebarW = 240 + 48; // sidebar + gap
        const scaleW = (vw - pad - sidebarW) / phoneW;
        const scaleH = (vh - 80) / phoneH;
        setScale(Math.min(0.95, scaleW, scaleH));
      } else {
        const scaleW = (vw - pad) / phoneW;
        const scaleH = (vh - 80) / phoneH;
        setScale(Math.min(0.95, scaleW, scaleH));
      }
    };
    calc();
    window.addEventListener("resize", calc, { passive: true });
    return () => window.removeEventListener("resize", calc);
  }, []);

  return (
    <div style={{
      background: "radial-gradient(ellipse at 30% 20%, #1a0a2e 0%, #050507 40%, #080308 100%)",
      height: "100vh",
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
    }}>
      {/* Background glow */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(circle at 20% 80%, rgba(139,92,246,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(236,72,153,0.06) 0%, transparent 50%)",
      }} />

      {/* Layout row */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 48,
        position: "relative",
        zIndex: 10,
        padding: "0 24px",
      }}>
        {/* Phone */}
        <div style={{ flexShrink: 0 }}>
          <div style={{
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            opacity: mounted ? 1 : 0,
            transition: "opacity 0.5s ease",
            filter: "drop-shadow(0 40px 100px rgba(0,0,0,0.9)) drop-shadow(0 8px 32px rgba(139,92,246,0.2))",
          }}>
            <IPhoneMockup>
              <AppShell />
            </IPhoneMockup>
          </div>
        </div>

        {/* App info sidebar — only on wide viewports */}
        {showSidebar && (
          <div style={{
            width: 240,
            flexShrink: 0,
            opacity: mounted ? 1 : 0,
            transition: "opacity 0.8s ease 0.4s",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/egatslogocropped.png" alt="EGATS" style={{ width: 36, height: 36, borderRadius: 8, filter: "invert(1) brightness(0.9)" }} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>EGATS Culture</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Dance as Craft</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, marginBottom: 20 }}>
              Every post is two clips: the dance, and the story behind it. Context, credit, craft.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Dual-Clip Posts", desc: "Performance + Explanation" },
                { label: "Lineage Credits", desc: "Always attribute" },
                { label: "Circles", desc: "Crews & city communities" },
                { label: "Challenges", desc: "Require explanation clips" },
              ].map((f) => (
                <div key={f.label} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#A855F7", marginTop: 5, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{f.label}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <a href={process.env.NEXT_PUBLIC_PLATFORM_URL || "#"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 24, background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: 20, padding: "8px 16px", fontSize: 11, fontWeight: 600, color: "#A78BFA", textDecoration: "none" }}>
              Recruiting Platform →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
