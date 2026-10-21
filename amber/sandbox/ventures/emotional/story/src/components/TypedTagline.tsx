"use client";

import { useEffect, useRef } from "react";

export default function TypedTagline() {
  const elRef = useRef<HTMLSpanElement>(null);
  const typedRef = useRef<import("typed.js").default | null>(null);

  useEffect(() => {
    let Typed: typeof import("typed.js").default;

    async function init() {
      const mod = await import("typed.js");
      Typed = mod.default;
      if (!elRef.current) return;

      typedRef.current = new Typed(elRef.current, {
        strings: [
          "Social media, without the noise.",
          "Verified humans only.",
          "Small circles. Real connections.",
          "Built for depth, not dopamine.",
        ],
        typeSpeed: 42,
        backSpeed: 22,
        backDelay: 2000,
        startDelay: 400,
        loop: true,
        showCursor: true,
        cursorChar: "|",
      });
    }

    init();

    return () => {
      typedRef.current?.destroy();
    };
  }, []);

  return (
    <span
      style={{
        color: "rgba(255,255,255,0.75)",
        fontSize: "1.1rem",
        fontWeight: 400,
        letterSpacing: "0.01em",
        lineHeight: 1.5,
        fontFamily: "var(--font-dm-sans), var(--font-inter), sans-serif",
        display: "inline-block",
        minHeight: "1.6em",
      }}
    >
      <span ref={elRef} />
    </span>
  );
}
