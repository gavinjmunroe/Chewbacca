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
      const scaleW = (window.innerWidth - 48) / 345;
      setScale(Math.min(0.92, scaleH, scaleW));
    };
    calc();
    window.addEventListener("resize", calc, { passive: true });
    return () => window.removeEventListener("resize", calc);
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    const el = document.querySelector(".inner-scroll") as HTMLElement | null;
    if (el) el.scrollTop += e.deltaY;
  };

  return (
    <div
      style={{
        background: "#060809",
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        fontFamily: "var(--font-inter), var(--font-dm-sans), sans-serif",
      }}
    >
      <GranimBg />
      <div
        onWheel={handleWheel}
        style={{ position: "relative", zIndex: 10 }}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            opacity: mounted ? 1 : 0,
            transition: "opacity 0.5s ease",
            filter: "drop-shadow(0 48px 120px rgba(0,0,0,0.95)) drop-shadow(0 12px 32px rgba(0,0,0,0.7)) drop-shadow(0 0 80px rgba(100,180,220,0.06))",
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
