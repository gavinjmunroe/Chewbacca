"use client";

import { useReducer, useEffect, useRef } from "react";
import type { NavProps } from "@/types";

type VerifyState = { phase: number };
type VerifyAction = { type: "ADVANCE_PHASE"; value: number };

function verifyReducer(state: VerifyState, action: VerifyAction): VerifyState {
  switch (action.type) {
    case "ADVANCE_PHASE": return { ...state, phase: action.value };
    default: return state;
  }
}

function scheduleVerifyPhases(
  dispatch: React.Dispatch<VerifyAction>,
  navigate: NavProps["navigate"],
  isMounted: React.MutableRefObject<boolean>,
): (() => void) {
  const t1 = setTimeout(() => { if (isMounted.current) dispatch({ type: "ADVANCE_PHASE", value: 1 }); }, 700);
  const t2 = setTimeout(() => { if (isMounted.current) dispatch({ type: "ADVANCE_PHASE", value: 2 }); }, 1500);
  const t3 = setTimeout(() => navigate("home", "forward"), 2000);
  return () => {
    isMounted.current = false;
    clearTimeout(t1);
    clearTimeout(t2);
    clearTimeout(t3);
  };
}

export default function VerifyScreen({ navigate }: NavProps) {
  const [state, dispatch] = useReducer(verifyReducer, { phase: 0 });
  const { phase } = state;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return scheduleVerifyPhases(dispatch, navigate, mountedRef);
  }, [navigate]);

  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg, #14100a 0%, #0d0b08 50%, #0f0c0a 100%)",
      position: "relative", overflow: "hidden",
      padding: "0 28px",
      boxSizing: "border-box" as const,
    }}>
      {/* Cancel button */}
      <button
        onClick={() => navigate("splash", "back")}
        style={{
          position: "absolute", top: 16, left: 16,
          background: "none", border: "none",
          color: "rgba(255,255,255,0.3)", fontSize: 12,
          fontFamily: "var(--font-inter)", cursor: "pointer", padding: "4px 8px",
        }}
      >
        Cancel
      </button>

      {/* Background glow */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 280, height: 280,
        background: "radial-gradient(circle, rgba(245,158,11,0.1) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Top label */}
      <div style={{
        fontSize: 12, color: "rgba(245,158,11,0.65)",
        fontWeight: 600,
        fontFamily: "var(--font-inter)",
        marginBottom: 28,
      }}>
        Identity check
      </div>

      {/* Scan circle */}
      <div style={{ position: "relative", width: 140, height: 140, marginBottom: 28 }}>
        {/* Rotating outer ring — purple, always spinning */}
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          border: "1.5px solid transparent",
          background: "linear-gradient(#0f0c0a, #0f0c0a) padding-box, linear-gradient(135deg, rgba(245,158,11,0.8) 0%, rgba(245,158,11,0.1) 50%, rgba(245,158,11,0.8) 100%) border-box",
          animation: "spin 2s linear infinite",
        }} />
        {/* Green confirmation ring — fades in on phase 2 */}
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          border: "1.5px solid transparent",
          background: "linear-gradient(#0f0c0a, #0f0c0a) padding-box, linear-gradient(135deg, rgba(52,211,153,0.8) 0%, rgba(52,211,153,0.1) 50%, rgba(52,211,153,0.8) 100%) border-box",
          opacity: phase === 2 ? 1 : 0,
          transition: "opacity 0.5s ease",
          pointerEvents: "none",
        }} />
        {/* Static inner ring */}
        <div style={{
          position: "absolute", inset: 8, borderRadius: "50%",
          border: "1px solid rgba(245,158,11,0.15)",
        }} />
        {/* Face outline SVG */}
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="68" height="78" viewBox="0 0 68 78" fill="none">
            <path
              d="M34 6 C18 6 8 18 8 32 C8 50 20 64 34 68 C48 64 60 50 60 32 C60 18 50 6 34 6Z"
              stroke="rgba(245,158,11,0.5)" strokeWidth="1.5" fill="none"
            />
            <ellipse cx="23" cy="30" rx="3.5" ry="2.5" stroke="rgba(245,158,11,0.7)" strokeWidth="1.2" fill="none" />
            <ellipse cx="45" cy="30" rx="3.5" ry="2.5" stroke="rgba(245,158,11,0.7)" strokeWidth="1.2" fill="none" />
            <path d="M34 34 L31 42 L34 43 L37 42 L34 34" stroke="rgba(245,158,11,0.4)" strokeWidth="1" fill="none" strokeLinejoin="round" />
            <path d="M25 50 Q34 56 43 50" stroke="rgba(245,158,11,0.6)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          </svg>
        </div>

        {/* Animated scan line */}
        <div style={{
          position: "absolute",
          left: "18%", right: "18%",
          height: "1px",
          backgroundColor: "rgba(245,158,11,0.55)",
          animation: "scanline 2s ease-in-out infinite",
          pointerEvents: "none",
        }} />

        {/* Corner brackets */}
        {[
          { top: 4, left: 4, rotate: "0deg" },
          { top: 4, right: 4, rotate: "90deg" },
          { bottom: 4, right: 4, rotate: "180deg" },
          { bottom: 4, left: 4, rotate: "270deg" },
        ].map((pos) => (
          <div key={pos.rotate} style={{
            position: "absolute", ...pos,
            width: 14, height: 14,
            borderTop: `2px solid ${phase === 2 ? "rgba(52,211,153,0.7)" : "rgba(245,158,11,0.7)"}`,
            borderLeft: `2px solid ${phase === 2 ? "rgba(52,211,153,0.7)" : "rgba(245,158,11,0.7)"}`,
            transform: `rotate(${pos.rotate})`,
            transition: "border-color 0.4s ease",
          }} />
        ))}
      </div>

      {/* Title */}
      <div style={{
        fontSize: 20, fontWeight: 700, color: "#fff",
        fontFamily: "var(--font-dm-sans)", letterSpacing: "-0.02em",
        textAlign: "center" as const, marginBottom: 8,
      }}>
        Verify you&apos;re human.
      </div>

      {/* Subtitle */}
      <div style={{
        fontSize: 13, color: "rgba(255,255,255,0.45)",
        fontFamily: "var(--font-inter)", textAlign: "center" as const,
        lineHeight: 1.55, marginBottom: 28, maxWidth: 220,
      }}>
        One account per person. In production, biometric data is processed entirely on-device.
      </div>

      {/* Progress bar */}
      <div style={{
        width: "100%", maxWidth: 180, height: 3,
        backgroundColor: "rgba(255,255,255,0.07)",
        borderRadius: 999, overflow: "hidden",
      }}>
        <div style={{
          height: "100%", borderRadius: 999,
          backgroundColor: "#f59e0b",
          animation: "progress-fill 2.2s ease-out forwards",
        }} />
      </div>

      {/* Status text */}
      <div style={{
        marginTop: 12,
        fontSize: 11,
        color: phase === 2 ? "#34d399" : "rgba(245,158,11,0.55)",
        fontFamily: "var(--font-inter)", letterSpacing: "0.05em",
        transition: "color 0.4s ease",
      }}>
        {["Scanning...", "Analyzing biometrics...", "Identity confirmed ✓"][phase]}
      </div>

      {/* Demo mode disclaimer */}
      <div style={{
        position: "absolute",
        bottom: 18,
        left: 0,
        right: 0,
        fontSize: 9,
        color: "rgba(255,255,255,0.2)",
        fontFamily: "var(--font-inter)",
        textAlign: "center" as const,
        letterSpacing: "0.04em",
      }}>
        Demo mode · No data collected
      </div>
    </div>
  );
}
