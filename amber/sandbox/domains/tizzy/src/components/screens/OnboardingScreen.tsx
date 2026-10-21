"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";

interface OnboardingScreenProps {
  onComplete: () => void;
}

// ─── Slide Illustrations ──────────────────────────────────────────────────────

function PendantLogoIllustration() {
  return (
    <svg width="80" height="96" viewBox="0 0 80 96" fill="none">
      {/* Chain arc */}
      <path
        d="M20 28 Q40 6 60 28"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Chain connector ring */}
      <ellipse cx="40" cy="28" rx="5" ry="3.5" fill="rgba(255,255,255,0.4)" />
      {/* Pendant body */}
      <ellipse cx="40" cy="66" rx="24" ry="26" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      {/* Center sensor ring */}
      <circle cx="40" cy="66" r="9" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" fill="none" />
      {/* Center dot */}
      <circle cx="40" cy="66" r="4" fill="rgba(255,255,255,0.7)" />
    </svg>
  );
}

function PendantWithWavesIllustration() {
  return (
    <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
      {/* Sound wave rings */}
      <circle cx="50" cy="62" r="42" stroke="rgba(37,99,235,0.15)" strokeWidth="1.5" fill="none" />
      <circle cx="50" cy="62" r="32" stroke="rgba(37,99,235,0.22)" strokeWidth="1.5" fill="none" />
      <circle cx="50" cy="62" r="22" stroke="rgba(37,99,235,0.32)" strokeWidth="1.5" fill="none" />
      {/* Conversation bubbles */}
      <rect x="64" y="16" width="28" height="14" rx="7" fill="rgba(255,255,255,0.18)" />
      <rect x="8" y="22" width="22" height="12" rx="6" fill="rgba(255,255,255,0.13)" />
      <rect x="68" y="38" width="18" height="10" rx="5" fill="rgba(255,255,255,0.10)" />
      {/* Chain */}
      <path d="M34 14 Q50 4 66 14" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <ellipse cx="50" cy="14" rx="4" ry="3" fill="rgba(255,255,255,0.35)" />
      {/* Pendant body */}
      <ellipse cx="50" cy="62" rx="18" ry="20" fill="rgba(37,99,235,0.25)" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      {/* Center sensor */}
      <circle cx="50" cy="62" r="5" fill="rgba(255,255,255,0.6)" />
    </svg>
  );
}

function MetricBarsIllustration() {
  const bars = [
    { color: "#2563EB", height: 28, label: "VC" },
    { color: "#3B82F6", height: 40, label: "SP" },
    { color: "#1D4ED8", height: 34, label: "VR" },
    { color: "#60A5FA", height: 48, label: "CF" },
  ];
  return (
    <svg width="88" height="64" viewBox="0 0 88 64" fill="none">
      {bars.map((b, i) => {
        const x = i * 22 + 2;
        const y = 56 - b.height;
        return (
          <g key={b.label}>
            {/* Background track */}
            <rect x={x} y={8} width={16} height={48} rx={4} fill="rgba(255,255,255,0.08)" />
            {/* Filled bar */}
            <rect x={x} y={y} width={16} height={b.height} rx={4} fill={b.color} opacity={0.85} />
          </g>
        );
      })}
    </svg>
  );
}

function CoachingIllustration() {
  return (
    <svg width="96" height="88" viewBox="0 0 96 88" fill="none">
      {/* Phone outline */}
      <rect x="54" y="12" width="34" height="60" rx="8" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
      {/* Phone screen area */}
      <rect x="58" y="18" width="26" height="48" rx="4" fill="rgba(37,99,235,0.15)" />
      {/* Phone screen lines */}
      <rect x="62" y="24" width="18" height="3" rx="1.5" fill="rgba(255,255,255,0.35)" />
      <rect x="62" y="31" width="12" height="3" rx="1.5" fill="rgba(255,255,255,0.2)" />
      <rect x="62" y="38" width="15" height="3" rx="1.5" fill="rgba(255,255,255,0.2)" />
      {/* Haptic concentric rings from pendant */}
      <circle cx="30" cy="52" r="26" stroke="rgba(37,99,235,0.12)" strokeWidth="1.5" fill="none" />
      <circle cx="30" cy="52" r="19" stroke="rgba(37,99,235,0.2)" strokeWidth="1.5" fill="none" />
      <circle cx="30" cy="52" r="12" stroke="rgba(37,99,235,0.3)" strokeWidth="1.5" fill="none" />
      {/* Chain */}
      <path d="M16 22 Q30 12 44 22" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <ellipse cx="30" cy="22" rx="4" ry="3" fill="rgba(255,255,255,0.3)" />
      {/* Pendant body */}
      <ellipse cx="30" cy="52" rx="14" ry="16" fill="rgba(37,99,235,0.3)" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      {/* Center sensor */}
      <circle cx="30" cy="52" r="4" fill="rgba(255,255,255,0.65)" />
    </svg>
  );
}

// ─── Slide Definitions ────────────────────────────────────────────────────────

interface Slide {
  illustration: "pendant" | "waves" | "metrics" | "coaching" | "logo";
  headline: string;
  body: string;
  circleBg: string;
  gradient: string;
}

const SLIDES: Slide[] = [
  {
    illustration: "pendant",
    headline: "Wear it. Talk. That's it.",
    body: "Tizzy records your conversations passively throughout the day. No buttons, no setup. Just put it on.",
    circleBg: "rgba(37,99,235,0.18)",
    gradient: "linear-gradient(160deg, #0B1120 0%, #0F1F40 60%, #1a3a6b 100%)",
  },
  {
    illustration: "waves",
    headline: "Every conversation, captured",
    body: "Whether you're in a meeting, on a call, or grabbing coffee, Tizzy auto-detects conversations and builds your communication profile.",
    circleBg: "rgba(37,99,235,0.15)",
    gradient: "linear-gradient(160deg, #0B1120 0%, #0D1F3C 60%, #0F2D5A 100%)",
  },
  {
    illustration: "metrics",
    headline: "See exactly how you communicate",
    body: "Vocal Clarity, Speaking Pace, Vocal Range, and Conversational Flow. Tracked across every conversation, every day.",
    circleBg: "rgba(37,99,235,0.15)",
    gradient: "linear-gradient(160deg, #0B1120 0%, #0F1F40 60%, #1a3a6b 100%)",
  },
  {
    illustration: "coaching",
    headline: "Practice with live feedback",
    body: "Start a Coaching Session to get real-time haptic cues as you speak. The pendant taps when you can pause, slow down, or add more range.",
    circleBg: "rgba(37,99,235,0.15)",
    gradient: "linear-gradient(160deg, #0B1120 0%, #0F1F40 60%, #1a3a6b 100%)",
  },
  {
    illustration: "logo",
    headline: "Ready to start?",
    body: "Connect your Tizzy pendant and your first conversations will appear automatically. Most people see insights within an hour of wearing it.",
    circleBg: "rgba(37,99,235,0.18)",
    gradient: "linear-gradient(160deg, #0B1120 0%, #0F1F40 60%, #1a3a6b 100%)",
  },
];

// ─── Sub-Components ───────────────────────────────────────────────────────────

function OnboardingStatusBar({ clockTime }: { clockTime: string }) {
  return (
    <div
      style={{
        height: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: 24,
        paddingRight: 24,
        flexShrink: 0,
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.9)", letterSpacing: "-0.2px" }}>
        {clockTime}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
          <rect x="0"    y="8" width="3" height="4"  rx="1" fill="white" />
          <rect x="4.5"  y="5" width="3" height="7"  rx="1" fill="white" />
          <rect x="9"    y="2" width="3" height="10" rx="1" fill="white" />
          <rect x="13.5" y="0" width="3" height="12" rx="1" fill="white" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <path d="M8 9.5 L8 9.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M5.5 7.2 Q8 5.2 10.5 7.2" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          <path d="M3 4.8 Q8 1 13 4.8" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="white" strokeWidth="1" opacity="0.6" />
          <rect x="2"   y="2"   width="16" height="8"  rx="2"   fill="white" />
          <path d="M22.5 4 L22.5 8" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
        </svg>
      </div>
    </div>
  );
}

function SlideCard({ s }: { s: Slide }) {
  return (
    <div
      style={{
        width: `${100 / SLIDES.length}%`,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 32px 24px",
        boxSizing: "border-box",
        overflowY: "auto",
      }}
    >
      {/* Illustration circle */}
      <div
        style={{
          width: 112,
          height: 112,
          borderRadius: "50%",
          background: s.circleBg,
          border: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 40,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {s.illustration === "pendant" && <PendantLogoIllustration />}
        {s.illustration === "waves"   && <PendantWithWavesIllustration />}
        {s.illustration === "metrics" && <MetricBarsIllustration />}
        {s.illustration === "coaching" && <CoachingIllustration />}
        {s.illustration === "logo" && (
          <Image
            src="/tizzycropped.png"
            alt="Tizzy"
            width={300}
            height={300}
            style={{ objectFit: "contain", filter: "brightness(0) saturate(100%) invert(65%) sepia(100%) saturate(324%) hue-rotate(182deg) brightness(102%)" }}
          />
        )}
      </div>

      {/* Headline */}
      <h1
        style={{
          fontSize: 28,
          fontWeight: 800,
          color: "#FFFFFF",
          margin: 0,
          marginBottom: 16,
          textAlign: "center",
          lineHeight: 1.2,
          letterSpacing: "-0.5px",
        }}
      >
        {s.headline}
      </h1>

      {/* Body */}
      <p
        style={{
          fontSize: 16,
          color: "rgba(255,255,255,0.6)",
          textAlign: "center",
          lineHeight: 1.65,
          margin: 0,
          maxWidth: 280,
          fontWeight: 400,
        }}
      >
        {s.body}
      </p>
    </div>
  );
}

function SlideCarousel({ currentSlide }: { currentSlide: number }) {
  return (
    <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
      <div
        style={{
          display: "flex",
          width: `${SLIDES.length * 100}%`,
          height: "100%",
          transform: `translateX(-${(currentSlide * 100) / SLIDES.length}%)`,
          transition: "transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
      >
        {SLIDES.map((s) => (
          <SlideCard key={s.illustration} s={s} />
        ))}
      </div>
    </div>
  );
}

interface OnboardingControlsProps {
  currentSlide: number;
  isLastSlide: boolean;
  btnPressed: boolean;
  onDotClick: (index: number) => void;
  onNext: () => void;
  onBtnPressStart: () => void;
  onBtnPressEnd: () => void;
}

function OnboardingControls({
  currentSlide,
  isLastSlide,
  btnPressed,
  onDotClick,
  onNext,
  onBtnPressStart,
  onBtnPressEnd,
}: OnboardingControlsProps) {
  return (
    <div
      style={{
        flexShrink: 0,
        padding: "20px 28px 36px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
      }}
    >
      {/* Slide counter + dots */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>
          {currentSlide + 1} / {SLIDES.length}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {SLIDES.map((slide, index) => (
            <button
              key={slide.illustration}
              onClick={() => onDotClick(index)}
              aria-label={`Go to slide ${index + 1}`}
              style={{
                width: index === currentSlide ? 20 : 6,
                height: 6,
                borderRadius: 3,
                background: index === currentSlide ? "#2563EB" : "rgba(255,255,255,0.2)",
                border: "none",
                cursor: "pointer",
                padding: 0,
                transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            />
          ))}
        </div>
      </div>

      {/* CTA button */}
      <button
        onClick={onNext}
        onMouseDown={onBtnPressStart}
        onMouseUp={onBtnPressEnd}
        onMouseLeave={onBtnPressEnd}
        onTouchStart={onBtnPressStart}
        onTouchEnd={onBtnPressEnd}
        style={{
          width: "100%",
          height: 52,
          borderRadius: 16,
          background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
          border: "none",
          cursor: "pointer",
          fontSize: 16,
          fontWeight: 700,
          color: "#FFFFFF",
          letterSpacing: "0.1px",
          boxShadow: "0 4px 20px rgba(37,99,235,0.35)",
          transition: "opacity 0.1s ease, transform 0.1s ease",
          fontFamily: "inherit",
          opacity: btnPressed ? 0.85 : 1,
          transform: btnPressed ? "scale(0.98)" : "scale(1)",
        }}
      >
        {isLastSlide ? "Get Started" : "Next"}
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [clockTime, setClockTime] = useState("");
  const [btnPressed, setBtnPressed] = useState(false);
  const touchStartX = useRef(0);

  useEffect(() => {
    function tick() {
      const now = new Date();
      const h = now.getHours() % 12 || 12;
      const m = now.getMinutes().toString().padStart(2, "0");
      setClockTime(`${h}:${m}`);
    }
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const handleNext = () => {
    setCurrentSlide(prev => {
      if (prev < SLIDES.length - 1) return prev + 1;
      onComplete();
      return prev;
    });
  };

  const handleBack = () => {
    setCurrentSlide(prev => (prev > 0 ? prev - 1 : prev));
  };

  const isLastSlide = currentSlide === SLIDES.length - 1;
  const slide = SLIDES[currentSlide];

  return (
    <div
      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const diff = e.changedTouches[0].clientX - touchStartX.current;
        if (diff < -50) handleNext();
        if (diff > 50 && currentSlide > 0) handleBack();
      }}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: slide.gradient,
        overflow: "hidden",
        position: "relative",
        fontFamily: "var(--font-dm-sans), var(--font-inter), system-ui, sans-serif",
        paddingTop: 44,
        boxSizing: "border-box",
        transition: "background 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <OnboardingStatusBar clockTime={clockTime} />

      {/* Back chevron on slides 2+ */}
      {currentSlide > 0 && (
        <button
          onClick={handleBack}
          style={{
            position: "absolute",
            top: 52,
            left: 16,
            zIndex: 10,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 8px",
            fontFamily: "inherit",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="10" height="18" viewBox="0 0 10 18" fill="none">
            <path d="M9 1L1 9L9 17" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Skip button — non-last slides only */}
      {!isLastSlide && (
        <button
          onClick={onComplete}
          style={{
            position: "absolute",
            top: 60,
            right: 20,
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 14,
            color: "rgba(255,255,255,0.4)",
            fontFamily: "inherit",
            fontWeight: 500,
            padding: "4px 8px",
            zIndex: 10,
          }}
        >
          Skip
        </button>
      )}

      {/* Tizzy wordmark */}
      <div style={{ textAlign: "center", paddingTop: 56, flexShrink: 0 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#FFFFFF", letterSpacing: "-0.04em" }}>
          Tizzy
        </span>
      </div>

      <SlideCarousel currentSlide={currentSlide} />

      <OnboardingControls
        currentSlide={currentSlide}
        isLastSlide={isLastSlide}
        btnPressed={btnPressed}
        onDotClick={setCurrentSlide}
        onNext={handleNext}
        onBtnPressStart={() => setBtnPressed(true)}
        onBtnPressEnd={() => setBtnPressed(false)}
      />
    </div>
  );
}
