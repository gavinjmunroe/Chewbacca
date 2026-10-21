"use client";

import { useEffect } from "react";

export function ScrollEffectsInit() {
  useEffect(() => {
    let lastY = window.scrollY;
    let lastT = performance.now();
    let raf: number;

    const tick = () => {
      const now = performance.now();
      const y = window.scrollY;
      const dt = now - lastT;
      const dy = Math.abs(y - lastY);
      const velocity = dt > 0 ? (dy / dt) * 16 : 0;

      const docH = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docH > 0 ? y / docH : 0;

      document.documentElement.style.setProperty("--scroll-progress", progress.toFixed(4));
      document.documentElement.style.setProperty("--scroll-velocity", velocity.toFixed(2));

      lastY = y;
      lastT = now;
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return null;
}
