"use client";

import Image from "next/image";

interface LoginScreenProps {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(160deg, #0B1120 0%, #0F1F40 60%, #1a3a6b 100%)",
        overflow: "hidden",
        position: "relative",
        fontFamily: "var(--font-dm-sans), var(--font-inter), system-ui, sans-serif",
      }}
    >
      {/* Status Bar */}
      <div
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 24,
          paddingRight: 24,
          flexShrink: 0,
          position: "relative",
          zIndex: 2,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600, color: "#FFFFFF", letterSpacing: "-0.2px" }}>
          9:41
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

      {/* Logo + tagline — centered in remaining space */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: 24,
          zIndex: 2,
          position: "relative",
        }}
      >
        <Image
          src="/tizzycropped.png"
          alt="Tizzy"
          width={96}
          height={96}
          style={{ objectFit: "contain", marginBottom: 16, filter: "brightness(0) saturate(100%) invert(65%) sepia(100%) saturate(324%) hue-rotate(182deg) brightness(102%)" }}
        />
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "#FFFFFF",
            letterSpacing: "-0.04em",
          }}
        >
          Tizzy
        </span>
        <span
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.55)",
            textAlign: "center",
            display: "block",
            marginTop: 8,
            fontWeight: 400,
            paddingLeft: 32,
            paddingRight: 32,
          }}
        >
          Wear it. Talk. Tizzy does the rest.
        </span>
      </div>

      {/* Bottom sheet with auth buttons */}
      <div
        style={{
          borderRadius: "28px 28px 0 0",
          background: "#0E1929",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.3)",
          position: "relative",
          zIndex: 3,
          padding: "28px 24px 44px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(255,255,255,0.28)",
            textTransform: "uppercase",
            letterSpacing: "1px",
            margin: "0 0 4px 0",
            textAlign: "center",
          }}
        >
          Sign in to continue
        </p>

        {/* Apple button — primary */}
        <button
          onClick={onLogin}
          style={{
            width: "100%",
            height: 52,
            borderRadius: 16,
            background: "#FFFFFF",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            fontWeight: 700,
            color: "#000000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            fontFamily: "inherit",
          }}
        >
          <svg width="15" height="18" viewBox="0 0 15 18" fill="none">
            <path
              d="M12.4 9.3C12.4 7.4 13.5 6.2 13.5 6.2C12.7 5.1 11.5 5 11.1 5C9.9 4.9 8.8 5.7 8.2 5.7C7.6 5.7 6.6 5 5.6 5C4.2 5 2.9 5.8 2.2 7.1C0.7 9.9 1.8 14.1 3.3 16.4C4.1 17.5 5 18.8 6.1 18.7C7.1 18.7 7.6 18.1 8.8 18.1C10 18.1 10.4 18.7 11.5 18.7C12.6 18.7 13.4 17.6 14.2 16.5C14.7 15.8 14.9 15.1 15 14.5C13.3 13.8 12.4 11.7 12.4 9.3Z"
              fill="#000"
            />
            <path
              d="M10.1 3.4C10.7 2.6 11.1 1.6 11 0.6C10.1 0.7 9.1 1.2 8.4 2C7.8 2.7 7.3 3.7 7.4 4.7C8.4 4.7 9.4 4.2 10.1 3.4Z"
              fill="#000"
            />
          </svg>
          Continue with Apple
        </button>

        {/* Google button — secondary */}
        <button
          onClick={onLogin}
          style={{
            width: "100%",
            height: 52,
            borderRadius: 16,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.18)",
            cursor: "pointer",
            fontSize: 16,
            fontWeight: 600,
            color: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            fontFamily: "inherit",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2C17.64 8.57 17.58 7.97 17.48 7.38H9V10.84H13.84C13.63 11.97 13 12.92 12.04 13.56V15.82H14.96C16.66 14.25 17.64 11.93 17.64 9.2Z" fill="#4285F4"/>
            <path d="M9 18C11.43 18 13.47 17.19 14.96 15.82L12.04 13.56C11.23 14.1 10.21 14.42 9 14.42C6.66 14.42 4.68 12.84 3.96 10.71H0.95V13.04C2.44 15.99 5.48 18 9 18Z" fill="#34A853"/>
            <path d="M3.96 10.71C3.78 10.17 3.68 9.6 3.68 9C3.68 8.4 3.78 7.83 3.96 7.29V4.96H0.95C0.34 6.17 0 7.55 0 9C0 10.45 0.34 11.83 0.95 13.04L3.96 10.71Z" fill="#FBBC05"/>
            <path d="M9 3.58C10.32 3.58 11.51 4.04 12.45 4.94L15.02 2.37C13.47 0.9 11.43 0 9 0C5.48 0 2.44 2.01 0.95 4.96L3.96 7.29C4.68 5.16 6.66 3.58 9 3.58Z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        <p
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.2)",
            textAlign: "center",
            lineHeight: 1.5,
            margin: "4px 0 0",
          }}
        >
          By continuing you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}
