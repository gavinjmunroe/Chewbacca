"use client";

import { useReducer, useEffect, useRef } from "react";
import Image from "next/image";
import type { NavProps } from "@/types";

type SplashState = { phase: number };
type SplashAction = { type: "ADVANCE_PHASE"; value: number };

function splashReducer(state: SplashState, action: SplashAction): SplashState {
  switch (action.type) {
    case "ADVANCE_PHASE": return { ...state, phase: action.value };
    default: return state;
  }
}

function scheduleSplashPhases(
  dispatch: React.Dispatch<SplashAction>,
  navigate: NavProps["navigate"],
  isMounted: React.MutableRefObject<boolean>,
): (() => void) {
  const t1 = setTimeout(() => { if (isMounted.current) dispatch({ type: "ADVANCE_PHASE", value: 1 }); }, 150);
  const t2 = setTimeout(() => { if (isMounted.current) dispatch({ type: "ADVANCE_PHASE", value: 2 }); }, 700);
  const tNav = setTimeout(() => navigate("verify", "forward"), 2000);
  return () => {
    isMounted.current = false;
    clearTimeout(t1);
    clearTimeout(t2);
    clearTimeout(tNav);
  };
}

export default function SplashScreen({ navigate }: NavProps) {
  const [state, dispatch] = useReducer(splashReducer, { phase: 0 });
  const { phase } = state;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return scheduleSplashPhases(dispatch, navigate, mountedRef);
  }, [navigate]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f0c0a",
        position: "relative",
        overflow: "hidden",
        gap: 20,
      }}
    >
      {/* App icon */}
      <div
        style={{
          width: 100,
          height: 100,
          borderRadius: 24,
          overflow: "hidden",
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 16px 48px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4)",
          opacity: phase >= 1 ? 1 : 0,
          transform: phase >= 1 ? "scale(1)" : "scale(0.88)",
          transition: "opacity 0.55s ease, transform 0.55s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        <Image
          src="/storycropped.png"
          alt="Story"
          width={88}
          height={88}
          style={{ objectFit: "contain", display: "block", filter: "brightness(0) saturate(100%) invert(74%) sepia(100%) saturate(276%) hue-rotate(0deg) brightness(82%)" }}
        />
      </div>

      {/* Wordmark */}
      <span
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 38,
          fontWeight: 800,
          color: "#ffffff",
          letterSpacing: "-0.03em",
          lineHeight: 1,
          opacity: phase >= 1 ? 1 : 0,
          transition: "opacity 0.55s ease 0.1s",
        }}
      >
        Story
      </span>

      {/* Tagline */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          opacity: phase >= 2 ? 1 : 0,
          transition: "opacity 0.5s ease",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-inter)",
            fontSize: 14,
            fontWeight: 600,
            color: "rgba(255,255,255,0.7)",
            letterSpacing: "0.01em",
          }}
        >
          Post less. Mean more.
        </span>
        <span
          style={{
            fontFamily: "var(--font-inter)",
            fontSize: 11,
            color: "rgba(255,255,255,0.25)",
            letterSpacing: "0.04em",
          }}
        >
          Verified humans · Private circles
        </span>
      </div>
    </div>
  );
}
