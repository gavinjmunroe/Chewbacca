"use client";
import { useEffect, useState } from "react";
import IPhoneMockup from "@/components/IPhoneMockup";
import AppShell from "@/components/AppShell";
import GranimBg from "@/components/GranimBg";

export default function HomeClient() {
  const [scale, setScale] = useState(1);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const calc = () => {
      const scaleH = (window.innerHeight - 80) / 740;
      const scaleW = (window.innerWidth - 32) / 345;
      setScale(Math.min(0.92, scaleH, scaleW));
    };
    calc();
    window.addEventListener("resize", calc, { passive: true });
    return () => window.removeEventListener("resize", calc);
  }, []);

  return (
    <div
      style={{
        background: "#08091a",
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        fontFamily: "var(--font-dm-sans), var(--font-inter), system-ui, sans-serif",
      }}
    >
      <GranimBg />
      <div
        style={{ position: "relative", zIndex: 10 }}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            opacity: mounted ? 1 : 0,
            transition: "opacity 0.5s ease",
            filter: "drop-shadow(0 40px 100px rgba(0,0,0,0.9)) drop-shadow(0 8px 32px rgba(83,52,131,0.18))",
          }}
        >
          <IPhoneMockup>
            <AppShell />
          </IPhoneMockup>
        </div>
      </div>
    </div>
  );
}
