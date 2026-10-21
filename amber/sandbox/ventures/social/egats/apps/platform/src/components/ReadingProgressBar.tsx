"use client";

import { useEffect, useRef } from "react";

export function ReadingProgressBar() {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf: number;
    const tick = () => {
      const progress = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--scroll-progress") || "0"
      );
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${progress})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: 9999,
        background: "rgba(191,90,242,0.12)",
        pointerEvents: "none",
      }}
    >
      <div
        ref={barRef}
        style={{
          height: "100%",
          background: "linear-gradient(to right, #BF5AF2, #7B79F7)",
          transformOrigin: "left",
          transform: "scaleX(0)",
          willChange: "transform",
        }}
      />
    </div>
  );
}
