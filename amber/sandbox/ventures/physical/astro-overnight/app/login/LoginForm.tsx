"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(false);
    setLoading(true);

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setLoading(false);

    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError(true);
      setPassword("");
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#07080b",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 24px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 360 }}>

        {/* Wordmark */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <p style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            color: "#c8a84a",
            marginBottom: 10,
          }}>
            Astro Overnight
          </p>
          <div style={{
            width: 32,
            height: 1,
            background: "rgba(200,168,74,0.35)",
            margin: "0 auto",
          }} />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setError(false);
              setPassword(e.target.value);
            }}
            placeholder="Password"
            autoFocus
            style={{
              width: "100%",
              padding: "14px 18px",
              borderRadius: 12,
              border: error ? "1px solid rgba(255,80,80,0.45)" : "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
              color: "white",
              fontSize: 15,
              outline: "none",
              transition: "border-color 0.2s",
              boxSizing: "border-box",
            }}
            onFocus={e => {
              if (!error) e.target.style.borderColor = "rgba(200,168,74,0.5)";
            }}
            onBlur={e => {
              if (!error) e.target.style.borderColor = "rgba(255,255,255,0.08)";
            }}
          />

          {error && (
            <p style={{ fontSize: 12, color: "rgba(255,100,100,0.85)", margin: "0 2px" }}>
              Incorrect password.
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: 12,
              border: "none",
              background: password && !loading ? "#c8a84a" : "rgba(200,168,74,0.25)",
              color: password && !loading ? "#07080b" : "rgba(200,168,74,0.5)",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "0.04em",
              cursor: password && !loading ? "pointer" : "default",
              transition: "background 0.2s, color 0.2s",
            }}
          >
            {loading ? "Verifying…" : "Enter"}
          </button>
        </form>

      </div>
    </div>
  );
}
